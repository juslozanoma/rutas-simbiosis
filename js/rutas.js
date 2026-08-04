/**
 * rutas.js
 * ---------------------------------------------------------------------------
 * Cálculo de rutas (carretera OSRM y aérea), aplicación al mapa/perfil y
 * construcción de rutas con desvíos por paradas.
 * ---------------------------------------------------------------------------
 */

  async function calcularRutaPrincipal(conservarParadas = false, opciones = {}) {
    if (!state.origen || !state.destino) return;
    // Al agregar/reordenar paradas la altimetría abierta se mantiene.
    if (!opciones.conservarAltimetria) cerrarAltimetria();

    // Recalculo interno en modo aéreo o fluvial: no se vuelve a consultar OSRM
    // por carretera, solo se redibuja la ruta y se actualizan paradas/perfil.
    if (conservarParadas && (state.modoAereo || state.modoFluvial)) {
      ponerEnCargaRuta(true, true);
      try {
        await aplicarRutaConDesvios({ mantenerMapa: true, conservarAltimetria: true });
        renderizarParadas();
      } catch (err) {
        console.warn('Error al recalcular ruta de transporte', err);
      } finally {
        ponerEnCargaRuta(false);
        sincronizarModoRutaMovil();
      }
      return;
    }

    if (state.origen.id === state.destino.id) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'El origen y el destino deben ser municipios diferentes.';
      el.sitiosLista.hidden = true;
      return;
    }

    // Fullscreen en móvil durante el gesto del usuario (antes de cualquier await)
    if (esMovil() && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    // Una nueva ruta principal invalida cualquier parada agregada previamente
    // (excepto cuando se reordenan escalas, que deben conservarse).
    if (!conservarParadas) {
      state.modoAereo = false;
      state.tramosAereo = null;
      _actualizarBotonAereo();
      state.modoFluvial = false;
      state.tramosFluviales = null;
      _actualizarBotonFluvial();
      state.elevacion = null;
      state.paradas = [];
      state.sitios.forEach((s) => {
        delete s._detourCoords;
        delete s._detourDist;
        delete s._detourDur;
        delete s.distanciaRutaKm;
        delete s.tiempoDesvioMin;
        delete s.distanciaOrigenKm;
        delete s.distanciaDestinoKm;
        delete s._offsetLado;
      });
      MapModule.limpiarSitios();
      MapModule.limpiarParadas();
      MapModule.limpiarEscalas();
      limpiarPreview();
      el.panelSitios.hidden = true;
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      state.categoriasSeleccionadas = [];
      conteoCategoriasBase = new Map();
    }

    ponerEnCargaRuta(true);

    try {
      const puntosRuta = [state.origen, ...state.escalas.filter((e) => e.lat != null), state.destino];
      const usarConParadas = puntosRuta.length > 2;
      let ruta;
      try {
        ruta = usarConParadas
          ? await RoutingModule.calcularRutaConParadas(puntosRuta, PERFIL_FIJO)
          : await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);
      } catch (err) {
        // Sin ruta por carretera (p. ej. San Andrés): se usa la ruta aérea.
        console.warn('Ruta por carretera no disponible, usando ruta aérea:', err.message);
        await calcularRutaAerea();
        return;
      }

      // Verificar si la ruta pasa por tramos peligrosos y buscar alternativa
      let totalKm = ruta.distanciaMetros / 1000;
      const alertasIniciales = RouteWarningsModule.verificar(ruta.geojson, totalKm);
      if (alertasIniciales.length > 0) {
        console.log('Warnings detectados en ruta principal:', alertasIniciales.length);
        try {
          const alternativas = await RoutingModule.calcularAlternativas(puntosRuta, PERFIL_FIJO);
          console.log('Alternativas recibidas de OSRM:', alternativas.length);
          let seleccionada = false;
          for (let i = 1; i < alternativas.length; i++) {
            const alt = alternativas[i];
            const altKm = alt.distanciaMetros / 1000;
            const altAlertas = RouteWarningsModule.verificar(alt.geojson, altKm);
            console.log(`  Alt ${i}: ${altAlertas.length} warnings, ${altKm.toFixed(0)} km`);
            if (altAlertas.length === 0) {
              ruta = alt;
              totalKm = altKm;
              seleccionada = true;
              console.log(`  → Seleccionada alternativa ${i}`);
              break;
            }
          }
          if (!seleccionada) console.log('  Ninguna alternativa limpia, se mantiene la ruta principal');
        } catch (err) {
          console.warn('No se pudieron obtener alternativas:', err);
        }
      }

      await aplicarRutaCalculada(ruta, { mantenerMapa: Boolean(conservarParadas) || opciones.mantenerMapa });
      // Clean up escala DOM rows (pasan a la lista de paradas)
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      state.escalas.forEach((e) => { delete e._row; });
      renderizarParadas();

      if (!conservarParadas) {
        // Limpiar sitios cargados antes de activar la pestaña
        state.sitiosFiltrados = [];
        state.sitiosFiltradosBase = [];
        state.modoVisibilidad = 'completa';
        _sincronizarBotonVisibles();

        // Activar pestaña Ruta
        el.panelEscalas.hidden = true;
        activarPanelTab('ruta');

        // Volver a la pestaña Ruta en móvil antes de activar el testigo
        if (esMovil()) setMobileTab('ruta');

        // Enable "Mostrar sitios" button (excepto al calcular desde un pueblo intermedio)
        if (opciones.ocultarTestigoSitios) {
          if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
          if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
        } else {
          _habilitarMostrarSitios();
        }
        _actualizarTextoBotonesOrden();
        el.panelSitios.hidden = true;
        MapModule.limpiarSitios();

        el.checkDistancia.checked = true;
        el.filtroDistancia.value = '5';
        el.filtroDistanciaValor.textContent = '5 km';
        el.filtroDistancia.disabled = false;

        // Ocultar definitivamente el testigo "Mostrar sitios" al calcular desde un pueblo intermedio
        if (opciones.ocultarTestigoSitios) {
          el.btnMostrarSitiosCercanos.hidden = true;
          el.btnMostrarSitiosCercanos.disabled = true;
        }
      } else {
        // Ruta recalculada tras añadir/eliminar/reordenar paradas o escalas:
        // se mantiene el estado de la pestaña Descubre y se desbloquea de nuevo.
        _actualizarTextoBotonesOrden();
        if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
        if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
      }

    } catch (err) {
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
      console.warn('Error al calcular ruta', err);
    } finally {
      ponerEnCargaRuta(false);
      sincronizarModoRutaMovil();
    }
  }


  async function aplicarRutaCalculada(ruta, opciones = {}) {
    state.rutaBase = ruta;
    await aplicarRutaConDesvios(opciones);
  }

  // -------------------------------------------------------------------
  // Ruta aérea (avión): tramos en carro hasta/desde los aeropuertos + vuelo
  // -------------------------------------------------------------------


  function _normTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** ¿El aeropuerto `ap` puede llegar a `apDes` directo o con una conexión? */
  function _puedeLlegarAeropuerto(ap, apDes) {
    if (!ap || !apDes) return false;
    const destinos = (ap.destinos_id || []).map((d) => String(d));
    if (destinos.includes(String(apDes.id))) return true;
    for (const id of destinos) {
      const h = state.aeropuertos.find((a) => String(a.id) === String(id));
      if (h && (h.destinos_id || []).map((d) => String(d)).includes(String(apDes.id))) return true;
    }
    return false;
  }

  /** Devuelve el aeropuerto más cercano a un punto (si `debeLlegarA` se pasa,
   *  solo considera aeropuertos que puedan llegar a él, directo o con conexión). */
  function _aeropuertoMasCercano(punto, debeLlegarA = null) {
    if (!punto || !state.aeropuertos || !state.aeropuertos.length) return null;
    let mejor = null, mejorDist = Infinity;
    for (const ap of state.aeropuertos) {
      if (debeLlegarA && !_puedeLlegarAeropuerto(ap, debeLlegarA)) continue;
      const dist = turf.distance(turf.point([punto.lon, punto.lat]), turf.point([ap.longitud, ap.latitud]), { units: 'kilometers' });
      if (dist < mejorDist) { mejorDist = dist; mejor = ap; }
    }
    return mejor;
  }

  /** Planifica los tramos de vuelo entre dos aeropuertos usando `destinos_id`:
   *  vuelo directo si apDes está en la lista, o una conexión vía el primer
   *  destino de la lista que permita llegar a apDes. Devuelve [{a, b}, ...] o
   *  null si no hay ruta. */
  function _planearVuelos(apOri, apDes) {
    if (!apOri || !apDes) return null;
    const destinos = (apOri.destinos_id || []).map((d) => String(d));
    if (destinos.includes(String(apDes.id))) return [{ a: apOri, b: apDes }];
    for (const id of destinos) {
      const h = state.aeropuertos.find((a) => String(a.id) === String(id));
      if (h && (h.destinos_id || []).map((d) => String(d)).includes(String(apDes.id))) {
        return [{ a: apOri, b: h }, { a: h, b: apDes }];
      }
    }
    return null;
  }

  /** Genera una línea curva entre dos aeropuertos para el tramo aéreo. */

  function _arcCoords(a, b) {    const lon1 = Number(a.longitud), lat1 = Number(a.latitud);
    const lon2 = Number(b.longitud), lat2 = Number(b.latitud);
    const n = 26;
    const dLon = lon2 - lon1, dLat = lat2 - lat1;
    const len = Math.sqrt(dLon * dLon + dLat * dLat) || 1;
    const bulge = Math.min(Math.max(len * 0.10, 0.15), 3.5);
    const px = -dLat / len;
    const py = dLon / len;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = Math.sin(Math.PI * t);
      pts.push([lon1 + dLon * t + px * bulge * off, lat1 + dLat * t + py * bulge * off]);
    }
    return pts;
  }


  function _actualizarBotonAereo() {
    if (!el.btnAereo) return;
    el.btnAereo.setAttribute('aria-pressed', String(state.modoAereo));
    el.btnAereo.classList.toggle('icon-btn--active', state.modoAereo);
  }

  /** Calcula la ruta directamente en avión (carro→aeropuerto→vuelo→aeropuerto→carro). */

  async function calcularRutaAerea() {
    if (!state.origen || !state.destino) return;
    if (!state.aeropuertos || !state.aeropuertos.length) {
      _mostrarNotificacion('No hay datos de aeropuertos disponibles');
      return;
    }
    cerrarAltimetria();
    // Aeropuerto más cercano al destino y, para el origen, el más cercano que
    // pueda llegar hasta él (directo o con una conexión).
    const apDes = _aeropuertoMasCercano(state.destino);
    let apOri = _aeropuertoMasCercano(state.origen, apDes);
    let pares = apOri ? _planearVuelos(apOri, apDes) : null;
    if (!apOri || !pares) {
      // Ningún aeropuerto cercano al origen puede llegar al aeropuerto elegido
      // para el destino: se cae al más cercano sin filtro y se vuelve a planear.
      apOri = _aeropuertoMasCercano(state.origen);
      pares = apOri ? _planearVuelos(apOri, apDes) : null;
    }
    if (!apOri || !apDes || !pares || !pares.length) {
      _mostrarNotificacion('No se encontró una conexión aérea entre el origen y el destino');
      return;
    }
    const hub = pares.length > 1 ? pares[0].b : null;

    ponerEnCargaRuta(true, true);
    try {
      const [rutaCarro1, rutaCarro2] = await Promise.all([
        RoutingModule.calcularRuta(state.origen, { lat: apOri.latitud, lon: apOri.longitud }, 'driving'),
        RoutingModule.calcularRuta({ lat: apDes.latitud, lon: apDes.longitud }, state.destino, 'driving'),
      ]);

      const coordsCarro1 = rutaCarro1.geojson.geometry.coordinates;
      const coordsCarro2 = rutaCarro2.geojson.geometry.coordinates;

      // Tramos de vuelo: directo o con conexión (definido por destinos_id).
      const vuelos = pares.map(([a, b]) => {
        const coords = _arcCoords(a, b);
        const dist = turf.length(turf.lineString(coords), { units: 'kilometers' }) * 1000;
        const dur = (dist / 1000) / 750 * 3600;
        return { coords, distanciaMetros: dist, duracionSegundos: dur, a, b };
      });
      const distAvion = vuelos.reduce((s, v) => s + v.distanciaMetros, 0);
      const durAvion = vuelos.reduce((s, v) => s + v.duracionSegundos, 0);

      // Mapa: MultiLineString con los tramos en carro (sin línea recta entre aeropuertos).
      const geojsonMapa = {
        type: 'Feature',
        properties: { perfil: 'aereo' },
        geometry: { type: 'MultiLineString', coordinates: [coordsCarro1, coordsCarro2] },
      };
      // Perfil: LineString continua con los tramos en carro (turf solo en carro).
      const geojsonPerfil = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [...coordsCarro1, ...coordsCarro2] },
      };

      const elevacion = [...(rutaCarro1.elevacion || []), ...(rutaCarro2.elevacion || [])];
      const totalDist = rutaCarro1.distanciaMetros + distAvion + rutaCarro2.distanciaMetros;
      const totalDur = rutaCarro1.duracionSegundos + durAvion + rutaCarro2.duracionSegundos;

      const ruta = {
        geojson: geojsonMapa,
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        vertices: coordsCarro1.length + coordsCarro2.length,
        perfil: 'aereo',
      };

      state.modoAereo = true;
      state.modoFluvial = false;
      state.tramosFluviales = null;
      _actualizarBotonFluvial();
      state.tramosAereo = {
        vuelos,
        carro1: coordsCarro1,
        carro2: coordsCarro2,
        apOri,
        apDes,
        hub,
        distCarro1: rutaCarro1.distanciaMetros,
        distCarro2: rutaCarro2.distanciaMetros,
        distAvion,
        durAvion,
      };
      state.rutaBase = ruta;
      state.rutaActual = ruta;
      state.elevacion = elevacion;
      state.altimetriaGeo = geojsonPerfil;
      state.altimetriaTotalKm = totalDist / 1000;
      AltimetriaModule.setDatos(geojsonPerfil, state.elevacion, state.altimetriaTotalKm);

      sincronizarOrden();
      let idxIntermedio = 0;
      const mapaEtiquetas = new Map();
      state.orden.forEach((o) => {
        if (o.tipo === 'escala') {
          const dragE = state.escalas.find((e) => e.id === o.id);
          if (dragE && dragE._dragGenerated) return;
        }
        const etiqueta = etiquetaIntermedia(idxIntermedio++);
        const key = o.tipo + '_' + o.id;
        mapaEtiquetas.set(key, etiqueta);
        if (o.tipo === 'escala') {
          const e = state.escalas.find((e) => e.id === o.id);
          if (e && e.lat != null) e._numero = etiqueta;
        } else {
          const p = state.paradas.find((p) => p.id === o.id);
          if (p) p._numero = etiqueta;
        }
      });

      const routeLine = turf.lineString(geojsonPerfil.geometry.coordinates);
      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([e.lon, e.lat]), { units: 'kilometers' });
        e._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.lon, p.lat]), { units: 'kilometers' });
        p._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });

      // Aeropuertos en el perfil: salida, (hub) y llegada.
      const aeropuertos = [{ ap: apOri }, ...(hub ? [{ ap: hub }] : []), { ap: apDes }];
      aeropuertos.forEach(({ ap }) => {
        if (!ap) return;
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([ap.longitud, ap.latitud]), { units: 'kilometers' });
        AltimetriaModule.agregarParada(ap.latitud, ap.longitud, ap.nombre, nearest.properties.location || 0, '✈', 'aero_' + ap.id, 'aeropuerto');
      });

      MapModule.dibujarRuta(geojsonMapa, {
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        origenNombre: state.origen?.nombre || 'el origen',
      });
      MapModule.dibujarTramoAereo(vuelos);
      MapModule.setMarcadoresAeropuertos([
        { ap: apOri, titulo: 'Salida' },
        ...(hub ? [{ ap: hub, titulo: 'Conexión' }] : []),
        { ap: apDes, titulo: 'Llegada' },
      ]);
      MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
      MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);
      MapModule.setMarcadoresEscalas(state.escalas);
      MapModule.setMarcadoresParadas(state.paradas);
      MapModule.setMarcadoresPuntosDesvio(state.escalas);
      MapModule.encuadrar(geojsonMapa);

      const distTexto = Utils.formatearDistancia(totalDist);
      const durTexto = Utils.formatearDuracion(totalDur);
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = distTexto;
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = durTexto;
      renderizarParadas();
      _actualizarBotonAereo();
      sincronizarModoRutaMovil();
    } catch (err) {
      console.warn('Error al calcular ruta aérea', err);
      _mostrarNotificacion('No se pudo calcular la ruta en avión');
    } finally {
      ponerEnCargaRuta(false);
    }
  }

  // -------------------------------------------------------------------
  // Ruta fluvial (río): tramos en carro hasta/desde los puertos + trayecto por río
  // -------------------------------------------------------------------


  /** Devuelve el puerto fluvial más cercano a un punto. */
  function _puertoMasCercano(punto) {
    if (!punto || !state.puertos || !state.puertos.length) return null;
    let mejor = null, mejorDist = Infinity;
    for (const p of state.puertos) {
      const dist = turf.distance(turf.point([punto.lon, punto.lat]), turf.point([p.longitud, p.latitud]), { units: 'kilometers' });
      if (dist < mejorDist) { mejorDist = dist; mejor = p; }
    }
    return mejor;
  }

  /** Devuelve un puerto por su nombre (los destinos_id de los puertos usan el
   *  formato "Ciudad (Departamento)"; el puerto puede llamarse "Puerto de ...",
   *  "Malecón de ...", etc.). */
  function _puertoPorNombre(nombre) {
    if (!nombre) return null;
    const ciudad = _normTexto(String(nombre).split(' (')[0].trim());
    const exact = state.puertos.find((p) => _normTexto(p.nombre) === ciudad);
    if (exact) return exact;
    return state.puertos.find((p) => _normTexto(p.nombre).includes(ciudad)) || null;
  }

  /** Planifica el trayecto fluvial entre dos puertos usando `destinos_id`
   *  (nombres de ciudad): directo si el puerto de destino está entre ellos, o
   *  una conexión vía el primer destino de la lista cuyo puerto permita llegar
   *  al destino. Devuelve [{a, b}, ...] o null. */
  function _planearTrayectoFluvial(po, pd) {
    if (!po || !pd) return null;
    const alcanza = (lista, pd) => (lista || []).some((d) => _puertoPorNombre(d) === pd);
    if (alcanza(po.destinos_id, pd)) return [{ a: po, b: pd }];
    for (const nombre of po.destinos_id || []) {
      const h = _puertoPorNombre(nombre);
      if (h && alcanza(h.destinos_id, pd)) {
        return [{ a: po, b: h }, { a: h, b: pd }];
      }
    }
    return null;
  }


  function _actualizarBotonFluvial() {
    if (!el.btnFluvial) return;
    el.btnFluvial.setAttribute('aria-pressed', String(state.modoFluvial));
    el.btnFluvial.classList.toggle('icon-btn--active', state.modoFluvial);
  }

  /** Calcula la ruta por río (carro→puerto→trayecto fluvial→puerto→carro). */
  async function calcularRutaFluvial() {
    if (!state.origen || !state.destino) return;
    if (!state.puertos || !state.puertos.length) {
      _mostrarNotificacion('No hay datos de puertos fluviales disponibles');
      return;
    }
    cerrarAltimetria();
    // Al elegir ruta por río se apaga el modo aéreo.
    state.modoAereo = false;
    state.tramosAereo = null;
    _actualizarBotonAereo();

    const pd = _puertoMasCercano(state.destino);
    const po = _puertoMasCercano(state.origen);
    const pares = po ? _planearTrayectoFluvial(po, pd) : null;
    if (!po || !pd || !pares || !pares.length) {
      _mostrarNotificacion('No se encontró un trayecto fluvial entre el origen y el destino');
      return;
    }
    const hub = pares.length > 1 ? pares[0].b : null;

    ponerEnCargaRuta(true, true);
    try {
      const [rutaCarro1, rutaCarro2] = await Promise.all([
        RoutingModule.calcularRuta(state.origen, { lat: po.latitud, lon: po.longitud }, 'driving'),
        RoutingModule.calcularRuta({ lat: pd.latitud, lon: pd.longitud }, state.destino, 'driving'),
      ]);

      const coordsCarro1 = rutaCarro1.geojson.geometry.coordinates;
      const coordsCarro2 = rutaCarro2.geojson.geometry.coordinates;

      // Tramos fluviales: directo o con conexión (definido por destinos_id).
      const tramos = pares.map(([a, b]) => {
        const coords = _arcCoords(a, b);
        const dist = turf.length(turf.lineString(coords), { units: 'kilometers' }) * 1000;
        const dur = (dist / 1000) / 25 * 3600; // río ≈ 25 km/h
        return { coords, distanciaMetros: dist, duracionSegundos: dur, a, b };
      });
      const distRio = tramos.reduce((s, t) => s + t.distanciaMetros, 0);
      const durRio = tramos.reduce((s, t) => s + t.duracionSegundos, 0);

      // Mapa: MultiLineString con los tramos en carro (el río va punteado aparte).
      const geojsonMapa = {
        type: 'Feature',
        properties: { perfil: 'fluvial' },
        geometry: { type: 'MultiLineString', coordinates: [coordsCarro1, coordsCarro2] },
      };
      // Perfil: LineString continua con los tramos en carro (turf solo en carro).
      const geojsonPerfil = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [...coordsCarro1, ...coordsCarro2] },
      };

      const elevacion = [...(rutaCarro1.elevacion || []), ...(rutaCarro2.elevacion || [])];
      const totalDist = rutaCarro1.distanciaMetros + distRio + rutaCarro2.distanciaMetros;
      const totalDur = rutaCarro1.duracionSegundos + durRio + rutaCarro2.duracionSegundos;

      const ruta = {
        geojson: geojsonMapa,
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        vertices: coordsCarro1.length + coordsCarro2.length,
        perfil: 'fluvial',
      };

      state.modoFluvial = true;
      state.tramosFluviales = {
        tramos,
        carro1: coordsCarro1,
        carro2: coordsCarro2,
        po,
        pd,
        hub,
        distCarro1: rutaCarro1.distanciaMetros,
        distCarro2: rutaCarro2.distanciaMetros,
        distRio,
        durRio,
      };
      state.rutaBase = ruta;
      state.rutaActual = ruta;
      state.elevacion = elevacion;
      state.altimetriaGeo = geojsonPerfil;
      state.altimetriaTotalKm = totalDist / 1000;
      AltimetriaModule.setDatos(geojsonPerfil, state.elevacion, state.altimetriaTotalKm);

      sincronizarOrden();
      let idxIntermedio = 0;
      const mapaEtiquetas = new Map();
      state.orden.forEach((o) => {
        if (o.tipo === 'escala') {
          const dragE = state.escalas.find((e) => e.id === o.id);
          if (dragE && dragE._dragGenerated) return;
        }
        const etiqueta = etiquetaIntermedia(idxIntermedio++);
        const key = o.tipo + '_' + o.id;
        mapaEtiquetas.set(key, etiqueta);
        if (o.tipo === 'escala') {
          const e = state.escalas.find((e) => e.id === o.id);
          if (e && e.lat != null) e._numero = etiqueta;
        } else {
          const p = state.paradas.find((p) => p.id === o.id);
          if (p) p._numero = etiqueta;
        }
      });

      const routeLine = turf.lineString(geojsonPerfil.geometry.coordinates);
      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([e.lon, e.lat]), { units: 'kilometers' });
        e._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.lon, p.lat]), { units: 'kilometers' });
        p._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });

      // Puertos en el perfil: salida, (conexión) y llegada.
      const puertos = [{ p: po }, ...(hub ? [{ p: hub }] : []), { p: pd }];
      puertos.forEach(({ p }) => {
        if (!p) return;
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.longitud, p.latitud]), { units: 'kilometers' });
        AltimetriaModule.agregarParada(p.latitud, p.longitud, p.nombre, nearest.properties.location || 0, '🚢', 'puerto_' + p.id, 'puerto');
      });

      MapModule.dibujarRuta(geojsonMapa, {
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        origenNombre: state.origen?.nombre || 'el origen',
      });
      MapModule.dibujarTramoFluvial(tramos);
      MapModule.setMarcadoresPuertos([
        { p: po, titulo: 'Salida' },
        ...(hub ? [{ p: hub, titulo: 'Conexión' }] : []),
        { p: pd, titulo: 'Llegada' },
      ]);
      MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
      MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);
      MapModule.setMarcadoresEscalas(state.escalas);
      MapModule.setMarcadoresParadas(state.paradas);
      MapModule.setMarcadoresPuntosDesvio(state.escalas);
      MapModule.encuadrar(geojsonMapa);

      const distTexto = Utils.formatearDistancia(totalDist);
      const durTexto = Utils.formatearDuracion(totalDur);
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = distTexto;
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = durTexto;
      renderizarParadas();
      _actualizarBotonFluvial();
      sincronizarModoRutaMovil();
    } catch (err) {
      console.warn('Error al calcular ruta fluvial', err);
      _mostrarNotificacion('No se pudo calcular la ruta por río');
    } finally {
      ponerEnCargaRuta(false);
    }
  }

  // -------------------------------------------------------------------
  // Filtro espacial + render de sitios sobre el mapa (solo al aplicar)
  // -------------------------------------------------------------------

  async function construirRutaConDesvios(rutaBase, paradas) {
    if (!rutaBase || paradas.length === 0) return rutaBase;

    const baseLine = turf.lineString(rutaBase.geojson.geometry.coordinates);

    const results = await Promise.all(paradas.map(async (p) => {
      const nearest = turf.nearestPointOnLine(baseLine, turf.point([p.lon, p.lat]));
      const [nearestLon, nearestLat] = nearest.geometry.coordinates;
      try {
        const rutaDesvio = await RoutingModule.calcularRuta(
          { lat: nearestLat, lon: nearestLon },
          { lat: p.lat, lon: p.lon },
          PERFIL_FIJO
        );
        return {
          index: nearest.properties.index,
          detourCoords: rutaDesvio.geojson.geometry.coordinates,
          detourDist: rutaDesvio.distanciaMetros,
          detourDur: rutaDesvio.duracionSegundos,
        };
      } catch {
        return { id: p.id, error: true };
      }
    }));

    let coords = rutaBase.geojson.geometry.coordinates.slice();
    let distanciaExtra = 0;
    let tiempoExtra = 0;
    const idsFallidos = [];
    let offsetAccum = 0;

    for (const r of results) {
      if (r.error) {
        idsFallidos.push(r.id);
        continue;
      }
      const adjustedIndex = r.index + offsetAccum;
      const before = coords.slice(0, adjustedIndex + 1);
      const after = coords.slice(adjustedIndex + 1);
      const returnCoords = r.detourCoords.slice().reverse();
      coords = [...before, ...r.detourCoords, ...returnCoords, ...after];
      offsetAccum += r.detourCoords.length * 2;
      distanciaExtra += r.detourDist * 2;
      tiempoExtra += r.detourDur * 2;
    }

    return {
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
      },
      distanciaMetros: rutaBase.distanciaMetros + Math.round(distanciaExtra),
      duracionSegundos: rutaBase.duracionSegundos + Math.round(tiempoExtra),
      idsFallidos,
    };
  }


  async function aplicarRutaConDesvios(opciones = {}) {
    if (!state.rutaBase) return;
    // En modo aéreo/fluvial no hay desvíos por carretera: la ruta es la base (MultiLineString).
    state.rutaActual = (state.modoAereo || state.modoFluvial)
      ? state.rutaBase
      : await construirRutaConDesvios(state.rutaBase, state.paradas);

    let iteraciones = 0;
    if (!state.modoAereo && !state.modoFluvial) {
      while (state.rutaActual.idsFallidos && state.rutaActual.idsFallidos.length > 0 && iteraciones < 3) {
        const idsSet = new Set(state.rutaActual.idsFallidos);
        state.paradas = state.paradas.filter((p) => !idsSet.has(p.id));
        renderizarParadas();
        state.rutaActual = await construirRutaConDesvios(state.rutaBase, state.paradas);
        iteraciones++;
      }
    }

    MapModule.dibujarRuta(state.rutaActual.geojson, {
      distanciaMetros: state.rutaActual.distanciaMetros,
      duracionSegundos: state.rutaActual.duracionSegundos,
      origenNombre: state.origen?.nombre || 'el origen',
    });
    if (state.modoAereo && state.tramosAereo) {
      MapModule.dibujarTramoAereo(state.tramosAereo.vuelos || []);
      const ta = state.tramosAereo;
      MapModule.setMarcadoresAeropuertos([
        { ap: ta.apOri, titulo: 'Salida' },
        ...(ta.hub ? [{ ap: ta.hub, titulo: 'Conexión' }] : []),
        { ap: ta.apDes, titulo: 'Llegada' },
      ]);
    }
    if (state.modoFluvial && state.tramosFluviales) {
      MapModule.dibujarTramoFluvial(state.tramosFluviales.tramos || []);
      const tf = state.tramosFluviales;
      MapModule.setMarcadoresPuertos([
        { p: tf.po, titulo: 'Salida' },
        ...(tf.hub ? [{ p: tf.hub, titulo: 'Conexión' }] : []),
        { p: tf.pd, titulo: 'Llegada' },
      ]);
    }

    // Enable drag-to-reroute with current waypoints
    const waypointsCoords = [];
    if (state.origen) waypointsCoords.push([state.origen.lon, state.origen.lat]);
    state.orden.forEach(o => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find(e => e.id === o.id);
        if (e && e.lat != null) waypointsCoords.push([e.lon, e.lat]);
      } else {
        const p = state.paradas.find(p => p.id === o.id);
        if (p) waypointsCoords.push([p.lon, p.lat]);
      }
    });
    if (state.destino) waypointsCoords.push([state.destino.lon, state.destino.lat]);
    MapModule.habilitarArrastreRuta(waypointsCoords, onRutaDragEnd);
    MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
    MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);

    // Verificar advertencias de tramos peligrosos
    try { MapModule.limpiarAlertas(); } catch {}
    try {
      const totalKm = state.rutaActual.distanciaMetros / 1000;
      const alertas = RouteWarningsModule.verificar(state.rutaActual.geojson, totalKm);
      alertas.forEach((a) => {
        const coords = a.ruta.coordenadas;
        let lat, lng;
        if (coords && coords.length >= 2) {
          lng = (coords[0][0] + coords[coords.length - 1][0]) / 2;
          lat = (coords[0][1] + coords[coords.length - 1][1]) / 2;
        } else {
          lat = a.lnglat[1];
          lng = a.lnglat[0];
        }
        MapModule.mostrarAlertaRuta([lat, lng], a.mensaje, a.color);
      });
    } catch {}

    // Almacenar datos para altimetría (elevación se carga bajo demanda)
    const totalKm = state.rutaBase ? state.rutaBase.distanciaMetros / 1000 : 0;
    const geoPerfil = (state.modoAereo || state.modoFluvial) && state.altimetriaGeo
      ? state.altimetriaGeo
      : (state.rutaBase ? state.rutaBase.geojson : state.rutaActual.geojson);
    if (state.rutaBase && state.rutaBase.elevacion) {
      state.elevacion = state.rutaBase.elevacion;
    }
    // Si la base no trae elevación (carga bajo demanda), se conserva la ya cargada
    // para que el perfil no se borre al recalcular tras quitar/añadir paradas.
    state.altimetriaGeo = geoPerfil;
    state.altimetriaTotalKm = totalKm;
    AltimetriaModule.setDatos(geoPerfil, state.elevacion, totalKm);
    if (state.origen) AltimetriaModule.setExtremos(formatMunicipio(state.origen), state.destino ? formatMunicipio(state.destino) : 'Destino');
    sincronizarOrden();
    let idxIntermedio = 0;
    const mapaEtiquetas = new Map();
    state.orden.forEach((o) => {
      if (o.tipo === 'escala') {
        const dragE = state.escalas.find((e) => e.id === o.id);
        if (dragE && dragE._dragGenerated) return;
      }
      const etiqueta = etiquetaIntermedia(idxIntermedio++);
      const key = o.tipo + '_' + o.id;
      mapaEtiquetas.set(key, etiqueta);
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (e && e.lat != null) e._numero = etiqueta;
      } else {
        const p = state.paradas.find((p) => p.id === o.id);
        if (p) p._numero = etiqueta;
      }
    });

    if (geoPerfil) {
      const routeLine = turf.lineString(geoPerfil.geometry.coordinates);
      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([e.lon, e.lat]), { units: 'kilometers' });
        e._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.lon, p.lat]), { units: 'kilometers' });
        p._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });
    }
    // El perfil no se reconstruye al calcular la ruta: se carga bajo demanda al abrirlo.
    MapModule.setMarcadoresEscalas(state.escalas);
    MapModule.setMarcadoresParadas(state.paradas);
    MapModule.setMarcadoresPuntosDesvio(state.escalas);
    // Al añadir/quitar paradas el mapa no debe cambiar de posición.
    if (!opciones.mantenerMapa) MapModule.encuadrar(state.rutaActual.geojson);
    const distTexto = Utils.formatearDistancia(state.rutaActual.distanciaMetros);
    const durTexto = Utils.formatearDuracion(state.rutaActual.duracionSegundos);
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = distTexto;
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = durTexto;
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Re-filtrar sitios después de cambios en la ruta (invalida cachés)
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // Agregar un sitio como desvío (calcula ruta por OSRM ida y vuelta)
  // -------------------------------------------------------------------
