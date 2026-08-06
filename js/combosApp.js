/**
 * combosApp.js
 * ---------------------------------------------------------------------------
 * Creación de los cuadros de búsqueda de origen y destino con el módulo único
 * MunicipioCombo, más la limpieza del estado al cambiar los extremos.
 * ---------------------------------------------------------------------------
 */

  let _comboOrigen = null;
  let _comboDestino = null;

  /** Borra el texto y la selección de los cuadros de origen y destino. */
  function _limpiarCombos() {
    if (_comboOrigen && typeof _comboOrigen.limpiarTexto === 'function') _comboOrigen.limpiarTexto();
    if (_comboDestino && typeof _comboDestino.limpiarTexto === 'function') _comboDestino.limpiarTexto();
  }

  function initCombos() {
    _comboOrigen = MunicipioCombo.crear({
      contenedor: document.querySelector('.combo[data-combo="origen"]'),
      placeholder: 'Origen',
      lineas: 6, // el menú de origen muestra 6 opciones visibles (el resto con scroll)
      mostrarUbicacionActual: true,
      excluirIds: () => {
        const ids = new Set();
        if (state.destino?.id) ids.add(state.destino.id);
        state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
        return ids;
      },
      onSelect: (m) => {
        state.origen = m;
        _limpiarTurfYListado();
        actualizarEstadoBotonCalcular();
        _actualizarTextoBotonesOrden();
        // Fin del modo "solo cuadro de origen": se restaura el panel completo.
        _modoCambiarOrigen(false);
        // Al cambiar el origen de una ruta ya calculada: se ocultan los cuadros y
        // los botones al instante y se recalcula la ruta (OSRM) automáticamente.
        if (_cambioExtremoEnCurso) {
          _cambioExtremoEnCurso = null;
          if (el.origenInput) el.origenInput.placeholder = 'Origen';
          sincronizarModoRutaMovil();
          calcularRutaPrincipal();
        }
      },
      onEnter: () => {
        if (state.destino && state.destino.id) calcularRutaPrincipal(false);
      },
      onUbicacionActual: () => {
        ponerEnCargaRuta(true);
        cerrarAltimetria();
        AltimetriaModule.limpiar();
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude: lat, longitude: lon } = pos.coords;
            _comboOrigen.aplicar({ id: 'gps_' + Date.now(), lat, lon, nombre: 'Mi ubicación', departamento: '' });
            ponerEnCargaRuta(false);
          },
          () => {
            ponerEnCargaRuta(false);
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      },
    });

    _comboDestino = MunicipioCombo.crear({
      contenedor: document.querySelector('.combo[data-combo="destino"]'),
      placeholder: 'Destino',
      lineas: 5,
      excluirIds: () => {
        // El destino puede repetir cualquier punto anterior salvo el inmediatamente
        // anterior (último pueblo confirmado, o el origen si no hay pueblos).
        const ids = new Set();
        const confirmadas = state.escalas.filter((e) => e.lat != null);
        const ultimo = confirmadas[confirmadas.length - 1];
        if (ultimo && ultimo.id != null) ids.add(ultimo.id);
        else if (state.origen?.id) ids.add(state.origen.id);
        return ids;
      },
      onSelect: (m) => {
        state.destino = m;
        _limpiarTurfYListado();
        actualizarEstadoBotonCalcular();
        _actualizarTextoBotonesOrden();
        // Al cambiar el destino de una ruta ya calculada: se ocultan los cuadros y
        // los botones al instante y se recalcula la ruta (OSRM) automáticamente.
        if (_cambioExtremoEnCurso) {
          _cambioExtremoEnCurso = null;
          // Se restaura el panel completo (origen, avión y botón de calcular).
          _modoCambiarDestino(false);
          if (el.destinoInput) el.destinoInput.placeholder = 'Destino';
          sincronizarModoRutaMovil();
          calcularRutaPrincipal();
        }
      },
      onEnter: () => {
        if (state.origen && state.origen.id) calcularRutaPrincipal(false);
      },
    });
  }

  /** Al cambiar la ciudad de origen o destino se borran el perfil (turf), los sitios
   *  del mapa y el listado de Descubre. */

  function _limpiarTurfYListado() {
    state.elevacion = null;
    state.altimetriaGeo = null;
    state.altimetriaTotalKm = 0;
    state.sitiosFiltrados = [];
    state.sitiosFiltradosBase = [];
    state.modoVisibilidad = 'completa';
    conteoCategoriasBase = new Map();
    _sincronizarBotonVisibles();
    _calculandoListado = 0;
    _listadoParaGeojson = null;
    MapModule.limpiarSitios();
    TourismModule.ocultarPopupSitio();
    if (el.sitiosLista) el.sitiosLista.innerHTML = '';
    if (el.sitiosLista) el.sitiosLista.hidden = true;
    if (el.sitiosVacio) el.sitiosVacio.hidden = true;
    if (el.sitiosContador) el.sitiosContador.textContent = '0';
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = '0';
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = '0';
    renderizarCategoriasMenu([]);
    _syncBotonSitios();
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.hidden = true;
    // De vuelta al modo de configuración: se restaura el "+" de agregar escala.
    if (el.btnAgregarEscala) el.btnAgregarEscala.hidden = false;
  }



  function iniciarSeleccionMapa(callback) {
    const map = MapModule.getMap();
    const container = map.getContainer();
    container.style.cursor = 'crosshair';
    const tooltip = L.tooltip({ permanent: true, direction: 'center', className: 'route-tooltip' })
      .setLatLng(map.getCenter())
      .setContent('Haz clic en el mapa para seleccionar')
      .addTo(map);
    function onClick(e) {
      map.off('click', onClick);
      container.style.cursor = '';
      map.removeLayer(tooltip);
      callback(e.latlng.lat, e.latlng.lng);
    }
    map.on('click', onClick);
  }

  // -------------------------------------------------------------------
  // Escalas: municipios intermedios entre origen y destino
  // -------------------------------------------------------------------
