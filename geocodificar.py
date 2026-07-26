import pandas as pd
import urllib.request
import urllib.parse
import json
import time
import os

# ─── CONFIGURACIÓN ─────────────────────────────────────────
ARCHIVO_ENTRADA = "Simbiosis Colombia.xlsx"
ARCHIVO_SALIDA  = "Simbiosis Colombia_geocodificado.xlsx"
BATCH_GUARDADO  = 200   # guarda cada N filas procesadas
# ───────────────────────────────────────────────────────────

def geocode_photon(lugar, municipio, departamento):
    """Geocodificación rápida con Photon (OSM)"""
    q = f"{lugar}, {municipio}, {departamento}, Colombia"
    url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=1"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SimbiosisColombia/1.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read().decode())
            if d.get('features') and len(d['features']) > 0:
                c = d['features'][0]['geometry']['coordinates']
                return round(c[1], 6), round(c[0], 6)
    except Exception:
        pass
    return None, None

def geocode_nominatim(lugar, municipio, departamento):
    """Fallback con Nominatim (más lento, requiere 1s de espera)"""
    q = f"{lugar}, {municipio}, {departamento}, Colombia"
    url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&limit=1&countrycodes=co"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'SimbiosisColombia-Geocoder/1.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode())
            if d and len(d) > 0:
                return float(d[0]['lat']), float(d[0]['lon'])
    except Exception:
        pass
    return None, None

def main():
    print("Leyendo Excel...")
    df = pd.read_excel(ARCHIVO_ENTRADA)
    total = len(df)
    print(f"Total filas: {total}")
    
    # Si existe parcial, reanudar
    if os.path.exists(ARCHIVO_SALIDA):
        df = pd.read_excel(ARCHIVO_SALIDA)
        ya_hechas = df['latitud'].notna().sum()
        print(f"Reanudando: {ya_hechas} ya geocodificadas")
    else:
        ya_hechas = 0

    encontrados = 0
    t0 = time.time()

    for i in range(ya_hechas, total):
        row = df.iloc[i]
        
        # Saltar si ya tiene coordenadas
        if pd.notna(row.get('latitud')) and pd.notna(row.get('longitud')):
            continue

        # 1) Intentar Photon
        lat, lon = geocode_photon(row['lugar'], row['municipio'], row['departamento'])
        
        # 2) Fallback Nominatim
        if lat is None:
            lat, lon = geocode_nominatim(row['lugar'], row['municipio'], row['departamento'])
            if lat is not None:
                time.sleep(1.0)  # respetar política Nominatim
        
        if lat is not None:
            df.at[i, 'latitud'] = lat
            df.at[i, 'longitud'] = lon
            encontrados += 1
        
        # Progreso en pantalla
        if (i + 1) % 50 == 0 or i == total - 1:
            pct = (i + 1) / total * 100
            print(f"  {i+1}/{total} ({pct:.1f}%) | Encontrados en este run: {encontrados} | Último: {row['lugar'][:30]}")
        
        # Guardado parcial periódico
        if (i + 1) % BATCH_GUARDADO == 0:
            df.to_excel(ARCHIVO_SALIDA, index=False)
            print(f"  💾 Guardado parcial en fila {i+1}")

    # Guardado final
    df.to_excel(ARCHIVO_SALIDA, index=False)
    
    total_geo = df['latitud'].notna().sum()
    print(f"\n✅ LISTO")
    print(f"   Geocodificados: {total_geo} / {total} ({total_geo/total*100:.1f}%)")
    print(f"   Tiempo total: {(time.time()-t0)/60:.1f} minutos")
    print(f"   Archivo guardado: {ARCHIVO_SALIDA}")

if __name__ == "__main__":
    main()