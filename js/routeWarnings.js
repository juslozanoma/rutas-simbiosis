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