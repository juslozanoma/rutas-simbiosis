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
    if (!rutaPeligrosa.coordenadas || rutaPeligrosa.coordenadas.length < 2) return null;

    const coords = geojsonLineString.geometry.coordinates;
    const dangerLine = turf.lineString(rutaPeligrosa.coordenadas);
    const dangerLength = turf.length(dangerLine, { units: 'kilometers' });
    const numPuntos = Math.max(5, Math.ceil(dangerLength / 3));
    const umbralKm = 12;

    // Verificar si la ruta pasa cerca del tramo peligroso
    const routeLine = turf.lineString(coords);
    let dentro = [];
    for (let i = 0; i <= numPuntos; i++) {
      const pt = turf.along(dangerLine, (i / numPuntos) * dangerLength, { units: 'kilometers' });
      const nearest = turf.nearestPointOnLine(routeLine, pt, { units: 'kilometers' });
      const dist = nearest.properties.dist != null ? nearest.properties.dist : nearest.properties.distance;
      if (dist != null && dist < umbralKm) {
        dentro.push(nearest.geometry.coordinates);
      }
    }
    if (dentro.length === 0) return null;

    // Encontrar el punto medio de la zona de intersección
    let midPt = dentro[Math.floor(dentro.length / 2)];
    if (!midPt) midPt = rutaPeligrosa.coordenadas[0];

    // Buscar el índice más cercano en la ruta
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = turf.distance(turf.point(midPt), turf.point(coords[i]), { units: 'kilometers' });
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }

    // Dirección de la ruta en ese punto
    const prevIdx = Math.max(0, bestIdx - 3);
    const nextIdx = Math.min(coords.length - 1, bestIdx + 3);
    const bearing = turf.bearing(turf.point(coords[prevIdx]), turf.point(coords[nextIdx]));

    // Probar desvíos perpendiculares
    const distancias = [30, 50, 80];
    for (const dist of distancias) {
      for (const ang of [+90, -90]) {
        const dest = turf.destination(
          turf.point(coords[bestIdx]),
          dist,
          (bearing + ang + 360) % 360,
          { units: 'kilometers' },
        );
        const candidate = dest.geometry.coordinates;
        // Verificar que el punto candidato esté fuera de la zona peligrosa
        let fuera = true;
        for (let i = 0; i <= numPuntos; i++) {
          const pt = turf.along(dangerLine, (i / numPuntos) * dangerLength, { units: 'kilometers' });
          const d = turf.distance(dest, pt, { units: 'kilometers' });
          if (d < umbralKm) { fuera = false; break; }
        }
        if (fuera) return candidate;
      }
    }

    return null;
  }

  return { cargar, getRutas, agregarPersonalizada, eliminarPersonalizada, exportarJSON, verificar, generarPuntoEvasivo };
})();