import pandas as pd
import urllib.request
import urllib.parse
import json
import time
import os

# ─── CONFIGURACIÓN ─────────────────────────────────────────
ARCHIVO_ENTRADA = "Municipios_Colombia.xlsx"
ARCHIVO_EXCEL   = "Municipios_Colombia_geocodificado.xlsx"
ARCHIVO_JSON    = "municipios_colombia.json"
BATCH_GUARDADO  = 200   # guarda cada N filas procesadas
# ───────────────────────────────────────────────────────────

def geocode_photon(municipio, departamento):
    """Geocodificación rápida con Photon (OSM)"""
    q = f"{municipio}, {departamento}, Colombia"
    url = f"https://photon.komoot.io/api/?q={urllib.parse.quote(q)}&limit=1"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'MunicipiosColombia/1.0'})
        with urllib.request.urlopen(req, timeout=8) as r:
            d = json.loads(r.read().decode())
            if d.get('features') and len(d['features']) > 0:
                c = d['features'][0]['geometry']['coordinates']
                return round(c[1], 6), round(c[0], 6)
    except Exception:
        pass
    return None, None

def geocode_nominatim(municipio, departamento):
    """Fallback con Nominatim (más lento, requiere 1s de espera)"""
    q = f"{municipio}, {departamento}, Colombia"
    url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(q)}&format=json&limit=1&countrycodes=co"
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'MunicipiosColombia-Geocoder/1.0'})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read().decode())
            if d and len(d) > 0:
                return float(d[0]['lat']), float(d[0]['lon'])
    except Exception:
        pass
    return None, None

def exportar_json(df):
    """Genera el JSON con el formato: {id, nombre, departamento, lat, lon}"""
    registros = []
    for idx, row in df.iterrows():
        lat = row.get('latitud')
        lon = row.get('longitud')
        registro = {
            "id": int(idx) + 1,
            "nombre": str(row['municipio']).strip() if pd.notna(row['municipio']) else "",
            "departamento": str(row['departamento']).strip() if pd.notna(row['departamento']) else "",
            "lat": float(lat) if pd.notna(lat) else None,
            "lon": float(lon) if pd.notna(lon) else None
        }
        registros.append(registro)

    with open(ARCHIVO_JSON, 'w', encoding='utf-8') as f:
        json.dump(registros, f, indent=2, ensure_ascii=False)

    print(f"   📄 JSON exportado: {ARCHIVO_JSON} ({len(registros)} registros)")

def main():
    print("Leyendo Excel...")
    df = pd.read_excel(ARCHIVO_ENTRADA)

    # Limpiar primera fila si es duplicado de encabezado
    if str(df.iloc[0]['departamento']).strip().lower() == 'departamento':
        df = df.iloc[1:].reset_index(drop=True)
        print("  → Primera fila duplicada eliminada")

    total = len(df)
    print(f"Total municipios: {total}")

    # Si existe parcial, reanudar
    if os.path.exists(ARCHIVO_EXCEL):
        df = pd.read_excel(ARCHIVO_EXCEL)
        ya_hechas = df['latitud'].notna().sum()
        print(f"Reanudando: {ya_hechas} ya geocodificados")
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
        lat, lon = geocode_photon(row['municipio'], row['departamento'])

        # 2) Fallback Nominatim
        if lat is None:
            lat, lon = geocode_nominatim(row['municipio'], row['departamento'])
            if lat is not None:
                time.sleep(1.0)  # respetar política Nominatim

        if lat is not None:
            df.at[i, 'latitud'] = lat
            df.at[i, 'longitud'] = lon
            encontrados += 1

        # Progreso en pantalla
        if (i + 1) % 50 == 0 or i == total - 1:
            pct = (i + 1) / total * 100
            print(f"  {i+1}/{total} ({pct:.1f}%) | Encontrados en este run: {encontrados} | Último: {row['municipio'][:30]}")

        # Guardado parcial periódico
        if (i + 1) % BATCH_GUARDADO == 0:
            df.to_excel(ARCHIVO_EXCEL, index=False)
            print(f"  💾 Guardado parcial en fila {i+1}")

    # Guardado final Excel
    df.to_excel(ARCHIVO_EXCEL, index=False)

    # Exportar JSON
    exportar_json(df)

    total_geo = df['latitud'].notna().sum()
    print(f"\n✅ LISTO")
    print(f"   Geocodificados: {total_geo} / {total} ({total_geo/total*100:.1f}%)")
    print(f"   Tiempo total: {(time.time()-t0)/60:.1f} minutos")
    print(f"   Excel guardado: {ARCHIVO_EXCEL}")
    print(f"   JSON guardado:  {ARCHIVO_JSON}")

if __name__ == "__main__":
    main()