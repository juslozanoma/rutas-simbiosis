/**
 * routeWarnings.js
 * ---------------------------------------------------------------------------
 * Evalúa si la ruta calculada pasa por tramos viales peligrosos o en mal
 * estado definidos en data/rutas_riesgosas.json y expone funciones para
 * consultar las advertencias y sus posiciones en el mapa.
 *
 * Las rutas personalizadas agregadas por el usuario se persisten en el
 * propio archivo JSON a través del endpoint POST /guardar-rutas del
 * servidor local (server.py).
 * ---------------------------------------------------------------------------
 */
const RouteWarningsModule = (() => {
  let _rutas = [];

  async function cargar() {
    try {
      const res = await fetch('data/rutas_riesgosas.json');
      if (res.ok) _rutas = await res.json();
    } catch {
      _rutas = [];
    }
  }

  function getRutas() {
    return _rutas;
  }

  /**
   * Envía el array completo de rutas al servidor para que lo persista
   * en data/rutas_riesgosas.json.
   */
  async function guardarEnArchivo(rutas) {
    const res = await fetch('/guardar-rutas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rutas),
    });
    if (!res.ok) throw new Error('Error al guardar: ' + res.status);
    _rutas = rutas;
  }

  /**
   * Agrega una ruta personalizada y la persiste en el archivo JSON.
   */
  async function agregarPersonalizada(ruta) {
    const nuevas = [..._rutas, ruta];
    await guardarEnArchivo(nuevas);
  }

  /**
   * Elimina una ruta personalizada por id y persiste el cambio.
   */
  async function eliminarPersonalizada(id) {
    const filtradas = _rutas.filter((r) => r.id !== id);
    await guardarEnArchivo(filtradas);
  }

  /**
   * Devuelve el JSON actual como string (para exportar/descargar).
   */
  function exportarJSON() {
    return JSON.stringify(_rutas, null, 2);
  }

  /**
   * Verifica si la ruta pasa cerca de algún tramo peligroso usando
   * buffer geográfico: se crea un polígono de 10 km alrededor de cada
   * segmento peligroso y se comprueba si la ruta lo interseca.
   *
   * @param {object} geojsonLineString - GeoJSON Feature con geometry LineString
   * @param {number} totalKm - distancia total de la ruta
   * @returns {Array<{id:string, lnglat:[number,number], mensaje:string, tipo:string, color:string}>}
   */
  function verificar(geojsonLineString, totalKm) {
    if (!geojsonLineString || !geojsonLineString.geometry) return [];
    const coords = geojsonLineString.geometry.coordinates;
    if (!coords || coords.length < 2) return [];

    const routeLine = turf.lineString(coords);
    const warnings = [];

    for (const ruta of _rutas) {
      if (ruta.distanciaMinimaKm != null && totalKm < ruta.distanciaMinimaKm) continue;

      const dangerLine = turf.lineString(ruta.coordenadas);
      const buffer = turf.buffer(dangerLine, 10, { units: 'kilometers' });
      if (!buffer) continue;

      if (turf.booleanIntersects(buffer, routeLine)) {
        // Encontrar el punto de la ruta más cercano al centro del segmento peligroso
        const mid = turf.midpoint(
          turf.point(ruta.coordenadas[0]),
          turf.point(ruta.coordenadas[ruta.coordenadas.length - 1]),
        );
        const nearest = turf.nearestPointOnLine(routeLine, mid, { units: 'kilometers' });

        warnings.push({
          id: ruta.id,
          lnglat: nearest.geometry.coordinates,
          mensaje: ruta.mensaje || 'Tramo peligroso',
          tipo: ruta.tipo || 'peligro',
          color: ruta.color || '#e5a000',
        });
      }
    }

    return warnings;
  }

  return { cargar, getRutas, agregarPersonalizada, eliminarPersonalizada, exportarJSON, verificar };
})();