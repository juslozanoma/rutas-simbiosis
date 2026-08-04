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
   * con `distanciaCorredorKm` (calculado en filters.js).
   */
  function crearMarcador(sitio) {
    const icono = MapModule.iconoSitio();
    const marker = L.marker([sitio.lat, sitio.lon], { icon: icono });
    marker.bindTooltip(sitio.nombre, {
      permanent: true,
      direction: 'top',
      offset: [0, -22],
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

    return marker;
  }

  let _popupOverlay = null;
  let _popupSitioId = null;

  function ocultarPopupSitio() {
    if (_popupOverlay) {
      _popupOverlay.remove();
      _popupOverlay = null;
    }
    if (_popupSitioId != null) {
      if (typeof MapModule !== 'undefined' && MapModule.mostrarTooltipSitio) {
        MapModule.mostrarTooltipSitio(_popupSitioId);
      }
      _popupSitioId = null;
    }
  }

  /** Monta la ficha centrada (o en la mitad inferior en celular para pueblos/paradas). */
  function _montarCuadroCentrado(nodo, abajo) {
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

    overlay.appendChild(nodo);
    mapContainer.appendChild(overlay);
    _popupOverlay = overlay;
    return true;
  }

  function mostrarPopupSitio(sitio) {
    ocultarPopupSitio();

    if (typeof MapModule !== 'undefined' && MapModule.ocultarTooltipSitio) {
      MapModule.ocultarTooltipSitio(sitio.id);
    }
    _popupSitioId = sitio.id;

    const tpl = document.getElementById('tpl-popup-sitio');
    const nodo = tpl.content.cloneNode(true);
    nodo.querySelector('.popup-sitio__cat').textContent = sitio.categoria;
    nodo.querySelector('.popup-sitio__cat').style.background = `${colorCategoria(sitio.categoria)}22`;
    nodo.querySelector('.popup-sitio__cat').style.color = colorCategoria(sitio.categoria);
    nodo.querySelector('.popup-sitio__nombre').textContent = sitio.nombre;
    nodo.querySelector('.popup-sitio__ubicacion').textContent = `${sitio.municipio}, ${sitio.departamento}`;
    nodo.querySelector('.popup-sitio__desc').textContent = sitio.descripcion || '';
    const distTxt = sitio.distanciaCorredorKm != null
      ? `A ${sitio.distanciaCorredorKm.toFixed(1)} km del corredor · ~${Math.round(sitio.tiempoDesvioMin)} min de desvío`
      : '';
    nodo.querySelector('.popup-sitio__dist').textContent = distTxt;

    const btn = nodo.querySelector('.popup-sitio__add');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      ocultarPopupSitio();
      if (onAgregarParadaCallback) onAgregarParadaCallback(sitio, btn);
    });

    const btnClose = nodo.querySelector('.popup-sitio__close');
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        ocultarPopupSitio();
      });
    }

    _montarCuadroCentrado(nodo);
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

    const tpl = document.getElementById('tpl-popup-sitio');
    const nodo = tpl.content.cloneNode(true);
    const popup = nodo.querySelector('.popup-sitio');

    const catEl = nodo.querySelector('.popup-sitio__cat');
    const color = opciones.color || colorCategoria(opciones.categoria);
    if (opciones.categoria || opciones.rio) {
      // Fila superior: categoría + altura + temperatura, a la izquierda del cerrar.
      const head = document.createElement('div');
      head.className = 'popup-sitio__head';
      popup.insertBefore(head, catEl);
      if (opciones.categoria) {
        catEl.textContent = opciones.categoria;
        catEl.style.background = `${color}22`;
        catEl.style.color = color;
        head.appendChild(catEl);
      } else {
        catEl.remove();
      }
      if (opciones.altura) {
        const a = document.createElement('span');
        a.className = 'popup-sitio__stat';
        a.textContent = opciones.altura;
        head.appendChild(a);
      }
      if (opciones.temperatura) {
        const t = document.createElement('span');
        t.className = 'popup-sitio__stat';
        t.textContent = opciones.temperatura;
        head.appendChild(t);
      }
      if (opciones.rio) {
        const r = document.createElement('span');
        r.className = 'popup-sitio__rio';
        r.textContent = opciones.rio;
        head.appendChild(r);
      }
    } else {
      catEl.remove();
    }

    nodo.querySelector('.popup-sitio__nombre').textContent = opciones.nombre || '';

    const ciudadEl = nodo.querySelector('.popup-sitio__ciudad');
    if (opciones.ciudad) ciudadEl.textContent = opciones.ciudad;
    else ciudadEl.remove();

    const ubiEl = nodo.querySelector('.popup-sitio__ubicacion');
    if (opciones.ubicacion) ubiEl.textContent = opciones.ubicacion;
    else ubiEl.remove();

    const descEl = nodo.querySelector('.popup-sitio__desc');
    if (opciones.descripcion) descEl.textContent = opciones.descripcion;
    else descEl.remove();

    const distEl = nodo.querySelector('.popup-sitio__dist');
    if (opciones.dist) distEl.textContent = opciones.dist;
    else distEl.remove();

    // Línea de datos: habitantes + superficie, debajo del nombre.
    const partes = [];
    if (opciones.poblacion) partes.push(`${opciones.poblacion} habitantes`);
    if (opciones.superficie_total) partes.push(opciones.superficie_total);
    if (partes.length) {
      const datos = document.createElement('div');
      datos.className = 'popup-sitio__datos';
      datos.textContent = partes.join(' · ');
      const nombreEl = nodo.querySelector('.popup-sitio__nombre');
      if (nombreEl && nombreEl.nextSibling) {
        nombreEl.parentNode.insertBefore(datos, nombreEl.nextSibling);
      } else if (nombreEl) {
        nombreEl.parentNode.appendChild(datos);
      } else {
        popup.appendChild(datos);
      }
    }

    nodo.querySelector('.popup-sitio__add').remove();

    if (opciones.botones && opciones.botones.length) {
      const contenedor = document.createElement('div');
      contenedor.className = 'popup-sitio__acciones';
      opciones.botones.forEach((b) => contenedor.appendChild(b));
      popup.appendChild(contenedor);
    }

    const btnClose = nodo.querySelector('.popup-sitio__close');
    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        ocultarPopupSitio();
      });
    }

    _montarCuadroCentrado(nodo, true);
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
    mostrarPopupSitio,
    mostrarCuadroInfo,
    ocultarPopupSitio,
  };
})();
