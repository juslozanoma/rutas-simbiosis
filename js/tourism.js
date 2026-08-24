/**
 * tourism.js
 * ---------------------------------------------------------------------------
 * Carga y gestiona la "base de datos" de sitios turísticos (archivo JSON
 * propio) y de municipios. Construye los marcadores de Leaflet a partir de
 * los resultados ya filtrados por filters.js.
 *
 * El módulo está preparado para escalar a miles de registros: los datos se
 * cargan una sola vez, se indexan en memoria (por id) y el renderizado de
 * marcadores usa Leaflet.markercluster para mantener el rendimiento del
 * mapa incluso con volúmenes grandes.
 * ---------------------------------------------------------------------------
 */
const TourismModule = (() => {

  const COLORES_CATEGORIA = {
    'Patrimonio cultural': '#b0592a',
    'Naturaleza': '#2f7a6b',
    'Entretenimiento': '#c9972b',
    'Descanso y bienestar': '#4a6fa5',
  };

  let sitios = [];      // arreglo completo cargado del JSON
  let municipios = [];  // arreglo completo de municipios

  /** Carga sitios turísticos desde data/sitios_turisticos.json */
  async function cargarSitios(url = 'data/sitios_turisticos.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo cargar el catálogo de sitios turísticos.');
    sitios = await res.json();
    return sitios;
  }

  /** Carga el listado de municipios desde data/municipios.json */
  async function cargarMunicipios(url = 'data/municipios.json') {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo cargar el listado de municipios.');
    municipios = await res.json();
    return municipios;
  }

  function getSitios() { return sitios; }
  function getMunicipios() { return municipios; }

  let onAgregarParadaCallback = null;

  function setOnAgregarParada(cb) { onAgregarParadaCallback = cb; }

  // Menú contextual (clic derecho) sobre un marcador de sitio del mapa.
  let _onMenuSitio = null;

  function setOnMenuSitio(fn) { _onMenuSitio = fn; }

  function colorCategoria(categoria) {
    return COLORES_CATEGORIA[categoria] || '#6c7369';
  }

  /** Extrae listas únicas para poblar los <select> de filtros. */
  function categoriasUnicas() {
    return [...new Set(sitios.map((s) => s.categoria))].sort();
  }
  function departamentosUnicos() {
    return [...new Set(sitios.map((s) => s.departamento))].sort();
  }
  function municipiosUnicos(filtroDepartamento) {
    const base = filtroDepartamento
      ? sitios.filter((s) => s.departamento === filtroDepartamento)
      : sitios;
    return [...new Set(base.map((s) => s.municipio))].sort();
  }

  /**
   * Construye un marcador Leaflet para un sitio turístico ya enriquecido
   * con `distanciaCorredorKm` (calculado en filters.js). Si se pasa `etiqueta`
   * (p. ej. el número en el listado de Descubre), la etiqueta permanente del
   * mapa muestra ese número; si no, muestra el nombre del sitio.
   */
  function crearMarcador(sitio, etiqueta) {
    const numero = etiqueta != null && String(etiqueta) !== '' ? String(etiqueta) : null;
    const icono = MapModule.iconoSitio(numero);
    const marker = L.marker([sitio.lat, sitio.lon], { icon: icono });
    marker.bindTooltip(numero ? `${numero} · ${sitio.nombre}` : sitio.nombre, {
      permanent: false,
      direction: 'top',
      offset: [0, -16],
      className: 'site-label',
    });

    marker.__sitioId = sitio.id;

    marker.on('click', () => {
      // En táctil el clic puede dispararse dos veces (tap sintético + clic nativo);
      // si la ficha del mismo sitio ya está abierta no se vuelve a centrar ni a
      // re-montar, porque re-montar la cierra y el centrado repite el moveend.
      if (_popupSitioId === sitio.id && _popupOverlay) return;
      if (typeof MapModule !== 'undefined' && MapModule.centrarEn) {
        MapModule.centrarEn(sitio.lat, sitio.lon);
      }
      mostrarPopupSitio(sitio);
    });

    marker.on('contextmenu', (ev) => {
      if (_onMenuSitio) {
        ev.originalEvent.preventDefault();
        _onMenuSitio(sitio, marker, ev.originalEvent.clientX, ev.originalEvent.clientY);
      }
    });

    return marker;
  }

  let _popupOverlay = null;
  let _popupSitioId = null;
  let _popupSitio = null; // sitio activo de la ficha (lo renderiza React)
  let _cuadroInfoSnapshot = null; // ficha genérica activa (la renderiza React)

  function ocultarPopupSitio() {
    // React desmonta su contenido ANTES de quitar el contenedor.
    _popupSitio = null;
    _cuadroInfoSnapshot = null;
    _notificarPopupSitio();
    _notificarCuadroInfo();
    if (_popupOverlay) {
      // Solo se elimina si es un overlay flotante creado aquí; la zona
      // informativa del panel (#panel-info) es persistente y se vacía sola
      // al desmontarse React (queda oculta por CSS con :empty).
      if (_popupOverlay.classList && _popupOverlay.classList.contains('sitio-overlay')) {
        _popupOverlay.remove();
      }
      _popupOverlay = null;
    }
    // Sin ficha activa se retiran las marcas que ajustan la lista de paradas.
    const zonaInfo = document.getElementById('panel-info');
    if (zonaInfo) zonaInfo.classList.remove('con-ficha');
    const raizApp = document.getElementById('app');
    if (raizApp) raizApp.classList.remove('ficha-info-activa');
    if (_popupSitioId != null) {
      if (typeof MapModule !== 'undefined' && MapModule.cerrarTooltipSitio) {
        MapModule.cerrarTooltipSitio(_popupSitioId);
      }
      _popupSitioId = null;
    }
  }

  /** Monta la ficha: en escritorio dentro de la zona informativa del panel
   *  (#panel-info, mitad inferior de la pestaña Ruta); en celular sigue como
   *  cuadro sobre el mapa (centrado u hoja inferior). */
  function _montarCuadroCentrado(nodo, abajo) {
    // En escritorio la ficha vive en el panel lateral: nada flotando en el mapa.
    if (window.innerWidth > 860) {
      const zona = document.getElementById('panel-info');
      if (zona) {
        // La ficha pertenece a la pestaña Ruta: si el usuario está viendo
        // Descubre se pasa a Ruta para que la ficha sea visible.
        if (typeof estaEnPestanaDescubre === 'function' && estaEnPestanaDescubre()
            && typeof activarPanelTab === 'function') {
          activarPanelTab('ruta');
        }
        if (nodo) zona.appendChild(nodo);
        zona.classList.add('con-ficha');
        const raizApp = document.getElementById('app');
        if (raizApp) raizApp.classList.add('ficha-info-activa');
        _popupOverlay = zona;
        return true;
      }
    }

    const mapContainer = (typeof MapModule !== 'undefined' && MapModule.getMap)
      ? (MapModule.getMap().getContainer())
      : null;
    if (!mapContainer) return false;

    const movil = window.innerWidth <= 860;
    const overlay = document.createElement('div');
    overlay.className = 'sitio-overlay' + (movil && abajo ? ' sitio-overlay--abajo' : '');

    if (!(movil && abajo)) {
      // La barra de resumen tapa la parte superior del mapa; se compensa al centrar.
      const sumEl = document.querySelector('.mobile-summary');
      const topOffset = (sumEl && sumEl.offsetHeight > 0) ? sumEl.offsetHeight : 0;
      if (topOffset > 0) {
        overlay.style.paddingTop = `${topOffset}px`;
        overlay.style.paddingBottom = '0';
      }
    }

    // El contenido de la ficha de un sitio lo renderiza React (PopupSitio,
    // portal al contenedor); mostrarCuadroInfo construye su propio nodo y lo
    // ancla aquí pasándolo como argumento.
    if (nodo) overlay.appendChild(nodo);
    mapContainer.appendChild(overlay);
    _popupOverlay = overlay;
    return true;
  }

  function mostrarPopupSitio(sitio) {
    ocultarPopupSitio();

    if (typeof MapModule !== 'undefined' && MapModule.abrirTooltipSitio) {
      MapModule.abrirTooltipSitio(sitio.id);
    }
    _popupSitioId = sitio.id;

    // La ficha la renderiza React (PopupSitio, portal al contenedor
    // .sitio-overlay); aquí solo se monta el contenedor vacío y se notifica.
    _popupSitio = sitio;
    _montarCuadroCentrado(null, true);
    _notificarPopupSitio();
  }

  /**
   * Muestra una ficha informativa centrada (paradas, escalas o extremos) con
   * el mismo comportamiento que la ficha de un sitio turístico.
   * opciones: { categoria, color, nombre, ciudad, rio, ubicacion,
   *             descripcion, dist, altura, temperatura, poblacion,
   *             superficie_total, botones[] }
   */
  function mostrarCuadroInfo(opciones) {
    ocultarPopupSitio();

    // La ficha la renderiza React (CuadroInfo, portal al contenedor
    // .sitio-overlay); aquí solo se guarda el snapshot normalizado y se monta
    // el contenedor vacío.
    _cuadroInfoSnapshot = _normalizarCuadroInfo(opciones || {});
    _montarCuadroCentrado(null, true);
    _notificarCuadroInfo();
  }

  /** Normaliza las opciones de la ficha genérica a un snapshot serializable.
   *  Los botones llegan como descriptores { etiqueta, clase, accion } (los
   *  construían los llamadores con createElement; ahora React los renderiza). */
  function _normalizarCuadroInfo(opciones) {
    const botones = Array.isArray(opciones.botones)
      ? opciones.botones.map((b) => ({
        etiqueta: b && b.etiqueta != null ? b.etiqueta : '',
        clase: b && b.clase ? b.clase : 'popup-sitio__add',
        accion: b && b.accion ? b.accion : null,
      }))
      : [];
    return {
      esPuerto: !!opciones.esPuerto,
      tipoCatalogo: opciones.tipoCatalogo || '',
      refItem: opciones.refItem || null,
      categoria: opciones.categoria || '',
      color: opciones.color || colorCategoria(opciones.categoria),
      nombre: opciones.nombre || '',
      ciudad: opciones.ciudad || '',
      rio: opciones.rio || '',
      ubicacion: opciones.ubicacion || '',
      descripcion: opciones.descripcion || '',
      dist: opciones.dist || '',
      altura: opciones.altura || '',
      temperatura: opciones.temperatura || '',
      poblacion: opciones.poblacion || '',
      superficie_total: opciones.superficie_total || '',
      botones,
      botonCabecera: opciones.botonCabecera || null,
    };
  }

  // -------------------------------------------------------------------
  // Puente con React (ficha de sitio turístico). El contenido de la ficha lo
  // renderiza el componente PopupSitio (portal al contenedor .sitio-overlay
  // que monta _montarCuadroCentrado); el cuadro de información genérico
  // (mostrarCuadroInfo), tooltips y menús siguen siendo vanilla.
  // -------------------------------------------------------------------

  function _notificarPopupSitio() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarPopupSitio === 'function') {
      window.SimbiosisUI.notificarPopupSitio();
    }
  }

  /** Pide a React que vuelva a renderizar el contenido de la ficha genérica. */
  function _notificarCuadroInfo() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarCuadroInfo === 'function') {
      window.SimbiosisUI.notificarCuadroInfo();
    }
  }

  if (typeof window !== 'undefined' && window.SimbiosisUI) {
    /** Snapshot que React necesita para pintar la ficha (null si no hay ficha). */
    window.SimbiosisUI.datosPopupSitio = () => {
      if (!_popupSitio || !_popupOverlay) return null;
      return {
        cont: _popupOverlay,
        sitio: _popupSitio,
        color: colorCategoria(_popupSitio.categoria),
      };
    };
    /** Snapshot de la ficha genérica (null si no hay ficha). */
    window.SimbiosisUI.datosCuadroInfo = () => {
      if (!_cuadroInfoSnapshot || !_popupOverlay) return null;
      return { cont: _popupOverlay, info: _cuadroInfoSnapshot };
    };
    /** Ejecuta la acción del botón i-ésimo de la ficha genérica (lo llama React). */
    window.SimbiosisUI.ejecutarBotonCuadro = (i) => {
      const b = _cuadroInfoSnapshot && _cuadroInfoSnapshot.botones && _cuadroInfoSnapshot.botones[i];
      if (b && b.accion) b.accion();
    };
    /** Ejecuta la acción del botón de cabecera de la ficha genérica. */
    window.SimbiosisUI.ejecutarCabeceraCuadro = () => {
      if (_cuadroInfoSnapshot && _cuadroInfoSnapshot.botonCabecera && _cuadroInfoSnapshot.botonCabecera.accion) {
        _cuadroInfoSnapshot.botonCabecera.accion();
      }
    };
    /** Agrega el sitio del popup a la ruta (lo invoca el botón de la ficha). */
    window.SimbiosisUI.agregarParadaDesdePopup = (sitio, btn) => {
      ocultarPopupSitio();
      if (onAgregarParadaCallback) onAgregarParadaCallback(sitio, btn);
    };
    /** Cierra la ficha (lo invoca el botón × de la ficha). */
    window.SimbiosisUI.cerrarPopupSitio = () => ocultarPopupSitio();
  }

  return {
    cargarSitios,
    cargarMunicipios,
    getSitios,
    getMunicipios,
    colorCategoria,
    categoriasUnicas,
    departamentosUnicos,
    municipiosUnicos,
    crearMarcador,
    setOnAgregarParada,
    setOnMenuSitio,
    mostrarPopupSitio,
    mostrarCuadroInfo,
    ocultarPopupSitio,
  };
})();
