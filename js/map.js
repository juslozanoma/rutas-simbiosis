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
  let capaAerea = null;         // L.layerGroup con el tramo aéreo (avión)
  let capaFrontera = null;      // L.layerGroup overlay de prueba: sitios de frontera
  let capaPuertosGlobal = null;     // L.layerGroup con todos los puertos del catálogo (tecla P)
  let capaAeropuertosGlobal = null; // L.layerGroup con todos los aeropuertos del catálogo (tecla A)
  let capaDepartamentosGlobal = null; // L.layerGroup con los departamentos en sus capitales (tecla D)
  let capaMunicipiosGlobal = null;    // L.layerGroup con los municipios filtrados (tecla M)
  let capaConexiones = null;    // L.layerGroup con las líneas de conexión de un puerto/aeropuerto
  let capaComparacion = null;   // L.layerGroup con los círculos naranjas de comparación (1 y 2)
  let capaLugarBuscado = null;  // L.layerGroup con el marcador del lugar seleccionado en el buscador superior
  let _marcadoresComparacion = []; // L.marker de los círculos naranjas 1 y 2
  let capaRedFluvial = null;    // L.geoJSON con la red fluvial del grafo (tecla W)
  let _redFluvialVisible = false;
  let _capaBaseOSM = null;      // capa base estándar OpenStreetMap
  let _capaBaseSatelite = null; // capa base satelital (Esri World Imagery)
  let clusterSitios = null;     // L.markerClusterGroup con los sitios candidatos filtrados
  let _capaFlechas = null;      // L.layerGroup con flechas de dirección sobre la ruta
  let _altimetriaActiva = false; // con la altimetría abierta se oculta la flecha de dirección

  const ZOOM_MIN_FLECHA = 9;    // Zoom mínimo para mostrar la flecha de dirección

  const _sitioMarkers = new Map(); // sitioId → L.marker
  const _marcadorParadas = new Map(); // paradaId → L.marker (sitios ya agregados a la ruta)
  const _marcadorEscalas = new Map(); // escalaId → L.marker (municipios intermedios)
  const _marcadorPuntosDesvio = new Map(); // escalaId → L.marker (puntos de desvío arrastrados)
  let _conexionCentroId = null; // clave 'puerto_id' | 'aeropuerto_id' del marcador con líneas dibujadas
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

  // Selección del segundo punto de comparación sobre el mapa
  let _onSeleccionComparar = null;
  let _seleccionCompararContainer = null;
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
      rotate: true,
      rotateControl: false,
      touchRotate: true,
      rotationSensitivity: 0.4,
    }).setView(CENTRO_COLOMBIA, ZOOM_INICIAL);

    // Desactivar boxZoom (evita rectángulo al hacer clic en la ruta)
    map.boxZoom.disable();
    map.doubleClickZoom.disable();

    _capaBaseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);

    _capaBaseSatelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
    });

    const btnSatelite = document.getElementById('btn-satelite');
    if (btnSatelite) {
      btnSatelite.addEventListener('click', () => {
        const activa = alternarVistaSatelite();
        btnSatelite.classList.toggle('activo', activa);
        btnSatelite.setAttribute('aria-pressed', String(activa));
      });
    }

    // Al cambiar el vehículo o su color se re-dibuja la flecha de la ruta.
    if (typeof TransportConfigModule !== 'undefined' && TransportConfigModule.setOnCambio) {
      TransportConfigModule.setOnCambio(() => {
        if (map && !_altimetriaActiva) _actualizarFlechaRuta();
      });
    }

    // Pane custom para clusters (z-index alto para quedar sobre tooltips y marcadores)
    const clusterPane = map.createPane('clusterPane');
    clusterPane.style.zIndex = 800;

    map.getPane('markerPane').style.zIndex = 700;
    map.getPane('tooltipPane').style.zIndex = 850;

    // El panel de popups debe quedar sobre tooltips de sitios y clusters
    // (círculos oscuros) para que las fichas de información no queden ocultas.
    map.getPane('popupPane').style.zIndex = 900;

    clusterSitios = L.markerClusterGroup({
      // maxClusterRadius 0: no agrupar, se muestran los iconos individuales.
      maxClusterRadius: 0,
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
    capaAerea = L.layerGroup().addTo(map);
    capaFrontera = L.layerGroup().addTo(map);
    capaPuertosGlobal = L.layerGroup().addTo(map);
    capaAeropuertosGlobal = L.layerGroup().addTo(map);
    capaDepartamentosGlobal = L.layerGroup().addTo(map);
    capaMunicipiosGlobal = L.layerGroup().addTo(map);
    capaConexiones = L.layerGroup().addTo(map);
    capaComparacion = L.layerGroup().addTo(map);
    capaLugarBuscado = L.layerGroup().addTo(map);

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

    _crearRosaVientos();

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

  /** Alterna la capa base entre OpenStreetMap y la vista satelital (Esri).
   *  Devuelve `true` si la vista satelital quedó activa. */
  function alternarVistaSatelite() {
    if (!map || !_capaBaseSatelite) return false;
    const sateliteActiva = map.hasLayer(_capaBaseSatelite);
    if (sateliteActiva) {
      map.removeLayer(_capaBaseSatelite);
      if (!map.hasLayer(_capaBaseOSM)) _capaBaseOSM.addTo(map);
    } else {
      map.removeLayer(_capaBaseOSM);
      _capaBaseSatelite.addTo(map);
    }
    return !sateliteActiva;
  }

  /** ¿Está activa la vista satelital? */
  function esVistaSatelite() {
    return !!(map && _capaBaseSatelite && map.hasLayer(_capaBaseSatelite));
  }

  // ---------------------------------------------------------------------
  // Íconos
  // ---------------------------------------------------------------------

  function _pinDivIcon(letra, color = '#2f7a6b') {
    const svg = `
      <svg class="pin-svg" width="28" height="38" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 25 15 25s15-14.5 15-25c0-8.3-6.7-15-15-15z" fill="${color}"/>
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

  function iconoOrigen(color) { return _pinDivIcon('A', color); }
  function iconoDestino(color) { return _pinDivIcon('Z', color); }

  /** Ícono de sitio turístico: con número (el de su listado) usa el pin
   *  numerado turquesa; sin número usa el pin con el SVG de encrucijada. */
  function iconoSitio(numero) {
    if (numero != null && String(numero) !== '') {
      return L.divIcon({
        html: `<div class="parada-pin parada-pin--sitio parada-pin--numero">${numero}</div>`,
        className: '',
        iconSize: [25, 25],
        iconAnchor: [12.5, 12.5],
        popupAnchor: [0, -15],
      });
    }
    return L.divIcon({
      html: `<div class="sitio-pin">
        <svg viewBox="0 0 32 32" width="13" height="13" fill="#ffffff"><path d="M29.83,17.45l-2-3A1,1,0,0,0,27,14H17V12h8a1,1,0,0,0,1-1V5a1,1,0,0,0-1-1H17V3a1,1,0,0,0-2,0V4H6a1,1,0,0,0-.71.29l-3,3a1,1,0,0,0,0,1.41l3,3A1,1,0,0,0,6,12h9v2H7a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h8v6H11a1,1,0,0,0,0,2H21a1,1,0,0,0,0-2H17V22H27a1,1,0,0,0,.83-.45l2-3A1,1,0,0,0,29.83,17.45Z"/></svg>
      </div>`,
      className: '',
      iconSize: [25, 25],
      iconAnchor: [12.5, 12.5],
      popupAnchor: [0, -15],
    });
  }

  /** Ícono de puerto/aeropuerto del catálogo: círculo verde sólido sin
   *  bordes de 25px, con el símbolo blanco en el centro. */
  function _iconoInfraGlobal(svgHtml) {
    return L.divIcon({
      html: `<div class="infra-global-pin">${svgHtml}</div>`,
      className: '',
      iconSize: [25, 25],
      iconAnchor: [12.5, 12.5],
      popupAnchor: [0, -15],
    });
  }

  function iconoPuertoGlobal() {
    return _iconoInfraGlobal('<img src="public/boat.svg" alt="Puerto"/>');
  }

  function iconoAeropuertoGlobal() {
    return _iconoInfraGlobal('<img src="public/airplane.svg" alt="Aeropuerto"/>');
  }

  /** Ícono numerado verde de departamento (D) y municipio (M): el número indica
   *  la posición del elemento en la lista del panel. Mismo tamaño que el pin de
   *  aeropuerto/puerto (25px) para que todo quede uniforme. */
  function _iconoPinNumeroVerde(n) {
    return L.divIcon({
      html: `<div class="parada-pin parada-pin--departamento parada-pin--numero">${n}</div>`,
      className: '',
      iconSize: [25, 25],
      iconAnchor: [12.5, 12.5],
      popupAnchor: [0, -15],
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

  let _onClicMarcadorExtremo = null; // ('origen'|'destino') => void

  function setOnClicMarcadorExtremo(fn) { _onClicMarcadorExtremo = fn; }

  // Callback al hacer clic en un puerto/aeropuerto del mapa (catálogo o ruta):
  // recibe ('puerto'|'aeropuerto', item) para dibujar sus conexiones.

  let _onClicInfraGlobal = null;

  function setOnClicInfraGlobal(fn) { _onClicInfraGlobal = fn; }

  // Callback al soltar un puerto del catálogo arrastrado con clic derecho:
  // recibe (idPuerto, lat, lng) con la nueva coordenada.

  let _onPuertoMovidoGlobal = null;

  function setOnPuertoMovidoGlobal(fn) { _onPuertoMovidoGlobal = fn; }

  // Menú contextual (clic derecho) sobre un marcador de catálogo
  // (aeropuerto | municipio | departamento | frontera): recibe (tipo, item, marker, x, y).
  let _onMenuCatalogoGlobal = null;

  function setOnMenuCatalogoGlobal(fn) { _onMenuCatalogoGlobal = fn; }

  // Callback al soltar un ítem de catálogo (distinto de puerto) arrastrado:
  // recibe (tipo, id, lat, lng) con la nueva coordenada.
  let _onMoverCatalogoGlobal = null;

  function setOnMoverCatalogoGlobal(fn) { _onMoverCatalogoGlobal = fn; }

  // Callback al pulsar con el botón derecho sobre un puerto del catálogo:
  // recibe (puerto, marker, clientX, clientY) para abrir su menú contextual.
  // Si no hay callback se conserva el arrastre directo con clic derecho.

  let _onMenuPuertoGlobal = null;

  function setOnMenuPuertoGlobal(fn) { _onMenuPuertoGlobal = fn; }

  // Callback al elegir "Agregar puerto aquí" en el menú contextual:
  // recibe (lat, lng) del punto del mapa donde se hizo clic derecho.

  let _onAgregarPuertoEn = null;

  function setOnAgregarPuertoEn(fn) { _onAgregarPuertoEn = fn; }

  // Callback al pulsar con el botón derecho (o mantener presionado en táctil)
  // sobre un punto de una ruta de archivo: recibe (id, latlng, clientX, clientY).

  let _onMenuPuntoRutaArchivo = null;

  function setOnMenuPuntoRutaArchivo(fn) { _onMenuPuntoRutaArchivo = fn; }
  function setMarcadorOrigen(lat, lon, etiqueta) {
    if (markerOrigen) map.removeLayer(markerOrigen);
    markerOrigen = L.marker([lat, lon], { icon: iconoOrigen(), zIndexOffset: 50 })
      .bindTooltip(`Origen: ${etiqueta}`, { direction: 'top', offset: [0, -10] })
      .addTo(map);
    markerOrigen.on('click', () => { if (_onClicMarcadorExtremo) _onClicMarcadorExtremo('origen'); });
    _coordOrigen = [lat, lon];
  }

  function setMarcadorDestino(lat, lon, etiqueta) {
    if (markerDestino) map.removeLayer(markerDestino);
    markerDestino = L.marker([lat, lon], { icon: iconoDestino(), zIndexOffset: 50 })
      .bindTooltip(`Destino: ${etiqueta}`, { direction: 'top', offset: [0, -10] })
      .addTo(map);
    markerDestino.on('click', () => { if (_onClicMarcadorExtremo) _onClicMarcadorExtremo('destino'); });
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
      let nombrePop = '';
      if (e.nombre) {
        nombrePop = e.nombre === 'Bogotá D.C.'
          ? 'Bogotá, D.C.'
          : (e.departamento && e.departamento !== e.nombre ? `${e.nombre}, ${e.departamento}` : e.nombre);
        if (muni && muni.ano_fundacion) nombrePop += ` (${muni.ano_fundacion})`;
      }
      marker.bindPopup(`
        <div class="popup-sitio">
          <div class="popup-sitio__head">
            <span class="popup-sitio__cat">Pueblo intermedio</span>
            ${muni && muni.temperatura_promedio ? `<span class="popup-sitio__stat">${muni.temperatura_promedio}</span>` : ''}
            ${muni && muni.altura ? `<span class="popup-sitio__stat">${_msnm(muni.altura)}</span>` : ''}
          </div>
          <h3 class="popup-sitio__nombre">${nombrePop}</h3>
          ${_htmlDatosMunicipio(muni)}
          ${muni && muni.descripción ? `<p class="popup-sitio__desc">${muni.descripción}</p>` : ''}
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

  /** Normaliza la altura a "X msnm" (los datos pueden traer "80 m s. n. m."). */
  function _msnm(altura) {
    if (!altura) return '';
    const m = String(altura).match(/^\s*([\d.,]+)/);
    return m ? m[1] + ' msnm' : String(altura);
  }

  /** HTML de la línea de datos del municipio (habitantes + superficie). */
  function _htmlDatosMunicipio(muni) {
    if (!muni) return '';
    const partes = [];
    if (muni.poblacion_total) partes.push(`${muni.poblacion_total} habitantes`);
    if (muni.superficie_total) partes.push(muni.superficie_total);
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
    if (_puertoEnArrastre) return;
    // Sobre una ruta cargada por el usuario (KML/GPX) el clic secundario abre
    // su propio menú (cambiar inicio/fin/sentido, revertir, unir): aquí no se
    // muestra el menú del mapa ("Marcar tramo destapado / Agregar puerto").
    if (e.layer && e.layer.options && e.layer.options._rutaArchivoId) return;
    const objetivo = e.originalEvent && e.originalEvent.target;
    if (objetivo && objetivo.closest && objetivo.closest('.ruta-archivo-hover')) return;
    if (objetivo && objetivo.closest && objetivo.closest('.desvio-point')) return;
    _cerrarCtxMenu();
    // "Marcar tramo destapado" solo cuando no están visibles ni los puertos
    // (P), ni los aeropuertos (A), ni la opción de subir tu propia ruta.
    // "Agregar puerto aquí" solo cuando el catálogo de puertos está activo.
    const raiz = document.getElementById('app');
    const puertosActivos = raiz && raiz.getAttribute('data-puertos-activos') === 'true';
    const aeropuertosActivos = raiz && raiz.getAttribute('data-aeropuertos-activos') === 'true';
    // Con "Subir tu propia ruta" activo el listado pertenece a rutas de archivo:
    // el menú "Marcar tramo destapado" no debe abrirse en ese modo.
    const archivoActivo = raiz && raiz.getAttribute('data-ruta-archivo') === 'true';
    const btnSubir = document.getElementById('btn-subir-ruta-propia');
    const subirVisible = btnSubir
      ? !btnSubir.hidden && getComputedStyle(btnSubir).display !== 'none'
      : true;
    const items = [];
    if (!puertosActivos && !aeropuertosActivos && !archivoActivo && !subirVisible) {
      items.push({ texto: 'Marcar tramo destapado', accion: () => iniciarMarcadoTramo() });
    }
    if (puertosActivos) {
      items.push({
        texto: 'Agregar puerto aquí',
        accion: () => { if (_onAgregarPuertoEn) _onAgregarPuertoEn(e.latlng.lat, e.latlng.lng); },
      });
    }
    // "Comparar este sitio" se ofrece siempre que haya una ruta dibujada en el
    // mapa (haya o no altimetría abierta), para elegir puntos de comparación.
    const hayRuta = _rutaGeojson && _rutaGeojson.geometry && _rutaGeojson.geometry.coordinates && _rutaGeojson.geometry.coordinates.length >= 2;
    if (hayRuta && typeof AltimetriaModule !== 'undefined') {
      items.push({
        texto: 'Comparar este sitio',
        accion: () => {
          if (typeof AltimetriaModule !== 'undefined' && AltimetriaModule.puntoCompararDesdeLatLng && AltimetriaModule.seleccionarPuntoComparacion) {
            const punto = AltimetriaModule.puntoCompararDesdeLatLng(e.latlng.lat, e.latlng.lng);
            if (punto) AltimetriaModule.seleccionarPuntoComparacion(punto);
          }
        },
      });
    }
    if (!items.length) return;
    const div = document.createElement('div');
    div.className = 'ctx-menu';
    div.innerHTML = items.map((i) => '<div class="ctx-menu__item">' + i.texto + '</div>').join('');
    div.querySelectorAll('.ctx-menu__item').forEach((item, idx) => {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _cerrarCtxMenu();
        items[idx].accion();
      });
    });
    const container = map.getContainer();
    const point = map.latLngToContainerPoint(e.latlng);
    div.style.left = Math.min(point.x, container.offsetWidth - 190) + 'px';
    div.style.top = Math.min(point.y, container.offsetHeight - 70) + 'px';
    container.appendChild(div);
    _ctxMenu = div;
  }

  function _cerrarCtxMenu() {
    if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; }
  }

  /** Durante la comparación de puntos, un clic/toque en el mapa selecciona el
   *  segundo punto. Se captura en fase de captura para que también funcionen
   *  los clics sobre marcadores sin abrir sus menús. */
  function activarSeleccionComparar(cb) {
    if (!map) return;
    desactivarSeleccionComparar();
    _onSeleccionComparar = cb;
    _seleccionCompararContainer = map.getContainer();
    _seleccionCompararContainer.style.cursor = 'crosshair';
    _seleccionCompararContainer.addEventListener('click', _onSeleccionCompararClick, true);
  }

  function desactivarSeleccionComparar() {
    if (_seleccionCompararContainer) {
      _seleccionCompararContainer.removeEventListener('click', _onSeleccionCompararClick, true);
      _seleccionCompararContainer.style.cursor = '';
      _seleccionCompararContainer = null;
    }
    _onSeleccionComparar = null;
  }

  function _onSeleccionCompararClick(ev) {
    if (!_onSeleccionComparar || !map) return;
    // No interceptar los clics sobre el menú contextual del mapa ni sobre el
    // aviso flotante de comparación (botón de cerrar).
    if (ev.target && ev.target.closest && ev.target.closest('.ctx-menu, .comparar-banner')) return;
    const rect = map.getContainer().getBoundingClientRect();
    const latlng = map.containerPointToLatLng(L.point(ev.clientX - rect.left, ev.clientY - rect.top));
    ev.stopPropagation();
    ev.preventDefault();
    if (typeof AltimetriaModule !== 'undefined' && AltimetriaModule.puntoCompararDesdeLatLng) {
      const punto = AltimetriaModule.puntoCompararDesdeLatLng(latlng.lat, latlng.lng);
      if (punto && _onSeleccionComparar) _onSeleccionComparar(punto);
    }
  }

  /** Dibuja/actualiza los círculos naranjas de los puntos de comparación (1 y 2)
   *  sobre la ruta en el mapa. `puntos` es un arreglo con {lat, lon}. */
  function actualizarMarcadoresComparacion(puntos) {
    if (!capaComparacion) return;
    capaComparacion.clearLayers();
    _marcadoresComparacion = [];
    if (!puntos || !puntos.length) return;
    puntos.forEach((p, i) => {
      if (!p || p.lat == null || p.lon == null) return;
      const icon = L.divIcon({
        html: '<div class="comparar-pin">' + (i + 1) + '</div>',
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marker = L.marker([p.lat, p.lon], { icon, zIndexOffset: 1100, interactive: false });
      marker.addTo(capaComparacion);
      _marcadoresComparacion.push(marker);
    });
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
      // Las rutas aéreas/fluviales son MultiLineString: se encadenan sus tramos.
      const gc = _rutaGeojson.geometry.coordinates;
      const coords = _rutaGeojson.geometry.type === 'MultiLineString'
        ? gc.reduce((acc, tramo) => acc.concat(tramo), [])
        : gc;
      const routeLine = turf.lineString(coords);
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

  /** Oculta/muestra la flecha de dirección de la ruta según si la altimetría
   *  está activa: mientras se ve el perfil, el carro verde del perfil reemplaza
   *  la flecha y esta no debe dibujarse (ni al mover/zoom del mapa). */
  function setAltimetriaActiva(activa) {
    _altimetriaActiva = !!activa;
    if (!_capaFlechas) return;
    if (_altimetriaActiva) _capaFlechas.clearLayers();
    else _actualizarFlechaRuta();
  }

  /** Ubica (o reposiciona) la única flecha en el punto medio del tramo de ruta visible en pantalla. */
  function _actualizarFlechaRuta() {
    if (!_capaFlechas || !map) return;
    _capaFlechas.clearLayers();
    // Con la altimetría activa el indicador de dirección se oculta (el carro
    // verde del perfil lo reemplaza).
    if (_altimetriaActiva) return;
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
    if (!coords) {
      const gc = _rutaGeojson.geometry.coordinates;
      if (_rutaGeojson.geometry.type === 'MultiLineString') {
        coords = gc.reduce((a, c) => (c.length > a.length ? c : a), []);
      } else {
        coords = gc;
      }
    }
    if (!coords || coords.length < 2) return;

    const line = turf.lineString(coords);
    const km = turf.length(line, { units: 'kilometers' });
    const d = km / 2;
    const pt = turf.along(line, d, { units: 'kilometers' });
    const prev = turf.along(line, Math.max(0, d - 0.5), { units: 'kilometers' });
    const next = turf.along(line, Math.min(km, d + 0.5), { units: 'kilometers' });
    const bearing = turf.bearing(prev, next);
    const movil = typeof esMovil === 'function' && esMovil();
    const tam = movil ? 34 : 26;
    const arrowIcon = L.divIcon({
      html: TransportConfigModule.divIconoHTML(tam, tam, `transform-origin:50% 100%;transform:rotate(${bearing - 90}deg);`),
      className: '',
      iconSize: [tam, tam],
      iconAnchor: [tam / 2, tam],
    });
    const arrowMarker = L.marker([pt.geometry.coordinates[1], pt.geometry.coordinates[0]], {
      icon: arrowIcon,
      interactive: !TransportConfigModule.esHiking(),
      zIndexOffset: 1050,
    }).addTo(_capaFlechas);
    if (!TransportConfigModule.esHiking()) {
      arrowMarker.on('click', (e) => {
        if (e.originalEvent) {
          e.originalEvent.stopImmediatePropagation();
          L.DomEvent.preventDefault(e.originalEvent);
        }
        L.DomEvent.stopPropagation(e);
        TransportConfigModule.abrirSelector(e.originalEvent ? e.originalEvent.clientX : 0, e.originalEvent ? e.originalEvent.clientY : 0);
      });
    }
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
    if (capaComparacion) capaComparacion.clearLayers();
    _marcadoresComparacion = [];
    _rutaGeojson = null;
    limpiarTramoAereo();
    capaRuta = null;
  }

  /**
   * Dibuja tramos de transporte en línea punteada (avión o río). Recibe un
   * arreglo de tramos [{ coords:[lon,lat], distanciaMetros, duracionSegundos },
   * ...] y un estilo { color, iconoEmoji, iconoHtml(bearing) }.
   */
  function _dibujarTramo(tramos, estilo, limpiar = true) {
    if (limpiar && capaAerea) capaAerea.clearLayers();
    if (!capaAerea || !tramos || !tramos.length) return;
    tramos.forEach((t) => {
      const coords = t.coords;
      if (!coords || coords.length < 2) return;
      const latLngs = coords.map((c) => [Number(c[1]), Number(c[0])]);
      const linea = L.polyline(latLngs, {
        color: estilo.color,
        weight: 3,
        opacity: 0.9,
        dashArray: estilo.dashArray !== undefined ? estilo.dashArray : '8 8',
        lineCap: 'round',
        interactive: true,
      }).addTo(capaAerea);
      let tooltipTxt = null;
      if (t.distanciaMetros || t.duracionSegundos) {
        const km = (t.distanciaMetros || 0) / 1000;
        const seg = t.duracionSegundos || 0;
        const h = Math.floor(seg / 3600);
        const min = Math.round((seg % 3600) / 60);
        const durStr = h > 0 ? `${h} h ${min} min` : `${min} min`;
        tooltipTxt = `${estilo.iconoEmoji} ${km.toFixed(1)} km · ${durStr}`;
        linea.bindTooltip(tooltipTxt, { sticky: true, direction: 'top', className: 'altimetria-map-tooltip' });
      }

      // Ícono en la mitad de la trayectoria. Es interactivo para que al pasar el
      // cursor muestre el mismo tooltip de distancia y duración que la línea.
      const midIdx = Math.floor(coords.length / 2);
      const mid = coords[midIdx];
      const dest = coords[coords.length - 1] || mid;
      let bearing = 0;
      try {
        bearing = turf.bearing(turf.point(mid), turf.point(dest));
      } catch (e) { /* ignorar */ }
      const icono = L.divIcon({
        html: estilo.iconoHtml(bearing),
        className: '',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      const marcador = L.marker([Number(mid[1]), Number(mid[0])], { icon: icono, interactive: true, zIndexOffset: 1500 }).addTo(capaAerea);
      if (tooltipTxt) {
        marcador.bindTooltip(tooltipTxt, { sticky: true, direction: 'top', className: 'altimetria-map-tooltip' });
      }
    });
  }

  const _ESTILO_AEREO = {
    color: '#4a6fa5',
    iconoEmoji: '✈',
    iconoHtml: (bearing) => `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#ffffff;border:1px solid #ffffff;box-shadow:0 1px 4px rgba(20,32,27,0.55);"><svg viewBox="0 0 24 24" style="width:16px;height:16px;transform:rotate(${bearing - 90}deg);display:block;"><path d="M11.92,19.58,15.84,14H20a2,2,0,0,0,0-4H15.84L11.92,4.42A1,1,0,0,0,11.11,4h-.93a1,1,0,0,0-1,1.16L10,10H6.38L4.68,8.29A1.05,1.05,0,0,0,4,8H3a1,1,0,0,0-.89,1.45L3.38,12,2.11,14.55A1,1,0,0,0,3,16H4a1.05,1.05,0,0,0,.71-.29L6.38,14H10l-.81,4.84a1,1,0,0,0,1,1.16h.93A1,1,0,0,0,11.92,19.58Z" fill="#4a6fa5"/></svg></div>`,
  };
  const _ESTILO_FLUVIAL = {
    color: '#2f7a6b',
    dashArray: null,
    iconoEmoji: '🚢',
    iconoHtml: () => `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:#ffffff;border:1px solid #ffffff;box-shadow:0 1px 4px rgba(20,32,27,0.55);"><svg viewBox="0 0 512 512" style="width:16px;height:16px;display:block;"><path d="M510.652,230.062c-1.357-2.116-3.567-3.524-6.05-3.857l-128-17.067c-4.617-0.606-8.96,2.662-9.591,7.33c-0.631,4.668,2.662,8.969,7.33,9.591l14.49,1.929c2.116,0.282,3.703,2.091,3.703,4.224v13.193c0,2.534-2.202,4.514-4.719,4.241l-34.133-3.661c-2.167-0.222-3.814-2.057-3.814-4.233v-37.35c0-0.845,0.247-1.664,0.717-2.364l14.916-22.374c1.707-2.56,1.903-5.837,0.521-8.576c-1.391-2.748-4.147-4.54-7.219-4.685l-179.2-8.533c-2.876-0.026-5.666,1.212-7.347,3.567c0,0-34.099,47.923-41.574,58.47c-0.896,1.263-2.398,1.937-3.934,1.766L9.438,209.113c-2.423-0.256-4.813,0.521-6.613,2.133C1.033,212.868,0,215.172,0,217.595c0,8.218,1.067,16.273,3.081,24.09c0.444,1.724,1.946,2.978,3.712,3.183L488.9,299.191c2.039,0.23,3.951-1.024,4.557-2.987l18.168-59.034C512.358,234.773,512,232.17,510.652,230.062z M246.255,182.796l-6.656,46.609c-0.324,2.261-2.33,3.874-4.608,3.644c-16.648-1.681-79.198-8.26-79.198-8.26c-3.243-0.35-4.915-4.062-3.021-6.724l29.312-41.037c0.845-1.178,2.227-1.852,3.678-1.783l56.474,2.688C244.745,178.052,246.613,180.304,246.255,182.796z M338.765,189.017l-5.248,7.851c-0.469,0.7-0.717,1.527-0.717,2.372v39.774c0,2.534-2.202,4.514-4.719,4.241l-67.721-7.253c-2.398-0.256-4.113-2.458-3.772-4.847l6.903-48.324c0.307-2.176,2.227-3.763,4.429-3.661l67.499,3.217C338.731,182.54,340.608,186.252,338.765,189.017z M443.733,250.892c0,2.534-2.202,4.514-4.719,4.241c0,0-17.715-1.997-25.32-4.386-0.565c0,0-18.9-2.021-18.9-2.021c-2.131-0.177-3.95,1.439-4.134,3.577c-0.185,2.13,1.431,3.96,3.569,4.145l17.293,1.502c2.13,0.168,3.941-1.45,4.117-3.588c0.047-0.571-0.034-1.153-0.231-1.702L338.765,189.017z" fill="#2f7a6b"/></svg></div>`,
  };

  /** Dibuja los tramos aéreos (líneas punteadas curvas). */
  function dibujarTramoAereo(tramos) {
    _dibujarTramo(tramos, _ESTILO_AEREO);
  }

  /** Dibuja los tramos fluviales (línea continua sobre el río). */
  function dibujarTramoFluvial(tramos) {
    _dibujarTramo(tramos, _ESTILO_FLUVIAL);
  }

  /** Dibuja juntos los tramos aéreos y fluviales de una ruta multimodal
   *  (avión + barco): no se limpia la capa entre ambos estilos. */
  function dibujarTramoMixto(tramosAereo, tramosFluvial) {
    _dibujarTramo(tramosAereo, _ESTILO_AEREO, true);
    _dibujarTramo(tramosFluvial, _ESTILO_FLUVIAL, false);
  }

  function limpiarTramoAereo() {
    if (capaAerea) capaAerea.clearLayers();
  }

  function limpiarTramoFluvial() {
    if (capaAerea) capaAerea.clearLayers();
  }

  let _aeropuertoMarkers = [];

  /** Pinta los marcadores de los aeropuertos de la ruta aérea. Recibe [{ap, titulo}, ...]. */
  function setMarcadoresAeropuertos(lista) {
    limpiarMarcadoresAeropuertos();
    if (!capaAerea || !lista || !lista.length) return;
    lista.forEach(({ ap, titulo }) => {
      if (!ap) return;
      const icono = L.divIcon({
        html: '<div class="aeropuerto-pin">✈</div>',
        className: '',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const m = L.marker([Number(ap.latitud), Number(ap.longitud)], { icon: icono, zIndexOffset: 1450 });
      m.on('click', () => { if (_onClicInfraGlobal) _onClicInfraGlobal('aeropuerto', ap); });
      m.addTo(capaAerea);
      _aeropuertoMarkers.push(m);
    });
  }

  function limpiarMarcadoresAeropuertos() {
    _aeropuertoMarkers.forEach((m) => { if (capaAerea) capaAerea.removeLayer(m); });
    _aeropuertoMarkers = [];
  }

  let _puertoMarkers = [];

  /** Pinta los marcadores de los puertos de la ruta fluvial. Recibe [{p, titulo}, ...]. */
  function setMarcadoresPuertos(lista) {
    limpiarMarcadoresPuertos();
    if (!capaAerea || !lista || !lista.length) return;
    lista.forEach(({ p, titulo }) => {
      if (!p) return;
      const icono = L.divIcon({
        html: '<div class="puerto-pin"><img src="public/boat.svg" alt="" style="width:16px;height:16px;filter:brightness(0) invert(1);"></div>',
        className: '',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      });
      const m = L.marker([Number(p.latitud), Number(p.longitud)], { icon: icono, zIndexOffset: 1450 });
      m.on('click', () => { if (_onClicInfraGlobal) _onClicInfraGlobal('puerto', p); });
      m.addTo(capaAerea);
      _puertoMarkers.push(m);
    });
  }

  function limpiarMarcadoresPuertos() {
    _puertoMarkers.forEach((m) => { if (capaAerea) capaAerea.removeLayer(m); });
    _puertoMarkers = [];
  }

  /** Pinta TODOS los puertos del catálogo (tecla P). Se pueden mover con un
   *  arrastre de clic derecho (actualiza la coordenada vía _onPuertoMovidoGlobal). */

  // Etiquetas de hover fijas: al hacer clic en un puerto/aeropuerto la etiqueta
  // queda abierta hasta hacer clic de nuevo sobre el mismo marcador.
  const _marcadoresTooltipFijo = new Set();

  function _fijarTooltip(marker, fijado) {
    const tooltip = marker.getTooltip();
    if (!tooltip) return;
    const contenido = tooltip.getContent();
    marker.unbindTooltip();
    marker.bindTooltip(contenido, {
      direction: 'top',
      offset: [0, -16],
      className: 'site-label',
      permanent: fijado,
    });
    if (fijado) marker.openTooltip();
    else marker.closeTooltip();
  }

  function _alternarTooltipFijo(marker) {
    if (_marcadoresTooltipFijo.has(marker)) {
      _marcadoresTooltipFijo.delete(marker);
      _fijarTooltip(marker, false);
    } else {
      _marcadoresTooltipFijo.add(marker);
      _fijarTooltip(marker, true);
    }
  }

  function setMarcadoresPuertosGlobal(lista) {
    limpiarPuertosGlobal();
    if (!lista || !lista.length) return;
    lista.forEach((p, i) => {
      if (p.latitud == null || p.longitud == null || isNaN(Number(p.latitud)) || isNaN(Number(p.longitud))) return;
      const marker = L.marker([Number(p.latitud), Number(p.longitud)], { icon: _iconoPinNumeroVerde(i + 1), zIndexOffset: 1100 });
      marker.bindTooltip([p.nombre, p.ciudad].filter(Boolean).join(' - ') || 'Puerto', { direction: 'top', offset: [0, -16], className: 'site-label' });
      marker.on('click', () => {
        _alternarTooltipFijo(marker);
        if (_onClicInfraGlobal) _onClicInfraGlobal('puerto', p);
      });
      marker.on('contextmenu', (ev) => {
        if (_onMenuPuertoGlobal) {
          ev.originalEvent.preventDefault();
          L.DomEvent.stopPropagation(ev.originalEvent);
          _cerrarCtxMenu();
          _onMenuPuertoGlobal(p, marker, ev.originalEvent.clientX, ev.originalEvent.clientY);
          return;
        }
        _iniciarArrastreCatalogo(marker, 'puerto', p.id, ev);
      });
      marker.addTo(capaPuertosGlobal);
    });
  }

  // ---------------------------------------------------------------------
  // Arrastre con clic derecho de un ítem del catálogo (puerto, aeropuerto,
  // municipio, departamento o sitio)
  // ---------------------------------------------------------------------

  let _arrastreCatalogo = null; // { marker, tipo, id, inicioLat, inicioLng }

  function _iniciarArrastreCatalogo(marker, tipo, id, ev) {
    if (_arrastreCatalogo || _marcandoTramo) return;
    _cerrarCtxMenu();
    if (ev) {
      L.DomEvent.stopPropagation(ev.originalEvent);
      if (ev.originalEvent && typeof ev.originalEvent.preventDefault === 'function') ev.originalEvent.preventDefault();
    }
    if (map.dragging) map.dragging.disable();
    const pos = marker.getLatLng();
    _arrastreCatalogo = { marker, tipo, id, inicioLat: pos.lat, inicioLng: pos.lng };
    const iconEl = marker.getElement();
    if (iconEl) iconEl.classList.add('infra-global-pin--arrastre');
    marker.setZIndexOffset(1300);
    map.getContainer().style.cursor = 'grabbing';
    map.on('mousemove', _moverCatalogoArrastre);
    map.on('mouseup', _terminarArrastreCatalogo);
    document.addEventListener('mouseup', _terminarArrastreCatalogoDoc);
  }

  /** Inicia el arrastre de un ítem del catálogo desde el menú contextual. */
  function iniciarArrastreCatalogo(marker, tipo, id) {
    _iniciarArrastreCatalogo(marker, tipo, id, null);
  }

  /** Inicia el arrastre de un puerto (API previa del menú de puertos). */
  function iniciarArrastrePuerto(marker, puertoId) {
    _iniciarArrastreCatalogo(marker, 'puerto', puertoId, null);
  }

  function _moverCatalogoArrastre(ev) {
    const arr = _arrastreCatalogo;
    if (!arr || !ev.latlng) return;
    arr.marker.setLatLng([ev.latlng.lat, ev.latlng.lng]);
  }

  function _terminarArrastreCatalogo() {
    const arr = _arrastreCatalogo;
    if (!arr) return;
    _arrastreCatalogo = null;
    map.off('mousemove', _moverCatalogoArrastre);
    map.off('mouseup', _terminarArrastreCatalogo);
    document.removeEventListener('mouseup', _terminarArrastreCatalogoDoc);
    if (map.dragging) map.dragging.enable();
    map.getContainer().style.cursor = '';
    const iconEl = arr.marker.getElement();
    if (iconEl) iconEl.classList.remove('infra-global-pin--arrastre');
    arr.marker.setZIndexOffset(1100);
    const pos = arr.marker.getLatLng();
    const movido = Math.abs(pos.lat - arr.inicioLat) > 1e-5 || Math.abs(pos.lng - arr.inicioLng) > 1e-5;
    if (!movido) return;
    if (arr.tipo === 'puerto' && _onPuertoMovidoGlobal) {
      _onPuertoMovidoGlobal(arr.id, pos.lat, pos.lng);
    } else if (_onMoverCatalogoGlobal) {
      _onMoverCatalogoGlobal(arr.tipo, arr.id, pos.lat, pos.lng);
    }
  }

  function _terminarArrastreCatalogoDoc() {
    _terminarArrastreCatalogo();
  }

  function limpiarPuertosGlobal() {
    if (capaPuertosGlobal) capaPuertosGlobal.clearLayers();
    _marcadoresTooltipFijo.clear();
    if (_conexionCentroId && _conexionCentroId.startsWith('puerto_')) limpiarConexiones();
  }

  /** Pinta TODOS los aeropuertos del catálogo (tecla A). */
  function setMarcadoresAeropuertosGlobal(lista) {
    limpiarAeropuertosGlobal();
    if (!lista || !lista.length) return;
    lista.forEach((ap, i) => {
      if (ap.latitud == null || ap.longitud == null || isNaN(Number(ap.latitud)) || isNaN(Number(ap.longitud))) return;
      const marker = L.marker([Number(ap.latitud), Number(ap.longitud)], { icon: _iconoPinNumeroVerde(i + 1), zIndexOffset: 1100 });
      marker.bindTooltip([ap.nombre, ap.ciudad].filter(Boolean).join(' - ') || 'Aeropuerto', { direction: 'top', offset: [0, -16], className: 'site-label' });
      marker.on('click', () => {
        _alternarTooltipFijo(marker);
        if (_onClicInfraGlobal) _onClicInfraGlobal('aeropuerto', ap);
      });
      marker.on('contextmenu', (ev) => {
        if (_onMenuCatalogoGlobal) {
          ev.originalEvent.preventDefault();
          L.DomEvent.stopPropagation(ev.originalEvent);
          _cerrarCtxMenu();
          _onMenuCatalogoGlobal('aeropuerto', ap, marker, ev.originalEvent.clientX, ev.originalEvent.clientY);
          return;
        }
        _iniciarArrastreCatalogo(marker, 'aeropuerto', ap.id, ev);
      });
      marker.addTo(capaAeropuertosGlobal);
    });
  }

  function limpiarAeropuertosGlobal() {
    if (capaAeropuertosGlobal) capaAeropuertosGlobal.clearLayers();
    _marcadoresTooltipFijo.clear();
    if (_conexionCentroId && _conexionCentroId.startsWith('aeropuerto_')) limpiarConexiones();
  }

  /** Pinta los departamentos del catálogo (tecla D): un marcador numerado por
   *  cada departamento, centrado en su capital (Cundinamarca usa la Gobernación
   *  de Cundinamarca, en Bogotá). El número coincide con la lista del panel. */
  function setMarcadoresDepartamentosGlobal(lista) {
    limpiarDepartamentosGlobal();
    if (!lista || !lista.length) return;
    lista.forEach((d, i) => {
      if (d.lat == null || d.lon == null || isNaN(Number(d.lat)) || isNaN(Number(d.lon))) return;
      const marker = L.marker([Number(d.lat), Number(d.lon)], { icon: _iconoPinNumeroVerde(i + 1), zIndexOffset: 1100 });
      marker.bindTooltip(d.sede || d.nombre, { direction: 'top', offset: [0, -16], className: 'site-label' });
      marker.on('click', () => {
        _alternarTooltipFijo(marker);
        if (_onClicInfraGlobal) _onClicInfraGlobal('departamento', d);
      });
      marker.on('contextmenu', (ev) => {
        if (_onMenuCatalogoGlobal) {
          ev.originalEvent.preventDefault();
          L.DomEvent.stopPropagation(ev.originalEvent);
          _cerrarCtxMenu();
          _onMenuCatalogoGlobal('departamento', d, marker, ev.originalEvent.clientX, ev.originalEvent.clientY);
          return;
        }
        _iniciarArrastreCatalogo(marker, 'departamento', d.id, ev);
      });
      marker.addTo(capaDepartamentosGlobal);
    });
  }

  function limpiarDepartamentosGlobal() {
    if (capaDepartamentosGlobal) capaDepartamentosGlobal.clearLayers();
    _marcadoresTooltipFijo.clear();
  }

  /** Pinta los municipios del catálogo (tecla M): solo los del departamento
   *  seleccionado en el filtro, para no mostrar ~1100 puntos a la vez. El
   *  número coincide con la lista del panel. */
  function setMarcadoresMunicipiosGlobal(lista) {
    limpiarMunicipiosGlobal();
    if (!lista || !lista.length) return;
    lista.forEach((m, i) => {
      if (m.lat == null || m.lon == null || isNaN(Number(m.lat)) || isNaN(Number(m.lon))) return;
      const marker = L.marker([Number(m.lat), Number(m.lon)], { icon: _iconoPinNumeroVerde(i + 1), zIndexOffset: 1100 });
      marker.bindTooltip(m.nombre + (m.departamento && m.departamento !== m.nombre ? ', ' + m.departamento : ''), { direction: 'top', offset: [0, -12], className: 'site-label' });
      marker.on('click', () => {
        _alternarTooltipFijo(marker);
        if (_onClicInfraGlobal) _onClicInfraGlobal('municipio', m);
      });
      marker.on('contextmenu', (ev) => {
        if (_onMenuCatalogoGlobal) {
          ev.originalEvent.preventDefault();
          L.DomEvent.stopPropagation(ev.originalEvent);
          _cerrarCtxMenu();
          _onMenuCatalogoGlobal('municipio', m, marker, ev.originalEvent.clientX, ev.originalEvent.clientY);
          return;
        }
        _iniciarArrastreCatalogo(marker, 'municipio', m.id, ev);
      });
      marker.addTo(capaMunicipiosGlobal);
    });
  }

  function limpiarMunicipiosGlobal() {
    if (capaMunicipiosGlobal) capaMunicipiosGlobal.clearLayers();
    _marcadoresTooltipFijo.clear();
  }

  // ---------------------------------------------------------------------
  // Conexiones de un puerto/aeropuerto (líneas punteadas al hacer clic)
  // ---------------------------------------------------------------------

  /** Dibuja líneas desde el punto central hacia cada destino conectado. Si se
   *  vuelve a hacer clic sobre el mismo punto, las líneas se ocultan. */
  function dibujarConexiones(tipo, id, lat, lon, destinos, color) {
    const clave = tipo + '_' + id;
    if (_conexionCentroId === clave && capaConexiones && capaConexiones.getLayers().length) {
      limpiarConexiones();
      return;
    }
    limpiarConexiones();
    _conexionCentroId = clave;
    if (!capaConexiones || !destinos || !destinos.length) return;
    destinos.forEach((d) => {
      if (d.latitud == null || d.longitud == null || isNaN(Number(d.latitud)) || isNaN(Number(d.longitud))) return;
      L.polyline([[Number(lat), Number(lon)], [Number(d.latitud), Number(d.longitud)]], {
        color: color || '#4a6fa5',
        weight: 2,
        opacity: 0.85,
        dashArray: '6 6',
      }).bindTooltip(d.nombre, { sticky: true }).addTo(capaConexiones);
    });
  }

  function limpiarConexiones() {
    if (capaConexiones) capaConexiones.clearLayers();
    _conexionCentroId = null;
  }

  // ---------------------------------------------------------------------
  // Ocultar rutas e íconos de sitios (catálogo de puertos/aeropuertos P/A)
  // ---------------------------------------------------------------------

  let _capasOcultasInfra = null;

  /** Con el catálogo de puertos/aeropuertos (teclas P/A) activo, oculta del
   *  mapa TODAS las rutas y los íconos de sitios (ruta calculada, tramos
   *  aéreos/fluviales, paradas, escalas, sitios turísticos, frontera, rutas de
   *  archivo KML/GPX, origen/destino y posición GPS). Al desactivarlo los
   *  restaura tal como estaban, sin redibujar nada. */
  /** Oculta/restaura las rutas calculadas y (opcionalmente) los íconos de
   *  sitios al activar un catálogo (P/A/D/M/C). Con `incluirSitios = false`
   *  (departamentos, municipios, categorías) las rutas se ocultan pero los
   *  sitios turísticos pueden seguir mostrándose en el mapa. */
  function ocultarRutasYSitios(ocultar, incluirSitios = true) {
    if (ocultar) {
      // Si ya había capas ocultas (p. ej. al cambiar de catálogo) se restauran
      // primero y se recalcula el conjunto con el nuevo modo.
      if (_capasOcultasInfra) {
        _capasOcultasInfra.forEach((c) => map.addLayer(c));
        _capasOcultasInfra = null;
      }
      const capas = [
        _capaRutaVisible, _capaRutaHover, _capaFlechas, capaRutaPreview,
        capaParadas, capaEscalas, capaPuntosDesvio, capaAlertas, capaAerea,
        ...Object.keys(_gruposRutaArchivo).map((id) => _gruposRutaArchivo[id].grupo),
      ];
      if (incluirSitios) capas.push(clusterSitios);
      if (markerOrigen) capas.push(markerOrigen);
      if (markerDestino) capas.push(markerDestino);
      if (_marcadorUsuario) capas.push(_marcadorUsuario);
      const visibles = capas.filter((c) => c && map.hasLayer(c));
      visibles.forEach((c) => map.removeLayer(c));
      _capasOcultasInfra = visibles;
    } else {
      if (!_capasOcultasInfra) return;
      _capasOcultasInfra.forEach((c) => map.addLayer(c));
      _capasOcultasInfra = null;
    }
  }

  /** Indica si las líneas de conexiones de un puerto/aeropuerto están visibles. */
  function estanConexionesAbiertas(tipo, id) {
    return _conexionCentroId === tipo + '_' + id && capaConexiones && capaConexiones.getLayers().length > 0;
  }

  /** Muestra/oculta la red fluvial completa (tramos del grafo) sobre el mapa
   *  base normal. No cambia la capa base: dibuja la geometría real de los
   *  cauces resuelta por el motor fluvial (FluvialModule.red()). */
  function toggleRedFluvial() {
    if (!map) return false;
    if (_redFluvialVisible) {
      if (capaRedFluvial) { map.removeLayer(capaRedFluvial); capaRedFluvial = null; }
      _redFluvialVisible = false;
      return false;
    }
    _redFluvialVisible = true;
    _dibujarRedFluvial();
    return true;
  }

  function _dibujarRedFluvial() {
    if (capaRedFluvial) { map.removeLayer(capaRedFluvial); capaRedFluvial = null; }
    if (typeof FluvialModule === 'undefined' || typeof FluvialModule.red !== 'function') return;
    FluvialModule.red().then((lineas) => {
      if (!_redFluvialVisible || !lineas || !lineas.length) return;
      const feature = {
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: lineas },
      };
      capaRedFluvial = L.geoJSON(feature, {
        renderer: L.canvas(),
        style: { color: '#2f7a6b', weight: 1.2, opacity: 0.65, lineCap: 'round' },
        interactive: false,
      }).addTo(map);
    });
  }

  /** Indica si la red fluvial completa está visible en el mapa. */
  function redFluvialVisible() {
    return _redFluvialVisible;
  }

  function limpiarTodo() {
    // Si el catálogo de puertos/aeropuertos (P/A) ocultó capas, esas
    // referencias quedan obsoletas al limpiar todo: no restaurarlas después.
    _capasOcultasInfra = null;
    limpiarRuta();
    limpiarRutaPreview();
    limpiarMarcadoresRuta();
    limpiarParadas();
    limpiarEscalas();
    limpiarPuntosDesvio();
    limpiarAlertas();
    limpiarConexiones();
    if (capaRedFluvial) { map.removeLayer(capaRedFluvial); capaRedFluvial = null; _redFluvialVisible = false; }
    limpiarLugarBuscado();
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
    sitios.forEach((s, i) => {
      if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) return;
      const marker = L.marker([s.lat, s.lon], { icon: iconoSitio(i + 1), zIndexOffset: 1000 });
      marker.bindTooltip(s.nombre, { direction: 'top', offset: [0, -20], className: 'site-label' });
      marker.on('click', () => centrarEn(s.lat, s.lon));
      marker.on('contextmenu', (ev) => {
        if (_onMenuCatalogoGlobal) {
          ev.originalEvent.preventDefault();
          L.DomEvent.stopPropagation(ev.originalEvent);
          _cerrarCtxMenu();
          _onMenuCatalogoGlobal('frontera', s, marker, ev.originalEvent.clientX, ev.originalEvent.clientY);
          return;
        }
        _iniciarArrastreCatalogo(marker, 'frontera', s.id, ev);
      });
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

  function centrarEn(lat, lon, zoom) {
    map.setView([lat, lon], zoom != null ? zoom : map.getZoom(), { animate: true });
  }

  /** Símbolo blanco del marcador del lugar elegido en el buscador superior,
   *  según su tipo. Municipios y departamentos usan el mismo sign-post. */
  const SIMBOLO_LUGAR_BUSCADO = {
    'Sitio turístico': 'sign-post.svg',
    'Municipio': 'sign-post.svg',
    'Departamento': 'sign-post.svg',
    'Aeropuerto': 'airplane.svg',
    'Puerto': 'boat.svg',
  };

  /** Marcador del lugar elegido en el buscador superior: círculo verde de
   *  34px (igual que el botón de vista satelital) con el símbolo blanco. */
  function _iconoLugarBuscado(tipo) {
    const simbolo = SIMBOLO_LUGAR_BUSCADO[tipo] || 'sign-post.svg';
    return L.divIcon({
      html: `<div class="lugar-buscado-pin"><img src="public/${simbolo}" alt="" width="20" height="20"/></div>`,
      className: '',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -17],
    });
  }

  /** Dibuja/mueve el único marcador del lugar elegido en el buscador superior
   *  (municipio, departamento, sitio turístico, aeropuerto o puerto). Cada
   *  selección reemplaza el marcador anterior. En un sitio turístico, un clic
   *  en el marcador vuelve a abrir su ficha informativa. */
  function mostrarLugarBuscado(tipo, item) {
    if (!capaLugarBuscado || !item) return;
    capaLugarBuscado.clearLayers();
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    if (!isFinite(lat) || !isFinite(lon)) return;
    const marker = L.marker([lat, lon], { icon: _iconoLugarBuscado(tipo), zIndexOffset: 1200 });
    marker.bindTooltip(item.nombre || '', { direction: 'top', offset: [0, -16], className: 'site-label' });
    if (tipo === 'Sitio turístico') {
      marker.on('click', () => {
        const sitios = (typeof TourismModule !== 'undefined' && typeof TourismModule.getSitios === 'function')
          ? TourismModule.getSitios()
          : [];
        const sitio = sitios.find((s) => Number(s.lat) === lat && Number(s.lon) === lon)
          || sitios.find((s) => String(s.nombre) === String(item.nombre));
        if (sitio && typeof TourismModule.mostrarPopupSitio === 'function') {
          TourismModule.mostrarPopupSitio(sitio);
        }
      });
    }
    marker.addTo(capaLugarBuscado);
  }

  function limpiarLugarBuscado() {
    if (capaLugarBuscado) capaLugarBuscado.clearLayers();
  }

  /** ¿Está un punto (lat, lon) dentro de la vista actual del mapa? */
  function puntoEnVista(lat, lon) {
    if (!map) return true;
    return map.getBounds().contains([lat, lon]);
  }

  /** Suscribe un callback a los movimientos del mapa (pan/zoom). Devuelve una
   *  función para desuscribirse. */
  function onMoveend(callback) {
    if (!map) return () => {};
    map.on('moveend', callback);
    return () => map.off('moveend', callback);
  }

  // ---------------------------------------------------------------------
  // Rutas cargadas desde archivos KML/GPX + seguimiento GPS (tecla K)
  // ---------------------------------------------------------------------

  const COLOR_RUTA_ARCHIVO = '#2f7a6b';

  const _gruposRutaArchivo = {}; // id -> { grupo: L.layerGroup, lineaTurf }
  let _marcadorUsuario = null;   // marcador de la posición GPS del usuario

  /** Dibuja una ruta desde archivo (KML/GPX). `coords` es [[lat, lng], ...].
   *  Cada ruta se guarda con su propio `id` para poder quitarla de forma
   *  individual sin borrar las demás. Se dibuja en verde con los íconos A/Z
   *  de inicio y fin (iguales a los de origen/destino) y, al pasar el cursor
   *  (o tocar en móvil), muestra la distancia recorrida hasta ese punto a lo
   *  largo de la ruta. */
  /** Pulsación larga (≈550 ms) sobre la línea de una ruta de archivo en
   *  pantallas táctiles: equivale al clic derecho y abre el menú contextual
   *  del punto tocado (y suprime el clic posterior, que abriría el tooltip). */
  function _engancharPulsacionLargaRuta(hover, id) {
    const elt = hover.getElement();
    if (!elt) return;
    let timer = null;
    let disparado = false;
    let startX = 0;
    let startY = 0;

    elt.addEventListener('touchstart', (evt) => {
      if (evt.touches.length !== 1) return;
      const t = evt.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      disparado = false;
      timer = setTimeout(() => {
        disparado = true;
        _suprimirProximoClic = true;
        setTimeout(() => { _suprimirProximoClic = false; }, 700);
        navigator.vibrate && navigator.vibrate(20);
        if (!_onMenuPuntoRutaArchivo) return;
        const pos = L.DomEvent.getMousePosition(t, map.getContainer());
        const latlng = map.containerPointToLatLng(pos);
        _onMenuPuntoRutaArchivo(id, latlng, t.clientX, t.clientY);
      }, 550);
    }, { passive: true });

    elt.addEventListener('touchmove', (evt) => {
      if (!timer) return;
      const t = evt.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        clearTimeout(timer);
        timer = null;
      }
    }, { passive: true });

    elt.addEventListener('touchend', (evt) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (disparado) evt.preventDefault();
    }, { passive: false });

    elt.addEventListener('touchcancel', () => {
      if (timer) { clearTimeout(timer); timer = null; }
      disparado = false;
    });
  }

  function dibujarRutaArchivo(id, coords, meta = {}) {
    if (!coords || coords.length < 2) return;
    quitarRutaArchivo(id);

    const color = meta.color || COLOR_RUTA_ARCHIVO;
    const grupo = L.layerGroup().addTo(map);
    const lineaTurf = turf.lineString(coords.map((c) => [c[1], c[0]]));

    L.polyline(coords, {
      color, weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
      interactive: false,
    }).addTo(grupo);

    const hover = L.polyline(coords, {
      color, weight: 20, opacity: 0.01, fillOpacity: 0.01,
      interactive: true,
      _rutaArchivoId: id,
    });
    // Marca el elemento SVG del hover para que el menú contextual del mapa
    // ("Marcar tramo destapado / Agregar puerto") lo reconozca y no se abra
    // encima del menú de opciones de la ruta.
    hover.once('add', () => {
      const el = hover.getElement();
      if (el) el.classList.add('ruta-archivo-hover');
    });
    hover.addTo(grupo);

    const textoDistancia = (latlng) => {
      const snap = turf.nearestPointOnLine(lineaTurf, turf.point([latlng.lng, latlng.lat]), { units: 'kilometers' });
      const km = Math.max(0, snap.properties.location);
      return km.toFixed(1) + ' km';
    };

    hover.bindTooltip('', { sticky: true, direction: 'top', className: 'altimetria-map-tooltip' });
    hover.on('mousemove', (e) => {
      hover.setTooltipContent(textoDistancia(e.latlng));
    });
    hover.on('click', (e) => {
      hover.setTooltipContent(textoDistancia(e.latlng));
      hover.openTooltip(e.latlng);
    });
    hover.on('mouseout', () => hover.closeTooltip());

    // Clic secundario sobre la ruta: el menú contextual del punto (sin que se
    // abra además el menú del mapa con "Marcar tramo destapado / Agregar puerto").
    hover.on('contextmenu', (e) => {
      if (!_onMenuPuntoRutaArchivo) return;
      L.DomEvent.stop(e.originalEvent);
      _onMenuPuntoRutaArchivo(id, e.latlng, e.originalEvent.clientX, e.originalEvent.clientY);
    });
    _engancharPulsacionLargaRuta(hover, id);

    if (coords.length >= 2) {
      L.marker(coords[0], { icon: iconoOrigen(color), zIndexOffset: 50 })
        .bindTooltip('Inicio de la ruta', { direction: 'top', offset: [0, -10] })
        .addTo(grupo);
      L.marker(coords[coords.length - 1], { icon: iconoDestino(color), zIndexOffset: 50 })
        .bindTooltip('Final de la ruta', { direction: 'top', offset: [0, -10] })
        .addTo(grupo);
    }

    _gruposRutaArchivo[id] = { grupo, lineaTurf };
  }

  /** Muestra u oculta una ruta de archivo ya dibujada (sin quitarla).
   *  Devuelve el estado visible resultante. */
  function toggleRutaArchivo(id, visible) {
    const r = _gruposRutaArchivo[id];
    if (!r) return null;
    if (visible == null) visible = !map.hasLayer(r.grupo);
    if (visible) {
      if (!map.hasLayer(r.grupo)) r.grupo.addTo(map);
    } else if (map.hasLayer(r.grupo)) {
      map.removeLayer(r.grupo);
    }
    return visible;
  }

  function quitarRutaArchivo(id) {
    const r = _gruposRutaArchivo[id];
    if (r) {
      map.removeLayer(r.grupo);
      delete _gruposRutaArchivo[id];
    }
  }

  function limpiarRutasArchivo() {
    Object.keys(_gruposRutaArchivo).forEach(quitarRutaArchivo);
    // Si el catálogo P/A había ocultado estas capas, sus referencias quedan
    // obsoletas: no restaurarlas después.
    _capasOcultasInfra = null;
  }

  /** Ajusta la vista del mapa a los límites de las coordenadas dadas. */
  function ajustarVista(coords, padding) {
    if (!coords || !coords.length) return;
    const bounds = L.latLngBounds(coords);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: padding || [40, 40] });
  }

  /** Ícono del indicador GPS: un círculo con una punta que indica hacia donde
   *  orienta el dispositivo móvil (rumbo en grados, 0 = norte). */
  function _iconoUsuarioGPS(rumbo) {
    const r = rumbo == null ? 0 : rumbo;
    return L.divIcon({
      html: `<div class="gps-indicador">
        <span class="gps-indicador__punto" aria-hidden="true"></span>
        <span class="gps-indicador__punta" style="transform:rotate(${r}deg)" aria-hidden="true"></span>
      </div>`,
      className: '',
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  /** Rota la punta del indicador GPS según el rumbo del dispositivo. */
  function _rotarIndicadorGPS(rumbo) {
    if (!_marcadorUsuario || rumbo == null) return;
    const el = _marcadorUsuario.getElement();
    if (!el) return;
    const punta = el.querySelector('.gps-indicador__punta');
    if (punta) punta.style.transform = 'rotate(' + rumbo + 'deg)';
  }

  /** Crea (o mueve) el indicador de la posición GPS del usuario: un punto con
   *  una flecha que apunta hacia donde orienta el dispositivo móvil y la
   *  etiqueta permanente "Mi ubicación". `rumbo` son los grados de la brújula
   *  (0 = norte, en el sentido de las agujas del reloj). */
  function actualizarPosicionUsuario(lat, lon, rumbo) {
    if (!_marcadorUsuario) {
      _marcadorUsuario = L.marker([lat, lon], {
        icon: _iconoUsuarioGPS(rumbo),
        zIndexOffset: 1050,
      }).addTo(map);
      _marcadorUsuario.bindTooltip('Mi ubicación', {
        permanent: true, direction: 'top', offset: [0, -14],
        className: 'gps-ubicacion-tooltip',
      });
    } else {
      _marcadorUsuario.setLatLng([lat, lon]);
      _rotarIndicadorGPS(rumbo);
    }
  }

  /** Actualiza únicamente la dirección (rumbo) del indicador GPS, sin mover la
   *  posición. Si no hay indicador, no hace nada. */
  function actualizarDireccionUsuario(rumbo) {
    _rotarIndicadorGPS(rumbo);
  }

  function limpiarPosicionUsuario() {
    if (_marcadorUsuario) {
      map.removeLayer(_marcadorUsuario);
      _marcadorUsuario = null;
    }
  }

  // ---------------------------------------------------------------------
  // Rotación del mapa (rosa de los vientos)
  // ---------------------------------------------------------------------

  /** Rota el mapa a un rumbo dado (arrastre de la rosa de los vientos o
   *  teclado). El usuario decide siempre la dirección y el zoom. */
  function setBearing(grados) {
    if (map && typeof map.setBearing === 'function') map.setBearing(grados);
  }

  function getBearing() {
    if (!map || typeof map.getBearing !== 'function') return 0;
    return map.getBearing();
  }

  /** Crea la rosa de los vientos: arrastrar alrededor del botón rota el mapa
   *  y un clic (sin arrastre) vuelve a orientarlo al norte. */
  function _crearRosaVientos() {
    const contenedor = document.getElementById('btns-map-compass');
    if (!contenedor) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rosa-vientos';
    btn.title = 'Arrastrar para rotar el mapa · clic para orientar al norte';
    btn.setAttribute('aria-label', 'Rotar el mapa: arrastra para girarlo o haz clic para orientar al norte');
    btn.innerHTML = '<span class="rosa-vientos__aguja" aria-hidden="true"><img src="public/direction.svg" alt="" width="20" height="20"></span>';
    contenedor.appendChild(btn);

    const aguja = btn.querySelector('.rosa-vientos__aguja');
    // El SVG de direction.svg apunta 45° a la derecha; se compensa restando
    // 45° para que a rumbo 0 la aguja apunte al norte.
    const refrescarAguja = () => {
      if (aguja) aguja.style.transform = 'rotate(' + (getBearing() - 45) + 'deg)';
    };
    map.on('rotate', refrescarAguja);

    let arrastrando = false;
    let movido = false;
    let anguloInicial = 0;
    let rumboInicial = 0;

    const anguloDesdePuntero = (evt) => {
      const rect = btn.getBoundingClientRect();
      const dx = evt.clientX - (rect.left + rect.width / 2);
      const dy = evt.clientY - (rect.top + rect.height / 2);
      return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    };

    btn.addEventListener('pointerdown', (evt) => {
      evt.preventDefault();
      if (btn.setPointerCapture) btn.setPointerCapture(evt.pointerId);
      arrastrando = true;
      movido = false;
      anguloInicial = anguloDesdePuntero(evt);
      rumboInicial = getBearing();
    });

    btn.addEventListener('pointermove', (evt) => {
      if (!arrastrando) return;
      let delta = anguloDesdePuntero(evt) - anguloInicial;
      delta = ((delta % 360) + 360) % 360;
      if (delta > 180) delta -= 360;
      if (Math.abs(delta) > 1) movido = true;
      setBearing((rumboInicial + delta + 360) % 360);
    });

    const soltar = (evt) => {
      if (!arrastrando) return;
      arrastrando = false;
      if (btn.hasPointerCapture && btn.hasPointerCapture(evt.pointerId)) {
        btn.releasePointerCapture(evt.pointerId);
      }
      if (!movido) setBearing(0);
    };
    btn.addEventListener('pointerup', soltar);
    btn.addEventListener('pointercancel', soltar);

    btn.addEventListener('keydown', (evt) => {
      if (evt.key === 'Enter' || evt.key === ' ') {
        evt.preventDefault();
        setBearing(0);
      }
    });

    refrescarAguja();
  }

  return {
    init,
    getMap,
    invalidateSize,
    alternarVistaSatelite,
    esVistaSatelite,
    iconoSitio,
    setMarcadorOrigen,
    setMarcadorDestino,
    setOnClicMarcadorExtremo,
    setOnClicInfraGlobal,
    setOnPuertoMovidoGlobal,
    setOnMenuPuertoGlobal,
    setOnMenuCatalogoGlobal,
    setOnMoverCatalogoGlobal,
    iniciarArrastrePuerto,
    iniciarArrastreCatalogo,
    setOnAgregarPuertoEn,
    setOnMenuPuntoRutaArchivo,
    dibujarConexiones,
    limpiarConexiones,
    estanConexionesAbiertas,
    toggleRedFluvial,
    redFluvialVisible,
    ocultarRutasYSitios,
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
    activarSeleccionComparar,
    desactivarSeleccionComparar,
    actualizarMarcadoresComparacion,
    dibujarRuta,
    setAltimetriaActiva,
    habilitarArrastreRuta,
    dibujarTramoAereo,
    dibujarTramoMixto,
    limpiarTramoAereo,
    setMarcadoresAeropuertos,
    limpiarMarcadoresAeropuertos,
    dibujarTramoFluvial,
    limpiarTramoFluvial,
    setMarcadoresPuertos,
    limpiarMarcadoresPuertos,
    setMarcadoresPuertosGlobal,
    limpiarPuertosGlobal,
    setMarcadoresAeropuertosGlobal,
    limpiarAeropuertosGlobal,
    setMarcadoresDepartamentosGlobal,
    limpiarDepartamentosGlobal,
    setMarcadoresMunicipiosGlobal,
    limpiarMunicipiosGlobal,
    dibujarRutaPreview,
    limpiarRutaPreview,
    limpiarRuta,
    limpiarTodo,
    dibujarRutaArchivo,
    quitarRutaArchivo,
    toggleRutaArchivo,
    limpiarRutasArchivo,
    ajustarVista,
    actualizarPosicionUsuario,
    actualizarDireccionUsuario,
    limpiarPosicionUsuario,
    setBearing,
    getBearing,
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
    mostrarLugarBuscado,
    limpiarLugarBuscado,
    puntoEnVista,
    onMoveend,
  };
})();
