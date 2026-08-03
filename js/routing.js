/**
 * routing.js
 * ---------------------------------------------------------------------------
 * Responsable de consultar el motor de ruteo OSRM y normalizar la respuesta
 * a un objeto de ruta usado por el resto de la aplicación.
 *
 * OSRM se consulta contra el servidor de demostración público
 * (router.project-osrm.org). Para producción se recomienda desplegar una
 * instancia propia de OSRM (self-hosted) o un servicio equivalente con
 * cobertura y límites de uso garantizados; ese cambio solo implica ajustar
 * `ENDPOINTS` abajo, el resto de la aplicación no depende del proveedor.
 *
 * La arquitectura deja el punto de extensión `calcularTiempoDesvioPreciso`
 * preparado para reemplazar, en el futuro, la aproximación por distancia
 * (ver filters.js) por consultas reales de ruteo origen→sitio→ruta.
 * ---------------------------------------------------------------------------
 */
const RoutingModule = (() => {

  // Perfiles soportados por el servidor demo de OSRM.
  const ENDPOINTS = {
    driving: 'https://router.project-osrm.org/route/v1/driving',
    cycling: 'https://router.project-osrm.org/route/v1/cycling',
    walking: 'https://router.project-osrm.org/route/v1/walking',
  };

  /**
   * Calcula la mejor ruta entre dos municipios usando OSRM.
   * @param {{lat:number, lon:number}} origen
   * @param {{lat:number, lon:number}} destino
   * @param {string} perfil - 'driving' | 'cycling' | 'walking'
   * @returns {Promise<object>} ruta normalizada
   */
  async function calcularRuta(origen, destino, perfil = 'driving') {
    return calcularRutaConParadas([origen, destino], perfil);
  }

  /**
   * Calcula una ruta que pasa, en orden, por una lista de puntos (origen,
   * cero o más sitios turísticos agregados como parada, y destino). OSRM
   * admite varios pares de coordenadas en una sola consulta y devuelve la
   * geometría y las métricas ya combinadas para el recorrido completo.
   *
   * @param {Array<{lat:number, lon:number}>} puntos - mínimo 2 puntos, en orden de visita
   * @param {string} perfil - 'driving' | 'cycling' | 'walking'
   * @returns {Promise<object>} ruta normalizada
   */
  async function calcularRutaConParadas(puntos, perfil = 'driving') {
    if (!Array.isArray(puntos) || puntos.length < 2) {
      throw new Error('Se requieren al menos dos puntos para calcular una ruta.');
    }

    const base = ENDPOINTS[perfil] || ENDPOINTS.driving;
    const coords = puntos.map((p) => `${p.lon},${p.lat}`).join(';');
    const url = `${base}/${coords}?overview=full&geometries=geojson&steps=false&alternatives=false`;

    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      throw new Error(`El servicio de ruteo respondió con error ${respuesta.status}`);
    }
    const data = await respuesta.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No fue posible calcular una ruta con los puntos seleccionados.');
    }

    const ruta = data.routes[0];
    const elevacion = ruta.legs && ruta.legs[0] && ruta.legs[0].annotation ? ruta.legs[0].annotation.elevation : null;
    const geojson = {
      type: 'Feature',
      properties: {
        distancia_m: ruta.distance,
        duracion_s: ruta.duration,
        perfil,
        elevacion,
      },
      geometry: ruta.geometry, // LineString
    };

    return {
      geojson,
      distanciaMetros: ruta.distance,
      duracionSegundos: ruta.duration,
      vertices: ruta.geometry.coordinates.length,
      perfil,
      elevacion,
    };
  }

  /**
   * Punto de extensión para un cálculo preciso del tiempo de desvío hacia un
   * sitio turístico, consultando el motor de ruteo real en vez de aproximar
   * por distancia y velocidad promedio (ver filters.js -> aproximarTiempoDesvio).
   *
   * Firma prevista: (puntoRuta, sitio, perfil) => Promise<segundosDesvioIdaYVuelta>
   * No se activa por defecto para evitar cientos de peticiones simultáneas al
   * servidor OSRM de demostración; requiere limitar concurrencia (throttling)
   * antes de habilitarse en producción, o un servidor OSRM propio con mayor
   * capacidad de peticiones por segundo.
   */
  async function calcularTiempoDesvioPreciso(puntoRuta, sitio, perfil = 'driving') {
    const base = ENDPOINTS[perfil] || ENDPOINTS.driving;
    const coords = `${puntoRuta.lon},${puntoRuta.lat};${sitio.lon},${sitio.lat}`;
    const url = `${base}/${coords}?overview=false`;
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error('Error consultando desvío preciso');
    const data = await respuesta.json();
    if (data.code !== 'Ok') throw new Error('Ruta de desvío no disponible');
    return data.routes[0].duration * 2; // ida y vuelta
  }

  /**
   * Calcula la ruta normal y obtiene hasta 5 alternativas de OSRM,
   * para elegir una que evite tramos peligrosos.
   * @param {Array<{lat:number, lon:number}>} puntos
   * @param {string} perfil
   * @returns {Promise<Array<object>>} array de rutas normalizadas (misma forma que calcularRutaConParadas)
   */
  async function calcularAlternativas(puntos, perfil = 'driving') {
    if (!Array.isArray(puntos) || puntos.length < 2) {
      throw new Error('Se requieren al menos dos puntos para calcular una ruta.');
    }
    const base = ENDPOINTS[perfil] || ENDPOINTS.driving;
    const coords = puntos.map((p) => `${p.lon},${p.lat}`).join(';');
    const url = `${base}/${coords}?overview=full&geometries=geojson&steps=false&alternatives=true`;
    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      throw new Error(`El servicio de ruteo respondió con error ${respuesta.status}`);
    }
    const data = await respuesta.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error('No fue posible calcular una ruta con los puntos seleccionados.');
    }
    return data.routes.map((ruta) => {
      const elevacion = ruta.legs && ruta.legs[0] && ruta.legs[0].annotation ? ruta.legs[0].annotation.elevation : null;
      const geojson = {
        type: 'Feature',
        properties: {
          distancia_m: ruta.distance,
          duracion_s: ruta.duration,
          perfil,
          elevacion,
        },
        geometry: ruta.geometry,
      };
      return {
        geojson,
        distanciaMetros: ruta.distance,
        duracionSegundos: ruta.duration,
        vertices: ruta.geometry.coordinates.length,
        perfil,
        elevacion,
      };
    });
  }

  return {
    calcularRuta,
    calcularRutaConParadas,
    calcularAlternativas,
    calcularTiempoDesvioPreciso,
  };
})();
