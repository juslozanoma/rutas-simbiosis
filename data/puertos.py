import json
import os
import time
import requests

# ==========================================
# CONFIGURACIÓN
# ==========================================
API_KEY = "AQ.Ab8RN6IFotbM4Ki92Tf3RN7ij5gIWgg-t37I1Bt7MrwaVC15yQ"
MODELO = "gemini-3.5-flash-lite"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent?key={API_KEY}"

# Archivo de entrada que será modificado y sobrescrito directamente
FILE_PATH = "puertos_colombia.json"
BATCH_SIZE = 80


def cargar_json(ruta):
    if not os.path.exists(ruta):
        print(f"Error: No se encontró el archivo '{ruta}'.")
        return []
    with open(ruta, "r", encoding="utf-8") as f:
        return json.load(f)


def guardar_json(ruta, datos):
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)


def llamar_gemini_corregir(lote_datos):
    """Envía un lote de datos a la IA para analizar y corregir únicamente los 4 campos solicitados."""
    prompt = f"""
Eres un experto en geografía e infraestructura portuaria de Colombia.
Tu tarea es EXCLUSIVAMENTE analizar y corregir 4 campos de los siguientes registros de puertos:

Campos a corregir/ajustar por cada puerto:
1. "ciudad": Analiza el nombre del puerto y sus coordenadas (latitud/longitud). Si encuentras o deduces el municipio y departamento real, ponlo en formato "Municipio (Departamento)" (Ej: "Puerto Berrío (Antioquia)"). Si la ciudad no está clara, no coincide o no existe un municipio definido, coloca estrictamente "PENDIENTE".
2. "rio": Nombre oficial y correcto del río, mar o cuerpo de agua (Ej: "Río Magdalena", "Río Atrato", "Mar Caribe").
3. "ubicacion": Descripción geográfica precisa de EXACTAMENTE 2 RENGLONES sobre la posición del puerto.
4. "descripcion": Reseña funcional de EXACTAMENTE 4 RENGLONES sobre la importancia comercial, de pasajeros o carga del puerto.

REGLAS ESTRUCTURALES ESTRICTAS:
- Mantén el "id" recibido intacto para poder mapear la respuesta.
- Devuelve un arreglo JSON con exactamente la misma cantidad de elementos recibidos.
- NO devuelvas ni alteres otros campos (nombre, latitud, longitud, destinos_id no deben ser incluidos en la respuesta ni modificados).

Lote a analizar:
{json.dumps(lote_datos, ensure_ascii=False)}
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


def corregir_y_sobrescribir():
    puertos = cargar_json(FILE_PATH)
    if not puertos:
        return

    total = len(puertos)
    print(
        f"Iniciando corrección in-place. Se sobrescribirá '{FILE_PATH}' ({total} registros)..."
    )

    # Indizado rápido por ID para hacer los cambios sobre la lista original
    mapa_puertos = {p["id"]: p for p in puertos}

    for i in range(0, total, BATCH_SIZE):
        lote_original = puertos[i : i + BATCH_SIZE]
        num_lote = (i // BATCH_SIZE) + 1

        lote_para_ia = [
            {
                "id": p.get("id"),
                "nombre": p.get("nombre"),
                "ciudad": p.get("ciudad"),
                "rio": p.get("rio"),
                "latitud": p.get("latitud"),
                "longitud": p.get("longitud"),
                "ubicacion": p.get("ubicacion"),
                "descripcion": p.get("descripcion"),
            }
            for p in lote_original
        ]

        print(
            f"Procesando lote #{num_lote} ({i + 1} a {min(i + BATCH_SIZE, total)} de {total})..."
        )

        try:
            resultados_corregidos = llamar_gemini_corregir(lote_para_ia)

            # Reemplazar ÚNICAMENTE los 4 campos en el objeto existente
            for item in resultados_corregidos:
                pid = item.get("id")
                if pid in mapa_puertos:
                    mapa_puertos[pid]["ciudad"] = item.get(
                        "ciudad", "PENDIENTE"
                    )
                    mapa_puertos[pid]["rio"] = item.get("rio", "")
                    mapa_puertos[pid]["ubicacion"] = item.get(
                        "ubicacion", ""
                    )
                    mapa_puertos[pid]["descripcion"] = item.get(
                        "descripcion", ""
                    )

            # Sobrescribir el archivo original tras procesar el lote
            guardar_json(FILE_PATH, puertos)
            print(
                f"  └─ Lote #{num_lote} guardado y sobrescrito en '{FILE_PATH}'."
            )

        except Exception as e:
            print(f"Error procesando lote #{num_lote}: {e}")
            break

        time.sleep(1)

    print("\n==================================================")
    print(f"PROCESO FINALIZADO: '{FILE_PATH}' HA SIDO SOBREESCRITO")
    print("==================================================")
    print(
        f"• Se conservaron intactos los {len(puertos)} registros (sin borrados ni adiciones)."
    )
    print(
        "• Solo se actualizaron los campos: ciudad, rio, ubicacion y descripcion."
    )


if __name__ == "__main__":
    corregir_y_sobrescribir()