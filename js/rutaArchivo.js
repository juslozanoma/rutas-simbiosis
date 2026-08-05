/**
 * rutaArchivo.js
 * ---------------------------------------------------------------------------
 * Rutas cargadas desde archivos KML/GPX (tecla K): el diálogo ofrece añadir
 * una nueva ruta o continuar con la actual (guardadas en localStorage), se
 * dibujan en verde con los íconos A/Z de inicio y fin, cada tarjeta de la
 * lista tiene una X para quitarla de la memoria y hay seguimiento GPS con
 * la etiqueta flotante "Seguir ruta" y el indicador "Mi ubicación".
 * La tecla K abre el diálogo y, si está abierto, vuelve a la normalidad.
 * ---------------------------------------------------------------------------
 */
const RutaArchivoModule = (() => {

  const VELOCIDAD_CAMINATA_KMH = 4.5; // ritmo promedio caminando
  const CLAVE_STORAGE = 'rutas-simbiosis:rutas-archivo';

  let _modoActivo = false;       // modo ruta de archivo (panel oculto, rutas en el mapa)
  let _rutaActualId = null;      // ruta "actual" (la más reciente) para el GPS
  let _rutas = [];               // [{ id, nombre, coords, km, seg }]
  const _rutasOcultas = new Set(); // ids de rutas ocultas del mapa (clic en su ficha)
  let _secuencia = 0;            // generador de ids
  let _watcherId = null;

  // -------------------------------------------------------------------
  // Persistencia en localStorage
  // -------------------------------------------------------------------

  function _cargarGuardadas() {
    _rutas = [];
    try {
      const raw = localStorage.getItem(CLAVE_STORAGE);
      if (raw) {
        const datos = JSON.parse(raw);
        if (Array.isArray(datos)) _rutas = datos;
      }
    } catch (err) {
      console.warn('[RUTA] No se pudieron leer las rutas guardadas:', err);
    }
    _secuencia = 0;
    _rutas.forEach((r) => {
      if (typeof r.id !== 'string') r.id = 'ruta-' + (++_secuencia);
      const m = /^ruta-(\d+)$/.exec(r.id);
      if (m) _secuencia = Math.max(_secuencia, Number(m[1]));
      if (typeof r.seg !== 'number') r.seg = Math.round((r.km / VELOCIDAD_CAMINATA_KMH) * 3600);
    });
  }

  function _guardar() {
    try {
      const compactas = _rutas.map((r) => ({
        id: r.id,
        nombre: r.nombre,
        km: r.km,
        seg: r.seg,
        coords: r.coords.map((c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6]),
      }));
      localStorage.setItem(CLAVE_STORAGE, JSON.stringify(compactas));
    } catch (err) {
      console.warn('[RUTA] No se pudieron guardar las rutas:', err);
    }
  }

  // -------------------------------------------------------------------
  // Diálogo de carga (tecla K)
  // -------------------------------------------------------------------

  function abrirDialogo() {
    if (!el.panelCargarRuta) return;
    if (el.cargarRutaError) { el.cargarRutaError.hidden = true; el.cargarRutaError.textContent = ''; }
    if (el.cargarRutaFileLabel) el.cargarRutaFileLabel.textContent = 'Elegir archivo…';
    if (el.inputRutaArchivo) el.inputRutaArchivo.value = '';
    // "Continuar con la actual" solo cuando hay rutas guardadas y el modo
    // no está activo (las rutas ya están en el mapa).
    if (el.btnContinuarRuta) el.btnContinuarRuta.hidden = !_rutas.length || _modoActivo;
    el.panelCargarRuta.hidden = false;
  }

  function cerrarDialogo() {
    if (el.panelCargarRuta) el.panelCargarRuta.hidden = true;
  }

  /** Tecla K: abre el diálogo o, si ya está abierto, vuelve a la normalidad
   *  (las rutas guardadas permanecen en localStorage). */
  function toggleK() {
    if (!el.panelCargarRuta) return;
    if (!el.panelCargarRuta.hidden) salirModo();
    else abrirDialogo();
  }

  function _mostrarError(msg) {
    if (el.cargarRutaError) {
      el.cargarRutaError.textContent = msg;
      el.cargarRutaError.hidden = false;
    }
  }

  // -------------------------------------------------------------------
  // Carga y dibujo de rutas
  // -------------------------------------------------------------------

  async function procesarArchivo(file) {
    try {
      const texto = await file.text();
      const parseado = _parsearArchivo(texto);
      if (!parseado || parseado.coords.length < 2) {
        _mostrarError('El archivo no contiene una ruta válida (KML o GPX).');
        return false;
      }
      const ruta = {
        id: 'ruta-' + (++_secuencia),
        nombre: parseado.nombre || file.name,
        coords: parseado.coords,
        km: _distanciaTotal(parseado.coords),
        seg: 0,
      };
      ruta.seg = Math.round((ruta.km / VELOCIDAD_CAMINATA_KMH) * 3600);
      _rutas.push(ruta);
      _guardar();

      _rutaActualId = ruta.id;
      _activarModo();
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Ruta cargada: ' + ruta.nombre);
      return true;
    } catch (err) {
      _mostrarError('No se pudo leer el archivo.');
      return false;
    }
  }

  /** "Continuar con la actual": vuelve a mostrar las rutas guardadas. */
  function continuar() {
    if (!_rutas.length) return;
    _rutaActualId = _rutas[_rutas.length - 1].id;
    _activarModo();
  }

  function _activarModo() {
    _modoActivo = true;
    _rutaArchivoActiva = true;
    _rutasOcultas.clear();
    _dibujarTodas();
    _actualizarStats();
    if (el.btnGps) el.btnGps.hidden = false;
    cerrarDialogo();
    _ocultarPanel();
  }

  function _dibujarTodas() {
    _rutas.forEach((r) => {
      if (_rutasOcultas.has(r.id)) return;
      MapModule.dibujarRutaArchivo(r.id, r.coords, { nombre: r.nombre });
    });
  }

  function _geojsonRuta(ruta) {
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: ruta.coords.map((c) => [c[1], c[0]]),
      },
    };
  }

  /** Clic en la ficha de una ruta: primero la oculta del mapa y, al pulsarla
   *  de nuevo, la muestra centrando la vista y abriendo su altimetría. */
  function _clicTarjeta(id, tarjeta) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta) return;
    const oculta = _rutasOcultas.has(id);
    if (!oculta) {
      _rutasOcultas.add(id);
      MapModule.toggleRutaArchivo(id, false);
      if (tarjeta) tarjeta.classList.add('sitio-card--ruta-oculta');
      return;
    }
    _rutasOcultas.delete(id);
    MapModule.toggleRutaArchivo(id, true);
    MapModule.ajustarVista(ruta.coords);
    if (tarjeta) tarjeta.classList.remove('sitio-card--ruta-oculta');
    if (typeof mostrarAltimetriaRutaArchivo === 'function') {
      mostrarAltimetriaRutaArchivo(_geojsonRuta(ruta), ruta.km);
    }
  }

  function _totalKm() {
    return _rutas.reduce((acc, r) => acc + r.km, 0);
  }

  function _totalSeg() {
    return _rutas.reduce((acc, r) => acc + r.seg, 0);
  }

  /** Quita una ruta de la memoria (mapa + lista + localStorage). */
  function quitarRuta(id) {
    const idx = _rutas.findIndex((r) => r.id === id);
    if (idx === -1) return;
    _rutas.splice(idx, 1);
    MapModule.quitarRutaArchivo(id);
    _guardar();

    if (_rutaActualId === id) {
      _desactivarSeguimiento();
      _rutaActualId = _rutas.length ? _rutas[_rutas.length - 1].id : null;
    }

    if (!_rutas.length) {
      salirModo();
      return;
    }
    if (_modoActivo) {
      _actualizarStats();
      _renderTarjetas();
    }
  }

  /** Vuelve a la normalidad: cierra el diálogo, oculta las rutas del mapa y
   *  restaura el panel. Las rutas guardadas permanecen en localStorage. */
  function salirModo() {
    _desactivarSeguimiento();
    MapModule.limpiarRutasArchivo();
    _modoActivo = false;
    _rutaArchivoActiva = false;
    _rutaActualId = null;
    if (el.btnGps) el.btnGps.hidden = true;
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
    _restaurarPanel();
    cerrarDialogo();
  }

  /** Re-renderiza las tarjetas de rutas en la pestaña Ruta (si el modo sigue
   *  activo), p. ej. cuando se desactiva el catálogo de aeropuertos/puertos. */
  function refrescarPanel() {
    if (_modoActivo) _renderTarjetas();
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
    if (!_modoActivo || !_rutaActualId || _watcherId != null) return;
    if (!navigator.geolocation) {
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Tu navegador no soporta geolocalización.');
      return;
    }
    const rutaActual = _rutas.find((r) => r.id === _rutaActualId);
    if (!rutaActual) return;
    const linea = turf.lineString(rutaActual.coords.map((c) => [c[1], c[0]]));
    if (el.seguirRuta) el.seguirRuta.hidden = false;
    _watcherId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        MapModule.actualizarPosicionUsuario(lat, lon);
        MapModule.centrarEn(lat, lon, 15);
        const km = _progresoKm(linea, lat, lon);
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

  function _progresoKm(linea, lat, lon) {
    if (!linea) return 0;
    const snap = turf.nearestPointOnLine(linea, turf.point([lon, lat]), { units: 'kilometers' });
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
  // Panel: ocultar elementos como en aeropuertos/puertos y tarjetas de rutas
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
    _renderTarjetas();
  }

  function _actualizarStats() {
    const km = _totalKm();
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = km.toFixed(1) + ' km';
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = _formatearTiempo(_totalSeg());
    if (el.paradasContador) el.paradasContador.textContent = km.toFixed(1) + ' km';
  }

  function _renderTarjetas() {
    if (!el.paradasLista) return;
    el.paradasLista.innerHTML = '';
    _rutas.forEach((r, i) => {
      const li = Utils.crearElemento(`
        <li class="sitio-card${_rutasOcultas.has(r.id) ? ' sitio-card--ruta-oculta' : ''}" data-ruta-archivo-id="${r.id}">
          <div class="sitio-card__top">
            <span class="sitio-card__nombre"><span class="sitio-card__num">${i + 1}.</span>${_escapeHtml(r.nombre)}</span>
            <button type="button" class="sitio-card__quitar" data-quitar-ruta="${r.id}" title="Quitar ruta de la memoria" aria-label="Quitar ruta de la memoria">&times;</button>
          </div>
          <p class="sitio-card__ciudad">${r.km.toFixed(1)} km totales</p>
        </li>
      `);
      el.paradasLista.appendChild(li);
    });
    _actualizarStats();
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
    _cargarGuardadas();
    if (el.inputRutaArchivo) {
      el.inputRutaArchivo.addEventListener('change', () => {
        const file = el.inputRutaArchivo.files && el.inputRutaArchivo.files[0];
        if (!file) return;
        if (el.cargarRutaFileLabel) el.cargarRutaFileLabel.textContent = file.name;
        procesarArchivo(file);
      });
    }
    if (el.btnContinuarRuta) el.btnContinuarRuta.addEventListener('click', continuar);
    if (el.btnCerrarCargarRuta) el.btnCerrarCargarRuta.addEventListener('click', cerrarDialogo);
    if (el.panelCargarRuta) {
      el.panelCargarRuta.addEventListener('click', (e) => {
        if (e.target === el.panelCargarRuta) cerrarDialogo();
      });
    }
    if (el.btnGps) el.btnGps.addEventListener('click', toggleSeguimiento);
    // "Subir tu propia ruta" (solo móvil): mismo comportamiento que la tecla K.
    if (el.btnSubirRutaPropia) el.btnSubirRutaPropia.addEventListener('click', toggleK);
    // X roja junto a la pestaña Rutas (móvil y PC): cierra las rutas de archivo
    // y vuelve al menú normal de Rutas y Descubre Colombia.
    if (el.btnCerrarRutasArchivo) el.btnCerrarRutasArchivo.addEventListener('click', salirModo);
    if (el.btnCerrarRutasArchivoDesktop) el.btnCerrarRutasArchivoDesktop.addEventListener('click', salirModo);
    if (el.paradasLista) {
      el.paradasLista.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-quitar-ruta]');
        if (btn) {
          e.stopPropagation();
          quitarRuta(btn.getAttribute('data-quitar-ruta'));
          return;
        }
        const tarjeta = e.target.closest('[data-ruta-archivo-id]');
        if (tarjeta) {
          _clicTarjeta(tarjeta.getAttribute('data-ruta-archivo-id'), tarjeta);
        }
      });
    }
  }

  return {
    initEventos,
    abrirDialogo,
    cerrarDialogo,
    toggleK,
    procesarArchivo,
    continuar,
    quitarRuta,
    salirModo,
    refrescarPanel,
  };
})();
