/**
 * filters.js
 * ---------------------------------------------------------------------------
 * Lógica de análisis espacial y filtrado de sitios turísticos respecto a la
 * ruta calculada, usando Turf.js para obtener la distancia perpendicular
 * mínima de cada sitio a la polilínea de la ruta (pointToLineDistance).
 *
 * El panel lateral ofrece dos criterios independientes, cada uno con su
 * propio checkbox de activación:
 *   - Distancia máxima a la ruta (km)
 *   - Desvío máximo estimado (min)
 * Cuando ambos están activos se exige que el sitio cumpla los dos a la vez
 * (AND). Si ninguno está activo, no hay resultados que mostrar.
 *
 * El resultado se ordena por cercanía al municipio de ORIGEN (distancia en
 * línea recta con turf.distance), no por la distancia a la ruta: así el
 * primer sitio de la lista es siempre el más próximo a donde arranca el
 * viaje, sin importar cuánto se aleje del trazado de la vía.
 *
 * Los sitios ya agregados como parada de la ruta (ver app.js) se excluyen
 * del resultado mediante `excluirIds`, para no ofrecerlos de nuevo como
 * candidatos.
 *
 * La velocidad promedio usada para aproximar el tiempo de desvío es un
 * parámetro configurable en código (VELOCIDAD_DESVIO_KMH). El punto de
 * extensión `RoutingModule.calcularTiempoDesvioPreciso` queda disponible
 * para sustituir esta heurística por una consulta real a OSRM.
 * ---------------------------------------------------------------------------
 */
const FiltersModule = (() => {

  /** Velocidad promedio asumida (km/h) para aproximar el tiempo de desvío. */
  const VELOCIDAD_DESVIO_KMH = 40;
  /** Minutos fijos asumidos por la maniobra de salir/retomar la vía principal. */
  const MINUTOS_MANIOBRA = 3;

  /** Coordenadas de la ruta como una sola lista (las rutas aéreas/fluviales
   *  son MultiLineString: sus tramos se encadenan en un único arreglo). */
  function _coordsRuta(rutaGeoJSON) {
    const coords = rutaGeoJSON?.geometry?.coordinates || [];
    return rutaGeoJSON?.geometry?.type === 'MultiLineString'
      ? coords.reduce((acc, tramo) => acc.concat(tramo), [])
      : coords;
  }

  /** Distancia perpendicular mínima (km) de un punto a la línea de ruta.
   *  turf.pointToLineDistance solo acepta LineString: para MultiLineString
   *  (rutas en avión/por río) se usa el punto más cercano de la ruta. */
  function distanciaARuta(sitio, rutaGeoJSON) {
    const punto = turf.point([sitio.lon, sitio.lat]);
    if (rutaGeoJSON?.geometry?.type === 'MultiLineString') {
      try {
        const nearest = turf.nearestPointOnLine(rutaGeoJSON, punto, { units: 'kilometers' });
        return turf.distance(punto, nearest.geometry.coordinates, { units: 'kilometers' });
      } catch {
        return Infinity;
      }
    }
    return turf.pointToLineDistance(punto, rutaGeoJSON, { units: 'kilometers' });
  }

  /** Bounding box de la ruta + margen en km para descartar puntos lejanos. */
  function rutaBboxConMargen(rutaGeoJSON, margenKm) {
    const bbox = turf.bbox(rutaGeoJSON);
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const latCentro = (minLat + maxLat) / 2 * Math.PI / 180;
    const dLat = margenKm / 111;
    const dLon = margenKm / (111 * Math.cos(latCentro));
    return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
  }

  function fueraDeBbox(sitio, bbox) {
    if (!bbox) return false;
    return sitio.lat < bbox[1] || sitio.lat > bbox[3] || sitio.lon < bbox[0] || sitio.lon > bbox[2];
  }

  /** Distancia en línea recta (km) entre un sitio y el punto de origen. */
  function distanciaAOrigen(sitio, origen) {
    if (!origen) return null;
    const puntoOrigen = turf.point([origen.lon, origen.lat]);
    const puntoSitio = turf.point([sitio.lon, sitio.lat]);
    return turf.distance(puntoOrigen, puntoSitio, { units: 'kilometers' });
  }

  function distanciaADestino(sitio, destino) {
    if (!destino) return null;
    const puntoDestino = turf.point([destino.lon, destino.lat]);
    const puntoSitio = turf.point([sitio.lon, sitio.lat]);
    return turf.distance(puntoDestino, puntoSitio, { units: 'kilometers' });
  }

  /**
   * Aproxima el tiempo de desvío (ida y vuelta, en minutos) para visitar un
   * sitio situado a `distanciaKm` de la ruta principal, asumiendo que se
   * abandona y retoma la vía en el punto más cercano.
   *
   * tiempo = (distancia_ida + distancia_vuelta) / velocidad_promedio
   *        + tiempo fijo de maniobra de entrada/salida de la vía principal
   */
  function aproximarTiempoDesvio(distanciaKm, velocidadKmH = VELOCIDAD_DESVIO_KMH, minutosManiobra = MINUTOS_MANIOBRA) {
    const horas = (distanciaKm * 2) / velocidadKmH;
    return horas * 60 + minutosManiobra;
  }

  /**
   * Precomputa distanciaRutaKm, tiempoDesvioMin y distanciaOrigenKm para
   * todos los sitios con coordenadas. Se invoca UNA SOLA VEZ al cambiar la
   * ruta, para que los cambios posteriores de filtros (distancia/tiempo/
   * categorías) sean instantáneos sin llamar a turf.pointToLineDistance.
   *
   * @param {Array} sitios - catálogo completo
   * @param {object} rutaGeoJSON - Feature LineString de la ruta
   * @param {object|null} origen - {lat, lon}
   * @param {number} velocidadKmH
   * @returns {Array} sitios enriquecidos con distanciaRutaKm, tiempoDesvioMin, distanciaOrigenKm
   */
  function precomputarSitios(sitios, rutaGeoJSON, origen, destino, velocidadKmH = VELOCIDAD_DESVIO_KMH) {
    const coords = _coordsRuta(rutaGeoJSON);
    sitios.forEach((s) => {
      if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) return;
      const punto = turf.point([s.lon, s.lat]);
      s.distanciaRutaKm = distanciaARuta(s, rutaGeoJSON);
      s.tiempoDesvioMin = aproximarTiempoDesvio(s.distanciaRutaKm, velocidadKmH);
      s.distanciaOrigenKm = distanciaAOrigen(s, origen);
      s.distanciaDestinoKm = distanciaADestino(s, destino);
      if (coords.length >= 2) {
        try {
          const nearest = turf.nearestPointOnLine(rutaGeoJSON, punto, { units: 'kilometers' });
          const idx = nearest.properties.index;
          if (idx >= 0 && idx < coords.length - 1) {
            const ax = coords[idx][0], ay = coords[idx][1];
            const bx = coords[idx + 1][0], by = coords[idx + 1][1];
            const dx = bx - ax, dy = by - ay;
            const sx = s.lon - (nearest.geometry.coordinates[0] || ax);
            const sy = s.lat - (nearest.geometry.coordinates[1] || ay);
            s._offsetLado = Math.sign(dx * sy - dy * sx) || 1;
          } else {
            s._offsetLado = 1;
          }
        } catch {
          s._offsetLado = 1;
        }
      }
    });
  }

  /**
   * Filtra un arreglo de sitios (ya enriquecidos con precomputarSitios)
   * según los criterios espaciales activos. Si los sitios ya tienen
   * distanciaRutaKm, se salta el cómputo costoso con Turf.js.
   *
   * @param {Array} sitios - sitios (pueden venir ya enriquecidos)
   * @param {object} rutaGeoJSON - Feature LineString
   * @param {object} opciones
   *    usarDistancia {boolean}
   *    usarTiempo {boolean}
   *    distanciaMaximaKm {number}
   *    tiempoMaximoMin {number}
   *    origen {{lat:number, lon:number}}
   *    excluirIds {Array<number>}
   * @returns {Array} sitios filtrados y ordenados
   */
  function filtrarSitiosPorRuta(sitios, rutaGeoJSON, opciones) {
    const {
      usarDistancia = false,
      usarTiempo = false,
      distanciaMaximaKm = 15,
      tiempoMaximoMin = 20,
      velocidadKmH = VELOCIDAD_DESVIO_KMH,
      origen = null,
      destino = null,
      excluirIds = [],
    } = opciones;

    if (!usarDistancia && !usarTiempo) return [];

    const idsExcluidos = new Set(excluirIds);
    // El margen del bbox se calcula según el criterio activo: para el filtro de
    // tiempo se traduce el límite en minutos a una distancia aproximada, para no
    // descartar sitios válidos que queden apenas fuera del bbox de distancia.
    const margenBbox = usarDistancia
      ? distanciaMaximaKm
      : usarTiempo
        ? ((tiempoMaximoMin - MINUTOS_MANIOBRA) * velocidadKmH) / 120
        : 0;
    const bboxLimite = margenBbox > 0 && margenBbox <= 5 ? rutaBboxConMargen(rutaGeoJSON, margenBbox) : null;

    return sitios
      .filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)))
      .filter((s) => !idsExcluidos.has(s.id))
      .map((s) => {
        if (s.distanciaRutaKm == null) {
          if (bboxLimite && fueraDeBbox(s, bboxLimite)) {
            s.distanciaRutaKm = Infinity;
            return s;
          }
          const punto = turf.point([s.lon, s.lat]);
          s.distanciaRutaKm = distanciaARuta(s, rutaGeoJSON);
          s.tiempoDesvioMin = aproximarTiempoDesvio(s.distanciaRutaKm, velocidadKmH);
          s.distanciaOrigenKm = distanciaAOrigen(s, origen);
          s.distanciaDestinoKm = distanciaADestino(s, destino);
          const coords = _coordsRuta(rutaGeoJSON);
          if (coords && coords.length >= 2) {
            try {
              const nearest = turf.nearestPointOnLine(rutaGeoJSON, punto, { units: 'kilometers' });
              const idx = nearest.properties.index;
              if (idx >= 0 && idx < coords.length - 1) {
                const ax = coords[idx][0], ay = coords[idx][1];
                const bx = coords[idx + 1][0], by = coords[idx + 1][1];
                const dx = bx - ax, dy = by - ay;
                const sx = s.lon - (nearest.geometry.coordinates[0] || ax);
                const sy = s.lat - (nearest.geometry.coordinates[1] || ay);
                s._offsetLado = Math.sign(dx * sy - dy * sx) || 1;
              } else {
                s._offsetLado = 1;
              }
            } catch {
              s._offsetLado = 1;
            }
          }
        }
        return s;
      })
      .filter((s) => {
        if (usarDistancia && s.distanciaRutaKm > distanciaMaximaKm) return false;
        // Los sitios fuera del bbox tienen distanciaRutaKm=Infinity y no
        // guardan tiempoDesvioMin: al filtrar por tiempo deben quedar fuera.
        if (usarTiempo && (s.tiempoDesvioMin ?? Infinity) > tiempoMaximoMin) return false;
        return true;
      })
      .sort((a, b) => (a.distanciaDestinoKm ?? a.distanciaRutaKm) - (b.distanciaDestinoKm ?? b.distanciaRutaKm) || (b.distanciaOrigenKm ?? b.distanciaRutaKm) - (a.distanciaOrigenKm ?? a.distanciaRutaKm));
  }

  return {
    VELOCIDAD_DESVIO_KMH,
    distanciaARuta,
    distanciaAOrigen,
    distanciaADestino,
    aproximarTiempoDesvio,
    precomputarSitios,
    filtrarSitiosPorRuta,
    rutaBboxConMargen,
    fueraDeBbox,
  };
})();
