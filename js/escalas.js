/**
 * escalas.js
 * ---------------------------------------------------------------------------
 * Pueblos intermedios (escalas): creación/edición/eliminación, orden de la
 * ruta, modos "cambiar origen/destino" y puntos de desvío.
 * ---------------------------------------------------------------------------
 */

  function initEscalas() {
    el.btnAgregarEscala.addEventListener('click', () => {
      agregarEscala();
    });
  }


  function agregarEscala() {
    const row = document.createElement('div');
    row.className = 'escala-row';

    const combo = MunicipioCombo.crear({
      placeholder: 'Pueblo intermedio',
      lineas: 5, // 5 opciones visibles (pueblo intermedio)
      clases: ['escala-trigger'],
      scope: row, // clic fuera de la fila cierra el menú
      excluirIds: () => {
        const ids = new Set();
        if (state.origen?.id) ids.add(state.origen.id);
        if (state.destino?.id) ids.add(state.destino.id);
        state.escalas.forEach((e) => { if (e.id != null && e._row !== row) ids.add(e.id); });
        return ids;
      },
      onSelect: (m) => {
        actualizarEscalas();
        // El cuadro solo se oculta cuando los cuadros de origen/destino ya no
        // están en pantalla (ruta calculada); al inicio permanece visible.
        row.style.display = el.appRoot && el.appRoot.getAttribute('data-ruta-lista') === 'true' ? 'none' : '';
        if (el.checkAutoOrganizar.checked) organizarAutomaticamente(true);
        // Recalcular la ruta (OSRM) automáticamente al elegir el pueblo:
        // - Móvil: siempre (al agregar o cambiar), si auto-organizar ya no recalcó.
        // - Cambio de pueblo en cualquier dispositivo: recalcular sin doble cálculo.
        const recalcAuto = () => {
          if (!state.rutaActual || !el.checkAutoOrganizar.checked) {
            calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
          }
        };
        if (_escalaEnCambio) {
          _escalaEnCambio = false;
          recalcAuto();
        } else if (esMovil()) {
          recalcAuto();
        }
      },
      onEnter: () => {
        actualizarEscalas();
        calcularRutaPrincipal(false, { ocultarTestigoSitios: true });
      },
    });

    row.appendChild(combo.combo);

    const calcBtn = document.createElement('button');
    calcBtn.type = 'button';
    calcBtn.className = 'escala-row__calc';
    calcBtn.title = 'Calcular ruta con este pueblo intermedio';
    calcBtn.setAttribute('aria-label', 'Calcular ruta con este pueblo intermedio');
    calcBtn.innerHTML = `
      <svg class="icon-btn__icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      <span class="icon-btn__spinner" aria-hidden="true"></span>`;

    row.appendChild(calcBtn);
    el.panelEscalas.appendChild(row);
    el.panelEscalas.hidden = false;
    // El foco abre la lista, el teclado y el acomodo del bloque (un solo
    // movimiento instantáneo), igual que el cuadro de origen al iniciar.
    combo.trigger.focus();
    combo.trigger.scrollIntoView({ block: 'nearest' });

    calcBtn.addEventListener('click', () => {
      actualizarEscalas();
      calcularRutaPrincipal(false, { ocultarTestigoSitios: true });
    });

    state.escalas.push({ _row: row });
    return row;
  }


  async function actualizarEscalas() {
    state.escalas.forEach((e) => {
      if (!e._row) return;
      const input = e._row.querySelector('.combo__trigger');
      if (!input || !input.value.trim()) return;
      const nombre = input.dataset.selectedId ? input.value.trim() : null;
      if (!nombre) return;
      const m = state.municipios.find((mun) => mun.nombre === nombre || (mun.nombre + ', ' + mun.departamento) === nombre);
      if (m) {
        Object.assign(e, m);
      } else {
        const partes = nombre.split(',').map((s) => parseFloat(s.trim()));
        if (partes.length === 2 && !isNaN(partes[0]) && !isNaN(partes[1])) {
          Object.assign(e, { id: 'map_' + Date.now(), lat: partes[0], lon: partes[1], nombre, departamento: '' });
        }
      }
    });
    actualizarEstadoBotonCalcular();
  }

  // -------------------------------------------------------------------
  // Categorías: extracción, menú flotante y filtrado
  // -------------------------------------------------------------------

  async function onRutaDragEnd(lnglat, segIdx) {
    const [lng, lat] = lnglat;
    const id = 'drag_' + Date.now();
    const escala = { id, lat, lon: lng, nombre: 'Punto intermedio', _dragGenerated: true };

    // Count how many escalas exist up to segIdx in state.orden
    let escalaCount = 0;
    for (let i = 0; i < segIdx && i < state.orden.length; i++) {
      if (state.orden[i]?.tipo === 'escala') escalaCount++;
    }

    // Insert as a waypoint (escala) so OSRM recalculates the route through it
    state.escalas.splice(escalaCount, 0, escala);
    state.orden.splice(segIdx, 0, { tipo: 'escala', id });

    // Invalidate cached distances so sites refilter on next request
    state.sitios.forEach((s) => {
      delete s.distanciaRutaKm;
      delete s.tiempoDesvioMin;
      delete s.distanciaOrigenKm;
      delete s.distanciaDestinoKm;
      delete s._offsetLado;
    });
    MapModule.limpiarSitios();
    _borrarListadoDescubre();

    await calcularRutaPrincipal(true);
    renderizarParadas();
  }

  /** Elimina un punto de desvío de la ruta conservando la pestaña Descubre. */

  function eliminarPuntoDesvio(escalaId) {
    const idx = state.escalas.findIndex((e) => e.id === escalaId);
    if (idx === -1) return;
    state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      MapModule.limpiarSitios();
      _borrarListadoDescubre();
      calcularRutaPrincipal(true);
    } else {
      renderizarParadas();
    }
  }

  /** Abre el menú contextual de un punto de desvío (clic secundario / pulsación larga sobre el punto). */

  function abrirMenuPuntoDesvio(escalaId, clientX, clientY) {
    const opciones = [
      { etiqueta: 'Eliminar punto de desvío', accion: () => eliminarPuntoDesvio(escalaId) },
    ];
    abrirMenuFila(opciones, clientX, clientY);
  }

  /** Mueve un punto de desvío arrastrado y recalcula la ruta pasando por su nueva posición. */

  async function moverPuntoDesvio(escalaId, lat, lon) {
    const escala = state.escalas.find((e) => e.id === escalaId);
    if (!escala) return;
    escala.lat = lat;
    escala.lon = lon;

    // Invalidar distancias cacheadas de los sitios
    state.sitios.forEach((s) => {
      delete s.distanciaRutaKm;
      delete s.tiempoDesvioMin;
      delete s.distanciaOrigenKm;
      delete s.distanciaDestinoKm;
      delete s._offsetLado;
    });
    MapModule.limpiarSitios();
    _borrarListadoDescubre();

    await calcularRutaPrincipal(true);
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Sincronizar el orden combinado de escalas + paradas
  // -------------------------------------------------------------------

  function sincronizarOrden() {
    const escalas = state.escalas.filter((e) => e.lat != null);
    const idsEscalas = new Set(escalas.map((e) => e.id));
    const idsParadas = new Set(state.paradas.map((p) => p.id));

    state.orden = state.orden.filter((o) =>
      (o.tipo === 'escala' && idsEscalas.has(o.id)) ||
      (o.tipo === 'parada' && idsParadas.has(o.id))
    );

    const enOrden = new Set(state.orden.map((o) => o.tipo + '_' + o.id));

    let ultimaEscala = -1;
    for (let i = 0; i < state.orden.length; i++) {
      if (state.orden[i].tipo === 'escala') ultimaEscala = i;
    }

    for (const e of escalas) {
      if (!enOrden.has('escala_' + e.id)) {
        state.orden.splice(ultimaEscala + 1, 0, { tipo: 'escala', id: e.id });
        ultimaEscala++;
        enOrden.add('escala_' + e.id);
      }
    }
    for (const p of state.paradas) {
      if (!enOrden.has('parada_' + p.id)) {
        state.orden.push({ tipo: 'parada', id: p.id });
        enOrden.add('parada_' + p.id);
      }
    }
  }


  function eliminarEscala(id, recalcular = true) {
    const idx = state.escalas.findIndex((e) => e.id === id);
    if (idx !== -1) state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      if (recalcular) {
        state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
        // Al borrar un pueblo intermedio se invalidan el perfil (turf) y los
        // sitios del mapa junto con el listado de Descubre.
        _limpiarTurfYListado();
        calcularRutaPrincipal(true);
      } else {
        renderizarParadas();
      }
    } else {
      renderizarParadas();
    }
  }


  function irCambiarOrigen() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    el.appRoot.removeAttribute('data-ruta-lista');
    // Modo "solo cuadro de origen": se ocultan el "+", el cuadro de destino y
    // sus botones (avión y calcular ruta); solo queda el origen desplegado.
    _modoCambiarOrigen(true);
    _cambioExtremoEnCurso = 'origen';
    if (el.origenInput) {
      el.origenInput.value = '';
      delete el.origenInput.dataset.selectedId;
      el.origenInput.placeholder = 'Seleccionar nuevo origen';
    }
    const row = document.getElementById('row-origen');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /** Ocultar/mostrar el resto del panel Ruta al cambiar el origen: en el modo
   *  activo solo se ve el cuadro de origen (con su lista desplegada). */

  function _modoCambiarOrigen(activo) {
    if (el.btnAgregarEscala) el.btnAgregarEscala.hidden = activo;
    if (el.panelEscalas) el.panelEscalas.hidden = activo;
    const rowDestino = document.getElementById('row-destino');
    if (rowDestino) rowDestino.hidden = activo;
  }

  /** Ocultar/mostrar el resto del panel Ruta al cambiar el destino: en el modo
   *  activo solo se ve el cuadro de destino (sin el de origen, sin el avión y
   *  sin el botón de calcular ruta). */

  function _modoCambiarDestino(activo) {
    if (el.btnAgregarEscala) el.btnAgregarEscala.hidden = activo;
    if (el.panelEscalas) el.panelEscalas.hidden = activo;
    const rowOrigen = document.getElementById('row-origen');
    if (rowOrigen) rowOrigen.hidden = activo;
    if (el.btnAereo) el.btnAereo.hidden = activo;
    if (el.btnCalcular) el.btnCalcular.hidden = activo;
  }

  /** Lleva al usuario al panel Ruta con el campo de destino preparado para elegir
   *  el nuevo destino: vacío, con placeholder, sin foco (al tocar se despliega la
   *  lista normal de 5 opciones). */

  function irCambiarDestino() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    el.appRoot.removeAttribute('data-ruta-lista');
    // Si venía del modo "solo cuadro de origen", se restaura el panel completo.
    _modoCambiarOrigen(false);
    // Modo "solo cuadro de destino": sin el cuadro de origen, sin el avión y
    // sin el botón de calcular ruta; solo queda el destino desplegado.
    _modoCambiarDestino(true);
    _cambioExtremoEnCurso = 'destino';
    if (el.destinoInput) {
      el.destinoInput.value = '';
      delete el.destinoInput.dataset.selectedId;
      el.destinoInput.placeholder = 'Seleccionar nuevo destino';
    }
    const row = document.getElementById('row-destino');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }

  /** Lleva al usuario al panel Ruta con un nuevo campo de pueblo intermedio desplegado. */

  function reemplazarPuebloIntermedio() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    _escalaEnCambio = true;
    agregarEscala();
    el.panelEscalas.scrollIntoView({ block: 'nearest' });
  }

  /** Lleva al usuario al panel Ruta con un nuevo campo de pueblo intermedio desplegado. */

  function agregarPuebloIntermedioDesdeLista() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    agregarEscala();
    el.panelEscalas.scrollIntoView({ block: 'nearest' });
  }

  /** Reemplaza un pueblo intermedio: lo quita de la ruta y abre un nuevo campo editable en el panel Ruta. */

  function cambiarPueblo(escala) {
    // Sin recalcular: la ruta se recalcula cuando el usuario elige el nuevo pueblo,
    // así el campo recién abierto no se elimina por la limpieza asíncrona de filas.
    eliminarEscala(escala.id, false);
    reemplazarPuebloIntermedio();
  }

  /** Centra el mapa y muestra la ficha centrada de una parada (como la de un sitio). */

  async function organizarAutomaticamente(invalidarSitios = false) {
    if (!el.checkAutoOrganizar.checked) return;
    if (!state.origen) return;
    sincronizarOrden();
    const itemsConDistancia = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((ee) => ee.id === o.id);
        if (!e || e.lat == null) return null;
        const dist = FiltersModule.distanciaAOrigen(e, state.origen);
        if (dist == null) return null;
        return { ...o, distancia: dist };
      }
      const p = state.paradas.find((pp) => pp.id === o.id);
      if (!p) return null;
      const dist = p.distanciaOrigenKm ?? FiltersModule.distanciaAOrigen(p, state.origen);
      if (dist == null) return { ...o, distancia: Infinity };
      return { ...o, distancia: dist };
    }).filter(Boolean);

    itemsConDistancia.sort((a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity));
    state.orden = itemsConDistancia.map(({ tipo, id }) => ({ tipo, id }));

    const nuevasEscalas = state.orden
      .filter((o) => o.tipo === 'escala')
      .map((o) => state.escalas.find((e) => e.id === o.id))
      .filter(Boolean);
    const nuevasParadas = state.orden
      .filter((o) => o.tipo === 'parada')
      .map((o) => state.paradas.find((p) => p.id === o.id))
      .filter(Boolean);
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);

    if (state.rutaActual) {
      // Si cambió el trazado (p. ej. se agregó un pueblo intermedio), el tour de
      // Descubre queda obsoleto: se invalidan distancias cacheadas, se quitan los
      // marcadores del mapa y se borra el listado para que se recalcule con la
      // nueva ruta (al reabrir Descubre) en lugar de mostrar los sitios viejos.
      if (invalidarSitios) {
        state.sitios.forEach((s) => {
          delete s.distanciaRutaKm;
          delete s.tiempoDesvioMin;
          delete s.distanciaOrigenKm;
          delete s.distanciaDestinoKm;
          delete s._offsetLado;
        });
        MapModule.limpiarSitios();
        _borrarListadoDescubre();
      }
      await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
    }
    renderizarParadas();
  }


  async function reordenar(desde, hasta) {
    if (desde === hasta) return;
    sincronizarOrden();
    if (desde < 0 || desde >= state.orden.length || hasta < 0 || hasta >= state.orden.length) return;
    const movido = state.orden.splice(desde, 1)[0];
    state.orden.splice(hasta, 0, movido);

    const nuevasEscalas = state.orden
      .filter((o) => o.tipo === 'escala')
      .map((o) => state.escalas.find((e) => e.id === o.id))
      .filter(Boolean);
    const nuevasParadas = state.orden
      .filter((o) => o.tipo === 'parada')
      .map((o) => state.paradas.find((p) => p.id === o.id))
      .filter(Boolean);
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);

    if (movido.tipo === 'escala') {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      MapModule.limpiarSitios();
      _borrarListadoDescubre();
      await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
    } else {
      await aplicarRutaConDesvios();
    }
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Estado de carga contenido en el propio botón (sin mensajes flotantes)
  // -------------------------------------------------------------------
