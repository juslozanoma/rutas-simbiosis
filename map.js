/**
 * map.js
 * ---------------------------------------------------------------------------
 * Encapsula todo lo relacionado con el mapa Leaflet: inicialización, capa
 * base OpenStreetMap y factorías de íconos. En la versión minimalista no
 * existen controles de capas ni barra de coordenadas: el mapa se limita a
 * mostrar la ruta, el corredor de búsqueda y los sitios turísticos.
 *
 * Expone `MapModule` con una API mínima consumida por app.js, routing.js
 * y tourism.js, de forma que ningún otro módulo manipule Leaflet a mano.
 * ---------------------------------------------------------------------------
 */
const MapModule = (() => {

  let map = null;
  let capaRuta = null;          // L.geoJSON de la polilínea calculada
  let markerOrigen = null;
  let markerDestino = null;
  let clusterSitios = null;     // L.markerClusterGroup con los sitios filtrados

  const CENTRO_COLOMBIA = [4.6, -74.1];
  const ZOOM_INICIAL = 6;

  /** Inicializa el mapa y las capas base. Debe llamarse una sola vez. */
  function init(elementId) {
    map = L.map(elementId, {
      zoomControl: false,
      minZoom: 5,
      maxZoom: 18,
    }).setView(CENTRO_COLOMBIA, ZOOM_INICIAL);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    clusterSitios = L.markerClusterGroup({
      maxClusterRadius: 45,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount();
        return L.divIcon({
          html: `<div class="marker-cluster-custom" style="width:${34 + Math.min(count, 30)}px;height:${34 + Math.min(count, 30)}px;">${count}</div>`,
          className: '',
          iconSize: null,
        });
      },
    });
    clusterSitios.addTo(map);

    // El contenedor del mapa nace con un tamaño definido por CSS (aspect-ratio),
    // por lo que conviene forzar un recálculo tras el primer render.
    setTimeout(() => map.invalidateSize(), 0);

    return map;
  }

  /** Devuelve la instancia cruda de Leaflet (uso controlado, solo lectura conceptual). */
  function getMap() {
    return map;
  }

  /** Fuerza a Leaflet a recalcular el tamaño del contenedor (tras cambios de layout). */
  function invalidateSize() {
    if (map) map.invalidateSize();
  }

  // ---------------------------------------------------------------------
  // Íconos
  // ---------------------------------------------------------------------

  function _pinDivIcon(colorHex) {
    const svg = `
      <svg class="pin-svg" width="28" height="38" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25c0-8.3-6.7-15-15-15z" fill="${colorHex}"/>
        <circle cx="15" cy="15" r="6" fill="#ffffff"/>
      </svg>`;
    return L.divIcon({
      html: `<div class="pin-icon">${svg}</div>`,
      className: '',
      iconSize: [28, 38],
      iconAnchor: [14, 38],
      popupAnchor: [0, -34],
    });
  }

  function iconoOrigen() { return _pinDivIcon('#2f7a6b'); }
  function iconoDestino() { return _pinDivIcon('#e35c2b'); }

  function iconoSitio(colorHex) {
    return L.divIcon({
      html: `<div class="site-dot" style="background:${colorHex}"></div>`,
      className: '',
      iconSize: [13, 13],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8],
    });
  }

  // ---------------------------------------------------------------------
  // Marcadores de origen / destino
  // ---------------------------------------------------------------------

  function setMarcadorOrigen(lat, lon, etiqueta) {
    if (markerOrigen) map.removeLayer(markerOrigen);
    markerOrigen = L.marker([lat, lon], { icon: iconoOrigen(), zIndexOffset: 1000 })
      .bindTooltip(`Origen: ${etiqueta}`, { direction: 'top' })
      .addTo(map);
  }

  function setMarcadorDestino(lat, lon, etiqueta) {
    if (markerDestino) map.removeLayer(markerDestino);
    markerDestino = L.marker([lat, lon], { icon: iconoDestino(), zIndexOffset: 1000 })
      .bindTooltip(`Destino: ${etiqueta}`, { direction: 'top' })
      .addTo(map);
  }

  function limpiarMarcadoresRuta() {
    if (markerOrigen) { map.removeLayer(markerOrigen); markerOrigen = null; }
    if (markerDestino) { map.removeLayer(markerDestino); markerDestino = null; }
  }

  // ---------------------------------------------------------------------
  // Capa de ruta y buffer
  // ---------------------------------------------------------------------

  function dibujarRuta(geojsonLineString) {
    limpiarRuta();
    capaRuta = L.geoJSON(geojsonLineString, {
      style: { color: '#e35c2b', weight: 5, opacity: 0.92, lineCap: 'round' },
    }).addTo(map);
    return capaRuta;
  }

  function limpiarRuta() {
    if (capaRuta) { map.removeLayer(capaRuta); capaRuta = null; }
  }

  function limpiarTodo() {
    limpiarRuta();
    limpiarMarcadoresRuta();
    clusterSitios.clearLayers();
  }

  // ---------------------------------------------------------------------
  // Sitios turísticos (marker cluster)
  // ---------------------------------------------------------------------

  function limpiarSitios() {
    clusterSitios.clearLayers();
  }

  function agregarMarcadorSitio(marker) {
    clusterSitios.addLayer(marker);
  }

  // ---------------------------------------------------------------------
  // Encuadre / zoom
  // ---------------------------------------------------------------------

  function encuadrar(geojsonOrLatLngs, padding = [30, 30]) {
    let bounds;
    if (geojsonOrLatLngs && geojsonOrLatLngs.type) {
      bounds = L.geoJSON(geojsonOrLatLngs).getBounds();
    } else {
      bounds = L.latLngBounds(geojsonOrLatLngs);
    }
    if (bounds.isValid()) map.fitBounds(bounds, { padding });
  }

  return {
    init,
    getMap,
    invalidateSize,
    iconoSitio,
    setMarcadorOrigen,
    setMarcadorDestino,
    limpiarMarcadoresRuta,
    dibujarRuta,
    limpiarRuta,
    limpiarTodo,
    limpiarSitios,
    agregarMarcadorSitio,
    encuadrar,
  };
})();
