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
    _rutas.push(ruta);
    try {
      const personalizadas = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      personalizadas.push(ruta);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(personalizadas));
    } catch (err) {
      console.warn('No se pudo guardar en localStorage:', err);
    }
    _syncAlArchivo(_rutas);
  }

  async function eliminarPersonalizada(id) {
    _rutas = _rutas.filter((r) => r.id !== id);
    try {
      const personalizadas = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]').filter((r) => r.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(personalizadas));
    } catch (err) {
      console.warn('No se pudo eliminar en localStorage:', err);
    }
    _syncAlArchivo(_rutas);
  }

  function exportarJSON() {
    return JSON.stringify(_rutas, null, 2);
  }

  function debug() {
    console.log('RouteWarningsModule state:');
    console.log('  _rutas count:', _rutas.length);
    console.log('  _rutas:', _rutas.map(r => ({ id: r.id, nombre: r.nombre, coordCount: r.coordenadas?.length })));
    try {
      const ls = localStorage.getItem(STORAGE_KEY);
      console.log('  localStorage key:', STORAGE_KEY);
      console.log('  localStorage data:', ls ? JSON.parse(ls).length + ' entries' : '(empty)');
    } catch (e) {
      console.warn('  localStorage error:', e);
    }
  }

  function verificar(geojsonLineString, totalKm) {
    if (!geojsonLineString || !geojsonLineString.geometry) return [];
    const coords = geojsonLineString.geometry.coordinates;
    if (!coords || coords.length < 2) return [];

    const routeLine = turf.lineString(coords);
    const warnings = [];

    for (const ruta of _rutas) {
      if (!ruta.coordenadas || ruta.coordenadas.length < 2) continue;

      const dangerLine = turf.lineString(ruta.coordenadas);
      const dangerLength = turf.length(dangerLine, { units: 'kilometers' });
      const numPuntos = Math.max(5, Math.ceil(dangerLength / 3));
      const umbralKm = 12;

      let menorDistancia = Infinity;
      let puntoMasCercano = null;

      for (let i = 0; i <= numPuntos; i++) {
        const pt = turf.along(dangerLine, (i / numPuntos) * dangerLength, { units: 'kilometers' });
        const nearest = turf.nearestPointOnLine(routeLine, pt, { units: 'kilometers' });
        const dist = nearest.properties.dist != null ? nearest.properties.dist : nearest.properties.distance;
        if (dist != null && dist < menorDistancia) {
          menorDistancia = dist;
          puntoMasCercano = nearest.geometry.coordinates;
        }
      }

      if (menorDistancia < umbralKm) {
        warnings.push({
          id: ruta.id,
          ruta: ruta,
          lnglat: puntoMasCercano || ruta.coordenadas[0],
          mensaje: ruta.mensaje || 'Tramo peligroso',
          tipo: ruta.tipo || 'peligro',
          color: ruta.color || '#e5a000',
        });
      }
    }

    return warnings;
  }

  return { cargar, getRutas, agregarPersonalizada, eliminarPersonalizada, exportarJSON, debug, verificar };
})();