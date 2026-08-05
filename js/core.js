/**
 * core.js
 * ---------------------------------------------------------------------------
 * Estado centralizado, referencias DOM y constantes compartidas por todos los
 * módulos de la aplicación (AppState / AppEl). Se carga antes que el resto.
 * ---------------------------------------------------------------------------
 */

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
    puertos: [],
    modoAereo: false,
    tramosAereo: null,
    modoFluvial: false,
    tramosFluviales: null,
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
    btnFluvial: document.getElementById('btn-fluvial'),
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
    rowOrigen: document.getElementById('row-origen'),
    rowDestino: document.getElementById('row-destino'),
    paradasTitulo: document.getElementById('paradas-titulo'),
    btnTabPanelRuta: document.getElementById('btn-tab-panel-ruta'),
    btnTabPanelDescubre: document.getElementById('btn-tab-panel-descubre'),
    panelDescubreActions: document.getElementById('panel-descubre-actions'),
    sitiosFronteraContador: document.getElementById('sitios-frontera-contador'),
    btnToggleSitiosFloat: document.getElementById('btn-toggle-sitios-float'),
    btnDescubreVisibles: document.getElementById('btn-descubre-visibles-btn'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    panelSitios: document.getElementById('panel-sites'),
    btnMostrarSitiosCercanos: document.getElementById('btn-mostrar-sitios'),
    btnSubirRutaPropia: document.getElementById('btn-subir-ruta-propia'),
    btnCerrarRutasArchivo: document.getElementById('btn-cerrar-rutas-archivo'),
    btnCerrarRutasArchivoDesktop: document.getElementById('btn-cerrar-rutas-archivo-desktop'),
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
    panelCargarRuta: document.getElementById('panel-cargar-ruta'),
    inputRutaArchivo: document.getElementById('input-ruta-archivo'),
    cargarRutaFileLabel: document.getElementById('cargar-ruta-file-label'),
    btnCerrarCargarRuta: document.getElementById('btn-cerrar-cargar-ruta'),
    btnContinuarRuta: document.getElementById('btn-continuar-ruta'),
    cargarRutaError: document.getElementById('cargar-ruta-error'),
    btnGps: document.getElementById('btn-gps'),
    seguirRuta: document.getElementById('seguir-ruta'),
    seguirRutaContenido: document.getElementById('seguir-ruta-contenido'),
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

  // Todos los puertos del catálogo (tecla P) y aeropuertos (tecla A):
  // ocultos por defecto, se muestran/ocultan con su tecla.

  let _puertosVisibles = false;
  let _aeropuertosVisibles = false;

  // Ruta cargada desde archivo KML/GPX (tecla K): oculta el panel como los
  // aeropuertos/puertos mientras esté activa.

  let _rutaArchivoActiva = false;


  let ultimosValoresAplicados = { distancia: null, tiempo: null };

  let conteoCategoriasBase = null;

  let _soMostrarSitiosVisto = false;

  /** Habilita/deshabilita todos los controles de entrada durante el cálculo de ruta. */

  let _calculandoListado = 0;

  let _listadoParaGeojson = null; // referencia de la ruta con la que se calculó el listado

  /** Calcula el listado de sitios de la pestaña Descubre solo si aún no hay listado. */

  let _menuFila = null;

  let _suprimirProximoClic = false;


  let _cambioExtremoEnCurso = null; // 'origen' | 'destino' | null

  /** La próxima escala creada reemplaza un pueblo intermedio (recalcular al elegir). */

  let _escalaEnCambio = false;
