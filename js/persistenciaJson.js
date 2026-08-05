/**
 * persistenciaJson.js
 * ---------------------------------------------------------------------------
 * Guardado de los JSON de datos en local, SIN ventanas ni descargas:
 *  - Si la app se sirve con server.js (que expone POST /api/puertos), escribe
 *    directamente en data/puertos_colombia.json (el archivo real del proyecto).
 *  - Si no hay servidor de guardado (p. ej. Live Server), guarda una copia en
 *    el almacenamiento privado del navegador (OPFS), que se conserva entre
 *    sesiones y se usa al cargar. Cero selectores, cero descargas.
 * ---------------------------------------------------------------------------
 */
const PersistenciaJsonModule = (() => {

  const RUTA_PUERTOS = 'data/puertos_colombia.json';

  // -------------------------------------------------------------------
  // Guardado por servidor (server.js): POST /api/puertos
  // -------------------------------------------------------------------

  async function _guardarPorServidor(puertos) {
    try {
      const res = await fetch('/api/puertos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(puertos),
      });
      return res.ok;
    } catch (err) {
      return false;
    }
  }

  // -------------------------------------------------------------------
  // Respaldo local sin ventanas: OPFS (almacenamiento privado del navegador)
  // -------------------------------------------------------------------

  async function _escribirOPFS(puertos) {
    try {
      const dir = await navigator.storage.getDirectory();
      const sub = await dir.getDirectoryHandle('data', { create: true });
      const fh = await sub.getFileHandle('puertos_colombia.json', { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify({ guardadoEn: Date.now(), puertos }, null, 2));
      await w.close();
      return true;
    } catch (err) {
      console.warn('[JSON] No se pudo guardar la copia local:', err);
      return false;
    }
  }

  /** Devuelve los puertos guardados en el navegador (OPFS) o null si no hay. */
  async function leerPuertosGuardados() {
    try {
      const dir = await navigator.storage.getDirectory();
      const sub = await dir.getDirectoryHandle('data');
      const fh = await sub.getFileHandle('puertos_colombia.json');
      const f = await fh.getFile();
      const datos = JSON.parse(await f.text());
      return Array.isArray(datos) ? datos : (datos && datos.puertos) || null;
    } catch (err) {
      return null;
    }
  }

  // -------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------

  /** Guarda los puertos: primero intenta escribir el archivo real vía el
   *  servidor (server.js) y, si no es posible, guarda en el navegador (OPFS).
   *  Nunca abre selectores ni descarga archivos. No recarga la página (la
   *  recarga solo se dispara desde el servidor cuando cambian .html o .js).
   *  Devuelve true si se pudo guardar, false en caso contrario. */
  async function guardarPuertos(puertos) {
    let ok = await _guardarPorServidor(puertos);
    if (!ok) ok = await _escribirOPFS(puertos);
    return ok;
  }

  return { guardarPuertos, leerPuertosGuardados };
})();
