/**
 * paradas.js
 * ---------------------------------------------------------------------------
 * Listado de paradas (escalas + sitios agregados + extremos + aeropuertos),
 * menús contextuales y fichas informativas de cada elemento de la ruta.
 * ---------------------------------------------------------------------------
 */

  async function agregarParada(sitio, boton) {
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

  /** Cambia en el lugar la tarjeta de un sitio a "ya agregado" (resaltado y botón −). */

  function _marcarSitioAgregadoEnLista(sitio) {
    const card = el.sitiosLista.querySelector(`[data-sitio-id="${String(sitio.id)}"]`);
    if (!card) return;
    card.classList.add('sitio-card--active');
    const btn = card.querySelector('.sitio-card__add');
    if (!btn) return;
    btn.classList.add('sitio-card__add--quitar');
    btn.title = 'Quitar de la ruta';
    btn.setAttribute('aria-label', 'Quitar ' + sitio.nombre + ' de la ruta');
    btn.innerHTML = '<svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg><span class="icon-btn__spinner" aria-hidden="true"></span>';
    btn.onclick = (e) => { e.stopPropagation(); quitarSitioDeLaRuta(sitio, card, btn); };
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

  /** Restaura la tarjeta de un sitio a "agregar" (+) sin recargar el listado. */

  function _restaurarSitioEnLista(sitio) {
    const card = el.sitiosLista.querySelector(`[data-sitio-id="${String(sitio.id)}"]`);
    if (!card) return;
    card.classList.remove('sitio-card--active');
    const btn = card.querySelector('.sitio-card__add');
    if (!btn) return;
    btn.classList.remove('sitio-card__add--quitar');
    btn.title = 'Agregar a la ruta';
    btn.setAttribute('aria-label', 'Agregar ' + sitio.nombre + ' a la ruta');
    btn.innerHTML = '<svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span class="icon-btn__spinner" aria-hidden="true"></span>';
    btn.onclick = (e) => { e.stopPropagation(); agregarParada(sitio, btn); };
  }


  function cerrarMenuFila() {
    if (_menuFila) {
      _menuFila.remove();
      _menuFila = null;
    }
  }


  function abrirMenuFila(opciones, clientX, clientY) {
    cerrarMenuFila();
    const menu = document.createElement('div');
    menu.className = 'fila-menu';

    opciones.forEach((op) => {
      const item = document.createElement('div');
      item.className = 'fila-menu__item';
      item.textContent = op.etiqueta;
      item.addEventListener('click', (evt) => {
        evt.stopPropagation();
        cerrarMenuFila();
        op.accion();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    _menuFila = menu;

    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    left = Math.max(8, left);
    top = Math.max(8, top);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }


  document.addEventListener('click', (evt) => {
    // Clic sintético posterior a una pulsación larga (iOS): se ignora para
    // que no cierre el menú contextual recién abierto. La bandera se limpia
    // sola a los 700 ms (ver engancharLongPress y map.js).
    if (_suprimirProximoClic) return;
    if (_menuFila && !_menuFila.contains(evt.target)) cerrarMenuFila();
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

  // -------------------------------------------------------------------
  // Días de viaje: nombre y fecha personalizados
  // -------------------------------------------------------------------

  const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  let _observadorParadas = null; // re-mide el marquee al volver visible el panel
  let _sortablesParadas = [];    // instancias de Sortable de la lista de paradas

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
    if (typeof Sortable === 'undefined' || !el.paradasLista) return;
    _sortablesParadas.forEach((s) => { try { s.destroy(); } catch (e) {} });
    _sortablesParadas = [];
    const draggable = '.parada-item:not(.parada-item--dia):not(.parada-item--continua)'
      + ':not([data-tipo-parada="aeropuerto"]):not([data-tipo-parada="puerto"])';
    el.paradasLista.querySelectorAll('.parada-dia__grupo').forEach((grupo) => {
      const sortable = Sortable.create(grupo, {
        group: 'paradas',
        animation: 150,
        draggable,
        ghostClass: 'no-ghost',
        delay: 150,
        delayOnTouchOnly: true,
        onEnd: (evt) => _aplicarDragParadas(evt),
      });
      _sortablesParadas.push(sortable);
    });
  }

  /** Tras soltar una parada, lee el nuevo orden desde el DOM y lo aplica.
   *  Si solo se reordenaron paradas/pueblos usa reordenar(); si cambió el
   *  origen o el destino (o un extremo quedó en medio) se reconstruye la ruta
   *  y se recalcula con las distancias actualizadas. */
  function _aplicarDragParadas(evt) {
    if (!evt || !evt.item) return;
    const tipo = evt.item.dataset.tipoParada;
    if (!['parada', 'escala', 'origen', 'destino'].includes(tipo)) return;

    sincronizarOrden();
    const previo = _ordenMovible();
    const nuevo = _ordenMovibleDOM();
    const clave = (arr) => arr.map((o) => o.tipo + ':' + o.id).join('|');
    if (clave(previo) === clave(nuevo)) return;

    const claveItem = (o) => o.tipo + ':' + o.id;
    const primerCambio = previo[0] && nuevo[0] && claveItem(previo[0]) !== claveItem(nuevo[0]);
    const ultimoCambio = previo[previo.length - 1] && nuevo[nuevo.length - 1]
      && claveItem(previo[previo.length - 1]) !== claveItem(nuevo[nuevo.length - 1]);

    if (primerCambio || ultimoCambio || tipo === 'origen' || tipo === 'destino') {
      _aplicarOrdenNuevo(nuevo);
      return;
    }

    // Reorden normal entre paradas/pueblos (sin extremos).
    const previoOrden = state.orden.map((o) => ({ tipo: o.tipo, id: o.id }));
    const desde = previoOrden.findIndex((o) => o.tipo === tipo && String(o.id) === String(evt.item.dataset.paradaId));
    const nuevoOrden = nuevo.filter((o) => o.tipo === 'parada' || o.tipo === 'escala');
    const hasta = nuevoOrden.findIndex((o) => o.tipo === tipo && String(o.id) === String(evt.item.dataset.paradaId));
    if (desde < 0 || hasta < 0) return;
    reordenar(desde, hasta);
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

  /** Aplica un nuevo orden completo (origen + medio + destino): actualiza
   *  state.origen/state.destino, rearma paradas/escalas y recalcula la ruta.
   *  Si un extremo quedó en medio pasa a ser una parada. */
  async function _aplicarOrdenNuevo(nuevo) {
    if (!nuevo || nuevo.length < 2) return;
    const resolver = (o) => {
      if (o.tipo === 'origen') return state.origen;
      if (o.tipo === 'destino') return state.destino;
      if (o.tipo === 'escala') return state.escalas.find((e) => e.id === o.id);
      if (o.tipo === 'parada') return state.paradas.find((p) => p.id === o.id);
      return null;
    };

    const origObj = resolver(nuevo[0]);
    const destObj = resolver(nuevo[nuevo.length - 1]);
    if (!origObj || !destObj) return;

    const cambiaOrigen = !state.origen || String(state.origen.id) !== String(origObj.id);
    const cambiaDestino = !state.destino || String(state.destino.id) !== String(destObj.id);
    if (!cambiaOrigen && !cambiaDestino) return;

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
    sincronizarOrden();

    if (typeof actualizarEstadoBotonCalcular === 'function') actualizarEstadoBotonCalcular();
    if (typeof _actualizarTextoBotonesOrden === 'function') _actualizarTextoBotonesOrden();
    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    if (typeof calcularRutaPrincipal === 'function') {
      try {
        await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
      } catch (err) {
        console.warn('Error al recalcular tras mover extremos:', err);
      }
    }
    renderizarParadas();
  }

  /** Desde el menú contextual de una parada: hace que ese lugar sea el destino
   *  y calcula la ruta en avión hasta él. */
  function llegarEnAvionAParada(parada) {
    if (!parada || typeof calcularRutaAerea !== 'function') return;
    if (state.destino && state.destino.id != null && String(state.destino.id) === String(parada.id)) return;
    state.destino = parada;
    state.paradas = state.paradas.filter((p) => String(p.id) !== String(parada.id));
    sincronizarOrden();
    if (typeof actualizarEstadoBotonCalcular === 'function') actualizarEstadoBotonCalcular();
    if (typeof _actualizarTextoBotonesOrden === 'function') _actualizarTextoBotonesOrden();
    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    calcularRutaAerea();
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
      opciones.push({ etiqueta: 'Quitar nombre', accion: () => { delete state.diasNombres[d]; renderizarParadas(); } });
    }
    if (state.diaFechaBase) {
      opciones.push({ etiqueta: 'Quitar fecha', accion: () => { state.diaFechaBase = null; state.diaFechaValor = null; renderizarParadas(); } });
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
    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'popup-sitio__add popup-sitio__quitar';
    btnQuitar.textContent = 'Quitar de la ruta';
    btnQuitar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      eliminarParada(sitio.id);
    });

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

    const btnCambiar = document.createElement('button');
    btnCambiar.type = 'button';
    btnCambiar.className = 'popup-sitio__add';
    btnCambiar.textContent = 'Cambiar pueblo intermedio';
    btnCambiar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      cambiarPueblo(escala);
    });

    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.className = 'popup-sitio__add popup-sitio__quitar';
    btnEliminar.textContent = 'Eliminar pueblo intermedio';
    btnEliminar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      eliminarEscala(escala.id);
    });

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

    const btnCambiar = document.createElement('button');
    btnCambiar.type = 'button';
    btnCambiar.className = 'popup-sitio__add';
    btnCambiar.textContent = tipo === 'origen' ? 'Cambiar lugar de origen' : 'Cambiar lugar de destino';
    btnCambiar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      if (tipo === 'origen') irCambiarOrigen();
      else irCambiarDestino();
    });

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
   *  departamento o los que están a 30 km de un municipio. */
  function _mostrarSitiosTurísticos(item, tipo) {
    let lista;
    if (tipo === 'departamento') {
      // Coincide por departamento; también por la capital (p. ej. los sitios de
      // San Andrés se registran con otra grafía del departamento).
      lista = state.sitios.filter((s) => s.departamento === item.nombre || s.municipio === item.capital);
    } else {
      const centro = turf.point([Number(item.lon), Number(item.lat)]);
      lista = state.sitios.filter((s) => {
        if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) return false;
        const d = turf.distance(centro, turf.point([Number(s.lon), Number(s.lat)]), { units: 'kilometers' });
        return d <= 30;
      });
    }
    state.sitiosFiltradosBase = lista;
    state.sitiosFiltrados = lista;
    state.modoVisibilidad = 'completa';
    if (typeof renderizarSitios === 'function') renderizarSitios(lista);
    // La pestaña Descubre queda disponible (en modos D/M se mantiene visible).
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
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

    el.paradasLista.innerHTML = '';
    let n = 0;
    tipos.forEach((tipo) => {
      const items = _itemsInfra(tipo);
      (items || []).forEach((it) => {
        if (!_coordsInfra(it) && tipo !== 'categoria') return;
        el.paradasLista.appendChild(_crearTarjetaInfra(it, tipo, n));
        n++;
      });
    });
    // Sin elección: pista en vez de una lista vacía (municipios).
    if (_municipiosVisibles && !_municipiosFiltroDepto && n === 0) {
      const hint = Utils.crearElemento('<li class="paradas-vacio">Elige un departamento para ver sus municipios en el mapa y en la lista.</li>');
      el.paradasLista.appendChild(hint);
    }
    el.paradasContador.textContent = (_categoriasVisibles && _categoriasFiltro)
      ? String(state.sitiosFiltrados.length)
      : String(n);
    if (el.paradasTitulo) el.paradasTitulo.textContent = _tituloInfra(tipos);
    if (el.btnAgregarIntermedio) el.btnAgregarIntermedio.hidden = true;
    el.panelParadas.hidden = false;
  }

  function _crearTarjetaInfra(item, tipo, idx) {
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
    const rio = esPuerto && item.rio ? `<span class="sitio-card__rio">${item.rio}</span>` : '';
    const activa = tipo === 'categoria' && item.nombre === _categoriasFiltro;
    const li = Utils.crearElemento(`
      <li class="sitio-card${activa ? ' sitio-card--active' : ''}" data-infra-id="${item.id}">
        <div class="sitio-card__top">
          <span class="sitio-card__nombre"><span class="sitio-card__num">${idx + 1}.</span>&nbsp;${item.nombre}${sufijo}</span>
          ${rio}
        </div>
        <p class="sitio-card__ciudad">${sub || ''}</p>
      </li>
    `);
    li.addEventListener('click', () => {
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
      const conexiones = esPuerto ? _conexionesDePuerto(item) : _conexionesDeAeropuerto(item);
      const coords = _coordsInfra(item);
      MapModule.dibujarConexiones(tipo, String(item.id), coords[0], coords[1], conexiones, esPuerto ? '#2f7a6b' : '#4a6fa5');
      mostrarCuadroInfra(tipo, item);
    });
    return li;
  }

  /** Restaura la pestaña Ruta al apagar el catálogo de puertos/aeropuertos
   *  (y departamentos/municipios/categorías). */
  function _restaurarPanelRutaInfra() {
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
    state.dias = (state.dias || 1) + 1;
    renderizarParadas();
  }

  function renderizarParadas() {
    sincronizarOrden();
    // Con el catálogo de puertos/aeropuertos (A/P) o la ruta desde archivo (K)
    // activos, la lista de la pestaña Ruta la ocupa otro contenido; no mezclar.
    if (_puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles || _fronteraVisibles || _rutaArchivoActiva) return;

    const items = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (!e || e.lat == null) return null;
        return { tipo: 'escala', datos: e };
      }
      const p = state.paradas.find((p) => p.id === o.id);
      if (!p) return null;
      return { tipo: 'parada', datos: p };
    }).filter(Boolean).filter((item) => !item.datos._dragGenerated);

    // Distancia desde la parada anterior: diferencia del km acumulado entre
    // paradas consecutivas (la primera mide desde el origen, km 0).
    let prevKm = 0;
    items.forEach((it) => {
      const e = it.datos;
      if (e && e._distKm != null) {
        e._segKm = Math.max(0, Number(e._distKm) - prevKm);
        prevKm = Number(e._distKm);
      } else if (e) {
        e._segKm = null;
      }
    });

    const total = items.length;
    el.paradasLista.innerHTML = '';
    const incluirExtremos = Boolean(state.rutaActual && state.origen && state.destino);
    el.paradasContador.textContent = String(incluirExtremos ? total : total);
    el.paradasContador.hidden = total === 0;

    // Días de viaje: las paradas se reparten en `state.dias` grupos lo más
    // parejos posible y cada día muestra los km de su tramo.
    const dias = Math.max(1, state.dias || 1);
    const totalKm = state.rutaActual && state.rutaActual.distanciaMetros ? state.rutaActual.distanciaMetros / 1000 : 0;
    const base = Math.floor(total / dias);
    const resto = total % dias;
    const bordes = [];
    let acc = 0;
    for (let d = 0; d < dias; d++) { bordes.push(acc); acc += base + (d < resto ? 1 : 0); }
    bordes.push(total);
    const diaDeItemIdx = (idx) => {
      for (let d = 0; d < dias; d++) if (idx < bordes[d + 1]) return d + 1;
      return dias;
    };
    const kmsDia = (() => {
      const kms = [];
      let prev = 0;
      for (let d = 1; d <= dias; d++) {
        let end;
        if (d === dias) {
          end = totalKm;
        } else {
          const ultimo = bordes[d] - 1;
          const it = ultimo >= bordes[d - 1] ? items[ultimo] : null;
          end = it && it.datos && it.datos._distKm != null ? it.datos._distKm : prev;
        }
        kms.push(Math.max(0, end - prev));
        prev = end;
      }
      return kms;
    })();
    let diaInsertado = 0;
    let diaGrupo = null;       // contenedor (div) de las paradas del día actual
    let ultimoRegular = null;  // {item, etiqueta} de la última parada/pueblo renderizada
    let kmActual = 0;          // km acumulados (desde el origen) al renderizar

    /** Fila de encabezado de día; al pulsarla se pliegan/despliegan sus paradas. */
    function crearFilaDia(d) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--dia';
      li.dataset.tipoParada = 'dia';
      const flecha = document.createElement('span');
      flecha.className = 'parada-item__dia-flecha';
      flecha.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
      const etiqueta = document.createElement('span');
      etiqueta.className = 'parada-item__dia-nombre';
      etiqueta.textContent = _etiquetaDia(d);
      if (etiqueta.textContent.length > 16) etiqueta.title = etiqueta.textContent;
      const km = document.createElement('span');
      km.className = 'parada-item__dia-km';
      km.textContent = kmsDia[d - 1].toFixed(1) + ' km';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'parada-item__btn parada-item__dia-add';
      btn.title = 'Agregar un día más';
      btn.setAttribute('aria-label', 'Agregar un día más');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
      btn.addEventListener('click', (e) => { e.stopPropagation(); agregarDia(); });
      li.appendChild(flecha);
      li.appendChild(etiqueta);
      li.appendChild(km);
      li.appendChild(btn);
      li.role = 'button';
      li.tabIndex = 0;
      li.setAttribute('aria-expanded', 'true');
      li.addEventListener('click', (e) => { e.stopPropagation(); alternarDia(li); });
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); alternarDia(li); }
      });
      // Clic derecho / pulsación larga: cambiar nombre o asignar fecha.
      li.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        abrirMenuFila(_opcionesDia(d), evt.clientX, evt.clientY);
      });
      engancharLongPress(li, (evt) => {
        abrirMenuFila(_opcionesDia(d), evt.clientX, evt.clientY);
      });
      return li;
    }

    function alternarDia(li) {
      const grupo = li._grupo;
      if (!grupo) return;
      const oculto = grupo.style.display === 'none';
      grupo.style.display = oculto ? '' : 'none';
      li.classList.toggle('parada-item--dia-cerrado', !oculto);
      li.setAttribute('aria-expanded', String(oculto));
    }

    function asegurarDiaPara(idx) {
      const d = diaDeItemIdx(idx);
      while (diaInsertado < d) {
        // Continuidad de viaje: el día nuevo arranca donde terminó el anterior.
        const continuacion = ultimoRegular;
        diaInsertado++;
        const filaDia = crearFilaDia(diaInsertado);
        const grupo = document.createElement('div');
        grupo.className = 'parada-dia__grupo';
        filaDia._grupo = grupo;
        el.paradasLista.appendChild(filaDia);
        el.paradasLista.appendChild(grupo);
        diaGrupo = grupo;
        if (continuacion) {
          const duplicado = construirFilaItem(continuacion.item, continuacion.etiqueta);
          duplicado.classList.add('parada-item--continua');
          grupo.appendChild(duplicado);
        }
      }
    }

    /** Agrega una fila al grupo del día actual y recuerda la última parada. */
    function agregarItem(li, info) {
      (diaGrupo || el.paradasLista).appendChild(li);
      if (info && (info.item.tipo === 'escala' || info.item.tipo === 'parada')) ultimoRegular = info;
    }

    // En la pestaña Descubre las paradas no deben aparecer aunque haya paradas;
    // tampoco antes de calcular la ruta inicial (seleccionando pueblos
    // intermedios): las paradas se muestran solo tras el primer cálculo.
    el.panelParadas.hidden = estaEnPestanaDescubre() || !state.rutaActual || (!incluirExtremos && total === 0);

    function crearFilaExtremo(letra, nombre, tipo) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = tipo;
      const extremo = tipo === 'origen' ? state.origen : state.destino;
      if (extremo && extremo.id != null) li.dataset.paradaId = extremo.id;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = letra;

      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      nombreEl.textContent = nombre;

      if (tipo === 'destino' && state.rutaActual?.distanciaMetros) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        // Distancia del tramo final + (distancia total desde el origen).
        const totalKm = state.rutaActual.distanciaMetros / 1000;
        const prevKm = (ultimoRegular && ultimoRegular.item && ultimoRegular.item.datos && ultimoRegular.item.datos._distKm != null)
          ? Number(ultimoRegular.item.datos._distKm)
          : 0;
        const segKm = Math.max(0, totalKm - prevKm);
        distEl.textContent = ` — ${segKm.toFixed(1)} km (${totalKm.toFixed(1)} km)`;
        nombreEl.appendChild(distEl);
      }

      li.appendChild(num);
      li.appendChild(nombreEl);
      li.role = 'button';
      li.tabIndex = 0;

      const accionExtremo = () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        const extremo = tipo === 'origen' ? state.origen : state.destino;
        if (extremo && extremo.lat != null) {
          mostrarCuadroExtremo(tipo, extremo.nombre || '', (extremo.departamento || ''));
        }
      };
      li.addEventListener('click', accionExtremo);
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionExtremo(); }
      });
      const opcionesExtremo = () => {
        const opciones = [];
        if (tipo === 'origen') {
          opciones.push({ etiqueta: 'Cambiar lugar de origen', accion: () => irCambiarOrigen() });
        } else {
          opciones.push({ etiqueta: 'Cambiar lugar de destino', accion: () => irCambiarDestino() });
        }
        opciones.push({
          etiqueta: 'Ubicar en el mapa',
          accion: () => {
            const extremo = tipo === 'origen' ? state.origen : state.destino;
            if (extremo && extremo.lat != null) {
              mostrarCuadroExtremo(tipo, extremo.nombre || '', (extremo.departamento || ''));
            }
          },
        });
        return opciones;
      };
      li.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        abrirMenuFila(opcionesExtremo(), evt.clientX, evt.clientY);
      });
      engancharLongPress(li, (evt) => {
        abrirMenuFila(opcionesExtremo(), evt.clientX, evt.clientY);
      });

      return li;
    }

    function crearFilaAeropuerto(aeropuerto, prefijo, distKm) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = 'aeropuerto';
      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = '✈';
      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      const marquee = document.createElement('span');
      marquee.className = 'parada-item__marquee';
      marquee.appendChild(document.createTextNode((prefijo ? prefijo + ': ' : '') + (aeropuerto || '')));
      if (distKm != null) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        const totalKm = kmActual + distKm;
        distEl.textContent = ` — ${distKm.toFixed(1)} km (${totalKm.toFixed(1)} km)`;
        marquee.appendChild(distEl);
        kmActual = totalKm;
      }
      nombreEl.appendChild(marquee);
      li.appendChild(num);
      li.appendChild(nombreEl);
      li.role = 'button';
      li.tabIndex = 0;
      return li;
    }

    function accionAeropuerto(ap, prefijo) {
      return () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        cerrarMenuFila();
        mostrarCuadroAeropuerto(ap, prefijo);
      };
    }

    function construirFilaAeropuerto(tramos, ap, prefijo, distMetros) {
      const li = crearFilaAeropuerto(ap.nombre, prefijo, distMetros != null ? distMetros / 1000 : null);
      li.addEventListener('click', accionAeropuerto(ap, prefijo));
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionAeropuerto(ap, prefijo)(); }
      });
      return li;
    }

    function crearFilaPuerto(puerto, prefijo, distKm) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = 'puerto';
      const num = document.createElement('span');
      num.className = 'parada-item__num parada-item__num--ico';
      num.innerHTML = '<img src="public/boat.svg" alt="Puerto" style="width:12px;height:12px;filter:brightness(0) invert(1);">';
      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      const marquee = document.createElement('span');
      marquee.className = 'parada-item__marquee';
      marquee.appendChild(document.createTextNode((prefijo ? prefijo + ': ' : '') + (puerto || '')));
      if (distKm != null) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        const totalKm = kmActual + distKm;
        distEl.textContent = ` — ${distKm.toFixed(1)} km (${totalKm.toFixed(1)} km)`;
        marquee.appendChild(distEl);
        kmActual = totalKm;
      }
      nombreEl.appendChild(marquee);
      li.appendChild(num);
      li.appendChild(nombreEl);
      li.role = 'button';
      li.tabIndex = 0;
      return li;
    }

    function accionPuerto(p, prefijo) {
      return () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        cerrarMenuFila();
        mostrarCuadroPuerto(p, prefijo);
      };
    }

    function construirFilaPuerto(tramos, p, prefijo, distMetros) {
      const li = crearFilaPuerto(p.nombre, prefijo, distMetros != null ? distMetros / 1000 : null);
      li.addEventListener('click', accionPuerto(p, prefijo));
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionPuerto(p, prefijo)(); }
      });
      return li;
    }

    function construirFilaItem(item, etiqueta) {
      const e = item.datos;
      const li = document.createElement('li');
      li.className = 'parada-item';
      li.dataset.paradaId = e.id;
      li.dataset.tipoParada = item.tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = etiqueta;

      const nombre = document.createElement('span');
      nombre.className = 'parada-item__nombre';
      const marquee = document.createElement('span');
      marquee.className = 'parada-item__marquee';
      const distEl = document.createElement('span');
      distEl.className = 'parada-item__dist';
      if (e._distKm != null) {
        // Guion largo + distancia desde la parada anterior + (desde el origen).
        distEl.textContent = e._segKm != null
          ? ` — ${e._segKm.toFixed(1)} km (${e._distKm.toFixed(1)} km)`
          : ` — (${e._distKm.toFixed(1)} km)`;
        kmActual = Number(e._distKm);
      }
      marquee.appendChild(document.createTextNode(item.tipo === 'escala' ? formatMunicipio(e) : e.nombre));
      marquee.appendChild(distEl);
      nombre.appendChild(marquee);

      const acciones = document.createElement('div');
      acciones.className = 'parada-item__acciones';

      // Flechas arriba/abajo para mover la parada/pueblo manualmente cuando la
      // ordenación automática está desactivada.
      const autoOrganizar = !el.btnAutoOrganizar || el.btnAutoOrganizar.getAttribute('aria-pressed') === 'true';
      if (!autoOrganizar) {
        const idxOrden = state.orden.findIndex((o) => o.tipo === item.tipo && o.id === e.id);
        const crearFlecha = (titulo, aria, svg, delta) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'parada-item__btn';
          b.title = titulo;
          b.setAttribute('aria-label', aria);
          b.innerHTML = svg;
          b.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idxOrden, idxOrden + delta); });
          b.addEventListener('contextmenu', (evt) => evt.stopPropagation());
          return b;
        };
        acciones.appendChild(crearFlecha('Subir en la ruta', 'Subir ' + e.nombre + ' en la ruta',
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>', -1));
        acciones.appendChild(crearFlecha('Bajar en la ruta', 'Bajar ' + e.nombre + ' en la ruta',
          '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg>', 1));
      }

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'parada-item__btn';
      if (item.tipo === 'escala') {
        btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarEscala(e.id); });
      } else {
        btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarParada(e.id); });
      }
      btnDel.title = 'Quitar de la ruta';
      btnDel.setAttribute('aria-label', 'Quitar ' + e.nombre + ' de la ruta');
      btnDel.addEventListener('contextmenu', (evt) => evt.stopPropagation());
      btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

      acciones.appendChild(btnDel);
      li.appendChild(num);
      li.appendChild(nombre);
      li.appendChild(acciones);
      li.role = 'button';
      li.tabIndex = 0;

      const accionPrincipal = () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        cerrarMenuFila();
        if (item.tipo === 'parada') {
          mostrarCuadroParada(e);
        } else if (item.tipo === 'escala') {
          mostrarCuadroEscala(e);
        }
      };
      li.addEventListener('click', accionPrincipal);
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionPrincipal(); }
      });

      const construirOpcionesContexto = () => {
        if (item.tipo === 'parada') {
          return [
            { etiqueta: 'Llegar en avión a este lugar', accion: () => llegarEnAvionAParada(e) },
            { etiqueta: 'Ubicar en el mapa', accion: () => mostrarCuadroParada(e) },
            { etiqueta: 'Eliminar de la ruta', accion: () => eliminarParada(e.id) },
          ];
        }
        return [
          { etiqueta: 'Cambiar pueblo intermedio', accion: () => cambiarPueblo(e) },
          { etiqueta: 'Eliminar pueblo intermedio', accion: () => eliminarEscala(e.id) },
          { etiqueta: 'Ubicar en la ruta', accion: () => mostrarCuadroEscala(e) },
        ];
      };

      li.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        abrirMenuFila(construirOpcionesContexto(), evt.clientX, evt.clientY);
      });
      engancharLongPress(li, (evt) => {
        abrirMenuFila(construirOpcionesContexto(), evt.clientX, evt.clientY);
      });

      return li;
    }

    if (incluirExtremos || total > 0) {
      asegurarDiaPara(0);
    }

    if (incluirExtremos) {
      agregarItem(crearFilaExtremo('A', formatMunicipio(state.origen), 'origen'));
    }

    // Ruta aérea: la lista sigue el orden físico de la ruta
    // (origen → salida → llegada → pueblo → salida → llegada → … → destino),
    // intercalando los aeropuertos de cada tramo con los puntos intermedios.
    const segsAereos = state.modoAereo && state.tramosAereo ? state.tramosAereo.apSegs : null;
    if (segsAereos && segsAereos.length) {
      const itemsRestantes = items.slice();
      let idxItem = 0;
      for (let i = 0; i < segsAereos.length; i++) {
        const seg = segsAereos[i];
        const dSalida = i === 0
          ? state.tramosAereo.distCarro1
          : (seg.vuelos && seg.vuelos[0] ? seg.vuelos[0].distanciaMetros : null);
        const dLlegada = i === segsAereos.length - 1
          ? state.tramosAereo.distCarro2
          : (seg.vuelos && seg.vuelos.length > 1 ? seg.vuelos[1].distanciaMetros
              : (seg.vuelos && seg.vuelos[0] ? seg.vuelos[0].distanciaMetros : null));
        if (seg.apOri) agregarItem(construirFilaAeropuerto(state.tramosAereo, seg.apOri, 'Salida', dSalida));
        if (seg.apDes) agregarItem(construirFilaAeropuerto(state.tramosAereo, seg.apDes, 'Llegada', dLlegada));
        if (i < segsAereos.length - 1) {
          const pueblo = itemsRestantes.find((it) => it.tipo === 'escala');
          if (pueblo) {
            itemsRestantes.splice(itemsRestantes.indexOf(pueblo), 1);
            asegurarDiaPara(idxItem);
            const etiqueta = etiquetaIntermedia(idxItem++);
            agregarItem(construirFilaItem(pueblo, etiqueta), { item: pueblo, etiqueta });
          }
          while (itemsRestantes.length && itemsRestantes[0].tipo !== 'escala') {
            asegurarDiaPara(idxItem);
            const it = itemsRestantes.shift();
            const etiqueta = etiquetaIntermedia(idxItem++);
            agregarItem(construirFilaItem(it, etiqueta), { item: it, etiqueta });
          }
        }
      }
      while (itemsRestantes.length) {
        asegurarDiaPara(idxItem);
        const it = itemsRestantes.shift();
        const etiqueta = etiquetaIntermedia(idxItem++);
        agregarItem(construirFilaItem(it, etiqueta), { item: it, etiqueta });
      }
      // Ruta multimodal (avión + barco): tras el tramo aéreo se intercalan los
      // puertos fluviales (salida del barco, conexión y llegada).
      if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.po) {
        agregarItem(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.po, 'Salida 🚢', state.tramosFluviales.distCarro1));
      }
      if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.hub && state.tramosFluviales.tramos && state.tramosFluviales.tramos[0]) {
        agregarItem(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.hub, 'Conexión 🚢', state.tramosFluviales.tramos[0].distanciaMetros));
      }
      if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.pd) {
        agregarItem(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.pd, 'Llegada 🚢', state.tramosFluviales.distCarro2));
      }
    } else {
      if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.po) {
        agregarItem(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.po, 'Salida', state.tramosFluviales.distCarro1));
      }
      if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.hub && state.tramosFluviales.tramos && state.tramosFluviales.tramos[0]) {
        agregarItem(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.hub, 'Conexión', state.tramosFluviales.tramos[0].distanciaMetros));
      }
      items.forEach((item, idx) => {
        asegurarDiaPara(idx);
        const etiqueta = etiquetaIntermedia(idx);
        agregarItem(construirFilaItem(item, etiqueta), { item, etiqueta });
      });
      if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.pd) {
        agregarItem(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.pd, 'Llegada', state.tramosFluviales.distCarro2));
      }
    }
    asegurarDiaPara(total);
    if (incluirExtremos) {
      agregarItem(crearFilaExtremo('Z', formatMunicipio(state.destino), 'destino'));
    }

    // Nombres largos (incluyendo distancias): se marcan para que el texto se
    // desplace y pueda leerse completo. En PC la animación solo corre al pasar
    // el cursor; en móvil siempre.
    _marcarMarqueeParadas();
    _iniciarObservadorParadas();
    // Re-medir tras el layout (por si el panel aún no tenía dimensiones).
    requestAnimationFrame(() => _marcarMarqueeParadas());
    // Drag & drop entre las paradas (los días no se mueven).
    _initDragParadas();
  }

