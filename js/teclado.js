/**
 * teclado.js
 * ---------------------------------------------------------------------------
 * Infraestructura del teclado virtual en móvil: reposicionamiento en bloque de
 * la interfaz inferior, ocultar la barra de pestañas al enfocar un cuadro y
 * ajuste de las listas de opciones abiertas. Aplica a TODOS los cuadros de
 * búsqueda (origen, destino y pueblos intermedios) por delegación de eventos.
 * ---------------------------------------------------------------------------
 */

  function reposicionarInterfazTeclado(activar) {
    const app = el.appRoot;
    const restaurar = () => {
      app.classList.remove('teclado-abierto');
      app.style.removeProperty('--teclado-alto');
      _ajustarListasAbiertas();
    };
    if (!activar || !esMovil()) {
      restaurar();
      return;
    }
    const cubierto = _tecladoCubierto();
    if (cubierto <= 0) {
      restaurar();
      return;
    }
    // Lift MÍNIMO: el bloque sube solo lo necesario para que el cuadro
    // enfocado quede sobre el teclado, no el teclado completo (eso los
    // llevaba demasiado arriba). Si el cuadro ya está visible, no se sube.
    // Con la lista del cuadro ABIERTA, se reserva además su alto para que
    // el menú quepa desplegándose hacia abajo.
    const altoVisible = window.innerHeight - cubierto;
    let lift = cubierto;
    const act = document.activeElement;
    if (esCampoTeclado(act)) {
      const r = act.getBoundingClientRect();
      let extra = 0;
      if (esTriggerCombo(act)) {
        const lista = act.parentElement && act.parentElement.querySelector('.combo__list');
        if (lista && !lista.hidden) {
          const tope = lista.classList.contains('combo__list--6') ? 200 : 170;
          extra = Math.min(tope, Math.max(40, lista.scrollHeight));
        }
      }
      const necesario = Math.max(0, Math.round(r.bottom + 8 + extra - altoVisible));
      lift = Math.min(cubierto, necesario);
    }
    app.style.setProperty('--teclado-alto', lift + 'px');
    app.classList.add('teclado-abierto');
    // El transform del lift se aplica en el siguiente frame de layout; la
    // medición de la lista se difiere para leer los rects ya transformados
    // (si no, maxHeight se calculaba con la posición vieja del trigger y
    // la lista quedaba cortada mostrando solo una o dos opciones).
    requestAnimationFrame(() => { _ajustarListasAbiertas(); });
  }

  /** Cuánto tapa el teclado del área visible: prioriza la geometría exacta de
   *  la VirtualKeyboard API (que también funciona en pantalla completa, donde
   *  visualViewport puede no actualizarse) y cae al visualViewport. El rect de
   *  la API solo se usa si su borde inferior coincide con el fondo del layout
   *  (si no, está en otro espacio de coordenadas y se usa visualViewport). */

  function _tecladoCubierto() {
    try {
      const vk = navigator.virtualKeyboard;
      if (vk && typeof vk.boundingRect !== 'undefined' && vk.boundingRect && vk.boundingRect.height > 0) {
        const br = vk.boundingRect;
        const fondo = br.top + br.height;
        if (fondo >= window.innerHeight - 2 && fondo <= window.innerHeight + 2) {
          return Math.round(Math.max(0, window.innerHeight - br.top));
        }
      }
    } catch (e) { /* ignorar */ }
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const crudo = Math.round(window.innerHeight - (vv.height + vv.offsetTop));
      if (crudo > 0) {
        // En pantalla normal el teclado físico tiene una barra de
        // sugerencias/emojis (toolbar) que el visualViewport no mide.
        const corr = typeof window.CORR_TECLADO !== 'undefined' ? window.CORR_TECLADO : 0;
        return Math.max(0, crudo - corr);
      }
      return 0;
    }
    return 0;
  }


  const esTriggerCombo = (t) => Boolean(t && t.classList && t.classList.contains('combo__trigger'));
  const esCampoTeclado = (t) => esTriggerCombo(t) || Boolean(t && t.id === 'buscar-sitios');

  // VirtualKeyboard API en modo superposición: el layout NO se encoge con el
  // teclado (el panel conserva su altura y las opciones no se cortan) y
  // `geometrychange` entrega la geometría real del teclado para levantar el
  // bloque (también en pantalla completa).

  if (navigator.virtualKeyboard && typeof navigator.virtualKeyboard.overlayContent !== 'undefined') {
    try { navigator.virtualKeyboard.overlayContent = true; } catch (e) { /* ignorar */ }
  }

  // Aplica a TODOS los cuadros de búsqueda (origen, destino y los pueblos
  // intermedios que se crean dinámicamente desde las paradas).

  document.addEventListener('focusin', (e) => {
    if (esCampoTeclado(e.target)) {
      // Al editar un cuadro (origen, pueblo intermedio, destino o el buscador
      // de Descubre) la barra inferior se oculta: no sube flotando sobre el
      // teclado. El lift del bloque NO se aplica aquí: lo disparan los
      // manejadores de focus/toggle de cada cuadro y los eventos del teclado,
      // usando el estado FINAL de la lista (aplicar dos veces producía el
      // doble salto).
      el.appRoot.classList.add('combo-enfocado');
    }
  });

  document.addEventListener('focusout', (e) => {
    if (!esCampoTeclado(e.relatedTarget)) {
      el.appRoot.classList.remove('combo-enfocado');
      reposicionarInterfazTeclado(false);
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (esCampoTeclado(document.activeElement)) reposicionarInterfazTeclado(true);
      else reposicionarInterfazTeclado(false);
    });
    window.visualViewport.addEventListener('scroll', () => {
      if (esCampoTeclado(document.activeElement)) reposicionarInterfazTeclado(true);
    });
  }

  if (navigator.virtualKeyboard && typeof navigator.virtualKeyboard.addEventListener === 'function') {
    navigator.virtualKeyboard.addEventListener('geometrychange', () => {
      if (esCampoTeclado(document.activeElement)) reposicionarInterfazTeclado(true);
      else reposicionarInterfazTeclado(false);
    });
  }

  /** Reubica las listas de opciones abiertas tras un cambio del teclado (el
   *  bloque sube o baja con transform, que no dispara `resize`). */

  function _ajustarListasAbiertas() {
    document.querySelectorAll('.combo__list:not([hidden])').forEach((l) => {
      const trig = l.parentElement && l.parentElement.querySelector('.combo__trigger');
      ajustarComboAlTeclado(trig, l);
    });
  }

  /** En móvil, el menú de opciones del cuadro se despliega SIEMPRE hacia
   *  abajo; su alto máximo se limita al espacio visible bajo el cuadro (el
   *  bloque completo sube con el teclado lo necesario para que quepa, ver
   *  reposicionarInterfazTeclado). El cuadro enfocado lo sube el bloque
   *  (teclado-abierto), por eso aquí no se usa scrollIntoView: sumado al
   *  transform subiría el cuadro fuera de la pantalla. */

  function ajustarComboAlTeclado(trigger, listEl) {
    if (!esMovil() || !listEl) return;
    if (!trigger) {
      listEl.style.maxHeight = '';
      listEl.style.top = '';
      listEl.style.bottom = '';
      return;
    }
    const altoVisible = window.innerHeight - _tecladoCubierto();
    const espacioAbajo = Math.max(0, altoVisible - trigger.getBoundingClientRect().bottom - 6);
    const tope = listEl.classList.contains('combo__list--6') ? 200 : 170; // 6 u 5 elementos
    listEl.style.maxHeight = Math.min(tope, Math.max(40, espacioAbajo)) + 'px';
    listEl.style.top = 'calc(100% + 6px)';
    listEl.style.bottom = 'auto';
  }

  /** Con el teclado abierto y un cuadro enfocado, recalcula el lift del bloque
   *  según el estado actual de su lista: reserva el espacio del menú al
   *  abrirlo, o baja al lift mínimo al cerrarlo. Todo al instante, sin
   *  temporizadores. */

  function reencajarConTeclado() {
    if (esMovil() && _tecladoCubierto() > 0 && esCampoTeclado(document.activeElement)) {
      reposicionarInterfazTeclado(true);
    }
  }


  window.addEventListener('resize', _ajustarListasAbiertas);


  function garantizarVisibilidadMovil() {
    if (esMovil()) {
      if (el.mobileTabBar) el.mobileTabBar.removeAttribute('hidden');
      setTimeout(() => MapModule.invalidateSize(), 50);
    }
  }


  window.addEventListener('resize', garantizarVisibilidadMovil);

