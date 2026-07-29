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

    const wrapper = document.createElement('div');
    wrapper.appendChild(nodo);
    marker.bindPopup(wrapper.innerHTML, { className: 'sitio-popup' });
    marker.__sitioId = sitio.id;

    marker.on('popupopen', (e) => {
      const popupEl = e.popup.getElement();
      const container = popupEl.closest('.leaflet-popup');
      if (container) {
        container.style.position = 'fixed';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.margin = '0';
      }
      let backdrop = document.getElementById('popup-backdrop');
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'popup-backdrop';
        document.body.appendChild(backdrop);
      }
      backdrop.hidden = false;
      backdrop.addEventListener('click', () => marker.closePopup(), { once: true });

      const btn = popupEl.querySelector('.popup-sitio__add');
      if (btn && !btn.dataset._listener) {
        btn.dataset._listener = '1';
        btn.addEventListener('click', () => {
          marker.closePopup();
          if (onAgregarParadaCallback) onAgregarParadaCallback(sitio, btn);
        });
      }
    });
    marker.on('popupclose', () => {
      const backdrop = document.getElementById('popup-backdrop');
      if (backdrop) backdrop.hidden = true;
    });

    return marker;
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
  };
})();
