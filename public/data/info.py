import json
import os
import re
import time
import requests

# ==========================================
# CONFIGURACIÓN
# ==========================================
API_KEY = "AQ.Ab8RN6IFotbM4Ki92Tf3RN7ij5gIWgg-t37I1Bt7MrwaVC15yQ"
MODELO = "gemini-3.5-flash-lite"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent?key={API_KEY}"

FILE_PATH = "sitios_turisticos.json"
BATCH_SIZE = 800  # Procesamiento seguro por lotes


def cargar_json(ruta):
    if not os.path.exists(ruta):
        print(f"Error: No se encontró el archivo '{ruta}'.")
        return []
    with open(ruta, "r", encoding="utf-8") as f:
        return json.load(f)


def guardar_json(ruta, datos):
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)


def normalizar_mayusculas(texto):
    """
    Formatea el texto con la inicial en mayúscula y el resto en minúscula.
    Mantiene palabras compuestas bien formateadas (Ej: 'Sitios Históricos', 'Ecoturismo').
    """
    if not texto:
        return "Pendiente"

    # Palabras cortas a mantener en minúscula si no están al inicio
    minusculas = {"de", "del", "la", "los", "las", "y", "e", "o", "en", "con"}
    palabras = texto.strip().split()

    palabras_formateadas = []
    for i, p in enumerate(palabras):
        palabra_clean = p.lower()
        if i > 0 and palabra_clean in minusculas:
            palabras_formateadas.append(palabra_clean)
        else:
            palabras_formateadas.append(palabra_clean.capitalize())

    return " ".join(palabras_formateadas)


def corregir_categorias_batch(lote):
    """Llama a Gemini para deducir categorías faltantes y estandarizar las existentes."""
    prompt = f"""
Eres un experto en turismo y geografía.
Analiza la siguiente lista de sitios turísticos y ajusta el campo "categoria" de cada uno siguiendo estas reglas:

1. Si la categoría actual dice "sin información", "sin informacion", está vacía o no es clara:
   - DEDUCE una categoría turística precisa y real basada en el "nombre" del sitio (Ej: "Cascadas", "Miradores", "Parques Naturales", "Museos y Cultura", "Playas", "Sitios Históricos", "Ecoturismo", "Iglesias y Religión").
2. Si ya tiene una categoría asignada:
   - Mantén el concepto pero estandarízalo al formato Title Case (Inicial en mayúscula y resto en minúscula).
3. Devuelve CADA categoría en formato "Tipo Título" con la primera letra en mayúscula.

REGLAS ESTRICTAS:
- Conserva el identificador único de cada sitio ("id" o "nombre") para mapear los resultados.
- Devuelve la respuesta ÚNICAMENTE como un arreglo JSON con los campos: "id_o_nombre" y "categoria".

Lista a analizar:
{json.dumps(lote, ensure_ascii=False)}
"""

    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }

    response = requests.post(URL, headers=headers, json=payload)
    response.raise_for_status()
    data = response.json()
    texto_respuesta = data["candidates"][0]["content"]["parts"][0]["text"]
    return json.loads(texto_respuesta)


def corregir_y_uniformar_categorias():
    sitios = cargar_json(FILE_PATH)
    if not sitios:
        return

    total = len(sitios)
    print(
        f"Iniciando corrección de categorías para {total} sitios turísticos..."
    )

    # Indizado por ID o Nombre para actualización in-place
    mapa_sitios = {}
    for idx, s in enumerate(sitios):
        clave = str(s.get("id", s.get("nombre", f"pos_{idx}")))
        mapa_sitios[clave] = s

    for i in range(0, total, BATCH_SIZE):
        lote_original = sitios[i : i + BATCH_SIZE]
        num_lote = (i // BATCH_SIZE) + 1

        lote_para_ia = []
        for idx, s in enumerate(lote_original):
            clave = str(s.get("id", s.get("nombre", f"pos_{i + idx}")))
            lote_para_ia.append(
                {
                    "id_o_nombre": clave,
                    "nombre": s.get("nombre", ""),
                    "categoria": s.get("categoria", s.get("categorias", "")),
                }
            )

        print(
            f"Procesando lote #{num_lote} ({i + 1} a {min(i + BATCH_SIZE, total)} de {total})..."
        )

        try:
            resultados = corregir_categorias_batch(lote_para_ia)

            for item in resultados:
                clave = str(item.get("id_o_nombre", ""))
                cat_nueva = item.get("categoria", "")

                if clave in mapa_sitios and cat_nueva:
                    # Formateo estricto de mayúsculas/minúsculas en Python
                    cat_normalizada = normalizar_mayusculas(cat_nueva)

                    # Si el JSON original usa 'categoria' o 'categorias'
                    if "categoria" in mapa_sitios[clave]:
                        mapa_sitios[clave]["categoria"] = cat_normalizada
                    elif "categorias" in mapa_sitios[clave]:
                        mapa_sitios[clave]["categorias"] = cat_normalizada
                    else:
                        mapa_sitios[clave]["categoria"] = cat_normalizada

            # Sobrescribir archivo original con avance del lote
            guardar_json(FILE_PATH, sitios)
            print(
                f"  └─ Lote #{num_lote} procesado y guardado en '{FILE_PATH}'."
            )

        except Exception as e:
            print(f"Error procesando lote #{num_lote}: {e}")
            break

        time.sleep(1)

    print("\n==================================================")
    print(f"PROCESO FINALIZADO: '{FILE_PATH}' SOBREESCRITO")
    print("==================================================")
    print(f"• Total de sitios procesados: {total}")
    print(
        "• Categorías 'sin información' reemplazadas según el nombre del sitio."
    )
    print("• Formato de mayúsculas/minúsculas uniformado correctamente.")


if __name__ == "__main__":
    corregir_y_uniformar_categorias()