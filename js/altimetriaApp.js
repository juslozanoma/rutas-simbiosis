/**
 * altimetriaApp.js
 * ---------------------------------------------------------------------------
 * Integración de la altimetría con la aplicación: abrir/cerrar el perfil y
 * cargar la elevación de la ruta actual.
 * ---------------------------------------------------------------------------
 */

  function _prepararCoordenadasParaElevacion(coords, maxPuntos = 2000, pasoKm = 0.1) {
    // LineString (plano) o MultiLineString (varios tramos): se aplanan para
    // consultar la elevación en el mismo orden en que el perfil acumula km.
    const esMulti = coords && Array.isArray(coords[0]) && Array.isArray(coords[0][0]);
    const tramos = esMulti ? coords : [coords];
    const planas = esMulti ? coords.reduce((acc, tramo) => acc.concat(tramo), []) : coords;
    const total = planas.length;

    // Distancia acumulada continua por vértice (mismo criterio que el perfil
    // en altimetria.js `_acumular`), para interpolar la altura proporcional a
    // la distancia real recorrida y no al número de vértices.
    const dists = new Array(total).fill(0);
    let acc = 0;
    for (let i = 1; i < total; i++) {
      acc += turf.distance(turf.point(planas[i - 1]), turf.point(planas[i]), { units: 'kilometers' });
      dists[i] = acc;
    }

    // Rutas cortas: se consulta TODOS los vértices (máxima precisión, sin
    // interpolar). En rutas largas se muestrea por distancia.
    if (total <= maxPuntos) {
      const limites = [];
      const muestrasTramo = [];
      let accT = 0;
      for (let t = 0; t < tramos.length; t++) {
        limites.push(accT);
        for (let i = 0; i < tramos[t].length; i++) muestrasTramo.push(t);
        accT += tramos[t].length;
      }
      return {
        coordenadas: planas.map((p) => [p[1], p[0]]),
        muestrasD: dists.slice(),
        muestrasTramo,
        planas,
        dists,
        limites,
      };
    }

    // Muestreo UNIFORME por distancia: cada `pasoKm` km se genera un punto a lo
    // largo del tramo interpolando lon/lat entre vértices consecutivos, de modo
    // que el relieve se muestrea con resolución regular incluso en tramos rectos
    // con pocos vértices (p. ej. autopistas). `limites` guarda el índice de
    // inicio de cada tramo en la lista aplanada para que la interpolación no
    // cruce de un tramo a otro.
    const coordenadas = [];
    const muestrasD = [];
    const muestrasTramo = [];
    const limites = [];
    let accT = 0;
    for (let t = 0; t < tramos.length; t++) {
      const tramo = tramos[t];
      limites.push(accT);
      if (tramo.length >= 2) {
        coordenadas.push([tramo[0][1], tramo[0][0]]);
        muestrasD.push(dists[accT]);
        muestrasTramo.push(t);
        const finDist = dists[accT + tramo.length - 1];
        let prox = dists[accT] + pasoKm;
        for (let i = 1; i < tramo.length; i++) {
          const d0 = dists[accT + i - 1];
          const d1 = dists[accT + i];
          while (prox <= d1 + 1e-9) {
            const f = d1 > d0 ? (prox - d0) / (d1 - d0) : 0;
            const lon = tramo[i - 1][0] + f * (tramo[i][0] - tramo[i - 1][0]);
            const lat = tramo[i - 1][1] + f * (tramo[i][1] - tramo[i - 1][1]);
            coordenadas.push([lat, lon]);
            muestrasD.push(prox);
            muestrasTramo.push(t);
            prox += pasoKm;
          }
        }
        if (muestrasD[muestrasD.length - 1] < finDist - 1e-9) {
          coordenadas.push([tramo[tramo.length - 1][1], tramo[tramo.length - 1][0]]);
          muestrasD.push(finDist);
          muestrasTramo.push(t);
        }
      }
      accT += tramo.length;
    }

    // Si se supera `maxPuntos` se adelgazan puntos interiores uniformemente,
    // conservando siempre el inicio y el final de cada tramo.
    let idx = coordenadas.map((_, i) => i);
    if (idx.length > maxPuntos) {
      const conservar = new Set();
      let inicio = 0;
      for (let t = 0; t < tramos.length; t++) {
        const fin = inicio + tramos[t].length;
        if (tramos[t].length >= 2) {
          const m0 = muestrasD.findIndex((d, i) => muestrasTramo[i] === t && d === dists[fin - tramos[t].length]);
          const m1 = muestrasD.length - 1 - [...muestrasD].reverse().findIndex((d, i) => muestrasTramo[muestrasD.length - 1 - i] === t && d === dists[fin - 1]);
          if (m0 >= 0) conservar.add(m0);
          if (m1 >= 0) conservar.add(m1);
        }
        inicio = fin;
      }
      conservar.add(0);
      conservar.add(idx.length - 1);
      const interior = idx.filter((i) => !conservar.has(i));
      const paso = interior.length / Math.max(1, maxPuntos - conservar.size);
      const adelgazados = [];
      let cont = 0;
      for (let i = 0; i < interior.length; i++) {
        cont++;
        if (cont >= paso) { adelgazados.push(interior[i]); cont -= paso; }
      }
      idx = [...conservar, ...adelgazados].sort((x, y) => x - y);
    }

    return {
      coordenadas: idx.map((i) => coordenadas[i]),
      muestrasD: idx.map((i) => muestrasD[i]),
      muestrasTramo: idx.map((i) => muestrasTramo[i]),
      planas,
      dists,
      limites,
    };
  }


  function _reconstruirElevacion(elevaciones, muestrasD, muestrasTramo, planas, dists, limites) {
    const result = new Array(planas.length).fill(null);
    if (!planas.length) return result;

    const tramoDeVertice = (j) => {
      let t = 0;
      for (let k = 1; k < limites.length; k++) if (j >= limites[k]) t = k;
      return t;
    };

    // Agrupar muestras por tramo (ya vienen contiguas). Cada grupo queda
    // ordenado por distancia, y con un puntero por tramo se interpolan los
    // vértices en una sola pasada.
    const porTramo = [];
    for (let m = 0; m < muestrasD.length; m++) {
      const t = muestrasTramo[m];
      if (!porTramo[t]) porTramo[t] = { d: [], e: [] };
      porTramo[t].d.push(muestrasD[m]);
      porTramo[t].e.push(elevaciones[m]);
    }
    const ptr = new Array(porTramo.length).fill(0);
    for (let j = 0; j < planas.length; j++) {
      const t = tramoDeVertice(j);
      const grupo = porTramo[t];
      if (!grupo || grupo.d.length === 0) continue;
      const dj = dists[j];
      while (ptr[t] + 1 < grupo.d.length && grupo.d[ptr[t] + 1] <= dj + 1e-9) ptr[t]++;
      const a = ptr[t];
      const ea = grupo.e[a];
      if (ea == null) continue;
      result[j] = ea;
      if (a + 1 < grupo.d.length) {
        const eb = grupo.e[a + 1];
        if (eb != null) {
          const span = grupo.d[a + 1] - grupo.d[a];
          const f = span > 0 ? (dj - grupo.d[a]) / span : 0;
          result[j] = ea + f * (eb - ea);
        }
      }
    }
    return result;
  }


  async function toggleAltimetria() {
    if (!el.altimetriaPanel) return;
    const active = !el.altimetriaPanel.hidden;
    if (active) { cerrarAltimetria(); return; }
    el.altimetriaPanel.hidden = false;
    if (el.btnAltimetria) el.btnAltimetria.hidden = true;
    _activarSeguimientoConVuelos();
    _syncAltimetriaMapa();
    await _cargarElevacionAltimetria('altimetria-chart');
  }

  /** En una ruta con vuelos el mapa se encuadra lejísimos y conviene activar el
   *  seguimiento con zoom: el carro del perfil lleva la vista acercada a la ruta. */
  function _activarSeguimientoConVuelos() {
    const conVuelos = !!(state.modoAereo && state.tramosAereo && state.tramosAereo.apSegs && state.tramosAereo.apSegs.length);
    if (!conVuelos) return;
    if (AltimetriaModule.setFollowActivo) AltimetriaModule.setFollowActivo(true);
    if (typeof actualizarTextoSeguimiento === 'function') actualizarTextoSeguimiento();
  }


  /** El botón flotante de altimetría (PC) solo se muestra si hay una ruta
   *  calculada (state.rutaActual); en móvil la CSS lo oculta de todos modos. */
  function _syncBotonAltimetria() {
    if (!el.btnAltimetria) return;
    el.btnAltimetria.hidden = !state.rutaActual;
  }


  function cerrarAltimetria() {
    if (!el.altimetriaPanel) return;
    el.altimetriaPanel.hidden = true;
    _syncBotonAltimetria();
    _syncAltimetriaMapa();
  }

  /** Sincroniza la visibilidad de la flecha de dirección del mapa con la de la
   *  altimetría: mientras un perfil esté abierto (PC o móvil) el carro verde
   *  del perfil reemplaza la flecha de dirección sobre la ruta. */
  function _syncAltimetriaMapa() {
    const visible = (el.altimetriaPanel && !el.altimetriaPanel.hidden)
      || (el.altimetriaPanelMovil && !el.altimetriaPanelMovil.hidden);
    if (typeof MapModule !== 'undefined' && MapModule.setAltimetriaActiva) {
      MapModule.setAltimetriaActiva(visible);
    }
  }


  async function _cargarElevacionAltimetria(containerId) {
    _perfilVisibleEsRutaArchivo = false;
    const chart = document.getElementById(containerId);
    if (!chart) return;
    if (!state.elevacion || !state.elevacion.some((e) => e != null)) {
      chart.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-muted);font-size:0.85rem;"><svg class="spinner-bike" viewBox="0 0 48 30" style="width:120px;height:75px;"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"><g transform="translate(9.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(24,19)"><g class="spinner-bike_pedals-spin" stroke-dasharray="25.133 25.133" stroke-dashoffset="-21.991" transform="rotate(67.5,0,0)"><circle class="spinner-bike_pedals" r="4"></circle><circle class="spinner-bike_pedals" r="4" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(38.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><polyline class="spinner-bike_seat" points="14 3,18 3" stroke-dasharray="5 5"></polyline><polyline class="spinner-bike_body" points="16 3,24 19,9.5 19,18 8,34 7,24 19" stroke-dasharray="79 79"></polyline><path class="spinner-bike_handlebars" d="m30,2h6s1,0,1,1-1,1-1,1" stroke-dasharray="10 10"></path><polyline class="spinner-bike_front" points="32.5 2,38.5 19" stroke-dasharray="19 19"></polyline></g></svg><span>Consultando datos de elevación…</span></div>';
      const geo = state.altimetriaGeo;
      if (geo && geo.geometry && geo.geometry.coordinates) {
        try {
          const coords = geo.geometry.coordinates;
          const { coordenadas, muestrasD, muestrasTramo, planas, dists, limites } = _prepararCoordenadasParaElevacion(coords);
          const elevBatch = await Utils.obtenerElevacionBatch(coordenadas);
          if (elevBatch.some((e) => e != null)) {
            state.elevacion = _reconstruirElevacion(elevBatch, muestrasD, muestrasTramo, planas, dists, limites);
            AltimetriaModule.setDatos(geo, state.elevacion, state.altimetriaTotalKm, false);
          }
        } catch (err) {
          console.warn('[ALT] Error al cargar elevación:', err.message);
        }
      }
    }
    AltimetriaModule.renderizar(containerId);
  }

  // -------------------------------------------------------------------
  // Altimetría de una ruta cargada desde archivo (K): se muestra al pulsar
  // su ficha en la lista. Usa datos propios para no pisar la altimetría de
  // la ruta calculada (state.altimetriaGeo / state.elevacion).
  // -------------------------------------------------------------------

  let _geoRutaArchivo = null;      // geojson LineString de la ruta de archivo
  let _kmRutaArchivo = 0;
  let _elevacionRutaArchivo = null;
  let _perfilRutaArchivoId = null; // id de la ruta de archivo del perfil visible
  let _perfilVisibleEsRutaArchivo = false; // ¿la altimetría visible es de una ruta de archivo (K)?

  async function _cargarElevacionRutaArchivo(containerId) {
    _perfilVisibleEsRutaArchivo = true;
    if (!_geoRutaArchivo || !_geoRutaArchivo.geometry) return;
    const chart = document.getElementById(containerId);
    if (!chart) return;
    chart.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-muted);font-size:0.85rem;"><svg class="spinner-bike" viewBox="0 0 48 30" style="width:120px;height:75px;"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"><g transform="translate(9.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(24,19)"><g class="spinner-bike_pedals-spin" stroke-dasharray="25.133 25.133" stroke-dashoffset="-21.991" transform="rotate(67.5,0,0)"><circle class="spinner-bike_pedals" r="4"></circle><circle class="spinner-bike_pedals" r="4" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(38.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><polyline class="spinner-bike_seat" points="14 3,18 3" stroke-dasharray="5 5"></polyline><polyline class="spinner-bike_body" points="16 3,24 19,9.5 19,18 8,34 7,24 19" stroke-dasharray="79 79"></polyline><path class="spinner-bike_handlebars" d="m30,2h6s1,0,1,1-1,1-1,1" stroke-dasharray="10 10"></path><polyline class="spinner-bike_front" points="32.5 2,38.5 19" stroke-dasharray="19 19"></polyline></g></svg><span>Consultando datos de elevación…</span></div>';
    if (!_elevacionRutaArchivo || !_elevacionRutaArchivo.some((e) => e != null)) {
      try {
        const coords = _geoRutaArchivo.geometry.coordinates;
        const { coordenadas, muestrasD, muestrasTramo, planas, dists, limites } = _prepararCoordenadasParaElevacion(coords);
        const elevBatch = await Utils.obtenerElevacionBatch(coordenadas);
        if (elevBatch.some((e) => e != null)) {
          _elevacionRutaArchivo = _reconstruirElevacion(elevBatch, muestrasD, muestrasTramo, planas, dists, limites);
        }
      } catch (err) {
        console.warn('[ALT] Error al cargar elevación de la ruta de archivo:', err.message);
      }
    }
    AltimetriaModule.setDatos(_geoRutaArchivo, _elevacionRutaArchivo, _kmRutaArchivo, true);
    AltimetriaModule.setExtremos('Inicio de la ruta', 'Final de la ruta');
    AltimetriaModule.renderizar(containerId);
  }

  /** Muestra el perfil de elevación de una ruta cargada desde archivo (K):
   *  en escritorio abre el panel sobre el mapa y en móvil la pestaña. */
  function mostrarAltimetriaRutaArchivo(geo, totalKm, idRuta) {
    _geoRutaArchivo = geo;
    _kmRutaArchivo = totalKm;
    _perfilRutaArchivoId = idRuta || null;
    _elevacionRutaArchivo = null;
    if (esMovil()) {
      setMobileTab('altimetria');
      _cargarElevacionRutaArchivo('altimetria-chart-panel');
    } else {
      if (el.altimetriaPanel) el.altimetriaPanel.hidden = false;
      if (el.btnAltimetria) el.btnAltimetria.hidden = true;
      _cargarElevacionRutaArchivo('altimetria-chart');
    }
    _syncAltimetriaMapa();
  }

  /** ¿La altimetría visible corresponde a una ruta de archivo (K)? Sirve para
   *  refrescarla al instante cuando cambia la geometría (sentido, inicio/fin). */
  function altimetriaVisibleDeRutaArchivo() {
    return perfilRutaArchivoVisibleId() != null;
  }

  /** id de la ruta de archivo cuyo perfil está visible en este momento
   *  (null si no hay perfil de ruta de archivo visible). */
  function perfilRutaArchivoVisibleId() {
    if (!_perfilVisibleEsRutaArchivo || _geoRutaArchivo == null) return null;
    if (esMovil()) {
      const app = document.getElementById('app');
      return app && app.getAttribute('data-mobile-tab') === 'altimetria' ? _perfilRutaArchivoId : null;
    }
    return el.altimetriaPanel && !el.altimetriaPanel.hidden ? _perfilRutaArchivoId : null;
  }

  // -------------------------------------------------------------------
  // Cálculo de la ruta principal (solo al pulsar el botón)
  // -------------------------------------------------------------------
