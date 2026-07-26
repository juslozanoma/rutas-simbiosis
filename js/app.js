/**
 * app.js
 * ---------------------------------------------------------------------------
 * Punto de entrada de la aplicación. Coordina MapModule, RoutingModule,
 * TourismModule y FiltersModule, y controla el panel lateral fijo:
 *
 *   1. Resumen (distancia total / tiempo estimado) — se llena tras calcular.
 *   2. Origen + destino + botón "Calcular ruta" — el cálculo NUNCA ocurre
 *      antes de pulsar ese botón explícitamente.
 *   3. Dos filtros independientes (distancia y tiempo de desvío), cada uno
 *      con su checkbox de activación y su propio botón "Aplicar". Los
 *      sitios turísticos no se muestran hasta que se aplica un filtro.
 *   4. Lista de sitios resultantes (ordenada por cercanía al origen), con
 *      scroll propio. Cada tarjeta permite:
 *        - clic en la tarjeta: previsualizar en el mapa, en azul continuo,
 *          la ruta desde el punto de la vía principal donde se produce el
 *          desvío hasta ese sitio (sin alterar la ruta principal).
 *        - clic en el botón "+": agregar el sitio como parada de la ruta
 *          principal, que se recalcula pasando por todas las paradas
 *          agregadas en orden; la lista de candidatos se refresca contra
 *          esa nueva ruta.
 *
 * No se usan mensajes flotantes de carga: la única señal de "procesando"
 * es un pequeño spinner dentro del propio botón o tarjeta que se pulsó.
 * ---------------------------------------------------------------------------
 */
(() => {

  const PERFIL_FIJO = 'driving';
  const MEDIA_MOVIL = '(max-width: 860px)';
  const CAPITALES = {
    'Amazonas':'Leticia','Antioquia':'Medellín','Arauca':'Arauca','Atlántico':'Barranquilla',
    'Bogotá D.C.':'Bogotá D.C.','Bolívar':'Cartagena de Indias','Boyacá':'Tunja','Caldas':'Manizales',
    'Caquetá':'Florencia','Casanare':'Yopal','Cauca':'Popayán','Cesar':'Valledupar',
    'Chocó':'Quibdó','Córdoba':'Montería','Cundinamarca':'Bogotá D.C.','Guainía':'Puerto Inírida',
    'Guaviare':'San José del Guaviare','Huila':'Neiva','La Guajira':'Riohacha','Magdalena':'Santa Marta',
    'Meta':'Villavicencio','Nariño':'Pasto','Norte de Santander':'Cúcuta','Putumayo':'Mocoa',
    'Quindío':'Armenia','Risaralda':'Pereira','San Andrés y Providencia':'San Andrés',
    'Santander':'Bucaramanga','Sucre':'Sincelejo','Tolima':'Ibagué','Valle del Cauca':'Cali',
    'Vaupés':'Mitú','Vichada':'Puerto Carreño',
  };

  /** Estado centralizado de la aplicación. */
  const state = {
    municipios: [],
    sitios: [],
    origen: null,
    destino: null,
    escalas: [],          // municipios intermedios (recalculan ruta + turf)
    rutaBase: null,
    rutaActual: null,
    paradas: [],
    sitiosFiltrados: [],
    previewSitioId: null,
    categoriasSeleccionadas: [],
    categoriasUnicas: [],
  };

  // -------------------------------------------------------------------
  // Referencias DOM
  // -------------------------------------------------------------------
  const el = {
    appRoot: document.getElementById('app'),
    btnMobileCollapse: document.getElementById('btn-mobile-collapse'),
    btnMobileExpand: document.getElementById('btn-mobile-expand'),

    statDistancia: document.getElementById('stat-distancia'),
    statTiempo: document.getElementById('stat-tiempo'),

    origenInput: document.getElementById('origen-input'),
    destinoInput: document.getElementById('destino-input'),
    origenList: document.getElementById('origen-list'),
    destinoList: document.getElementById('destino-list'),
    btnCalcular: document.getElementById('btn-calcular'),

    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    filtroDistanciaValor: document.getElementById('filtro-distancia-valor'),
    sitiosVacio: document.getElementById('sitios-vacio'),
    sitiosLista: document.getElementById('sitios-lista'),
    sitiosContador: document.getElementById('sitios-contador'),

    panelParadas: document.getElementById('panel-paradas'),
    paradasLista: document.getElementById('paradas-lista'),
    paradasContador: document.getElementById('paradas-contador'),

    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    filtroDistanciaValor: document.getElementById('filtro-distancia-valor'),
    btnAplicarDistancia: document.getElementById('btn-aplicar-distancia'),

    checkTiempo: document.getElementById('check-tiempo'),
    filtroTiempo: document.getElementById('filtro-tiempo'),
    filtroTiempoValor: document.getElementById('filtro-tiempo-valor'),
    btnAplicarTiempo: document.getElementById('btn-aplicar-tiempo'),

    btnCategorias: document.getElementById('btn-categorias'),
    panelCategorias: document.getElementById('panel-categorias'),
    categoriasGrid: document.getElementById('categorias-grid'),


    panelEscalas: document.getElementById('panel-escalas'),
    btnAgregarEscala: document.getElementById('btn-agregar-escala'),

    btnToggleSitios: document.getElementById('btn-toggle-sitios'),
    panelSitios: document.getElementById('panel-sites'),
    btnMostrarSitiosCercanos: document.getElementById('btn-mostrar-sitios'),
  };

  // -------------------------------------------------------------------
  // Inicialización
  // -------------------------------------------------------------------
  async function init() {
    MapModule.init('map');
    MapModule.setOnEliminarParada(eliminarParada);
    TourismModule.setOnAgregarParada((sitio, btn) => agregarParada(sitio, btn));

    try {
      const [municipios, sitios] = await Promise.all([
        TourismModule.cargarMunicipios(),
        TourismModule.cargarSitios(),
      ]);
      state.municipios = municipios;
      state.sitios = sitios;
    } catch (err) {
      el.sitiosVacio.textContent = 'Error cargando los datos base: ' + err.message;
      return;
    }

    initCombos();
    state.categoriasUnicas = obtenerCategoriasUnicas();
    renderizarCategoriasMenu();
    initEscalas();
    initEventos();
  }

  // -------------------------------------------------------------------
  // Combos de búsqueda (origen / destino)
  // -------------------------------------------------------------------
  function initCombos() {
    setupCombo(el.origenInput, el.origenList, (m) => { state.origen = m; actualizarEstadoBotonCalcular(); }, () => {
      const ids = new Set();
      if (state.destino?.id) ids.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, true);
    setupCombo(el.destinoInput, el.destinoList, (m) => { state.destino = m; actualizarEstadoBotonCalcular(); }, () => {
      const ids = new Set();
      if (state.origen?.id) ids.add(state.origen.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, false);
  }

  function setupCombo(trigger, listEl, onSelect, excluirIdsFn, showCurrentLocation) {
    const combo = trigger.parentElement;
    let deptoSeleccionado = null;

    function obtenerDepartamentos() {
      return [...new Set(state.municipios.map((m) => m.departamento))].sort();
    }

    function obtenerMunicipios(depto) {
      const capitalNombre = CAPITALES[depto];
      const lista = state.municipios
        .filter((m) => m.departamento === depto)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      if (capitalNombre) {
        const capitalIdx = lista.findIndex((m) => m.nombre === capitalNombre);
        if (capitalIdx > 0) {
          const capital = lista.splice(capitalIdx, 1)[0];
          lista.unshift(capital);
        }
      }
      return lista;
    }

    function renderDepartamentos() {
      deptoSeleccionado = null;
      listEl.innerHTML = '';

      if (showCurrentLocation) {
        const locLi = document.createElement('li');
        locLi.textContent = 'Ubicación actual';
        locLi.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          ponerEnCargaRuta(true);
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude: lat, longitude: lon } = pos.coords;
              const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
              const txt = trigger.querySelector('.combo__trigger-text');
              txt.textContent = nombre;
              txt.removeAttribute('data-placeholder');
              trigger.setAttribute('aria-label', 'Ubicación actual');
              onSelect({ id: 'gps_' + Date.now(), lat, lon, nombre, departamento: '' });
              ponerEnCargaRuta(false);
            },
            () => {
              ponerEnCargaRuta(false);
            }
          );
        });
        listEl.appendChild(locLi);
      }

      const pickLi = document.createElement('li');
      pickLi.textContent = 'Seleccionar en el mapa';
      pickLi.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.hidden = true;
        iniciarSeleccionMapa((lat, lon) => {
          const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          const txt = trigger.querySelector('.combo__trigger-text');
          txt.textContent = nombre;
          txt.removeAttribute('data-placeholder');
          trigger.setAttribute('aria-label', 'Punto en el mapa');
          onSelect({ id: 'map_' + Date.now(), lat, lon, nombre, departamento: '' });
        });
      });
      listEl.appendChild(pickLi);
      const deptos = obtenerDepartamentos();
      deptos.forEach((d) => {
        const li = document.createElement('li');
        li.textContent = d;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          deptoSeleccionado = d;
          renderMunicipios();
        });
        listEl.appendChild(li);
      });
      listEl.hidden = false;
    }

    function renderMunicipios() {
      listEl.innerHTML = '';
      const back = document.createElement('li');
      back.className = 'combo__back';
      back.textContent = '← Volver';
      back.addEventListener('click', (e) => {
        e.stopPropagation();
        renderDepartamentos();
      });
      listEl.appendChild(back);

      const idsExcluidos = excluirIdsFn ? excluirIdsFn() : new Set();
      const municipios = obtenerMunicipios(deptoSeleccionado).filter((m) => !idsExcluidos.has(m.id));
      municipios.forEach((m) => {
        const li = document.createElement('li');
        li.textContent = m.nombre;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          const txt = trigger.querySelector('.combo__trigger-text');
          txt.textContent = m.nombre;
          txt.removeAttribute('data-placeholder');
          trigger.setAttribute('aria-label', m.nombre + ' — municipio de ' + m.departamento);
          onSelect(m);
        });
        listEl.appendChild(li);
      });
      listEl.hidden = false;
    }

    function cerrar() {
      listEl.hidden = true;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (listEl.hidden) {
        renderDepartamentos();
      } else {
        cerrar();
      }
    });

    document.addEventListener('click', (e) => {
      if (!combo.contains(e.target)) cerrar();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrar();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (listEl.hidden) renderDepartamentos();
        else cerrar();
      }
    });
  }

  function actualizarEstadoBotonCalcular() {
    el.btnCalcular.disabled = !(state.origen && state.destino);
  }

  /** Activa modo de selección en el mapa: el usuario hace clic y se llama a `callback(lat, lon)`. */
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
  function initEscalas() {
    el.btnAgregarEscala.addEventListener('click', () => agregarEscala());
  }

  function agregarEscala() {
    const row = document.createElement('div');
    row.className = 'escala-row';

    const combo = document.createElement('div');
    combo.className = 'combo';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'combo__trigger escala-trigger';
    trigger.innerHTML = '<span class="combo__trigger-text" data-placeholder="true">Pueblo intermedio</span>'
      + '<svg class="combo__chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
    const listEl = document.createElement('ul');
    listEl.className = 'combo__list';
    listEl.role = 'listbox';
    listEl.hidden = true;
    combo.appendChild(trigger);
    combo.appendChild(listEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'escala-row__remove';
    removeBtn.title = 'Quitar';
    removeBtn.textContent = '×';

    row.appendChild(combo);
    row.appendChild(removeBtn);
    el.panelEscalas.appendChild(row);

    let seleccion = null;

    function renderDeptos() {
      seleccion = null;
      listEl.innerHTML = '';
      const pickLi = document.createElement('li');
      pickLi.textContent = 'Seleccionar en el mapa';
      pickLi.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.hidden = true;
        iniciarSeleccionMapa((lat, lon) => {
          const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          trigger.querySelector('.combo__trigger-text').textContent = nombre;
          trigger.querySelector('.combo__trigger-text').removeAttribute('data-placeholder');
          seleccion = { id: 'map_' + Date.now(), lat, lon, nombre, departamento: '' };
          actualizarEscalas();
        });
      });
      listEl.appendChild(pickLi);
      const deptos = [...new Set(state.municipios.map((m) => m.departamento))].sort();
      deptos.forEach((d) => {
        const li = document.createElement('li');
        li.textContent = d;
        li.addEventListener('click', (e) => { e.stopPropagation(); renderMunicipios(d); });
        listEl.appendChild(li);
      });
      listEl.hidden = false;
    }
    function renderMunicipios(depto) {
      listEl.innerHTML = '';
      const back = document.createElement('li');
      back.className = 'combo__back';
      back.textContent = '← Volver';
      back.addEventListener('click', (e) => { e.stopPropagation(); renderDeptos(); });
      listEl.appendChild(back);
      const idsNoDisponibles = new Set();
      if (state.origen?.id) idsNoDisponibles.add(state.origen.id);
      if (state.destino?.id) idsNoDisponibles.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null && e._row !== row) idsNoDisponibles.add(e.id); });
      const muns = state.municipios.filter((m) => m.departamento === depto && !idsNoDisponibles.has(m.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
      const capNombre = CAPITALES[depto];
      const capIdx = capNombre ? muns.findIndex((m) => m.nombre === capNombre) : -1;
      if (capIdx > 0) { const cap = muns.splice(capIdx, 1)[0]; muns.unshift(cap); }
      muns.forEach((m) => {
        const li = document.createElement('li');
        li.textContent = m.nombre;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          trigger.querySelector('.combo__trigger-text').textContent = m.nombre;
          trigger.querySelector('.combo__trigger-text').removeAttribute('data-placeholder');
          seleccion = m;
          actualizarEscalas();
        });
        listEl.appendChild(li);
      });
      listEl.hidden = false;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (listEl.hidden) renderDeptos(); else listEl.hidden = true;
    });
    document.addEventListener('click', function onClickOutside(e) {
      if (!row.contains(e.target)) listEl.hidden = true;
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') listEl.hidden = true;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (listEl.hidden) renderDeptos(); else listEl.hidden = true; }
    });

    removeBtn.addEventListener('click', () => {
      const idx = state.escalas.findIndex((e) => e._row === row);
      if (idx !== -1) {
        const e = state.escalas[idx];
        state.escalas.splice(idx, 1);
        if (state.rutaActual) {
          state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; });
          calcularRutaPrincipal(true);
        }
      }
      row.remove();
      actualizarEstadoBotonCalcular();
    });

    state.escalas.push({ _row: row });
  }

  function actualizarEscalas() {
    state.escalas.forEach((e) => {
      if (!e._row) return;
      const txt = e._row.querySelector('.combo__trigger-text');
      if (!txt || txt.hasAttribute('data-placeholder')) return;
      const nombre = txt.textContent;
      const m = state.municipios.find((mun) => mun.nombre === nombre);
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
    if (state.origen && state.destino && state.escalas.some((e) => e._row && e.id != null)) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; });
      calcularRutaPrincipal(true);
    }
  }

  // -------------------------------------------------------------------
  // Categorías: extracción, menú flotante y filtrado
  // -------------------------------------------------------------------
  function obtenerCategoriasUnicas() {
    const mapa = new Map();
    state.sitios.forEach((s) => {
      const c = s.categoria ? s.categoria.trim() : '';
      if (!c) return;
      const key = c.toLowerCase();
      if (!mapa.has(key)) mapa.set(key, c);
    });
    return [...mapa.values()].sort((a, b) => a.localeCompare(b, 'es'));
  }

  function categoriasDeRuta() {
    const cats = new Set();
    state.sitios.forEach((s) => {
      if (s.categoria && s.distanciaRutaKm != null && isFinite(s.distanciaRutaKm)) {
        cats.add(s.categoria.trim());
      }
    });
    if (cats.size === 0) return state.categoriasUnicas;
    return [...cats].sort((a, b) => a.localeCompare(b, 'es'));
  }

  function renderizarCategoriasMenu(lista) {
    const cats = lista || categoriasDeRuta();
    el.categoriasGrid.innerHTML = '';
    const seleccionadas = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase()));
    cats.forEach((cat) => {
      const chip = document.createElement('span');
      chip.className = 'categoria-chip';
      if (seleccionadas.has(cat.toLowerCase())) chip.classList.add('categoria-chip--selected');
      chip.textContent = cat;
      chip.addEventListener('click', () => toggleCategoria(cat));
      el.categoriasGrid.appendChild(chip);
    });
  }

  function toggleCategoria(cat) {
    const idx = state.categoriasSeleccionadas.findIndex((c) => c.toLowerCase() === cat.toLowerCase());
    if (idx !== -1) {
      state.categoriasSeleccionadas.splice(idx, 1);
    } else {
      state.categoriasSeleccionadas.push(cat);
    }
    renderizarCategoriasMenu();
    if (state.rutaActual) {
      ejecutarFiltrado();
    }
  }

  // -------------------------------------------------------------------
  // Eventos generales
  // -------------------------------------------------------------------
  function initEventos() {
    el.btnCalcular.addEventListener('click', calcularRutaPrincipal);

    el.btnMobileCollapse.addEventListener('click', () => setVistaMovil('map'));
    el.btnMobileExpand.addEventListener('click', () => setVistaMovil('panel'));

    el.btnToggleSitios.addEventListener('click', () => {
      const visible = MapModule.toggleSitios();
      el.btnToggleSitios.setAttribute('aria-pressed', String(visible));
    });
    el.btnCategorias.addEventListener('click', () => {
      const visible = !el.panelCategorias.hidden;
      el.panelCategorias.hidden = visible;
      el.btnCategorias.setAttribute('aria-pressed', String(!visible));
    });
    el.loadingSitios = document.getElementById('loading-sitios');
    el.progressFill = el.loadingSitios.querySelector('.progress-bar__fill');
    el.loadingMsg = el.loadingSitios.querySelector('.loading-sitios__msg');
    el.mensajesCarga = [
      'Cargando lugares cercanos…',
      'Buscando sitios turísticos…',
      'Calculando distancias…',
      'Preparando resultados…',
      'Casi listo…',
    ];
    el.btnMostrarSitiosCercanos.addEventListener('click', () => {
      el.btnMostrarSitiosCercanos.remove();
      el.checkDistancia.checked = true;
      el.filtroDistancia.disabled = false;
      el.filtroDistancia.value = '5';
      el.filtroDistanciaValor.textContent = '5 km';
      el.loadingSitios.hidden = false;
      el.progressFill.classList.add('progress-bar__fill--active');
      ejecutarFiltradoProgresivo(() => {
        el.panelSitios.hidden = false;
        actualizarEstadoBotonesRetry();
        el.loadingSitios.hidden = true;
        el.progressFill.classList.remove('progress-bar__fill--active');
        el.progressFill.style.transition = 'none';
        el.progressFill.offsetHeight;
        el.progressFill.style.transition = '';
        setTimeout(() => cargarFondoSitios(), 100);
      });
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



  }

  // -------------------------------------------------------------------
  // Vista móvil: alternar entre panel completo y mapa completo
  // -------------------------------------------------------------------
  function esMovil() {
    return window.matchMedia(MEDIA_MOVIL).matches;
  }

  /** Cambia el estado de la vista en móvil: 'split' | 'map' | 'panel'. */
  function setVistaMovil(vista) {
    el.appRoot.setAttribute('data-mobile-view', vista);
    el.btnMobileCollapse.setAttribute('aria-pressed', String(vista === 'map'));
    el.btnMobileExpand.setAttribute('aria-pressed', String(vista === 'panel'));
    // El contenedor del mapa cambia de tamaño con la transición CSS; se
    // recalcula el tamaño de Leaflet una vez que el layout se estabiliza.
    setTimeout(() => MapModule.invalidateSize(), 220);

    // Al colapsar el panel se activa la pantalla completa nativa para que
    // la barra de resumen no quede oculta bajo los menús del navegador.
    if (vista === 'map' && esMovil() && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }

  let ultimosValoresAplicados = { distancia: null, tiempo: null };

  /** Habilita/deshabilita todos los controles de entrada durante el cálculo de ruta. */
  function ponerEnCargaRuta(cargando) {
    if (cargando) el.btnCalcular.disabled = true;
    el.btnCalcular.setAttribute('data-loading', cargando ? 'true' : 'false');
    el.btnAgregarEscala.disabled = cargando;
    el.origenInput.disabled = cargando;
    el.destinoInput.disabled = cargando;
    document.querySelectorAll('.combo__trigger.escala-trigger').forEach((b) => { b.disabled = cargando; });
    document.querySelectorAll('.sitio-card__add').forEach((b) => { b.disabled = cargando; });
  }

  // -------------------------------------------------------------------
  // Cálculo de la ruta principal (solo al pulsar el botón)
  // -------------------------------------------------------------------
  async function calcularRutaPrincipal(conservarParadas = false) {
    if (!state.origen || !state.destino) return;

    if (state.origen.id === state.destino.id) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'El origen y el destino deben ser municipios diferentes.';
      el.sitiosLista.hidden = true;
      return;
    }

    // Una nueva ruta principal invalida cualquier parada agregada previamente
    // (excepto cuando se reordenan escalas, que deben conservarse).
    if (!conservarParadas) state.paradas = [];
    state.sitios.forEach((s) => {
      delete s._detourCoords;
      delete s._detourDist;
      delete s._detourDur;
      delete s.distanciaRutaKm;
      delete s.tiempoDesvioMin;
      delete s.distanciaOrigenKm;
    });
    MapModule.limpiarParadas();
    MapModule.limpiarEscalas();
    limpiarPreview();

    ponerEnCargaRuta(true);

    try {
      const puntosRuta = [state.origen, ...state.escalas.filter((e) => e.lat != null), state.destino];
      const usarConParadas = puntosRuta.length > 2;
      const ruta = usarConParadas
        ? await RoutingModule.calcularRutaConParadas(puntosRuta, PERFIL_FIJO)
        : await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);
      aplicarRutaCalculada(ruta);
      // Limpia las filas de escala del DOM (pasan a la lista de paradas)
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      state.escalas.forEach((e) => { delete e._row; });
      renderizarParadas();
      el.btnMostrarSitiosCercanos.disabled = false;

      el.checkDistancia.checked = true;
      el.filtroDistancia.value = '10';
      el.filtroDistanciaValor.textContent = '10 km';
      el.filtroDistancia.disabled = false;

      // En dispositivos móviles, calcular la ruta pone toda la página en
      // pantalla completa (modo nativo del navegador) sin ocultar el panel.
      if (esMovil() && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }

    } catch (err) {
      el.statDistancia.textContent = '—';
      el.statTiempo.textContent = '—';
    } finally {
      ponerEnCargaRuta(false);
    }
  }

  async function aplicarRutaCalculada(ruta) {
    state.rutaBase = ruta;
    await aplicarRutaConDesvios();
  }

  // -------------------------------------------------------------------
  // Filtro espacial + render de sitios sobre el mapa (solo al aplicar)
  // -------------------------------------------------------------------
  function ejecutarFiltrado() {
    if (!state.rutaActual) return;
    if (el.panelSitios.hidden) return;
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const usarDistancia = el.checkDistancia.checked || (state.categoriasSeleccionadas.length > 0 && !el.checkDistancia.checked && !el.checkTiempo.checked);
    const usarTiempo = el.checkTiempo.checked;
    if (!usarDistancia && !usarTiempo && state.categoriasSeleccionadas.length === 0) return;

    const opciones = {
      usarDistancia,
      usarTiempo,
      distanciaMaximaKm: usarDistancia ? Number(el.filtroDistancia.value) : 5,
      tiempoMaximoMin: usarTiempo ? Number(el.filtroTiempo.value) : 120,
      origen: state.origen,
      excluirIds: state.paradas.map((p) => p.id),
    };
    let sitiosResultado = FiltersModule.filtrarSitiosPorRuta(state.sitios, rutaFiltro.geojson, opciones);
    if (state.categoriasSeleccionadas.length > 0) {
      const catsNorm = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim()));
      sitiosResultado = sitiosResultado.filter((s) => {
        const sc = (s.categoria || '').toLowerCase().trim();
        return catsNorm.has(sc);
      });
    }
    state.sitiosFiltrados = sitiosResultado;
    renderizarSitios(sitiosResultado);
    renderizarCategoriasMenu();
  }

  function ejecutarFiltradoProgresivo(completado) {
    if (!state.rutaActual) return;
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const TAMANO_BLOQUE = 400;
    const sitios = state.sitios.filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)));
    const idsExcluidos = new Set(state.paradas.map((p) => p.id));
    const distanciaMax = Number(el.filtroDistancia.value);
    const bbox = FiltersModule.rutaBboxConMargen(rutaFiltro.geojson, distanciaMax);
    const resultados = [];
    const catsNorm = state.categoriasSeleccionadas.length > 0 ? new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim())) : null;
    let idx = 0;
    let indiceMensaje = 0;
    const intervaloMensajes = setInterval(() => {
      indiceMensaje = (indiceMensaje + 1) % el.mensajesCarga.length;
      el.loadingMsg.textContent = el.mensajesCarga[indiceMensaje];
    }, 2000);

    function procesarBloque() {
      const fin = Math.min(idx + TAMANO_BLOQUE, sitios.length);
      for (let i = idx; i < fin; i++) {
        const s = sitios[i];
        if (idsExcluidos.has(s.id)) continue;
        if (FiltersModule.fueraDeBbox(s, bbox)) {
          s.distanciaRutaKm = Infinity;
          continue;
        }
        if (s.distanciaRutaKm == null) {
          s.distanciaRutaKm = FiltersModule.distanciaARuta(s, rutaFiltro.geojson);
          s.tiempoDesvioMin = FiltersModule.aproximarTiempoDesvio(s.distanciaRutaKm);
        }
        if (!isFinite(s.distanciaRutaKm)) continue;
        if (s.distanciaRutaKm > distanciaMax) continue;
        if (s.distanciaOrigenKm == null) {
          s.distanciaOrigenKm = FiltersModule.distanciaAOrigen(s, state.origen);
        }
        if (catsNorm) {
          const sc = (s.categoria || '').toLowerCase().trim();
          if (!catsNorm.has(sc)) continue;
        }
        resultados.push(s);
      }
      idx = fin;
      const progreso = idx / sitios.length;
      el.progressFill.style.width = `${Math.round(progreso * 100)}%`;

      if (idx < sitios.length) {
        setTimeout(procesarBloque, 0);
      } else {
        clearInterval(intervaloMensajes);
        resultados.sort((a, b) => (a.distanciaOrigenKm ?? a.distanciaRutaKm) - (b.distanciaOrigenKm ?? b.distanciaRutaKm));
        state.sitiosFiltrados = resultados;
        renderizarSitios(resultados);
        renderizarCategoriasMenu();
        ultimosValoresAplicados.distancia = Number(el.filtroDistancia.value);
        actualizarEstadoBotonesRetry();
        completado();
      }
    }

    setTimeout(procesarBloque, 30);
  }

  function cargarFondoSitios() {
    if (!state.rutaActual) return;
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const pendientes = state.sitios.filter((s) => s.distanciaRutaKm == null || !isFinite(s.distanciaRutaKm));
    const TAM = 100;
    let i = 0;
    function fondoBloque() {
      const fin = Math.min(i + TAM, pendientes.length);
      for (let j = i; j < fin; j++) {
        const s = pendientes[j];
        if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) continue;
        s.distanciaRutaKm = FiltersModule.distanciaARuta(s, rutaFiltro.geojson);
        s.tiempoDesvioMin = FiltersModule.aproximarTiempoDesvio(s.distanciaRutaKm);
        s.distanciaOrigenKm = FiltersModule.distanciaAOrigen(s, state.origen);
      }
      i = fin;
      if (i < pendientes.length) {
        setTimeout(fondoBloque, 50);
      } else {
        renderizarCategoriasMenu();
      }
    }
    if (pendientes.length > 0) fondoBloque();
  }

  function actualizarEstadoBotonesRetry() {
    const distVal = Number(el.filtroDistancia.value);
    const tiempoVal = Number(el.filtroTiempo.value);
    el.btnAplicarDistancia.disabled = !el.checkDistancia.checked || distVal === ultimosValoresAplicados.distancia;
    el.btnAplicarTiempo.disabled = !el.checkTiempo.checked || tiempoVal === ultimosValoresAplicados.tiempo;
  }

  function aplicarFiltrosConSpinner(botonOrigenClic) {
    if (!state.rutaActual) return;
    if (botonOrigenClic === el.btnAplicarDistancia && !el.checkDistancia.checked) return;
    if (botonOrigenClic === el.btnAplicarTiempo && !el.checkTiempo.checked) return;
    ponerEnCarga(botonOrigenClic, true);
    setTimeout(() => {
      ejecutarFiltrado();
      if (botonOrigenClic === el.btnAplicarDistancia) ultimosValoresAplicados.distancia = Number(el.filtroDistancia.value);
      if (botonOrigenClic === el.btnAplicarTiempo) ultimosValoresAplicados.tiempo = Number(el.filtroTiempo.value);
      actualizarEstadoBotonesRetry();
      ponerEnCarga(botonOrigenClic, false);
    }, 15);
  }

  function renderizarSitios(sitios) {
    limpiarPreview();
    MapModule.limpiarSitios();
    el.sitiosLista.innerHTML = '';
    el.sitiosContador.textContent = String(sitios.length);

    if (sitios.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      return;
    }

    el.sitiosVacio.hidden = true;
    el.sitiosLista.hidden = false;

    sitios.forEach((sitio) => {
      if (sitio.lat == null || sitio.lon == null || isNaN(Number(sitio.lat)) || isNaN(Number(sitio.lon))) return;
      const marker = TourismModule.crearMarcador(sitio);
      MapModule.agregarMarcadorSitio(marker);
      el.sitiosLista.appendChild(crearTarjetaSitio(sitio));
    });
  }

  /** Construye la tarjeta de un sitio en la lista, con acciones de previsualizar y agregar. */
  function crearTarjetaSitio(sitio) {
    const li = Utils.crearElemento(`
      <li class="sitio-card" data-sitio-id="${sitio.id}">
        <div class="sitio-card__top">
          <span class="sitio-card__nombre">${sitio.nombre}</span>
          <div class="sitio-card__top-right">
            <button type="button" class="icon-btn sitio-card__add" title="Agregar a la ruta" aria-label="Agregar ${sitio.nombre} a la ruta">
              <svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              <span class="icon-btn__spinner" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="sitio-card__meta">
          <span>${sitio.municipio}, ${sitio.departamento}</span>
          <span class="mono">${sitio.distanciaRutaKm.toFixed(1)} km · ${Math.round(sitio.tiempoDesvioMin)} min</span>
        </div>
        <p class="sitio-card__preview" hidden></p>
      </li>
    `);

    const btnAdd = li.querySelector('.sitio-card__add');
    btnAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      agregarParada(sitio, btnAdd);
    });

    li.addEventListener('click', () => previsualizarRutaHaciaSitio(sitio, li));

    return li;
  }

  // -------------------------------------------------------------------
  // Previsualización: ruta directa de origen a un sitio seleccionado
  // -------------------------------------------------------------------
  async function previsualizarRutaHaciaSitio(sitio, cardEl) {
    // Un segundo clic sobre la misma tarjeta cancela la previsualización.
    if (state.previewSitioId === sitio.id) {
      limpiarPreview();
      return;
    }

    if (!state.rutaActual) return;

    cardEl.classList.add('sitio-card--loading');

    try {
      // Punto sobre la ruta principal más cercano al sitio: es ahí donde
      // realmente se produce el desvío, no en el municipio de origen.
      const puntoDesvio = turf.nearestPointOnLine(
        state.rutaActual.geojson,
        turf.point([sitio.lon, sitio.lat])
      );
      const [lonDesvio, latDesvio] = puntoDesvio.geometry.coordinates;
      const origenDesvio = { lat: latDesvio, lon: lonDesvio };

      const ruta = await RoutingModule.calcularRuta(origenDesvio, sitio, PERFIL_FIJO);
      MapModule.dibujarRutaPreview(ruta.geojson);
      MapModule.encuadrar(ruta.geojson);

      state.previewSitioId = sitio.id;
      marcarTarjetaActiva(cardEl);

      const preview = cardEl.querySelector('.sitio-card__preview');
      preview.hidden = false;
      preview.innerHTML = `Ruta desde el desvío: <span class="mono">${Utils.formatearDistancia(ruta.distanciaMetros)} · ${Utils.formatearDuracion(ruta.duracionSegundos)}</span>`;
    } catch (err) {
      const preview = cardEl.querySelector('.sitio-card__preview');
      preview.hidden = false;
      preview.textContent = 'No se pudo calcular la ruta hacia este sitio.';
    } finally {
      cardEl.classList.remove('sitio-card--loading');
    }
  }

  function marcarTarjetaActiva(cardActiva) {
    el.sitiosLista.querySelectorAll('.sitio-card').forEach((card) => {
      card.classList.toggle('sitio-card--active', card === cardActiva);
    });
  }

  function limpiarPreview() {
    state.previewSitioId = null;
    MapModule.limpiarRutaPreview();
    el.sitiosLista.querySelectorAll('.sitio-card').forEach((card) => {
      card.classList.remove('sitio-card--active');
      const preview = card.querySelector('.sitio-card__preview');
      if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    });
  }

  // -------------------------------------------------------------------
  // Construcción de ruta con desvíos por carretera (OSRM para cada desvío)
  // -------------------------------------------------------------------
  async function construirRutaConDesvios(rutaBase, paradas) {
    if (!rutaBase || paradas.length === 0) return rutaBase;

    const baseLine = turf.lineString(rutaBase.geojson.geometry.coordinates);

    const results = await Promise.all(paradas.map(async (p) => {
      const nearest = turf.nearestPointOnLine(baseLine, turf.point([p.lon, p.lat]));
      const [nearestLon, nearestLat] = nearest.geometry.coordinates;
      try {
        const rutaDesvio = await RoutingModule.calcularRuta(
          { lat: nearestLat, lon: nearestLon },
          { lat: p.lat, lon: p.lon },
          PERFIL_FIJO
        );
        return {
          index: nearest.properties.index,
          detourCoords: rutaDesvio.geojson.geometry.coordinates,
          detourDist: rutaDesvio.distanciaMetros,
          detourDur: rutaDesvio.duracionSegundos,
        };
      } catch {
        return { id: p.id, error: true };
      }
    }));

    let coords = rutaBase.geojson.geometry.coordinates.slice();
    let distanciaExtra = 0;
    let tiempoExtra = 0;
    const idsFallidos = [];
    let offsetAccum = 0;

    for (const r of results) {
      if (r.error) {
        idsFallidos.push(r.id);
        continue;
      }
      const adjustedIndex = r.index + offsetAccum;
      const before = coords.slice(0, adjustedIndex + 1);
      const after = coords.slice(adjustedIndex + 1);
      const returnCoords = r.detourCoords.slice().reverse();
      coords = [...before, ...r.detourCoords, ...returnCoords, ...after];
      offsetAccum += r.detourCoords.length * 2;
      distanciaExtra += r.detourDist * 2;
      tiempoExtra += r.detourDur * 2;
    }

    return {
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
      },
      distanciaMetros: rutaBase.distanciaMetros + Math.round(distanciaExtra),
      duracionSegundos: rutaBase.duracionSegundos + Math.round(tiempoExtra),
      idsFallidos,
    };
  }

  async function aplicarRutaConDesvios() {
    if (!state.rutaBase) return;
    state.rutaActual = await construirRutaConDesvios(state.rutaBase, state.paradas);

    let iteraciones = 0;
    while (state.rutaActual.idsFallidos && state.rutaActual.idsFallidos.length > 0 && iteraciones < 3) {
      const idsSet = new Set(state.rutaActual.idsFallidos);
      state.paradas = state.paradas.filter((p) => !idsSet.has(p.id));
      renderizarParadas();
      state.rutaActual = await construirRutaConDesvios(state.rutaBase, state.paradas);
      iteraciones++;
    }

    MapModule.dibujarRuta(state.rutaActual.geojson, {
      distanciaMetros: state.rutaActual.distanciaMetros,
      duracionSegundos: state.rutaActual.duracionSegundos,
      origenNombre: state.origen?.nombre || 'el origen',
    });
    MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
    MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);

    let num = 1;
    state.escalas.filter((e) => e.lat != null).forEach((e) => { e._numero = num++; });
    state.paradas.forEach((p) => { p._numero = num++; });
    MapModule.setMarcadoresEscalas(state.escalas);
    MapModule.setMarcadoresParadas(state.paradas);
    MapModule.encuadrar(state.rutaActual.geojson);
    el.statDistancia.textContent = Utils.formatearDistancia(state.rutaActual.distanciaMetros);
    el.statTiempo.textContent = Utils.formatearDuracion(state.rutaActual.duracionSegundos);
  }

  // -------------------------------------------------------------------
  // Agregar un sitio como desvío (calcula ruta por OSRM ida y vuelta)
  // -------------------------------------------------------------------
  async function agregarParada(sitio, boton) {
    if (boton) ponerEnCarga(boton, true);
    state.paradas.push(sitio);
    try {
      await aplicarRutaConDesvios();
      renderizarParadas();
      limpiarPreview();
      const idx = state.sitiosFiltrados.findIndex((s) => s.id === sitio.id);
      if (idx !== -1) {
        state.sitiosFiltrados.splice(idx, 1);
        renderizarSitios(state.sitiosFiltrados);
      }
    } finally {
      if (boton) ponerEnCarga(boton, false);
    }
  }

  async function eliminarParada(sitioId) {
    const indice = state.paradas.findIndex((p) => p.id === sitioId);
    if (indice === -1) return;
    state.paradas.splice(indice, 1);
    await aplicarRutaConDesvios();
    renderizarParadas();
  }

  function eliminarEscala(id, rowEl) {
    const idx = state.escalas.findIndex((e) => e.id === id);
    if (idx !== -1) state.escalas.splice(idx, 1);
    if (rowEl && rowEl.parentNode) rowEl.remove();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; });
      calcularRutaPrincipal(true);
    } else {
      renderizarParadas();
    }
  }

  // -------------------------------------------------------------------
  // Renderizar lista de paradas en el panel (escalas + sitios turísticos)
  // -------------------------------------------------------------------
  function adjuntarDragEvents(li, tipo, id) {
    li.draggable = true;
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ tipo, id }));
      li.classList.add('parada-item--dragging');
    });
    li.addEventListener('dragend', () => {
      el.paradasLista.querySelectorAll('.parada-item').forEach((el_) => {
        el_.classList.remove('parada-item--dragging', 'parada-item--drag-over');
      });
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('parada-item--drag-over');
      el.paradasLista.querySelectorAll('.parada-item').forEach((el_) => {
        if (el_ !== li) el_.classList.remove('parada-item--drag-over');
      });
    });
    li.addEventListener('dragleave', () => {
      li.classList.remove('parada-item--drag-over');
    });
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      el.paradasLista.querySelectorAll('.parada-item').forEach((el_) => {
        el_.classList.remove('parada-item--drag-over');
      });
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (data.tipo === 'escala' && tipo === 'escala') moverEscala(data.id, id);
        else if (data.tipo === 'parada' && tipo === 'parada') moverParada(data.id, id);
        else if (data.tipo === 'escala' && tipo === 'parada') moverEscala(data.id, null, id);
        else if (data.tipo === 'parada' && tipo === 'escala') moverParada(data.id, null, id);
      } catch (_) {}
    });
  }

  function renderizarParadas() {
    const escalas = state.escalas.filter((e) => e.lat != null);
    const total = escalas.length + state.paradas.length;
    el.paradasLista.innerHTML = '';
    el.paradasContador.textContent = String(total);
    el.panelParadas.hidden = total === 0;

    escalas.forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'parada-item';
      li.dataset.paradaId = e.id;
      li.style.borderLeftColor = '#4a6fa5';
      adjuntarDragEvents(li, 'escala', e.id);

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = String(i + 1);
      num.style.background = '#4a6fa5';

      const nombre = document.createElement('span');
      nombre.className = 'parada-item__nombre';
      nombre.textContent = e.nombre;

      const acciones = document.createElement('div');
      acciones.className = 'parada-item__acciones';

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'parada-item__btn parada-item__btn--del';
      btnDel.title = 'Quitar de la ruta';
      btnDel.setAttribute('aria-label', 'Quitar ' + e.nombre + ' de la ruta');
      btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

      const escalaData = e;
      btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarEscala(escalaData.id, escalaData._row); });

      acciones.appendChild(btnDel);
      li.appendChild(num);
      li.appendChild(nombre);
      li.appendChild(acciones);
      el.paradasLista.appendChild(li);
    });

    state.paradas.forEach((sitio, i) => {
      const li = document.createElement('li');
      li.className = 'parada-item';
      li.dataset.paradaId = sitio.id;
      adjuntarDragEvents(li, 'parada', sitio.id);

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = String(escalas.length + i + 1);

      const nombre = document.createElement('span');
      nombre.className = 'parada-item__nombre';
      nombre.textContent = sitio.nombre;

      const acciones = document.createElement('div');
      acciones.className = 'parada-item__acciones';

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'parada-item__btn parada-item__btn--del';
      btnDel.title = 'Quitar de la ruta';
      btnDel.setAttribute('aria-label', 'Quitar ' + sitio.nombre + ' de la ruta');
      btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

      btnDel.addEventListener('click', (e) => { e.stopPropagation(); eliminarParada(sitio.id); });

      acciones.appendChild(btnDel);
      li.appendChild(num);
      li.appendChild(nombre);
      li.appendChild(acciones);
      el.paradasLista.appendChild(li);
    });
  }

  async function moverEscala(desdeId, hastaId) {
    if (desdeId === hastaId) return;
    const desdeIdx = state.escalas.findIndex((e) => e.id === desdeId);
    let hastaIdx;
    if (hastaId == null) {
      hastaIdx = state.escalas.length - 1;
    } else {
      hastaIdx = state.escalas.findIndex((e) => e.id === hastaId);
    }
    if (desdeIdx === -1 || hastaIdx === -1) return;
    const item = state.escalas.splice(desdeIdx, 1)[0];
    state.escalas.splice(hastaIdx, 0, item);
    state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; });
    await calcularRutaPrincipal(true);
  }

  async function moverParada(desdeId, hastaId) {
    if (desdeId === hastaId) return;
    const desdeIdx = state.paradas.findIndex((p) => p.id === desdeId);
    let hastaIdx;
    if (hastaId == null) {
      hastaIdx = 0;
    } else {
      hastaIdx = state.paradas.findIndex((p) => p.id === hastaId);
    }
    if (desdeIdx === -1 || hastaIdx === -1) return;
    const item = state.paradas.splice(desdeIdx, 1)[0];
    state.paradas.splice(hastaIdx, 0, item);
    await aplicarRutaConDesvios();
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Estado de carga contenido en el propio botón (sin mensajes flotantes)
  // -------------------------------------------------------------------
  function ponerEnCarga(boton, cargando) {
    boton.disabled = cargando;
    boton.setAttribute('data-loading', cargando ? 'true' : 'false');
  }

  /** Cambia el icono del botón de filtro entre retry y check. */
  // -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);
})();
