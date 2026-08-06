/**
 * panel.js
 * ---------------------------------------------------------------------------
 * Navegación y panel: pestañas (escritorio/móvil), panel Ruta y eventos
 * generales de la interfaz (initEventos).
 * ---------------------------------------------------------------------------
 */

  function activarPanelTab(tab) {
    // Con el catálogo de puertos/aeropuertos (A/P) o la ruta desde archivo (K)
    // activos, la pestaña Descubre queda oculta y los cuadros de búsqueda no
    // deben reaparecer al volver a Ruta.
    if (tab === 'descubre' && (_puertosVisibles || _aeropuertosVisibles || _rutaArchivoActiva)) return;
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('panel-tab--active'));
    if (tab === 'ruta') {
      el.btnTabPanelRuta.classList.add('panel-tab--active');
      el.panelDescubreActions.hidden = true;
      el.loadingSitios.hidden = true;
      el.panelSitios.hidden = true;
      el.panelSitios.scrollTop = 0;
      el.panelLocate.hidden = _puertosVisibles || _aeropuertosVisibles || _rutaArchivoActiva;
      el.panelEscalas.hidden = true;
      if (state.rutaActual && !(_puertosVisibles || _aeropuertosVisibles || _rutaArchivoActiva)) {
        el.panelParadas.hidden = false;
      }
      const ocultarTestigo = !state.rutaActual || _soMostrarSitiosVisto || (_puertosVisibles || _aeropuertosVisibles || _rutaArchivoActiva);
      el.btnMostrarSitiosCercanos.hidden = ocultarTestigo;
      el.btnMostrarSitiosCercanos.disabled = ocultarTestigo;
      sincronizarModoRutaMovil();
      if (el.btnSubirRutaPropia) el.btnSubirRutaPropia.hidden = false;
    } else {
      el.btnTabPanelDescubre.classList.add('panel-tab--active');
      el.panelLocate.hidden = true;
      el.panelEscalas.hidden = true;
      el.panelParadas.hidden = true;
      el.panelDescubreActions.hidden = false;
      el.panelSitios.hidden = false;
      el.btnMostrarSitiosCercanos.hidden = true;
      if (el.btnSubirRutaPropia) el.btnSubirRutaPropia.hidden = true;
      if (!state.rutaActual && el.sitiosVacio) {
        el.sitiosVacio.hidden = false;
        el.sitiosVacio.textContent = 'Calcula una ruta para descubrir sitios turísticos.';
        if (el.sitiosLista) el.sitiosLista.hidden = true;
      } else {
        _asegurarListadoSitios();
      }
    }
  }

  // -------------------------------------------------------------------
  // Inicialización
  // -------------------------------------------------------------------

  function setMobileTab(tab) {
    el.appRoot.setAttribute('data-mobile-tab', tab);
    el.appRoot.setAttribute('data-mobile-panel', 'expanded');
    el.btnTabDescubre.classList.toggle('mobile-tab-btn--active', tab === 'descubre');
    el.btnTabRuta.classList.toggle('mobile-tab-btn--active', tab === 'ruta');
    if (el.btnTabAltimetria) {
      el.btnTabAltimetria.classList.toggle('mobile-tab-btn--active', tab === 'altimetria');
    }
    if (tab === 'altimetria') {
      if (el.altimetriaPanelMovil) el.altimetriaPanelMovil.hidden = false;
      if (typeof _activarSeguimientoConVuelos === 'function') _activarSeguimientoConVuelos();
      _cargarElevacionAltimetria('altimetria-chart-panel');
    } else {
      if (el.altimetriaPanelMovil) el.altimetriaPanelMovil.hidden = true;
    }
    // Sync panel hidden states with mobile tab
    if (tab === 'ruta') {
      activarPanelTab('ruta');
    } else if (tab === 'descubre') {
      activarPanelTab('descubre');
    }
    if (typeof _syncAltimetriaMapa === 'function') _syncAltimetriaMapa();
    setTimeout(() => MapModule.invalidateSize(), 220);
  }


  function toggleMobileTab(tab) {
    if (tab === 'descubre' && el.btnTabDescubre && el.btnTabDescubre.disabled) return;
    if (tab === 'descubre' && (_puertosVisibles || _aeropuertosVisibles || _rutaArchivoActiva)) return;
    const currentTab = el.appRoot.getAttribute('data-mobile-tab');
    const isCollapsed = el.appRoot.getAttribute('data-mobile-panel') === 'collapsed';
    if (currentTab === tab && !isCollapsed) {
      el.appRoot.setAttribute('data-mobile-panel', 'collapsed');
      el.btnTabDescubre.classList.remove('mobile-tab-btn--active');
      el.btnTabRuta.classList.remove('mobile-tab-btn--active');
      if (el.btnTabAltimetria) el.btnTabAltimetria.classList.remove('mobile-tab-btn--active');
      if (el.altimetriaPanelMovil) el.altimetriaPanelMovil.hidden = true;
      if (typeof _syncAltimetriaMapa === 'function') _syncAltimetriaMapa();
      setTimeout(() => MapModule.invalidateSize(), 220);
    } else {
      setMobileTab(tab);
    }
  }


  function actualizarTextoSeguimiento() {
    const activo = AltimetriaModule.isFollowActivo();
    const pcBtn = document.getElementById('btn-seguimiento-altimetria');
    const movBtn = document.getElementById('btn-seguimiento-altimetria-panel');
    if (pcBtn) {
      const label = pcBtn.querySelector('.altimetria__seguimiento-label');
      if (label) label.textContent = activo ? 'Seguimiento activado' : 'Seguimiento inactivado';
      pcBtn.setAttribute('aria-pressed', String(activo));
    }
    if (movBtn) movBtn.setAttribute('aria-pressed', String(activo));
  }


  function initEventos() {
    el.btnCalcular.addEventListener('click', () => calcularRutaPrincipal());
    if (el.btnAereo) {
      el.btnAereo.addEventListener('click', () => {
        // El avión siempre calcula la ruta aérea (volver a carretera = botón calcular).
        calcularRutaAerea();
      });
    }
    if (el.btnFluvial) {
      el.btnFluvial.addEventListener('click', () => {
        // El barco siempre calcula la ruta por río (volver a carretera = botón calcular).
        calcularRutaFluvial();
      });
    }

    function toggleSitiosHandler() {
      const visible = MapModule.toggleSitios();
      if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.setAttribute('aria-pressed', String(visible));
    }
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.addEventListener('click', toggleSitiosHandler);

    if (el.btnDescubreVisibles) {
      el.btnDescubreVisibles.addEventListener('click', toggleSitiosVisibles);
    }

    if (el.btnFullscreen) {
      el.btnFullscreen.addEventListener('click', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          el.btnFullscreen.setAttribute('aria-pressed', 'false');
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
          el.btnFullscreen.setAttribute('aria-pressed', 'true');
        }
      });
      document.addEventListener('fullscreenchange', () => {
        el.btnFullscreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
      });
    }

    el.btnTabDescubre.addEventListener('click', () => toggleMobileTab('descubre'));
    el.btnTabRuta.addEventListener('click', () => toggleMobileTab('ruta'));
    if (el.btnAgregarIntermedio) {
      // stopPropagation: el click que crea la fila no debe llegar al
      // onClickOutside de la fila y cerrar su lista recién desplegada.
      el.btnAgregarIntermedio.addEventListener('click', (e) => {
        e.stopPropagation();
        agregarPuebloIntermedioDesdeLista();
      });
    }
    // Descubre Colombia buttons handlers
    let desplegandoDescubre = null; // 'categorias' | 'desvios' | 'ordenar'
    if (el.btnDescubreCategorias) {
      el.btnDescubreCategorias.addEventListener('click', () => {
        const abrir = desplegandoDescubre !== 'categorias';
        _cerrarDesplegadosDescubre();
        if (abrir) {
          el.btnDescubreCategorias.classList.add('descubre-btn--active');
          el.descubreDropdownCategorias.hidden = false;
          desplegandoDescubre = 'categorias';
        }
      });
    }
    if (el.btnDescubreDesvios) {
      el.btnDescubreDesvios.addEventListener('click', () => {
        const abrir = desplegandoDescubre !== 'desvios';
        _cerrarDesplegadosDescubre();
        if (abrir) {
          el.btnDescubreDesvios.classList.add('descubre-btn--active');
          el.descubreDropdownDesvios.hidden = false;
          desplegandoDescubre = 'desvios';
        }
      });
    }
    if (el.btnDescubreOrdenar) {
      el.btnDescubreOrdenar.addEventListener('click', () => {
        const abrir = desplegandoDescubre !== 'ordenar';
        _cerrarDesplegadosDescubre();
        if (abrir) {
          el.btnDescubreOrdenar.classList.add('descubre-btn--active');
          el.descubreDropdownOrdenar.hidden = false;
          desplegandoDescubre = 'ordenar';
        }
      });
    }
    function _cerrarDesplegadosDescubre() {
      desplegandoDescubre = null;
      [el.btnDescubreCategorias, el.btnDescubreDesvios, el.btnDescubreOrdenar].forEach(b => { if (b) b.classList.remove('descubre-btn--active'); });
      [el.descubreDropdownCategorias, el.descubreDropdownDesvios, el.descubreDropdownOrdenar].forEach(d => { if (d) d.hidden = true; });
      _actualizarEstadoBotonesDescubre();
    }
    if (el.btnOrdenOrigen) el.btnOrdenOrigen.addEventListener('click', () => aplicarOrdenSitios('origen'));
    if (el.btnOrdenDestino) el.btnOrdenDestino.addEventListener('click', () => aplicarOrdenSitios('destino'));
    state.ordenSitios = 'origen';
    actualizarBotonesOrden();
    _actualizarEstadoBotonesDescubre();

    // Tab switching (panel tabs - desktop)
    if (el.btnTabPanelRuta) {
      el.btnTabPanelRuta.addEventListener('click', () => activarPanelTab('ruta'));
    }
    if (el.btnTabPanelDescubre) {
      el.btnTabPanelDescubre.addEventListener('click', () => activarPanelTab('descubre'));
    }

    el.loadingSitios = document.getElementById('loading-sitios');
    el.loadingRuta = document.getElementById('loading-ruta');
    el.loadingMsg = el.loadingSitios.querySelector('.loading-sitios__msg');
    el.spinnerBike = el.loadingSitios.querySelector('.spinner-bike');
    el.mensajesCarga = [
      'Cargando lugares cercanos…',
      'Buscando sitios turísticos…',
      'Calculando distancias…',
      'Preparando resultados…',
      'Casi listo…',
    ];

    // Cerrar menús de Descubre al desplazar la lista o interactuar con el mapa
    const sitiosScroll = document.querySelector('.panel-sites__scroll');
    if (sitiosScroll) {
      sitiosScroll.addEventListener('scroll', () => {
        if (desplegandoDescubre) _cerrarDesplegadosDescubre();
      }, { passive: true });
    }
    document.getElementById('map')?.addEventListener('mousedown', () => {
      if (desplegandoDescubre) _cerrarDesplegadosDescubre();
    });
    document.getElementById('map')?.addEventListener('touchstart', () => {
      if (desplegandoDescubre) _cerrarDesplegadosDescubre();
    }, { passive: true });

    // Init Ruta tab
    activarPanelTab('ruta');

    // Ruta tab: locate panel visible by default
    el.panelLocate.hidden = false;
    el.panelEscalas.hidden = true;

    // Altimetría - desktop button
    if (el.btnAltimetria) {
      el.btnAltimetria.addEventListener('click', () => toggleAltimetria());
    }
    // Altimetría - mobile tab
    if (el.btnTabAltimetria) {
      el.btnTabAltimetria.addEventListener('click', () => toggleMobileTab('altimetria'));
    }
    if (el.btnCerrarAltimetria) {
      el.btnCerrarAltimetria.addEventListener('click', () => cerrarAltimetria());
    }

    // Sort buttons in descubre dropdown
    if (el.btnOrdenOrigenDes) {
      el.btnOrdenOrigenDes.addEventListener('click', () => { aplicarOrdenSitios('origen'); actualizarBotonesOrden(); });
    }
    if (el.btnOrdenDestinoDes) {
      el.btnOrdenDestinoDes.addEventListener('click', () => { aplicarOrdenSitios('destino'); actualizarBotonesOrden(); });
    }

    el.btnMostrarSitiosCercanos.addEventListener('click', () => {
      el.btnMostrarSitiosCercanos.hidden = true;
      el.btnMostrarSitiosCercanos.disabled = true;
      _asegurarListadoSitios();
      activarPanelTab('descubre');
      if (esMovil()) setMobileTab('descubre');
    });
    el.btnAplicarDistancia.addEventListener('click', () => aplicarFiltrosConSpinner(el.btnAplicarDistancia));
    el.btnAplicarTiempo.addEventListener('click', () => aplicarFiltrosConSpinner(el.btnAplicarTiempo));

    el.checkDistancia.addEventListener('change', () => {
      el.filtroDistancia.disabled = !el.checkDistancia.checked;
      actualizarEstadoBotonesRetry();
    });
    el.checkTiempo.addEventListener('change', () => {
      el.filtroTiempo.disabled = !el.checkTiempo.checked;
      actualizarEstadoBotonesRetry();
    });
    el.filtroDistancia.addEventListener('input', () => {
      el.filtroDistanciaValor.textContent = `${el.filtroDistancia.value} km`;
      actualizarEstadoBotonesRetry();
    });
    el.filtroTiempo.addEventListener('input', () => {
      el.filtroTiempoValor.textContent = `${el.filtroTiempo.value} min`;
      actualizarEstadoBotonesRetry();
    });

    // Re-filtrar sitios visibles al mover/zoom del mapa
    const _map = MapModule.getMap();
    if (_map) {
      _map.on('moveend', () => {
        if (state.modoVisibilidad === 'visibles' && state.sitiosFiltrados.length > 0) {
          // Si hay una ficha de sitio abierta no re-renderizar: al tocar un
          // marcador el mapa se centra (moveend) y el re-render cerraría el cuadro.
          if (document.querySelector('.sitio-overlay')) return;
          renderizarSitios(_filtrarVisibles(state.sitiosFiltrados));
        }
      });

      // Marcador temporal para hover del perfil de altimetría: un carro verde
      // (o senderista en modo "Subir tu propia ruta") que se orienta paralelo a
      // la ruta en el punto que representa.
      let _hoverMarker = null;
      let _hoverCarImg = null;
      const _iconoPosicionMapa = () => (_rutaArchivoActiva ? 'public/hiking.svg' : 'public/car-verde.svg');
      AltimetriaModule.setOnHover((p) => {
        if (!_hoverMarker) {
          _hoverMarker = L.marker([p.lat, p.lon], {
            icon: L.divIcon({
              className: 'altimetria-hover-car',
              html: `<img src="${_iconoPosicionMapa()}" alt="" style="width:26px;height:26px;transform-origin:50% 50%;"/>`,
              iconSize: [26, 26],
              iconAnchor: [13, 26],
            }),
            interactive: false,
            pane: 'tooltipPane',
            zIndexOffset: 1000,
          }).addTo(_map);
          _hoverCarImg = _hoverMarker.getElement()?.querySelector('img') || null;
        } else {
          _hoverMarker.setLatLng([p.lat, p.lon]);
        }
        if (_hoverCarImg && p.bearing != null) {
          _hoverCarImg.style.transform = `rotate(${p.bearing - 90}deg)`;
        }
        _hoverMarker.bindTooltip(`${p.alt} msnm · ${p.dist} km`, {
          permanent: true, direction: 'top', className: 'altimetria-map-tooltip',
          offset: [0, -34],
        }).openTooltip();
      });

      AltimetriaModule.setOnLeave(() => {
        if (_hoverMarker) { _hoverMarker.remove(); _hoverMarker = null; }
      });

      AltimetriaModule.setOnSetInicio((data) => {
        AltimetriaModule.setRangoInicio(data.distKm);
      });
      AltimetriaModule.setOnSetFin((data) => {
        AltimetriaModule.setRangoFin(data.distKm);
      });
      AltimetriaModule.setOnEliminarParada((data) => {
        if (data.tipo === 'escala') eliminarEscala(data.id);
        else if (data.tipo === 'parada') eliminarParada(data.id);
      });
      AltimetriaModule.setOnVerMapa((data) => {
        _map.setView([data.lat, data.lon], 13, { animate: true });
      });
      AltimetriaModule.setOnCentrarMapa((data) => {
        const conVuelos = !!(state.modoAereo && state.tramosAereo && state.tramosAereo.apSegs && state.tramosAereo.apSegs.length);
        if (conVuelos) {
          // Seguimiento con zoom: en una ruta con vuelos el mapa está encuadrado
          // lejísimos y conviene acercarse a la ruta para ver el carro.
          _map.setView([data.lat, data.lon], Math.max(_map.getZoom(), 11), { animate: true });
        } else {
          _map.panTo([data.lat, data.lon], { animate: true });
        }
      });

      document.getElementById('btn-cerrar-altimetria')?.addEventListener('click', () => {
        if (_hoverMarker) { _hoverMarker.remove(); _hoverMarker = null; }
      });

      function toggleSeguimientoBtn() {
        AltimetriaModule.toggleFollow();
        actualizarTextoSeguimiento();
      }
      document.getElementById('btn-seguimiento-altimetria')?.addEventListener('click', toggleSeguimientoBtn);
      document.getElementById('btn-seguimiento-altimetria-panel')?.addEventListener('click', toggleSeguimientoBtn);
      actualizarTextoSeguimiento();
    }

  }
  // -------------------------------------------------------------------
  // Vista móvil: alternar entre panel completo y mapa completo
  // -------------------------------------------------------------------
