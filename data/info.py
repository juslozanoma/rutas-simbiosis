import json
import os
import requests

# ==========================================
# CONFIGURACIÓN
# ==========================================
API_KEY = "AQ.Ab8RN6IFotbM4Ki92Tf3RN7ij5gIWgg-t37I1Bt7MrwaVC15yQ"
MODELO = "gemini-3.5-flash-lite"
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODELO}:generateContent?key={API_KEY}"

FILE_PATH = "departamentos.json"


def cargar_json(ruta):
    if not os.path.exists(ruta):
        print(f"Error: No se encontró el archivo '{ruta}'.")
        return []
    with open(ruta, "r", encoding="utf-8") as f:
        return json.load(f)


def guardar_json(ruta, datos):
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, indent=2)


def actualizar_departamentos(departamentos):
    """Envia todos los departamentos a la IA para obtener 'año_fundacion' y la 'descripcion' corregida."""
    
    # Extraemos solo el nombre y capital para dar contexto ligero a la IA
    datos_envio = [
        {"nombre": d.get("nombre"), "capital": d.get("capital")} 
        for d in departamentos
    ]

    prompt = f"""
Eres un historiador y geógrafo experto en Colombia.
Analiza la siguiente lista de departamentos de Colombia y genera para cada uno la información a NIVEL DEPARTAMENTAL (NO de la ciudad capital):

1. "nombre": Debe ser EXACTAMENTE el mismo nombre del departamento recibido.
2. "año_fundacion": Año oficial de creación/constitución del DEPARTAMENTO (como departamento o estado soberano antecedente). Debe ser un número entero.
3. "descripcion": Redacta UN SOLO PÁRRAFO FLUIDO que describa a TODO EL DEPARTAMENTO (no solo a su capital) integrando:
   - Su historia de conformación o relevancia territorial.
   - Su identidad cultural y tradiciones regionales.
   - Los motores principales de su economía (agricultura, industria, minería, turismo, etc.).

REGLAS ESTRICTAS:
- No hables únicamente de la capital; la descripción debe abarcar todo el territorio departamental.
- Devuelve la respuesta ÚNICAMENTE como un arreglo JSON.

Lista de departamentos a procesar:
{json.dumps(datos_envio, ensure_ascii=False)}
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


def main():
    departamentos = cargar_json(FILE_PATH)
    if not departamentos:
        return

    print(f"Cargados {len(departamentos)} departamentos. Enviando a la IA...")

    try:
        respuestas_ia = actualizar_departamentos(departamentos)

        # Mapeamos los resultados por el campo "nombre"
        mapa_ia = {item["nombre"]: item for item in respuestas_ia if "nombre" in item}

        actualizados = 0
        for dep in departamentos:
            nombre = dep.get("nombre")
            if nombre in mapa_ia:
                info_nueva = mapa_ia[nombre]

                # Asignar año de fundación (preserva como entero)
                dep["año_fundacion"] = info_nueva.get("año_fundacion")

                # Asignar nueva descripción de todo el departamento
                dep["descripcion"] = info_nueva.get("descripcion", dep.get("descripcion"))

                actualizados += 1

        # Sobrescribir el archivo original directamente
        guardar_json(FILE_PATH, departamentos)

        print("\n==================================================")
        print(f"PROCESO FINALIZADO: '{FILE_PATH}' SOBREESCRITO")
        print("==================================================")
        print(f"• Registros actualizados exitosamente: {actualizados} de {len(departamentos)}.")
        print("• Campos añadidos/corregidos: 'año_fundacion' y 'descripcion' (a nivel departamental).")
        print("• Campos conservados intactos: 'capital', 'latitud', 'longitud'.")

    except Exception as e:
        print(f"Error durante el proceso: {e}")


if __name__ == "__main__":
    main()