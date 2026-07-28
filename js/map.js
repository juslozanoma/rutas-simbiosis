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
  let capaRuta = null;          // L.layerGroup con la ruta principal (visible + hover)
  let _capaRutaVisible = null;  // L.geoJSON visible (delgado)
  let _capaRutaHover = null;    // L.geoJSON invisible (ancho, solo para eventos)
  let capaRutaPreview = null;   // L.geoJSON temporal: ruta de origen a un sitio en previsualización
  let markerOrigen = null;
  let markerDestino = null;
  let capaParadas = null;       // L.layerGroup con las paradas (escalas + sitios agregados)
  let capaEscalas = null;       // L.layerGroup con marcadores de municipios intermedios
  let capaAlertas = null;       // L.layerGroup con advertencias de tramos peligrosos
  let clusterSitios = null;     // L.markerClusterGroup con los sitios candidatos filtrados

  const _sitioMarkers = new Map(); // sitioId → L.marker

  // Route drag-to-reroute state
  let _rutaGeojson = null;
  let _rutaDragCallback = null;
  let _rutaDragWaypoints = null;
  let _rutaDragActive = false;
  let _rutaDragMarker = null;
  let _rutaDragStartLatLng = null;
  let _rutaDragSegIdx = -1;

  // Marking dangerous road state
  let _ctxMenu = null;
  let _ctxMenuLngLat = null;
  let _marcandoTramo = false;
  let _marcandoPaso = 0; // 0=inactivo, 1=esperando punto A, 2=esperando punto B
  let _marcandoPtoA = null;
  let _marcandoPtoB = null;
  let _marcandoLinea = null;
  let _marcandoMarkerA = null;
  let _marcandoMarkerB = null;
  let _onTramoCompletado = null;

  const CENTRO_COLOMBIA = [4.6, -74.1];
  const ZOOM_INICIAL = 6;

  /** Inicializa el mapa y las capas base. Debe llamarse una sola vez. */
  function init(elementId) {
    map = L.map(elementId, {
      zoomControl: false,
      minZoom: 5,
      maxZoom: 18,
    }).setView(CENTRO_COLOMBIA, ZOOM_INICIAL);

    // Desactivar boxZoom (evita rectángulo al hacer clic en la ruta)
    map.boxZoom.disable();
    map.doubleClickZoom.disable();

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    // Pane custom para clusters (z-index alto para quedar sobre tooltips y marcadores)
    const clusterPane = map.createPane('clusterPane');
    clusterPane.style.zIndex = 800;

    map.getPane('markerPane').style.zIndex = 700;

    clusterSitios = L.markerClusterGroup({
      maxClusterRadius: 45,
      clusterPane: 'clusterPane',
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
    capaEscalas = L.layerGroup().addTo(map);
    capaAlertas = L.layerGroup().addTo(map);

    // El contenedor del mapa nace con un tamaño definido por CSS (flex),
    // por lo que conviene forzar un recálculo tras el primer render.
    setTimeout(() => map.invalidateSize(), 0);

    // Menú contextual (clic secundario)
    map.on('contextmenu', _onMapContextMenu);
    document.addEventListener('click', _cerrarCtxMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelarMarcadoTramo(); });

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

  function _pinDivIcon(colorHex, letra) {
    const svg = `
      <svg class="pin-svg" width="28" height="38" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25c0-8.3-6.7-15-15-15z" fill="${colorHex}"/>
        <circle cx="15" cy="15" r="6" fill="#ffffff"/>
        <text class="pin-letter" x="15" y="18.5" text-anchor="middle">${letra}</text>
      </svg>`;
    return L.divIcon({
      html: `<div class="pin-icon">${svg}</div>`,
      className: '',
      iconSize: [28, 38],
      iconAnchor: [14, 38],
      popupAnchor: [0, -34],
    });
  }

  function iconoOrigen() { return _pinDivIcon('#2f7a6b', 'A'); }
  function iconoDestino() { return _pinDivIcon('#e35c2b', 'Z'); }

  function iconoSitio() {
    return L.divIcon({
      html: `<div class="sitio-pin"></div>`,
      className: '',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -16],
    });
  }

  /** Ícono numerado para un sitio agregado como parada de la ruta. */
  function _iconoParada(numero) {
    return L.divIcon({
      html: `<div class="parada-pin parada-pin--parada">${numero}</div>`,
      className: '',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -17],
    });
  }

  /** Ícono numerado para una escala (municipio intermedio). */
  function _iconoEscala(numero) {
    return L.divIcon({
      html: `<div class="parada-pin parada-pin--escala">${numero}</div>`,
      className: '',
      iconSize: [30, 30],
      iconAnchor: [15, 15],
      popupAnchor: [0, -17],
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
      const num = sitio._numero || i + 1;
      const marker = L.marker([sitio.lat, sitio.lon], { icon: _iconoParada(num), zIndexOffset: 900 });

      const distTxt = sitio.distanciaRutaKm != null
        ? `A ${sitio.distanciaRutaKm.toFixed(1)} km del corredor · ~${Math.round(sitio.tiempoDesvioMin)} min de desvío`
        : '';
      const cat = sitio.categoria || '';

      marker.bindPopup(`
        <div class="popup-sitio">
          <span class="popup-sitio__cat">${cat}</span>
          <h3 class="popup-sitio__nombre">${sitio.nombre}</h3>
          <p class="popup-sitio__ubicacion">${sitio.municipio ? `${sitio.municipio}, ` : ''}${sitio.departamento || ''}</p>
          <p class="popup-sitio__desc">${sitio.descripcion || ''}</p>
          <p class="popup-sitio__dist mono">${distTxt}</p>
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
        const el = e.popup.getElement();
        const catBadge = el.querySelector('.popup-sitio__cat');
        if (catBadge && sitio.categoria) {
          const color = (typeof TourismModule !== 'undefined' && TourismModule.colorCategoria)
            ? TourismModule.colorCategoria(sitio.categoria)
            : '#6c7369';
          catBadge.style.background = `${color}22`;
          catBadge.style.color = color;
        }
        const boton = el.querySelector('.popup-parada__eliminar');
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

  /** Repinta los marcadores numerados de las escalas (municipios intermedios). */
  function setMarcadoresEscalas(escalas) {
    capaEscalas.clearLayers();
    escalas.forEach((e, i) => {
      if (e.lat == null || e.lon == null) return;
      if (e._dragGenerated) return;
      const num = e._numero || i + 1;
      const marker = L.marker([e.lat, e.lon], { icon: _iconoEscala(num), zIndexOffset: 950 });
      marker.bindTooltip(e.nombre, { direction: 'top' });
      marker.addTo(capaEscalas);
    });
  }

  function limpiarEscalas() {
    capaEscalas.clearLayers();
  }

  // ---------------------------------------------------------------------
  // Alertas de tramos peligrosos
  // ---------------------------------------------------------------------

  function mostrarAlertaRuta(lnglat, mensaje, color) {
    const icon = L.divIcon({
      html: `<div class="alerta-ruta-icon" style="color:${color || '#e5a000'}">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2L1 21h22L12 2z"/>
          <path d="M12 9v4"/>
          <path d="M12 17h.01"/>
        </svg>
      </div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const marker = L.marker(lnglat, { icon, zIndexOffset: 1050 });
    marker.bindTooltip(mensaje, {
      direction: 'top',
      className: 'alerta-ruta-tooltip',
      offset: [0, -16],
    });
    marker.addTo(capaAlertas);
    return marker;
  }

  function limpiarAlertas() {
    capaAlertas.clearLayers();
  }

  // ---------------------------------------------------------------------
  // Menú contextual y marcación de tramos peligrosos
  // ---------------------------------------------------------------------

  function setOnTramoCompletado(callback) {
    _onTramoCompletado = callback;
  }

  function _onMapContextMenu(e) {
    if (_marcandoTramo) return;
    _cerrarCtxMenu();
    _ctxMenuLngLat = e.latlng;
    const div = document.createElement('div');
    div.className = 'ctx-menu';
    div.innerHTML = '<div class="ctx-menu__item">Marcar tramo destapado</div>';
    div.querySelector('.ctx-menu__item').addEventListener('click', (ev) => {
      ev.stopPropagation();
      _cerrarCtxMenu();
      iniciarMarcadoTramo();
    });
    const container = map.getContainer();
    const point = map.latLngToContainerPoint(e.latlng);
    div.style.left = Math.min(point.x, container.offsetWidth - 190) + 'px';
    div.style.top = Math.min(point.y, container.offsetHeight - 36) + 'px';
    container.appendChild(div);
    _ctxMenu = div;
  }

  function _cerrarCtxMenu() {
    if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  }

  function _limpiarMarcadoTramo() {
    if (_marcandoMarkerA) { map.removeLayer(_marcandoMarkerA); _marcandoMarkerA = null; }
    if (_marcandoMarkerB) { map.removeLayer(_marcandoMarkerB); _marcandoMarkerB = null; }
    if (_marcandoLinea) { map.removeLayer(_marcandoLinea); _marcandoLinea = null; }
    _marcandoPtoA = null;
    _marcandoPtoB = null;
  }

  function cancelarMarcadoTramo() {
    if (!_marcandoTramo) return;
    _marcandoTramo = false;
    _marcandoPaso = 0;
    _limpiarMarcadoTramo();
    map.getContainer().style.cursor = '';
    map.off('click', _onMarcarClick);
  }

  function iniciarMarcadoTramo() {
    cancelarMarcadoTramo();
    _marcandoTramo = true;
    _marcandoPaso = 1;
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', _onMarcarClick);
  }

  function _onMarcarClick(e) {
    if (!_marcandoTramo) return;
    const latlng = e.latlng;
    if (_marcandoPaso === 1) {
      _marcandoPtoA = [latlng.lng, latlng.lat];
      _marcandoMarkerA = L.marker(latlng, {
        icon: L.divIcon({ html: '<div class="marcando-pin marcando-pin--a">A</div>', className: '', iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).bindTooltip('Punto inicial', { direction: 'top' }).addTo(map);
      _marcandoPaso = 2;
    } else if (_marcandoPaso === 2) {
      _marcandoPtoB = [latlng.lng, latlng.lat];
      _marcandoMarkerB = L.marker(latlng, {
        icon: L.divIcon({ html: '<div class="marcando-pin marcando-pin--b">B</div>', className: '', iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).bindTooltip('Punto final', { direction: 'top' }).addTo(map);
      _marcandoLinea = L.polyline([L.latLng(_marcandoPtoA[1], _marcandoPtoA[0]), latlng], {
        color: '#e5a000', weight: 4, dashArray: '8 6', opacity: 0.9,
      }).addTo(map);
      _marcandoPaso = 0;
      _marcandoTramo = false;
      map.getContainer().style.cursor = '';
      map.off('click', _onMarcarClick);
      if (_onTramoCompletado) {
        _onTramoCompletado({
          inicio: _marcandoPtoA,
          fin: _marcandoPtoB,
          limpiar: () => _limpiarMarcadoTramo(),
        });
      }
    }
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
    _rutaGeojson = geojsonLineString;

    _capaRutaVisible = L.geoJSON(geojsonLineString, {
      style: { color: '#2f7a6b', weight: 4, opacity: 0.85, lineCap: 'round' },
      interactive: false,
    }).addTo(map);

    _capaRutaHover = L.geoJSON(geojsonLineString, {
      style: { color: '#2f7a6b', weight: 20, opacity: 0 },
      interactive: true,
    }).addTo(map);

    _capaRutaVisible.bringToFront();
    _capaRutaHover.bringToFront();

    capaRuta = _capaRutaHover;

    const totalKm = (meta.distanciaMetros || 0) / 1000;
    const totalSeg = meta.duracionSegundos || 0;
    const origenNombre = meta.origenNombre || 'el origen';

    if (totalKm > 0) {
      _capaRutaHover.eachLayer((layer) => {
        layer.bindTooltip('', { sticky: true, className: 'route-tooltip', opacity: 0.97 });
        layer.on('mousemove', (e) => {
          if (_rutaDragActive) return;
          const snapped = turf.nearestPointOnLine(
            geojsonLineString,
            turf.point([e.latlng.lng, e.latlng.lat]),
            { units: 'kilometers' }
          );
          const distKm = Math.max(0, snapped.properties.location);
          const tiempoSeg = totalSeg * (distKm / totalKm);
          layer.setTooltipContent(
            `${distKm.toFixed(1)} km · ${Utils.formatearDuracion(tiempoSeg)} desde ${origenNombre}`
          );
        });
      });
    }

    // Always add drag handler (even without tooltip)
    _capaRutaHover.eachLayer((layer) => {
      layer.on('mousedown', _onRutaMouseDown);
    });

    return capaRuta;
  }

  // ---------------------------------------------------------------------
  // Arrastre de tramo para reruteo
  // ---------------------------------------------------------------------

  function habilitarArrastreRuta(waypointsCoords, callback) {
    _rutaDragWaypoints = waypointsCoords;
    _rutaDragCallback = callback;
  }

  function _onRutaMouseDown(e) {
    if (!_rutaDragCallback || !_rutaDragWaypoints || _rutaDragWaypoints.length < 2 || !_rutaGeojson) return;
    if (_rutaDragActive) return;

    // Detener propagación para que no llegue al contenedor del mapa
    if (e.originalEvent) {
      e.originalEvent.stopImmediatePropagation();
      L.DomEvent.preventDefault(e.originalEvent);
    }

    _rutaDragActive = true;
    _rutaDragStartLatLng = e.latlng;
    _rutaDragSegIdx = -1;

    map.dragging.disable();

    try {
      const clickPt = turf.point([e.latlng.lng, e.latlng.lat]);
      const nearest = turf.nearestPointOnLine(_rutaGeojson, clickPt, { units: 'kilometers' });
      const clickLocation = nearest.properties.location;

      const wpLocations = _rutaDragWaypoints.map((wp) => {
        const wpPt = turf.point(wp);
        const nearestWp = turf.nearestPointOnLine(_rutaGeojson, wpPt, { units: 'kilometers' });
        return nearestWp.properties.location || 0;
      });

      for (let i = 0; i < wpLocations.length - 1; i++) {
        const min = Math.min(wpLocations[i], wpLocations[i + 1]);
        const max = Math.max(wpLocations[i], wpLocations[i + 1]);
        if (clickLocation >= min && clickLocation <= max) {
          _rutaDragSegIdx = i;
          break;
        }
      }
    } catch (err) {
      _rutaDragActive = false;
      map.dragging.enable();
      return;
    }

    _rutaDragMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        html: '<div class="ruta-drag-handle"></div>',
        className: '',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
      zIndexOffset: 1300,
      interactive: false,
    }).addTo(map);

    document.addEventListener('mousemove', _onRutaDragMoveDoc);
    document.addEventListener('mouseup', _onRutaDragEndDoc);
  }

  function _latlngFromMouseEvent(domEvent) {
    const containerPoint = map.mouseEventToContainerPoint(domEvent);
    return map.containerPointToLatLng(containerPoint);
  }

  function _onRutaDragMoveDoc(domEvent) {
    if (!_rutaDragMarker) return;
    const latlng = _latlngFromMouseEvent(domEvent);
    _rutaDragMarker.setLatLng(latlng);
  }

  function _onRutaDragEndDoc(domEvent) {
    document.removeEventListener('mousemove', _onRutaDragMoveDoc);
    document.removeEventListener('mouseup', _onRutaDragEndDoc);

    if (_rutaDragMarker) {
      map.removeLayer(_rutaDragMarker);
      _rutaDragMarker = null;
    }

    map.dragging.enable();

    if (!_rutaDragActive) return;
    _rutaDragActive = false;

    if (!_rutaDragStartLatLng) return;

    const finalLatLng = _latlngFromMouseEvent(domEvent);
    const dist = _rutaDragStartLatLng.distanceTo(finalLatLng);
    if (dist < 10 || _rutaDragSegIdx < 0) return;

    if (_rutaDragCallback) {
      _rutaDragCallback([finalLatLng.lng, finalLatLng.lat], _rutaDragSegIdx);
    }
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
    if (_capaRutaVisible) { map.removeLayer(_capaRutaVisible); _capaRutaVisible = null; }
    if (_capaRutaHover) { map.removeLayer(_capaRutaHover); _capaRutaHover = null; }
    capaRuta = null;
  }

  function limpiarTodo() {
    limpiarRuta();
    limpiarRutaPreview();
    limpiarMarcadoresRuta();
    limpiarParadas();
    limpiarEscalas();
    limpiarAlertas();
    clusterSitios.clearLayers();
  }

  // ---------------------------------------------------------------------
  // Sitios turísticos candidatos (marker cluster)
  // ---------------------------------------------------------------------

  function limpiarSitios() {
    _sitioMarkers.clear();
    clusterSitios.clearLayers();
  }

  function agregarMarcadorSitio(marker) {
    clusterSitios.addLayer(marker);
    if (marker.__sitioId != null) _sitioMarkers.set(marker.__sitioId, marker);
  }

  function abrirPopupSitio(sitioId) {
    const marker = _sitioMarkers.get(sitioId);
    if (!marker) return;
    const grupo = clusterSitios;
    if (!map.hasLayer(grupo)) map.addLayer(grupo);
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13));
    marker.openPopup();
  }

  function toggleSitios() {
    if (map.hasLayer(clusterSitios)) {
      map.removeLayer(clusterSitios);
      return false;
    } else {
      map.addLayer(clusterSitios);
      return true;
    }
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
    setMarcadoresEscalas,
    limpiarEscalas,
    mostrarAlertaRuta,
    limpiarAlertas,
    setOnTramoCompletado,
    cancelarMarcadoTramo,
    dibujarRuta,
    habilitarArrastreRuta,
    dibujarRutaPreview,
    limpiarRutaPreview,
    limpiarRuta,
    limpiarTodo,
    limpiarSitios,
    agregarMarcadorSitio,
    toggleSitios,
    abrirPopupSitio,
    encuadrar,
  };
})();
