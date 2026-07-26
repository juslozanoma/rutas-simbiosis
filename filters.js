/**
 * filters.js
 * ---------------------------------------------------------------------------
 * Lógica de análisis espacial y filtrado de sitios turísticos respecto a la
 * ruta calculada, usando Turf.js para obtener la distancia perpendicular
 * mínima de cada sitio a la polilínea de la ruta (pointToLineDistance).
 *
 * El panel lateral ofrece dos criterios independientes, cada uno con su
 * propio checkbox de activación:
 *   - Distancia máxima al corredor (km)
 *   - Desvío máximo estimado (min)
 * Cuando ambos están activos se exige que el sitio cumpla los dos a la vez
 * (AND). Si ninguno está activo, no hay resultados que mostrar.
 *
 * El mapa ya no dibuja el polígono de corredor (buffer): el buffer se
 * calculaba únicamente con fines de visualización y se retiró a pedido del
 * usuario. El filtrado en sí nunca dependió de esa geometría, sino de la
 * distancia perpendicular punto-línea, así que la lógica no cambia.
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

  /** Distancia perpendicular mínima (km) de un punto a la línea de ruta. */
  function distanciaAPuntoRuta(sitio, rutaGeoJSON) {
    const punto = turf.point([sitio.lon, sitio.lat]);
    return turf.pointToLineDistance(punto, rutaGeoJSON, { units: 'kilometers' });
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
   * Enriquece y filtra el catálogo completo de sitios contra una ruta.
   *
   * @param {Array} sitios - catálogo completo de sitios turísticos
   * @param {object} rutaGeoJSON - Feature LineString de la ruta calculada
   * @param {object} opciones
   *    usarDistancia {boolean} - si el criterio de distancia está activo
   *    usarTiempo {boolean} - si el criterio de tiempo está activo
   *    distanciaMaximaKm {number}
   *    tiempoMaximoMin {number}
   *    velocidadKmH {number} - opcional, por defecto VELOCIDAD_DESVIO_KMH
   * @returns {Array} sitios que cumplen los criterios activos, con
   *    distanciaCorredorKm y tiempoDesvioMin calculados, ordenados por cercanía.
   */
  function filtrarSitiosPorRuta(sitios, rutaGeoJSON, opciones) {
    const {
      usarDistancia = false,
      usarTiempo = false,
      distanciaMaximaKm = 15,
      tiempoMaximoMin = 20,
      velocidadKmH = VELOCIDAD_DESVIO_KMH,
    } = opciones;

    if (!usarDistancia && !usarTiempo) return [];

    return sitios
      .map((s) => {
        const distanciaCorredorKm = distanciaAPuntoRuta(s, rutaGeoJSON);
        const tiempoDesvioMin = aproximarTiempoDesvio(distanciaCorredorKm, velocidadKmH);
        return { ...s, distanciaCorredorKm, tiempoDesvioMin };
      })
      .filter((s) => {
        if (usarDistancia && s.distanciaCorredorKm > distanciaMaximaKm) return false;
        if (usarTiempo && s.tiempoDesvioMin > tiempoMaximoMin) return false;
        return true;
      })
      .sort((a, b) => a.distanciaCorredorKm - b.distanciaCorredorKm);
  }

  return {
    VELOCIDAD_DESVIO_KMH,
    distanciaAPuntoRuta,
    aproximarTiempoDesvio,
    filtrarSitiosPorRuta,
  };
})();
