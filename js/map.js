/**
 * map.js
 * ---------------------------------------------------------------------------
 * Encapsula todo lo relacionado con el mapa Leaflet: inicialización, capa
 * base OpenStreetMap, factorías de íconos y la interacción sobre la ruta
 * (tooltip de distancia/tiempo al pasar el cursor).
 *
 * Expone `MapModule` con una API mínima consumida por app.js, routing.js
 * y tourism.js, de forma que ningún otro módulo manipule Leaflet a mano.
 * ---------------------------------------------------------------------------
 */
const MapModule = (() => {

  let map = null;
  let capaRuta = null;          // L.geoJSON de la ruta principal (origen -> paradas -> destino)
  let capaRutaPreview = null;   // L.geoJSON temporal: ruta de origen a un sitio en previsualización
  let markerOrigen = null;
  let markerDestino = null;
  let capaParadas = null;       // L.layerGroup con los sitios agregados a la ruta
  let clusterSitios = null;     // L.markerClusterGroup con los sitios candidatos filtrados

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

    capaParadas = L.layerGroup().addTo(map);

    // El contenedor del mapa nace con un tamaño definido por CSS (flex),
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

  /** Ícono numerado para un sitio agregado como parada de la ruta. */
  function _iconoParada(numero) {
    return L.divIcon({
      html: `<div class="parada-pin">${numero}</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14],
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
  // Paradas (sitios agregados a la ruta)
  // ---------------------------------------------------------------------

  let onEliminarParadaCallback = null;

  /** Registra la función que se ejecuta al pulsar "Quitar de la ruta" en el popup de una parada. */
  function setOnEliminarParada(callback) {
    onEliminarParadaCallback = callback;
  }

  /** Repinta los marcadores numerados de los sitios agregados a la ruta, en orden de visita. */
  function setMarcadoresParadas(paradas) {
    capaParadas.clearLayers();
    paradas.forEach((sitio, i) => {
      const marker = L.marker([sitio.lat, sitio.lon], { icon: _iconoParada(i + 1), zIndexOffset: 900 });

      marker.bindPopup(`
        <div class="popup-parada">
          <span class="popup-parada__badge">Parada ${i + 1}</span>
          <h3 class="popup-parada__nombre">${sitio.nombre}</h3>
          <button type="button" class="popup-parada__eliminar" data-parada-id="${sitio.id}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
            Quitar de la ruta
          </button>
        </div>
      `);

      // El botón de eliminar solo existe en el DOM mientras el popup está
      // abierto, por lo que el listener se ata cada vez que se abre.
      marker.on('popupopen', (e) => {
        const boton = e.popup.getElement().querySelector('.popup-parada__eliminar');
        if (boton) {
          boton.addEventListener('click', () => {
            marker.closePopup();
            if (onEliminarParadaCallback) onEliminarParadaCallback(sitio.id);
          });
        }
      });

      marker.addTo(capaParadas);
    });
  }

  function limpiarParadas() {
    capaParadas.clearLayers();
  }

  // ---------------------------------------------------------------------
  // Capa de ruta principal, con tooltip de distancia/tiempo al pasar el cursor
  // ---------------------------------------------------------------------

  /**
   * Dibuja la ruta principal sobre el mapa. Si se entrega `meta` con la
   * distancia y duración totales, se habilita un tooltip que sigue al
   * cursor mientras se recorre la línea, mostrando la distancia recorrida
   * y el tiempo estimado desde el origen hasta ese punto (incluyendo
   * cualquier desvío por paradas agregadas, ya que ambos se calculan sobre
   * la geometría real dibujada).
   */
  function dibujarRuta(geojsonLineString, meta = {}) {
    limpiarRuta();

    capaRuta = L.geoJSON(geojsonLineString, {
      style: { color: '#e35c2b', weight: 5, opacity: 0.92, lineCap: 'round' },
    }).addTo(map);

    const totalKm = (meta.distanciaMetros || 0) / 1000;
    const totalSeg = meta.duracionSegundos || 0;

    if (totalKm > 0) {
      capaRuta.eachLayer((layer) => {
        layer.bindTooltip('', { sticky: true, className: 'route-tooltip', opacity: 0.97 });
        layer.on('mousemove', (e) => {
          const snapped = turf.nearestPointOnLine(
            geojsonLineString,
            turf.point([e.latlng.lng, e.latlng.lat]),
            { units: 'kilometers' }
          );
          const distKm = Math.max(0, snapped.properties.location);
          const tiempoSeg = totalSeg * (distKm / totalKm);
          layer.setTooltipContent(
            `${distKm.toFixed(1)} km · ${Utils.formatearDuracion(tiempoSeg)} desde el origen`
          );
        });
      });
    }

    return capaRuta;
  }

  /** Dibuja una ruta de previsualización (desde el punto de desvío sobre la ruta hasta un sitio) en azul continuo, sin afectar la ruta principal. */
  function dibujarRutaPreview(geojsonLineString) {
    limpiarRutaPreview();
    capaRutaPreview = L.geoJSON(geojsonLineString, {
      style: { color: '#2f6fdb', weight: 4, opacity: 0.9, lineCap: 'round' },
    }).addTo(map);
    return capaRutaPreview;
  }

  function limpiarRutaPreview() {
    if (capaRutaPreview) { map.removeLayer(capaRutaPreview); capaRutaPreview = null; }
  }

  function limpiarRuta() {
    if (capaRuta) { map.removeLayer(capaRuta); capaRuta = null; }
  }

  function limpiarTodo() {
    limpiarRuta();
    limpiarRutaPreview();
    limpiarMarcadoresRuta();
    limpiarParadas();
    clusterSitios.clearLayers();
  }

  // ---------------------------------------------------------------------
  // Sitios turísticos candidatos (marker cluster)
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
    setMarcadoresParadas,
    setOnEliminarParada,
    limpiarParadas,
    dibujarRuta,
    dibujarRutaPreview,
    limpiarRutaPreview,
    limpiarRuta,
    limpiarTodo,
    limpiarSitios,
    agregarMarcadorSitio,
    encuadrar,
  };
})();
