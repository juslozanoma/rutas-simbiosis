/**
 * utilApp.js
 * ---------------------------------------------------------------------------
 * Utilidades generales de la aplicación: helpers de formato, estado de carga,
 * visibilidad móvil y funciones auxiliares reutilizadas por otros módulos.
 * ---------------------------------------------------------------------------
 */

  function _syncFrontera() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresFrontera) return;
    if (_fronteraVisibles) {
      MapModule.setMarcadoresFrontera(state.sitios.filter((s) => s.frontera));
    } else {
      MapModule.limpiarSitiosFrontera();
    }
  }


  // Pestaña que estaba activa antes de activar el catálogo de puertos/
  // aeropuertos (A/P); se restaura al apagar ambas teclas.

  let _pestanaAntesInfra = null;


  function _syncPuertos() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresPuertosGlobal) return;
    if (_puertosVisibles) {
      MapModule.setMarcadoresPuertosGlobal(state.puertos);
    } else {
      MapModule.limpiarPuertosGlobal();
    }
    _syncModoInfra();
  }


  function _syncAeropuertos() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresAeropuertosGlobal) return;
    if (_aeropuertosVisibles) {
      MapModule.setMarcadoresAeropuertosGlobal(state.aeropuertos);
    } else {
      MapModule.limpiarAeropuertosGlobal();
    }
    _syncModoInfra();
  }


  /** Con el catálogo de puertos/aeropuertos (teclas A/P) activo se ocultan los
   *  cuadros de búsqueda de origen/destino y la pestaña Descubre, y la lista de
   *  la pestaña Ruta muestra el listado de infraestructura. Al apagar ambas
   *  teclas se restaura el panel tal como estaba. */
  function _syncModoInfra() {
    const activo = _puertosVisibles || _aeropuertosVisibles;
    if (el.appRoot) {
      if (activo) el.appRoot.setAttribute('data-infra-activa', 'true');
      else el.appRoot.removeAttribute('data-infra-activa');
    }
    if (activo) {
      if (_pestanaAntesInfra == null) _pestanaAntesInfra = estaEnPestanaDescubre() ? 'descubre' : 'ruta';
      if (estaEnPestanaDescubre()) {
        if (esMovil()) setMobileTab('ruta');
        else activarPanelTab('ruta');
      }
      if (el.panelLocate) el.panelLocate.hidden = true;
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = true;
      if (el.btnTabDescubre) el.btnTabDescubre.hidden = true;
      if (el.btnMostrarSitiosCercanos) {
        el.btnMostrarSitiosCercanos.hidden = true;
        el.btnMostrarSitiosCercanos.disabled = true;
      }
      if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
    } else {
      const volverA = _pestanaAntesInfra;
      _pestanaAntesInfra = null;
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
      if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
      if (typeof _restaurarPanelRutaInfra === 'function') _restaurarPanelRutaInfra();
      // Si la ruta desde archivo (K) sigue activa, reponer su tarjeta en la lista.
      if (_rutaArchivoActiva && typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.refrescarPanel === 'function') {
        RutaArchivoModule.refrescarPanel();
      }
      if (volverA === 'descubre' && !estaEnPestanaDescubre()) {
        activarPanelTab('descubre');
        if (esMovil()) setMobileTab('descubre');
      } else {
        activarPanelTab('ruta');
        if (esMovil()) setMobileTab('ruta');
      }
    }
  }


  function etiquetaIntermedia(idx) {
    return LETRAS_RUTA[Math.min(idx + 1, LETRAS_RUTA.length - 2)];
  }


  function actualizarBotonesOrden() {
    if (!el.btnOrdenOrigen || !el.btnOrdenDestino) return;
    el.btnOrdenOrigen.setAttribute('aria-pressed', String(state.ordenSitios === 'origen'));
    el.btnOrdenDestino.setAttribute('aria-pressed', String(state.ordenSitios === 'destino'));
  }


  function _actualizarTextoBotonesOrden() {
    if (el.btnOrdenOrigenDes) el.btnOrdenOrigenDes.textContent = state.origen?.nombre ? `Desde ${state.origen.nombre}` : 'Desde Origen';
    if (el.btnOrdenDestinoDes) el.btnOrdenDestinoDes.textContent = state.destino?.nombre ? `Desde ${state.destino.nombre}` : 'Desde Destino';
  }


  function _actualizarEstadoBotonesDescubre() {
    if (el.btnOrdenOrigenDes) el.btnOrdenOrigenDes.classList.toggle('descubre-dropdown__item--active', state.ordenSitios === 'origen');
    if (el.btnOrdenDestinoDes) el.btnOrdenDestinoDes.classList.toggle('descubre-dropdown__item--active', state.ordenSitios === 'destino');
  }


  function actualizarEstadoBotonCalcular() {
    el.btnCalcular.disabled = !(state.origen && state.destino);
  }

  /** Activa modo de selección en el mapa: el usuario hace clic y se llama a `callback(lat, lon)`. */

  function esMovil() {
    return window.matchMedia(MEDIA_MOVIL).matches;
  }

  /** El "+" de agregar pueblo intermedio no existe (se oculta con CSS) y el
   *  botón de avión vive en la fila del origen, igual en móvil y escritorio:
   *  la fila del origen y la de cada pueblo intermedio quedan con un botón
   *  de 40px y los cuadros tienen el mismo ancho. */

  function reordenarAereoMovil() {
    const filaOrigen = document.getElementById('row-origen');
    const filaDestino = document.getElementById('row-destino');
    if (!el.btnAereo || !filaOrigen || !filaDestino) return;
    if (el.btnAereo.parentElement !== filaOrigen) filaOrigen.appendChild(el.btnAereo);
    if (el.btnFluvial && el.btnFluvial.parentElement !== filaOrigen) filaOrigen.appendChild(el.btnFluvial);
  }

  window.addEventListener('resize', reordenarAereoMovil);

  /** Indica si la pestaña activa del panel es "Descubre Colombia". */

  function estaEnPestanaDescubre() {
    if (esMovil()) {
      return el.appRoot && el.appRoot.getAttribute('data-mobile-tab') === 'descubre';
    }
    return Boolean(el.btnTabPanelDescubre && el.btnTabPanelDescubre.classList.contains('panel-tab--active'));
  }

  /** Tras calcular la ruta se ocultan los cuadros de origen y destino (aparece el botón "+"). */

  function sincronizarModoRutaMovil() {
    if (state.rutaActual) {
      el.appRoot.setAttribute('data-ruta-lista', 'true');
    } else {
      el.appRoot.removeAttribute('data-ruta-lista');
    }
  }

  // Estado del reposicionamiento en bloque de la interfaz inferior.
  // El bloque (cuadros de búsqueda, botones y barra de navegación) sube con
  // transform EXACTAMENTE lo que el teclado tapa del área visible. Así el panel
  // conserva su altura completa: el espacio en blanco sobre la barra inferior
  // se mantiene y las listas de opciones de TODOS los cuadros (origen, destino
  // y pueblos intermedios) pueden desplegarse sin cortarse.
  // (Con interactive-widget=resizes-content o VirtualKeyboard overlayContent
  // en falso, el panel se encoge con el teclado y las opciones quedan cortadas,
  // por eso el teclado se superpone y el bloque se levanta con transform).
  // SIN temporizadores ni transiciones: cada evento del teclado (visualViewport
  // o geometrychange) aplica el lift al instante, el bloque sigue la animación
  // del teclado y las listas abiertas se reposicionan en el mismo instante.

  function ponerEnCargaRuta(cargando, silencioso = false) {
    if (cargando) el.btnCalcular.disabled = true;
    el.btnCalcular.setAttribute('data-loading', cargando ? 'true' : 'false');
    if (el.btnAereo) el.btnAereo.disabled = cargando;
    if (el.btnFluvial) el.btnFluvial.disabled = cargando;
    // El spinner Monalisa no debe aparecer en la pestaña Descubre ni en recálculos
    // silenciosos (p. ej. al agregar un sitio a la ruta).
    if (el.loadingRuta) el.loadingRuta.hidden = !cargando || silencioso || estaEnPestanaDescubre();
    if (cargando && el.loadingSitios) el.loadingSitios.hidden = true;
    el.btnAgregarEscala.disabled = cargando;
    el.origenInput.disabled = cargando;
    el.destinoInput.disabled = cargando;
    document.querySelectorAll('.combo__trigger.escala-trigger').forEach((b) => { b.disabled = cargando; });
    document.querySelectorAll('.escala-row__calc').forEach((b) => {
      b.disabled = cargando;
      b.setAttribute('data-loading', cargando ? 'true' : 'false');
    });
    document.querySelectorAll('.sitio-card__add').forEach((b) => { b.disabled = cargando; });
    if (esMovil()) {
      el.panelLocate.hidden = cargando;
      // El testigo "Mostrar sitios" se oculta solo mientras se carga; al terminar
      // su visibilidad la decide activarPanelTab/_habilitarMostrarSitios.
      if (cargando) el.btnMostrarSitiosCercanos.hidden = true;
      if (el.panelParadas) el.panelParadas.hidden = cargando;
    }
  }

  /** Sincroniza el botón flotante del mapa según haya o no listado en Descubre. */

  function _syncBotonSitios() {
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.hidden = state.sitiosFiltrados.length === 0;
  }


  function _habilitarMostrarSitios() {
    // Habilita la pestaña Descubre tras calcular una ruta.
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    if (el.icoDescubreTab) el.icoDescubreTab.hidden = true;
    if (el.icoDescubreTabDesktop) el.icoDescubreTabDesktop.hidden = true;
    if (el.sitiosContadorTab) el.sitiosContadorTab.hidden = false;
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.hidden = false;
    // El testigo "Mostrar sitios" solo aparece tras calcular la PRIMERA ruta
    // y luego se elimina para siempre.
    if (_soMostrarSitiosVisto) {
      el.btnMostrarSitiosCercanos.disabled = true;
      el.btnMostrarSitiosCercanos.hidden = true;
      return;
    }
    _soMostrarSitiosVisto = true;
    el.btnMostrarSitiosCercanos.disabled = false;
    el.btnMostrarSitiosCercanos.hidden = false;
  }


  function formatMunicipio(m) {
    if (!m || !m.nombre) return '';
    if (m.nombre === 'Bogotá D.C.' || !m.departamento) return m.nombre;
    return m.nombre + ', ' + m.departamento;
  }

  /** Sincroniza el botón redondo de "sitios visibles" con el modo de visibilidad actual. */

  function btnIcono(d) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'parada-item__btn';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    return b;
  }

  // -------------------------------------------------------------------
  // Renderizar lista de paradas en el panel (escalas + sitios turísticos)
  // -------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Menú contextual de las filas de paradas (clic derecho / pulsación larga)
  // ---------------------------------------------------------------------

  function ponerEnCarga(boton, cargando) {
    boton.disabled = cargando;
    boton.setAttribute('data-loading', cargando ? 'true' : 'false');
  }

  /** Cambia el icono del botón de filtro entre retry y check. */

  // -------------------------------------------------------------------
  // Notificación toast simple, auto-descartable
  // -------------------------------------------------------------------


  function _mostrarNotificacion(texto) {
    const el = document.createElement('div');
    el.textContent = texto;
    Object.assign(el.style, {
      position: 'fixed', bottom: '20px', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--verde-500, #22c55e)', color: '#fff',
      padding: '8px 20px', borderRadius: '8px', zIndex: '10000',
      fontSize: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      transition: 'opacity 0.3s',
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
  }

  // -------------------------------------------------------------------
  // Marcación de tramos peligrosos (clic secundario → confirmación)
  // -------------------------------------------------------------------


  function onTramoMarcado(tramo) {
    _mostrarConfirmacionTramo(tramo);
  }


  function _mostrarConfirmacionTramo(tramo) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog dialog--confirm">
        <p class="dialog__text">Estás a punto de marcar esta carretera como una vía destapada. ¿Estás seguro?</p>
        <div class="dialog__actions">
          <button type="button" class="dialog__btn dialog__btn--cancel" id="dialog-tramo-cancel">Cancelar</button>
          <button type="button" class="dialog__btn dialog__btn--save" id="dialog-tramo-confirm">Aceptar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#dialog-tramo-cancel').addEventListener('click', () => {
      tramo.limpiar();
      overlay.remove();
    });

    overlay.querySelector('#dialog-tramo-confirm').addEventListener('click', async () => {
      overlay.remove();
      const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const nuevaRuta = {
        id,
        nombre: 'Tramo destapado',
        descripcion: 'Ruta destapada, transitar con precaución',
        coordenadas: tramo.segmento || [tramo.punto, tramo.punto],
        mensaje: 'Ruta destapada, transitar con precaución',
        tipo: 'destapada',
        color: '#e5a000',
      };
      try {
        await RouteWarningsModule.agregarPersonalizada(nuevaRuta);
        _mostrarNotificacion('Tramo peligroso guardado');
      } catch (err) {
        console.error('Error al guardar tramo:', err);
        tramo.limpiar();
        return;
      }
      tramo.limpiar();
      if (state.rutaActual) {
        try {
          await calcularRutaPrincipal(true);
        } catch (err) {
          console.error('Error al recalcular ruta tras marcar tramo:', err);
        }
      }
    });

    function onKey(e) {
      if (e.key === 'Escape') { overlay.querySelector('#dialog-tramo-cancel').click(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.dialog').addEventListener('click', (e) => e.stopPropagation());
    overlay.addEventListener('click', () => overlay.querySelector('#dialog-tramo-cancel').click());
  }

