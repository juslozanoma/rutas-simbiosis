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

    if (state.origen.id === state.destino.id && !state.escalas.some((e) => e.lat != null)) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'El origen y el destino deben ser municipios diferentes.';
      el.sitiosLista.hidden = true;
      return;
    }

    // Puntos consecutivos iguales romperían el ruteo (p. ej. un pueblo repetido
    // justo antes del destino).
    const puntosValidacion = [state.origen, ...state.escalas.filter((e) => e.lat != null), state.destino];
    for (let i = 1; i < puntosValidacion.length; i++) {
      const a = puntosValidacion[i - 1], b = puntosValidacion[i];
      if (a.id != null && b.id != null && a.id === b.id) {
        el.sitiosVacio.hidden = false;
        el.sitiosVacio.textContent = 'La ruta no puede tener dos puntos consecutivos iguales.';
        el.sitiosLista.hidden = true;
        return;
      }
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
        // Sin ruta por carretera (p. ej. San Andrés o la Amazonía): se prueba
        // el avión y, si tampoco hay conexión aérea, la ruta por río.
        console.warn('Ruta por carretera no disponible:', err.message);
        const antes = state.rutaActual;
        await calcularRutaAerea(true);
        if (state.rutaActual !== antes) return;
        await calcularRutaFluvial(true);
        if (state.rutaActual === antes) {
          _mostrarNotificacion('No se encontró una ruta por carretera, avión ni río entre el origen y el destino.');
        }
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

  /** Los `k` aeropuertos o puertos más cercanos a un punto, ordenados por
   *  distancia. Se usan como candidatos al buscar conexión, porque el más
   *  cercano puede no tener ruta hacia el otro extremo (p. ej. Medellín se
   *  sirve por EOH y por MDE). */
  function _infraCercanos(punto, lista, k) {
    if (!punto || !lista || !lista.length) return [];
    return lista
      .map((p) => ({ p, d: turf.distance(turf.point([punto.lon, punto.lat]), turf.point([p.longitud, p.latitud]), { units: 'kilometers' }) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, k)
      .map((x) => x.p);
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

  /** Aeropuertos del catálogo a los que `ap` llega directo (destinos_id). */
  function _conexionesDeAeropuerto(ap) {
    if (!ap || !ap.destinos_id) return [];
    const unicas = new Set();
    const res = [];
    for (const id of ap.destinos_id) {
      const h = state.aeropuertos.find((a) => String(a.id) === String(id));
      if (h && h !== ap && !unicas.has(String(h.id))) { unicas.add(String(h.id)); res.push(h); }
    }
    return res;
  }

  /** Puertos del catálogo a los que `p` llega directo (destinos_id). */
  function _conexionesDePuerto(p) {
    if (!p || !p.destinos_id) return [];
    const unicas = new Set();
    const res = [];
    for (const ref of p.destinos_id) {
      const h = _puertoPorRef(ref);
      if (h && h !== p && !unicas.has(String(h.id))) { unicas.add(String(h.id)); res.push(h); }
    }
    return res;
  }

  /** Resuelve una referencia de destinos_id de puerto: primero por id exacto
   *  y, si no coincide, por nombre (compatibilidad con JSONs antiguos). */
  function _puertoPorRef(ref) {
    if (ref == null) return null;
    const porId = state.puertos.find((p) => String(p.id) === String(ref));
    if (porId) return porId;
    return _puertoPorNombre(ref);
  }

  /** Genera una línea curva entre dos puertos para el tramo fluvial (o entre
   *  aeropuertos para el tramo aéreo). `meandros > 0` añade ondulaciones que
   *  imitan el cauce de un río (aproximación; sin geometría real del río). */

  function _arcCoords(a, b, meandros = 0) {
    const lon1 = Number(a.longitud), lat1 = Number(a.latitud);
    const lon2 = Number(b.longitud), lat2 = Number(b.latitud);
    const n = 36;
    const dLon = lon2 - lon1, dLat = lat2 - lat1;
    const len = Math.sqrt(dLon * dLon + dLat * dLat) || 1;
    const bulge = Math.min(Math.max(len * 0.12, 0.15), 4);
    const px = -dLat / len;
    const py = dLon / len;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let off = Math.sin(Math.PI * t);
      if (meandros > 0) {
        // Meandros con varias frecuencias para un cauce más natural.
        off += 0.5 * meandros * Math.sin(2 * Math.PI * t * 2 + 0.6) * Math.sin(Math.PI * t);
        off += 0.3 * meandros * Math.sin(2 * Math.PI * t * 4 + 1.3) * Math.sin(Math.PI * t);
        off += 0.15 * meandros * Math.sin(2 * Math.PI * t * 7 + 2.1) * Math.sin(Math.PI * t);
      }
      pts.push([lon1 + dLon * t + px * bulge * off, lat1 + dLat * t + py * bulge * off]);
    }
    return pts;
  }


  /** Distancia en km sobre la geometría del perfil (LineString o MultiLineString)
   *  del punto más cercano a (lon, lat). En modo aéreo/fluvial el perfil son
   *  los tramos de carretera separados (sin el trayecto de avión/río): la
   *  distancia se acumula en el mismo orden en que el perfil acumula km. */
  function _distKmEnPerfil(linea, lon, lat) {
    if (!linea || !linea.geometry) return 0;
    const coords = linea.geometry.coordinates;
    const tramos = linea.geometry.type === 'MultiLineString' ? coords : [coords];
    let acumulado = 0;
    let mejor = Infinity;
    for (const tramo of tramos) {
      if (!tramo || tramo.length < 2) continue;
      try {
        const nearest = turf.nearestPointOnLine(turf.lineString(tramo), turf.point([lon, lat]), { units: 'kilometers' });
        const d = (nearest.properties.location || 0) + acumulado;
        if (d < mejor) mejor = d;
      } catch {}
      acumulado += turf.length(turf.lineString(tramo), { units: 'kilometers' });
    }
    return mejor === Infinity ? 0 : mejor;
  }

  function _actualizarBotonAereo() {
    if (!el.btnAereo) return;
    el.btnAereo.setAttribute('aria-pressed', String(state.modoAereo));
    el.btnAereo.classList.toggle('icon-btn--active', state.modoAereo);
  }

  /** Aeropuertos de la ruta aérea para marcarlos en el mapa, sin duplicados:
   *  cuando dos tramos encadenados comparten aeropuerto (la llegada de uno es
   *  la salida del siguiente en el pueblo intermedio) se marca una sola vez. */
  function _aeropuertosMarcables(apSegs) {
    const segs = (apSegs && apSegs.length)
      ? apSegs
      : [{ apOri: state.tramosAereo?.apOri, hub: state.tramosAereo?.hub, apDes: state.tramosAereo?.apDes }];
    const vistos = new Set();
    const res = [];
    segs.forEach((seg, i, arr) => {
      const items = [];
      if (seg.apOri) items.push({ ap: seg.apOri, titulo: i === 0 ? 'Salida' : 'Conexión' });
      if (seg.hub) items.push({ ap: seg.hub, titulo: 'Conexión' });
      if (seg.apDes) items.push({ ap: seg.apDes, titulo: i === arr.length - 1 ? 'Llegada' : 'Conexión' });
      items.forEach((it) => {
        const k = String(it.ap.id);
        if (!vistos.has(k)) { vistos.add(k); res.push(it); }
      });
    });
    return res;
  }

  /** Calcula la ruta directamente en avión (carro→aeropuerto→vuelo→aeropuerto→carro).
   *  Con pueblos intermedios el trayecto se encadena: cada pueblo genera su
   *  propio tramo carro→vuelo→carro, y los tramos se enlazan en el aeropuerto
   *  más cercano de cada pueblo (p. ej. Bogotá → Medellín → Cartagena vuela
   *  Bogotá→EOH, EOH→CTG). */
  async function calcularRutaAerea(silencioso = false) {
    if (!state.origen || !state.destino) return;
    if (!state.aeropuertos || !state.aeropuertos.length) {
      if (!silencioso) _mostrarNotificacion('No hay datos de aeropuertos disponibles');
      return;
    }
    cerrarAltimetria();
    // Se prueban los aeropuertos más cercanos de cada extremo (hasta K) y se
    // elige el primer par con conexión; el más cercano puede no tener vuelos
    // hacia el otro extremo (p. ej. Bogotá→Medellín cae por EOH y sí por MDE).
    const K_AEROPUERTOS = 5;

    // Pueblos intermedios en orden de visita (los que ya tienen coordenadas).
    const paradasPueblo = state.escalas.filter((e) => e.lat != null && !e._dragGenerated);
    const puntos = [state.origen, ...paradasPueblo, state.destino];

    // Puntos consecutivos iguales romperían el planeo de vuelos.
    for (let i = 1; i < puntos.length; i++) {
      if (puntos[i].id != null && puntos[i - 1].id != null && puntos[i].id === puntos[i - 1].id) {
        _mostrarNotificacion('La ruta no puede tener dos puntos consecutivos iguales.');
        return;
      }
    }

    // Por cada par consecutivo se planea el vuelo carro→aeropuerto→vuelo→aeropuerto→carro.
    const apSegs = [];
    for (let i = 0; i < puntos.length - 1; i++) {
      const a = puntos[i], b = puntos[i + 1];
      let apOri = null, apDes = null, pares = null;
      for (const candDes of _infraCercanos(b, state.aeropuertos, K_AEROPUERTOS)) {
        for (const candOri of _infraCercanos(a, state.aeropuertos, K_AEROPUERTOS)) {
          const p = _planearVuelos(candOri, candDes);
          if (p && p.length) { apOri = candOri; apDes = candDes; pares = p; break; }
        }
        if (pares) break;
      }
      if (!apOri || !apDes || !pares || !pares.length) {
        // Sin conexión aérea: si existe una ruta por río, se usa en su lugar
        // (sin avisar del avión).
        if (puntos.length === 2) {
          const antes = state.rutaActual;
          await calcularRutaFluvial(true);
          if (state.rutaActual !== antes) return;
        }
        if (!silencioso) _mostrarNotificacion('No se encontró una conexión aérea completa para la ruta');
        return;
      }
      apSegs.push({ a, b, apOri, apDes, hub: pares.length > 1 ? pares[0].b : null, pares });
    }

    ponerEnCargaRuta(true);
    try {
      // Rutas en carro de todos los tramos (todas en paralelo).
      const carros = await Promise.all(
        apSegs.flatMap((seg) => [
          RoutingModule.calcularRuta(seg.a, { lat: seg.apOri.latitud, lon: seg.apOri.longitud }, 'driving'),
          RoutingModule.calcularRuta({ lat: seg.apDes.latitud, lon: seg.apDes.longitud }, seg.b, 'driving'),
        ]),
      );

      const vuelosT = [];
      const tramosCarro = [];
      const elevacion = [];
      let totalDist = 0, totalDur = 0, distAvion = 0, durAvion = 0, vertices = 0;

      apSegs.forEach((seg, i) => {
        const rutaCarro1 = carros[i * 2];
        const rutaCarro2 = carros[i * 2 + 1];
        const coordsCarro1 = rutaCarro1.geojson.geometry.coordinates;
        const coordsCarro2 = rutaCarro2.geojson.geometry.coordinates;

        // Tramos de vuelo: directo o con conexión (definido por destinos_id).
        const vuelos = seg.pares.map(({ a, b }) => {
          const coords = _arcCoords(a, b);
          const dist = turf.length(turf.lineString(coords), { units: 'kilometers' }) * 1000;
          const dur = (dist / 1000) / 750 * 3600;
          return { coords, distanciaMetros: dist, duracionSegundos: dur, a, b };
        });
        seg.rutaCarro1 = rutaCarro1;
        seg.rutaCarro2 = rutaCarro2;
        seg.coordsCarro1 = coordsCarro1;
        seg.coordsCarro2 = coordsCarro2;
        seg.vuelos = vuelos;
        seg.distAvion = vuelos.reduce((s, v) => s + v.distanciaMetros, 0);
        seg.durAvion = vuelos.reduce((s, v) => s + v.duracionSegundos, 0);

        vuelosT.push(...vuelos);
        tramosCarro.push(coordsCarro1, coordsCarro2);
        elevacion.push(...(rutaCarro1.elevacion || []), ...(rutaCarro2.elevacion || []));
        totalDist += rutaCarro1.distanciaMetros + seg.distAvion + rutaCarro2.distanciaMetros;
        totalDur += rutaCarro1.duracionSegundos + seg.durAvion + rutaCarro2.duracionSegundos;
        distAvion += seg.distAvion;
        durAvion += seg.durAvion;
        vertices += coordsCarro1.length + coordsCarro2.length;
      });

      // Mapa: MultiLineString con los tramos en carro (sin líneas rectas
      // entre aeropuertos; los vuelos van punteados aparte).
      const geojsonMapa = {
        type: 'Feature',
        properties: { perfil: 'aereo' },
        geometry: { type: 'MultiLineString', coordinates: tramosCarro },
      };
      // Perfil: tramos en carro separados (sin el trayecto aéreo entre
      // aeropuertos): la línea de elevación no salta de un aeropuerto al otro.
      const geojsonPerfil = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: tramosCarro },
      };

      // Kilometraje del perfil: solo de carretera (sin vuelos).
      const totalKmPerfil = (totalDist - distAvion) / 1000;

      const ruta = {
        geojson: geojsonMapa,
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        vertices,
        perfil: 'aereo',
      };

      state.modoAereo = true;
      state.modoFluvial = false;
      state.tramosFluviales = null;
      _actualizarBotonFluvial();
      const primer = apSegs[0], ultimo = apSegs[apSegs.length - 1];
      state.tramosAereo = {
        vuelos: vuelosT,
        carro1: primer.coordsCarro1,
        carro2: ultimo.coordsCarro2,
        apOri: primer.apOri,
        apDes: ultimo.apDes,
        hub: primer.hub,
        distCarro1: primer.rutaCarro1.distanciaMetros,
        distCarro2: ultimo.rutaCarro2.distanciaMetros,
        distAvion,
        durAvion,
        apSegs,
      };
      state.rutaBase = ruta;
      state.rutaActual = ruta;
      state.elevacion = elevacion;
      state.altimetriaGeo = geojsonPerfil;
      state.altimetriaTotalKm = totalKmPerfil;
      AltimetriaModule.setDatos(geojsonPerfil, state.elevacion, state.altimetriaTotalKm);
      AltimetriaModule.setExtremos(formatMunicipio(state.origen), formatMunicipio(state.destino));
      // Extremos de cada tramo en carro (los botones numerados del perfil): los
      // pueblos de cada tramo; en los bordes de aeropuerto se usa su ciudad.
      AltimetriaModule.setSegmentosExtremos(apSegs.flatMap((seg, i, arr) => [
        [{ nombre: formatMunicipio(seg.a), tipo: i === 0 ? 'origen' : 'escala' },
         { nombre: seg.apOri.ciudad || 'Aeropuerto', tipo: 'aeropuerto' }],
        [{ nombre: seg.apDes.ciudad || 'Aeropuerto', tipo: 'aeropuerto' },
         { nombre: formatMunicipio(seg.b), tipo: i === arr.length - 1 ? 'destino' : 'escala' }],
      ]));

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

      paradasPueblo.forEach(e => {
        e._distKm = _distKmEnPerfil(geojsonPerfil, e.lon, e.lat);
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        p._distKm = _distKmEnPerfil(geojsonPerfil, p.lon, p.lat);
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });

      // Aeropuertos: ya no se marcan en el perfil (se sustituyen por los botones
      // numerados de segmentos en carro de la cabecera).

      MapModule.dibujarRuta(geojsonMapa, {
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        origenNombre: state.origen?.nombre || 'el origen',
      });
      MapModule.dibujarTramoAereo(vuelosT);
      MapModule.setMarcadoresAeropuertos(_aeropuertosMarcables(apSegs));
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

      // Los pueblos ya quedaron dentro de la ruta (en el perfil y las paradas):
      // se limpian sus cuadros de entrada para que no queden cuadros visibles
      // ni se acumulen al oprimir "+" de nuevo.
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      activarPanelTab('ruta');
      // Bug 1: el botón de altimetría debe quedar visible con la ruta aérea.
      _syncBotonAltimetria();
      // Bug 2: con la ruta aérea los sitios cercanos ya pueden filtrarse.
      _habilitarMostrarSitios();
    } catch (err) {
      console.warn('Error al calcular ruta aérea', err);
      if (!silencioso) _mostrarNotificacion('No se pudo calcular la ruta en avión');
    } finally {
      ponerEnCargaRuta(false);
    }
  }

  // -------------------------------------------------------------------
  // Ruta fluvial (río): tramos en carro hasta/desde los puertos + trayecto por río
  // -------------------------------------------------------------------


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
    const alcanza = (lista, pd) => (lista || []).some((d) => _puertoPorRef(d) === pd);
    if (alcanza(po.destinos_id, pd)) return [{ a: po, b: pd }];
    for (const ref of po.destinos_id || []) {
      const h = _puertoPorRef(ref);
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

  /** Geometría real del río entre dos puertos (a, b) usando Overpass (OSM).
   *  Prueba varios espejos; devuelve [[lon, lat], ...] o null si no se pudo
   *  obtener (offline, CORS, sin datos en la zona). */
  async function _geometriaRioOverpass(a, b) {
    const ENDPOINTS = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ];
    const dLon = Math.abs(Number(a.longitud) - Number(b.longitud));
    const dLat = Math.abs(Number(a.latitud) - Number(b.latitud));
    const margen = Math.max(dLon, dLat) * 0.15 + 0.06;
    const minLat = Math.min(a.latitud, b.latitud) - margen;
    const maxLat = Math.max(a.latitud, b.latitud) + margen;
    const minLon = Math.min(a.longitud, b.longitud) - margen;
    const maxLon = Math.max(a.longitud, b.longitud) + margen;
    const query = `[out:json][timeout:20];(way["waterway"="river"](${minLat},${minLon},${maxLat},${maxLon}););out geom;`;

    let data = null;
    const consultas = ENDPOINTS.map((base) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      return fetch(base + '?data=' + encodeURIComponent(query), { signal: ctrl.signal })
        .then((res) => { clearTimeout(t); return res.ok ? res.json() : null; })
        .catch(() => { clearTimeout(t); return null; });
    });
    data = await Promise.race([
      Promise.all(consultas).then((results) => results.find((r) => r && r.elements && r.elements.length) || null),
      new Promise((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    if (!data || !data.elements) return null;
    const ways = (data.elements || [])
      .filter((el) => el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2);
    if (!ways.length) return null;

    const coordsWay = (w) => w.geometry.map((g) => [g.lon, g.lat]);
    const keyNodo = (g) => g.lat.toFixed(6) + ',' + g.lon.toFixed(6);
    const keyW = (w) => 'w' + w.id;
    const pa = [Number(a.longitud), Number(a.latitud)];
    const pb = [Number(b.longitud), Number(b.latitud)];
    const distPtWay = (pt, w) => {
      let best = Infinity;
      for (const g of w.geometry) {
        const d = Math.hypot(g.lat - pt[1], g.lon - pt[0]);
        if (d < best) best = d;
      }
      return best;
    };
    const idxCercano = (w, pt) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < w.geometry.length; i++) {
        const d = Math.hypot(w.geometry[i].lat - pt[1], w.geometry[i].lon - pt[0]);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };

    let wA = null, wB = null, dA = Infinity, dB = Infinity;
    for (const w of ways) {
      const da = distPtWay(pa, w), db = distPtWay(pb, w);
      if (da < dA) { dA = da; wA = w; }
      if (db < dB) { dB = db; wB = w; }
    }
    if (!wA || !wB) return null;

    // Ambos extremos en la misma vía fluvial: extraer el sub-tramo.
    if (wA === wB) {
      const c = coordsWay(wA);
      const i1 = idxCercano(wA, pa), i2 = idxCercano(wA, pb);
      return i1 <= i2 ? c.slice(i1, i2 + 1) : c.slice(i2, i1 + 1);
    }

    // Grafo de vías conectadas por nodos extremos compartidos.
    const ady = new Map();
    ways.forEach((w) => ady.set(keyW(w), []));
    const nodoExtremos = new Map(); // keyNodo -> [[wayId, extremo], ...]
    ways.forEach((w) => {
      const e0 = keyNodo(w.geometry[0]), e1 = keyNodo(w.geometry[w.geometry.length - 1]);
      [[e0, 0], [e1, 1]].forEach(([k, ei]) => {
        if (!nodoExtremos.has(k)) nodoExtremos.set(k, []);
        nodoExtremos.get(k).push([keyW(w), ei]);
      });
    });
    nodoExtremos.forEach((lista) => {
      for (let i = 0; i < lista.length; i++) {
        for (let j = i + 1; j < lista.length; j++) {
          const x = lista[i][0], y = lista[j][0];
          if (x !== y) {
            if (!ady.get(x).includes(y)) ady.get(x).push(y);
            if (!ady.get(y).includes(x)) ady.get(y).push(x);
          }
        }
      }
    });

    // BFS desde wA hasta wB.
    const start = keyW(wA), goal = keyW(wB);
    const cola = [start];
    const padre = new Map([[start, null]]);
    let encontrado = false;
    while (cola.length) {
      const actual = cola.shift();
      if (actual === goal) { encontrado = true; break; }
      for (const vec of ady.get(actual) || []) {
        if (!padre.has(vec)) { padre.set(vec, actual); cola.push(vec); }
      }
    }
    if (!encontrado) return null;

    // Cadena de vías desde wA hasta wB.
    const cadenaKeys = [];
    let cur = goal;
    while (cur != null) { cadenaKeys.unshift(cur); cur = padre.get(cur); }
    const cadena = cadenaKeys.map((k) => ways.find((w) => keyW(w) === k));

    // Unir la cadena orientada, desde el vértice más cercano a A hasta el más
    // cercano a B.
    const resultado = [];
    for (let i = 0; i < cadena.length; i++) {
      const w = cadena[i];
      const c = coordsWay(w);
      if (i === 0) {
        const i0 = idxCercano(w, pa);
        if (cadena.length === 1) {
          const i1 = idxCercano(w, pb);
          return i0 <= i1 ? c.slice(i0, i1 + 1) : c.slice(i1, i0 + 1);
        }
        const sig = cadena[1];
        const e0 = keyNodo(w.geometry[0]), e1 = keyNodo(w.geometry[w.geometry.length - 1]);
        const conectadoA0 = nodoExtremos.has(e0) && nodoExtremos.get(e0).some(([wk]) => wk === keyW(sig));
        if (conectadoA0) for (let j = i0; j >= 0; j--) resultado.push(c[j]);
        else for (let j = i0; j < c.length; j++) resultado.push(c[j]);
      } else {
        const ult = resultado[resultado.length - 1];
        const dIni = Math.hypot(c[0][0] - ult[0], c[0][1] - ult[1]);
        const dFin = Math.hypot(c[c.length - 1][0] - ult[0], c[c.length - 1][1] - ult[1]);
        const adelante = dFin < dIni;
        if (i === cadena.length - 1) {
          const i1 = idxCercano(w, pb);
          if (adelante) for (let j = 0; j <= i1; j++) resultado.push(c[j]);
          else for (let j = c.length - 1; j >= i1; j--) resultado.push(c[j]);
        } else {
          if (adelante) for (const p of c) resultado.push(p);
          else for (let j = c.length - 1; j >= 0; j--) resultado.push(c[j]);
        }
      }
    }
    return resultado.length >= 2 ? resultado : null;
  }

  /** Une el extremo de un tramo en carro con el puerto fluvial si OSRM no lo
   *  alcanzó (el puerto está a la orilla del río, fuera de la red de carreteras).
   *  `lado` es 'inicio' (puerto→carretera) o 'final' (carretera→puerto). */
  function _unirPuertoACarretera(coords, puerto, lado) {
    if (!coords || !coords.length) return coords;
    const puertoCoord = [Number(puerto.longitud), Number(puerto.latitud)];
    const ref = lado === 'inicio' ? coords[0] : coords[coords.length - 1];
    const dist = turf.distance(turf.point(ref), turf.point(puertoCoord), { units: 'kilometers' });
    const UMBRAL = 0.1; // 100 m
    if (dist > UMBRAL) {
      if (lado === 'inicio') return [puertoCoord, ...coords];
      return [...coords, puertoCoord];
    }
    return coords;
  }

  /** Calcula la ruta por río (carro→puerto→trayecto fluvial→puerto→carro). */
  async function calcularRutaFluvial(silencioso = false) {
    if (!state.origen || !state.destino) return;
    if (!state.puertos || !state.puertos.length) {
      if (!silencioso) _mostrarNotificacion('No hay datos de puertos fluviales disponibles');
      return;
    }
    cerrarAltimetria();
    // Al elegir ruta por río se apaga el modo aéreo.
    state.modoAereo = false;
    state.tramosAereo = null;
    _actualizarBotonAereo();

    // Se prueban los puertos más cercanos de cada extremo (hasta K) y se elige
    // el primer par conectado por `destinos_id` (directo o con una conexión);
    // el más cercano puede estar en otra cuenca sin ruta al otro extremo.
    const K_PUERTOS = 6;
    let po = null, pd = null, pares = null;
    for (const candPd of _infraCercanos(state.destino, state.puertos, K_PUERTOS)) {
      for (const candPo of _infraCercanos(state.origen, state.puertos, K_PUERTOS)) {
        const p = _planearTrayectoFluvial(candPo, candPd);
        if (p && p.length) { po = candPo; pd = candPd; pares = p; break; }
      }
      if (pares) break;
    }
    if (!po || !pd || !pares || !pares.length) {
      if (!silencioso) _mostrarNotificacion('No se encontró un trayecto fluvial entre el origen y el destino');
      return;
    }
    const hub = pares.length > 1 ? pares[0].b : null;

    ponerEnCargaRuta(true);
    // Carretera origen→puerto y puerto→destino. En zonas sin carreteras
    // (p. ej. la Amazonía) OSRM falla: se completa con una línea recta de
    // acceso para que la ruta fluvial siempre se muestre.
    const _rutaCarroSegura = async (a, b) => {
      try {
        const r = await RoutingModule.calcularRuta(a, b, 'driving');
        return (r && r.geojson && r.geojson.geometry.coordinates.length >= 2) ? r : null;
      } catch (err) {
        return null;
      }
    };
    const [rutaCarro1, rutaCarro2] = await Promise.all([
      _rutaCarroSegura(state.origen, { lat: po.latitud, lon: po.longitud }),
      _rutaCarroSegura({ lat: pd.latitud, lon: pd.longitud }, state.destino),
    ]);

    try {
      // Carretera origen→puerto y puerto→destino, completando la carretera de
      // acceso al puerto si OSRM no la dibujó (el puerto está a la orilla).
      const coordsCarro1 = rutaCarro1
        ? _unirPuertoACarretera(rutaCarro1.geojson.geometry.coordinates, po, 'final')
        : [[state.origen.lon, state.origen.lat], [po.longitud, po.latitud]];
      const coordsCarro2 = rutaCarro2
        ? _unirPuertoACarretera(rutaCarro2.geojson.geometry.coordinates, pd, 'inicio')
        : [[pd.longitud, pd.latitud], [state.destino.lon, state.destino.lat]];
      const distCarro1 = turf.length(turf.lineString(coordsCarro1), { units: 'kilometers' }) * 1000;
      const distCarro2 = turf.length(turf.lineString(coordsCarro2), { units: 'kilometers' }) * 1000;

      // Tramos fluviales: directo o con conexión (definido por destinos_id),
      // con la geometría real del río (Overpass/OSM) y, si no se obtiene, una
      // curva con meandros.
      const tramos = [];
      for (const { a, b } of pares) {
        let coords = null;
        try { coords = await _geometriaRioOverpass(a, b); } catch (err) { coords = null; }
        if (coords && coords.length >= 2) {
          console.log('[fluvial] Geometría real del río (Overpass):', (a.nombre || a.id), '→', (b.nombre || b.id), coords.length, 'puntos');
        } else {
          coords = _arcCoords(a, b, 2);
          console.warn('[fluvial] Sin geometría real (Overpass no respondió): arco con meandros', (a.nombre || a.id), '→', (b.nombre || b.id));
        }
        const dist = turf.length(turf.lineString(coords), { units: 'kilometers' }) * 1000;
        const dur = (dist / 1000) / 25 * 3600; // río ≈ 25 km/h
        tramos.push({ coords, distanciaMetros: dist, duracionSegundos: dur, a, b });
      }
      const distRio = tramos.reduce((s, t) => s + t.distanciaMetros, 0);
      const durRio = tramos.reduce((s, t) => s + t.duracionSegundos, 0);

      // Mapa: MultiLineString con los tramos en carro (el río va punteado aparte).
      const geojsonMapa = {
        type: 'Feature',
        properties: { perfil: 'fluvial' },
        geometry: { type: 'MultiLineString', coordinates: [coordsCarro1, coordsCarro2] },
      };
      // Perfil: dos tramos en carro separados (sin el trayecto por río entre
      // puertos): la línea de elevación no salta de un puerto al otro.
      const geojsonPerfil = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiLineString', coordinates: [coordsCarro1, coordsCarro2] },
      };

      const elevacion = [...(rutaCarro1 ? rutaCarro1.elevacion || [] : []), ...(rutaCarro2 ? rutaCarro2.elevacion || [] : [])];
      const totalDist = distCarro1 + distRio + distCarro2;
      const durCarro1 = rutaCarro1 ? rutaCarro1.duracionSegundos : (distCarro1 / 1000) / 40 * 3600;
      const durCarro2 = rutaCarro2 ? rutaCarro2.duracionSegundos : (distCarro2 / 1000) / 40 * 3600;
      const totalDur = durCarro1 + durRio + durCarro2;
      // Kilometraje del perfil: solo de carretera (sin trayectos por río).
      const totalKmPerfil = (distCarro1 + distCarro2) / 1000;

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
        distCarro1,
        distCarro2,
        distRio,
        durRio,
      };
      state.rutaBase = ruta;
      state.rutaActual = ruta;
      state.elevacion = elevacion;
      state.altimetriaGeo = geojsonPerfil;
      state.altimetriaTotalKm = totalKmPerfil;
      AltimetriaModule.setDatos(geojsonPerfil, state.elevacion, state.altimetriaTotalKm);
      AltimetriaModule.setExtremos(formatMunicipio(state.origen), formatMunicipio(state.destino));
      // Extremos de cada tramo en carro (botones numerados del perfil).
      AltimetriaModule.setSegmentosExtremos([
        [{ nombre: formatMunicipio(state.origen), tipo: 'origen' },
         { nombre: po.ciudad || 'Puerto', tipo: 'puerto' }],
        [{ nombre: pd.ciudad || 'Puerto', tipo: 'puerto' },
         { nombre: formatMunicipio(state.destino), tipo: 'destino' }],
      ]);

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

      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        e._distKm = _distKmEnPerfil(geojsonPerfil, e.lon, e.lat);
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        p._distKm = _distKmEnPerfil(geojsonPerfil, p.lon, p.lat);
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });

      // Puertos en el perfil: salida, (conexión) y llegada. El símbolo 🚢 es el
      // mismo tanto para el puerto de salida como para el de llegada.
      const puertos = [{ p: po }, ...(hub ? [{ p: hub }] : []), { p: pd }];
      puertos.forEach(({ p }) => {
        if (!p) return;
        AltimetriaModule.agregarParada(p.latitud, p.longitud, p.nombre, _distKmEnPerfil(geojsonPerfil, p.longitud, p.latitud), '🚢', 'puerto_' + p.id, 'puerto');
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

      // Los pueblos intermedios no forman parte de la ruta por río: se limpian
      // sus cuadros de entrada y se sincronizan los botones, igual que en la
      // ruta aérea.
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      activarPanelTab('ruta');
      _syncBotonAltimetria();
      _habilitarMostrarSitios();
    } catch (err) {
      console.warn('Error al calcular ruta fluvial', err);
      if (!silencioso) _mostrarNotificacion('No se pudo calcular la ruta por río');
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
    if (typeof _syncBotonAltimetria === 'function') _syncBotonAltimetria();
    if (state.modoAereo && state.tramosAereo) {
      MapModule.dibujarTramoAereo(state.tramosAereo.vuelos || []);
      // Con tramos encadenados (apSegs) se marcan todos los aeropuertos;
      // si no hay apSegs (ruta calculada antes de este cambio) se usan los
      // aeropuertos directos de la ruta.
      MapModule.setMarcadoresAeropuertos(_aeropuertosMarcables(state.tramosAereo.apSegs));
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
    // En modo aéreo/fluvial el kilometraje del perfil es solo el de carretera.
    let totalKm;
    if (state.modoAereo && state.tramosAereo) {
      totalKm = (state.tramosAereo.distCarro1 + state.tramosAereo.distCarro2) / 1000;
    } else if (state.modoFluvial && state.tramosFluviales) {
      totalKm = (state.tramosFluviales.distCarro1 + state.tramosFluviales.distCarro2) / 1000;
    } else {
      totalKm = state.rutaBase ? state.rutaBase.distanciaMetros / 1000 : 0;
    }
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
      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        e._distKm = _distKmEnPerfil(geoPerfil, e.lon, e.lat);
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        p._distKm = _distKmEnPerfil(geoPerfil, p.lon, p.lat);
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
