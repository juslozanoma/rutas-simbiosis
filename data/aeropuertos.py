import json
import os
import time
import requests

# ==========================================
# CONFIGURACIÓN DEL USUARIO
# ==========================================
API_KEY = "AQ.Ab8RN6IFotbM4Ki92Tf3RN7ij5gIWgg-t37I1Bt7MrwaVC15yQ"
MODELO = "gemini-3.5-flash-lite"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent?key={API_KEY}"

INPUT_FILE = "aeropuertos_colombia.json"
OUTPUT_FILE = "aeropuertos_colombia_procesados.json"
BATCH_SIZE = 10


def cargar_datos(ruta_archivo):
    """Carga el JSON original de aeropuertos."""
    with open(ruta_archivo, "r", encoding="utf-8") as f:
        return json.load(f)


def guardar_datos(ruta_archivo, datos):
    """Guarda/actualiza el archivo JSON resultante."""
    with open(ruta_archivo, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)


def procesar_lote_con_gemini(lote):
    """Envía un lote de 10 aeropuertos mediante petición REST con requests."""

    prompt = f"""
Eres un experto en datos aeronáuticos. Procesa el siguiente lote de {len(lote)} aeropuertos.

Para cada aeropuerto recibido en el lote, genera una estructura JSON limpia con ÚNICAMENTE estos campos:
- "id": El identificador único del aeropuerto (utiliza el ID o IATA original como string).
- "nombre": El nombre oficial del aeropuerto.
- "latitud": Coordenada de latitud como número flotante.
- "longitud": Coordenada de longitud como número flotante.
- "destinos_id": Una lista (array de strings) con los IDs de los aeropuertos hacia donde existen rutas/destinos desde este aeropuerto.

REGLAS ESTRICTAS:
1. ELIMINA por completo los campos "ciudad de origen", "ciudad de destino" y el campo "IATA" como propiedad independiente.
2. Devuelve ÚNICAMENTE un arreglo JSON válido conteniendo exactamente los {len(lote)} objetos transformados. No agregues texto explicativo ni formato Markdown adicional.

Lote a procesar:
{json.dumps(lote, ensure_ascii=False)}
"""

    headers = {"Content-Type": "application/json"}

    # Payload estructurado para la API de Gemini
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
        },
    }

    # Petición HTTP POST
    response = requests.post(URL, headers=headers, json=payload)
    response.raise_for_status()  # Detecta si hubo error en la petición HTTP

    data = response.json()

    # Extracción del texto en la estructura de respuesta REST
    texto_respuesta = data["candidates"][0]["content"]["parts"][0]["text"]

    return json.loads(texto_respuesta)


def main():
    if not os.path.exists(INPUT_FILE):
        print(f"Error: No se encontró el archivo '{INPUT_FILE}'.")
        return

    aeropuertos_origen = cargar_datos(INPUT_FILE)
    aeropuertos_procesados = []

    # Si ya existe avance previo, reanuda desde el último punto guardado
    if os.path.exists(OUTPUT_FILE):
        try:
            aeropuertos_procesados = cargar_datos(OUTPUT_FILE)
            print(
                f"Reanudando progreso: ya hay {len(aeropuertos_procesados)} aeropuertos guardados."
            )
        except Exception:
            aeropuertos_procesados = []

    total = len(aeropuertos_origen)
    inicio = len(aeropuertos_procesados)

    print(
        f"Iniciando proceso: {total} aeropuertos en total (Lotes de {BATCH_SIZE})...\n"
    )

    for i in range(inicio, total, BATCH_SIZE):
        lote = aeropuertos_origen[i : i + BATCH_SIZE]
        num_lote = (i // BATCH_SIZE) + 1
        print(
            f"Procesando Lote #{num_lote} (Aeropuertos del {i + 1} al {min(i + BATCH_SIZE, total)} de {total})..."
        )

        try:
            lote_transformado = procesar_lote_con_gemini(lote)
            aeropuertos_procesados.extend(lote_transformado)

            # Guarda en disco inmediatamente tras cada lote de 10
            guardar_datos(OUTPUT_FILE, aeropuertos_procesados)
            print(
                f"  └─ Lote #{num_lote} procesado y guardado correctamente."
            )

        except Exception as e:
            print(f"Error procesando el lote #{num_lote}: {e}")
            print(
                "El progreso actual fue conservado en el archivo JSON de salida."
            )
            break

        # Pausa ligera para evitar exceder límites de peticiones
        time.sleep(1)

    print(
        f"\n¡Proceso finalizado con éxito! Datos guardados en '{OUTPUT_FILE}'."
    )


if __name__ == "__main__":
    main()