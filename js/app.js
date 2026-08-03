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
    aeropuertos: [],
    modoAereo: false,
    tramosAereo: null,
    elevacion: null,
    altimetriaGeo: null,
    altimetriaTotalKm: 0,
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
    btnAereo: document.getElementById('btn-aereo'),

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
    categoriasGrid: document.getElementById('categorias-grid'),


    panelEscalas: document.getElementById('panel-escalas'),
    btnAgregarEscala: document.getElementById('btn-agregar-escala'),
    btnAgregarIntermedio: document.getElementById('btn-agregar-intermedio'),
    panelLocate: document.getElementById('panel-locate'),
    btnTabPanelRuta: document.getElementById('btn-tab-panel-ruta'),
    btnTabPanelDescubre: document.getElementById('btn-tab-panel-descubre'),
    panelDescubreActions: document.getElementById('panel-descubre-actions'),
    sitiosFronteraContador: document.getElementById('sitios-frontera-contador'),

    btnToggleSitiosFloat: document.getElementById('btn-toggle-sitios-float'),
    btnDescubreVisibles: document.getElementById('btn-descubre-visibles-btn'),
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
    btnSeguimientoAltimetria: document.getElementById('btn-seguimiento-altimetria'),
    btnSeguimientoAltimetriaMovil: document.getElementById('btn-seguimiento-altimetria-panel'),
    altimetriaPanel: document.getElementById('altimetria'),
    altimetriaChart: document.getElementById('altimetria-chart'),
    altimetriaPanelMovil: document.getElementById('altimetria-panel'),
    altimetriaChartMovil: document.getElementById('altimetria-chart-panel'),
  };

  const LETRAS_RUTA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  // Overlay de prueba de sitios de frontera (tecla F para ocultarlos/mostrarlos).
  let _fronteraVisibles = false;

  function _syncFrontera() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresFrontera) return;
    if (_fronteraVisibles) {
      MapModule.setMarcadoresFrontera(state.sitios.filter((s) => s.frontera));
    } else {
      MapModule.limpiarSitiosFrontera();
    }
  }

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
  }

  function aplicarOrdenSitios(orden) {
    state.ordenSitios = orden;
    actualizarBotonesOrden();
    _actualizarEstadoBotonesDescubre();
    renderizarSitios(state.modoVisibilidad === 'visibles' ? _filtrarVisibles(state.sitiosFiltrados) : state.sitiosFiltrados);
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

  function _prepararCoordenadasParaElevacion(coords, maxPuntos = 50) {
    const total = coords.length;
    if (total <= maxPuntos) {
      return {
        coordenadas: coords.map((c) => [c[1], c[0]]),
        indices: coords.map((_, i) => i),
      };
    }
    const step = Math.ceil(total / maxPuntos);
    const coordenadas = [];
    const indices = [];
    for (let i = 0; i < total; i += step) {
      coordenadas.push([coords[i][1], coords[i][0]]);
      indices.push(i);
    }
    if (indices[indices.length - 1] !== total - 1) {
      coordenadas.push([coords[total - 1][1], coords[total - 1][0]]);
      indices.push(total - 1);
    }
    return { coordenadas, indices };
  }

  function _reconstruirElevacion(elevaciones, indices, totalCoords) {
    const result = new Array(totalCoords).fill(null);
    for (let i = 0; i < indices.length; i++) {
      result[indices[i]] = elevaciones[i];
    }
    let lastKnown = -1;
    for (let i = 0; i < result.length; i++) {
      if (result[i] != null) {
        if (lastKnown >= 0 && i > lastKnown + 1) {
          const start = result[lastKnown];
          const end = result[i];
          const span = i - lastKnown;
          for (let j = lastKnown + 1; j < i; j++) {
            result[j] = start + (end - start) * ((j - lastKnown) / span);
          }
        }
        lastKnown = i;
      }
    }
    return result;
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
      const ocultarTestigo = !state.rutaActual || _soMostrarSitiosVisto;
      el.btnMostrarSitiosCercanos.hidden = ocultarTestigo;
      el.btnMostrarSitiosCercanos.disabled = ocultarTestigo;
      sincronizarModoRutaMovil();
    } else {
      el.btnTabPanelDescubre.classList.add('panel-tab--active');
      el.panelLocate.hidden = true;
      el.panelEscalas.hidden = true;
      el.panelParadas.hidden = true;
      el.panelDescubreActions.hidden = false;
      el.panelSitios.hidden = false;
      el.btnMostrarSitiosCercanos.hidden = true;
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
  async function init() {
    MapModule.init('map');
    MapModule.setOnEliminarParada(eliminarParada);
    MapModule.setOnMenuPuntoDesvio(abrirMenuPuntoDesvio);
    MapModule.setOnMoverPuntoDesvio(moverPuntoDesvio);
    TourismModule.setOnAgregarParada((sitio, btn) => agregarParada(sitio, btn));
    MapModule.setOnTramoCompletado(onTramoMarcado);
    MapModule.setOnClicMarcadorExtremo((tipo) => {
      const extremo = tipo === 'origen' ? state.origen : state.destino;
      if (extremo) mostrarCuadroExtremo(tipo, extremo.nombre || '', extremo.departamento || '');
    });

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

      // Cargar aeropuertos (opción de desplazamiento aéreo)
      state.aeropuertos = [];
      try {
        const resAer = await fetch('data/aeropuertos_colombia.json');
        if (resAer.ok) state.aeropuertos = await resAer.json();
      } catch {}
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

    // Mostrar todos los sitios de frontera (tecla F los oculta/muestra).
    _syncFrontera();
    document.addEventListener('keydown', (evt) => {
      if (evt.key.toLowerCase() === 'f' && !evt.ctrlKey && !evt.metaKey && !evt.altKey) {
        const esInput = evt.target && evt.target.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(evt.target.tagName);
        if (esInput) return;
        _fronteraVisibles = !_fronteraVisibles;
        _syncFrontera();
      }
    });
  }

  // -------------------------------------------------------------------
  // Combos de búsqueda (origen / destino)
  // -------------------------------------------------------------------
  function initCombos() {
    setupCombo(el.origenInput, el.origenList, (m) => {
      state.origen = m;
      _limpiarTurfYListado();
      actualizarEstadoBotonCalcular();
      _actualizarTextoBotonesOrden();
    }, () => {
      const ids = new Set();
      if (state.destino?.id) ids.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, true);
    setupCombo(el.destinoInput, el.destinoList, (m) => {
      state.destino = m;
      _limpiarTurfYListado();
      actualizarEstadoBotonCalcular();
      _actualizarTextoBotonesOrden();
    }, () => {
      const ids = new Set();
      if (state.origen?.id) ids.add(state.origen.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, false);
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
          if (esMovil()) trigger.blur();
    ponerEnCargaRuta(true, opciones.silencioso);
          cerrarAltimetria();
          AltimetriaModule.limpiar();
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude: lat, longitude: lon } = pos.coords;
              const nombre = 'Mi ubicación';
              trigger.value = nombre;
              trigger.dataset.selectedId = 'gps_' + Date.now();
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
        reposicionarInterfazTeclado(false);
        if (esMovil()) trigger.blur();
        iniciarSeleccionMapa((lat, lon) => {
          const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          trigger.value = nombre;
          trigger.dataset.selectedId = 'map_' + Date.now();
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
            seleccionar(municipios[0]);
          } else {
            renderMunicipios();
          }
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
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
          seleccionar(m);
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    function cerrar() {
      listEl.hidden = true;
    }

    function resaltar(idx) {
      const items = [...listEl.querySelectorAll('li:not(.combo__back):not(.no-results)')];
      items.forEach((li, i) => {
        if (i === idx) { li.setAttribute('aria-selected', 'true'); li.scrollIntoView({ block: 'nearest' }); }
        else li.removeAttribute('aria-selected');
      });
    }

    function seleccionar(m) {
      listEl.hidden = true;
      trigger.value = formatMunicipio(m);
      trigger.dataset.selectedId = m.id;
      reposicionarInterfazTeclado(false);
      onSelect(m);
      // En móvil ya no se escribe nada: se quita el foco para ocultar el
      // teclado y el cursor. En escritorio se conserva el foco (Enter calcula).
      if (esMovil()) trigger.blur();
    }

    function renderFiltrados(texto) {
      deptoSeleccionado = null;
      listEl.innerHTML = '';
      const idsExcluidos = excluirIdsFn ? excluirIdsFn() : new Set();
      const q = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const munis = state.municipios.filter((m) => {
        if (idsExcluidos.has(m.id)) return false;
        const nom = m.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const dep = m.departamento.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return nom.includes(q) || dep.includes(q);
      }).slice(0, 100);
      if (munis.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-results';
        li.textContent = 'Sin resultados';
        listEl.appendChild(li);
      } else {
        munis.forEach((m) => {
          const li = document.createElement('li');
          li.textContent = m.nombre + ' (' + m.departamento + ')';
          li.addEventListener('click', (e) => { e.stopPropagation(); seleccionar(m); });
          listEl.appendChild(li);
        });
      }
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    function abrir() {
      const texto = trigger.value.trim();
      if (trigger.dataset.selectedId) {
        trigger.value = '';
        delete trigger.dataset.selectedId;
        renderDepartamentos();
      } else if (texto) {
        renderFiltrados(texto);
      } else {
        renderDepartamentos();
      }
      ajustarComboAlTeclado(trigger, listEl);
    }

    trigger.addEventListener('focus', (e) => {
      e.stopPropagation();
      abrir();
    });

    trigger.addEventListener('input', () => {
      const texto = trigger.value.trim();
      if (texto) {
        renderFiltrados(texto);
      } else {
        renderDepartamentos();
      }
      delete trigger.dataset.selectedId;
    });

    trigger.addEventListener('blur', () => {
      setTimeout(() => { cerrar(); }, 200);
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { cerrar(); e.preventDefault(); return; }
      if (e.key === 'Enter' && listEl.hidden) {
        if (trigger.dataset.selectedId) {
          const otro = trigger.id === 'origen-input' ? state.destino : state.origen;
          if (otro && otro.id) {
            e.preventDefault();
            calcularRutaPrincipal(false);
          }
        }
        return;
      }
      if (listEl.hidden) return;
      const items = [...listEl.querySelectorAll('li:not(.combo__back):not(.no-results)')];
      if (items.length === 0) return;
      let cur = items.findIndex((li) => li.hasAttribute('aria-selected'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cur = Math.min(cur + 1, items.length - 1);
        resaltar(cur);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cur = Math.max(cur - 1, 0);
        resaltar(cur);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = items.find((li) => li.hasAttribute('aria-selected')) || items[0];
        if (sel) sel.click();
      }
    });

    listEl.addEventListener('mousedown', (e) => { e.preventDefault(); });

    document.addEventListener('click', (e) => {
      if (!combo.contains(e.target)) { cerrar(); trigger.blur(); }
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
    const trigger = document.createElement('input');
    trigger.type = 'search';
    trigger.className = 'combo__trigger escala-trigger';
    trigger.placeholder = 'Pueblo intermedio';
    trigger.autocomplete = 'one-time-code';
    trigger.autocorrect = 'off';
    trigger.autocapitalize = 'off';
    trigger.spellcheck = false;
    const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('class', 'combo__chevron');
    chevron.setAttribute('viewBox', '0 0 24 24');
    chevron.setAttribute('width', '12');
    chevron.setAttribute('height', '12');
    chevron.setAttribute('fill', 'none');
    chevron.setAttribute('stroke', 'currentColor');
    chevron.setAttribute('stroke-width', '2.5');
    chevron.setAttribute('stroke-linecap', 'round');
    chevron.innerHTML = '<path d="M6 9l6 6 6-6"/>';
    const listEl = document.createElement('ul');
    listEl.className = 'combo__list';
    listEl.role = 'listbox';
    listEl.hidden = true;
    combo.appendChild(trigger);
    combo.appendChild(chevron);
    combo.appendChild(listEl);

    const calcBtn = document.createElement('button');
    calcBtn.type = 'button';
    calcBtn.className = 'escala-row__calc';
    calcBtn.title = 'Calcular ruta con este pueblo intermedio';
    calcBtn.setAttribute('aria-label', 'Calcular ruta con este pueblo intermedio');
    calcBtn.innerHTML = `
      <svg class="icon-btn__icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
      <span class="icon-btn__spinner" aria-hidden="true"></span>`;

    row.appendChild(combo);
    row.appendChild(calcBtn);
    el.panelEscalas.appendChild(row);
    el.panelEscalas.hidden = false;
    setTimeout(() => {
      trigger.focus();
      trigger.scrollIntoView({ block: 'nearest' });
    }, 50);

    let seleccion = null;

    function seleccionar(m) {
      listEl.hidden = true;
      trigger.value = formatMunicipio(m);
      trigger.dataset.selectedId = m.id;
      seleccion = m;
      reposicionarInterfazTeclado(false);
      actualizarEscalas();
      // El cuadro solo se oculta cuando los cuadros de origen/destino ya no
      // están en pantalla (ruta calculada); al inicio permanece visible.
      row.style.display = el.appRoot && el.appRoot.getAttribute('data-ruta-lista') === 'true' ? 'none' : '';
      if (el.checkAutoOrganizar.checked) organizarAutomaticamente(true);
    }

    function resaltar(idx) {
      const items = [...listEl.querySelectorAll('li:not(.combo__back):not(.no-results)')];
      items.forEach((li, i) => {
        if (i === idx) { li.setAttribute('aria-selected', 'true'); li.scrollIntoView({ block: 'nearest' }); }
        else li.removeAttribute('aria-selected');
      });
    }

    function renderFiltrados(texto) {
      seleccion = null;
      listEl.innerHTML = '';
      const idsNoDisponibles = new Set();
      if (state.origen?.id) idsNoDisponibles.add(state.origen.id);
      if (state.destino?.id) idsNoDisponibles.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null && e._row !== row) idsNoDisponibles.add(e.id); });
      const q = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const munis = state.municipios.filter((m) => {
        if (idsNoDisponibles.has(m.id)) return false;
        const nom = m.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const dep = m.departamento.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return nom.includes(q) || dep.includes(q);
      }).slice(0, 100);
      if (munis.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-results';
        li.textContent = 'Sin resultados';
        listEl.appendChild(li);
      } else {
        munis.forEach((m) => {
          const li = document.createElement('li');
          li.textContent = m.nombre + ' (' + m.departamento + ')';
          li.addEventListener('click', (e) => { e.stopPropagation(); seleccionar(m); });
          listEl.appendChild(li);
        });
      }
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    function renderDeptos() {
      seleccion = null;
      listEl.innerHTML = '';
      const pickLi = document.createElement('li');
      pickLi.textContent = 'Seleccionar en el mapa';
      pickLi.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.hidden = true;
        reposicionarInterfazTeclado(false);
        if (esMovil()) trigger.blur();
        iniciarSeleccionMapa((lat, lon) => {
          const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          trigger.value = nombre;
          trigger.dataset.selectedId = 'map_' + Date.now();
          seleccion = { id: 'map_' + Date.now(), lat, lon, nombre, departamento: '' };
          actualizarEscalas();
          row.style.display = el.appRoot && el.appRoot.getAttribute('data-ruta-lista') === 'true' ? 'none' : '';
          if (el.checkAutoOrganizar.checked) organizarAutomaticamente(true);
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
      resaltar(0);
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
        li.addEventListener('click', (e) => { e.stopPropagation(); seleccionar(m); });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    function abrir() {
      const texto = trigger.value.trim();
      if (trigger.dataset.selectedId) {
        trigger.value = '';
        delete trigger.dataset.selectedId;
        renderDeptos();
      } else if (texto) {
        renderFiltrados(texto);
      } else {
        renderDeptos();
      }
      ajustarComboAlTeclado(trigger, listEl);
    }

    trigger.addEventListener('focus', (e) => { e.stopPropagation(); abrir(); });
    trigger.addEventListener('input', () => {
      const texto = trigger.value.trim();
      if (texto) { renderFiltrados(texto); } else { renderDeptos(); }
      delete trigger.dataset.selectedId;
    });
    trigger.addEventListener('blur', () => { setTimeout(() => { listEl.hidden = true; }, 200); });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { listEl.hidden = true; e.preventDefault(); return; }
      if (e.key === 'Enter' && listEl.hidden) {
        if (trigger.dataset.selectedId) {
          e.preventDefault();
          actualizarEscalas();
          calcularRutaPrincipal(false, { ocultarTestigoSitios: true });
        }
        return;
      }
      if (listEl.hidden) return;
      const items = [...listEl.querySelectorAll('li:not(.combo__back):not(.no-results)')];
      if (items.length === 0) return;
      let cur = items.findIndex((li) => li.hasAttribute('aria-selected'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cur = Math.min(cur + 1, items.length - 1);
        resaltar(cur);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cur = Math.max(cur - 1, 0);
        resaltar(cur);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = items.find((li) => li.hasAttribute('aria-selected')) || items[0];
        if (sel) sel.click();
      }
    });
    listEl.addEventListener('mousedown', (e) => { e.preventDefault(); });
    document.addEventListener('click', function onClickOutside(e) {
      if (!row.contains(e.target)) { listEl.hidden = true; }
    });

    calcBtn.addEventListener('click', () => {
      actualizarEscalas();
      calcularRutaPrincipal(false, { ocultarTestigoSitios: true });
    });

    state.escalas.push({ _row: row });
    return row;
  }

  async function actualizarEscalas() {
    state.escalas.forEach((e) => {
      if (!e._row) return;
      const input = e._row.querySelector('.combo__trigger');
      if (!input || !input.value.trim()) return;
      const nombre = input.dataset.selectedId ? input.value.trim() : null;
      if (!nombre) return;
      const m = state.municipios.find((mun) => mun.nombre === nombre || (mun.nombre + ', ' + mun.departamento) === nombre);
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
    if (el.btnAereo) {
      el.btnAereo.addEventListener('click', () => {
        // El avión siempre calcula la ruta aérea (volver a carretera = botón calcular).
        calcularRutaAerea();
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
      el.btnAgregarIntermedio.addEventListener('click', () => agregarPuebloIntermedioDesdeLista());
    }
    el.checkAutoOrganizar.addEventListener('change', () => {
      if (el.checkAutoOrganizar.checked) {
        organizarAutomaticamente(state.escalas.some((e) => e.lat != null) || state.paradas.length > 0);
      }
      renderizarParadas();
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
          renderizarSitios(_filtrarVisibles(state.sitiosFiltrados));
        }
      });

      // Marcador temporal para hover del perfil de altimetría
      let _hoverMarker = null;
      AltimetriaModule.setOnHover((p) => {
        if (!_hoverMarker) {
          _hoverMarker = L.circleMarker([p.lat, p.lon], {
            radius: 6, fillColor: '#246054', color: '#fff', weight: 2,
            fillOpacity: 1, pane: 'tooltipPane',
          }).addTo(_map);
        } else {
          _hoverMarker.setLatLng([p.lat, p.lon]);
        }
        _hoverMarker.bindTooltip(`${p.alt} msnm · ${p.dist} km`, {
          permanent: true, direction: 'top', className: 'altimetria-map-tooltip',
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
        _map.panTo([data.lat, data.lon], { animate: true });
      });

      document.getElementById('btn-cerrar-altimetria')?.addEventListener('click', () => {
        if (_hoverMarker) { _hoverMarker.remove(); _hoverMarker = null; }
      });

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
  function esMovil() {
    return window.matchMedia(MEDIA_MOVIL).matches;
  }

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
  // Se espera a que el teclado se asiente para no aplicar un transform
  // intermedio (eso dejaba un hueco en blanco bajo el bloque).
  let _reposActivo = false;
  let _reposTimer = null;

  function reposicionarInterfazTeclado(activar) {
    const app = el.appRoot;
    const restaurar = () => {
      app.classList.remove('teclado-abierto');
      app.style.removeProperty('--teclado-alto');
    };
    _reposActivo = Boolean(activar);
    clearTimeout(_reposTimer);
    if (!_reposActivo) {
      restaurar();
      _ajustarListasAbiertas();
      return;
    }
    const aplicar = () => {
      if (!_reposActivo || !esMovil()) {
        restaurar();
        return;
      }
      const cubierto = _tecladoCubierto();
      if (cubierto <= 0) {
        restaurar();
        return;
      }
      app.style.setProperty('--teclado-alto', cubierto + 'px');
      app.classList.add('teclado-abierto');
    };
    aplicar();
    // Las listas se reposicionan solo cuando el teclado ya se asentó (400 ms
    // desde el último evento): durante la animación el bloque y sus listas
    // suben juntos con el transform (la transición suaviza el movimiento) y
    // redecidir la dirección en cada evento haría parpadear la lista.
    _reposTimer = setTimeout(() => { aplicar(); _ajustarListasAbiertas(); }, 400);
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
      return Math.round(window.innerHeight - (window.visualViewport.height + window.visualViewport.offsetTop));
    }
    return 0;
  }

  const esTriggerCombo = (t) => Boolean(t && t.classList && t.classList.contains('combo__trigger'));

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
    if (esTriggerCombo(e.target)) reposicionarInterfazTeclado(true);
  });
  document.addEventListener('focusout', (e) => {
    if (!esTriggerCombo(e.relatedTarget)) reposicionarInterfazTeclado(false);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (esTriggerCombo(document.activeElement)) reposicionarInterfazTeclado(true);
      else reposicionarInterfazTeclado(false);
    });
    window.visualViewport.addEventListener('scroll', () => {
      if (esTriggerCombo(document.activeElement)) reposicionarInterfazTeclado(true);
    });
  }
  if (navigator.virtualKeyboard && typeof navigator.virtualKeyboard.addEventListener === 'function') {
    navigator.virtualKeyboard.addEventListener('geometrychange', () => {
      if (esTriggerCombo(document.activeElement)) reposicionarInterfazTeclado(true);
      else reposicionarInterfazTeclado(false);
    });
  }

  /** Reubica las listas de opciones abiertas tras un cambio del teclado (el
   *  bloque sube o baja con transform, que no dispara `resize`) y asegura que
   *  el cuadro enfocado quede dentro del área visible. */
  function _ajustarListasAbiertas() {
    document.querySelectorAll('.combo__list:not([hidden])').forEach((l) => {
      const trig = l.parentElement && l.parentElement.querySelector('.combo__trigger');
      ajustarComboAlTeclado(trig, l);
    });
    _garantizarTriggerVisible();
  }

  /** Tras levantar el bloque, asegura que el cuadro enfocado quede dentro del
   *  área visible (sobre el teclado) desplazando su contenedor scrolleable.
   *  Necesario al crear un pueblo intermedio con el "+": el auto-scroll de la
   *  fila nueva se calcula sin teclado y la fila quedaría oculta bajo él. */
  function _garantizarTriggerVisible() {
    const act = document.activeElement;
    if (!esTriggerCombo(act)) return;
    const altoVisible = window.innerHeight - _tecladoCubierto();
    const r = act.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= altoVisible) return;
    let cont = act.parentElement;
    while (cont && cont !== el.appRoot && cont !== document.body) {
      if (cont.scrollHeight > cont.clientHeight) break;
      cont = cont.parentElement;
    }
    if (!cont || cont === el.appRoot || cont === document.body) return;
    if (r.bottom > altoVisible) cont.scrollTop += r.bottom - altoVisible + 8;
    else if (r.top < 0) cont.scrollTop += r.top - 8;
  }

  /** En móvil, coloca la lista de opciones del cuadro sin que el teclado la
   *  corte: se abre hacia abajo si hay sitio y hacia arriba si no. El alto
   *  visible se mide restando lo que tapa el teclado del layout (funciona
   *  también en pantalla completa, donde visualViewport no cambia). El cuadro
   *  enfocado lo sube el bloque completo (teclado-abierto), por eso aquí no se
   *  usa scrollIntoView: sumado al transform subiría el cuadro fuera de la
   *  pantalla. */
  function ajustarComboAlTeclado(trigger, listEl) {
    if (!esMovil() || !listEl) return;
    if (!trigger) {
      listEl.style.maxHeight = '';
      listEl.style.top = '';
      listEl.style.bottom = '';
      return;
    }
    const altoVisible = window.innerHeight - _tecladoCubierto();
    const espacioAbajo = altoVisible - trigger.getBoundingClientRect().bottom;
    if (espacioAbajo < 180) {
      listEl.style.top = 'auto';
      listEl.style.bottom = 'calc(100% + 6px)';
    } else {
      listEl.style.top = 'calc(100% + 6px)';
      listEl.style.bottom = 'auto';
    }
    listEl.style.maxHeight = '170px'; // 5 elementos
  }

  window.addEventListener('resize', _ajustarListasAbiertas);

  function garantizarVisibilidadMovil() {
    if (esMovil()) {
      if (el.mobileTabBar) el.mobileTabBar.removeAttribute('hidden');
      setTimeout(() => MapModule.invalidateSize(), 50);
    }
  }

  window.addEventListener('resize', garantizarVisibilidadMovil);

  let ultimosValoresAplicados = { distancia: null, tiempo: null };
  let conteoCategoriasBase = null;
  let _soMostrarSitiosVisto = false;

  /** Habilita/deshabilita todos los controles de entrada durante el cálculo de ruta. */
  function ponerEnCargaRuta(cargando, silencioso = false) {
    if (cargando) el.btnCalcular.disabled = true;
    el.btnCalcular.setAttribute('data-loading', cargando ? 'true' : 'false');
    if (el.btnAereo) el.btnAereo.disabled = cargando;
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

  let _calculandoListado = 0;
  let _listadoParaGeojson = null; // referencia de la ruta con la que se calculó el listado

  /** Calcula el listado de sitios de la pestaña Descubre solo si aún no hay listado. */
  function _asegurarListadoSitios(silencioso = false) {
    if (!state.rutaActual) { _syncBotonSitios(); return; }
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const geojsonListado = rutaFiltro ? rutaFiltro.geojson : null;
    if (state.sitiosFiltrados.length > 0) {
      if (silencioso) _syncBotonSitios();
      // Si el listado corresponde a otra ruta (ruta recalculada), se recalcula.
      if (_listadoParaGeojson === geojsonListado) return;
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
    }
    if (_calculandoListado) {
      // Si quedó atascado (p. ej. cerraron la pestaña a mitad de carga) se reintenta.
      if (Date.now() - _calculandoListado > 30000) _calculandoListado = 0;
      else return;
    }
    _calculandoListado = Date.now();

    el.checkDistancia.checked = true;
    el.filtroDistancia.disabled = false;
    el.filtroDistancia.value = '5';
    el.filtroDistanciaValor.textContent = '5 km';
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    if (el.icoDescubreTab) el.icoDescubreTab.hidden = true;
    if (el.icoDescubreTabDesktop) el.icoDescubreTabDesktop.hidden = true;
    if (el.sitiosContadorTab) el.sitiosContadorTab.hidden = false;
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.hidden = false;
    if (el.loadingRuta) el.loadingRuta.hidden = true;
    el.loadingSitios.hidden = false;
    if (!silencioso) el.panelSitios.hidden = false;
    ejecutarFiltradoProgresivo(() => {
      _calculandoListado = 0;
      _listadoParaGeojson = geojsonListado;
      el.loadingSitios.hidden = true;
      actualizarEstadoBotonesRetry();
      if (silencioso) {
        el.panelSitios.hidden = true;
        _syncBotonSitios();
      } else {
        el.panelSitios.hidden = false;
      }
    });
  }

  function formatMunicipio(m) {
    if (!m || !m.nombre) return '';
    if (m.nombre === 'Bogotá D.C.' || !m.departamento) return m.nombre;
    return m.nombre + ', ' + m.departamento;
  }

  /** Sincroniza el botón redondo de "sitios visibles" con el modo de visibilidad actual. */
  function _sincronizarBotonVisibles() {
    if (!el.btnDescubreVisibles) return;
    const activo = state.modoVisibilidad === 'visibles';
    el.btnDescubreVisibles.setAttribute('aria-pressed', String(activo));
    el.btnDescubreVisibles.classList.toggle('descubre-btn--active', activo);
  }

  /** Limpia el listado de la pestaña Descubre cuando cambia el trazado de la ruta. */
  function _borrarListadoDescubre() {
    state.sitiosFiltrados = [];
    state.sitiosFiltradosBase = [];
    state.modoVisibilidad = 'completa';
    conteoCategoriasBase = new Map();
    _sincronizarBotonVisibles();
    _actualizarEstadoBotonesDescubre();
    _syncBotonSitios();
    if (el.panelSitios) el.panelSitios.hidden = true;
    if (el.sitiosVacio) el.sitiosVacio.textContent = '';
    if (el.sitiosContador) el.sitiosContador.textContent = '0';
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = '0';
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = '0';
  }

  /** Alterna el filtro "solo sitios visibles": activo filtra, inactivo muestra la lista completa. */
  function toggleSitiosVisibles() {
    if (!state.rutaActual) return;

    if (state.modoVisibilidad === 'visibles') {
      state.modoVisibilidad = 'completa';
    } else {
      state.modoVisibilidad = 'visibles';
    }
    _sincronizarBotonVisibles();

    const fuente = state.sitiosFiltrados.length ? state.sitiosFiltrados : state.sitiosFiltradosBase;
    if (!fuente.length) {
      _asegurarListadoSitios();
      return;
    }
    if (state.modoVisibilidad === 'visibles') {
      renderizarSitios(_filtrarVisibles(fuente));
    } else {
      renderizarSitios(fuente);
    }
  }

  async function toggleAltimetria() {
    if (!el.altimetriaPanel) return;
    const active = !el.altimetriaPanel.hidden;
    if (active) { cerrarAltimetria(); return; }
    el.altimetriaPanel.hidden = false;
    if (el.btnAltimetria) el.btnAltimetria.hidden = true;
    await _cargarElevacionAltimetria('altimetria-chart');
  }

  function cerrarAltimetria() {
    if (!el.altimetriaPanel) return;
    el.altimetriaPanel.hidden = true;
    if (el.btnAltimetria) el.btnAltimetria.hidden = false;
  }

  async function _cargarElevacionAltimetria(containerId) {
    const chart = document.getElementById(containerId);
    if (!chart) return;
    if (!state.elevacion || !state.elevacion.some((e) => e != null)) {
      chart.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:12px;color:var(--text-muted);font-size:0.85rem;"><svg class="spinner-bike" viewBox="0 0 48 30" style="width:120px;height:75px;"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"><g transform="translate(9.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(24,19)"><g class="spinner-bike_pedals-spin" stroke-dasharray="25.133 25.133" stroke-dashoffset="-21.991" transform="rotate(67.5,0,0)"><circle class="spinner-bike_pedals" r="4"></circle><circle class="spinner-bike_pedals" r="4" transform="rotate(180,0,0)"></circle></g></g><g transform="translate(38.5,19)"><circle class="spinner-bike_tire" r="9" stroke-dasharray="56.549 56.549"></circle><g class="spinner-bike_spokes-spin" stroke-dasharray="31.416 31.416" stroke-dashoffset="-23.562"><circle class="spinner-bike_spokes" r="5"></circle><circle class="spinner-bike_spokes" r="5" transform="rotate(180,0,0)"></circle></g></g><polyline class="spinner-bike_seat" points="14 3,18 3" stroke-dasharray="5 5"></polyline><polyline class="spinner-bike_body" points="16 3,24 19,9.5 19,18 8,34 7,24 19" stroke-dasharray="79 79"></polyline><path class="spinner-bike_handlebars" d="m30,2h6s1,0,1,1-1,1-1,1" stroke-dasharray="10 10"></path><polyline class="spinner-bike_front" points="32.5 2,38.5 19" stroke-dasharray="19 19"></polyline></g></svg><span>Consultando datos de elevación…</span></div>';
      const geo = state.altimetriaGeo;
      if (geo && geo.geometry && geo.geometry.coordinates) {
        try {
          const coords = geo.geometry.coordinates;
          const { coordenadas, indices } = _prepararCoordenadasParaElevacion(coords);
          const elevBatch = await Utils.obtenerElevacionBatch(coordenadas);
          if (elevBatch.some((e) => e != null)) {
            state.elevacion = _reconstruirElevacion(elevBatch, indices, coords.length);
            AltimetriaModule.setDatos(geo, state.elevacion, state.altimetriaTotalKm, false);
          }
        } catch (err) {
          console.warn('[ALT] Error al cargar elevación:', err.message);
        }
      }
    }
    AltimetriaModule.renderizar(containerId);
  }

  // -------------------------------------------------------------------
  // Cálculo de la ruta principal (solo al pulsar el botón)
  // -------------------------------------------------------------------
  async function calcularRutaPrincipal(conservarParadas = false, opciones = {}) {
    if (!state.origen || !state.destino) return;
    // Al agregar/reordenar paradas la altimetría abierta se mantiene.
    if (!opciones.conservarAltimetria) cerrarAltimetria();

    // Recalculo interno en modo aéreo: no se vuelve a consultar OSRM por carretera,
    // solo se redibuja la ruta aérea y se actualizan paradas/perfil.
    if (conservarParadas && state.modoAereo) {
      ponerEnCargaRuta(true, true);
      try {
        await aplicarRutaConDesvios({ mantenerMapa: true, conservarAltimetria: true });
        renderizarParadas();
      } catch (err) {
        console.warn('Error al recalcular ruta aérea', err);
      } finally {
        ponerEnCargaRuta(false);
        sincronizarModoRutaMovil();
      }
      return;
    }

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
      state.modoAereo = false;
      state.tramosAereo = null;
      _actualizarBotonAereo();
      state.elevacion = null;
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
    }

    ponerEnCargaRuta(true);

    try {
      const puntosRuta = [state.origen, ...state.escalas.filter((e) => e.lat != null), state.destino];
      const usarConParadas = puntosRuta.length > 2;
      let ruta;
      try {
        ruta = usarConParadas
          ? await RoutingModule.calcularRutaConParadas(puntosRuta, PERFIL_FIJO)
          : await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);
      } catch (err) {
        // Sin ruta por carretera (p. ej. San Andrés): se usa la ruta aérea.
        console.warn('Ruta por carretera no disponible, usando ruta aérea:', err.message);
        await calcularRutaAerea();
        return;
      }

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

      await aplicarRutaCalculada(ruta, { mantenerMapa: Boolean(conservarParadas) || opciones.mantenerMapa });
      // Clean up escala DOM rows (pasan a la lista de paradas)
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      state.escalas.forEach((e) => { delete e._row; });
      renderizarParadas();

      if (!conservarParadas) {
        // Limpiar sitios cargados antes de activar la pestaña
        state.sitiosFiltrados = [];
        state.sitiosFiltradosBase = [];
        state.modoVisibilidad = 'completa';
        _sincronizarBotonVisibles();

        // Activar pestaña Ruta
        el.panelEscalas.hidden = true;
        activarPanelTab('ruta');

        // Volver a la pestaña Ruta en móvil antes de activar el testigo
        if (esMovil()) setMobileTab('ruta');

        // Enable "Mostrar sitios" button (excepto al calcular desde un pueblo intermedio)
        if (opciones.ocultarTestigoSitios) {
          if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
          if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
        } else {
          _habilitarMostrarSitios();
        }
        _actualizarTextoBotonesOrden();
        el.panelSitios.hidden = true;
        MapModule.limpiarSitios();

        el.checkDistancia.checked = true;
        el.filtroDistancia.value = '5';
        el.filtroDistanciaValor.textContent = '5 km';
        el.filtroDistancia.disabled = false;

        // Ocultar definitivamente el testigo "Mostrar sitios" al calcular desde un pueblo intermedio
        if (opciones.ocultarTestigoSitios) {
          el.btnMostrarSitiosCercanos.hidden = true;
          el.btnMostrarSitiosCercanos.disabled = true;
        }
      } else {
        // Ruta recalculada tras añadir/eliminar/reordenar paradas o escalas:
        // se mantiene el estado de la pestaña Descubre y se desbloquea de nuevo.
        _actualizarTextoBotonesOrden();
        if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
        if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
      }

    } catch (err) {
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
      console.warn('Error al calcular ruta', err);
    } finally {
      ponerEnCargaRuta(false);
      sincronizarModoRutaMovil();
    }
  }

  async function aplicarRutaCalculada(ruta, opciones = {}) {
    state.rutaBase = ruta;
    await aplicarRutaConDesvios(opciones);
  }

  // -------------------------------------------------------------------
  // Ruta aérea (avión): tramos en carro hasta/desde los aeropuertos + vuelo
  // -------------------------------------------------------------------

  function _normTexto(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  /** Devuelve el aeropuerto más cercano a un punto (prioriza el de su misma ciudad). */
  function _aeropuertoMasCercano(punto) {
    if (!punto || !state.aeropuertos || !state.aeropuertos.length) return null;
    const nombre = _normTexto(punto.nombre);
    let porCiudad = null, porCiudadDist = Infinity;
    let porDist = null, porDistVal = Infinity;
    for (const ap of state.aeropuertos) {
      const dist = turf.distance(turf.point([punto.lon, punto.lat]), turf.point([ap.longitud, ap.latitud]), { units: 'kilometers' });
      if (dist < porDistVal) { porDistVal = dist; porDist = ap; }
      if (nombre && _normTexto(ap.ciudad_origen) === nombre && dist < porCiudadDist) {
        porCiudadDist = dist;
        porCiudad = ap;
      }
    }
    return porCiudad || porDist;
  }

  /** Busca un aeropuerto hub al que ambos aeropuertos tengan vuelos directos (prefiere Bogotá). */
  function _encontrarHub(apOri, apDes) {
    if (!state.aeropuertos) return null;
    const dOri = new Set((apOri.destinos || []).map((d) => _normTexto(d)));
    const dDes = new Set((apDes.destinos || []).map((d) => _normTexto(d)));
    if (!dOri.size || !dDes.size) return null;
    const sirve = (ap) => {
      const c = _normTexto(ap.ciudad_origen);
      return dOri.has(c) && dDes.has(c);
    };
    const bogo = state.aeropuertos.find((a) => _normTexto(a.ciudad_origen) === 'bogota');
    if (bogo && sirve(bogo)) return bogo;
    return state.aeropuertos.find(sirve) || null;
  }

  /** Genera una línea curva entre dos aeropuertos para el tramo aéreo. */
  function _arcCoords(a, b) {    const lon1 = Number(a.longitud), lat1 = Number(a.latitud);
    const lon2 = Number(b.longitud), lat2 = Number(b.latitud);
    const n = 26;
    const dLon = lon2 - lon1, dLat = lat2 - lat1;
    const len = Math.sqrt(dLon * dLon + dLat * dLat) || 1;
    const bulge = Math.min(Math.max(len * 0.10, 0.15), 3.5);
    const px = -dLat / len;
    const py = dLon / len;
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = Math.sin(Math.PI * t);
      pts.push([lon1 + dLon * t + px * bulge * off, lat1 + dLat * t + py * bulge * off]);
    }
    return pts;
  }

  function _actualizarBotonAereo() {
    if (!el.btnAereo) return;
    el.btnAereo.setAttribute('aria-pressed', String(state.modoAereo));
    el.btnAereo.classList.toggle('icon-btn--active', state.modoAereo);
  }

  /** Calcula la ruta directamente en avión (carro→aeropuerto→vuelo→aeropuerto→carro). */
  async function calcularRutaAerea() {
    if (!state.origen || !state.destino) return;
    if (!state.aeropuertos || !state.aeropuertos.length) {
      _mostrarNotificacion('No hay datos de aeropuertos disponibles');
      return;
    }
    cerrarAltimetria();
    const apOri = _aeropuertoMasCercano(state.origen);
    const apDes = _aeropuertoMasCercano(state.destino);
    if (!apOri || !apDes) {
      _mostrarNotificacion('No se encontraron aeropuertos cercanos al origen o destino');
      return;
    }

    ponerEnCargaRuta(true, true);
    try {
      const [rutaCarro1, rutaCarro2] = await Promise.all([
        RoutingModule.calcularRuta(state.origen, { lat: apOri.latitud, lon: apOri.longitud }, 'driving'),
        RoutingModule.calcularRuta({ lat: apDes.latitud, lon: apDes.longitud }, state.destino, 'driving'),
      ]);

      const coordsCarro1 = rutaCarro1.geojson.geometry.coordinates;
      const coordsCarro2 = rutaCarro2.geojson.geometry.coordinates;

      // Plan de vuelos: directo o con conexión vía un hub (p. ej. Bogotá).
      const hub = _encontrarHub(apOri, apDes);
      const pares = hub ? [[apOri, hub], [hub, apDes]] : [[apOri, apDes]];
      const vuelos = pares.map(([a, b]) => {
        const coords = _arcCoords(a, b);
        const dist = turf.length(turf.lineString(coords), { units: 'kilometers' }) * 1000;
        const dur = (dist / 1000) / 750 * 3600;
        return { coords, distanciaMetros: dist, duracionSegundos: dur, a, b };
      });
      const distAvion = vuelos.reduce((s, v) => s + v.distanciaMetros, 0);
      const durAvion = vuelos.reduce((s, v) => s + v.duracionSegundos, 0);

      // Mapa: MultiLineString con los tramos en carro (sin línea recta entre aeropuertos).
      const geojsonMapa = {
        type: 'Feature',
        properties: { perfil: 'aereo' },
        geometry: { type: 'MultiLineString', coordinates: [coordsCarro1, coordsCarro2] },
      };
      // Perfil: LineString continua con los tramos en carro (turf solo en carro).
      const geojsonPerfil = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [...coordsCarro1, ...coordsCarro2] },
      };

      const elevacion = [...(rutaCarro1.elevacion || []), ...(rutaCarro2.elevacion || [])];
      const totalDist = rutaCarro1.distanciaMetros + distAvion + rutaCarro2.distanciaMetros;
      const totalDur = rutaCarro1.duracionSegundos + durAvion + rutaCarro2.duracionSegundos;

      const ruta = {
        geojson: geojsonMapa,
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        vertices: coordsCarro1.length + coordsCarro2.length,
        perfil: 'aereo',
      };

      state.modoAereo = true;
      state.tramosAereo = {
        vuelos,
        carro1: coordsCarro1,
        carro2: coordsCarro2,
        apOri,
        apDes,
        hub,
        distCarro1: rutaCarro1.distanciaMetros,
        distCarro2: rutaCarro2.distanciaMetros,
        distAvion,
        durAvion,
      };
      state.rutaBase = ruta;
      state.rutaActual = ruta;
      state.elevacion = elevacion;
      state.altimetriaGeo = geojsonPerfil;
      state.altimetriaTotalKm = totalDist / 1000;
      AltimetriaModule.setDatos(geojsonPerfil, state.elevacion, state.altimetriaTotalKm);

      sincronizarOrden();
      let idxIntermedio = 0;
      const mapaEtiquetas = new Map();
      state.orden.forEach((o) => {
        if (o.tipo === 'escala') {
          const dragE = state.escalas.find((e) => e.id === o.id);
          if (dragE && dragE._dragGenerated) return;
        }
        const etiqueta = etiquetaIntermedia(idxIntermedio++);
        const key = o.tipo + '_' + o.id;
        mapaEtiquetas.set(key, etiqueta);
        if (o.tipo === 'escala') {
          const e = state.escalas.find((e) => e.id === o.id);
          if (e && e.lat != null) e._numero = etiqueta;
        } else {
          const p = state.paradas.find((p) => p.id === o.id);
          if (p) p._numero = etiqueta;
        }
      });

      const routeLine = turf.lineString(geojsonPerfil.geometry.coordinates);
      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([e.lon, e.lat]), { units: 'kilometers' });
        e._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.lon, p.lat]), { units: 'kilometers' });
        p._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });

      // Aeropuertos en el perfil: salida, (hub) y llegada.
      const aeropuertos = [{ ap: apOri }, ...(hub ? [{ ap: hub }] : []), { ap: apDes }];
      aeropuertos.forEach(({ ap }) => {
        if (!ap) return;
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([ap.longitud, ap.latitud]), { units: 'kilometers' });
        AltimetriaModule.agregarParada(ap.latitud, ap.longitud, ap.aeropuerto, nearest.properties.location || 0, '✈', 'aero_' + (ap.id != null ? ap.id : (ap.ciudad_origen || 'x')), 'aeropuerto');
      });

      MapModule.dibujarRuta(geojsonMapa, {
        distanciaMetros: totalDist,
        duracionSegundos: totalDur,
        origenNombre: state.origen?.nombre || 'el origen',
      });
      MapModule.dibujarTramoAereo(vuelos);
      MapModule.setMarcadoresAeropuertos([
        { ap: apOri, titulo: 'Salida' },
        ...(hub ? [{ ap: hub, titulo: 'Conexión' }] : []),
        { ap: apDes, titulo: 'Llegada' },
      ]);
      MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
      MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);
      MapModule.setMarcadoresEscalas(state.escalas);
      MapModule.setMarcadoresParadas(state.paradas);
      MapModule.setMarcadoresPuntosDesvio(state.escalas);
      MapModule.encuadrar(geojsonMapa);

      const distTexto = Utils.formatearDistancia(totalDist);
      const durTexto = Utils.formatearDuracion(totalDur);
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = distTexto;
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = durTexto;
      renderizarParadas();
      _actualizarBotonAereo();
      sincronizarModoRutaMovil();
    } catch (err) {
      console.warn('Error al calcular ruta aérea', err);
      _mostrarNotificacion('No se pudo calcular la ruta en avión');
    } finally {
      ponerEnCargaRuta(false);
    }
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
      excluirIds: [],
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
    const idsExcluidos = new Set();
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
          const usarDistanciaProg = el.checkDistancia.checked || (state.categoriasSeleccionadas.length > 0 && !el.checkDistancia.checked && !el.checkTiempo.checked);
          if (usarDistanciaProg && s.distanciaRutaKm > distanciaMax) continue;
          if (el.checkTiempo.checked && (s.tiempoDesvioMin ?? Infinity) > Number(el.filtroTiempo.value)) continue;
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
    // El botón flotante del mapa solo aparece cuando hay listado.
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.hidden = sitiosOrdenados.length === 0;

    if (sitiosOrdenados.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      _syncBotonSitios();
      return;
    }

    el.sitiosVacio.hidden = true;
    el.sitiosLista.hidden = false;
    _syncBotonSitios();

    sitiosOrdenados.forEach((sitio, i) => {
      if (sitio.lat == null || sitio.lon == null || isNaN(Number(sitio.lat)) || isNaN(Number(sitio.lon))) return;
      const marker = TourismModule.crearMarcador(sitio);
      // Viceversa: hover en marcador del mapa → destacar en perfil
      if (sitio._distKm != null) {
        marker.on('mouseover', () => { AltimetriaModule.mostrarHoverEn(sitio._distKm); });
        marker.on('mouseout', () => { AltimetriaModule.ocultarHover(); });
      }
      MapModule.agregarMarcadorSitio(marker);
      el.sitiosLista.appendChild(crearTarjetaSitio(sitio, i));
    });
  }

  /** Construye la tarjeta de un sitio en la lista, con acciones de previsualizar y agregar. */
  function crearTarjetaSitio(sitio, idx) {
    const esParada = state.paradas.some((p) => p.id === sitio.id);
    const li = Utils.crearElemento(`
      <li class="sitio-card${esParada ? ' sitio-card--active' : ''}" data-sitio-id="${sitio.id}">
        <div class="sitio-card__top">
          <span class="sitio-card__nombre"><span class="sitio-card__num">${idx != null ? (idx + 1) + '.' : ''}</span>&nbsp;${sitio.nombre}</span>
          <div class="sitio-card__top-right">
            <button type="button" class="icon-btn sitio-card__add${esParada ? ' sitio-card__add--quitar' : ''}" title="${esParada ? 'Quitar de la ruta' : 'Agregar a la ruta'}" aria-label="${esParada ? 'Quitar ' + sitio.nombre + ' de la ruta' : 'Agregar ' + sitio.nombre + ' a la ruta'}">
              <svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">${esParada ? '<path d="M6 12h12"/>' : '<path d="M12 5v14M5 12h14"/>'}</svg>
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
      if (esParada) {
        quitarSitioDeLaRuta(sitio, li, btnAdd);
      } else {
        agregarParada(sitio, btnAdd);
      }
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

  async function aplicarRutaConDesvios(opciones = {}) {
    if (!state.rutaBase) return;
    // En modo aéreo no hay desvíos por carretera: la ruta es la base (MultiLineString).
    state.rutaActual = state.modoAereo
      ? state.rutaBase
      : await construirRutaConDesvios(state.rutaBase, state.paradas);

    let iteraciones = 0;
    if (!state.modoAereo) {
      while (state.rutaActual.idsFallidos && state.rutaActual.idsFallidos.length > 0 && iteraciones < 3) {
        const idsSet = new Set(state.rutaActual.idsFallidos);
        state.paradas = state.paradas.filter((p) => !idsSet.has(p.id));
        renderizarParadas();
        state.rutaActual = await construirRutaConDesvios(state.rutaBase, state.paradas);
        iteraciones++;
      }
    }

    MapModule.dibujarRuta(state.rutaActual.geojson, {
      distanciaMetros: state.rutaActual.distanciaMetros,
      duracionSegundos: state.rutaActual.duracionSegundos,
      origenNombre: state.origen?.nombre || 'el origen',
    });
    if (state.modoAereo && state.tramosAereo) {
      MapModule.dibujarTramoAereo(state.tramosAereo.vuelos || []);
      const ta = state.tramosAereo;
      MapModule.setMarcadoresAeropuertos([
        { ap: ta.apOri, titulo: 'Salida' },
        ...(ta.hub ? [{ ap: ta.hub, titulo: 'Conexión' }] : []),
        { ap: ta.apDes, titulo: 'Llegada' },
      ]);
    }

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

    // Almacenar datos para altimetría (elevación se carga bajo demanda)
    const totalKm = state.rutaBase ? state.rutaBase.distanciaMetros / 1000 : 0;
    const geoPerfil = state.modoAereo && state.altimetriaGeo
      ? state.altimetriaGeo
      : (state.rutaBase ? state.rutaBase.geojson : state.rutaActual.geojson);
    if (state.rutaBase && state.rutaBase.elevacion) {
      state.elevacion = state.rutaBase.elevacion;
    }
    // Si la base no trae elevación (carga bajo demanda), se conserva la ya cargada
    // para que el perfil no se borre al recalcular tras quitar/añadir paradas.
    state.altimetriaGeo = geoPerfil;
    state.altimetriaTotalKm = totalKm;
    AltimetriaModule.setDatos(geoPerfil, state.elevacion, totalKm);
    if (state.origen) AltimetriaModule.setExtremos(formatMunicipio(state.origen), state.destino ? formatMunicipio(state.destino) : 'Destino');
    sincronizarOrden();
    let idxIntermedio = 0;
    const mapaEtiquetas = new Map();
    state.orden.forEach((o) => {
      if (o.tipo === 'escala') {
        const dragE = state.escalas.find((e) => e.id === o.id);
        if (dragE && dragE._dragGenerated) return;
      }
      const etiqueta = etiquetaIntermedia(idxIntermedio++);
      const key = o.tipo + '_' + o.id;
      mapaEtiquetas.set(key, etiqueta);
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (e && e.lat != null) e._numero = etiqueta;
      } else {
        const p = state.paradas.find((p) => p.id === o.id);
        if (p) p._numero = etiqueta;
      }
    });

    if (geoPerfil) {
      const routeLine = turf.lineString(geoPerfil.geometry.coordinates);
      state.escalas.filter(e => e.lat != null && !e._dragGenerated).forEach(e => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([e.lon, e.lat]), { units: 'kilometers' });
        e._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(e.lat, e.lon, formatMunicipio(e), e._distKm, mapaEtiquetas.get('escala_' + e.id) || '', e.id, 'escala');
      });
      state.paradas.forEach(p => {
        const nearest = turf.nearestPointOnLine(routeLine, turf.point([p.lon, p.lat]), { units: 'kilometers' });
        p._distKm = nearest.properties.location || 0;
        AltimetriaModule.agregarParada(p.lat, p.lon, p.nombre, p._distKm, mapaEtiquetas.get('parada_' + p.id) || '', p.id, 'parada');
      });
    }
    // El perfil no se reconstruye al calcular la ruta: se carga bajo demanda al abrirlo.
    MapModule.setMarcadoresEscalas(state.escalas);
    MapModule.setMarcadoresParadas(state.paradas);
    MapModule.setMarcadoresPuntosDesvio(state.escalas);
    // Al añadir/quitar paradas el mapa no debe cambiar de posición.
    if (!opciones.mantenerMapa) MapModule.encuadrar(state.rutaActual.geojson);
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
        await aplicarRutaConDesvios({ mantenerMapa: true });
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
    _borrarListadoDescubre();

    await calcularRutaPrincipal(true);
    renderizarParadas();
  }

  /** Elimina un punto de desvío de la ruta conservando la pestaña Descubre. */
  function eliminarPuntoDesvio(escalaId) {
    const idx = state.escalas.findIndex((e) => e.id === escalaId);
    if (idx === -1) return;
    state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      MapModule.limpiarSitios();
      _borrarListadoDescubre();
      calcularRutaPrincipal(true);
    } else {
      renderizarParadas();
    }
  }

  /** Abre el menú contextual de un punto de desvío (clic secundario / pulsación larga sobre el punto). */
  function abrirMenuPuntoDesvio(escalaId, clientX, clientY) {
    const opciones = [
      { etiqueta: 'Eliminar punto de desvío', accion: () => eliminarPuntoDesvio(escalaId) },
    ];
    abrirMenuFila(opciones, clientX, clientY);
  }

  /** Mueve un punto de desvío arrastrado y recalcula la ruta pasando por su nueva posición. */
  async function moverPuntoDesvio(escalaId, lat, lon) {
    const escala = state.escalas.find((e) => e.id === escalaId);
    if (!escala) return;
    escala.lat = lat;
    escala.lon = lon;

    // Invalidar distancias cacheadas de los sitios
    state.sitios.forEach((s) => {
      delete s.distanciaRutaKm;
      delete s.tiempoDesvioMin;
      delete s.distanciaOrigenKm;
      delete s.distanciaDestinoKm;
      delete s._offsetLado;
    });
    MapModule.limpiarSitios();
    _borrarListadoDescubre();

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
        MapModule.agregarMarcadorSitio(TourismModule.crearMarcador(sitio));
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

  function eliminarEscala(id, recalcular = true) {
    const idx = state.escalas.findIndex((e) => e.id === id);
    if (idx !== -1) state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      if (recalcular) {
        state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
        _borrarListadoDescubre();
        calcularRutaPrincipal(true);
      } else {
        renderizarParadas();
      }
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

  // ---------------------------------------------------------------------
  // Menú contextual de las filas de paradas (clic derecho / pulsación larga)
  // ---------------------------------------------------------------------
  let _menuFila = null;
  let _suprimirProximoClic = false;

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

  /** Lleva al usuario al panel Ruta con el campo de origen seleccionado y su lista desplegada. */
  function irCambiarOrigen() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    el.appRoot.removeAttribute('data-ruta-lista');
    // Al cambiar el origen solo se muestra el cuadro del origen (sin el "+" de agregar escala).
    if (el.btnAgregarEscala) el.btnAgregarEscala.hidden = true;
    const row = document.getElementById('row-origen');
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (el.origenInput) {
      el.origenInput.focus();
      el.origenInput.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Lleva para usuario al panel Ruta con el campo de destino seleccionado y su lista desplegada. */
  function irCambiarDestino() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    el.appRoot.removeAttribute('data-ruta-lista');
    if (el.btnAgregarEscala) el.btnAgregarEscala.hidden = true;
    const row = document.getElementById('row-destino');
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (el.destinoInput) {
      el.destinoInput.focus();
      el.destinoInput.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Lleva al usuario al panel Ruta con un nuevo campo de pueblo intermedio desplegado. */
  function reemplazarPuebloIntermedio() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    const row = agregarEscala();
    el.panelEscalas.hidden = false;
    el.panelEscalas.scrollIntoView({ block: 'nearest' });
    const input = row && row.querySelector('.combo__trigger');
    if (input) {
      setTimeout(() => {
        input.focus();
        input.scrollIntoView({ block: 'nearest' });
      }, 50);
    }
  }

  /** Lleva al usuario al panel Ruta con un nuevo campo de pueblo intermedio desplegado. */
  function agregarPuebloIntermedioDesdeLista() {
    activarPanelTab('ruta');
    setMobileTab('ruta');
    const row = agregarEscala();
    el.panelEscalas.hidden = false;
    el.panelEscalas.scrollIntoView({ block: 'nearest' });
    const input = row && row.querySelector('.combo__trigger');
    if (input) {
      setTimeout(() => {
        input.focus();
        input.scrollIntoView({ block: 'nearest' });
      }, 50);
    }
  }

  /** Reemplaza un pueblo intermedio: lo quita de la ruta y abre un nuevo campo editable en el panel Ruta. */
  function cambiarPueblo(escala) {
    // Sin recalcular: la ruta se recalcula cuando el usuario elige el nuevo pueblo,
    // así el campo recién abierto no se elimina por la limpieza asíncrona de filas.
    eliminarEscala(escala.id, false);
    reemplazarPuebloIntermedio();
  }

  /** Centra el mapa y muestra la ficha centrada de una parada (como la de un sitio). */
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
      let dist = null;
      if (prefijo === 'Salida') dist = tramos.distCarro1;
      else if (prefijo === 'Llegada') dist = tramos.distCarro2;
      else if (tramos.vuelos && tramos.vuelos[0]) dist = tramos.vuelos[0].distanciaMetros;
      if (dist == null) return '';
      return `${prefijo}: ${(dist / 1000).toFixed(1)} km`;
    })();

    TourismModule.mostrarCuadroInfo({
      categoria: `Aeropuerto de ${prefijo.toLowerCase()}`,
      color: '#4a6fa5',
      nombre: ap.aeropuerto || '',
      ubicacion: ap.ciudad_origen || '',
      descripcion: ap.descripcion_ubicacion || '',
      dist: distTxt,
      botones: [],
    });
  }

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
    el.paradasContador.hidden = total === 0;
    // En la pestaña Descubre las paradas no deben aparecer aunque haya paradas.
    el.panelParadas.hidden = estaEnPestanaDescubre() || (!incluirExtremos && total === 0);

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

      if (tipo === 'destino' && state.rutaActual?.distanciaMetros) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        distEl.textContent = ' — ' + (state.rutaActual.distanciaMetros / 1000).toFixed(1) + ' km';
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
      nombreEl.textContent = (prefijo ? prefijo + ': ' : '') + (aeropuerto || '');
      if (distKm != null) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        distEl.textContent = ' — ' + distKm.toFixed(1) + ' km';
        nombreEl.appendChild(distEl);
      }
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
      const li = crearFilaAeropuerto(ap.aeropuerto, prefijo, distMetros != null ? distMetros / 1000 : null);
      li.addEventListener('click', accionAeropuerto(ap, prefijo));
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionAeropuerto(ap, prefijo)(); }
      });
      return li;
    }

    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('A', formatMunicipio(state.origen), 'origen'));
    }
    if (state.modoAereo && state.tramosAereo && state.tramosAereo.apOri) {
      el.paradasLista.appendChild(construirFilaAeropuerto(state.tramosAereo, state.tramosAereo.apOri, 'Salida', state.tramosAereo.distCarro1));
    }
    if (state.modoAereo && state.tramosAereo && state.tramosAereo.hub && state.tramosAereo.vuelos && state.tramosAereo.vuelos[0]) {
      el.paradasLista.appendChild(construirFilaAeropuerto(state.tramosAereo, state.tramosAereo.hub, 'Conexión', state.tramosAereo.vuelos[0].distanciaMetros));
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
          btnUp.addEventListener('contextmenu', (evt) => evt.stopPropagation());
          acciones.appendChild(btnUp);
        }
        if (idx < total - 1) {
          const btnDown = btnIcono('<polyline points="6 9 12 15 18 9"/>');
          btnDown.title = 'Bajar';
          btnDown.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx + 1); });
          btnDown.addEventListener('contextmenu', (evt) => evt.stopPropagation());
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

      el.paradasLista.appendChild(li);
    });

    if (state.modoAereo && state.tramosAereo && state.tramosAereo.apDes) {
      el.paradasLista.appendChild(construirFilaAeropuerto(state.tramosAereo, state.tramosAereo.apDes, 'Llegada', state.tramosAereo.distCarro2));
    }
    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('Z', formatMunicipio(state.destino), 'destino'));
    }
  }

  async function organizarAutomaticamente(invalidarSitios = false) {
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
      // Si cambió el trazado (p. ej. se agregó un pueblo intermedio), el tour de
      // Descubre queda obsoleto: se invalidan distancias cacheadas, se quitan los
      // marcadores del mapa y se borra el listado para que se recalcule con la
      // nueva ruta (al reabrir Descubre) en lugar de mostrar los sitios viejos.
      if (invalidarSitios) {
        state.sitios.forEach((s) => {
          delete s.distanciaRutaKm;
          delete s.tiempoDesvioMin;
          delete s.distanciaOrigenKm;
          delete s.distanciaDestinoKm;
          delete s._offsetLado;
        });
        MapModule.limpiarSitios();
        _borrarListadoDescubre();
      }
      await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
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
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      MapModule.limpiarSitios();
      _borrarListadoDescubre();
      await calcularRutaPrincipal(true, { silencioso: true, conservarAltimetria: true });
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
