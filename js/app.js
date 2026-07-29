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
    'Bogotá D.C.':'Bogotá D.C.','Bolívar':'Cartagena','Boyacá':'Tunja','Caldas':'Manizales',
    'Caquetá':'Florencia','Casanare':'Yopal','Cauca':'Popayán','Cesar':'Valledupar',
    'Chocó':'Quibdó','Córdoba':'Montería','Cundinamarca':'Bogotá D.C.','Guainía':'Ínirida',
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
    orden: [],            // orden combinado de escalas + paradas para visualización
    rutaBase: null,
    rutaActual: null,
    paradas: [],
    sitiosFiltrados: [],
    sitiosFiltradosBase: [],
    ordenSitios: 'origen',
    modoVisibilidad: 'completa',
    previewSitioId: null,
    categoriasSeleccionadas: [],
    categoriasUnicas: [],
    elevacion: null,
  };

  // -------------------------------------------------------------------
  // Referencias DOM
  // -------------------------------------------------------------------
  const el = {
    appRoot: document.getElementById('app'),

    origenInput: document.getElementById('origen-input'),
    destinoInput: document.getElementById('destino-input'),
    origenList: document.getElementById('origen-list'),
    destinoList: document.getElementById('destino-list'),
    btnCalcular: document.getElementById('btn-calcular'),

    checkAutoOrganizar: document.getElementById('check-auto-organizar'),

    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    filtroDistanciaValor: document.getElementById('filtro-distancia-valor'),
    sitiosVacio: document.getElementById('sitios-vacio'),
    sitiosLista: document.getElementById('sitios-lista'),
    sitiosContador: document.getElementById('sitios-contador'),
    btnOrdenOrigen: document.getElementById('btn-orden-origen'),
    btnOrdenDestino: document.getElementById('btn-orden-destino'),

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

    btnDescubreCategorias: document.getElementById('btn-descubre-categorias'),
    btnDescubreDesvios: document.getElementById('btn-descubre-desvios'),
    btnDescubreOrdenar: document.getElementById('btn-descubre-ordenar'),
    descubreDropdownCategorias: document.getElementById('descubre-dropdown-categorias'),
    descubreDropdownDesvios: document.getElementById('descubre-dropdown-desvios'),
    descubreDropdownOrdenar: document.getElementById('descubre-dropdown-ordenar'),
    btnOrdenOrigenDes: document.getElementById('btn-descubre-orden-origen'),
    btnOrdenDestinoDes: document.getElementById('btn-descubre-orden-destino'),
    btnListaCompleta: document.getElementById('btn-descubre-lista-completa'),
    btnSitiosVisibles: document.getElementById('btn-descubre-visibles'),
    categoriasGrid: document.getElementById('categorias-grid'),


    panelEscalas: document.getElementById('panel-escalas'),
    btnAgregarEscala: document.getElementById('btn-agregar-escala'),
    panelLocate: document.getElementById('panel-locate'),
    btnTabPanelRuta: document.getElementById('btn-tab-panel-ruta'),
    btnTabPanelDescubre: document.getElementById('btn-tab-panel-descubre'),
    panelDescubreActions: document.getElementById('panel-descubre-actions'),
    sitiosFronteraContador: document.getElementById('sitios-frontera-contador'),

    btnToggleSitiosFloat: document.getElementById('btn-toggle-sitios-float'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    panelSitios: document.getElementById('panel-sites'),
    btnMostrarSitiosCercanos: document.getElementById('btn-mostrar-sitios'),

    statDistanciaMobile: document.getElementById('stat-distancia-mobile'),
    statTiempoMobile: document.getElementById('stat-tiempo-mobile'),
    sitiosContadorTab: document.getElementById('sitios-contador-tab'),
    sitiosContadorTabDesktop: document.getElementById('sitios-contador-tab-desktop'),
    icoDescubreTab: document.getElementById('ico-descubre-tab'),
    icoDescubreTabDesktop: document.getElementById('ico-descubre-tab-desktop'),
    btnTabDescubre: document.getElementById('btn-tab-descubre'),
    btnTabRuta: document.getElementById('btn-tab-ruta'),
    mobileTabBar: document.getElementById('mobile-tab-bar'),
    btnAltimetria: document.getElementById('btn-altimetria'),
    btnTabAltimetria: document.getElementById('btn-tab-altimetria'),
    btnCerrarAltimetria: document.getElementById('btn-cerrar-altimetria'),
    altimetriaPanel: document.getElementById('altimetria'),
    altimetriaChart: document.getElementById('altimetria-chart'),
    altimetriaPanelMovil: document.getElementById('altimetria-panel'),
    altimetriaChartMovil: document.getElementById('altimetria-chart-panel'),
  };

  const LETRAS_RUTA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function etiquetaIntermedia(idx) {
    return LETRAS_RUTA[Math.min(idx + 1, LETRAS_RUTA.length - 2)];
  }

  function ordenarSitios(sitios) {
    const lista = [...sitios];
    if (state.ordenSitios === 'origen') {
      lista.sort((a, b) => (a.distanciaOrigenKm ?? a.distanciaRutaKm ?? Infinity) - (b.distanciaOrigenKm ?? b.distanciaRutaKm ?? Infinity));
    } else if (state.ordenSitios === 'destino') {
      lista.sort((a, b) => (a.distanciaDestinoKm ?? a.distanciaRutaKm ?? Infinity) - (b.distanciaDestinoKm ?? b.distanciaRutaKm ?? Infinity));
    }
    return lista;
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
    if (el.btnListaCompleta) el.btnListaCompleta.classList.toggle('descubre-dropdown__item--active', state.modoVisibilidad === 'completa');
    if (el.btnSitiosVisibles) el.btnSitiosVisibles.classList.toggle('descubre-dropdown__item--active', state.modoVisibilidad === 'visibles');
  }

  function aplicarOrdenSitios(orden) {
    state.ordenSitios = orden;
    actualizarBotonesOrden();
    _actualizarEstadoBotonesDescubre();
    renderizarSitios(state.modoVisibilidad === 'visibles' ? _filtrarVisibles(state.sitiosFiltrados) : state.sitiosFiltrados);
  }

  function aplicarModoVisibilidad(modo) {
    state.modoVisibilidad = modo;
    _actualizarEstadoBotonesDescubre();
    if (modo === 'visibles') {
      renderizarSitios(_filtrarVisibles(state.sitiosFiltrados));
    } else {
      renderizarSitios(state.sitiosFiltrados);
    }
  }

  function _filtrarVisibles(sitios) {
    const map = MapModule.getMap();
    if (!map) return sitios;
    const bounds = map.getBounds();
    return sitios.filter((s) => {
      const lat = Number(s.lat), lon = Number(s.lon);
      if (isNaN(lat) || isNaN(lon)) return false;
      return bounds.contains([lat, lon]);
    });
  }

  function activarPanelTab(tab) {
    document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('panel-tab--active'));
    if (tab === 'ruta') {
      el.btnTabPanelRuta.classList.add('panel-tab--active');
      el.panelDescubreActions.hidden = true;
      el.loadingSitios.hidden = true;
      el.panelSitios.hidden = true;
      el.panelSitios.scrollTop = 0;
      el.panelLocate.hidden = false;
      el.panelEscalas.hidden = true;
      if (state.rutaActual) {
        el.panelParadas.hidden = false;
      }
      el.btnMostrarSitiosCercanos.hidden = !state.rutaActual || state.sitiosFiltrados.length > 0;
      el.btnMostrarSitiosCercanos.disabled = !state.rutaActual || state.sitiosFiltrados.length > 0;
    } else {
      el.btnTabPanelDescubre.classList.add('panel-tab--active');
      el.panelLocate.hidden = true;
      el.panelEscalas.hidden = true;
      el.panelParadas.hidden = true;
      el.panelDescubreActions.hidden = false;
      el.panelSitios.hidden = false;
      el.btnMostrarSitiosCercanos.hidden = true;
    }
  }

  // -------------------------------------------------------------------
  // Inicialización
  // -------------------------------------------------------------------
  async function init() {
    MapModule.init('map');
    MapModule.setOnEliminarParada(eliminarParada);
    TourismModule.setOnAgregarParada((sitio, btn) => agregarParada(sitio, btn));
    MapModule.setOnTramoCompletado(onTramoMarcado);

    try {
      const [municipios, sitios] = await Promise.all([
        TourismModule.cargarMunicipios(),
        TourismModule.cargarSitios(),
        RouteWarningsModule.cargar(),
      ]);
      state.municipios = municipios;
      state.sitios = sitios;

      // Cargar sitios de frontera
      try {
        const res = await fetch('data/sitios_turisticos_frontera.json');
        if (res.ok) {
          const frontera = await res.json();
          for (const f of frontera) {
            if (!f.sitios_turisticos_fuera_colombia) continue;
            for (let i = 0; i < f.sitios_turisticos_fuera_colombia.length; i++) {
              const raw = f.sitios_turisticos_fuera_colombia[i];
              const sep = raw.indexOf(' - ');
              const nombre = sep > 0 ? raw.substring(0, sep).trim() : raw.trim();
              const desc = sep > 0 ? raw.substring(sep + 3).trim() : '';
              state.sitios.push({
                id: 'frontera_' + f.id + '_' + i,
                nombre,
                categoria: 'Frontera',
                municipio: f.ciudad_origen,
                departamento: f.departamento,
                lat: f.latitud,
                lon: f.longitud,
                descripcion: desc,
                ubicacion: f.pais_fronterizo + ' (frontera)',
                frontera: true,
              });
            }
          }
        }
      } catch {}
      if (el.sitiosFronteraContador) {
        el.sitiosFronteraContador.textContent = 'Frontera: ' + state.sitios.filter(s => s.frontera).length;
      }
    } catch (err) {
      el.sitiosVacio.textContent = 'Error cargando los datos base: ' + err.message;
      return;
    }

    initCombos();
    state.categoriasUnicas = obtenerCategoriasUnicas();
    renderizarCategoriasMenu();
    initEscalas();
    initEventos();
    garantizarVisibilidadMovil();
  }

  // -------------------------------------------------------------------
  // Combos de búsqueda (origen / destino)
  // -------------------------------------------------------------------
  function initCombos() {
    setupCombo(el.origenInput, el.origenList, (m) => { state.origen = m; actualizarEstadoBotonCalcular(); _actualizarTextoBotonesOrden(); }, () => {
      const ids = new Set();
      if (state.destino?.id) ids.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, true);
    setupCombo(el.destinoInput, el.destinoList, (m) => { state.destino = m; actualizarEstadoBotonCalcular(); _actualizarTextoBotonesOrden(); }, () => {
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
      return [...new Set(state.municipios.map((m) => m.departamento))].sort((a, b) => {
        if (a === 'Córdoba' && b === 'Cundinamarca') return -1;
        if (a === 'Cundinamarca' && b === 'Córdoba') return 1;
        return a.localeCompare(b, 'es');
      });
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
    cerrarAltimetria();
    AltimetriaModule.limpiar();
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude: lat, longitude: lon } = pos.coords;
              const nombre = 'Mi ubicación';
              const txt = trigger.querySelector('.combo__trigger-text');
              txt.textContent = nombre;
              txt.removeAttribute('data-placeholder');
              trigger.setAttribute('aria-label', 'Ubicación actual');
              onSelect({ id: 'gps_' + Date.now(), lat, lon, nombre, departamento: '' });
              ponerEnCargaRuta(false);
            },
            () => {
              ponerEnCargaRuta(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
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
          const idsExcluidos = excluirIdsFn ? excluirIdsFn() : new Set();
          const municipios = obtenerMunicipios(d).filter((m) => !idsExcluidos.has(m.id));
          if (municipios.length === 1) {
            const m = municipios[0];
            listEl.hidden = true;
            const txt = trigger.querySelector('.combo__trigger-text');
            txt.textContent = formatMunicipio(m);
            txt.removeAttribute('data-placeholder');
            trigger.setAttribute('aria-label', m.nombre + ' — municipio de ' + m.departamento);
            onSelect(m);
          } else {
            renderMunicipios();
          }
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
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
          txt.textContent = formatMunicipio(m);
          txt.removeAttribute('data-placeholder');
          trigger.setAttribute('aria-label', m.nombre + ' — municipio de ' + m.departamento);
          onSelect(m);
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
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
    el.panelEscalas.hidden = false;

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
      const deptos = [...new Set(state.municipios.map((m) => m.departamento))].sort((a, b) => {
        if (a === 'Córdoba' && b === 'Cundinamarca') return -1;
        if (a === 'Cundinamarca' && b === 'Córdoba') return 1;
        return a.localeCompare(b, 'es');
      });
      deptos.forEach((d) => {
        const li = document.createElement('li');
        li.textContent = d;
        li.addEventListener('click', (e) => { e.stopPropagation(); renderMunicipios(d); });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
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
          trigger.querySelector('.combo__trigger-text').textContent = formatMunicipio(m);
          trigger.querySelector('.combo__trigger-text').removeAttribute('data-placeholder');
          trigger.dataset.rawName = m.nombre;
          seleccion = m;
          actualizarEscalas();
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
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
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      renderizarSitios([]);
      _habilitarMostrarSitios();
          calcularRutaPrincipal(true);
        }
      }
      row.remove();
      actualizarEstadoBotonCalcular();
    });

    state.escalas.push({ _row: row });
  }

  async function actualizarEscalas() {
    state.escalas.forEach((e) => {
      if (!e._row) return;
      const txt = e._row.querySelector('.combo__trigger-text');
      const triggerEl = e._row.querySelector('.combo__trigger');
      if (!txt || txt.hasAttribute('data-placeholder')) return;
      const nombre = triggerEl?.dataset.rawName || txt.textContent;
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
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      conteoCategoriasBase = new Map();
      renderizarSitios([]);
      renderizarCategoriasMenu();
      el.loadingMsg.textContent = 'Calculando nueva ruta…';
      if (el.spinnerBike) el.spinnerBike.hidden = true;
      el.loadingSitios.hidden = false;
      let idxMsg = 0;
      const msgs = ['Calculando nueva ruta…', 'Espera un poco más, estamos ajustando detalles…'];
      const intervalo = setInterval(() => {
        idxMsg = (idxMsg + 1) % msgs.length;
        el.loadingMsg.textContent = msgs[idxMsg];
      }, 2000);
      try {
        if (el.checkAutoOrganizar.checked) {
          await organizarAutomaticamente();
        } else {
          await calcularRutaPrincipal(true);
        }
        // Clear site list and show button for manual reload
        renderizarSitios([]);
        _habilitarMostrarSitios();
      } finally {
        clearInterval(intervalo);
        el.loadingSitios.hidden = true;
        if (el.spinnerBike) el.spinnerBike.hidden = false;
      }
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
    return [...mapa.values()].sort((a, b) => a.length - b.length || a.localeCompare(b, 'es'));
  }

  function categoriasDeRuta() {
    if (!conteoCategoriasBase || conteoCategoriasBase.size === 0) return [];
    return [...conteoCategoriasBase.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0], 'es'));
  }

  function renderizarCategoriasMenu(lista) {
    const cats = lista || categoriasDeRuta();
    el.categoriasGrid.innerHTML = '';
    const seleccionadas = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase()));
    cats.sort((a, b) => {
      const an = (Array.isArray(a) ? a[0] : a).toLowerCase();
      const bn = (Array.isArray(b) ? b[0] : b).toLowerCase();
      const aSel = seleccionadas.has(an) ? 0 : 1;
      const bSel = seleccionadas.has(bn) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return an.localeCompare(bn, 'es');
    });
    cats.forEach((ent) => {
      const cat = Array.isArray(ent) ? ent[0] : ent;
      const n = Array.isArray(ent) ? ent[1] : 0;
      const chip = document.createElement('span');
      chip.className = 'categoria-chip';
      if (seleccionadas.has(cat.toLowerCase())) chip.classList.add('categoria-chip--selected');
      chip.textContent = n > 0 ? `${cat} (${n})` : cat;
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
    if (state.rutaActual) ejecutarFiltrado();
  }

  // -------------------------------------------------------------------
  // Eventos generales
  // -------------------------------------------------------------------

  // Mobile tab switching (needed from both initEventos and calcularRutaPrincipal)
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
      requestAnimationFrame(() => AltimetriaModule.renderizar('altimetria-chart-panel'));
    } else {
      if (el.altimetriaPanelMovil) el.altimetriaPanelMovil.hidden = true;
    }
    // Sync panel hidden states with mobile tab
    if (tab === 'ruta') {
      activarPanelTab('ruta');
    } else if (tab === 'descubre') {
      activarPanelTab('descubre');
    }
    setTimeout(() => MapModule.invalidateSize(), 220);
  }

  function toggleMobileTab(tab) {
    if (tab === 'descubre' && el.btnTabDescubre && el.btnTabDescubre.disabled) return;
    const currentTab = el.appRoot.getAttribute('data-mobile-tab');
    const isCollapsed = el.appRoot.getAttribute('data-mobile-panel') === 'collapsed';
    if (currentTab === tab && !isCollapsed) {
      el.appRoot.setAttribute('data-mobile-panel', 'collapsed');
      el.btnTabDescubre.classList.remove('mobile-tab-btn--active');
      el.btnTabRuta.classList.remove('mobile-tab-btn--active');
      if (el.btnTabAltimetria) el.btnTabAltimetria.classList.remove('mobile-tab-btn--active');
      if (el.altimetriaPanelMovil) el.altimetriaPanelMovil.hidden = true;
      setTimeout(() => MapModule.invalidateSize(), 220);
    } else {
      setMobileTab(tab);
    }
  }

  function initEventos() {
    el.btnCalcular.addEventListener('click', () => calcularRutaPrincipal());

    function toggleSitiosHandler() {
      const visible = MapModule.toggleSitios();
      if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.setAttribute('aria-pressed', String(visible));
    }
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.addEventListener('click', toggleSitiosHandler);

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
    el.checkAutoOrganizar.addEventListener('change', () => {
      if (el.checkAutoOrganizar.checked) organizarAutomaticamente();
    });
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
    if (el.btnListaCompleta) {
      el.btnListaCompleta.addEventListener('click', () => aplicarModoVisibilidad('completa'));
    }
    if (el.btnSitiosVisibles) {
      el.btnSitiosVisibles.addEventListener('click', () => aplicarModoVisibilidad('visibles'));
    }

    el.btnMostrarSitiosCercanos.addEventListener('click', () => {
      el.btnMostrarSitiosCercanos.hidden = true;
      el.btnMostrarSitiosCercanos.disabled = true;
      el.checkDistancia.checked = true;
      el.filtroDistancia.disabled = false;
      el.filtroDistancia.value = '5';
      el.filtroDistanciaValor.textContent = '5 km';
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
      if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
      // Ocultar icono de Colombia, mostrar contador de sitios
      if (el.icoDescubreTab) el.icoDescubreTab.hidden = true;
      if (el.icoDescubreTabDesktop) el.icoDescubreTabDesktop.hidden = true;
      if (el.sitiosContadorTab) el.sitiosContadorTab.hidden = false;
      if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.hidden = false;
      if (el.loadingRuta) el.loadingRuta.hidden = true;
      activarPanelTab('descubre');
      if (esMovil()) setMobileTab('descubre');
      // En móvil, abrir el menú de ordenar al mostrar sitios
      if (esMovil() && el.btnDescubreOrdenar) {
        el.btnDescubreOrdenar.click();
      }
      el.loadingSitios.hidden = false;
      ejecutarFiltradoProgresivo(() => {
        el.panelSitios.hidden = false;
        actualizarEstadoBotonesRetry();
        el.loadingSitios.hidden = true;
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

    // Re-filtrar sitios visibles al mover/zoom del mapa
    const _map = MapModule.getMap();
    if (_map) {
      _map.on('moveend', () => {
        if (state.modoVisibilidad === 'visibles' && state.sitiosFiltrados.length > 0) {
          renderizarSitios(_filtrarVisibles(state.sitiosFiltrados));
        }
      });
    }

  }
  // -------------------------------------------------------------------
  // Vista móvil: alternar entre panel completo y mapa completo
  // -------------------------------------------------------------------
  function esMovil() {
    return window.matchMedia(MEDIA_MOVIL).matches;
  }

  function garantizarVisibilidadMovil() {
    if (esMovil()) {
      if (el.mobileTabBar) el.mobileTabBar.removeAttribute('hidden');
      if (el.btnMostrarSitiosCercanos) el.btnMostrarSitiosCercanos.removeAttribute('hidden');
      setTimeout(() => MapModule.invalidateSize(), 50);
    }
  }

  window.addEventListener('resize', garantizarVisibilidadMovil);

  let ultimosValoresAplicados = { distancia: null, tiempo: null };
  let conteoCategoriasBase = null;

  /** Habilita/deshabilita todos los controles de entrada durante el cálculo de ruta. */
  function ponerEnCargaRuta(cargando) {
    if (cargando) el.btnCalcular.disabled = true;
    el.btnCalcular.setAttribute('data-loading', cargando ? 'true' : 'false');
    if (el.loadingRuta) el.loadingRuta.hidden = !cargando;
    if (cargando && el.loadingSitios) el.loadingSitios.hidden = true;
    el.btnAgregarEscala.disabled = cargando;
    el.origenInput.disabled = cargando;
    el.destinoInput.disabled = cargando;
    document.querySelectorAll('.combo__trigger.escala-trigger').forEach((b) => { b.disabled = cargando; });
    document.querySelectorAll('.sitio-card__add').forEach((b) => { b.disabled = cargando; });
    if (esMovil()) {
      el.panelLocate.hidden = cargando;
      el.btnMostrarSitiosCercanos.hidden = cargando;
    }
  }

  function _habilitarMostrarSitios() {
    el.btnMostrarSitiosCercanos.disabled = false;
    el.btnMostrarSitiosCercanos.hidden = false;
  }

  function formatMunicipio(m) {
    if (!m || !m.nombre) return '';
    if (m.nombre === 'Bogotá D.C.' || !m.departamento) return m.nombre;
    return m.nombre + ', ' + m.departamento;
  }

  function toggleAltimetria() {
    if (!el.altimetriaPanel) return;
    const active = !el.altimetriaPanel.hidden;
    if (active) { cerrarAltimetria(); return; }
    el.altimetriaPanel.hidden = false;
    AltimetriaModule.renderizar('altimetria-chart');
  }

  function cerrarAltimetria() {
    if (!el.altimetriaPanel) return;
    el.altimetriaPanel.hidden = true;
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

    // Fullscreen en móvil durante el gesto del usuario (antes de cualquier await)
    if (esMovil() && !document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }

    // Una nueva ruta principal invalida cualquier parada agregada previamente
    // (excepto cuando se reordenan escalas, que deben conservarse).
    if (!conservarParadas) {
      state.paradas = [];
      state.sitios.forEach((s) => {
        delete s._detourCoords;
        delete s._detourDist;
        delete s._detourDur;
        delete s.distanciaRutaKm;
        delete s.tiempoDesvioMin;
        delete s.distanciaOrigenKm;
        delete s.distanciaDestinoKm;
        delete s._offsetLado;
      });
      MapModule.limpiarSitios();
      MapModule.limpiarParadas();
      MapModule.limpiarEscalas();
      limpiarPreview();
      el.panelSitios.hidden = true;
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      state.categoriasSeleccionadas = [];
      conteoCategoriasBase = new Map();
      _habilitarMostrarSitios();
    }

    ponerEnCargaRuta(true);

    try {
      const puntosRuta = [state.origen, ...state.escalas.filter((e) => e.lat != null), state.destino];
      const usarConParadas = puntosRuta.length > 2;
      let ruta = usarConParadas
        ? await RoutingModule.calcularRutaConParadas(puntosRuta, PERFIL_FIJO)
        : await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);

      // Verificar si la ruta pasa por tramos peligrosos y buscar alternativa
      let totalKm = ruta.distanciaMetros / 1000;
      const alertasIniciales = RouteWarningsModule.verificar(ruta.geojson, totalKm);
      if (alertasIniciales.length > 0) {
        console.log('Warnings detectados en ruta principal:', alertasIniciales.length);
        try {
          const alternativas = await RoutingModule.calcularAlternativas(puntosRuta, PERFIL_FIJO);
          console.log('Alternativas recibidas de OSRM:', alternativas.length);
          let seleccionada = false;
          for (let i = 1; i < alternativas.length; i++) {
            const alt = alternativas[i];
            const altKm = alt.distanciaMetros / 1000;
            const altAlertas = RouteWarningsModule.verificar(alt.geojson, altKm);
            console.log(`  Alt ${i}: ${altAlertas.length} warnings, ${altKm.toFixed(0)} km`);
            if (altAlertas.length === 0) {
              ruta = alt;
              totalKm = altKm;
              seleccionada = true;
              console.log(`  → Seleccionada alternativa ${i}`);
              break;
            }
          }
          if (!seleccionada) console.log('  Ninguna alternativa limpia, se mantiene la ruta principal');
        } catch (err) {
          console.warn('No se pudieron obtener alternativas:', err);
        }
      }

      await aplicarRutaCalculada(ruta);
      // Clean up escala DOM rows (pasan a la lista de paradas)
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      state.escalas.forEach((e) => { delete e._row; });
      renderizarParadas();

      // Limpiar sitios cargados antes de activar la pestaña
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];

      // Activar pestaña Ruta
      el.panelEscalas.hidden = true;
      activarPanelTab('ruta');

      // Enable "Mostrar sitios" button
      _habilitarMostrarSitios();
      _actualizarTextoBotonesOrden();
      el.panelSitios.hidden = true;
      MapModule.limpiarSitios();

      el.checkDistancia.checked = true;
      el.filtroDistancia.value = '5';
      el.filtroDistanciaValor.textContent = '5 km';
      el.filtroDistancia.disabled = false;

      // Volver a la pestaña Ruta en móvil y reiniciar estado de sitios
      if (esMovil()) setMobileTab('ruta');

    } catch (err) {
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
      console.warn('Error al calcular ruta', err);
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
      destino: state.destino,
      excluirIds: state.paradas.map((p) => p.id),
    };
    const sitiosBase = FiltersModule.filtrarSitiosPorRuta(state.sitios, rutaFiltro.geojson, opciones);
    state.sitiosFiltradosBase = sitiosBase;
    conteoCategoriasBase = new Map();
    sitiosBase.forEach((s) => {
      if (!s.categoria) return;
      const c = s.categoria.trim();
      conteoCategoriasBase.set(c, (conteoCategoriasBase.get(c) || 0) + 1);
    });
    let sitiosResultado = sitiosBase;
    if (state.categoriasSeleccionadas.length > 0) {
      const catsNorm = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim()));
      sitiosResultado = sitiosBase.filter((s) => {
        const sc = (s.categoria || '').toLowerCase().trim();
        return catsNorm.has(sc);
      });
    }
    state.sitiosFiltrados = sitiosResultado;
    if (state.modoVisibilidad === 'visibles') {
      renderizarSitios(_filtrarVisibles(sitiosResultado));
    } else {
      renderizarSitios(sitiosResultado);
    }
    renderizarCategoriasMenu();
  }

  function ejecutarFiltradoProgresivo(completado) {
    function terminar() {
      clearInterval(intervaloMensajes);
      if (typeof completado === 'function') completado();
    }
    if (!state.rutaActual) { terminar(); return; }
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const TAMANO_BLOQUE = 150;
    const sitios = state.sitios.filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)));
    const idsExcluidos = new Set(state.paradas.map((p) => p.id));
    const distanciaMax = Number(el.filtroDistancia.value);
    const bbox = FiltersModule.rutaBboxConMargen(rutaFiltro.geojson, distanciaMax);
    const resultados = [];
    const resultadosBase = [];
    const catsNorm = state.categoriasSeleccionadas.length > 0 ? new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim())) : null;
    let idx = 0;
    let indiceMensaje = 0;
    const intervaloMensajes = setInterval(() => {
      indiceMensaje = (indiceMensaje + 1) % el.mensajesCarga.length;
      el.loadingMsg.textContent = el.mensajesCarga[indiceMensaje];
    }, 2000);

    function procesarBloque() {
      try {
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
          if (s.distanciaDestinoKm == null) {
            s.distanciaDestinoKm = FiltersModule.distanciaADestino(s, state.destino);
          }
          resultadosBase.push(s);
          if (catsNorm) {
            const sc = (s.categoria || '').toLowerCase().trim();
            if (!catsNorm.has(sc)) continue;
          }
          resultados.push(s);
        }
        idx = fin;

        if (idx < sitios.length) {
          setTimeout(procesarBloque, 0);
        } else {
          clearInterval(intervaloMensajes);
          resultados.sort((a, b) => (a.distanciaDestinoKm ?? a.distanciaRutaKm) - (b.distanciaDestinoKm ?? b.distanciaRutaKm) || (b.distanciaOrigenKm ?? b.distanciaRutaKm) - (a.distanciaOrigenKm ?? a.distanciaRutaKm));
          conteoCategoriasBase = new Map();
          resultadosBase.forEach((s) => {
            if (!s.categoria) return;
            const c = s.categoria.trim();
            conteoCategoriasBase.set(c, (conteoCategoriasBase.get(c) || 0) + 1);
          });
          state.sitiosFiltradosBase = resultadosBase;
          state.sitiosFiltrados = resultados;
          if (state.modoVisibilidad === 'visibles') {
            renderizarSitios(_filtrarVisibles(resultados));
          } else {
            renderizarSitios(resultados);
          }
          renderizarCategoriasMenu();
          ultimosValoresAplicados.distancia = Number(el.filtroDistancia.value);
          actualizarEstadoBotonesRetry();
          completado();
        }
      } catch (e) {
        terminar();
      }
    }

    setTimeout(procesarBloque, 30);
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
      ponerEnCarga(botonOrigenClic, false);
      actualizarEstadoBotonesRetry();
    }, 15);
  }

  function renderizarSitios(sitios) {
    limpiarPreview();
    MapModule.limpiarSitios();
    el.sitiosLista.innerHTML = '';
    const sitiosOrdenados = ordenarSitios(sitios);
    el.sitiosContador.textContent = String(sitiosOrdenados.length);
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = String(sitiosOrdenados.length);
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = String(sitiosOrdenados.length);

    if (sitiosOrdenados.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      return;
    }

    el.sitiosVacio.hidden = true;
    el.sitiosLista.hidden = false;

    sitiosOrdenados.forEach((sitio) => {
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
  function previsualizarRutaHaciaSitio(sitio, cardEl) {
    if (state.previewSitioId === sitio.id) {
      limpiarPreview();
      TourismModule.ocultarPopupSitio();
      return;
    }
    limpiarPreview();
    MapModule.abrirPopupSitio(sitio.id);
    state.previewSitioId = sitio.id;
    marcarTarjetaActiva(cardEl);
  }

  function marcarTarjetaActiva(cardActiva) {
    el.sitiosLista.querySelectorAll('.sitio-card').forEach((card) => {
      card.classList.toggle('sitio-card--active', card === cardActiva);
    });
  }

  function limpiarPreview() {
    state.previewSitioId = null;
    TourismModule.ocultarPopupSitio();
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

    // Enable drag-to-reroute with current waypoints
    const waypointsCoords = [];
    if (state.origen) waypointsCoords.push([state.origen.lon, state.origen.lat]);
    state.orden.forEach(o => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find(e => e.id === o.id);
        if (e && e.lat != null) waypointsCoords.push([e.lon, e.lat]);
      } else {
        const p = state.paradas.find(p => p.id === o.id);
        if (p) waypointsCoords.push([p.lon, p.lat]);
      }
    });
    if (state.destino) waypointsCoords.push([state.destino.lon, state.destino.lat]);
    MapModule.habilitarArrastreRuta(waypointsCoords, onRutaDragEnd);
    MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
    MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);

    // Verificar advertencias de tramos peligrosos
    try { MapModule.limpiarAlertas(); } catch {}
    try {
      const totalKm = state.rutaActual.distanciaMetros / 1000;
      const alertas = RouteWarningsModule.verificar(state.rutaActual.geojson, totalKm);
      alertas.forEach((a) => {
        const coords = a.ruta.coordenadas;
        let lat, lng;
        if (coords && coords.length >= 2) {
          lng = (coords[0][0] + coords[coords.length - 1][0]) / 2;
          lat = (coords[0][1] + coords[coords.length - 1][1]) / 2;
        } else {
          lat = a.lnglat[1];
          lng = a.lnglat[0];
        }
        MapModule.mostrarAlertaRuta([lat, lng], a.mensaje, a.color);
      });
    } catch {}

    // Alimentar módulo de altimetría (usamos rutaBase para tener elevación)
    state.elevacion = (state.rutaBase && state.rutaBase.elevacion) || null;
    const totalKm = state.rutaBase ? state.rutaBase.distanciaMetros / 1000 : 0;
    const geoPerfil = state.rutaBase ? state.rutaBase.geojson : state.rutaActual.geojson;
    AltimetriaModule.setDatos(geoPerfil, state.elevacion, totalKm);
    if (geoPerfil) {
      const routeLine = turf.lineString(geoPerfil.geometry.coordinates);
      state.escalas.filter(e => e.lat != null).forEach(e => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([e.lon, e.lat]), { units: 'kilometers' });
        e._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm);
      });
      state.paradas.forEach(p => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.lon, p.lat]), { units: 'kilometers' });
        p._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm);
      });
    }

    sincronizarOrden();
    let idxIntermedio = 0;
    state.orden.forEach((o) => {
      const etiqueta = etiquetaIntermedia(idxIntermedio++);
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (e && e.lat != null) e._numero = etiqueta;
      } else {
        const p = state.paradas.find((p) => p.id === o.id);
        if (p) p._numero = etiqueta;
      }
    });
    MapModule.setMarcadoresEscalas(state.escalas);
    MapModule.setMarcadoresParadas(state.paradas);
    MapModule.encuadrar(state.rutaActual.geojson);
    const distTexto = Utils.formatearDistancia(state.rutaActual.distanciaMetros);
    const durTexto = Utils.formatearDuracion(state.rutaActual.duracionSegundos);
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = distTexto;
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = durTexto;
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Re-filtrar sitios después de cambios en la ruta (invalida cachés)
  // -------------------------------------------------------------------
  // -------------------------------------------------------------------
  // Agregar un sitio como desvío (calcula ruta por OSRM ida y vuelta)
  // -------------------------------------------------------------------
  async function agregarParada(sitio, boton) {
    if (boton) ponerEnCarga(boton, true);
    state.paradas.push(sitio);
    const map = MapModule.getMap();
    const center = map.getCenter();
    const zoom = map.getZoom();
    try {
      if (el.checkAutoOrganizar.checked) {
        await organizarAutomaticamente();
      } else {
        await aplicarRutaConDesvios();
        renderizarParadas();
      }
      map.setView(center, zoom, { animate: false });
      limpiarPreview();
      ejecutarFiltrado();
    } finally {
      if (boton) ponerEnCarga(boton, false);
    }
  }

  // -------------------------------------------------------------------
  // Arrastre de tramo en el mapa (reruteo)
  // -------------------------------------------------------------------

  async function onRutaDragEnd(lnglat, segIdx) {
    const [lng, lat] = lnglat;
    const id = 'drag_' + Date.now();
    const escala = { id, lat, lon: lng, nombre: 'Punto intermedio', _dragGenerated: true };

    // Count how many escalas exist up to segIdx in state.orden
    let escalaCount = 0;
    for (let i = 0; i < segIdx && i < state.orden.length; i++) {
      if (state.orden[i]?.tipo === 'escala') escalaCount++;
    }

    // Insert as a waypoint (escala) so OSRM recalculates the route through it
    state.escalas.splice(escalaCount, 0, escala);
    state.orden.splice(segIdx, 0, { tipo: 'escala', id });

    // Invalidate cached distances so sites refilter on next request
    state.sitios.forEach((s) => {
      delete s.distanciaRutaKm;
      delete s.tiempoDesvioMin;
      delete s.distanciaOrigenKm;
      delete s.distanciaDestinoKm;
      delete s._offsetLado;
    });
    MapModule.limpiarSitios();

    await calcularRutaPrincipal(true);
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Sincronizar el orden combinado de escalas + paradas
  // -------------------------------------------------------------------
  function sincronizarOrden() {
    const escalas = state.escalas.filter((e) => e.lat != null);
    const idsEscalas = new Set(escalas.map((e) => e.id));
    const idsParadas = new Set(state.paradas.map((p) => p.id));

    state.orden = state.orden.filter((o) =>
      (o.tipo === 'escala' && idsEscalas.has(o.id)) ||
      (o.tipo === 'parada' && idsParadas.has(o.id))
    );

    const enOrden = new Set(state.orden.map((o) => o.tipo + '_' + o.id));

    let ultimaEscala = -1;
    for (let i = 0; i < state.orden.length; i++) {
      if (state.orden[i].tipo === 'escala') ultimaEscala = i;
    }

    for (const e of escalas) {
      if (!enOrden.has('escala_' + e.id)) {
        state.orden.splice(ultimaEscala + 1, 0, { tipo: 'escala', id: e.id });
        ultimaEscala++;
        enOrden.add('escala_' + e.id);
      }
    }
    for (const p of state.paradas) {
      if (!enOrden.has('parada_' + p.id)) {
        state.orden.push({ tipo: 'parada', id: p.id });
        enOrden.add('parada_' + p.id);
      }
    }
  }

  async function eliminarParada(sitioId) {
    const idx = state.paradas.findIndex((p) => p.id === sitioId);
    if (idx === -1) return;
    state.paradas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      renderizarSitios([]);
      await aplicarRutaConDesvios();
    }
    renderizarParadas();
    MapModule.setMarcadoresParadas(state.paradas);
  }

  function eliminarEscala(id) {
    const idx = state.escalas.findIndex((e) => e.id === id);
    if (idx !== -1) state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      renderizarSitios([]);
      calcularRutaPrincipal(true);
    } else {
      renderizarParadas();
    }
  }

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
  function renderizarParadas() {
    sincronizarOrden();

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

    const total = items.length;
    el.paradasLista.innerHTML = '';
    const incluirExtremos = Boolean(state.rutaActual && state.origen && state.destino);
    el.paradasContador.textContent = String(incluirExtremos ? total : total);
    el.panelParadas.hidden = !incluirExtremos && total === 0;

    function crearFilaExtremo(letra, nombre, tipo) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = letra;

      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      nombreEl.textContent = nombre;

      li.appendChild(num);
      li.appendChild(nombreEl);
      return li;
    }

    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('A', formatMunicipio(state.origen), 'origen'));
    }

    items.forEach((item, idx) => {
      const e = item.datos;
      const li = document.createElement('li');
      li.className = 'parada-item';
      li.dataset.paradaId = e.id;
      li.dataset.tipoParada = item.tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = etiquetaIntermedia(idx);

      const nombre = document.createElement('span');
      nombre.className = 'parada-item__nombre';
      const distEl = document.createElement('span');
      distEl.className = 'parada-item__dist';
      if (e._distKm != null) {
        distEl.textContent = ' — ' + e._distKm.toFixed(1) + ' km';
      }
      nombre.appendChild(document.createTextNode(item.tipo === 'escala' ? formatMunicipio(e) : e.nombre));
      nombre.appendChild(distEl);

      const acciones = document.createElement('div');
      acciones.className = 'parada-item__acciones';

      if (!el.checkAutoOrganizar.checked) {
        if (idx > 0) {
          const btnUp = btnIcono('<polyline points="18 15 12 9 6 15"/>');
          btnUp.title = 'Subir';
          btnUp.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx - 1); });
          acciones.appendChild(btnUp);
        }
        if (idx < total - 1) {
          const btnDown = btnIcono('<polyline points="6 9 12 15 18 9"/>');
          btnDown.title = 'Bajar';
          btnDown.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx + 1); });
          acciones.appendChild(btnDown);
        }
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
      btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

      acciones.appendChild(btnDel);
      li.appendChild(num);
      li.appendChild(nombre);
      li.appendChild(acciones);
      li.addEventListener('click', () => {
        if (item.tipo === 'parada') MapModule.abrirPopupSitio(e.id);
      });
      el.paradasLista.appendChild(li);
    });

    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('Z', formatMunicipio(state.destino), 'destino'));
    }
  }

  async function organizarAutomaticamente() {
    if (!el.checkAutoOrganizar.checked) return;
    if (!state.origen) return;
    sincronizarOrden();
    const itemsConDistancia = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((ee) => ee.id === o.id);
        if (!e || e.lat == null) return null;
        const dist = FiltersModule.distanciaAOrigen(e, state.origen);
        if (dist == null) return null;
        return { ...o, distancia: dist };
      }
      const p = state.paradas.find((pp) => pp.id === o.id);
      if (!p) return null;
      const dist = p.distanciaOrigenKm ?? FiltersModule.distanciaAOrigen(p, state.origen);
      if (dist == null) return { ...o, distancia: Infinity };
      return { ...o, distancia: dist };
    }).filter(Boolean);

    itemsConDistancia.sort((a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity));
    state.orden = itemsConDistancia.map(({ tipo, id }) => ({ tipo, id }));

    const nuevasEscalas = state.orden
      .filter((o) => o.tipo === 'escala')
      .map((o) => state.escalas.find((e) => e.id === o.id))
      .filter(Boolean);
    const nuevasParadas = state.orden
      .filter((o) => o.tipo === 'parada')
      .map((o) => state.paradas.find((p) => p.id === o.id))
      .filter(Boolean);
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);

    if (state.rutaActual) {
      await calcularRutaPrincipal(true);
    }
    renderizarParadas();
  }

  async function reordenar(desde, hasta) {
    if (desde === hasta) return;
    sincronizarOrden();
    if (desde < 0 || desde >= state.orden.length || hasta < 0 || hasta >= state.orden.length) return;
    const movido = state.orden.splice(desde, 1)[0];
    state.orden.splice(hasta, 0, movido);

    const nuevasEscalas = state.orden
      .filter((o) => o.tipo === 'escala')
      .map((o) => state.escalas.find((e) => e.id === o.id))
      .filter(Boolean);
    const nuevasParadas = state.orden
      .filter((o) => o.tipo === 'parada')
      .map((o) => state.paradas.find((p) => p.id === o.id))
      .filter(Boolean);
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);

    if (movido.tipo === 'escala') {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; });
      await calcularRutaPrincipal(true);
    } else {
      await aplicarRutaConDesvios();
    }
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

  // -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);
})();
