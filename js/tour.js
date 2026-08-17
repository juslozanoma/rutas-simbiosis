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
  let _sitiosTour = [];      // sitios acumulados de los destinos elegidos
  let _sitiosTourActivos = []; // sitios que pasan los filtros (en el mapa)

  function _toggleTour() {
    if (_tourActivo) _desactivarTour();
    else _activarTour();
  }

  function _activarTour() {
    _tourActivo = true;
    if (el.appRoot) el.appRoot.setAttribute('data-tour-activo', 'true');
    state.tourDestinos = [];
    _sitiosTour = [];
    _sitiosTourActivos = [];
    state.categoriasSeleccionadas = [];
    _tourOrdenActivo = 'distancia';
    _tourOrdenDirNombre = 'asc';
    _tourOrdenDirDistancia = 'asc';
    const filaDist = document.getElementById('filtro-distancia-tour-row');
    if (filaDist) filaDist.hidden = true;
    _limpiarSitiosTour();
    _crearComboTour();
    _crearCerrarTour();
    _configurarFiltroDistanciaTour();
    _actualizarBotonesOrdenTour();
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
    _sitiosTourActivos = [];
    _limpiarSitiosTour();
    _quitarCerrarTour();
    if (_comboTour && typeof _comboTour.limpiarTexto === 'function') _comboTour.limpiarTexto();
    if (el.tourInput) el.tourInput.placeholder = 'Seleccionar un destino';
    if (el.panelTour) el.panelTour.hidden = true;
    if (el.panelLocate) el.panelLocate.hidden = _puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles || _fronteraVisibles || _rutaArchivoActiva;
    if (el.btnIniciarTour) el.btnIniciarTour.setAttribute('aria-pressed', 'false');
    if (el.tourDestinosLista) el.tourDestinosLista.innerHTML = '';
    const filaDist = document.getElementById('filtro-distancia-tour-row');
    if (filaDist) filaDist.hidden = true;
    if (el.filtroDistancia) { el.filtroDistancia.disabled = !(el.checkDistancia && el.checkDistancia.checked); el.filtroDistancia.max = '60'; }
    _restaurarEtiquetasTour();
    if (typeof _actualizarTextoBotonesOrden === 'function') _actualizarTextoBotonesOrden();
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
    if (el.btnDescubreDesvios) el.btnDescubreDesvios.textContent = 'Distancia';
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
    if (el.btnDescubreDesvios) el.btnDescubreDesvios.textContent = 'Filtrar';
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
        sitios, // caché de los sitios a 30 km de este destino
      });
    }
    // Acumular los sitios únicos de todos los destinos.
    const mapa = new Map();
    _sitiosTour.forEach((s) => mapa.set(String(s.id), s));
    sitios.forEach((s) => mapa.set(String(s.id), s));
    _sitiosTour = [...mapa.values()];
    _mostrarSitiosTour();
    // Tras elegir el primer destino se muestra la barra de distancia bajo el
    // cuadro "Añadir otro destino".
    const filaDist = document.getElementById('filtro-distancia-tour-row');
    if (filaDist && state.tourDestinos.length >= 1) filaDist.hidden = false;
    // Encuadrar el mapa para que se vean todos los sitios del destino (y no
    // solo el centro del pueblo). Sin sitios, se muestra la zona a zoom 10.
    if (typeof MapModule !== 'undefined') {
      const coords = sitios
        .filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)))
        .map((s) => [Number(s.lat), Number(s.lon)]);
      if (coords.length && typeof MapModule.encuadrar === 'function') {
        coords.push([Number(m.lat), Number(m.lon)]);
        MapModule.encuadrar(coords, [40, 40]);
      } else if (typeof MapModule.centrarEn === 'function') {
        MapModule.centrarEn(Number(m.lat), Number(m.lon), 10);
      }
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
    // Si ya no queda ningún destino se oculta la barra de distancia del tour.
    const filaDist = document.getElementById('filtro-distancia-tour-row');
    if (filaDist) filaDist.hidden = state.tourDestinos.length < 1;
    _mostrarSitiosTour();
  }

  function _mostrarSitiosTour() {
    state.sitiosFiltradosBase = _sitiosTour;
    const filtrados = _sitiosTourFiltrados();
    _sitiosTourActivos = filtrados;
    state.sitiosFiltrados = filtrados;
    state.modoVisibilidad = 'completa';
    if (typeof renderizarSitios === 'function') renderizarSitios(filtrados);
    // Categorías disponibles de los sitios del tour.
    if (typeof renderizarCategoriasMenu === 'function') {
      const cats = new Map();
      _sitiosTour.forEach((s) => {
        if (!s.categoria) return;
        const c = s.categoria.trim();
        cats.set(c, (cats.get(c) || 0) + 1);
      });
      renderizarCategoriasMenu([...cats.entries()]);
    }
    // La pestaña Descubre queda disponible.
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    // Refrescar la lista de destinos con los conteos activos según el filtro.
    _renderTourDestinos();
  }

  /** Sitios del tour aplicando las categorías elegidas y el tope de distancia
   *  del filtro (distancia al destino elegido más cercano). */
  function _sitiosTourFiltrados() {
    const cap = el.filtroDistancia && !el.filtroDistancia.disabled ? Number(el.filtroDistancia.value) : 30;
    const catsNorm = state.categoriasSeleccionadas.length
      ? new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim()))
      : null;
    return _sitiosTour.filter((s) => {
      if (catsNorm && !catsNorm.has((s.categoria || '').toLowerCase().trim())) return false;
      if (_distanciaAlDestinoMasCercano(s) > cap) return false;
      return true;
    });
  }

  /** Distancia en km del sitio al destino del tour más cercano. */
  function _distanciaAlDestinoMasCercano(sitio) {
    if (!state.tourDestinos || !state.tourDestinos.length) return Infinity;
    if (sitio.lat == null || sitio.lon == null) return Infinity;
    let min = Infinity;
    state.tourDestinos.forEach((d) => {
      if (d.lat == null || d.lon == null) return;
      const dist = turf.distance(
        turf.point([Number(sitio.lon), Number(sitio.lat)]),
        turf.point([Number(d.lon), Number(d.lat)]),
        { units: 'kilometers' }
      );
      if (dist < min) min = dist;
    });
    return min;
  }

  // Orden de los sitios del tour: dos toggles INDEPENDIENTES. El de "Orden"
  // ordena por nombre (ascendente/descendente) y el de "Distancia" por la
  // distancia al destino más cercano (menor/mayor). El último tocado define el
  // orden activo.
  let _tourOrdenActivo = 'distancia';   // 'nombre' | 'distancia'
  let _tourOrdenDirNombre = 'asc';
  let _tourOrdenDirDistancia = 'asc';

  function _aplicarOrdenTour() {
    if (!_tourActivo) return;
    if (_tourOrdenActivo === 'nombre') {
      const dir = _tourOrdenDirNombre === 'desc' ? -1 : 1;
      _sitiosTour.sort((a, b) => dir * String(a.nombre).localeCompare(String(b.nombre), 'es'));
    } else {
      const dir = _tourOrdenDirDistancia === 'desc' ? -1 : 1;
      _sitiosTour.sort((a, b) => dir * (_distanciaAlDestinoMasCercano(a) - _distanciaAlDestinoMasCercano(b)));
    }
    _actualizarBotonesOrdenTour();
    _mostrarSitiosTour();
  }

  function _actualizarBotonesOrdenTour() {
    const dirBtn = document.getElementById('btn-orden-dir');
    const distBtn = document.getElementById('btn-orden-dist');
    if (dirBtn) dirBtn.textContent = _tourOrdenDirNombre === 'desc' ? 'Orden descendente Z-A' : 'Orden ascendente A-Z';
    if (distBtn) distBtn.textContent = _tourOrdenDirDistancia === 'desc' ? 'Mayor distancia' : 'Menor distancia';
  }

  /** Pone el valor en km en letra pequeña sobre el pulgar del deslizador. */
  function _actualizarThumbKm(slider, span) {
    if (!slider || !span) return;
    const min = Number(slider.min) || 1;
    const max = Number(slider.max) || 30;
    const val = Number(slider.value);
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    span.textContent = `${val} km`;
    span.style.left = `${pct}%`;
  }

  /** Sincroniza ambas barras de distancia (la del desplegable y la de la
   *  pestaña del tour) y vuelve a filtrar los sitios. */
  function _sincronizarFiltroDistancia(valor, sliderOrigen) {
    const val = Math.max(1, Math.min(30, Number(valor) || 30));
    const descubre = el.filtroDistancia;
    const tourSlider = document.getElementById('filtro-distancia-tour');
    if (descubre && descubre.id !== sliderOrigen) descubre.value = String(val);
    if (tourSlider && tourSlider.id !== sliderOrigen) tourSlider.value = String(val);
    _actualizarThumbKm(descubre, document.getElementById('filtro-distancia-thumb'));
    _actualizarThumbKm(tourSlider, document.getElementById('filtro-distancia-tour-thumb'));
    _mostrarSitiosTour();
  }

  /** En el tour el filtro de distancia queda activo por defecto (sin check) y
   *  sus barras filtran la lista en vivo. */
  function _configurarFiltroDistanciaTour() {
    const tourSlider = document.getElementById('filtro-distancia-tour');
    if (tourSlider) { tourSlider.max = '30'; tourSlider.value = '30'; tourSlider.disabled = false; }
    if (el.filtroDistancia) { el.filtroDistancia.max = '30'; el.filtroDistancia.value = '30'; el.filtroDistancia.disabled = false; }
    _actualizarThumbKm(el.filtroDistancia, document.getElementById('filtro-distancia-thumb'));
    _actualizarThumbKm(tourSlider, document.getElementById('filtro-distancia-tour-thumb'));
  }

  function _limpiarSitiosTour() {
    if (typeof MapModule !== 'undefined' && typeof MapModule.limpiarSitios === 'function') MapModule.limpiarSitios();
    if (typeof _borrarListadoDescubre === 'function') _borrarListadoDescubre();
  }

  function _renderTourDestinos() {
    const lista = el.tourDestinosLista;
    if (!lista) return;
    // Sitios activos en el mapa en este momento (según el filtro de distancia
    // y las categorías elegidas).
    const activos = new Set(
      (_sitiosTourActivos && _sitiosTourActivos.length ? _sitiosTourActivos : _sitiosTourFiltrados())
        .map((s) => String(s.id))
    );
    lista.innerHTML = '';
    state.tourDestinos.forEach((d) => {
      const sitios = d.sitios || _sitiosDePueblo(d);
      const n = sitios.filter((s) => activos.has(String(s.id))).length;
      const li = Utils.crearElemento(`
        <li class="tour-destino-item">
          <span class="tour-destino-item__info">
            <span class="tour-destino-item__nombre">${d.nombre}</span>
            <span class="tour-destino-item__meta">${d.departamento || ''}</span>
          </span>
          <span class="tour-destino-item__count">(${n})</span>
          <button type="button" class="tour-destino-item__btn" title="Quitar destino" aria-label="Quitar ${d.nombre}">&times;</button>
        </li>
      `);
      // Clic en el destino: centra el mapa en su sector con sus sitios.
      li.addEventListener('click', (evt) => {
        if (evt.target.closest('.tour-destino-item__btn')) return;
        lista.querySelectorAll('.tour-destino-item--activo').forEach((el) => el.classList.remove('tour-destino-item--activo'));
        li.classList.add('tour-destino-item--activo');
        _centrarDestinoTour(d);
      });
      li.querySelector('.tour-destino-item__btn').addEventListener('click', (evt) => {
        evt.stopPropagation();
        _quitarDestinoTour(d.id);
      });
      lista.appendChild(li);
    });
  }

  /** Centra el mapa en el sector de un destino del tour (sus sitios a 30 km). */
  function _centrarDestinoTour(d) {
    if (!d || d.lat == null || d.lon == null) return;
    if (typeof MapModule === 'undefined') return;
    const sitios = d.sitios || _sitiosDePueblo(d);
    const coords = sitios
      .filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)))
      .map((s) => [Number(s.lat), Number(s.lon)]);
    if (coords.length && typeof MapModule.encuadrar === 'function') {
      coords.push([Number(d.lat), Number(d.lon)]);
      MapModule.encuadrar(coords, [40, 40]);
    } else if (typeof MapModule.centrarEn === 'function') {
      MapModule.centrarEn(Number(d.lat), Number(d.lon), 10);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const dirBtn = document.getElementById('btn-orden-dir');
    const distBtn = document.getElementById('btn-orden-dist');
    if (dirBtn) {
      dirBtn.addEventListener('click', () => {
        if (!_tourActivo) return;
        _tourOrdenDirNombre = _tourOrdenDirNombre === 'asc' ? 'desc' : 'asc';
        _tourOrdenActivo = 'nombre';
        _aplicarOrdenTour();
      });
    }
    if (distBtn) {
      distBtn.addEventListener('click', () => {
        if (!_tourActivo) return;
        _tourOrdenDirDistancia = _tourOrdenDirDistancia === 'asc' ? 'desc' : 'asc';
        _tourOrdenActivo = 'distancia';
        _aplicarOrdenTour();
      });
    }
    // En el tour las barras de distancia filtran la lista en vivo y se
    // mantienen sincronizadas (desplegable y pestaña del tour).
    const tourSlider = document.getElementById('filtro-distancia-tour');
    if (tourSlider) {
      tourSlider.addEventListener('input', () => {
        if (!_tourActivo) return;
        _sincronizarFiltroDistancia(tourSlider.value, tourSlider.id);
      });
    }
    if (el.filtroDistancia) {
      el.filtroDistancia.addEventListener('input', () => {
        if (!_tourActivo) return;
        _sincronizarFiltroDistancia(el.filtroDistancia.value, el.filtroDistancia.id);
      });
    }
  });
