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
  let capaPuntosDesvio = null;  // L.layerGroup con puntos de desvío (círculos pequeños)
  let capaAlertas = null;       // L.layerGroup con advertencias de tramos peligrosos
  let capaFrontera = null;      // L.layerGroup overlay de prueba: sitios de frontera
  let clusterSitios = null;     // L.markerClusterGroup con los sitios candidatos filtrados
  let _capaFlechas = null;      // L.layerGroup con flechas de dirección sobre la ruta

  const ZOOM_MIN_FLECHA = 9;    // Zoom mínimo para mostrar la flecha de dirección

  const _sitioMarkers = new Map(); // sitioId → L.marker
  const _marcadorParadas = new Map(); // paradaId → L.marker (sitios ya agregados a la ruta)
  const _marcadorEscalas = new Map(); // escalaId → L.marker (municipios intermedios)
  const _marcadorPuntosDesvio = new Map(); // escalaId → L.marker (puntos de desvío arrastrados)
  let _coordOrigen = null; // [lat, lon]
  let _coordDestino = null; // [lat, lon]

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
  let _marcandoTramo = false;
  let _marcandoPtoA = null;
  let _marcandoSegmento = null;
  let _marcandoLinea = null;
  let _marcandoMarkerA = null;
  let _onTramoCompletado = null;

  const CENTRO_COLOMBIA = [4.6, -74.1];
  const ZOOM_INICIAL = 6;

  /** Inicializa el mapa y las capas base. Debe llamarse una sola vez. */
  function init(elementId) {
    map = L.map(elementId, {
      zoomControl: false,
      minZoom: 5,
      maxZoom: 18,
      zoomSnap: 0.25,
      zoomDelta: 0.25,
    }).setView(CENTRO_COLOMBIA, ZOOM_INICIAL);

    // Desactivar boxZoom (evita rectángulo al hacer clic en la ruta)
    map.boxZoom.disable();
    map.doubleClickZoom.disable();

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    // Pane custom para clusters (z-index alto para quedar sobre tooltips y marcadores)
    const clusterPane = map.createPane('clusterPane');
    clusterPane.style.zIndex = 800;

    map.getPane('markerPane').style.zIndex = 700;
    map.getPane('tooltipPane').style.zIndex = 850;

    // El panel de popups debe quedar sobre tooltips de sitios y clusters
    // (círculos oscuros) para que las fichas de información no queden ocultas.
    map.getPane('popupPane').style.zIndex = 900;

    clusterSitios = L.markerClusterGroup({
      maxClusterRadius: 45,
      showCoverageOnHover: false,
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
    capaPuntosDesvio = L.layerGroup().addTo(map);
    capaAlertas = L.layerGroup().addTo(map);
    capaFrontera = L.layerGroup().addTo(map);

    // El contenedor del mapa nace con un tamaño definido por CSS (flex),
    // por lo que conviene forzar un recálculo tras el primer render.
    setTimeout(() => map.invalidateSize(), 0);

    // Menú contextual (clic secundario)
    map.on('contextmenu', _onMapContextMenu);
    document.addEventListener('click', _cerrarCtxMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cancelarMarcadoTramo(); });

    // La flecha de dirección se mantiene centrada en el tramo de ruta visible
    map.on('moveend', () => {
      if (_capaFlechas) _actualizarFlechaRuta();
    });

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

  function _pinDivIcon(letra) {
    const svg = `
      <svg class="pin-svg" width="28" height="38" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25c0-8.3-6.7-15-15-15z" fill="#2f7a6b"/>
        <text class="pin-letter" x="15" y="19.5" text-anchor="middle" fill="#ffffff">${letra}</text>
      </svg>`;
    return L.divIcon({
      html: `<div class="pin-icon">${svg}</div>`,
      className: '',
      iconSize: [28, 38],
      iconAnchor: [14, 38],
      popupAnchor: [0, -34],
    });
  }

  function iconoOrigen() { return _pinDivIcon('A'); }
  function iconoDestino() { return _pinDivIcon('Z'); }

  function iconoSitio() {
    return L.divIcon({
      html: `<div class="sitio-pin">
        <svg viewBox="0 0 32 32" width="18" height="18" fill="#ffffff"><path d="M29.83,17.45l-2-3A1,1,0,0,0,27,14H17V12h8a1,1,0,0,0,1-1V5a1,1,0,0,0-1-1H17V3a1,1,0,0,0-2,0V4H6a1,1,0,0,0-.71.29l-3,3a1,1,0,0,0,0,1.41l3,3A1,1,0,0,0,6,12h9v2H7a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h8v6H11a1,1,0,0,0,0,2H21a1,1,0,0,0,0-2H17V22H27a1,1,0,0,0,.83-.45l2-3A1,1,0,0,0,29.83,17.45Z"/></svg>
      </div>`,
      className: '',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -20],
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
    markerOrigen = L.marker([lat, lon], { icon: iconoOrigen(), zIndexOffset: 50 })
      .bindTooltip(`Origen: ${etiqueta}`, { direction: 'top', offset: [0, -10] })
      .addTo(map);
    _coordOrigen = [lat, lon];
  }

  function setMarcadorDestino(lat, lon, etiqueta) {
    if (markerDestino) map.removeLayer(markerDestino);
    markerDestino = L.marker([lat, lon], { icon: iconoDestino(), zIndexOffset: 50 })
      .bindTooltip(`Destino: ${etiqueta}`, { direction: 'top', offset: [0, -10] })
      .addTo(map);
    _coordDestino = [lat, lon];
  }

  function limpiarMarcadoresRuta() {
    if (markerOrigen) { map.removeLayer(markerOrigen); markerOrigen = null; }
    if (markerDestino) { map.removeLayer(markerDestino); markerDestino = null; }
    _coordOrigen = null;
    _coordDestino = null;
  }

  /** Nivel de zoom al que se enfoca la vista al pulsar una fila de parada/extremo. */
  const ZOOM_ENFOQUE_MUNICIPIO = 13;

  /** Enfoca la vista sobre un punto acercándola al menos al zoom municipal. */
  function enfocarLugar(lat, lon) {
    if (lat == null || lon == null) return;
    map.setView([lat, lon], Math.max(map.getZoom(), ZOOM_ENFOQUE_MUNICIPIO), { animate: true });
  }

  /** Desplaza la vista para que el cuadro (popup) abierto quede centrado en el mapa. */
  function _centrarPopupEnVista(marker) {
    const popup = marker && marker.getPopup ? marker.getPopup() : null;
    if (!popup) return;
    let hecho = false;
    const aplicar = () => {
      if (hecho) return;
      const el = popup.getElement();
      if (!el || !el.isConnected) return;
      const pr = el.getBoundingClientRect();
      if (!pr.width || !pr.height) return;
      const cr = map.getContainer().getBoundingClientRect();
      const dx = (pr.left + pr.width / 2) - (cr.left + cr.width / 2);
      const dy = (pr.top + pr.height / 2) - (cr.top + cr.height / 2);
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        map.panBy([-dx, -dy], { animate: true });
      }
      hecho = true;
      clearTimeout(temporizador);
    };
    map.once('moveend', aplicar);
    const temporizador = setTimeout(aplicar, 800);
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
    _marcadorParadas.clear();
    paradas.forEach((sitio, i) => {
      const num = sitio._numero || i + 1;
      const marker = L.marker([sitio.lat, sitio.lon], { icon: _iconoParada(num), zIndexOffset: 900 });
      _marcadorParadas.set(sitio.id, marker);

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
    _marcadorParadas.clear();
  }

  /** Repinta los marcadores numerados de las escalas (municipios intermedios). */
  function setMarcadoresEscalas(escalas) {
    capaEscalas.clearLayers();
    _marcadorEscalas.clear();
    let indiceEscala = 0;
    escalas.forEach((e) => {
      if (e.lat == null || e.lon == null) return;
      if (e._dragGenerated) return;
      const num = e._numero || ++indiceEscala;
      const marker = L.marker([e.lat, e.lon], { icon: _iconoEscala(num), zIndexOffset: 950 });
      _marcadorEscalas.set(e.id, marker);
      const muni = _municipioDe(e);
      marker.bindPopup(`
        <div class="popup-sitio">
          <div class="popup-sitio__head">
            <span class="popup-sitio__cat">Pueblo intermedio</span>
            ${muni && muni.temperatura_promedio ? `<span class="popup-sitio__stat">${muni.temperatura_promedio}</span>` : ''}
            ${muni && muni.altura ? `<span class="popup-sitio__stat">${muni.altura}</span>` : ''}
          </div>
          <h3 class="popup-sitio__nombre">${e.nombre || ''}</h3>
          <p class="popup-sitio__ubicacion">${e.departamento ? `${e.nombre || ''}, ${e.departamento}` : (e.nombre || '')}</p>
          ${muni && muni.descripción ? `<p class="popup-sitio__desc">${muni.descripción}</p>` : ''}
          ${_htmlDatosMunicipio(muni)}
          <p class="popup-sitio__dist mono"></p>
        </div>
      `);
      marker.on('popupopen', (ev) => {
        const el = ev.popup.getElement();
        const catBadge = el && el.querySelector('.popup-sitio__cat');
        if (catBadge) {
          catBadge.style.background = '#4a6fa522';
          catBadge.style.color = '#4a6fa5';
        }
      });
      marker.addTo(capaEscalas);
    });
  }

  function limpiarEscalas() {
    capaEscalas.clearLayers();
    _marcadorEscalas.clear();
  }

  /** Busca el municipio del catálogo para un punto (por id o nombre). */
  function _municipioDe(punto) {
    if (!punto || typeof TourismModule === 'undefined' || !TourismModule.getMunicipios) return null;
    const munis = TourismModule.getMunicipios();
    return (munis || []).find((m) => m.id === punto.id || (punto.nombre && m.nombre === punto.nombre)) || null;
  }

  /** HTML de la línea inferior de datos del municipio (habitantes + superficies). */
  function _htmlDatosMunicipio(muni) {
    if (!muni) return '';
    const partes = [];
    if (muni.poblacion_total) partes.push(`${muni.poblacion_total} habitantes`);
    if (muni.superficie_total) partes.push(`Superficie: ${muni.superficie_total}`);
    if (muni.superficie_urbana) partes.push(`urbana: ${muni.superficie_urbana}`);
    return partes.length ? `<div class="popup-sitio__datos">${partes.join(' · ')}</div>` : '';
  }

  // ---------------------------------------------------------------------
  // Puntos de desvío (generados al arrastrar un tramo de la ruta)
  // ---------------------------------------------------------------------

  let _onMenuPuntoDesvio = null;   // (escalaId, clientX, clientY) => void
  let _onMoverPuntoDesvio = null;  // (escalaId, lat, lon) => void

  /** Registra la función que abre el menú contextual del punto de desvío. */
  function setOnMenuPuntoDesvio(callback) {
    _onMenuPuntoDesvio = callback;
  }

  /** Registra la función que se ejecuta al soltar un punto de desvío arrastrado. */
  function setOnMoverPuntoDesvio(callback) {
    _onMoverPuntoDesvio = callback;
  }

  /** Repinta los puntos de desvío (escalas `_dragGenerated`) como círculos pequeños y arrastrables. */
  function setMarcadoresPuntosDesvio(escalas) {
    capaPuntosDesvio.clearLayers();
    _marcadorPuntosDesvio.clear();
    escalas.forEach((e) => {
      if (!e._dragGenerated || e.lat == null || e.lon == null) return;
      const marker = L.marker([e.lat, e.lon], {
        icon: L.divIcon({
          html: '<div class="desvio-point"></div>',
          className: '',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
        draggable: true,
        zIndexOffset: 1400,
      });

      _marcadorPuntosDesvio.set(e.id, marker);

      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        if (_onMoverPuntoDesvio) _onMoverPuntoDesvio(e.id, ll.lat, ll.lng);
      });

      // Menú contextual (clic secundario / pulsación larga) sobre el punto
      marker.on('contextmenu', (ev) => {
        if (ev.originalEvent) {
          ev.originalEvent.preventDefault();
          ev.originalEvent.stopPropagation();
        }
        if (_onMenuPuntoDesvio) {
          const p = ev.originalEvent || {};
          _onMenuPuntoDesvio(e.id, p.clientX, p.clientY);
        }
      });

      marker.on('add', () => {
        const el = marker.getElement();
        if (!el) return;
        let longPress = null;
        let startX = 0;
        let startY = 0;
        const programa = (evt) => {
          const t = evt.touches[0];
          if (!t) return;
          startX = t.clientX;
          startY = t.clientY;
          longPress = setTimeout(() => {
            longPress = null;
            if (_onMenuPuntoDesvio) _onMenuPuntoDesvio(e.id, startX, startY);
          }, 550);
        };
        const cancela = () => {
          if (longPress) { clearTimeout(longPress); longPress = null; }
        };
        el.addEventListener('touchstart', programa, { passive: true });
        el.addEventListener('touchmove', (evt) => {
          if (!longPress) return;
          const t = evt.touches[0];
          if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) cancela();
        }, { passive: true });
        el.addEventListener('touchend', cancela);
        el.addEventListener('touchcancel', cancela);
      });

      marker.addTo(capaPuntosDesvio);
    });
  }

  function limpiarPuntosDesvio() {
    capaPuntosDesvio.clearLayers();
    _marcadorPuntosDesvio.clear();
  }

  // ---------------------------------------------------------------------
  // Alertas de tramos peligrosos
  // ---------------------------------------------------------------------

function mostrarAlertaRuta(lnglat, mensaje, color) {
    const icon = L.icon({
      iconUrl: 'public/warning.svg',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -16],
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
    if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest && e.originalEvent.target.closest('.desvio-point')) return;
    _cerrarCtxMenu();
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
    if (_marcandoLinea) { map.removeLayer(_marcandoLinea); _marcandoLinea = null; }
    _marcandoPtoA = null;
    _marcandoSegmento = null;
  }

  function cancelarMarcadoTramo() {
    if (!_marcandoTramo) return;
    _marcandoTramo = false;
    _limpiarMarcadoTramo();
    map.getContainer().style.cursor = '';
    map.off('click', _onMarcarClick);
  }

  function iniciarMarcadoTramo() {
    cancelarMarcadoTramo();
    _marcandoTramo = true;
    map.getContainer().style.cursor = 'crosshair';
    map.on('click', _onMarcarClick);
  }

  function _onMarcarClick(e) {
    if (!_marcandoTramo) return;
    _marcandoTramo = false;
    map.getContainer().style.cursor = '';
    map.off('click', _onMarcarClick);

    const lnglat = [e.latlng.lng, e.latlng.lat];
    let segmento = null;
    let puntoSobreRuta = lnglat;

    // Si hay ruta dibujada, se ajusta el punto y se genera el segmento de 10km
    if (_rutaGeojson && _rutaGeojson.geometry && _rutaGeojson.geometry.coordinates.length >= 2) {
      const routeLine = turf.lineString(_rutaGeojson.geometry.coordinates);
      const nearest = turf.nearestPointOnLine(routeLine, turf.point(lnglat), { units: 'kilometers' });
      puntoSobreRuta = nearest.geometry.coordinates;
      const distAlong = nearest.properties.location || 0;
      const totalKm = turf.length(routeLine, { units: 'kilometers' });
      const startDist = Math.max(0, distAlong - 5);
      const endDist = Math.min(totalKm, distAlong + 5);
      const startPt = turf.along(routeLine, startDist, { units: 'kilometers' });
      const endPt = turf.along(routeLine, endDist, { units: 'kilometers' });
      segmento = [startPt.geometry.coordinates, endPt.geometry.coordinates];

      // Dibujar línea temporal del segmento
      _marcandoLinea = L.polyline(
        [L.latLng(startPt.geometry.coordinates[1], startPt.geometry.coordinates[0]),
         L.latLng(endPt.geometry.coordinates[1], endPt.geometry.coordinates[0])],
        { color: '#e5a000', weight: 4, dashArray: '8 6', opacity: 0.9 },
      ).addTo(map);
    }

    // Marcador en el punto clickeado (sobre la ruta si existe)
    _marcandoPtoA = puntoSobreRuta;
    _marcandoSegmento = segmento;
    _marcandoMarkerA = L.marker([puntoSobreRuta[1], puntoSobreRuta[0]], {
      icon: L.divIcon({ html: '<div class="marcando-pin marcando-pin--a"></div>', className: '', iconSize: [24, 24], iconAnchor: [12, 12] }),
    }).bindTooltip('Tramo a marcar', { direction: 'top' }).addTo(map);

    if (_onTramoCompletado) {
      _onTramoCompletado({
        punto: puntoSobreRuta,
        segmento: segmento,
        limpiar: () => _limpiarMarcadoTramo(),
      });
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
    console.log('[RUTA] dibujarRuta called', { meta });
    limpiarRuta();
    _rutaGeojson = geojsonLineString;

    _capaRutaVisible = L.geoJSON(geojsonLineString, {
      style: { color: '#2f7a6b', weight: 4, opacity: 0.85, lineCap: 'round' },
      interactive: false,
    }).addTo(map);

    _capaRutaHover = L.geoJSON(geojsonLineString, {
      style: { color: '#2f7a6b', weight: 20, opacity: 0.01, fillOpacity: 0.01 },
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
        layer.bindTooltip(' ', { sticky: true, className: 'altimetria-map-tooltip', direction: 'top' });
        layer.on('mousemove', (e) => {
          if (_rutaDragActive) return;
          const snapped = turf.nearestPointOnLine(
            geojsonLineString,
            turf.point([e.latlng.lng, e.latlng.lat]),
            { units: 'kilometers' }
          );
          const distKm = Math.max(0, snapped.properties.location);
          if (typeof AltimetriaModule !== 'undefined' && AltimetriaModule.mostrarHoverEn) {
            AltimetriaModule.mostrarHoverEn(distKm, false);
          }
          let info = {};
          if (typeof AltimetriaModule !== 'undefined' && AltimetriaModule.getInfoAt) {
            info = AltimetriaModule.getInfoAt(distKm);
          }
          const alt = info.alt;
          const seg = (distKm / totalKm) * totalSeg;
          const h = Math.floor(seg / 3600);
          const min = Math.round((seg % 3600) / 60);
          let durStr;
          if (h > 0) durStr = h + ' h ' + min + ' min';
          else durStr = min + ' min';
          let tooltipParts = [];
          if (alt != null) tooltipParts.push(alt.toFixed(0) + ' msnm');
          tooltipParts.push(distKm.toFixed(1) + ' km');
          tooltipParts.push(durStr);
          layer.setTooltipContent(tooltipParts.join(' · '));
        });
        layer.on('mouseout', () => {
          if (typeof AltimetriaModule !== 'undefined' && AltimetriaModule.ocultarHover) {
            AltimetriaModule.ocultarHover();
          }
          layer.closeTooltip();
        });
      });
    }

    // Always add drag handler (even without tooltip)
    _capaRutaHover.eachLayer((layer) => {
      layer.on('mousedown', _onRutaMouseDown);
    });

    // Direction arrow (single) always centered on the visible portion of the route
    if (_capaFlechas) map.removeLayer(_capaFlechas);
    _capaFlechas = L.layerGroup().addTo(map);
    _actualizarFlechaRuta();

    return capaRuta;
  }

  /** Ubica (o reposiciona) la única flecha en el punto medio del tramo de ruta visible en pantalla. */
  function _actualizarFlechaRuta() {
    if (!_capaFlechas || !map) return;
    _capaFlechas.clearLayers();
    // La flecha de dirección solo se muestra con el mapa suficientemente ampliado.
    if (map.getZoom() < ZOOM_MIN_FLECHA) return;
    if (!_rutaGeojson || !_rutaGeojson.geometry) return;

    let coords;
    try {
      const b = map.getBounds();
      const clipped = turf.bboxClip(_rutaGeojson, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      if (clipped && clipped.geometry && clipped.geometry.type === 'LineString') {
        coords = clipped.geometry.coordinates;
      } else if (clipped && clipped.geometry && clipped.geometry.type === 'MultiLineString') {
        coords = clipped.geometry.coordinates.reduce((a, c) => (c.length > a.length ? c : a), []);
      }
      if (coords && coords.length < 2) coords = null;
    } catch (err) {
      coords = _rutaGeojson.geometry.coordinates;
    }
    if (!coords) coords = _rutaGeojson.geometry.coordinates;
    if (!coords || coords.length < 2) return;

    const line = turf.lineString(coords);
    const km = turf.length(line, { units: 'kilometers' });
    const d = km / 2;
    const pt = turf.along(line, d, { units: 'kilometers' });
    const prev = turf.along(line, Math.max(0, d - 0.5), { units: 'kilometers' });
    const next = turf.along(line, Math.min(km, d + 0.5), { units: 'kilometers' });
    const bearing = turf.bearing(prev, next);
    const arrowIcon = L.divIcon({
      html: `<img src="public/arrow.svg" style="transform:rotate(${bearing}deg);width:26px;height:26px;filter:drop-shadow(0 2px 4px rgba(20,32,27,0.7));"/>`,
      className: '',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    L.marker([pt.geometry.coordinates[1], pt.geometry.coordinates[0]], { icon: arrowIcon, interactive: false }).addTo(_capaFlechas);
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
    if (_capaFlechas) { map.removeLayer(_capaFlechas); _capaFlechas = null; }
    capaRuta = null;
  }

  function limpiarTodo() {
    limpiarRuta();
    limpiarRutaPreview();
    limpiarMarcadoresRuta();
    limpiarParadas();
    limpiarEscalas();
    limpiarPuntosDesvio();
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

  /** Quita del cluster el marcador de un sitio (p. ej. cuando pasa a ser parada). */
  function quitarMarcadorSitio(sitioId) {
    const marker = _sitioMarkers.get(sitioId);
    if (marker) {
      clusterSitios.removeLayer(marker);
      _sitioMarkers.delete(sitioId);
    }
  }

  /** Overlay de prueba: pinta todos los sitios de frontera (sin etiqueta permanente). */
  function setMarcadoresFrontera(sitios) {
    if (!capaFrontera) return;
    capaFrontera.clearLayers();
    sitios.forEach((s) => {
      if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) return;
      const marker = L.marker([s.lat, s.lon], { icon: iconoSitio(), zIndexOffset: 1000 });
      marker.bindTooltip(s.nombre, { direction: 'top', offset: [0, -20], className: 'site-label' });
      marker.on('click', () => centrarEn(s.lat, s.lon));
      marker.addTo(capaFrontera);
    });
  }

  function limpiarSitiosFrontera() {
    if (capaFrontera) capaFrontera.clearLayers();
  }

  function abrirPopupSitio(sitioId) {
    const marker = _sitioMarkers.get(sitioId);
    if (!marker) return;
    if (!map.hasLayer(clusterSitios)) map.addLayer(clusterSitios);
    clusterSitios.zoomToShowLayer(marker, () => {
      if (typeof TourismModule !== 'undefined' && TourismModule.mostrarPopupSitio) {
        const sitio = TourismModule.getSitios().find(s => s.id === sitioId);
        if (sitio) TourismModule.mostrarPopupSitio(sitio);
      }
    });
  }

  /** Abre el popup de una parada ya agregada a la ruta y acerca el mapa al lugar. */
  function abrirPopupParada(sitioId) {
    const marker = _marcadorParadas.get(sitioId);
    if (!marker) {
      abrirPopupSitio(sitioId);
      if (typeof TourismModule !== 'undefined' && TourismModule.getSitios) {
        const sitio = TourismModule.getSitios().find(s => s.id === sitioId);
        if (sitio) enfocarLugar(sitio.lat, sitio.lon);
      }
      return;
    }
    marker.openPopup();
    enfocarLugar(marker.getLatLng().lat, marker.getLatLng().lng);
    _centrarPopupEnVista(marker);
  }

  /** Abre el popup de una escala (municipio intermedio) y acerca el mapa al lugar. */
  function abrirPopupEscala(escalaId) {
    const marker = _marcadorEscalas.get(escalaId);
    if (!marker) return;
    marker.openPopup();
    enfocarLugar(marker.getLatLng().lat, marker.getLatLng().lng);
    _centrarPopupEnVista(marker);
  }

  /** Abre la ficha informativa del origen o destino sobre su marcador y acerca el mapa al lugar. */
  function abrirPopupExtremo(tipo, nombre, departamento) {
    const marker = tipo === 'origen' ? markerOrigen : markerDestino;
    if (!marker) return;
    const etiqueta = tipo === 'origen' ? 'Ciudad de origen' : 'Ciudad de destino';
    marker.bindPopup(`
      <div class="popup-sitio">
        <span class="popup-sitio__cat" style="background:#2d7d6822;color:#2d7d68">${etiqueta}</span>
        <h3 class="popup-sitio__nombre">${nombre || ''}</h3>
        <p class="popup-sitio__ubicacion">${departamento || ''}</p>
        <p class="popup-sitio__dist mono"></p>
      </div>
    `);
    marker.openPopup();
    enfocarLugar(marker.getLatLng().lat, marker.getLatLng().lng);
    _centrarPopupEnVista(marker);
  }

  function ocultarTooltipSitio(sitioId) {
    const marker = _sitioMarkers.get(sitioId);
    if (marker && marker.getTooltip()) {
      const el = marker.getTooltip()._container;
      if (el) el.style.display = 'none';
    }
  }

  function mostrarTooltipSitio(sitioId) {
    const marker = _sitioMarkers.get(sitioId);
    if (marker && marker.getTooltip()) {
      const el = marker.getTooltip()._container;
      if (el) el.style.display = '';
    }
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

  function centrarEn(lat, lon) {
    map.setView([lat, lon], map.getZoom(), { animate: true });
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
    setMarcadoresPuntosDesvio,
    limpiarPuntosDesvio,
    setOnMenuPuntoDesvio,
    setOnMoverPuntoDesvio,
    abrirPopupEscala,
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
    quitarMarcadorSitio,
    setMarcadoresFrontera,
    limpiarSitiosFrontera,
    toggleSitios,
    abrirPopupSitio,
    abrirPopupParada,
    abrirPopupExtremo,
    ocultarTooltipSitio,
    mostrarTooltipSitio,
    encuadrar,
    centrarEn,
  };
})();
