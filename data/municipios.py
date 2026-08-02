#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Enriquece municipios.json con datos de Wikipedia, Wikidata, DANE e IGAC.

Salida (por municipio):
  - descripcion_general : str   (párrafo de Wikipedia: cultura, economía, historia)
  - altitud             : float (msnm)
  - poblacion           : int   (prioridad: DANE > Wikidata)
  - area_total_km2      : float (Wikidata)
  - area_urbana_km2     : float (IGAC CSV)

Uso:
  1. Guarda este archivo como enriquecer.py
  2. Pon tu municipios.json en la MISMA carpeta
  3. (Opcional) Pon los CSVs del DANE e IGAC y ajusta las rutas abajo
  4. Ejecuta:  python enriquecer.py
  5. Revisa:   municipios_enriquecidos.json
"""

import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

# =============================================================================
# CONFIGURACIÓN
# =============================================================================
INPUT_JSON = Path("municipios.json")
OUTPUT_JSON = Path("municipios_enriquecidos.json")

# CSVs opcionales (pon la ruta si los tienes, o déjalo en None)
CSV_DANE_POBLACION = None          # Ej: Path("dane_poblacion.csv")
CSV_IGAC_AREA_URBANA = None        # Ej: Path("igac_urbana.csv")

# Ajusta los nombres de columna si tus CSVs usan otros encabezados
DANE_COL_MUNICIPIO = "MUNICIPIO"     # o "Municipio", "NOMBRE_MUNICIPIO", etc.
DANE_COL_POBLACION = "POBLACION"     # o "Total", "CENSO_2018", etc.
IGAC_COL_MUNICIPIO = "MUNICIPIO"     # o "Municipio"
IGAC_COL_AREA_URB  = "AREA_URBANA_KM2"  # o "Area Urbana", "SUPERFICIE_URBANA"

# Throttling amable para no saturar servidores
REQUEST_DELAY = 0.4

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ColombiaMunicipiosBot/1.0; contact@localhost)",
    "Accept": "application/json",
}

# =============================================================================
# NORMALIZACIÓN DE NOMBRES
# =============================================================================
def normalizar(texto: str) -> str:
    t = texto.lower().strip()
    t = unicodedata.normalize("NFKD", t).encode("ASCII", "ignore").decode("utf-8")
    t = t.replace("santa fe de antioquia", "santafe de antioquia")
    t = t.replace("bogota d.c.", "bogota")
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def limpiar_numero(valor) -> float | None:
    if pd.isna(valor):
        return None
    try:
        v = str(valor).replace(".", "").replace(",", ".") if str(valor).count(".") > 1 else str(valor).replace(",", ".")
        return float(v)
    except Exception:
        return None


# =============================================================================
# 1. WIKIPEDIA – Descripción general (cultura, economía, historia)
# =============================================================================
def fetch_wikipedia_extract(titulo: str) -> str | None:
    """
    Usa la API REST de Wikipedia en español para traer el extracto del artículo.
    Si el municipio no tiene artículo propio, devuelve None.
    """
    # Algunos municipios tienen artículos con "(Colombia)" o "(municipio)"
    candidatos = [
        titulo,
        f"{titulo} (Colombia)",
        f"{titulo} (municipio)",
        f"{titulo}, Colombia",
    ]

    for cand in candidatos:
        try:
            url = (
                "https://es.wikipedia.org/api/rest_v1/page/summary/"
                + urllib.parse.quote(cand.replace(" ", "_"))
            )
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("type") == "standard" and "extract" in data:
                return data["extract"]
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            time.sleep(REQUEST_DELAY)
        except Exception:
            time.sleep(REQUEST_DELAY)
    return None


# =============================================================================
# 2. WIKIDATA – Altitud, área total, población
# =============================================================================
def fetch_wikidata_sparql() -> pd.DataFrame:
    """
    Consulta SPARQL a Wikidata para todos los municipios de Colombia (Q493522).
    Devuelve DataFrame con: nombre_norm, altitud, area_total_km2, poblacion_wikidata
    """
    query = """
    SELECT ?item ?itemLabel ?altitud ?area ?poblacion
    WHERE {
      ?item wdt:P31 wd:Q493522 .
      OPTIONAL { ?item wdt:P2044 ?altitud. }
      OPTIONAL { ?item wdt:P2046 ?area. }
      OPTIONAL { ?item wdt:P1082 ?poblacion. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "es". }
    }
    """
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({"query": query})
    req = urllib.request.Request(url, headers={**HEADERS, "Accept": "application/sparql-results+json"})

    print("⏳ Consultando Wikidata (puede tardar 10-30 segundos)...")
    with urllib.request.urlopen(req, timeout=120) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    filas = []
    for row in result.get("results", {}).get("bindings", []):
        nombre = row.get("itemLabel", {}).get("value", "")
        if not nombre:
            continue

        alt = limpiar_numero(row.get("altitud", {}).get("value"))
        area = limpiar_numero(row.get("area", {}).get("value"))
        pob = limpiar_numero(row.get("poblacion", {}).get("value"))

        # Wikidata a veces devuelve m² en lugar de km²
        if area and area > 1_000_000:
            area = area / 1_000_000

        filas.append({
            "nombre_norm": normalizar(nombre),
            "altitud": alt,
            "area_total_km2": area,
            "poblacion_wikidata": int(pob) if pd.notna(pob) else None,
        })

    df = pd.DataFrame(filas).drop_duplicates(subset=["nombre_norm"], keep="first")
    print(f"✅ Wikidata: {len(df)} municipios con datos.")
    return df


# =============================================================================
# 3. CSVs LOCALES – DANE (población) e IGAC (área urbana)
# =============================================================================
def cargar_csv_generico(
    path: Path,
    col_mun: str,
    col_dato: str,
    nombre_salida: str,
) -> pd.DataFrame:
    if not path or not path.exists():
        return pd.DataFrame(columns=["nombre_norm", nombre_salida])

    # Detectar delimitador
    with open(path, "r", encoding="utf-8") as f:
        sample = f.read(4096)
        f.seek(0)
    delim = ";" if sample.count(";") > sample.count(",") else ","

    df = pd.read_csv(path, delimiter=delim, encoding="utf-8", low_memory=False)

    # Buscar columna de municipio de forma flexible
    col_mun_real = None
    for c in df.columns:
        if col_mun.lower() in c.lower() or "municipio" in c.lower() or "nombre" in c.lower():
            col_mun_real = c
            break
    if not col_mun_real:
        raise ValueError(f"No encontré columna de municipio en {path}. Columnas: {list(df.columns)}")

    # Buscar columna de dato de forma flexible
    col_dato_real = None
    for c in df.columns:
        if col_dato.lower() in c.lower() or nombre_salida.replace("_", " ").lower() in c.lower():
            col_dato_real = c
            break
    if not col_dato_real:
        # Último intento: buscar por palabras clave
        for c in df.columns:
            if any(k in c.lower() for k in ["poblacion", "total", "censo", "habitantes", "area", "urbana", "superficie"]):
                col_dato_real = c
                break
    if not col_dato_real:
        raise ValueError(f"No encontré columna de dato en {path}. Columnas: {list(df.columns)}")

    df = df[[col_mun_real, col_dato_real]].copy()
    df.columns = ["nombre_raw", "valor_raw"]
    df["nombre_norm"] = df["nombre_raw"].astype(str).apply(normalizar)
    df[nombre_salida] = pd.to_numeric(df["valor_raw"].astype(str).str.replace(",", "."), errors="coerce")
    df = df.dropna(subset=[nombre_salida]).drop_duplicates(subset=["nombre_norm"], keep="first")

    print(f"✅ CSV {path.name}: {len(df)} registros cargados.")
    return df[["nombre_norm", nombre_salida]]


# =============================================================================
# 4. PROCESAMIENTO PRINCIPAL
# =============================================================================
def main():
    if not INPUT_JSON.exists():
        raise FileNotFoundError(f"No se encontró {INPUT_JSON}. Colócalo junto a este script.")

    # -------------------------------------------------------------------------
    # Cargar base
    # -------------------------------------------------------------------------
    with open(INPUT_JSON, "r", encoding="utf-8") as f:
        base = json.load(f)

    df_base = pd.DataFrame(base)
    df_base["nombre_norm"] = df_base["nombre"].apply(normalizar)
    print(f"📂 JSON base: {len(df_base)} municipios.")

    # -------------------------------------------------------------------------
    # Wikidata (altitud, área total, población)
    # -------------------------------------------------------------------------
    try:
        df_wd = fetch_wikidata_sparql()
    except Exception as e:
        print(f"⚠️  Error con Wikidata: {e}")
        df_wd = pd.DataFrame(columns=["nombre_norm", "altitud", "area_total_km2", "poblacion_wikidata"])

    # -------------------------------------------------------------------------
    # CSVs locales
    # -------------------------------------------------------------------------
    try:
        df_dane = cargar_csv_generico(CSV_DANE_POBLACION, DANE_COL_MUNICIPIO, DANE_COL_POBLACION, "poblacion_dane")
    except Exception as e:
        print(f"⚠️  Error cargando DANE: {e}")
        df_dane = pd.DataFrame(columns=["nombre_norm", "poblacion_dane"])

    try:
        df_igac = cargar_csv_generico(CSV_IGAC_AREA_URBANA, IGAC_COL_MUNICIPIO, IGAC_COL_AREA_URB, "area_urbana_km2")
    except Exception as e:
        print(f"⚠️  Error cargando IGAC: {e}")
        df_igac = pd.DataFrame(columns=["nombre_norm", "area_urbana_km2"])

    # -------------------------------------------------------------------------
    # Merge (uniones)
    # -------------------------------------------------------------------------
    df = df_base.merge(df_wd, on="nombre_norm", how="left")
    df = df.merge(df_dane, on="nombre_norm", how="left")
    df = df.merge(df_igac, on="nombre_norm", how="left")

    # Población final: prioridad DANE > Wikidata
    df["poblacion"] = df["poblacion_dane"].fillna(df["poblacion_wikidata"])

    # -------------------------------------------------------------------------
    # Wikipedia – Descripción general (uno por uno con delay)
    # -------------------------------------------------------------------------
    print("⏳ Consultando Wikipedia para descripciones generales...")
    descripciones = {}
    total = len(df)
    for idx, row in df.iterrows():
        nombre = row["nombre"]
        depto = row["departamento"]
        # Algunos artículos usan "Municipio de X" o solo el nombre
        extracto = fetch_wikipedia_extract(nombre)
        if not extracto:
            extracto = fetch_wikipedia_extract(f"{nombre}, {depto}")
        descripciones[idx] = extracto
        if (idx + 1) % 50 == 0:
            print(f"   Progreso: {idx + 1}/{total}")
        time.sleep(REQUEST_DELAY)

    df["descripcion_general"] = df.index.map(descripciones)
    print(f"✅ Wikipedia: {df['descripcion_general'].notna().sum()} descripciones encontradas.")

    # -------------------------------------------------------------------------
    # Construir JSON de salida
    # -------------------------------------------------------------------------
    resultado = []
    for _, row in df.iterrows():
        resultado.append({
            "id": int(row["id"]) if pd.notna(row["id"]) else None,
            "nombre": row["nombre"],
            "departamento": row["departamento"],
            "lat": row["lat"],
            "lon": row["lon"],
            "descripcion_general": row["descripcion_general"] if pd.notna(row["descripcion_general"]) else None,
            "altitud": float(row["altitud"]) if pd.notna(row["altitud"]) else None,
            "poblacion": int(row["poblacion"]) if pd.notna(row["poblacion"]) else None,
            "area_total_km2": float(row["area_total_km2"]) if pd.notna(row["area_total_km2"]) else None,
            "area_urbana_km2": float(row["area_urbana_km2"]) if pd.notna(row["area_urbana_km2"]) else None,
        })

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(resultado, f, ensure_ascii=False, indent=2)

    # -------------------------------------------------------------------------
    # Resumen
    # -------------------------------------------------------------------------
    print("\n" + "=" * 60)
    print("RESUMEN")
    print("=" * 60)
    print(f"💾 Guardado: {OUTPUT_JSON}")
    print(f"📊 Total: {len(resultado)} municipios")
    print(f"   - Con descripción (Wikipedia): {sum(1 for r in resultado if r['descripcion_general'])}")
    print(f"   - Con altitud:                 {sum(1 for r in resultado if r['altitud'])}")
    print(f"   - Con población:               {sum(1 for r in resultado if r['poblacion'])}")
    print(f"   - Con área total:              {sum(1 for r in resultado if r['area_total_km2'])}")
    print(f"   - Con área urbana:             {sum(1 for r in resultado if r['area_urbana_km2'])}")
    print(f"   - Completamente vacíos:        {sum(1 for r in resultado if not any([r['descripcion_general'], r['altitud'], r['poblacion'], r['area_total_km2'], r['area_urbana_km2']]))}")
    print("\n📝 Muestra del primer registro con datos:")
    for r in resultado:
        if r["descripcion_general"] or r["poblacion"]:
            print(json.dumps(r, ensure_ascii=False, indent=2))
            break


if __name__ == "__main__":
    main()