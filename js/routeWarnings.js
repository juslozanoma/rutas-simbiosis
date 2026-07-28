/**
 * routeWarnings.js
 * ---------------------------------------------------------------------------
 * Evalúa si la ruta calculada pasa por tramos viales peligrosos o en mal
 * estado definidos en data/rutas_riesgosas.json y expone funciones para
 * consultar las advertencias y sus posiciones en el mapa.
 *
 * También gestiona rutas personalizadas agregadas por el usuario, que se
 * persisten en localStorage y se combinan con las del archivo JSON.
 * ---------------------------------------------------------------------------
 */
const RouteWarningsModule = (() => {
  const STORAGE_KEY = 'rutas_riesgosas_personalizadas';
  let _rutas = [];
  let _desdeArchivo = [];

  async function cargar() {
    try {
      const res = await fetch('data/rutas_riesgosas.json');
      if (res.ok) _desdeArchivo = await res.json();
    } catch {
      // silencioso
    }
    _reconstruir();
  }

  function _reconstruir() {
    const personalizadas = _cargarPersonalizadas();
    _rutas = [..._desdeArchivo, ...personalizadas];
  }

  function _cargarPersonalizadas() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function getRutas() {
    return _rutas;
  }

  function getPersonalizadas() {
    return _cargarPersonalizadas();
  }

  function agregarPersonalizada(ruta) {
    const list = _cargarPersonalizadas();
    list.push(ruta);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    _reconstruir();
  }

  function eliminarPersonalizada(id) {
    const list = _cargarPersonalizadas().filter((r) => r.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    _reconstruir();
  }

  function exportarJSON() {
    return JSON.stringify(_cargarPersonalizadas(), null, 2);
  }

  /**
   * Verifica si la ruta pasa cerca de algún tramo peligroso.
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
      const dangerLength = turf.length(dangerLine, { units: 'kilometers' });
      const numCheckPoints = Math.max(3, Math.ceil(dangerLength / 2));
      const umbralKm = 8;

      let puntoMasCercano = null;
      let menorDistancia = Infinity;

      for (let i = 0; i <= numCheckPoints; i++) {
        const pt = turf.along(dangerLine, (i / numCheckPoints) * dangerLength, { units: 'kilometers' });
        const nearest = turf.nearestPointOnLine(routeLine, pt, { units: 'kilometers' });
        const dist = nearest.properties.distance;
        if (dist < menorDistancia) {
          menorDistancia = dist;
          puntoMasCercano = nearest.geometry.coordinates;
        }
      }

      if (menorDistancia < umbralKm) {
        warnings.push({
          id: ruta.id,
          lnglat: puntoMasCercano || ruta.coordenadas[0],
          mensaje: ruta.mensaje || 'Tramo peligroso',
          tipo: ruta.tipo || 'peligro',
          color: ruta.color || '#e5a000',
        });
      }
    }

    return warnings;
  }

  return { cargar, getRutas, getPersonalizadas, agregarPersonalizada, eliminarPersonalizada, exportarJSON, verificar };
})();