/**
 * altimetriaApp.js
 * ---------------------------------------------------------------------------
 * Integración de la altimetría con la aplicación: abrir/cerrar el perfil y
 * cargar la elevación de la ruta actual.
 * ---------------------------------------------------------------------------
 */

  function _prepararCoordenadasParaElevacion(coords, maxPuntos = 50) {
    const total = coords.length;
    if (total <= maxPuntos) {
      return {
        coordenadas: coords.map((c) => [c[1], c[0]]),
        indices: coords.map((_, i) => i),
      };
    }
    const step = Math.ceil(total / maxPuntos);
    const coordenadas = [];
    const indices = [];
    for (let i = 0; i < total; i += step) {
      coordenadas.push([coords[i][1], coords[i][0]]);
      indices.push(i);
    }
    if (indices[indices.length - 1] !== total - 1) {
      coordenadas.push([coords[total - 1][1], coords[total - 1][0]]);
      indices.push(total - 1);
    }
    return { coordenadas, indices };
  }


  function _reconstruirElevacion(elevaciones, indices, totalCoords) {
    const result = new Array(totalCoords).fill(null);
    for (let i = 0; i < indices.length; i++) {
      result[indices[i]] = elevaciones[i];
    }
    let lastKnown = -1;
    for (let i = 0; i < result.length; i++) {
      if (result[i] != null) {
        if (lastKnown >= 0 && i > lastKnown + 1) {
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
    await _cargarElevacionAltimetria('altimetria-chart');
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
  }


  async function _cargarElevacionAltimetria(containerId) {
    const chart = document.getElementById(containerId);
    if (!chart) return;
    if (!state.elevacion || !state.elevacion.some((e) => e != null)) {
      chart.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-muted);font-size:0.85rem;"><svg class="spinner-bike" viewBox="0 0 48 30" style="width:120px;height:75px;"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"><g transform="translate(9.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(24,19)"><g class="spinner-bike_pedals-spin" stroke-dasharray="25.133 25.133" stroke-dashoffset="-21.991" transform="rotate(67.5,0,0)"><circle class="spinner-bike_pedals" r="4"></circle><circle class="spinner-bike_pedals" r="4" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(38.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><polyline class="spinner-bike_seat" points="14 3,18 3" stroke-dasharray="5 5"></polyline><polyline class="spinner-bike_body" points="16 3,24 19,9.5 19,18 8,34 7,24 19" stroke-dasharray="79 79"></polyline><path class="spinner-bike_handlebars" d="m30,2h6s1,0,1,1-1,1-1,1" stroke-dasharray="10 10"></path><polyline class="spinner-bike_front" points="32.5 2,38.5 19" stroke-dasharray="19 19"></polyline></g></svg><span>Consultando datos de elevación…</span></div>';
      const geo = state.altimetriaGeo;
      if (geo && geo.geometry && geo.geometry.coordinates) {
        try {
          const coords = geo.geometry.coordinates;
          const { coordenadas, indices } = _prepararCoordenadasParaElevacion(coords);
          const elevBatch = await Utils.obtenerElevacionBatch(coordenadas);
          if (elevBatch.some((e) => e != null)) {
            state.elevacion = _reconstruirElevacion(elevBatch, indices, coords.length);
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
  // Cálculo de la ruta principal (solo al pulsar el botón)
  // -------------------------------------------------------------------
