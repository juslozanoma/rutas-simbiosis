/**
 * altimetriaApp.js
 * ---------------------------------------------------------------------------
 * Integración de la altimetría con la aplicación: abrir/cerrar el perfil y
 * cargar la elevación de la ruta actual.
 * ---------------------------------------------------------------------------
 */

  function _prepararCoordenadasParaElevacion(coords, maxPuntos = 300, pasoKm = 1.5) {
    // LineString (plano) o MultiLineString (varios tramos): se aplanan para
    // consultar la elevación en el mismo orden en que el perfil acumula km.
    const esMulti = coords && Array.isArray(coords[0]) && Array.isArray(coords[0][0]);
    const tramos = esMulti ? coords : [coords];
    const planas = esMulti ? coords.reduce((acc, tramo) => acc.concat(tramo), []) : coords;
    const total = planas.length;

    // Muestreo INDEPENDIENTE por tramo: cada segmento en carro se muestrea
    // desde su propio inicio cada `pasoKm` km (siempre con su primer y último
    // punto), de modo que la altura de un segmento no se mezcle con la del
    // siguiente en los aeropuertos/puertos. `limites` guarda el índice de
    // inicio de cada tramo en la lista aplanada para que la interpolación no
    // cruce de un tramo a otro.
    const indices = [];
    const limites = [];
    let accT = 0;
    for (const tramo of tramos) {
      limites.push(accT);
      if (tramo.length >= 2) {
        indices.push(accT); // inicio del tramo
        let acc = 0;
        let prox = pasoKm;
        for (let i = 1; i < tramo.length; i++) {
          acc += turf.distance(turf.point(tramo[i - 1]), turf.point(tramo[i]), { units: 'kilometers' });
          if (acc >= prox) {
            indices.push(accT + i);
            prox += pasoKm;
          }
        }
        indices.push(accT + tramo.length - 1); // fin del tramo
      }
      accT += tramo.length;
    }

    // Si se supera `maxPuntos` se adelgazan puntos interiores uniformemente,
    // conservando siempre el inicio y el final de cada tramo.
    let muestras = indices;
    if (indices.length > maxPuntos) {
      const conservar = new Set([0, total - 1]);
      let a = 0;
      for (const tramo of tramos) {
        if (tramo.length >= 2) { conservar.add(a); conservar.add(a + tramo.length - 1); }
        a += tramo.length;
      }
      const interior = indices.filter((i) => !conservar.has(i));
      const paso = Math.max(1, interior.length / Math.max(1, maxPuntos - conservar.size));
      const adelgazados = [];
      let cont = 0;
      for (let i = 0; i < interior.length; i++) {
        cont++;
        if (cont >= paso) { adelgazados.push(interior[i]); cont = 0; }
      }
      muestras = [...conservar, ...adelgazados].sort((x, y) => x - y);
    }

    const coordenadas = muestras.map((i) => [planas[i][1], planas[i][0]]);
    return { coordenadas, indices: muestras, total, limites };
  }


  function _reconstruirElevacion(elevaciones, indices, totalCoords, limites) {
    const result = new Array(totalCoords).fill(null);
    for (let i = 0; i < indices.length; i++) {
      result[indices[i]] = elevaciones[i];
    }
    // Dos índices están en el mismo tramo si no hay un límite entre ellos; así
    // la interpolación no cruza de un segmento en carro al siguiente.
    const mismoTramo = (a, b) => {
      if (!limites || limites.length < 2) return true;
      for (const l of limites) {
        if (l > a && l <= b) return false;
      }
      return true;
    };
    let lastKnown = -1;
    for (let i = 0; i < result.length; i++) {
      if (result[i] != null) {
        if (lastKnown >= 0 && i > lastKnown + 1 && mismoTramo(lastKnown, i)) {
          const start = result[lastKnown];
          const end = result[i];
          const span = i - lastKnown;
          for (let j = lastKnown + 1; j < i; j++) {
            result[j] = start + (end - start) * ((j - lastKnown) / span);
          }
        }
        lastKnown = i;
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
          const { coordenadas, indices, total, limites } = _prepararCoordenadasParaElevacion(coords);
          const elevBatch = await Utils.obtenerElevacionBatch(coordenadas);
          if (elevBatch.some((e) => e != null)) {
            state.elevacion = _reconstruirElevacion(elevBatch, indices, total, limites);
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
        const { coordenadas, indices, limites } = _prepararCoordenadasParaElevacion(coords);
        const elevBatch = await Utils.obtenerElevacionBatch(coordenadas);
        if (elevBatch.some((e) => e != null)) {
          _elevacionRutaArchivo = _reconstruirElevacion(elevBatch, indices, coords.length, limites);
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
