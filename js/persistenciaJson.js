/**
 * persistenciaJson.js
 * ---------------------------------------------------------------------------
 * Guardado de los JSON de datos en local, SIN ventanas ni descargas:
 *  - Si la app se sirve con Vite (plugin simbiosis-api-local, que expone
 *    POST /api/catalogo), escribe directamente en data/<archivo>.json
 *    (el archivo real del proyecto).
 *  - Si no hay servidor de guardado (p. ej. un servidor de producción estático),
 *    guarda una copia en el almacenamiento privado del navegador (OPFS), que
 *    se conserva entre sesiones y se usa al cargar.
 * ---------------------------------------------------------------------------
 */
const PersistenciaJsonModule = (() => {

  const ARCHIVOS = {
    puertos: 'puertos_colombia.json',
    aeropuertos: 'aeropuertos_colombia.json',
    municipios: 'municipios.json',
    departamentos: 'departamentos.json',
    sitios: 'sitios_turisticos.json',
    frontera: 'sitios_turisticos_frontera.json',
  };

  // -------------------------------------------------------------------
  // Guardado por servidor (Vite plugin simbiosis-api-local): POST /api/catalogo
  // -------------------------------------------------------------------

  async function _guardarPorServidor(clave, datos) {
    try {
      const res = await fetch('/api/catalogo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clave, datos }),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  // -------------------------------------------------------------------
  // Respaldo local sin ventanas: OPFS (almacenamiento privado del navegador)
  // -------------------------------------------------------------------

  async function _escribirOPFS(archivo, datos) {
    try {
      const dir = await navigator.storage.getDirectory();
      const sub = await dir.getDirectoryHandle('data', { create: true });
      const fh = await sub.getFileHandle(archivo, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ guardadoEn: Date.now(), datos }, null, 2));
      await w.close();
      return true;
    } catch (err) {
      console.warn('[JSON] No se pudo guardar la copia local:', err);
      return false;
    }
  }

  /** Devuelve los datos guardados en el navegador (OPFS) para una clave o null. */
  async function leerJson(clave) {
    const archivo = ARCHIVOS[clave];
    if (!archivo) return null;
    try {
      const dir = await navigator.storage.getDirectory();
      const sub = await dir.getDirectoryHandle('data');
      const fh = await sub.getFileHandle(archivo);
      const f = await fh.getFile();
      const datos = JSON.parse(await f.text());
      return Array.isArray(datos) ? datos : (datos && datos.datos) || null;
    } catch (err) {
      return null;
    }
  }

  // -------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------

  /** Guarda un catálogo: primero intenta escribir el archivo real vía el
   *  servidor (Vite plugin API) y, si no es posible, guarda en el navegador
   *  (OPFS). Devuelve true si se pudo guardar, false en caso contrario. */
  async function guardarJson(clave, datos) {
    const archivo = ARCHIVOS[clave];
    if (!archivo) return false;
    let ok = await _guardarPorServidor(clave, datos);
    if (!ok) ok = await _escribirOPFS(archivo, datos);
    return ok;
  }

  // Puertos: envoltorios que conservan la API previa.
  async function guardarPuertos(puertos) { return guardarJson('puertos', puertos); }
  async function leerPuertosGuardados() { return leerJson('puertos'); }

  return { guardarJson, leerJson, guardarPuertos, leerPuertosGuardados };
})();
