/**
 * routeWarnings.js
 * ---------------------------------------------------------------------------
 * Evalúa si la ruta calculada pasa por tramos viales peligrosos definidos
 * en data/rutas_riesgosas.json (oficiales) más los que el usuario agregue.
 *
 * Las rutas personalizadas se persisten en localStorage (funciona siempre,
 * incluso en GitHub Pages). Si además hay un servidor local (server.py),
 * también se envían por POST para actualizar el archivo JSON.
 * ---------------------------------------------------------------------------
 */
const RouteWarningsModule = (() => {
  const STORAGE_KEY = 'rutas_riesgosas_personalizadas';
  let _rutas = [];

  async function cargar() {
    const desdeArchivo = [];
    try {
      const res = await fetch('data/rutas_riesgosas.json');
      if (res.ok) desdeArchivo.push(...(await res.json()));
    } catch {
      // silencioso
    }
    const personalizadas = _leerPersonalizadas();
    _rutas = [...desdeArchivo, ...personalizadas];
  }

  function _leerPersonalizadas() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function _guardarPersonalizadas(lista) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  }

  function _syncAlArchivo(rutas) {
    fetch('/guardar-rutas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rutas),
    }).catch(() => {});
  }

  function getRutas() {
    return _rutas;
  }

  async function agregarPersonalizada(ruta) {
    const personalizadas = _leerPersonalizadas();
    personalizadas.push(ruta);
    _guardarPersonalizadas(personalizadas);
    _rutas.push(ruta);
    _syncAlArchivo(_rutas);
  }

  async function eliminarPersonalizada(id) {
    const personalizadas = _leerPersonalizadas().filter((r) => r.id !== id);
    _guardarPersonalizadas(personalizadas);
    _rutas = _rutas.filter((r) => r.id !== id);
    _syncAlArchivo(_rutas);
  }

  function exportarJSON() {
    return JSON.stringify(_rutas, null, 2);
  }

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
        const mid = turf.midpoint(
          turf.point(ruta.coordenadas[0]),
          turf.point(ruta.coordenadas[ruta.coordenadas.length - 1]),
        );
        const nearest = turf.nearestPointOnLine(routeLine, mid, { units: 'kilometers' });

        warnings.push({
          id: ruta.id,
          ruta: ruta,
          lnglat: nearest.geometry.coordinates,
          mensaje: ruta.mensaje || 'Tramo peligroso',
          tipo: ruta.tipo || 'peligro',
          color: ruta.color || '#e5a000',
        });
      }
    }

    return warnings;
  }

  /**
   * Genera un punto de desvío evasivo para evitar un tramo peligroso.
   * Analiza la ruta entrante y calcula puntos alternativos (perpendiculares
   * a la dirección de la ruta) para forzar a OSRM a buscar otro camino.
   *
   * @param {object} geojsonLineString - GeoJSON LineString de la ruta actual
   * @param {object} rutaPeligrosa - definición del tramo peligroso
   * @param {number} totalKm - distancia total de la ruta
   * @returns {[number,number]|[null]} [lng,lat] del punto evasivo, o null
   */
  function generarPuntoEvasivo(geojsonLineString, rutaPeligrosa, totalKm) {
    if (rutaPeligrosa.distanciaMinimaKm != null && totalKm < rutaPeligrosa.distanciaMinimaKm) return null;

    const coords = geojsonLineString.geometry.coordinates;
    const dangerLine = turf.lineString(rutaPeligrosa.coordenadas);
    const buffer = turf.buffer(dangerLine, 10, { units: 'kilometers' });
    if (!buffer) return null;

    const routeLine = turf.lineString(coords);
    if (!turf.booleanIntersects(buffer, routeLine)) return null;

    // Encontrar índices de entrada y salida del buffer
    let entryIdx = -1, exitIdx = -1;
    let inside = false;
    for (let i = 0; i < coords.length; i++) {
      const isInside = turf.booleanPointInPolygon(turf.point(coords[i]), buffer);
      if (isInside && !inside) { entryIdx = i; inside = true; }
      if (!isInside && inside) { exitIdx = i; break; }
    }
    if (entryIdx === -1 || exitIdx === -1) return null;

    // Punto medio del segmento que intersecta
    const midIdx = Math.floor((entryIdx + exitIdx) / 2);
    const midPt = coords[midIdx];

    // Dirección de la ruta en el punto medio
    const prevIdx = Math.max(0, midIdx - 1);
    const nextIdx = Math.min(coords.length - 1, midIdx + 1);
    const bearing = turf.bearing(turf.point(coords[prevIdx]), turf.point(coords[nextIdx]));

    // Probar varias distancias de desvío en ambas direcciones perpendiculares
    const distancias = [25, 35, 50];
    for (const dist of distancias) {
      for (const ang of [+90, -90]) {
        const pt = turf.destination(
          turf.point(midPt),
          dist,
          (bearing + ang + 360) % 360,
          { units: 'kilometers' },
        );
        const candidate = pt.geometry.coordinates;
        if (!turf.booleanPointInPolygon(pt, buffer)) {
          return candidate;
        }
      }
    }

    return null;
  }

  return { cargar, getRutas, agregarPersonalizada, eliminarPersonalizada, exportarJSON, verificar, generarPuntoEvasivo };
})();