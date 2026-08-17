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
    dias: 1,              // número de días en que se dividen las paradas de la ruta
    diasNombres: {},      // día (1-based) → nombre personalizado del día
    diasOrden: {},        // 'tipo:id' → día (1-based) en que quedó la parada al arrastrarla
    diaFechaBase: null,   // día (1-based) al que se le fijó una fecha
    diaFechaValor: null,  // fecha base 'YYYY-MM-DD' de ese día
    rutaBase: null,
    rutaActual: null,
    paradas: [],
    sitiosFiltrados: [],
    sitiosFiltradosBase: [],
    ordenSitios: 'origen',
    ordenDir: 'asc',          // dirección del orden de sitios: 'asc' | 'desc'
    modoVisibilidad: 'completa',
    previewSitioId: null,
    categoriasSeleccionadas: [],
    categoriasUnicas: [],
    aeropuertos: [],
    puertos: [],
    departamentos: [],
    categorias: [],
    tourDestinos: [],
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
    sitiosVacio: document.getElementById('sitios-vacio'),
    sitiosLista: document.getElementById('sitios-lista'),
    buscarSitios: document.getElementById('buscar-sitios'),
    buscarSitiosWrap: document.querySelector('.panel-sites__busqueda'),
    sitiosContador: document.getElementById('sitios-contador'),
    btnOrdenOrigen: document.getElementById('btn-orden-origen'),
    btnOrdenDestino: document.getElementById('btn-orden-destino'),
    panelParadas: document.getElementById('panel-paradas'),
    paradasLista: document.getElementById('paradas-lista'),
    paradasContador: document.getElementById('paradas-contador'),
    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    btnAplicarDistancia: document.getElementById('btn-aplicar-distancia'),
    checkTiempo: document.getElementById('check-tiempo'),
    filtroTiempo: document.getElementById('filtro-tiempo'),
    btnAplicarTiempo: document.getElementById('btn-aplicar-tiempo'),
    btnDescubreCategorias: document.getElementById('btn-descubre-categorias'),
    btnDescubreDesvios: document.getElementById('btn-descubre-desvios'),
    btnDescubreOrdenar: document.getElementById('btn-descubre-ordenar'),
    descubreDropdownCategorias: document.getElementById('descubre-dropdown-categorias'),
    descubreDropdownDesvios: document.getElementById('descubre-dropdown-desvios'),
    descubreDropdownOrdenar: document.getElementById('descubre-dropdown-ordenar'),
    btnOrdenOrigenDes: document.getElementById('btn-descubre-orden-origen'),
    btnOrdenDir: document.getElementById('btn-orden-dir'),
    categoriasGrid: document.getElementById('categorias-grid'),
    panelEscalas: document.getElementById('panel-escalas'),
    btnAgregarEscala: document.getElementById('btn-agregar-escala'),
    btnAgregarIntermedio: document.getElementById('btn-agregar-intermedio'),
    panelLocate: document.getElementById('panel-locate'),
    rowOrigen: document.getElementById('row-origen'),
    rowDestino: document.getElementById('row-destino'),
    paradasTitulo: document.getElementById('paradas-titulo'),
    filtroMunicipiosDepto: document.getElementById('filtro-municipios-departamento'),
    btnAutoOrganizar: document.getElementById('btn-auto-organizar'),
    btnTabPanelRuta: document.getElementById('btn-tab-panel-ruta'),
    btnTabPanelRutaLabel: document.getElementById('btn-tab-panel-ruta-label'),
    btnAnadirRutaDesktop: document.getElementById('btn-anadir-ruta-desktop'),
    btnTabPanelDescubre: document.getElementById('btn-tab-panel-descubre'),
    panelDescubreActions: document.getElementById('panel-descubre-actions'),
    sitiosFronteraContador: document.getElementById('sitios-frontera-contador'),
    btnToggleSitiosFloat: document.getElementById('btn-toggle-sitios-float'),
    btnDescubreVisibles: document.getElementById('btn-descubre-visibles-btn'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    panelSitios: document.getElementById('panel-sites'),
    btnMostrarSitiosCercanos: document.getElementById('btn-mostrar-sitios'),
    btnSubirRutaPropia: document.getElementById('btn-subir-ruta-propia'),
    btnAccionesRuta: document.querySelector('.btn-acciones-ruta'),
    btnIniciarTour: document.getElementById('btn-iniciar-tour'),
    panelTour: document.getElementById('panel-tour'),
    tourInput: document.getElementById('tour-input'),
    tourList: document.getElementById('tour-list'),
    tourDestinosLista: document.getElementById('tour-destinos-lista'),
    icoTabRuta: document.getElementById('ico-tab-ruta'),
    icoTabRutaDesktop: document.getElementById('ico-tab-ruta-desktop'),
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
    btnTabRutaLabel: document.getElementById('btn-tab-ruta-label'),
    btnAnadirRutaTab: document.getElementById('btn-anadir-ruta-tab'),
    icoTabAltimetria: document.getElementById('ico-tab-altimetria'),
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

  // Departamentos del país centrados en sus capitales (tecla D) y municipios
  // con filtro por departamento (tecla M): ocultos por defecto.

  let _departamentosVisibles = false;
  let _municipiosVisibles = false;
  let _municipiosFiltroDepto = '';   // departamento activo del filtro de municipios
  let _categoriasVisibles = false;   // tecla C: sitios por categoría (una a la vez)
  let _categoriasFiltro = '';        // categoría activa del filtro de categorías
  let _tourActivo = false;           // modo tour (seleccionar destinos sin ruta)

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

  /**
   * Deshacer / rehacer (Ctrl+Z / Ctrl+Y) de las acciones del viaje.
   *
   * Funciona por snapshots del estado: cada acción de usuario registra el estado
   * ANTES de modificar (registrar), y deshacer/rehacer restauran snapshots
   * completos mediante _aplicarSnapshot (definido en app.js, que se carga al
   * final; aquí solo se invoca en tiempo de ejecución). Los snapshots se guardan
   * en pilas con deduplicación: si dos registros consecutivos capturan el mismo
   * estado (p. ej. recalcular tras un cambio), solo se conserva uno.
   */
  const UndoManager = {
    _undoStack: [],
    _redoStack: [],
    _lastSerial: null,

    registrar() {
      if (typeof _capturarSnapshot !== 'function') return;
      const snap = _capturarSnapshot();
      const serial = JSON.stringify(snap);
      if (serial === this._lastSerial) return;
      this._undoStack.push(snap);
      if (this._undoStack.length > 100) this._undoStack.shift();
      this._redoStack = [];
      this._lastSerial = serial;
    },

    deshacer() {
      if (!this._undoStack.length || typeof _capturarSnapshot !== 'function') return;
      if (typeof _aplicarSnapshot !== 'function') return;
      this._redoStack.push(_capturarSnapshot());
      const snap = this._undoStack.pop();
      // Al restaurar no se fija _lastSerial: el siguiente registro debe
      // capturarse siempre (el estado acaba de cambiar por el deshacer).
      this._lastSerial = null;
      _aplicarSnapshot(snap);
    },

    rehacer() {
      if (!this._redoStack.length || typeof _capturarSnapshot !== 'function') return;
      if (typeof _aplicarSnapshot !== 'function') return;
      this._undoStack.push(_capturarSnapshot());
      const snap = this._redoStack.pop();
      this._lastSerial = null;
      _aplicarSnapshot(snap);
    },

    reiniciar() {
      this._undoStack = [];
      this._redoStack = [];
      this._lastSerial = null;
    },
  };

  /** La próxima escala creada reemplaza un pueblo intermedio (recalcular al elegir). */
