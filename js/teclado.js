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
    // Con el teclado abierto la lista del cuadro se despliega hacia ARRIBA
    // (ver ajustarComboAlTeclado): el menú va sobre el cuadro, dentro del
    // panel, así que el lift solo necesita despejar el cuadro del teclado.
    const altoVisible = window.innerHeight - cubierto;
    let lift = cubierto;
    const act = document.activeElement;
    // El lift se aplica al .side-panel (CSS teclado-abierto): solo tiene
    // sentido cuando el campo enfocado vive dentro del panel. Los campos de
    // diálogos flotantes (nuevo puerto, buscador global) no levantan el bloque.
    if (!act || !act.closest('.side-panel')) {
      restaurar();
      return;
    }
    if (esCampoTeclado(act)) {
      const r = act.getBoundingClientRect();
      const necesario = Math.max(0, Math.round(r.bottom + 8 - altoVisible));
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
  // Cualquier campo editable (combos, buscadores, cuadros de texto, select y
  // áreas) cuenta como "campo con teclado": al enfocarlo se oculta la barra
  // inferior y se levanta el bloque si el campo vive dentro del panel. Quedan
  // fuera los de tipo no textual (checkbox, radio, rango, archivo, botones).
  const esCampoTeclado = (t) => Boolean(
    t && t.matches &&
    t.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="button"]):not([type="submit"]):not([type="hidden"]), textarea, select, [contenteditable="true"]')
  );

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
      const trig = l._trigger || (l.parentElement && l.parentElement.querySelector('.combo__trigger'));
      ajustarComboAlTeclado(trig, l);
    });
  }

  /** En móvil, el menú de opciones del cuadro se despliega hacia abajo cuando
   *  el teclado está cerrado y hacia ARRIBA cuando el teclado está abierto (el
   *  teclado taparía la zona inferior). Su alto máximo se limita al espacio
   *  visible sobre el cuadro (el bloque sube con el teclado lo necesario para
   *  que quepa, ver reposicionarInterfazTeclado). El cuadro enfocado lo sube el
   *  bloque (teclado-abierto), por eso aquí no se usa scrollIntoView: sumado al
   *  transform subiría el cuadro fuera de la pantalla. */

  function ajustarComboAlTeclado(trigger, listEl) {
    if (!listEl) return;
    if (!trigger) {
      listEl.style.maxHeight = '';
      listEl.style.top = '';
      listEl.style.bottom = '';
      listEl.style.left = '';
      listEl.style.width = '';
      return;
    }
    // Lista portada (trasladada a <body> por municipioCombo para que las
    // opciones no se corten con el overflow del panel): se posiciona sobre el
    // viewport en TODOS los dispositivos. Abre hacia abajo cuando el teclado
    // está cerrado y hay espacio, y hacia arriba cuando el teclado lo taparía.
    const portada = listEl.parentElement === document.body;
    if (portada) {
      const tope = listEl.classList.contains('combo__list--6') ? 200 : 170; // 6 u 5 elementos
      const r = trigger.getBoundingClientRect();
      listEl.style.left = r.left + 'px';
      listEl.style.width = r.width + 'px';
      const cubierto = esMovil() ? _tecladoCubierto() : 0;
      const espacioAbajo = Math.max(0, Math.round(window.innerHeight - r.bottom - 6));
      const espacioArriba = Math.max(0, Math.round(r.top - 6));
      if (cubierto > 0 || (espacioAbajo < tope && espacioArriba > espacioAbajo)) {
        listEl.style.maxHeight = Math.min(tope, Math.max(40, espacioArriba)) + 'px';
        listEl.style.top = 'auto';
        listEl.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
      } else {
        listEl.style.maxHeight = Math.min(tope, Math.max(40, espacioAbajo)) + 'px';
        listEl.style.top = Math.round(r.bottom + 6) + 'px';
        listEl.style.bottom = 'auto';
      }
      return;
    }
    if (!esMovil()) return;
    const cubierto = _tecladoCubierto();
    const tope = listEl.classList.contains('combo__list--6') ? 200 : 170; // 6 u 5 elementos
    const r = trigger.getBoundingClientRect();
    if (cubierto > 0) {
      // Teclado abierto: la lista se despliega hacia arriba. Se limita al
      // espacio sobre el cuadro dentro del panel (su borde superior) para no
      // cortarse con el overflow del side-panel.
      const panel = listEl.closest('.side-panel');
      const topePanel = panel ? panel.getBoundingClientRect().top : 0;
      const espacioArriba = Math.max(0, Math.round(r.top - topePanel - 6));
      listEl.style.maxHeight = Math.min(tope, Math.max(40, espacioArriba)) + 'px';
      listEl.style.top = 'auto';
      listEl.style.bottom = 'calc(100% + 6px)';
    } else {
      // Teclado cerrado: la lista se despliega hacia abajo.
      const altoVisible = window.innerHeight;
      const espacioAbajo = Math.max(0, altoVisible - r.bottom - 6);
      listEl.style.maxHeight = Math.min(tope, Math.max(40, espacioAbajo)) + 'px';
      listEl.style.top = 'calc(100% + 6px)';
      listEl.style.bottom = 'auto';
    }
  }

  /** Al hacer scroll en cualquier contenedor (o el documento), las listas
   *  portadas (fijas sobre el viewport) se reubican para seguir al cuadro. El
   *  scroll interno de la propia lista no la mueve: las opciones se desplazan
   *  con normalidad. */

  document.addEventListener('scroll', (e) => {
    const alvo = e.target;
    document.querySelectorAll('.combo__list:not([hidden])').forEach((l) => {
      if (l.parentElement !== document.body) return;
      if (alvo === l || (l.contains && l.contains(alvo))) return;
      const trig = l._trigger;
      if (trig) ajustarComboAlTeclado(trig, l);
    });
  }, true);

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

