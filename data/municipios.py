#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Enriquece municipios.json con:
  - altitud         : msnm (infobox Wikipedia)
  - poblacion       : habitantes (infobox Wikipedia, o DANE CSV)
  - area_total_km2  : km² total (infobox Wikipedia)
  - area_urbana_km2 : km² urbano (IGAC CSV)

Guarda progreso cada 20 municipios. Si se corta, reanuda desde donde quedó.

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
PROGRESS_JSON = Path("municipios_progreso.json")  # <-- NUEVO: archivo temporal

CSV_DANE_POBLACION = None
CSV_IGAC_AREA_URBANA = None

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ColombiaMunicipiosBot/1.0)",
    "Accept": "application/json",
}
DELAY = 0.6
GUARDAR_CADA = 20  # <-- NUEVO: cada cuántos municipios guarda


def normalizar(t: str) -> str:
    t = t.lower().strip()
    t = unicodedata.normalize("NFKD", t).encode("ASCII", "ignore").decode("utf-8")
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def quitar_templates(texto: str) -> str:
    prev = ""
    while prev != texto:
        prev = texto
        texto = re.sub(r"\{\{[^{}]*?\}\}", "", texto)
    return texto.strip()


def extraer_parametro_infobox(wikitext: str, nombres_param: list) -> str | None:
    wikitext = wikitext.replace("\r\n", "\n").replace("\r", "\n")
    for nombre in nombres_param:
        patron = rf"\|\s*{re.escape(nombre)}\s*=\s*(.*?)(?=\n\s*\||\n\s*\}}\}}|$)"
        m = re.search(patron, wikitext, re.IGNORECASE | re.DOTALL)
        if m:
            valor = m.group(1).strip()
            valor = quitar_templates(valor)
            valor = re.sub(r"<ref.*?>.*?</ref>", "", valor, flags=re.DOTALL)
            valor = re.sub(r"<ref.*?/>", "", valor)
            valor = re.sub(r"\[\[([^|\]]*\|)?([^\]]+)\]\]", r"\2", valor)
            valor = re.sub(r"''+", "", valor)
            valor = valor.strip()
            if valor:
                return valor
    return None


def fetch_wikipedia_infobox(nombre: str, departamento: str):
    result = {
        "altitud": None,
        "poblacion": None,
        "area_total_km2": None,
        "titulo_encontrado": None,
        "error": None,
    }

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

    # Altitud
    val = extraer_parametro_infobox(wikitext, ["altitud", "elevación", "elevacion", "altura", "altitud_msnm"])
    if val:
        nums = re.findall(r"[\d\s.,]+", val)
        if nums:
            n_raw = nums[0].replace(" ", "")
            if n_raw.count(".") == 1 and len(n_raw.split(".")[-1]) == 3 and len(n_raw) > 4:
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

    # Población
    val = extraer_parametro_infobox(wikitext, [
        "población", "poblacion", "habitantes", "población_total",
        "poblacion_total", "población censo", "poblacion censo"
    ])
    if val:
        nums = re.findall(r"[\d\s.,]+", val)
        for num_str in nums:
            clean = num_str.replace(" ", "").replace(".", "").replace(",", "")
            try:
                n = int(clean)
                if n > 999:
                    result["poblacion"] = n
                    break
            except Exception:
                continue

    # Área total
    val = extraer_parametro_infobox(wikitext, [
        "superficie", "superficie_total", "área", "area",
        "área_total", "area_total", "superficie_km2", "area_km2"
    ])
    if val:
        nums = re.findall(r"[\d\s.,]+", val)
        for num_str in nums:
            clean = num_str.replace(" ", "")
            if "," in clean and "." in clean:
                clean = clean.replace(".", "").replace(",", ".")
            elif "," in clean:
                clean = clean.replace(",", ".")
            try:
                n = float(clean)
                if n > 0.1:
                    if n > 1_000_000:
                        n = n / 1_000_000
                    result["area_total_km2"] = n
                    break
            except Exception:
                continue

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


def guardar_progreso(out: list, path: Path):  # <-- NUEVO función
    """Guarda el JSON parcial en disco."""
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"   💾 Progreso guardado: {len(out)} municipios -> {path}")


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
    total = len(df)
    print(f"📂 Base: {total} municipios\n")

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

    # <-- NUEVO: Reanudar si existe progreso previo
    out = []
    start_idx = 0
    if PROGRESS_JSON.exists():
        try:
            with open(PROGRESS_JSON, "r", encoding="utf-8") as f:
                out = json.load(f)
            start_idx = len(out)
            print(f"🔄 Reanudando desde municipio {start_idx + 1} (progreso previo encontrado)\n")
        except Exception:
            out = []

    # Consultar Wikipedia
    print("⏳ Consultando Wikipedia...\n")

    altitudes = {}
    poblaciones = {}
    areas = {}

    for i in range(start_idx, total):  # <-- NUEVO: empieza desde start_idx
        row = df.iloc[i]
        nombre = row["nombre"]
        depto = row["departamento"]

        data = fetch_wikipedia_infobox(nombre, depto)

        log_parts = [f"[{i+1:4d}/{total}] {nombre} ({depto})"]

        if data["titulo_encontrado"]:
            log_parts.append(f"✅ '{data['titulo_encontrado']}'")
        else:
            log_parts.append(f"❌ {data['error']}")

        log_parts.append(f"Alt:{data['altitud'] or '❌'}")
        log_parts.append(f"Pob:{data['poblacion'] or '❌'}")
        log_parts.append(f"Area:{data['area_total_km2'] or '❌'}")

        print(" | ".join(str(p) for p in log_parts))

        altitudes[i] = data["altitud"]
        poblaciones[i] = data["poblacion"]
        areas[i] = data["area_total_km2"]

        # <-- NUEVO: Guardar progreso cada 20 municipios
        if (i + 1) % GUARDAR_CADA == 0:
            # Construir lo que llevamos hasta ahora
            temp_df = df.iloc[:i+1].copy()
            temp_df["altitud"] = temp_df.index.map(altitudes)
            temp_df["poblacion_wiki"] = temp_df.index.map(poblaciones)
            temp_df["area_total_km2"] = temp_df.index.map(areas)

            temp_df = temp_df.merge(dane, on="nombre_norm", how="left")
            temp_df = temp_df.merge(igac, on="nombre_norm", how="left")
            temp_df["poblacion"] = temp_df["poblacion_dane"].fillna(temp_df["poblacion_wiki"])

            def fmt(val):
                if pd.isna(val) or val is None:
                    return "Pendiente"
                return val

            out = []
            for _, r in temp_df.iterrows():
                out.append({
                    "id": int(r["id"]) if pd.notna(r["id"]) else None,
                    "nombre": r["nombre"],
                    "departamento": r["departamento"],
                    "lat": r["lat"],
                    "lon": r["lon"],
                    "altitud": fmt(r["altitud"]),
                    "poblacion": int(fmt(r["poblacion"])) if r["poblacion"] != "Pendiente" and pd.notna(r["poblacion"]) else fmt(r["poblacion"]),
                    "area_total_km2": fmt(r["area_total_km2"]),
                    "area_urbana_km2": fmt(r["area_urbana_km2"]),
                })

            guardar_progreso(out, PROGRESS_JSON)

        time.sleep(DELAY)

    # Guardado final (últimos que quedaron si no son múltiplo de 20)
    print("\n🏁 Finalizando y guardando resultado completo...")

    df["altitud"] = df.index.map(altitudes)
    df["poblacion_wiki"] = df.index.map(poblaciones)
    df["area_total_km2"] = df.index.map(areas)

    df = df.merge(dane, on="nombre_norm", how="left")
    df = df.merge(igac, on="nombre_norm", how="left")
    df["poblacion"] = df["poblacion_dane"].fillna(df["poblacion_wiki"])

    def fmt(val):
        if pd.isna(val) or val is None:
            return "Pendiente"
        return val

    out = []
    for _, r in df.iterrows():
        out.append({
            "id": int(r["id"]) if pd.notna(r["id"]) else None,
            "nombre": r["nombre"],
            "departamento": r["departamento"],
            "lat": r["lat"],
            "lon": r["lon"],
            "altitud": fmt(r["altitud"]),
            "poblacion": int(fmt(r["poblacion"])) if r["poblacion"] != "Pendiente" and pd.notna(r["poblacion"]) else fmt(r["poblacion"]),
            "area_total_km2": fmt(r["area_total_km2"]),
            "area_urbana_km2": fmt(r["area_urbana_km2"]),
        })

    with open(OUTPUT_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    # Borrar progreso temporal si todo salió bien
    if PROGRESS_JSON.exists():
        PROGRESS_JSON.unlink()
        print(f"🗑️  Progreso temporal borrado.")

    print(f"\n💾 Guardado final: {OUTPUT_JSON}")
    print(f"   Con altitud:      {sum(1 for x in out if x['altitud'] != 'Pendiente')}")
    print(f"   Con poblacion:    {sum(1 for x in out if x['poblacion'] != 'Pendiente')}")
    print(f"   Con area total:   {sum(1 for x in out if x['area_total_km2'] != 'Pendiente')}")
    print(f"   Con area urbana:  {sum(1 for x in out if x['area_urbana_km2'] != 'Pendiente')}")

    print("\n📝 Muestra:")
    print(json.dumps(out[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()