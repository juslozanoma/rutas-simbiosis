/**
 * tour.js
 * ---------------------------------------------------------------------------
 * Modo "Iniciar tour": se seleccionan destinos (municipios) sin calcular
 * ninguna ruta. Cada destino muestra sus sitios turísticos a 30 km en el
 * listado de Descubre, y una lista de destinos elegidos aparece en el panel.
 * Mientras está activo, la pestaña Ruta pasa a "TOUR" (o "tour" en móvil) con
 * el icono tour.svg.
 * ---------------------------------------------------------------------------
 */

  let _comboTour = null;
  let _sitiosTour = [];   // sitios acumulados de los destinos elegidos

  function _toggleTour() {
    if (_tourActivo) _desactivarTour();
    else _activarTour();
  }

  function _activarTour() {
    _tourActivo = true;
    if (el.appRoot) el.appRoot.setAttribute('data-tour-activo', 'true');
    state.tourDestinos = [];
    _sitiosTour = [];
    _limpiarSitiosTour();
    _crearComboTour();
    _crearCerrarTour();
    if (el.panelLocate) el.panelLocate.hidden = true;
    if (el.panelTour) el.panelTour.hidden = false;
    if (el.btnIniciarTour) el.btnIniciarTour.setAttribute('aria-pressed', 'true');
    _aplicarEtiquetasTour();
    activarPanelTab('ruta');
    if (esMovil()) setMobileTab('ruta');
    _renderTourDestinos();
    setTimeout(() => { if (el.tourInput) el.tourInput.focus(); }, 60);
  }

  function _desactivarTour() {
    _tourActivo = false;
    if (el.appRoot) el.appRoot.removeAttribute('data-tour-activo');
    state.tourDestinos = [];
    _sitiosTour = [];
    _limpiarSitiosTour();
    _quitarCerrarTour();
    if (_comboTour && typeof _comboTour.limpiarTexto === 'function') _comboTour.limpiarTexto();
    if (el.tourInput) el.tourInput.placeholder = 'Seleccionar un destino';
    if (el.panelTour) el.panelTour.hidden = true;
    if (el.panelLocate) el.panelLocate.hidden = _puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles || _fronteraVisibles || _rutaArchivoActiva;
    if (el.btnIniciarTour) el.btnIniciarTour.setAttribute('aria-pressed', 'false');
    if (el.tourDestinosLista) el.tourDestinosLista.innerHTML = '';
    _restaurarEtiquetasTour();
    renderizarParadas();
  }

  /** Pestaña X para cerrar el tour, a la derecha de Descubre (solo durante el
   *  tour; se elimina al terminar). */
  function _crearCerrarTour() {
    const crear = (id, clase, ancho, descubreBtn) => {
      if (document.getElementById(id) || !descubreBtn) return;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = id;
      b.className = clase;
      b.title = 'Cerrar el tour';
      b.setAttribute('aria-label', 'Cerrar el tour');
      b.innerHTML = `<svg viewBox="0 0 24 24" width="${ancho}" height="${ancho}" fill="none" stroke="#d64545" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
      b.addEventListener('click', () => _desactivarTour());
      descubreBtn.parentNode.insertBefore(b, descubreBtn.nextSibling);
    };
    crear('btn-cerrar-tour-desktop', 'panel-tab panel-tab--cerrar-tour', 15, document.getElementById('btn-tab-panel-descubre'));
    crear('btn-cerrar-tour', 'mobile-tab-btn mobile-tab-btn--cerrar-tour', 18, document.getElementById('btn-tab-descubre'));
  }

  function _quitarCerrarTour() {
    ['btn-cerrar-tour-desktop', 'btn-cerrar-tour'].forEach((id) => {
      const b = document.getElementById(id);
      if (b && b.parentNode) b.parentNode.removeChild(b);
    });
  }

  function _aplicarEtiquetasTour() {
    if (el.btnTabPanelRutaLabel) el.btnTabPanelRutaLabel.textContent = 'TOUR';
    if (el.btnTabRutaLabel) el.btnTabRutaLabel.textContent = 'Tour';
    if (el.icoTabRutaDesktop) {
      el.icoTabRutaDesktop.classList.remove('tab-icon--sign-post');
      el.icoTabRutaDesktop.classList.add('tab-icon--tour');
    }
    if (el.icoTabRuta) {
      el.icoTabRuta.classList.remove('tab-icon--sign-post');
      el.icoTabRuta.classList.add('tab-icon--tour');
    }
  }

  function _restaurarEtiquetasTour() {
    if (typeof _restaurarEtiquetaPestanaRuta === 'function') _restaurarEtiquetaPestanaRuta();
    if (el.icoTabRutaDesktop) {
      el.icoTabRutaDesktop.classList.remove('tab-icon--tour');
      el.icoTabRutaDesktop.classList.add('tab-icon--sign-post');
    }
    if (el.icoTabRuta) {
      el.icoTabRuta.classList.remove('tab-icon--tour');
      el.icoTabRuta.classList.add('tab-icon--sign-post');
    }
  }

  function _crearComboTour() {
    if (_comboTour || typeof MunicipioCombo === 'undefined') return;
    _comboTour = MunicipioCombo.crear({
      contenedor: document.querySelector('.combo[data-combo="tour"]'),
      placeholder: 'Seleccionar un destino',
      lineas: 5,
      scope: el.panelTour,
      excluirIds: () => {
        const ids = new Set();
        state.tourDestinos.forEach((d) => { if (d.id != null) ids.add(d.id); });
        return ids;
      },
      onSelect: (m) => _seleccionarDestinoTour(m),
      onEnter: () => {},
    });
  }

  /** Sitios a 30 km de un municipio. */
  function _sitiosDePueblo(m) {
    const centro = turf.point([Number(m.lon), Number(m.lat)]);
    return state.sitios.filter((s) => {
      if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) return false;
      const d = turf.distance(centro, turf.point([Number(s.lon), Number(s.lat)]), { units: 'kilometers' });
      return d <= 30;
    });
  }

  function _seleccionarDestinoTour(m) {
    if (!m) return;
    const sitios = _sitiosDePueblo(m);
    if (!state.tourDestinos.some((d) => String(d.id) === String(m.id))) {
      state.tourDestinos.push({
        id: m.id,
        nombre: m.nombre,
        departamento: m.departamento || '',
        lat: m.lat,
        lon: m.lon,
        totalSitios: sitios.length,
      });
    }
    // Acumular los sitios únicos de todos los destinos.
    const mapa = new Map();
    _sitiosTour.forEach((s) => mapa.set(String(s.id), s));
    sitios.forEach((s) => mapa.set(String(s.id), s));
    _sitiosTour = [...mapa.values()];
    _mostrarSitiosTour();
    _renderTourDestinos();
    // Centrar la ciudad elegida en el mapa (zoom de municipio).
    if (typeof MapModule !== 'undefined' && typeof MapModule.centrarEn === 'function') {
      MapModule.centrarEn(Number(m.lat), Number(m.lon), 12);
    }
    // Reiniciar el cuadro con el texto "Añadir otro destino" (solo mostrarlo,
    // sin enfocarlo ni abrir el teclado/lista).
    if (_comboTour && typeof _comboTour.limpiarTexto === 'function') _comboTour.limpiarTexto();
    if (el.tourInput) el.tourInput.placeholder = 'Añadir otro destino';
  }

  function _quitarDestinoTour(id) {
    state.tourDestinos = state.tourDestinos.filter((d) => String(d.id) !== String(id));
    const mapa = new Map();
    state.tourDestinos.forEach((d) => {
      _sitiosDePueblo(d).forEach((s) => mapa.set(String(s.id), s));
    });
    _sitiosTour = [...mapa.values()];
    _mostrarSitiosTour();
    _renderTourDestinos();
  }

  function _mostrarSitiosTour() {
    state.sitiosFiltradosBase = _sitiosTour;
    state.sitiosFiltrados = _sitiosTour;
    state.modoVisibilidad = 'completa';
    if (typeof renderizarSitios === 'function') renderizarSitios(_sitiosTour);
    // La pestaña Descubre queda disponible.
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
  }

  function _limpiarSitiosTour() {
    if (typeof MapModule !== 'undefined' && typeof MapModule.limpiarSitios === 'function') MapModule.limpiarSitios();
    if (typeof _borrarListadoDescubre === 'function') _borrarListadoDescubre();
  }

  function _renderTourDestinos() {
    const lista = el.tourDestinosLista;
    if (!lista) return;
    lista.innerHTML = '';
    state.tourDestinos.forEach((d) => {
      const li = Utils.crearElemento(`
        <li class="tour-destino-item">
          <span class="tour-destino-item__info">
            <span class="tour-destino-item__nombre">${d.nombre}</span>
            <span class="tour-destino-item__meta">${d.departamento || ''}</span>
          </span>
          <span class="tour-destino-item__count">(${d.totalSitios})</span>
          <button type="button" class="tour-destino-item__btn" title="Quitar destino" aria-label="Quitar ${d.nombre}">&times;</button>
        </li>
      `);
      li.querySelector('.tour-destino-item__btn').addEventListener('click', (evt) => {
        evt.stopPropagation();
        _quitarDestinoTour(d.id);
      });
      lista.appendChild(li);
    });
  }
