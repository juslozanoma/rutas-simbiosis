/**
 * persistenciaJson.js
 * ---------------------------------------------------------------------------
 * Guardado de los JSON de datos en local: usa la API File System Access
 * (Chrome/Edge) para sobrescribir el archivo elegido por el usuario; si no
 * está disponible o falla, descarga una copia del archivo modificado.
 * ---------------------------------------------------------------------------
 */
const PersistenciaJsonModule = (() => {

  let _archivoHandle = null;

  /** Sobrescribe el JSON de puertos fluviales con los datos dados.
   *  Devuelve: true = guardado en el archivo original, false = se descargó
   *  una copia, null = el usuario canceló el selector de archivo. */
  async function guardarPuertos(puertos) {
    return guardarTexto('data/puertos_fluviales_colombia.json', JSON.stringify(puertos, null, 2));
  }

  /** Sobrescribe (o descarga como copia) un archivo de texto. */
  async function guardarTexto(nombreSugerido, texto) {
    if (window.showOpenFilePicker) {
      try {
        if (!_archivoHandle) {
          const [h] = await window.showOpenFilePicker({
            description: 'Selecciona el JSON a sobrescribir',
            types: [{ description: 'Archivo JSON', accept: { 'application/json': ['.json'] } }],
            multiple: false,
          });
          _archivoHandle = h;
        }
        const writable = await _archivoHandle.createWritable();
        await writable.write(texto);
        await writable.close();
        return true;
      } catch (err) {
        if (err && err.name === 'AbortError') return null; // cancelado por el usuario
        _archivoHandle = null;
        console.warn('[JSON] No se pudo escribir el archivo, se descargará una copia:', err);
      }
    }
    _descargar(nombreSugerido, texto);
    return false;
  }

  function _descargar(nombre, texto) {
    const blob = new Blob([texto], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { guardarPuertos, guardarTexto };
})();
