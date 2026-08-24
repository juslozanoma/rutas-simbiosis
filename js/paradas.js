/**
 * paradas.js
 * ---------------------------------------------------------------------------
 * Listado de paradas (escalas + sitios agregados + extremos + aeropuertos),
 * menús contextuales y fichas informativas de cada elemento de la ruta.
 * ---------------------------------------------------------------------------
 */

// Menú contextual de filas (paradas, escalas, catálogo, marcadores): las
// opciones con sus acciones quedan en vanilla y React (MenuFila) solo las
// pinta y delega al hacer clic.
let _menuFilaOpciones = null; // [{ etiqueta, accion }] o null si está cerrado
let _menuFilaX = 0;
let _menuFilaY = 0;
// Catálogo de puertos/aeropuertos/departamentos/municipios/categorías/frontera:
// el listado lo renderiza React (InfraListado, portal a #paradas-lista); aquí
// solo se guarda el snapshot con los descriptores de cada tarjeta.
let _infraSnapshot = null; // [{ id, tipo, nombre, sub, sufijo, rio, activa, idx }] o [{ hint, texto }]

  async function agregarParada(sitio, boton) {
    UndoManager.registrar();
    if (boton) ponerEnCarga(boton, true);
    state.paradas.push(sitio);
    const map = MapModule.getMap();
    const center = map.getCenter();
    const zoom = map.getZoom();
    try {
      if (!el.btnAutoOrganizar || el.btnAutoOrganizar.getAttribute('aria-pressed') === 'true') {
        await organizarAutomaticamente();
      } else {
        await aplicarRutaConDesvios();
        renderizarParadas();
      }
      map.setView(center, zoom, { animate: false });
      limpiarPreview();
      // Actualiza la tarjeta en su lugar (resaltado + botón "−") sin recargar la lista.
      _marcarSitioAgregadoEnLista(sitio);
      MapModule.quitarMarcadorSitio(sitio.id);
    } finally {
      if (boton) ponerEnCarga(boton, false);
    }
  }

  /** Cambia en el lugar la tarjeta de un sitio a "ya agregado" (resaltado y
   *  botón −). Las tarjetas las renderiza React (SitiosLista): se notifica al
   *  puente y el componente re-renderiza leyendo state.paradas. */

  function _marcarSitioAgregadoEnLista(sitio) {
    _notificarListaSitios();
  }

  /** Quita de la ruta un sitio agregado y restaura su tarjeta a "+" en su lugar. */

  async function quitarSitioDeLaRuta(sitio, card, boton) {
    if (boton) ponerEnCarga(boton, true);
    await eliminarParada(sitio.id);
    if (boton) ponerEnCarga(boton, false);
  }

  // -------------------------------------------------------------------
  // Arrastre de tramo en el mapa (reruteo)
  // -------------------------------------------------------------------


  /** Número que muestra la tarjeta del sitio en el listado de Descubre (o null). */
  function _numeroListaSitio(sitio) {
    const card = el.sitiosLista.querySelector(`[data-sitio-id="${String(sitio.id)}"]`);
    if (!card) return null;
    const num = card.querySelector('.sitio-card__num');
    if (!num) return null;
    const texto = (num.textContent || '').replace(/[.\s]/g, '');
    return texto === '' ? null : texto;
  }

  async function eliminarParada(sitioId) {
    UndoManager.registrar();
    const idx = state.paradas.findIndex((p) => p.id === sitioId);
    if (idx === -1) return;
    const sitio = state.paradas[idx];
    state.paradas.splice(idx, 1);
    sincronizarOrden();
    // Quitar un sitio turístico no afecta el listado de Descubre ni los
    // marcadores de sitios: solo se recalcula la ruta sin ese desvío.
    if (state.rutaActual) {
      await aplicarRutaConDesvios({ mantenerMapa: true });
    }
    renderizarParadas();
    MapModule.setMarcadoresParadas(state.paradas);
    if (sitio) {
      _restaurarSitioEnLista(sitio);
      if (sitio.lat != null && sitio.lon != null) {
        MapModule.agregarMarcadorSitio(TourismModule.crearMarcador(sitio, _numeroListaSitio(sitio)));
      }
    }
  }

  /** Restaura la tarjeta de un sitio a "agregar" (+) sin recargar el listado:
   *  se notifica a React (SitiosLista) y el componente re-renderiza. */

  function _restaurarSitioEnLista(sitio) {
    _notificarListaSitios();
  }

  // -------------------------------------------------------------------
  // Deslizar una ficha hacia la derecha (móvil) para borrar la parada
  // -------------------------------------------------------------------

  /** Habilita el gesto de deslizar la ficha a la derecha para borrar la
   *  parada (origen, destino, pueblo intermedio, sitio turístico, aeropuerto
   *  o puerto). Un deslizamiento rápido no activa el retardo de 150 ms del
   *  drag & drop de Sortable, así que ambos gestos conviven sin conflicto. */
  function _initSwipeBorrarParadas() {
    if (typeof esMovil !== 'function' || !esMovil()) return;
    el.paradasLista.querySelectorAll('.parada-item:not(.parada-item--dia):not(.parada-item--continua)').forEach((li) => {
      if (li._swipeBorrarListo) return;
      li._swipeBorrarListo = true;
      const tipo = li.dataset.tipoParada;
      const id = li.dataset.paradaId != null ? li.dataset.paradaId : null;

      li.addEventListener('pointerdown', (evt) => {
        if (evt.pointerType === 'mouse') return;
        if (li.classList.contains('sortable-chosen')) return;
        _swipeBorrar = {
          li,
          tipo,
          id,
          startX: evt.clientX,
          startY: evt.clientY,
          deslizando: false,
        };
        try { li.setPointerCapture(evt.pointerId); } catch (e) {}
      });

      li.addEventListener('pointermove', (evt) => {
        const g = _swipeBorrar;
        if (!g || g.li !== li) return;
        // Sortable tomó el gesto (arrastre de reordenación): se anula el swipe.
        if (li.classList.contains('sortable-chosen')) { _restaurarSwipeBorrar(); return; }
        const dx = evt.clientX - g.startX;
        const dy = evt.clientY - g.startY;
        // Desplazamiento vertical: es un scroll, no un borrado.
        if (!g.deslizando) {
          if (dy > 12 || dy < -12) { _swipeBorrar = null; return; }
          if (dx < 8) return;
          g.deslizando = true;
        }
        const dxFinal = Math.max(0, dx);
        li.classList.add('parada-item--deslizando', 'parada-item--borrar');
        li.style.transform = 'translateX(' + dxFinal + 'px)';
        if (dxFinal >= 64) li.classList.add('parada-item--borrar-listo');
      });

      const finalizar = (evt) => {
        const g = _swipeBorrar;
        _swipeBorrar = null;
        if (!g || g.li !== li) return;
        const dx = evt && typeof evt.clientX === 'number' ? evt.clientX - g.startX : 0;
        if (g.deslizando && dx >= 64) {
          _borrarParadaDeslizada(li, g.tipo, g.id);
        } else {
          li.classList.remove('parada-item--deslizando', 'parada-item--borrar', 'parada-item--borrar-listo');
          li.style.transform = '';
        }
      };

      li.addEventListener('pointerup', finalizar);
      li.addEventListener('pointercancel', finalizar);
    });
  }

  /** Restaura la ficha deslizada a su posición original (sin borrar). */
  function _restaurarSwipeBorrar() {
    const g = _swipeBorrar;
    _swipeBorrar = null;
    if (!g) return;
    g.li.classList.remove('parada-item--deslizando', 'parada-item--borrar', 'parada-item--borrar-listo');
    g.li.style.transform = '';
  }

  /** Borra la parada tras deslizarla a la derecha, según su tipo. */
  function _borrarParadaDeslizada(li, tipo, id) {
    // Suprime el clic sintético que sigue al gesto sobre la misma ficha.
    _suprimirProximoClic = true;
    setTimeout(() => { _suprimirProximoClic = false; }, 700);
    if (tipo === 'parada') { eliminarParada(id); return; }
    if (tipo === 'escala') { eliminarEscala(id); return; }
    if (tipo === 'origen') { quitarOrigenDeLaRuta(); return; }
    if (tipo === 'destino') { quitarDestinoDeLaRuta(); return; }
    if (tipo === 'aeropuerto') { quitarAeropuertoDeLaRuta(); return; }
    if (tipo === 'puerto') { quitarPuertoDeLaRuta(); return; }
  }

  /** Borra el origen deslizando su ficha: la segunda parada pasa a ser el origen. */
  async function quitarOrigenDeLaRuta() {
    sincronizarOrden();
    const nuevo = _ordenMovible();
    if (nuevo.length < 3) {
      _mostrarNotificacion('No se puede quitar el origen sin paradas intermedias.');
      return;
    }
    UndoManager.registrar();
    try {
      await _aplicarOrdenNuevo(nuevo.slice(1));
    } catch (err) {
      console.warn('[paradas] Error al quitar el origen:', err);
    }
  }

  /** Borra el destino deslizando su ficha: la penúltima parada pasa a ser el destino. */
  async function quitarDestinoDeLaRuta() {
    sincronizarOrden();
    const nuevo = _ordenMovible();
    if (nuevo.length < 3) {
      _mostrarNotificacion('No se puede quitar el destino sin paradas intermedias.');
      return;
    }
    UndoManager.registrar();
    try {
      nuevo.pop();
      await _aplicarOrdenNuevo(nuevo);
    } catch (err) {
      console.warn('[paradas] Error al quitar el destino:', err);
    }
  }

  /** Borra un aeropuerto deslizando su ficha: se calcula la ruta habitual por
   *  carretera sin preferencia por avión; si no hay alternativa, la ruta en
   *  avión vuelve a aparecer por sí sola. */
  async function quitarAeropuertoDeLaRuta() {
    UndoManager.registrar();
    state.modoAereo = false;
    state.tramosAereo = null;
    state.modoFluvial = false;
    state.tramosFluviales = null;
    if (typeof _actualizarBotonAereo === 'function') _actualizarBotonAereo();
    if (typeof _actualizarBotonFluvial === 'function') _actualizarBotonFluvial();
    await _recalcularTrasQuitarTransporte();
  }

  /** Borra un puerto deslizando su ficha: se calcula la ruta habitual por
   *  carretera sin preferencia por río; si no hay alternativa, la ruta por río
   *  (o avión) vuelve a aparecer por sí sola. */
  async function quitarPuertoDeLaRuta() {
    UndoManager.registrar();
    state.modoAereo = false;
    state.tramosAereo = null;
    state.modoFluvial = false;
    state.tramosFluviales = null;
    if (typeof _actualizarBotonAereo === 'function') _actualizarBotonAereo();
    if (typeof _actualizarBotonFluvial === 'function') _actualizarBotonFluvial();
    await _recalcularTrasQuitarTransporte();
  }

  /** Recalcula la ruta por carretera tras quitar el transporte (avión/río). */
  async function _recalcularTrasQuitarTransporte() {
    state.sitios.forEach((s) => {
      delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm;
      delete s.distanciaDestinoKm; delete s.distanciaOrigenDesvioKm; delete s._offsetLado;
    });
    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    if (typeof calcularRutaPrincipal === 'function') {
      try {
        await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
      } catch (err) {
        console.warn('[paradas] Error al recalcular la ruta sin transporte:', err);
      }
    }
    renderizarParadas();
  }


  function cerrarMenuFila() {
    _menuFilaOpciones = null;
    _notificarMenuFila();
  }


  function abrirMenuFila(opciones, clientX, clientY) {
    cerrarMenuFila();
    // El menú lo renderiza React (MenuFila, portal a document.body); aquí solo
    // se guardan las opciones (con sus acciones e ícono opcional) y la
    // posición y se notifica.
    _menuFilaOpciones = (opciones || []).map((op) => ({
      etiqueta: op.etiqueta,
      accion: op.accion,
      icono: op.icono,
    }));
    _menuFilaX = clientX;
    _menuFilaY = clientY;
    _notificarMenuFila();
  }


  document.addEventListener('click', (evt) => {
    // Clic sintético posterior a una pulsación larga (iOS): se ignora para
    // que no cierre el menú contextual recién abierto. La bandera se limpia
    // sola a los 700 ms (ver engancharLongPress y map.js).
    if (_suprimirProximoClic) return;
    const menuEl = document.querySelector('.fila-menu');
    if (menuEl && !menuEl.contains(evt.target)) cerrarMenuFila();
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') cerrarMenuFila();
  });

  /** Pulsación larga en móvil (≈550 ms) que abre el menú contextual de la fila. */

  function engancharLongPress(li, alDisparar) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let disparado = false;

    li.addEventListener('touchstart', (evt) => {
      if (evt.touches.length !== 1) return;
      disparado = false;
      const t = evt.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      timer = setTimeout(() => {
        disparado = true;
        _suprimirProximoClic = true;
        setTimeout(() => { _suprimirProximoClic = false; }, 700);
        navigator.vibrate && navigator.vibrate(20);
        alDisparar({ clientX: t.clientX, clientY: t.clientY });
      }, 550);
    }, { passive: true });

    li.addEventListener('touchmove', (evt) => {
      if (!timer) return;
      const t = evt.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        clearTimeout(timer);
        timer = null;
      }
    }, { passive: true });

    li.addEventListener('touchend', (evt) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (disparado) evt.preventDefault();
    });

    li.addEventListener('touchcancel', () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (disparado) { disparado = false; }
    });
  }

  /** Botón hamburguesa a la izquierda de la letra de una fila: abre el mismo
   *  menú contextual que el clic derecho en PC. En móvil es la única vía para
   *  abrir ese menú (ya no se abre con pulsación larga sobre la parada). */
  function crearBotonMenuFila(construirOpciones, li, numEl, etiquetaAria) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'parada-item__hamburger';
    btn.title = 'Opciones';
    btn.setAttribute('aria-label', 'Opciones de ' + (etiquetaAria || 'la parada'));
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    btn.addEventListener('click', (evt) => {
      evt.stopPropagation();
      const rect = btn.getBoundingClientRect();
      abrirMenuFila(construirOpciones(), rect.left, rect.bottom + 4);
    });
    btn.addEventListener('contextmenu', (evt) => {
      evt.preventDefault();
      evt.stopPropagation();
    });
    li.insertBefore(btn, numEl);
    return btn;
  }

  /** Clic derecho en PC abre el menú contextual de una fila; en táctil la
   *  pulsación larga del navegador (contextmenu) solo se suprime: el menú se
   *  abre únicamente con el botón hamburguesa de la fila. */
  function _abrirContextoParada(evt, construirOpciones) {
    evt.preventDefault();
    if (evt.pointerType === 'touch' || evt.pointerType === 'pen') return;
    abrirMenuFila(construirOpciones(), evt.clientX, evt.clientY);
  }

  // -------------------------------------------------------------------
  // Días de viaje: nombre y fecha personalizados
  // -------------------------------------------------------------------

  const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  let _observadorParadas = null; // re-mide el marquee al volver visible el panel
  let _sortablesParadas = [];    // instancias de Sortable de la lista de paradas
  let _swipeBorrar = null;       // gesto activo de deslizar a la derecha para borrar una ficha

  /** Marca los nombres largos (incluyendo distancias) para que el texto se
   *  desplace dentro de la ficha y pueda leerse completo. */
  function _marcarMarqueeParadas() {
    if (!el.paradasLista) return;
    el.paradasLista.querySelectorAll('.parada-item__nombre').forEach((nom) => {
      const inner = nom.querySelector('.parada-item__marquee');
      if (!inner) return;
      if (nom.clientWidth < 1) return;
      const overflow = inner.scrollWidth - nom.clientWidth;
      if (overflow > 1) {
        nom.classList.add('parada-item__nombre--marquee');
        nom.style.setProperty('--overflow', -(overflow) + 'px');
      } else {
        nom.classList.remove('parada-item__nombre--marquee');
        nom.style.removeProperty('--overflow');
      }
    });
  }

  /** Cuando el panel de paradas pasa de oculto a visible, se re-mide el
   *  marquee (si se midió estando oculto el ancho era 0). */
  function _iniciarObservadorParadas() {
    if (_observadorParadas || !el.panelParadas) return;
    _observadorParadas = new MutationObserver(() => {
      if (!el.panelParadas.hidden) _marcarMarqueeParadas();
    });
    _observadorParadas.observe(el.panelParadas, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', () => _marcarMarqueeParadas());
  }

  /** Inicializa el drag & drop entre las paradas de la lista. Los días y los
   *  puntos de conexión (aeropuerto/puerto) no se mueven; el origen y el
   *  destino sí pueden arrastrarse. */
  function _initDragParadas() {
    if (typeof Sortable === 'undefined' || !el.paradasLista) {
      console.warn('[paradas] Sortable no disponible o sin lista de paradas');
      return;
    }
    _sortablesParadas.forEach((s) => { try { s.destroy(); } catch (e) {} });
    _sortablesParadas = [];
    const draggable = '.parada-item:not(.parada-item--dia):not(.parada-item--continua)'
      + ':not([data-tipo-parada="aeropuerto"]):not([data-tipo-parada="puerto"])';
    el.paradasLista.querySelectorAll('.parada-dia__grupo').forEach((grupo) => {
      const sortable = Sortable.create(grupo, {
        group: 'paradas',
        animation: 150,
        draggable,
        // El botón hamburguesa no inicia el arrastre (solo abre el menú).
        filter: '.parada-item__hamburger',
        ghostClass: 'no-ghost',
        delay: 150,
        delayOnTouchOnly: true,
        onEnd: (evt) => _aplicarDragParadas(evt),
      });
      _sortablesParadas.push(sortable);
    });
  }

  /** Tras soltar una parada/extremo, lee el nuevo orden completo desde el DOM
   *  y lo aplica (recalcula la ruta si cambiaron los extremos). */
  async function _aplicarDragParadas(evt) {
    if (!evt || !evt.item) return;
    const tipo = evt.item.dataset.tipoParada;
    if (!['parada', 'escala', 'origen', 'destino'].includes(tipo)) return;
    UndoManager.registrar();
    try {
      sincronizarOrden();
      const previo = _ordenMovible();
      const nuevo = _ordenMovibleDOM();
      _capturarDiasDOM();
      const clave = (arr) => arr.map((o) => o.tipo + ':' + o.id).join('|');
      if (clave(previo) === clave(nuevo)) return;
      await _aplicarOrdenNuevo(nuevo);
    } catch (err) {
      console.warn('[paradas] Error al reordenar paradas:', err);
    } finally {
      renderizarParadas();
    }
  }

  /** Orden completo actual (origen + paradas/escalas + destino). */
  function _ordenMovible() {
    const lista = [];
    if (state.origen && state.origen.id != null) lista.push({ tipo: 'origen', id: String(state.origen.id) });
    state.orden.forEach((o) => lista.push({ tipo: o.tipo, id: String(o.id) }));
    if (state.destino && state.destino.id != null) lista.push({ tipo: 'destino', id: String(state.destino.id) });
    return lista;
  }

  /** Orden completo según el DOM (origen + paradas/escalas + destino), sin
   *  días, extremos de conexión ni filas de continuación de día. */
  function _ordenMovibleDOM() {
    const lista = [];
    el.paradasLista.querySelectorAll('.parada-item').forEach((li) => {
      if (li.classList.contains('parada-item--dia')) return;
      if (li.classList.contains('parada-item--continua')) return;
      const tipo = li.dataset.tipoParada;
      if (!['origen', 'destino', 'parada', 'escala'].includes(tipo)) return;
      lista.push({ tipo, id: String(li.dataset.paradaId) });
    });
    return lista;
  }

  /** Captura en state.diasOrden el día (grupo) en que quedó cada parada/pueblo
   *  tras el drag, para respetar la posición manual al volver a renderizar. */
  function _capturarDiasDOM() {
    if (!state.diasOrden) state.diasOrden = {};
    el.paradasLista.querySelectorAll('.parada-dia__grupo').forEach((grupo, gi) => {
      grupo.querySelectorAll('.parada-item[data-tipo-parada="parada"], .parada-item[data-tipo-parada="escala"]').forEach((li) => {
        const id = li.dataset.paradaId;
        if (!id) return;
        state.diasOrden[li.dataset.tipoParada + ':' + id] = gi + 1;
      });
    });
  }

  /** Aplica un nuevo orden completo (origen + medio + destino): actualiza
   *  state.origen/state.destino, rearma paradas/escalas y recalcula la ruta.
   *  Si un extremo quedó en medio pasa a ser una parada. Siempre que cambia el
   *  orden de las paradas se recalcula la ruta completa. */
  async function _aplicarOrdenNuevo(nuevo) {
    if (!nuevo || nuevo.length < 2) return;
    const resolver = (o) => {
      if (o.tipo === 'origen') return state.origen;
      if (o.tipo === 'destino') return state.destino;
      if (o.tipo === 'escala') return state.escalas.find((e) => String(e.id) === String(o.id));
      if (o.tipo === 'parada') return state.paradas.find((p) => String(p.id) === String(o.id));
      return null;
    };

    const origObj = resolver(nuevo[0]);
    const destObj = resolver(nuevo[nuevo.length - 1]);
    if (!origObj || !destObj) return;

    const cambiaOrigen = !state.origen || String(state.origen.id) !== String(origObj.id);
    const cambiaDestino = !state.destino || String(state.destino.id) !== String(destObj.id);

    const nuevasEscalas = [];
    const nuevasParadas = [];
    for (let i = 1; i < nuevo.length - 1; i++) {
      const obj = resolver(nuevo[i]);
      if (!obj) continue;
      if (nuevo[i].tipo === 'escala') nuevasEscalas.push(obj);
      else nuevasParadas.push(obj);
    }

    state.origen = origObj;
    state.destino = destObj;
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);
    // El orden combinado nuevo (origen + medio + destino) debe quedar en
    // `state.orden`, o el render volvería a mostrar el orden anterior.
    state.orden = nuevo.slice(1, -1)
      .filter((o) => o.tipo === 'escala' || o.tipo === 'parada')
      .map((o) => ({ tipo: o.tipo, id: o.id }));
    sincronizarOrden();

    if (typeof actualizarEstadoBotonCalcular === 'function') actualizarEstadoBotonCalcular();
    if (typeof _actualizarTextoBotonesOrden === 'function') _actualizarTextoBotonesOrden();

    // Siempre que cambian paradas/pueblos (orden, extremos o días) se recalcula
    // la ruta completa con las distancias actualizadas.
    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    if (typeof calcularRutaPrincipal === 'function') {
      try {
        await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
      } catch (err) {
        console.warn('[paradas] Error al recalcular tras reordenar:', err);
      }
    }
    renderizarParadas();
  }

  /** Desde el menú contextual de una parada o pueblo: hace que ese lugar sea
   *  el destino y calcula la ruta en avión hasta él. `tipo` es 'parada' o
   *  'escala'. */
  function llegarEnAvionAParada(objeto, tipo) {
    if (!objeto || typeof calcularRutaAerea !== 'function') return;
    if (state.destino && state.destino.id != null && String(state.destino.id) === String(objeto.id)) return;
    UndoManager.registrar();
    state.destino = objeto;
    if (tipo === 'escala') {
      state.escalas = state.escalas.filter((e) => String(e.id) !== String(objeto.id));
    } else {
      state.paradas = state.paradas.filter((p) => String(p.id) !== String(objeto.id));
    }
    sincronizarOrden();
    if (typeof actualizarEstadoBotonCalcular === 'function') actualizarEstadoBotonCalcular();
    if (typeof _actualizarTextoBotonesOrden === 'function') _actualizarTextoBotonesOrden();
    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    calcularRutaAerea();
    renderizarParadas();
  }

  /** Desde el menú contextual del destino: calcula la ruta en avión hasta el
   *  destino actual y actualiza la lista de paradas (aeropuertos, distancias). */
  async function llegarEnAvionAlDestino() {
    if (typeof calcularRutaAerea !== 'function') return;
    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    try {
      await calcularRutaAerea();
    } catch (err) {
      console.warn('[paradas] Error al calcular ruta aérea:', err);
    }
    renderizarParadas();
  }

  function _pad2(n) { return String(n).padStart(2, '0'); }

  /** Fecha del día `d` (1-based) según la fecha base fijada (o null si no hay). */
  function _fechaDeDia(d) {
    if (!state.diaFechaBase || !state.diaFechaValor) return null;
    const p = String(state.diaFechaValor).split('-').map(Number);
    if (p.length !== 3 || p.some((n) => !isFinite(n))) return null;
    const base = new Date(p[0], p[1] - 1, p[2]);
    base.setDate(base.getDate() + (d - state.diaFechaBase));
    return base;
  }

  /** "miércoles 2 de octubre" (día de la semana + fecha en español). */
  function _formatoDiaSemana(fecha) {
    return `${DIAS_SEMANA[fecha.getDay()]} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
  }

  /** Etiqueta mostrada en el encabezado del día: nombre, fecha o "Día N". */
  function _etiquetaDia(d) {
    if (state.diasNombres[d]) return state.diasNombres[d];
    const fecha = _fechaDeDia(d);
    if (fecha) return _formatoDiaSemana(fecha);
    return 'Día ' + d;
  }

  /** Opciones del menú contextual de un encabezado de día. */
  function _opcionesDia(d) {
    const opciones = [
      { etiqueta: 'Cambiar nombre', accion: () => _cambiarNombreDia(d) },
      { etiqueta: 'Asignar fecha', accion: () => _mostrarCalendarioDia(d) },
    ];
    if (state.diasNombres[d]) {
      opciones.push({ etiqueta: 'Quitar nombre', accion: () => { UndoManager.registrar(); delete state.diasNombres[d]; renderizarParadas(); } });
    }
    if (state.diaFechaBase) {
      opciones.push({ etiqueta: 'Quitar fecha', accion: () => { UndoManager.registrar(); state.diaFechaBase = null; state.diaFechaValor = null; renderizarParadas(); } });
    }
    return opciones;
  }

  function _cambiarNombreDia(d) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3 class="dialog__title">Nombre del día ${d}</h3>
        <input type="text" id="dia-nombre-input" class="nuevo-puerto__input" placeholder="P. ej. Día de la Alegría" autocomplete="off" maxlength="60">
        <p class="dialog__error" id="dia-nombre-error" hidden></p>
        <div class="dialog__actions">
          <button type="button" class="dialog__btn dialog__btn--cancel" id="dia-nombre-cancelar">Cancelar</button>
          <button type="button" class="dialog__btn dialog__btn--save" id="dia-nombre-guardar">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#dia-nombre-input');
    const error = overlay.querySelector('#dia-nombre-error');
    input.value = state.diasNombres[d] || '';

    function cerrar() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function aceptar() {
      const nombre = input.value.trim();
      if (!nombre) {
        error.textContent = 'Escribe un nombre para el día.';
        error.hidden = false;
        input.focus();
        return;
      }
      cerrar();
      UndoManager.registrar();
      state.diasNombres[d] = nombre;
      renderizarParadas();
    }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); aceptar(); }
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#dia-nombre-guardar').addEventListener('click', aceptar);
    overlay.querySelector('#dia-nombre-cancelar').addEventListener('click', () => { cerrar(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    overlay.querySelector('.dialog').addEventListener('click', (e) => e.stopPropagation());
    input.focus();
    input.select();
  }

  /** Calendario pequeño para asignar la fecha base a un día (mes y día). */
  function _mostrarCalendarioDia(d) {
    const existente = _fechaDeDia(d);
    const hoy = new Date();
    let y = existente ? existente.getFullYear() : hoy.getFullYear();
    let m = existente ? existente.getMonth() : hoy.getMonth();
    let diaSel = existente ? existente.getDate() : hoy.getDate();

    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog dialog--calendario">
        <h3 class="dialog__title">Asignar fecha al día ${d}</h3>
        <div class="cal-nav">
          <button type="button" class="dialog__btn cal-nav__btn" id="cal-prev" aria-label="Mes anterior">‹</button>
          <select id="cal-mes" class="cal-nav__sel" aria-label="Mes"></select>
          <select id="cal-anio" class="cal-nav__sel" aria-label="Año"></select>
          <button type="button" class="dialog__btn cal-nav__btn" id="cal-next" aria-label="Mes siguiente">›</button>
        </div>
        <div class="cal-grid" id="cal-grid"></div>
        <p class="cal-resumen" id="cal-resumen"></p>
        <p class="dialog__error" id="cal-error" hidden></p>
        <div class="dialog__actions">
          <button type="button" class="dialog__btn dialog__btn--cancel" id="cal-cancelar">Cancelar</button>
          <button type="button" class="dialog__btn dialog__btn--save" id="cal-asignar">Asignar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const selMes = overlay.querySelector('#cal-mes');
    const selAnio = overlay.querySelector('#cal-anio');
    const grid = overlay.querySelector('#cal-grid');
    const resumen = overlay.querySelector('#cal-resumen');

    const anioActual = hoy.getFullYear();
    MESES.forEach((nombre, i) => {
      const op = document.createElement('option');
      op.value = i;
      op.textContent = nombre;
      selMes.appendChild(op);
    });
    for (let a = anioActual - 5; a <= anioActual + 5; a++) {
      const op = document.createElement('option');
      op.value = a;
      op.textContent = a;
      selAnio.appendChild(op);
    }
    selMes.value = m;
    selAnio.value = y;

    function renderCalendario() {
      grid.innerHTML = '';
      ['l', 'm', 'x', 'j', 'v', 's', 'd'].forEach((letra) => {
        const h = document.createElement('span');
        h.className = 'cal-grid__head';
        h.textContent = letra;
        grid.appendChild(h);
      });
      const primerDia = new Date(y, m, 1);
      const diasMes = new Date(y, m + 1, 0).getDate();
      const inicio = (primerDia.getDay() + 6) % 7; // semana desde el lunes
      for (let i = 0; i < inicio; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-grid__dia cal-grid__dia--otro';
        b.disabled = true;
        b.tabIndex = -1;
        grid.appendChild(b);
      }
      const hoyNum = hoy.getDate();
      for (let dia = 1; dia <= diasMes; dia++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'cal-grid__dia';
        b.textContent = dia;
        if (y === hoy.getFullYear() && m === hoy.getMonth() && dia === hoyNum) b.classList.add('cal-grid__dia--hoy');
        if (dia === diaSel) b.classList.add('cal-grid__dia--sel');
        b.addEventListener('click', () => {
          diaSel = dia;
          renderCalendario();
          _actualizarResumen();
        });
        grid.appendChild(b);
      }
    }

    function _actualizarResumen() {
      const fecha = new Date(y, m, diaSel);
      resumen.textContent = _formatoDiaSemana(fecha) + ' de ' + y;
    }

    function cerrar() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }

    function onKey(e) {
      if (e.key === 'Escape') cerrar();
    }

    selMes.addEventListener('change', () => {
      m = Number(selMes.value);
      diaSel = Math.min(diaSel, new Date(y, m + 1, 0).getDate());
      renderCalendario();
      _actualizarResumen();
    });
    selAnio.addEventListener('change', () => {
      y = Number(selAnio.value);
      diaSel = Math.min(diaSel, new Date(y, m + 1, 0).getDate());
      renderCalendario();
      _actualizarResumen();
    });
    overlay.querySelector('#cal-prev').addEventListener('click', () => {
      m--;
      if (m < 0) { m = 11; y--; }
      selMes.value = m;
      selAnio.value = y;
      renderCalendario();
      _actualizarResumen();
    });
    overlay.querySelector('#cal-next').addEventListener('click', () => {
      m++;
      if (m > 11) { m = 0; y++; }
      selMes.value = m;
      selAnio.value = y;
      renderCalendario();
      _actualizarResumen();
    });
    overlay.querySelector('#cal-cancelar').addEventListener('click', cerrar);
    overlay.querySelector('#cal-asignar').addEventListener('click', () => {
      UndoManager.registrar();
      state.diaFechaBase = d;
      state.diaFechaValor = `${y}-${_pad2(m + 1)}-${_pad2(diaSel)}`;
      cerrar();
      renderizarParadas();
      if (typeof _mostrarNotificacion === 'function') {
        _mostrarNotificacion('Fecha asignada: ' + _formatoDiaSemana(new Date(y, m, diaSel)) + '. Las demás fechas se ajustaron.');
      }
    });
    document.addEventListener('keydown', onKey);

    renderCalendario();
    _actualizarResumen();
    // Cerrar al hacer clic fuera del diálogo.
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
    overlay.querySelector('.dialog').addEventListener('click', (e) => e.stopPropagation());
  }

  /** Modo "cambiar origen/destino": mientras está activo, al seleccionar el nuevo
   *  extremo se ocultan los cuadros al instante y se recalcula la ruta (OSRM). */

  function mostrarCuadroParada(sitio) {
    if (!sitio || sitio.lat == null || sitio.lon == null) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(sitio.lat, sitio.lon);

    const distTxt = sitio.distanciaRutaKm != null
      ? `A ${sitio.distanciaRutaKm.toFixed(1)} km del corredor · ~${Math.round(sitio.tiempoDesvioMin)} min de desvío`
      : '';
    const btnQuitar = {
      etiqueta: 'Quitar de la ruta',
      clase: 'popup-sitio__add popup-sitio__quitar',
      accion: () => {
        TourismModule.ocultarPopupSitio();
        eliminarParada(sitio.id);
      },
    };

    TourismModule.mostrarCuadroInfo({
      categoria: sitio.categoria || '',
      color: TourismModule.colorCategoria(sitio.categoria),
      nombre: sitio.nombre,
      ubicacion: `${sitio.municipio ? sitio.municipio + ', ' : ''}${sitio.departamento || ''}`,
      descripcion: sitio.descripcion || '',
      dist: distTxt,
      botones: [btnQuitar],
    });
  }

  /** Devuelve el municipio completo del catálogo para un punto (por id o nombre). */

  function _datosMunicipio(punto) {
    if (!punto || !state.municipios) return null;
    return state.municipios.find((m) => m.id === punto.id || (punto.nombre && m.nombre === punto.nombre)) || null;
  }

  /** Normaliza la altura a "X msnm" (los datos pueden traer "80 m s. n. m."). */

  function _formatearAltura(altura) {
    if (!altura) return '';
    const m = String(altura).match(/^\s*([\d.,]+)/);
    return m ? m[1] + ' msnm' : String(altura);
  }

  /** Nombre para la ficha: "Ciudad, Departamento (año)" (Bogotá se muestra como "Bogotá, D.C."). */

  function _nombreParaFicha(nombre, departamento, ano) {
    if (!nombre) return '';
    let base;
    if (nombre === 'Bogotá D.C.') base = 'Bogotá, D.C.';
    else if (departamento && departamento !== nombre) base = nombre + ', ' + departamento;
    else base = nombre;
    return ano ? `${base} (${ano})` : base;
  }

  /** Centra el mapa y muestra la ficha centrada de un pueblo intermedio. */

  function mostrarCuadroEscala(escala) {
    if (!escala || escala.lat == null || escala.lon == null) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(escala.lat, escala.lon);

    const btnCambiar = {
      etiqueta: 'Cambiar pueblo intermedio',
      clase: 'popup-sitio__add',
      accion: () => {
        TourismModule.ocultarPopupSitio();
        cambiarPueblo(escala);
      },
    };

    const btnEliminar = {
      etiqueta: 'Eliminar pueblo intermedio',
      clase: 'popup-sitio__add popup-sitio__quitar',
      accion: () => {
        TourismModule.ocultarPopupSitio();
        eliminarEscala(escala.id);
      },
    };

    const muni = _datosMunicipio(escala);
    TourismModule.mostrarCuadroInfo({
      categoria: 'Pueblo intermedio',
      color: '#4a6fa5',
      nombre: _nombreParaFicha(escala.nombre, escala.departamento, muni ? (muni.ano_fundacion || '') : ''),
      descripcion: muni ? (muni.descripción || '') : '',
      dist: '',
      altura: muni ? _formatearAltura(muni.altura) : '',
      temperatura: muni ? (muni.temperatura_promedio || '') : '',
      poblacion: muni ? (muni.poblacion_total || '') : '',
      superficie_total: muni ? (muni.superficie_total || '') : '',
      botones: [btnCambiar, btnEliminar],
    });
  }

  /** Centra el mapa y muestra la ficha centrada del origen o destino. */

  function mostrarCuadroExtremo(tipo, nombre, departamento) {
    const extremo = tipo === 'origen' ? state.origen : state.destino;
    if (!extremo || extremo.lat == null || extremo.lon == null) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(extremo.lat, extremo.lon);

    const btnCambiar = {
      etiqueta: tipo === 'origen' ? 'Cambiar lugar de origen' : 'Cambiar lugar de destino',
      clase: 'popup-sitio__add',
      accion: () => {
        TourismModule.ocultarPopupSitio();
        if (tipo === 'origen') irCambiarOrigen();
        else irCambiarDestino();
      },
    };

    const muni = _datosMunicipio(extremo);
    TourismModule.mostrarCuadroInfo({
      categoria: tipo === 'origen' ? 'Ciudad de origen' : 'Ciudad de destino',
      color: '#2d7d68',
      nombre: _nombreParaFicha(nombre, departamento, muni ? (muni.ano_fundacion || '') : ''),
      descripcion: muni ? (muni.descripción || '') : '',
      dist: '',
      altura: muni ? _formatearAltura(muni.altura) : '',
      temperatura: muni ? (muni.temperatura_promedio || '') : '',
      poblacion: muni ? (muni.poblacion_total || '') : '',
      superficie_total: muni ? (muni.superficie_total || '') : '',
      botones: [btnCambiar],
    });
  }

  /** Centra el mapa y muestra la ficha de un aeropuerto (salida o llegada) en ruta aérea. */

  function mostrarCuadroAeropuerto(ap, prefijo) {
    if (!ap) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(ap.latitud, ap.longitud);

    const tramos = state.tramosAereo;
    const distTxt = (() => {
      if (!tramos) return '';
      const item = _aeropuertosDeRuta(tramos).find((x) => String(x.ap.id) === String(ap.id));
      if (!item || item.distKm == null) return '';
      return `${prefijo}: ${(item.distKm / 1000).toFixed(1)} km`;
    })();

    TourismModule.mostrarCuadroInfo({
      categoria: `Aeropuerto de ${prefijo.toLowerCase()}`,
      color: '#4a6fa5',
      nombre: ap.nombre || '',
      ciudad: ap.ciudad || '',
      ubicacion: ap.ubicacion || '',
      descripcion: ap.descripcion || '',
      dist: distTxt,
      botones: [],
    });
  }

  /** Centra el mapa y muestra la ficha de un puerto fluvial (salida o llegada) en ruta por río. */
  function mostrarCuadroPuerto(p, prefijo) {
    if (!p) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(p.latitud, p.longitud);

    const tramos = state.tramosFluviales;
    const distTxt = (() => {
      if (!tramos) return '';
      let dist = null;
      if (prefijo === 'Salida') dist = tramos.distCarro1;
      else if (prefijo === 'Llegada') dist = tramos.distCarro2;
      else if (tramos.tramos && tramos.tramos[0]) dist = tramos.tramos[0].distanciaMetros;
      if (dist == null) return '';
      return `${prefijo}: ${(dist / 1000).toFixed(1)} km`;
    })();

    TourismModule.mostrarCuadroInfo({
      categoria: `Puerto fluvial de ${prefijo.toLowerCase()}`,
      color: '#2f7a6b',
      nombre: p.nombre || '',
      ciudad: p.ciudad || '',
      rio: p.rio || '',
      ubicacion: p.ubicacion || '',
      descripcion: p.descripcion || '',
      dist: distTxt,
      botones: [],
    });
  }

  /** Aeropuertos de la ruta aérea en curso con su prefijo y la distancia del
   *  tramo que le corresponde: [{ ap, prefijo, distKm }]. Con tramos
   *  encadenados (apSegs) se listan los aeropuertos de cada tramo; la salida
   *  solo es del primer tramo y la llegada solo del último. Un aeropuerto
   *  compartido entre dos tramos (la llegada de uno es la salida del otro en
   *  el pueblo intermedio) se lista una sola vez. */
  function _aeropuertosDeRuta(tramos) {
    const res = [];
    const segs = (tramos && tramos.apSegs) || [{ apOri: tramos?.apOri, hub: tramos?.hub, apDes: tramos?.apDes }];
    segs.forEach((seg, i, arr) => {
      const primero = i === 0, ultimo = i === arr.length - 1;
      const agregar = (ap, prefijo, distKm) => {
        if (!ap) return;
        const k = String(ap.id);
        const existente = res.find((x) => String(x.ap.id) === k);
        if (existente) {
          // Si el mismo aeropuerto (compartido entre dos tramos en un pueblo
          // intermedio) quedó sin distancia por ser tramo directo, se completa
          // con la distancia del tramo que sí la tiene.
          if (existente.distKm == null && distKm != null) existente.distKm = distKm;
          return;
        }
        res.push({ ap, prefijo, distKm });
      };
      if (seg.apOri) {
        agregar(seg.apOri, primero ? 'Salida' : 'Conexión',
          primero ? (tramos && tramos.distCarro1) : (seg.vuelos && seg.vuelos[0] ? seg.vuelos[0].distanciaMetros : null));
      }
      if (seg.hub && seg.vuelos && seg.vuelos[0]) {
        agregar(seg.hub, 'Conexión', seg.vuelos[0].distanciaMetros);
      }
      if (seg.apDes) {
        agregar(seg.apDes, ultimo ? 'Llegada' : 'Conexión',
          ultimo ? (tramos && tramos.distCarro2) : (seg.vuelos && seg.vuelos.length > 1 ? seg.vuelos[1].distanciaMetros : null));
      }
    });
    return res;
  }

  /** Prefijo de la ruta activa ('Salida'|'Conexión'|'Llegada') si `ap` es un
   *  aeropuerto de la ruta aérea en curso; null si no. */
  function _prefijoAeropuertoRuta(ap) {
    const t = state.tramosAereo;
    if (!t || !ap) return null;
    const item = _aeropuertosDeRuta(t).find((x) => String(x.ap.id) === String(ap.id));
    return item ? item.prefijo : null;
  }

  /** Prefijo de la ruta activa ('Salida'|'Conexión'|'Llegada') si `p` es un
   *  puerto de la ruta fluvial en curso; null si no. */
  function _prefijoPuertoRuta(p) {
    const t = state.tramosFluviales;
    if (!t || !p) return null;
    if (t.po && String(t.po.id) === String(p.id)) return 'Salida';
    if (t.pd && String(t.pd.id) === String(p.id)) return 'Llegada';
    if (t.hub && String(t.hub.id) === String(p.id)) return 'Conexión';
    return null;
  }

  /** Centra el mapa y muestra la ficha informativa centrada de un
   *  puerto/aeropuerto del catálogo (o de la ruta, si pertenece a ella), de un
   *  departamento (tecla D) o de un municipio (tecla M), igual que con los
   *  sitios turísticos. `tipo` es 'puerto' | 'aeropuerto' | 'departamento' | 'municipio'. */
  function mostrarCuadroInfra(tipo, item) {
    if (!item) return;
    const esPuerto = tipo === 'puerto';
    const prefijo = esPuerto ? _prefijoPuertoRuta(item) : _prefijoAeropuertoRuta(item);
    if (prefijo) {
      if (esPuerto) mostrarCuadroPuerto(item, prefijo);
      else mostrarCuadroAeropuerto(item, prefijo);
      return;
    }
    if (tipo === 'departamento' || tipo === 'municipio') {
      const esDepto = tipo === 'departamento';
      cerrarAltimetria();
      // Al seleccionar otro departamento/municipio se ocultan los sitios que se
      // habían mostrado para el anterior.
      if (typeof _ocultarSitiosCatalogo === 'function') _ocultarSitiosCatalogo();
      const map = MapModule.getMap();
      if (map) map.closePopup();
      if (esDepto) {
        // Encuadrar únicamente el departamento (límites de sus municipios).
        const coords = state.municipios
          .filter((m) => m.departamento === item.nombre && m.lat != null && m.lon != null && !isNaN(Number(m.lat)) && !isNaN(Number(m.lon)))
          .map((m) => [Number(m.lat), Number(m.lon)]);
        if (coords.length >= 2) MapModule.encuadrar(coords, [40, 40]);
        else MapModule.centrarEn(Number(item.lat), Number(item.lon), 9);
      } else {
        MapModule.centrarEn(Number(item.lat), Number(item.lon), 12);
      }
      TourismModule.mostrarCuadroInfo({
        color: esDepto ? '#3f6f8f' : '#2b6a8f',
        categoria: esDepto ? 'Departamento' : 'Municipio',
        nombre: `${item.nombre} (${esDepto ? (item.ano || '') : (item.ano_fundacion || '')})`,
        ciudad: '',
        ubicacion: esDepto ? `Capital: ${item.capital}` : (item.departamento || ''),
        descripcion: item.descripcion || item.descripción || '',
        altura: esDepto ? '' : (item.altura || ''),
        temperatura: esDepto ? '' : (item.temperatura_promedio || ''),
        dist: '',
        botones: [],
        botonCabecera: {
          etiqueta: 'Mostrar sitios turísticos',
          accion: () => _mostrarSitiosTurísticos(item, tipo),
        },
      });
      return;
    }
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(Number(item.latitud), Number(item.longitud), 13);
    TourismModule.mostrarCuadroInfo({
      color: esPuerto ? '#2f7a6b' : '#4a6fa5',
      nombre: item.nombre || '',
      ciudad: item.ciudad || '',
      rio: esPuerto ? item.rio || '' : '',
      ubicacion: item.ubicacion || '',
      descripcion: item.descripcion || '',
      dist: '',
      botones: [],
    });
  }

  /** Muestra en el mapa (y deja lista en Descubre) los sitios turísticos de un
   *  departamento o los que están a 30 km de un municipio. Igual que la
   *  búsqueda con clic derecho: muestra la barra de radio sobre el mapa y pasa
   *  directo a la pestaña Descubre. */
  function _mostrarSitiosTurísticos(item, tipo) {
    const lat = Number(item.lat);
    const lng = Number(item.lon);
    // Contexto para la barra de radio del mapa: la X restaurará este listado.
    if (typeof MapModule !== 'undefined' && typeof MapModule.iniciarBusquedaSitios === 'function') {
      MapModule.iniciarBusquedaSitios(lat, lng);
    }
    let lista;
    if (tipo === 'departamento') {
      // Coincide por departamento; también por la capital (p. ej. los sitios de
      // San Andrés se registran con otra grafía del departamento).
      lista = state.sitios.filter((s) => s.departamento === item.nombre || s.municipio === item.capital);
      lista = lista.slice().sort((a, b) => {
        const da = Math.hypot(Number(a.lat) - lat, Number(a.lon) - lng);
        const db = Math.hypot(Number(b.lat) - lat, Number(b.lon) - lng);
        return da - db;
      });
    } else {
      const centro = turf.point([lng, lat]);
      const conDist = [];
      state.sitios.forEach((s) => {
        if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) return;
        const d = turf.distance(centro, turf.point([Number(s.lon), Number(s.lat)]), { units: 'kilometers' });
        if (d <= 30) conDist.push([s, d]);
      });
      conDist.sort((a, b) => a[1] - b[1]);
      lista = conDist.map((x) => x[0]);
    }
    state.sitiosFiltradosBase = lista;
    state.sitiosFiltrados = lista;
    state.modoVisibilidad = 'completa';
    state.categoriasSeleccionadas = [];
    if (typeof MapModule !== 'undefined' && typeof MapModule.asegurarClusterSitios === 'function') {
      MapModule.asegurarClusterSitios();
    }
    if (typeof renderizarSitios === 'function') renderizarSitios(lista);
    if (typeof renderizarCategoriasMenu === 'function') {
      const cats = new Map();
      lista.forEach((s) => {
        if (!s.categoria) return;
        const c = s.categoria.trim();
        cats.set(c, (cats.get(c) || 0) + 1);
      });
      renderizarCategoriasMenu([...cats.entries()]);
    }
    // La pestaña Descubre queda disponible (en modos D/M se mantiene visible).
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    // Barra de filtro por radio (la misma del clic derecho → buscar sitios).
    if (typeof MapModule !== 'undefined' && typeof MapModule.mostrarBarraBuscarSitios === 'function') {
      MapModule.mostrarBarraBuscarSitios(lat, lng);
    }
    // Salto directo a la pestaña Descubre con el listado ya montado.
    if (typeof activarPanelTab === 'function') activarPanelTab('descubre');
    if (typeof esMovil === 'function' && esMovil() && typeof setMobileTab === 'function') setMobileTab('descubre');
  }

  // -------------------------------------------------------------------
  // Listado del catálogo de puertos/aeropuertos en la pestaña Ruta (A/P)
  // -------------------------------------------------------------------

  /** Coordenadas [lat, lon] de un ítem del catálogo (puertos/aeropuertos usan
   *  latitud/longitud; departamentos y municipios usan lat/lon); null si no. */
  function _coordsInfra(it) {
    const lat = it.latitud != null ? it.latitud : it.lat;
    const lon = it.longitud != null ? it.longitud : it.lon;
    if (lat == null || lon == null || isNaN(Number(lat)) || isNaN(Number(lon))) return null;
    return [Number(lat), Number(lon)];
  }

  /** Lista de ítems de un tipo de catálogo (puerto | aeropuerto | departamento | municipio | categoria | frontera). */
  function _itemsInfra(tipo) {
    if (tipo === 'puerto') return state.puertos;
    if (tipo === 'aeropuerto') return state.aeropuertos;
    if (tipo === 'departamento') return state.departamentos;
    if (tipo === 'categoria') return state.categorias;
    if (tipo === 'frontera') return state.sitios.filter((s) => s.frontera);
    if (tipo === 'municipio') {
      return _municipiosFiltroDepto
        ? state.municipios.filter((m) => m.departamento === _municipiosFiltroDepto)
        : [];
    }
    return [];
  }

  /** Título del listado del catálogo (p. ej. "Aeropuertos y puertos"). */
  function _tituloInfra(tipos) {
    const nombres = tipos.map((t) => ({
      puerto: 'Puertos', aeropuerto: 'Aeropuertos', departamento: 'Departamentos', municipio: 'Municipios', categoria: 'Categorías', frontera: 'Frontera',
    }[t] || ''));
    return nombres.map((n, i) => (i > 0 ? n.toLowerCase() : n)).join(' y ');
  }

  /** Rellena la lista de la pestaña Ruta con los ítems del catálogo cuyas
   *  teclas (P/A/D/M/C) estén activas. */
  function renderizarInfraListado() {
    const tipos = [];
    if (_puertosVisibles) tipos.push('puerto');
    if (_aeropuertosVisibles) tipos.push('aeropuerto');
    if (_departamentosVisibles) tipos.push('departamento');
    if (_municipiosVisibles) tipos.push('municipio');
    if (_categoriasVisibles) tipos.push('categoria');
    if (_fronteraVisibles) tipos.push('frontera');
    if (!tipos.length) return;
    if (!el.paradasLista) return;

    // Filtro: el de departamento solo aplica a municipios (M).
    if (el.filtroMunicipiosDepto) el.filtroMunicipiosDepto.hidden = !_municipiosVisibles;

    // Si React está renderizando la lista de paradas, desmontarlo primero:
    // el modo de lista ya es 'infra' y el puente re-renderiza a null. Si se
    // limpiara el innerHTML con React montado, la reconciliación fallaría
    // (NotFoundError) al intentar remover los nodos que Sortable movió.
    if (window.SimbiosisUI && typeof window.SimbiosisUI.notificarListaRuta === 'function') {
      window.SimbiosisUI.notificarListaRuta();
    }

    const items = [];
    let n = 0;
    tipos.forEach((tipo) => {
      const list = _itemsInfra(tipo);
      (list || []).forEach((it) => {
        if (!_coordsInfra(it) && tipo !== 'categoria') return;
        items.push(_descriptorTarjetaInfra(it, tipo, n));
        n++;
      });
    });
    // Sin elección: pista en vez de una lista vacía (municipios).
    if (_municipiosVisibles && !_municipiosFiltroDepto && n === 0) {
      items.push({ hint: true, texto: 'Elige un departamento para ver sus municipios en el mapa y en la lista.' });
    }
    _infraSnapshot = items;
    if (el.paradasTitulo) el.paradasTitulo.textContent = _tituloInfra(tipos);
    if (el.btnAgregarIntermedio) el.btnAgregarIntermedio.hidden = true;
    el.panelParadas.hidden = false;
    _notificarInfraListado();
  }

  /** Descriptor serializable de una tarjeta del catálogo (los <li> los
   *  renderiza React, InfraListado); las acciones siguen siendo closures de
   *  los llamadores vía el puente. */
  function _descriptorTarjetaInfra(item, tipo, idx) {
    const esPuerto = tipo === 'puerto';
    let sub = '';
    let sufijo = '';
    if (tipo === 'puerto' || tipo === 'aeropuerto') {
      sub = item.ciudad || '';
    } else if (tipo === 'departamento') {
      sub = item.capital || '';
      if (item.totalMunicipios != null) sufijo = ` (${item.totalMunicipios})`;
    } else if (tipo === 'municipio') {
      sub = [item.departamento, item.altura].filter(Boolean).join(' · ');
    } else if (tipo === 'categoria') {
      sub = item.total != null ? `${item.total} sitios` : '';
      if (item.total != null) sufijo = ` (${item.total})`;
    } else if (tipo === 'frontera') {
      sub = [item.municipio, item.ubicacion].filter(Boolean).join(' · ');
    }
    const activa = tipo === 'categoria' && item.nombre === _categoriasFiltro;
    return {
      id: String(item.id),
      tipo,
      nombre: item.nombre,
      sub,
      sufijo,
      rio: esPuerto && item.rio ? item.rio : '',
      activa,
      idx,
    };
  }

  /** Restaura la pestaña Ruta al apagar el catálogo de puertos/aeropuertos
   *  (y departamentos/municipios/categorías). */
  function _restaurarPanelRutaInfra() {
    _infraSnapshot = null;
    _notificarInfraListado();
    if (el.paradasTitulo) el.paradasTitulo.textContent = 'Paradas';
    if (el.btnAgregarIntermedio) el.btnAgregarIntermedio.hidden = false;
    if (el.filtroMunicipiosDepto) {
      el.filtroMunicipiosDepto.hidden = true;
      el.filtroMunicipiosDepto.value = '';
    }
    if (el.panelEscalas) el.panelEscalas.hidden = !el.panelEscalas.children.length;
    renderizarParadas();
  }

  /** Agrega un día más al reparto de paradas y vuelve a dividir la ruta. */

  function agregarDia() {
    UndoManager.registrar();
    state.dias = (state.dias || 1) + 1;
    renderizarParadas();
  }

  /** Quita un día del reparto (nunca el último si solo queda uno) y reacomoda
   *  nombres/fechas de los días siguientes. */
  function quitarDia(d) {
    const total = state.dias || 1;
    if (total <= 1 || d < 1 || d > total) return;
    UndoManager.registrar();
    state.dias = total - 1;
    const nuevosNombres = {};
    for (let i = 1; i <= state.dias; i++) {
      const orig = i >= d ? i + 1 : i;
      if (state.diasNombres[orig]) nuevosNombres[i] = state.diasNombres[orig];
    }
    state.diasNombres = nuevosNombres;
    if (state.diaFechaBase != null && state.diaFechaBase >= d) {
      state.diaFechaBase = Math.max(1, state.diaFechaBase - 1);
    }
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Puente con React (lista de paradas). El contenedor #paradas-lista es
  // COMPARTIDO: en modo 'paradas' lo renderiza el componente React
  // (ParadasLista, portal), y en modo 'infra' (catálogo A/P/D/M/C) o 'archivo'
  // (ruta desde archivo, tecla K) lo rellena el código vanilla. Estos getters
  // se exponen en window.SimbiosisUI para que React decida cuándo montar.
  // -------------------------------------------------------------------

  function _modoListaRuta() {
    if (_puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles || _fronteraVisibles) return 'infra';
    if (_rutaArchivoActiva) return 'archivo';
    return 'paradas';
  }

  /** Snapshot del estado que React necesita para renderizar la lista. */
  function _datosParadas() {
    return {
      orden: state.orden,
      escalas: state.escalas,
      paradas: state.paradas,
      origen: state.origen,
      destino: state.destino,
      rutaActual: state.rutaActual,
      dias: state.dias,
      diasOrden: state.diasOrden,
      diasNombres: state.diasNombres,
      diaFechaBase: state.diaFechaBase,
      diaFechaValor: state.diaFechaValor,
      modoAereo: state.modoAereo,
      tramosAereo: state.tramosAereo,
      modoFluvial: state.modoFluvial,
      tramosFluviales: state.tramosFluviales,
    };
  }

  /** Consume la bandera que suprime el clic sintético posterior a una pulsación
   *  larga o a un deslizamiento para borrar (React lo llama en sus clics). */
  function _consumirClicSintetico() {
    if (_suprimirProximoClic) { _suprimirProximoClic = false; return true; }
    return false;
  }

  if (typeof window !== 'undefined' && window.SimbiosisUI) {
    window.SimbiosisUI.modoListaRuta = _modoListaRuta;
    window.SimbiosisUI.datosParadas = _datosParadas;
    window.SimbiosisUI.consumirClicSintetico = _consumirClicSintetico;
  }

  /** Pide a React que vuelva a renderizar el menú contextual de filas. */
  function _notificarMenuFila() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarMenuFila === 'function') {
      window.SimbiosisUI.notificarMenuFila();
    }
  }

  if (typeof window !== 'undefined' && window.SimbiosisUI) {
    /** Snapshot del menú contextual (null si está cerrado). */
    window.SimbiosisUI.datosMenuFila = () => _menuFilaOpciones
      ? { opciones: _menuFilaOpciones, x: _menuFilaX, y: _menuFilaY }
      : null;
    /** Ejecuta la acción de la opción i-ésima y cierra el menú (lo llama React). */
    window.SimbiosisUI.ejecutarMenuFila = (i) => {
      const op = _menuFilaOpciones && _menuFilaOpciones[i];
      if (!op) return;
      cerrarMenuFila();
      op.accion();
    };
    /** Snapshot del catálogo de puertos/aeropuertos/… (solo en modo 'infra'). */
    window.SimbiosisUI.datosInfraListado = () => _modoListaRuta() === 'infra'
      ? { items: _infraSnapshot || [] }
      : null;
    /** Ejecuta el clic de la tarjeta i-ésima del catálogo (lo invoca React). */
    window.SimbiosisUI.clicTarjetaInfra = (i) => {
      const d = _infraSnapshot && _infraSnapshot[i];
      if (!d || d.hint) return;
      const tipo = d.tipo;
      const item = (_itemsInfra(tipo) || []).find((x) => String(x.id) === String(d.id));
      if (!item) return;
      if (tipo === 'categoria') {
        _aplicarFiltroCategorias(item.nombre);
        return;
      }
      if (tipo === 'frontera') {
        if (typeof _verInfoCatalogo === 'function') _verInfoCatalogo('frontera', item);
        return;
      }
      if (tipo === 'departamento' || tipo === 'municipio') {
        mostrarCuadroInfra(tipo, item);
        return;
      }
      const esPuerto = tipo === 'puerto';
      const conexiones = esPuerto ? _conexionesDePuerto(item) : _conexionesDeAeropuerto(item);
      const coords = _coordsInfra(item);
      MapModule.dibujarConexiones(tipo, String(item.id), coords[0], coords[1], conexiones, esPuerto ? '#2f7a6b' : '#4a6fa5');
      mostrarCuadroInfra(tipo, item);
    };
  }

  /** Pide a React que vuelva a renderizar el catálogo de puertos/aeropuertos. */
  function _notificarInfraListado() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarInfraListado === 'function') {
      window.SimbiosisUI.notificarInfraListado();
    }
  }

  function renderizarParadas() {
    sincronizarOrden();
    // Con el catálogo de puertos/aeropuertos (A/P) o la ruta desde archivo (K)
    // activos, la lista de la pestaña Ruta la ocupa otro contenido; no mezclar.
    if (_puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles || _fronteraVisibles || _rutaArchivoActiva) return;

    // En la pestaña Descubre las paradas no deben aparecer aunque haya paradas;
    // tampoco antes de calcular la ruta inicial (seleccionando pueblos
    // intermedios): las paradas se muestran solo tras el primer cálculo.
    const total = state.orden.filter((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((x) => x.id === o.id);
        return e && e.lat != null && !e._dragGenerated;
      }
      const p = state.paradas.find((x) => x.id === o.id);
      return p && !p._dragGenerated;
    }).length;
    const incluirExtremos = Boolean(state.rutaActual && state.origen && state.destino);
    el.panelParadas.hidden = estaEnPestanaDescubre() || !state.rutaActual || (!incluirExtremos && total === 0);

    // Quita asignaciones de día de paradas que ya no existen.
    if (state.diasOrden) {
      const idsValidos = new Set(state.orden.map((o) => o.tipo + ':' + o.id));
      Object.keys(state.diasOrden).forEach((k) => { if (!idsValidos.has(k)) delete state.diasOrden[k]; });
    }

    // La lista de paradas la renderiza React (componente ParadasLista, portal a
    // #paradas-lista); se notifica al puente y el componente re-renderiza
    // leyendo el estado vivo (window.SimbiosisUI.datosParadas). El marquee, el
    // drag & drop (Sortable) y el swipe para borrar se re-enganchan en el
    // propio componente tras cada montaje.
    if (window.SimbiosisUI && typeof window.SimbiosisUI.notificarListaRuta === 'function') {
      window.SimbiosisUI.notificarListaRuta();
    }
  }

