#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Enriquece municipios.json con:
  - altitud         : msnm (infobox Wikipedia)
  - poblacion       : habitantes (infobox Wikipedia, o DANE CSV)
  - area_total_km2  : km² total (infobox Wikipedia)
  - area_urbana_km2 : km² urbano (IGAC CSV)

Cuando no encuentra un dato, escribe "Pendiente".

Uso:
  python enriquecer.py
"""

import json
import re
import ssl
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

ssl._create_default_https_context = ssl._create_unverified_context

INPUT_JSON = Path("municipios.json")
OUTPUT_JSON = Path("municipios_enriquecidos.json")

CSV_DANE_POBLACION = None
CSV_IGAC_AREA_URBANA = None

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ColombiaMunicipiosBot/1.0)",
    "Accept": "application/json",
}
DELAY = 0.6  # un poco más de cortesía a Wikipedia


def normalizar(t: str) -> str:
    t = t.lower().strip()
    t = unicodedata.normalize("NFKD", t).encode("ASCII", "ignore").decode("utf-8")
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def fetch_wikipedia_infobox(nombre: str, departamento: str):
    """
    Extrae altitud, poblacion y area_total_km2 del infobox de Wikipedia.
    Prueba múltiples variantes de título incluyendo el departamento.
    """
    result = {
        "altitud": None,
        "poblacion": None,
        "area_total_km2": None,
        "titulo_encontrado": None,
        "error": None,
    }

    # Variantes de título a probar, en orden de prioridad
    candidatos = [
        nombre,
        f"{nombre} (municipio)",
        f"{nombre} (Colombia)",
        f"{nombre}, {departamento}",
        f"{nombre} ({departamento})",
        f"{nombre}, Colombia",
    ]

    wikitext = ""
    titulo_usado = None

    for cand in candidatos:
        try:
            api_url = "https://es.wikipedia.org/w/api.php"
            params = {
                "action": "parse",
                "page": cand.replace(" ", "_"),
                "prop": "wikitext",
                "format": "json",
                "redirects": "1",
            }
            req = urllib.request.Request(
                api_url + "?" + urllib.parse.urlencode(params),
                headers=HEADERS,
            )
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))

            if "error" in data:
                continue

            wikitext = data.get("parse", {}).get("wikitext", {}).get("*", "")
            titulo_usado = cand
            break

        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            result["error"] = f"HTTP {e.code}"
        except Exception as e:
            result["error"] = str(e)

    if not titulo_usado:
        result["error"] = "No se encontró artículo en Wikipedia"
        return result

    result["titulo_encontrado"] = titulo_usado

    # ========== EXTRAER DATOS DEL INFOBOX ==========
    
    # --- Altitud ---
    # Busca: |altitud = 96 m, |altitud = {{convert|96|m}}, |elevación = 2.150 msnm
    alt_patterns = [
        r"\|\s*altitud\s*=\s*([^\n\|]+)",
        r"\|\s*elevaci[oó]n\s*=\s*([^\n\|]+)",
        r"\|\s*altura\s*=\s*([^\n\|]+)",
    ]
    for pat in alt_patterns:
        m = re.search(pat, wikitext, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            # Quitar templates {{...}}
            val = re.sub(r"\{\{.*?\}\}", "", val)
            # Extraer números
            nums = re.findall(r"[\d\s.,]+", val)
            if nums:
                n_raw = nums[0].replace(" ", "")
                # Detectar si usa punto como miles o decimal
                if n_raw.count(".") == 1 and len(n_raw.split(".")[-1]) == 3 and len(n_raw) > 4:
                    # Ej: "2.150" -> probablemente 2150 (punto de miles)
                    n_raw = n_raw.replace(".", "")
                else:
                    n_raw = n_raw.replace(",", ".")
                try:
                    alt = float(n_raw)
                    if alt > 10000:
                        alt = alt / 1000
                    result["altitud"] = alt
                except Exception:
                    pass
            break

    # --- Población ---
    # Busca: |población = 48 760, |población = {{dato|48760}}, |habitantes = 48760 hab.
    pob_patterns = [
        r"\|\s*poblaci[oó]n\s*=\s*([^\n\|]+)",
        r"\|\s*habitantes\s*=\s*([^\n\|]+)",
        r"\|\s*poblaci[oó]n_total\s*=\s*([^\n\|]+)",
    ]
    for pat in pob_patterns:
        m = re.search(pat, wikitext, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            val = re.sub(r"\{\{.*?\}\}", "", val)
            # Buscar números grandes (más de 3 dígitos = habitantes, no años)
            nums = re.findall(r"[\d\s.,]+", val)
            for num_str in nums:
                clean = num_str.replace(" ", "").replace(".", "").replace(",", "")
                try:
                    n = int(clean)
                    if n > 999:  # Evitar años como 2023
                        result["poblacion"] = n
                        break
                except Exception:
                    continue
            if result["poblacion"]:
                break

    # --- Área total ---
    # Busca: |superficie = 5.588 km², |área = 5588 km², |área_total = 5.588
    area_patterns = [
        r"\|\s*superficie\s*=\s*([^\n\|]+)",
        r"\|\s*[aá]rea_total\s*=\s*([^\n\|]+)",
        r"\|\s*[aá]rea\s*=\s*([^\n\|]+)",
    ]
    for pat in area_patterns:
        m = re.search(pat, wikitext, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            val = re.sub(r"\{\{.*?\}\}", "", val)
            nums = re.findall(r"[\d\s.,]+", val)
            for num_str in nums:
                clean = num_str.replace(" ", "")
                # Si tiene coma y punto, asumimos coma decimal
                if "," in clean and "." in clean:
                    clean = clean.replace(".", "").replace(",", ".")
                elif "," in clean:
                    clean = clean.replace(",", ".")
                try:
                    n = float(clean)
                    if n > 0.1:
                        # Si viene en m² (número enorme), convertir
                        if n > 1_000_000:
                            n = n / 1_000_000
                        result["area_total_km2"] = n
                        break
                except Exception:
                    continue
            if result["area_total_km2"]:
                break

    return result


def cargar_csv(path: Path, out_name: str) -> pd.DataFrame:
    if not path or not path.exists():
        return pd.DataFrame(columns=["nombre_norm", out_name])

    with open(path, "r", encoding="utf-8") as f:
        sample = f.read(4096)
    delim = ";" if sample.count(";") > sample.count(",") else ","

    df = pd.read_csv(path, delimiter=delim, encoding="utf-8", low_memory=False)

    mun_col = next(
        (c for c in df.columns if "municipio" in c.lower() or "nombre" in c.lower()),
        None,
    )
    val_col = next(
        (
            c
            for c in df.columns
            if any(
                k in c.lower()
                for k in ["poblacion", "total", "censo", "habitantes", "area", "urbana", "superficie"]
            )
        ),
        None,
    )

    if not mun_col or not val_col:
        raise ValueError(f"Columnas no encontradas en {path}. Tienes: {list(df.columns)}")

    df = df[[mun_col, val_col]].copy()
    df.columns = ["nombre_raw", "val_raw"]
    df["nombre_norm"] = df["nombre_raw"].astype(str).apply(normalizar)
    df[out_name] = pd.to_numeric(
        df["val_raw"].astype(str).str.replace(",", "."), errors="coerce"
    )
    return df.dropna(subset=[out_name]).drop_duplicates("nombre_norm", keep="first")[
        ["nombre_norm", out_name]
    ]


def main():
    # Leer JSON
    with open(INPUT_JSON, "rb") as f:
        raw_bytes = f.read()

    if raw_bytes.startswith(b"\xef\xbb\xbf"):
        raw_bytes = raw_bytes[3:]
    raw = raw_bytes.decode("utf-8", errors="ignore").strip()

    if not raw.startswith("["):
        raw = "[" + raw + "]"

    base = json.loads(raw)

    df = pd.DataFrame(base)
    df["nombre_norm"] = df["nombre"].apply(normalizar)
    print(f"📂 Base: {len(df)} municipios\n")

    # CSVs opcionales
    try:
        dane = (
            cargar_csv(CSV_DANE_POBLACION, "poblacion_dane")
            if CSV_DANE_POBLACION
            else pd.DataFrame(columns=["nombre_norm", "poblacion_dane"])
        )
    except Exception as e:
        print(f"⚠️ DANE: {e}")
        dane = pd.DataFrame(columns=["nombre_norm", "poblacion_dane"])

    try:
        igac = (
            cargar_csv(CSV_IGAC_AREA_URBANA, "area_urbana_km2")
            if CSV_IGAC_AREA_URBANA
            else pd.DataFrame(columns=["nombre_norm", "area_urbana_km2"])
        )
    except Exception as e:
        print(f"⚠️ IGAC: {e}")
        igac = pd.DataFrame(columns=["nombre_norm", "area_urbana_km2"])

    # Consultar Wikipedia para cada municipio
    print("⏳ Consultando Wikipedia...\n")

    altitudes = {}
    poblaciones = {}
    areas = {}

    for i, row in df.iterrows():
        nombre = row["nombre"]
        depto = row["departamento"]

        data = fetch_wikipedia_infobox(nombre, depto)

        # Logging detallado
        log_parts = [f"[{i+1:4d}/{len(df)}] {nombre} ({depto})"]
        
        if data["titulo_encontrado"]:
            log_parts.append(f"✅ Artículo: '{data['titulo_encontrado']}'")
        else:
            log_parts.append(f"❌ Sin artículo: {data['error']}")

        if data["altitud"]:
            log_parts.append(f"Alt:{data['altitud']:.0f}")
        else:
            log_parts.append("Alt:❌")

        if data["poblacion"]:
            log_parts.append(f"Pob:{data['poblacion']:,}")
        else:
            log_parts.append("Pob:❌")

        if data["area_total_km2"]:
            log_parts.append(f"Area:{data['area_total_km2']:.1f}")
        else:
            log_parts.append("Area:❌")

        print(" | ".join(log_parts))

        altitudes[i] = data["altitud"]
        poblaciones[i] = data["poblacion"]
        areas[i] = data["area_total_km2"]

        time.sleep(DELAY)

    df["altitud"] = df.index.map(altitudes)
    df["poblacion_wiki"] = df.index.map(poblaciones)
    df["area_total_km2"] = df.index.map(areas)

    # Merge CSVs
    df = df.merge(dane, on="nombre_norm", how="left")
    df = df.merge(igac, on="nombre_norm", how="left")

    # Población final: DANE > Wikipedia
    df["poblacion"] = df["poblacion_dane"].fillna(df["poblacion_wiki"])

    def fmt(val):
        if pd.isna(val) or val is None:
            return "Pendiente"
        return val

    # Construir salida
    out = []
    for _, r in df.iterrows():
        out.append(
            {
                "id": int(r["id"]) if pd.notna(r["id"]) else None,
                "nombre": r["nombre"],
                "departamento": r["departamento"],
                "lat": r["lat"],
                "lon": r["lon"],
                "altitud": fmt(r["altitud"]),
                "poblacion": int(fmt(r["poblacion"])) if r["poblacion"] != "Pendiente" and pd.notna(r["poblacion"]) else fmt(r["poblacion"]),
                "area_total_km2": fmt(r["area_total_km2"]),
                "area_urbana_km2": fmt(r["area_urbana_km2"]),
            }
        )

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"\n💾 Guardado: {OUTPUT_JSON}")
    print(f"   Con altitud:      {sum(1 for x in out if x['altitud'] != 'Pendiente')}")
    print(f"   Con poblacion:    {sum(1 for x in out if x['poblacion'] != 'Pendiente')}")
    print(f"   Con area total:   {sum(1 for x in out if x['area_total_km2'] != 'Pendiente')}")
    print(f"   Con area urbana:  {sum(1 for x in out if x['area_urbana_km2'] != 'Pendiente')}")

    print("\n📝 Muestra:")
    print(json.dumps(out[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()