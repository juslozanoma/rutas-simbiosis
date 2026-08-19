/**
 * escalas.js
 * ---------------------------------------------------------------------------
 * Pueblos intermedios (escalas): creación/edición/eliminación, orden de la
 * ruta, modos "cambiar origen/destino" y puntos de desvío.
 * ---------------------------------------------------------------------------
 */

  function initEscalas() {
    el.btnAgregarEscala.addEventListener('click', () => {
      UndoManager.registrar();
      agregarEscala();
    });
  }


  function agregarEscala(datos = null) {
    const row = document.createElement('div');
    row.className = 'escala-row';

    const combo = MunicipioCombo.crear({
      placeholder: 'Pueblo intermedio',
      lineas: 6, // 6 opciones visibles (pueblo intermedio)
      clases: ['escala-trigger'],
      scope: row, // clic fuera de la fila cierra el menú
      excluirIds: () => {
        // Un pueblo puede repetir cualquier punto anterior salvo el inmediatamente
        // anterior (el pueblo previo confirmado, o el origen si es el primero).
        const ids = new Set();
        const confirmadas = state.escalas.filter((e) => e.lat != null);
        const idx = confirmadas.findIndex((e) => e._row === row);
        let prev = null;
        if (idx === -1) {
          // Fila nueva (aún sin confirmar): se agrega al final, detrás de la última.
          prev = confirmadas.length ? confirmadas[confirmadas.length - 1] : state.origen;
        } else if (idx === 0) {
          prev = state.origen;
        } else {
          prev = confirmadas[idx - 1];
        }
        if (prev && prev.id != null) ids.add(prev.id);
        return ids;
      },
      onSelect: (m) => {
        // Registra el pueblo en state.escalas sin calcular OSRM: el usuario
        // elige después si el tramo es por carro (botón verde) o avión.
        actualizarEscalas();
        _mostrarAvisoTransporte(row);
      },
      onEnter: () => {
        // Igual que onSelect: no se recalcula hasta elegir carro o avión.
        actualizarEscalas();
        _mostrarAvisoTransporte(row);
      },
    });

    row.appendChild(combo.combo);
    row._comboId = combo.id;

    const calcBtn = document.createElement('button');
    calcBtn.type = 'button';
    calcBtn.className = 'escala-row__calc';
    calcBtn.title = 'Calcular ruta con este pueblo intermedio';
    calcBtn.setAttribute('aria-label', 'Calcular ruta con este pueblo intermedio');
    calcBtn.innerHTML = `
      <img class="icon-btn__icon" src="/car.svg" alt="" width="18" height="18" style="filter:brightness(0) invert(1);">`;

    row.appendChild(calcBtn);

    // Botón de avión: calcula la ruta completa en modo aéreo pasando por este
    // pueblo intermedio (carro→aeropuerto→vuelo→aeropuerto→carro).
    const aereoBtn = document.createElement('button');
    aereoBtn.type = 'button';
    aereoBtn.className = 'escala-row__calc escala-row__aereo';
    aereoBtn.title = 'Calcular la ruta en avión pasando por este pueblo';
    aereoBtn.setAttribute('aria-label', 'Calcular la ruta en avión pasando por este pueblo');
    aereoBtn.innerHTML = `
      <svg class="icon-btn__icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

    row.appendChild(aereoBtn);
    el.panelEscalas.appendChild(row);
    el.panelEscalas.hidden = false;
    // Al restaurar un snapshot de deshacer/rehacer se repone el texto y la
    // selección de la fila sin abrir la lista ni mover el foco.
    if (datos && datos._valorTexto != null) {
      combo.trigger.value = datos._valorTexto;
      if (datos._selectedId) combo.trigger.dataset.selectedId = datos._selectedId;
      else delete combo.trigger.dataset.selectedId;
    } else {
      // La fila nueva abre su lista al insertarla en el documento (abrir con el
      // rect ya calculado); el focus despliega el teclado en móvil.
      combo.abrir();
      combo.trigger.focus();
      combo.trigger.scrollIntoView({ block: 'nearest' });
    }

    calcBtn.addEventListener('click', () => {
      UndoManager.registrar();
      actualizarEscalas();
      // Con "Organizar" activo y ruta ya calculada se ordena por distancia y se
      // recalcula conservando paradas; en cualquier otro caso se recalcula igual.
      const autoOrganizar = !el.btnAutoOrganizar || el.btnAutoOrganizar.getAttribute('aria-pressed') === 'true';
      if (autoOrganizar && state.rutaActual) {
        organizarAutomaticamente();
      } else {
        calcularRutaPrincipal(false, { ocultarTestigoSitios: true });
      }
    });

    aereoBtn.addEventListener('click', () => {
      UndoManager.registrar();
      actualizarEscalas();
      calcularRutaAerea();
    });

    state.escalas.push({ _row: row });
    return row;
  }


  /** Muestra bajo los botones de transporte (carro/avión) de un pueblo
   *  intermedio un aviso para que el usuario elija el medio de transporte.
   *  La flecha superior del aviso apunta a esos botones. */
  function _mostrarAvisoTransporte(row) {
    const previo = row.querySelector('.escala-row__aviso');
    if (previo) previo.remove();
    const aviso = document.createElement('div');
    aviso.className = 'escala-row__aviso';
    aviso.setAttribute('role', 'tooltip');
    aviso.textContent = 'Selecciona tu transporte';
    row.appendChild(aviso);
    // Se cierra al interactuar con la fila o pasados unos segundos.
    const cerrar = () => {
      const existente = row.querySelector('.escala-row__aviso');
      if (existente) existente.remove();
    };
    row.addEventListener('click', cerrar, { once: true });
    aviso.addEventListener('click', (e) => { e.stopPropagation(); cerrar(); });
    setTimeout(cerrar, 7000);
  }


  /** Desregistra en React los cuadros de las filas de escala que vayan a
   *  eliminarse (innerHTML='' de panelEscalas o limpiarCuadrosEscala), para que
   *  la lista de cada cuadro se desmonte antes de borrar el DOM. */
  function _deregistrarCombosEscala() {
    const ui = window.SimbiosisUI;
    if (!ui || typeof ui.deregistrarCombo !== 'function') return;
    document.querySelectorAll('.escala-row').forEach((row) => {
      const id = row._comboId;
      if (id) {
        ui.deregistrarCombo(id);
        delete row._comboId;
      }
    });
  }

  /** Elimina los cuadros de entrada de los pueblos intermedios pendientes
   *  (ya quedaron registrados en state.escalas y dentro de la ruta/perfil): se
   *  quitan sus filas del panel y se libera la referencia `_row`. */
  function limpiarCuadrosEscala() {
    _deregistrarCombosEscala();
    state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
    state.escalas.forEach((e) => { delete e._row; });
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
    UndoManager.registrar();
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
      delete s.distanciaOrigenDesvioKm;
      delete s._offsetLado;
    });
    MapModule.limpiarSitios();
    _borrarListadoDescubre();

    await calcularRutaPrincipal(true);
    renderizarParadas();
  }

  /** Elimina un punto de desvío de la ruta conservando la pestaña Descubre. */

  function eliminarPuntoDesvio(escalaId) {
    UndoManager.registrar();
    const idx = state.escalas.findIndex((e) => e.id === escalaId);
    if (idx === -1) return;
    state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s.distanciaOrigenDesvioKm; delete s._offsetLado; });
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
    UndoManager.registrar();
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
      delete s.distanciaOrigenDesvioKm;
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
    UndoManager.registrar();
    const idx = state.escalas.findIndex((e) => e.id === id);
    if (idx !== -1) state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      if (recalcular) {
        state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s.distanciaOrigenDesvioKm; delete s._offsetLado; });
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
    if (el.btnFluvial) el.btnFluvial.hidden = activo;
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
    agregarEscala();
    el.panelEscalas.scrollIntoView({ block: 'nearest' });
  }

  /** Lleva al usuario al panel Ruta con un nuevo campo de pueblo intermedio desplegado. */

  function agregarPuebloIntermedioDesdeLista() {
    UndoManager.registrar();
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
    if (!state.origen) return;
    sincronizarOrden();
    // El reparto manual de días pierde sentido al reordenar automáticamente.
    if (state.diasOrden) state.diasOrden = {};

    // Criterio de cercanía mutua (vecino más cercano): se parte del origen A y
    // se elige el punto más cercano a él (B), luego el más cercano a B (C), y
    // así sucesivamente hasta agotar los puntos intermedios; el destino Z queda
    // siempre al final.
    const puntos = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((ee) => ee.id === o.id);
        if (!e || e.lat == null) return null;
        return { tipo: 'escala', id: o.id, lat: Number(e.lat), lon: Number(e.lon) };
      }
      const p = state.paradas.find((pp) => pp.id === o.id);
      if (!p || p.lat == null) return null;
      return { tipo: 'parada', id: o.id, lat: Number(p.lat), lon: Number(p.lon) };
    }).filter(Boolean);

    if (puntos.length) {
      const ordenados = [];
      const restantes = puntos.slice();
      let actual = { lat: Number(state.origen.lat), lon: Number(state.origen.lon) };
      while (restantes.length) {
        let mejor = 0;
        let mejorDist = Infinity;
        for (let i = 0; i < restantes.length; i++) {
          const d = turf.distance(
            turf.point([actual.lon, actual.lat]),
            turf.point([restantes[i].lon, restantes[i].lat]),
            { units: 'kilometers' }
          );
          if (d < mejorDist) { mejorDist = d; mejor = i; }
        }
        ordenados.push(restantes.splice(mejor, 1)[0]);
        actual = ordenados[ordenados.length - 1];
      }
      state.orden = ordenados.map(({ tipo, id }) => ({ tipo, id }));
    } else {
      state.orden = [];
    }

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
      delete s.distanciaOrigenDesvioKm;
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
    UndoManager.registrar();
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
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s.distanciaOrigenDesvioKm; delete s._offsetLado; });
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
