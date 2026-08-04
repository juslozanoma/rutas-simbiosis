/**
 * rutaArchivo.js
 * ---------------------------------------------------------------------------
 * Carga de rutas desde archivos KML/GPX (tecla K): diálogo de subida, dibujo
 * de la ruta en el mapa, seguimiento GPS con la etiqueta flotante "Seguir
 * ruta" (progreso en kilómetros a lo largo de la ruta) y tarjeta con el
 * nombre y los kilómetros totales en la pestaña Ruta.
 * ---------------------------------------------------------------------------
 */
const RutaArchivoModule = (() => {

  const VELOCIDAD_CAMINATA_KMH = 4.5; // ritmo promedio caminando

  let _activa = false;
  let _nombre = '';
  let _coords = [];
  let _lineaTurf = null;
  let _km = 0;
  let _seg = 0;
  let _watcherId = null;

  // -------------------------------------------------------------------
  // Diálogo de carga (tecla K)
  // -------------------------------------------------------------------

  function abrirDialogo() {
    if (!el.panelCargarRuta) return;
    if (!el.panelCargarRuta.hidden) { cerrarDialogo(); return; }
    if (el.btnQuitarRuta) el.btnQuitarRuta.hidden = !_activa;
    if (el.cargarRutaError) { el.cargarRutaError.hidden = true; el.cargarRutaError.textContent = ''; }
    if (el.cargarRutaFileLabel) el.cargarRutaFileLabel.textContent = 'Elegir archivo…';
    if (el.inputRutaArchivo) el.inputRutaArchivo.value = '';
    el.panelCargarRuta.hidden = false;
  }

  function cerrarDialogo() {
    if (el.panelCargarRuta) el.panelCargarRuta.hidden = true;
  }

  function _mostrarError(msg) {
    if (el.cargarRutaError) {
      el.cargarRutaError.textContent = msg;
      el.cargarRutaError.hidden = false;
    }
  }

  // -------------------------------------------------------------------
  // Carga y dibujo de la ruta
  // -------------------------------------------------------------------

  async function procesarArchivo(file) {
    try {
      const texto = await file.text();
      const parseado = _parsearArchivo(texto);
      if (!parseado || parseado.coords.length < 2) {
        _mostrarError('El archivo no contiene una ruta válida (KML o GPX).');
        return false;
      }
      _coords = parseado.coords;
      _nombre = parseado.nombre || file.name;
      _km = _distanciaTotal(_coords);
      _seg = Math.round((_km / VELOCIDAD_CAMINATA_KMH) * 3600);
      _lineaTurf = turf.lineString(_coords.map((c) => [c[1], c[0]]));

      MapModule.dibujarRutaArchivo(_coords);
      MapModule.ajustarVista(_coords);
      _activa = true;
      _rutaArchivoActiva = true;

      if (el.btnGps) el.btnGps.hidden = false;
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = _km.toFixed(1) + ' km';
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = _formatearTiempo(_seg);

      cerrarDialogo();
      _ocultarPanel();
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Ruta cargada: ' + _nombre);
      return true;
    } catch (err) {
      _mostrarError('No se pudo leer el archivo.');
      return false;
    }
  }

  function quitarRuta() {
    MapModule.limpiarRutaArchivo();
    _desactivarSeguimiento();
    _activa = false;
    _rutaArchivoActiva = false;
    _nombre = '';
    _coords = [];
    _lineaTurf = null;
    _km = 0;
    _seg = 0;
    if (el.btnGps) el.btnGps.hidden = true;
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
    _restaurarPanel();
    cerrarDialogo();
  }

  /** Re-renderiza la tarjeta de la ruta en la pestaña Ruta (si el modo sigue
   *  activo), p. ej. cuando se desactiva el catálogo de aeropuertos/puertos. */
  function refrescarPanel() {
    if (_activa) _renderTarjetaRuta();
  }

  // -------------------------------------------------------------------
  // Parseo KML / GPX (solo geometría de líneas)
  // -------------------------------------------------------------------

  function _parsearArchivo(texto) {
    const doc = new DOMParser().parseFromString(texto, 'text/xml');
    if (!doc || doc.querySelector('parsererror')) return null;
    const raiz = doc.documentElement;
    if (!raiz) return null;
    const etiqueta = raiz.tagName.replace(/^.*:/, '').toUpperCase();
    if (etiqueta === 'KML') return _parsearKml(doc);
    if (etiqueta === 'GPX') return _parsearGpx(doc);
    return null;
  }

  function _parsearKml(doc) {
    let nombre = '';
    const primerPlacemark = doc.getElementsByTagName('Placemark')[0];
    if (primerPlacemark) {
      const n = primerPlacemark.getElementsByTagName('name')[0];
      if (n) nombre = (n.textContent || '').trim();
    }
    const coords = [];
    const lineas = doc.getElementsByTagName('LineString');
    for (const ls of lineas) {
      const c = ls.getElementsByTagName('coordinates')[0];
      if (!c) continue;
      (c.textContent || '').trim().split(/\s+/).forEach((tripleta) => {
        const p = tripleta.split(',').map(Number);
        if (p.length >= 2 && !isNaN(p[0]) && !isNaN(p[1])) coords.push([p[1], p[0]]); // [lat, lng]
      });
    }
    return { nombre, coords: _limpiarCoords(coords) };
  }

  function _parsearGpx(doc) {
    let nombre = '';
    const trk = doc.getElementsByTagName('trk')[0];
    if (trk) {
      const n = trk.getElementsByTagName('name')[0];
      if (n) nombre = (n.textContent || '').trim();
    }
    const coords = [];
    const segs = doc.getElementsByTagName('trkseg');
    for (const s of segs) {
      const pts = s.getElementsByTagName('trkpt');
      for (const pt of pts) {
        const lat = parseFloat(pt.getAttribute('lat'));
        const lon = parseFloat(pt.getAttribute('lon'));
        if (!isNaN(lat) && !isNaN(lon)) coords.push([lat, lon]);
      }
    }
    if (!coords.length) {
      const rte = doc.getElementsByTagName('rte')[0];
      if (rte) {
        const pts = rte.getElementsByTagName('rtept');
        for (const pt of pts) {
          const lat = parseFloat(pt.getAttribute('lat'));
          const lon = parseFloat(pt.getAttribute('lon'));
          if (!isNaN(lat) && !isNaN(lon)) coords.push([lat, lon]);
        }
      }
    }
    return { nombre, coords: _limpiarCoords(coords) };
  }

  function _limpiarCoords(coords) {
    const limpios = [];
    coords.forEach((c) => {
      const ultimo = limpios[limpios.length - 1];
      if (!ultimo || ultimo[0] !== c[0] || ultimo[1] !== c[1]) limpios.push(c);
    });
    return limpios;
  }

  function _distanciaTotal(coords) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += turf.distance(
        turf.point([coords[i - 1][1], coords[i - 1][0]]),
        turf.point([coords[i][1], coords[i][0]]),
        { units: 'kilometers' }
      );
    }
    return total;
  }

  function _formatearTiempo(seg) {
    const h = Math.floor(seg / 3600);
    const min = Math.round((seg % 3600) / 60);
    if (h > 0) return h + ' h ' + min + ' min';
    return min + ' min';
  }

  // -------------------------------------------------------------------
  // Seguimiento GPS
  // -------------------------------------------------------------------

  function toggleSeguimiento() {
    if (_watcherId != null) _desactivarSeguimiento();
    else activarSeguimiento();
  }

  function activarSeguimiento() {
    if (!_activa || _watcherId != null) return;
    if (!navigator.geolocation) {
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Tu navegador no soporta geolocalización.');
      return;
    }
    if (el.seguirRuta) el.seguirRuta.hidden = false;
    _watcherId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        MapModule.actualizarPosicionUsuario(lat, lon);
        MapModule.centrarEn(lat, lon, 15);
        const km = _progresoKm(lat, lon);
        if (el.seguirRutaContenido) {
          el.seguirRutaContenido.textContent = 'Seguir ruta · ' + km.toFixed(1) + ' km';
        }
      },
      () => {
        _desactivarSeguimiento();
        if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  function _progresoKm(lat, lon) {
    if (!_lineaTurf) return 0;
    const snap = turf.nearestPointOnLine(_lineaTurf, turf.point([lon, lat]), { units: 'kilometers' });
    return Math.max(0, snap.properties.location);
  }

  function _desactivarSeguimiento() {
    if (_watcherId != null) {
      navigator.geolocation.clearWatch(_watcherId);
      _watcherId = null;
    }
    MapModule.limpiarPosicionUsuario();
    if (el.seguirRuta) el.seguirRuta.hidden = true;
  }

  // -------------------------------------------------------------------
  // Panel: ocultar elementos como en aeropuertos/puertos y tarjeta de ruta
  // -------------------------------------------------------------------

  function _ocultarPanel() {
    if (el.appRoot) el.appRoot.setAttribute('data-ruta-archivo', 'true');
    if (estaEnPestanaDescubre()) {
      if (esMovil()) setMobileTab('ruta');
      else activarPanelTab('ruta');
    }
    if (el.panelLocate) el.panelLocate.hidden = true;
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = true;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = true;
    if (el.btnMostrarSitiosCercanos) {
      el.btnMostrarSitiosCercanos.hidden = true;
      el.btnMostrarSitiosCercanos.disabled = true;
    }
    _renderTarjetaRuta();
  }

  function _renderTarjetaRuta() {
    if (!el.paradasLista) return;
    el.paradasLista.innerHTML = '';
    const li = Utils.crearElemento(`
      <li class="sitio-card">
        <div class="sitio-card__top">
          <span class="sitio-card__nombre">${_escapeHtml(_nombre)}</span>
        </div>
        <p class="sitio-card__ciudad">${_km.toFixed(1)} km totales</p>
      </li>
    `);
    el.paradasLista.appendChild(li);
    if (el.paradasContador) el.paradasContador.textContent = _km.toFixed(1) + ' km';
    if (el.paradasTitulo) el.paradasTitulo.textContent = 'Ruta';
    if (el.btnAgregarIntermedio) el.btnAgregarIntermedio.hidden = true;
    const lblAuto = el.checkAutoOrganizar && el.checkAutoOrganizar.closest('label');
    if (lblAuto) lblAuto.hidden = true;
    if (el.panelParadas) el.panelParadas.hidden = false;
  }

  function _restaurarPanel() {
    if (el.appRoot) el.appRoot.removeAttribute('data-ruta-archivo');
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
    if (typeof _restaurarPanelRutaInfra === 'function') _restaurarPanelRutaInfra();
    // Si el catálogo de aeropuertos/puertos (A/P) sigue activo, reponer su listado.
    if ((_puertosVisibles || _aeropuertosVisibles) && typeof renderizarInfraListado === 'function') {
      renderizarInfraListado();
    }
    activarPanelTab('ruta');
    if (esMovil()) setMobileTab('ruta');
  }

  function _escapeHtml(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------------------
  // Eventos
  // -------------------------------------------------------------------

  function initEventos() {
    if (el.inputRutaArchivo) {
      el.inputRutaArchivo.addEventListener('change', () => {
        const file = el.inputRutaArchivo.files && el.inputRutaArchivo.files[0];
        if (!file) return;
        if (el.cargarRutaFileLabel) el.cargarRutaFileLabel.textContent = file.name;
        procesarArchivo(file);
      });
    }
    if (el.btnCerrarCargarRuta) el.btnCerrarCargarRuta.addEventListener('click', cerrarDialogo);
    if (el.btnQuitarRuta) el.btnQuitarRuta.addEventListener('click', quitarRuta);
    if (el.panelCargarRuta) {
      el.panelCargarRuta.addEventListener('click', (e) => {
        if (e.target === el.panelCargarRuta) cerrarDialogo();
      });
    }
    if (el.btnGps) el.btnGps.addEventListener('click', toggleSeguimiento);
  }

  return { initEventos, abrirDialogo, cerrarDialogo, procesarArchivo, quitarRuta, refrescarPanel };
})();
