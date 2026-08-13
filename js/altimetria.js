const AltimetriaModule = (() => {
  let _rutaGeojson = null;
  let _elevacion = null;
  let _paradas = [];      // [{lat, lon, nombre, distKm}]
  let _totalKm = 0;
  let _puntoHover = null;  // {lat, lon, dist, alt}
  let _onSetInicio = null;
  let _onSetFin = null;
  let _onVerMapa = null;
  let _onHoverMapa = null;
  let _onLeaveMapa = null;
  let _onCentrarMapa = null;
  let _followActivo = ('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  let _inicioOffset = 0;       // distancia (km) del perfil que se muestra como inicio del eje x
  let _finOffset = null;       // distancia (km) del perfil que se muestra como fin del eje x (null = total)
  let _inicioAsignado = false; // true si el usuario asignó un punto como inicio
  let _finAsignado = false;    // true si el usuario asignó un punto como fin
  let _nombreOrigen = 'Origen';
  let _nombreDestino = 'Destino';
  let _onEliminarParada = null;
  let _nSegmentos = 1;          // número de tramos en carro del perfil (MultiLineString)
  let _segmentoActivo = 0;      // índice (0-based) del tramo visible (por defecto el 1)
  let _segmentoExtremos = null; // [[nombreInicio, nombreFin], ...] por tramo
  const _esTactil = ('ontouchstart' in window) || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);

  // Arrastre horizontal del perfil (clic + mover para desplazarse lateralmente).
  let _arrastrePerfil = null; // {cont, startX, startZs, startZe}

  // Comparación de puntos: 1 y 2 sobre el perfil (distancia/altura entre ellos).
  let _compararA = null;           // {lat, lon, coord, distKm, alt}
  let _compararB = null;           // {lat, lon, coord, distKm, alt}
  let _compararActivo = false;     // A y B definidos → el perfil muestra A→B
  let _esperandoComparar = false;  // A elegido, se espera el segundo punto

  // Pulsación larga en el perfil (móvil) para abrir el menú "Comparar este sitio".
  let _longPressTimer = null;
  let _longPressX = 0;
  let _longPressY = 0;
  let _touchTap = null;          // {x, y} de un toque de 1 dedo sin mover
  let _suprimirClicComparar = false;

  let _bannerComparar = null;

  function _onPerfilDragMove(ev) {
    const arr = _arrastrePerfil;
    if (!arr || !arr.cont) return;
    const cont = arr.cont;
    if (!cont._svg || !cont._plotW) return;
    const dx = ev.clientX - arr.startX;
    const span = arr.startZe - arr.startZs;
    if (span <= 0) return;
    const dKm = -(dx / cont._plotW) * span;
    let nuevoIni = arr.startZs + dKm;
    let nuevoFin = arr.startZe + dKm;
    const domIni = cont._domInicio != null ? cont._domInicio : 0;
    const domFin = cont._domFin != null ? cont._domFin : cont._maxD;
    if (nuevoIni < domIni) { nuevoFin += domIni - nuevoIni; nuevoIni = domIni; }
    if (nuevoFin > domFin) { nuevoIni -= nuevoFin - domFin; nuevoFin = domFin; }
    if (nuevoFin - nuevoIni < MIN_SPAN_ZOOM) return;
    cont._zoomStart = nuevoIni;
    cont._zoomEnd = nuevoFin;
    _construir(cont);
  }

  function _onPerfilDragEnd() {
    _arrastrePerfil = null;
  }

  document.addEventListener('mousemove', _onPerfilDragMove);
  document.addEventListener('mouseup', _onPerfilDragEnd);

  // Al redimensionar la ventana (PC) o girar el celular el perfil quedaría
  // estirado con el ancho anterior; se re-renderiza con el tamaño actual.
  let _rafReRender = null;
  function _reRenderPorResize() {
    if (_rafReRender != null) return;
    _rafReRender = requestAnimationFrame(() => {
      _rafReRender = null;
      renderizarVisibles();
    });
  }
  window.addEventListener('resize', _reRenderPorResize);
  window.addEventListener('orientationchange', _reRenderPorResize);

  const MIN_SPAN_ZOOM = 0.5;   // km mínimos de rango visible al hacer zoom horizontal
  const _CAR_MEDIA = 11;       // mitad del tamaño del indicador de hover (carro verde, 22px)

  let _tooltipIndicador = null;

  function _acumular(coords, elev) {
    // LineString (coords plano) o MultiLineString (varios tramos separados,
    // p. ej. carretera→aeropuerto y aeropuerto→carretera). La distancia se
    // acumula de forma continua (kilometraje solo de carretera) y cada punto
    // guarda su tramo para no dibujar líneas entre tramos distintos.
    const tramos = (coords && Array.isArray(coords[0]) && Array.isArray(coords[0][0])) ? coords : [coords];
    const total = [];
    let acc = 0;
    let ei = 0; // índice aplanado: recorre TODOS los tramos en el mismo orden que `elev`
    const elevS = _suavizarElevacion(elev, _SUAVIZADO_RADIO);
    for (let si = 0; si < tramos.length; si++) {
      const tramo = tramos[si];
      for (let i = 0; i < tramo.length; i++) {
        if (i > 0) {
          acc += turf.distance(turf.point(tramo[i - 1]), turf.point(tramo[i]), { units: 'kilometers' });
        }
        total.push({ d: acc, e: elevS && elevS[ei] != null ? elevS[ei] : null, coord: tramo[i], seg: si });
        ei++;
      }
    }
    return total;
  }

  /** Radio de la media móvil centrada aplicada a la elevación: suaviza el
   *  ruido de cuantización del SRTM (pasos de metros enteros que crean zonas
   *  planas falsas y picos dentados) sin descartar ningún punto muestreado. */
  const _SUAVIZADO_RADIO = 8;

  /** Media móvil centrada sobre los valores de elevación. Conserva el mismo
   *  número de puntos y sus posiciones; solo redondea las alturas para que la
   *  curva quede suave. Los extremos (primera/última ventana) usan la media de
   *  los valores disponibles. Los null se ignoran y no propagan. */
  function _suavizarElevacion(elev, radio) {
    if (!elev || elev.length < 3) return elev;
    const r = Math.max(1, radio || 8);
    const out = elev.slice();
    for (let i = 0; i < elev.length; i++) {
      if (elev[i] == null) continue;
      let suma = 0;
      let n = 0;
      const ini = Math.max(0, i - r);
      const fin = Math.min(elev.length - 1, i + r);
      for (let j = ini; j <= fin; j++) {
        if (elev[j] == null) continue;
        suma += elev[j];
        n++;
      }
      out[i] = n > 0 ? suma / n : elev[i];
    }
    return out;
  }

  function setDatos(rutaGeojson, elevacion, totalKm, limpiarParadas = true) {
    _rutaGeojson = rutaGeojson;
    _elevacion = elevacion;
    _totalKm = totalKm;
    if (limpiarParadas) {
      _paradas = [];
      _inicioOffset = 0;
      _finOffset = null;
      _inicioAsignado = false;
      _finAsignado = false;
      _segmentoActivo = 0;
      _cancelarLongPress();
      _compararA = null;
      _compararB = null;
      _compararActivo = false;
      _esperandoComparar = false;
      _activarSeleccionMapa(false);
      _ocultarBannerComparar();
      _actualizarMarcadoresComparacion();
    }
    const geo = rutaGeojson && rutaGeojson.geometry;
    const coords = geo && geo.coordinates;
    _nSegmentos = (geo && geo.type === 'MultiLineString' && Array.isArray(coords)) ? coords.length : 1;
    if (_segmentoActivo >= _nSegmentos) _segmentoActivo = 0;
    _renderSegmentosHeader();
    _puntoHover = null;
  }

  /** Nombres de los extremos (inicio/fin) de cada tramo en carro del perfil. */
  function setSegmentosExtremos(extremos) {
    _segmentoExtremos = extremos && Array.isArray(extremos) ? extremos : null;
  }

  /** Selecciona el tramo en carro a mostrar (índice 0-based); el 1 por defecto. */
  function setSegmentoActivo(idx) {
    const next = (idx == null || idx < 0 || idx >= _nSegmentos) ? 0 : idx;
    if (next === _segmentoActivo) return;
    _segmentoActivo = next;
    _renderSegmentosHeader();
    _renderizarTodo();
  }

  /** Pinta los botones numerados (1..N) a la derecha del título del perfil. */
  function _renderSegmentosHeader() {
    ['altimetria-segmentos', 'altimetria-segmentos-panel'].forEach((id) => {
      const cont = document.getElementById(id);
      if (!cont) return;
      cont.innerHTML = '';
      if (_nSegmentos <= 1) { cont.hidden = true; return; }
      cont.hidden = false;
      for (let i = 0; i < _nSegmentos; i++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'altimetria__segmento' + (i === _segmentoActivo ? ' altimetria__segmento--activo' : '');
        btn.textContent = String(i + 1);
        btn.title = 'Segmento en carro ' + (i + 1);
        btn.setAttribute('aria-label', 'Segmento en carro ' + (i + 1));
        btn.addEventListener('click', () => setSegmentoActivo(i));
        cont.appendChild(btn);
      }
    });
  }

  function agregarParada(lat, lon, nombre, distKm, label, id, tipo) {
    _paradas.push({ lat, lon, nombre, distKm, label: label || '', id: id != null ? id : null, tipo: tipo || 'parada' });
  }

  function setOnEliminarParada(fn) { _onEliminarParada = fn; }

  /** Define los nombres de origen y destino para los indicadores A y Z. */
  function setExtremos(nombreOrigen, nombreDestino) {
    _nombreOrigen = nombreOrigen || 'Origen';
    _nombreDestino = nombreDestino || 'Destino';
  }

  /** Muestra el perfil a partir del punto asignado como inicio (distancia en km). */
  function setRangoInicio(distKm) {
    _inicioAsignado = true;
    _inicioOffset = distKm != null ? Number(distKm) : 0;
    _renderizarTodo();
  }

  /** Muestra el perfil hasta el punto asignado como fin (distancia en km). */
  function setRangoFin(distKm) {
    _finAsignado = true;
    _finOffset = distKm != null ? Number(distKm) : null;
    _renderizarTodo();
  }

  /** Quita el punto asignado como inicio y vuelve al origen del perfil. */
  function quitarRangoInicio() {
    _inicioAsignado = false;
    _inicioOffset = 0;
    _renderizarTodo();
  }

  /** Quita el punto asignado como fin y vuelve al final del perfil. */
  function quitarRangoFin() {
    _finAsignado = false;
    _finOffset = null;
    _renderizarTodo();
  }

  function _renderizarTodo() {
    ['altimetria-chart', 'altimetria-chart-panel'].forEach((id) => {
      const cont = document.getElementById(id);
      if (cont) _construir(cont);
    });
  }

  function setOnSetInicio(fn) { _onSetInicio = fn; }
  function setOnSetFin(fn) { _onSetFin = fn; }
  function setOnVerMapa(fn) { _onVerMapa = fn; }
  function setOnHover(fn) { _onHoverMapa = fn; }
  function setOnLeave(fn) { _onLeaveMapa = fn; }
  function setOnCentrarMapa(fn) { _onCentrarMapa = fn; }
  function toggleFollow() { _followActivo = !_followActivo; return _followActivo; }
  function setFollowActivo(activo) { _followActivo = !!activo; return _followActivo; }
  function isFollowActivo() { return _followActivo; }

  /** Interpola la altitud del perfil en una distancia dada (km). */
  function _alturaEn(puntos, distKm) {
    let lo = 0;
    while (lo < puntos.length - 1 && puntos[lo + 1].d < distKm) lo++;
    const hi = Math.min(lo + 1, puntos.length - 1);
    const pLo = puntos[lo];
    const pHi = puntos[hi];
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (distKm - pLo.d) / (pHi.d - pLo.d);
        return pLo.e + f * (pHi.e - pLo.e);
      }
      return pLo.e;
    }
    return null;
  }

  /** Coordenadas interpoladas del perfil en una distancia dada (km). */
  function _coordEn(puntos, distKm) {
    let lo = 0;
    while (lo < puntos.length - 1 && puntos[lo + 1].d < distKm) lo++;
    const hi = Math.min(lo + 1, puntos.length - 1);
    const pLo = puntos[lo];
    const pHi = puntos[hi];
    if (!pLo) return null;
    if (pHi && pHi.coord && pHi.d > pLo.d) {
      const f = (distKm - pLo.d) / (pHi.d - pLo.d);
      return [pLo.coord[0] + f * (pHi.coord[0] - pLo.coord[0]), pLo.coord[1] + f * (pHi.coord[1] - pLo.coord[1])];
    }
    return pLo.coord;
  }

  /** Altitud interpolada sobre la ruta actual del perfil en una distancia (km). */
  function _alturaEnDist(distKm) {
    if (!_rutaGeojson || !_rutaGeojson.geometry) return null;
    try {
      const puntos = _acumular(_rutaGeojson.geometry.coordinates, _elevacion);
      return _alturaEn(puntos, distKm);
    } catch (e) { return null; }
  }

  /** Distancia (km) del punto de la ruta del perfil más cercano a un lat/lon. */
  function _distKmCercaDe(lat, lon) {
    if (!_rutaGeojson || !_rutaGeojson.geometry) return null;
    const gc = _rutaGeojson.geometry.coordinates;
    if (!gc || gc.length < 2) return null;
    const coords = _rutaGeojson.geometry.type === 'MultiLineString'
      ? gc.reduce((acc, tramo) => acc.concat(tramo), [])
      : gc;
    if (coords.length < 2) return null;
    try {
      const nearest = turf.nearestPointOnLine(turf.lineString(coords), turf.point([lon, lat]), { units: 'kilometers' });
      const loc = nearest.properties.location;
      return loc != null ? Number(loc) : 0;
    } catch (e) { return null; }
  }

  /** Convierte un lat/lon del mapa en el punto equivalente del perfil. */
  function puntoCompararDesdeLatLng(lat, lon) {
    const distKm = _distKmCercaDe(lat, lon);
    if (distKm == null) return null;
    return { lat, lon, coord: [lon, lat], distKm, alt: _alturaEnDist(distKm) };
  }

  /** Normaliza un punto de comparación (dist/alt numéricos). */
  function _normalizarPunto(p) {
    const distKm = Number(p.distKm);
    if (!isFinite(distKm)) return null;
    const alt = p.alt != null ? Number(p.alt) : _alturaEnDist(distKm);
    return {
      lat: p.lat, lon: p.lon,
      coord: p.coord || [p.lon, p.lat],
      distKm,
      alt: alt != null && isFinite(alt) ? alt : null,
    };
  }

  /** Activa/desactiva la selección del segundo punto en el mapa. */
  function _activarSeleccionMapa(activo) {
    if (typeof MapModule === 'undefined') return;
    if (activo) {
      if (typeof MapModule.activarSeleccionComparar === 'function') {
        MapModule.activarSeleccionComparar((punto) => seleccionarPuntoComparacion(punto));
      }
    } else if (typeof MapModule.desactivarSeleccionComparar === 'function') {
      MapModule.desactivarSeleccionComparar();
    }
  }

  function _getBannerComparar() {
    if (_bannerComparar) return _bannerComparar;
    _bannerComparar = document.createElement('div');
    _bannerComparar.className = 'comparar-banner';
    const titulo = document.createElement('span');
    titulo.className = 'comparar-banner__titulo';
    const stats = document.createElement('span');
    stats.className = 'comparar-banner__stats';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'comparar-banner__cerrar';
    btn.setAttribute('aria-label', 'Terminar comparación');
    btn.innerHTML = '&times;';
    btn.addEventListener('click', () => cancelarComparacion());
    _bannerComparar.appendChild(titulo);
    _bannerComparar.appendChild(stats);
    _bannerComparar.appendChild(btn);
    _bannerComparar.style.display = 'none';
    // El aviso se coloca sobre el perfil visible (chart de altimetría): si el
    // chart está dentro de su contenedor (que nunca se re-renderiza), se ancla
    // a ese contenedor para que quede encima de la gráfica, no sobre el mapa.
    const chartVisible = document.getElementById('altimetria-chart');
    const chartPanelVisible = document.getElementById('altimetria-chart-panel');
    const contenedor = (() => {
      if (chartVisible && chartVisible.offsetParent !== null) return chartVisible.parentNode || document.querySelector('.map-full') || document.body;
      if (chartPanelVisible && chartPanelVisible.offsetParent !== null) return chartPanelVisible.parentNode || document.querySelector('.map-full') || document.body;
      return document.querySelector('.map-full') || document.body;
    })();
    contenedor.appendChild(_bannerComparar);
    return _bannerComparar;
  }

  function _mostrarBannerComparar(titulo, stats) {
    const b = _getBannerComparar();
    b.querySelector('.comparar-banner__titulo').textContent = titulo;
    const statsEl = b.querySelector('.comparar-banner__stats');
    statsEl.textContent = stats || '';
    statsEl.style.display = stats ? '' : 'none';
    b.style.display = 'flex';
  }

  function _ocultarBannerComparar() {
    if (_bannerComparar) _bannerComparar.style.display = 'none';
  }

  /** Punto del perfil bajo una posición de pantalla (para menú contextual). */
  function _puntoDeEvento(cont, clientX, clientY) {
    if (!cont._svg || !cont._plotW || !cont._puntos) return null;
    const rect = cont._svg.getBoundingClientRect();
    const mx = clientX - rect.left;
    const rat = Math.max(0, Math.min(1, (mx - cont._padLeft) / cont._plotW));
    const dist = cont._zoomStart + rat * (cont._zoomEnd - cont._zoomStart);
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < dist) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    if (!pLo) return null;
    let alt = null;
    if (pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (dist - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else alt = pLo.e;
    }
    return { lat: pLo.coord[1], lon: pLo.coord[0], coord: pLo.coord, distKm: dist, alt };
  }

  /** Entrada única de comparación: primer punto o segundo punto según el estado. */
  function seleccionarPuntoComparacion(punto) {
    const norm = _normalizarPunto(punto);
    if (!norm) return;
    if (_compararActivo || !_esperandoComparar) {
      _compararA = norm;
      _compararB = null;
      _compararActivo = false;
      _esperandoComparar = true;
      _mostrarBannerComparar('Punto 1 seleccionado: elige el punto 2');
      _actualizarMarcadoresComparacion();
      _activarSeleccionMapa(true);
    } else {
      _compararB = norm;
      _compararActivo = true;
      _esperandoComparar = false;

      _mostrarBannerComparar('Comparación de puntos', _resumenComparacion());
      _actualizarMarcadoresComparacion();
      _renderizarTodo();
    }
  }

  /** Resumen (distancia y desnivel entre los dos puntos) para el aviso flotante. */
  function _resumenComparacion() {
    if (!_compararA || !_compararB) return '';
    const distEntre = Math.abs(Number(_compararB.distKm) - Number(_compararA.distKm));
    const altA = _compararA.alt;
    const altB = _compararB.alt;
    const altEntre = (altA != null && altB != null) ? Math.abs(Number(altB) - Number(altA)) : null;
    return 'Distancia: ' + distEntre.toFixed(1) + ' km · Desnivel: ' + (altEntre != null ? altEntre.toFixed(0) + ' m' : '—');
  }

  /** Sincroniza los círculos naranjas (1 y 2) sobre la ruta en el mapa. */
  function _actualizarMarcadoresComparacion() {
    if (typeof MapModule === 'undefined' || typeof MapModule.actualizarMarcadoresComparacion !== 'function') return;
    const puntos = [];
    if (_compararA) puntos.push(_compararA);
    if (_compararB) puntos.push(_compararB);
    MapModule.actualizarMarcadoresComparacion(puntos);
  }

  /** Termina la comparación y restaura el perfil. */
  function cancelarComparacion() {
    const habia = _compararActivo || _esperandoComparar;
    _compararA = null;
    _compararB = null;
    _compararActivo = false;
    _esperandoComparar = false;
    _activarSeleccionMapa(false);
    _ocultarBannerComparar();
    _actualizarMarcadoresComparacion();
    if (habia) _renderizarTodo();
  }

  /** ¿El perfil tiene datos para comparar? (ruta + altimetría cargadas). */
  function tieneDatos() {
    return !!(_rutaGeojson && _rutaGeojson.geometry && _rutaGeojson.geometry.coordinates && _rutaGeojson.geometry.coordinates.length >= 2);
  }

  /** Ajusta el rango horizontal visible conservando la proporción bajo el cursor. */
  function _aplicarZoom(cont, factor, cxRel) {    const maxD = cont._maxD || 1;
    const minSpan = Math.min(MIN_SPAN_ZOOM, maxD);
    const start = cont._zoomStart;
    const end = cont._zoomEnd;
    let span = (end - start) * factor;
    span = Math.min(Math.max(span, minSpan), maxD);
    const cursorD = start + cxRel * (end - start);
    let ns = cursorD - cxRel * span;
    ns = Math.max(0, Math.min(ns, maxD - span));
    cont._zoomStart = ns;
    cont._zoomEnd = ns + span;
  }

  /** Elimina las etiquetas de los ejes que se superpongan con las de los extremos. */
  function _quitarEtiquetasSolapadas(eje, bordes) {
    for (const el of eje) {
      let bb;
      try { bb = el.getBBox(); } catch (e) { continue; }
      const colisiona = bordes.some((b) => {
        let bb2;
        try { bb2 = b.getBBox(); } catch (e2) { return false; }
        return !(bb.x + bb.width < bb2.x || bb.x > bb2.x + bb2.width || bb.y + bb.height < bb2.y || bb.y > bb2.y + bb2.height);
      });
      if (colisiona) el.remove();
    }
  }

  function _nombreSinDepartamento(nombre) {
    if (!nombre) return '';
    return String(nombre).split(',')[0].trim();
  }

  function renderizar(containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    _construir(cont);
  }

  /** Re-renderiza solo los perfiles visibles (sin reconstruir si están ocultos). */
  function renderizarVisibles() {
    ['altimetria-chart', 'altimetria-chart-panel'].forEach((id) => {
      const cont = document.getElementById(id);
      if (cont && cont.offsetParent !== null) _construir(cont);
    });
  }

  function _construir(cont) {
    if (!_rutaGeojson || !_rutaGeojson.geometry) { cont.innerHTML = '<div class="empty-state"><img src="public/simbiosis.png" alt="" class="empty-state__icono"><span class="empty-state__texto">Calcula una ruta primero</span></div>'; return; }
    const coords = _rutaGeojson.geometry.coordinates;
    if (coords.length < 2) return;
    const puntos = _acumular(coords, _elevacion);
    const maxD = puntos[puntos.length - 1].d || 1;

    // Dominio mostrado: desde el punto asignado como inicio hasta el asignado como fin.
    let domInicio = Math.max(0, Math.min(_inicioOffset != null ? _inicioOffset : 0, maxD));
    let domFin = Math.max(domInicio, Math.min(_finOffset != null ? _finOffset : maxD, maxD));
    // Comparación de puntos: el perfil se limita al tramo entre A y B.
    if (_compararActivo && _compararA && _compararB) {
      const dA = Math.max(0, Math.min(Number(_compararA.distKm), maxD));
      const dB = Math.max(0, Math.min(Number(_compararB.distKm), maxD));
      domInicio = Math.min(dA, dB);
      domFin = Math.max(dA, dB);
    } else if (_segmentoActivo != null && _segmentoActivo < _nSegmentos) {
      // Con un segmento activo el perfil se limita a ese tramo en carro (respeta
      // los puntos de inicio/fin asignados dentro del segmento).
      const segPts = puntos.filter((p) => p.seg === _segmentoActivo);
      if (segPts.length) {
        domInicio = segPts[0].d;
        domFin = segPts[segPts.length - 1].d;
        if (_inicioOffset != null && _inicioOffset > domInicio) domInicio = Math.min(_inicioOffset, domFin);
        if (_finOffset != null && _finOffset < domFin) domFin = Math.max(_finOffset, domInicio);
      }
    }

    // Si cambió la ruta o el rango asignado se reinicia el zoom.
    if (cont._geo !== _rutaGeojson || cont._domInicio !== domInicio || cont._domFin !== domFin) {
      cont._geo = _rutaGeojson;
      cont._domInicio = domInicio;
      cont._domFin = domFin;
      cont._zoomStart = domInicio;
      cont._zoomEnd = domFin;
    }
    if (typeof cont._zoomStart !== 'number') { cont._zoomStart = domInicio; cont._zoomEnd = domFin; }
    cont._zoomStart = Math.max(domInicio, Math.min(cont._zoomStart, domFin));
    cont._zoomEnd = Math.max(cont._zoomStart + Math.min(MIN_SPAN_ZOOM, domFin - domInicio), Math.min(cont._zoomEnd, domFin));
    const zoomStart = cont._zoomStart;
    const zoomEnd = cont._zoomEnd;
    const span = zoomEnd - zoomStart;

    // Eje vertical dinámico: el tope y el límite inferior del eje Y se fijan
    // con las alturas del tramo visible (rango zoomStart..zoomEnd). Así el
    // perfil ocupa toda la altura del gráfico y la escala se actualiza en cada
    // cambio de visualización (parada asignada como inicio/fin, zoom o cambio
    // de segmento), sin quedarse nunca fija al rango completo de la ruta.
    const ptsSeg = _compararActivo
      ? puntos
      : ((_segmentoActivo != null && _segmentoActivo < _nSegmentos)
        ? puntos.filter(p => p.seg === _segmentoActivo)
        : puntos);
    const ptsVisibles = ptsSeg.filter(p => p.e != null && p.d >= zoomStart - 0.001 && p.d <= zoomEnd + 0.001);
    let minAlt, maxAlt, rangoAlt;
    if (ptsVisibles.length) {
      minAlt = Math.min(...ptsVisibles.map(p => p.e));
      maxAlt = Math.max(...ptsVisibles.map(p => p.e));
    } else {
      const alturasSeg = ptsSeg.filter(p => p.e != null).map(p => p.e);
      minAlt = alturasSeg.length ? Math.min(...alturasSeg) : 0;
      maxAlt = alturasSeg.length ? Math.max(...alturasSeg) : 1;
    }
    rangoAlt = Math.max(maxAlt - minAlt, 10);

    // Márgenes amplios para que los marcadores (radio 11) y sus etiquetas
    // no queden cortados en los bordes superior y derecho del perfil.
    const padTop = 16;
    const padRight = 14;
    const padBottom = 22;
    const padLeft = 52;
    const ancho = cont.clientWidth || 300;
    const alto = cont.clientHeight || 180;
    const plotW = ancho - padLeft - padRight;
    const plotH = alto - padTop - padBottom;

    function x(d) { return padLeft + ((d - zoomStart) / span) * plotW; }
    function y(e) { return padTop + plotH - ((e - minAlt) / rangoAlt) * plotH; }

    // Posiciones de las etiquetas de borde (para no superponer las etiquetas de los ejes).
    const yBordeMin = y(minAlt);
    const yBordeMax = y(maxAlt);
    const xBordeIni = x(zoomStart);
    const xBordeFin = x(zoomEnd);

    const pasoD = _intervaloBonito(span, 6);
    const pasoA = _intervaloBonito(rangoAlt, 5);
    const altBase = Math.floor(minAlt / pasoA) * pasoA;

    const visibles = puntos.filter(p => p.e != null && p.d >= zoomStart - 0.001 && p.d <= zoomEnd + 0.001);
    let dLine = '';
    let segAnterior = null;
    for (const p of visibles) {
      if (!dLine) dLine = `M${x(p.d)},${y(p.e)}`;
      else if (p.seg === segAnterior) dLine += ` L${x(p.d)},${y(p.e)}`;
      else dLine += ` M${x(p.d)},${y(p.e)}`;
      segAnterior = p.seg;
    }

    const _prevHTML = cont.innerHTML;
    try {
    cont.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    cont.appendChild(svg);

    const labelsEjeY = [];
    const labelsBordeY = [];
    const labelsEjeX = [];
    const labelsBordeX = [];

    // Y-axis grid lines + labels (elevation)
    for (let alt = altBase; alt <= maxAlt + pasoA * 0.5; alt += pasoA) {
      if (alt < minAlt) continue;
      const gy = y(alt);
      if (gy < padTop) continue;
      if (Math.abs(gy - yBordeMin) < 7 || Math.abs(gy - yBordeMax) < 7) continue;
      const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      gridLine.setAttribute('x1', padLeft);
      gridLine.setAttribute('x2', padLeft + plotW);
      gridLine.setAttribute('y1', gy);
      gridLine.setAttribute('y2', gy);
      gridLine.setAttribute('stroke', '#e0e0e0');
      gridLine.setAttribute('stroke-width', '0.5');
      gridLine.setAttribute('stroke-dasharray', '3 3');
      svg.appendChild(gridLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padLeft - 14);
      label.setAttribute('y', gy + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#888');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'inherit');
      label.textContent = alt.toFixed(0) + ' m';
      labelsEjeY.push(label);
      svg.appendChild(label);
    }

    // Etiquetas de borde vertical: altura mínima y máxima siempre visibles
    [minAlt, maxAlt].forEach((alt) => {
      const gy = y(alt);
      if (gy < padTop - 4 || gy > alto - 4) return;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padLeft - 14);
      label.setAttribute('y', gy + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#444');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-weight', '600');
      label.setAttribute('font-family', 'inherit');
      label.textContent = alt.toFixed(0) + ' m';
      labelsBordeY.push(label);
      svg.appendChild(label);
    });

    // X-axis grid lines + labels (visible distance range)
    for (let d = Math.ceil(zoomStart / pasoD) * pasoD; d <= zoomEnd + pasoD * 0.5; d += pasoD) {
      const gx = x(d);
      if (Math.abs(gx - xBordeIni) < 7 || Math.abs(gx - xBordeFin) < 7) continue;
      const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      gridLine.setAttribute('x1', gx);
      gridLine.setAttribute('x2', gx);
      gridLine.setAttribute('y1', padTop);
      gridLine.setAttribute('y2', padTop + plotH);
      gridLine.setAttribute('stroke', '#e0e0e0');
      gridLine.setAttribute('stroke-width', '0.5');
      gridLine.setAttribute('stroke-dasharray', '3 3');
      svg.appendChild(gridLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', gx);
      label.setAttribute('y', alto - 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#888');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'inherit');
      label.textContent = (d - domInicio).toFixed(1) + ' km';
      labelsEjeX.push(label);
      svg.appendChild(label);
    }

    // Etiquetas de borde: distancia inicial y final del tramo visible siempre visibles
    [zoomStart, zoomEnd].forEach((d) => {
      const gx = x(d);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', gx);
      label.setAttribute('y', alto - 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#444');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-weight', '600');
      label.setAttribute('font-family', 'inherit');
      label.textContent = (d - domInicio).toFixed(1) + ' km';
      labelsBordeX.push(label);
      svg.appendChild(label);
    });

    // Las etiquetas de los ejes no pueden superponerse con las de los extremos: se ocultan.
    _quitarEtiquetasSolapadas(labelsEjeY, labelsBordeY);
    _quitarEtiquetasSolapadas(labelsEjeX, labelsBordeX);

    // Border for plot area
    const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    border.setAttribute('x', padLeft);
    border.setAttribute('y', padTop);
    border.setAttribute('width', plotW);
    border.setAttribute('height', plotH);
    border.setAttribute('fill', 'none');
    border.setAttribute('stroke', '#ccc');
    border.setAttribute('stroke-width', '1');
    svg.appendChild(border);

    // Elevation path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', dLine);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#2f7a6b');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);

    // Hover line
    const hoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hoverLine.setAttribute('y1', padTop);
    hoverLine.setAttribute('y2', padTop + plotH);
    hoverLine.setAttribute('stroke', '#666');
    hoverLine.setAttribute('stroke-width', '1');
    hoverLine.setAttribute('stroke-dasharray', '4 3');
    hoverLine.style.display = 'none';
    svg.appendChild(hoverLine);

    // Hit area for hover / zoom
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', padLeft);
    hit.setAttribute('y', padTop);
    hit.setAttribute('width', plotW);
    hit.setAttribute('height', plotH);
    hit.setAttribute('fill', 'transparent');
    svg.appendChild(hit);

    // Store metadata on container
    cont._svg = svg;
    cont._puntos = puntos;
    cont._hoverLine = hoverLine;
    cont._hoverCircle = null;
    cont._plotW = plotW;
    cont._plotH = plotH;
    cont._padLeft = padLeft;
    cont._padTop = padTop;
    cont._maxD = maxD;
    cont._minAlt = minAlt;
    cont._rangoAlt = rangoAlt;
    cont._coords = coords;
    cont._zoomStart = zoomStart;
    cont._zoomEnd = zoomEnd;

    // Parada markers (letra incluida en el área clickeable + tooltip con nombre y altura)
    for (const p of _paradas) {
      const dist = p.distKm != null ? p.distKm : turf.distance(turf.point([p.lon, p.lat]), turf.point(coords[0]), { units: 'kilometers' });
      if (dist < zoomStart - 0.001 || dist > zoomEnd + 0.001) continue;
      const px = x(dist);
      const altP = _alturaEn(puntos, dist);
      const py = y(altP != null ? altP : (minAlt + rangoAlt * 0.5));
      const tooltip = altP != null ? `${_nombreSinDepartamento(p.nombre)} · ${altP.toFixed(0)} msnm` : _nombreSinDepartamento(p.nombre);
      _crearIndicador(svg, px, py, p.label || '', { tipo: p.tipo || 'parada', id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre, distKm: dist }, tooltip, _nombreSinDepartamento(p.nombre));
    }

    // Marcadores de extremos del tramo visible: cada borde muestra el icono
    // correcto según lo que hay ahí (A en el origen real, Z en el destino real,
    // ✈ en aeropuertos, 🚢 en puertos); los bordes de pueblo (escala) no se
    // marcan porque su letra ya la pinta la parada en ese mismo punto. Durante
    // una comparación se omiten y en su lugar se pintan 1 y 2 de comparación.
    if (!_compararActivo) {
      let idxA = 0, idxZ = puntos.length - 1;
      let extremoIni = { nombre: _nombreOrigen, tipo: 'origen' };
      let extremoFin = { nombre: _nombreDestino, tipo: 'destino' };
      if (_segmentoActivo != null && _segmentoActivo < _nSegmentos) {
        const idxs = [];
        for (let i = 0; i < puntos.length; i++) { if (puntos[i].seg === _segmentoActivo) idxs.push(i); }
        if (idxs.length) { idxA = idxs[0]; idxZ = idxs[idxs.length - 1]; }
        if (_segmentoExtremos && _segmentoExtremos[_segmentoActivo]) {
          const par = _segmentoExtremos[_segmentoActivo];
          if (par && par[0]) extremoIni = par[0];
          if (par && par[1]) extremoFin = par[1];
        }
      }
      _agregarIndicadorExtremo(svg, puntos, idxA, extremoIni, zoomStart, zoomEnd, x, y, minAlt, rangoAlt);
      _agregarIndicadorExtremo(svg, puntos, idxZ, extremoFin, zoomStart, zoomEnd, x, y, minAlt, rangoAlt);
    } else if (_compararA && _compararB) {
      _agregarIndicadorComparar(svg, puntos, Number(_compararA.distKm), '1', zoomStart, zoomEnd, x, y, minAlt, rangoAlt);
      _agregarIndicadorComparar(svg, puntos, Number(_compararB.distKm), '2', zoomStart, zoomEnd, x, y, minAlt, rangoAlt);
    }

    // Las etiquetas del eje X se dibujan al final (z alto) para no quedar ocultas
    // ni cortadas (por ejemplo el "km" del último valor).
    [...labelsEjeX, ...labelsBordeX].filter((l) => l.parentNode === svg).forEach((lbl) => {
      svg.appendChild(lbl);
      try {
        const bb = lbl.getBBox();
        if (bb.x < 2) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x - 2));
        else if (bb.x + bb.width > ancho - 2) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x + bb.width - ancho + 2));
      } catch (e) { /* ignorar */ }
    });

    // Tras reposicionar/ajustar, las etiquetas de la escala del eje X podrían
    // haberse corrido sobre las de los extremos (p. ej. tapar la distancia
    // total). Se vuelven a ocultar las que quedan superpuestas.
    _quitarEtiquetasSolapadas(labelsEjeX, labelsBordeX);

    // Hover listeners
    hit.addEventListener('mousemove', (ev) => { if (!_arrastrePerfil) _onHover(cont, ev); });
    hit.addEventListener('mouseleave', () => { if (!_arrastrePerfil) _onLeave(cont); });
    // Clic secundario sobre el perfil: menú "Comparar este sitio" en el punto.
    hit.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (_arrastrePerfil || _suprimirClicComparar) return;
      const punto = _puntoDeEvento(cont, ev.clientX, ev.clientY);
      if (punto) _mostrarMenuComparar(ev.clientX, ev.clientY, punto);
    });
    // Clic sobre el perfil: mientras se espera el segundo punto de comparación
    // selecciona ese punto; con el vehículo visible abre el selector de
    // vehículo/color (el carro sigue al cursor, por eso el clic se captura aquí).
    hit.addEventListener('click', (ev) => {
      if (_esperandoComparar) {
        ev.stopPropagation();
        const punto = _puntoDeEvento(cont, ev.clientX, ev.clientY);
        if (punto) seleccionarPuntoComparacion(punto);
        return;
      }
      if (_puntoHover) {
        ev.stopPropagation();
        TransportConfigModule.abrirSelector(ev.clientX, ev.clientY);
      }
    });
    // Arrastre con el ratón para desplazarse lateralmente por el perfil
    hit.addEventListener('mousedown', (ev) => {
      _arrastrePerfil = { cont, startX: ev.clientX, startZs: cont._zoomStart, startZe: cont._zoomEnd };
      ev.preventDefault();
    });
    // Touch support for mobile (hover de un dedo, zoom con dos dedos y
    // pulsación larga para comparar)
    hit.addEventListener('touchstart', (ev) => { ev.preventDefault(); _onTouchStart(cont, ev); }, { passive: false });
    hit.addEventListener('touchmove', (ev) => { ev.preventDefault(); _onTouchMove(cont, ev); }, { passive: false });
    hit.addEventListener('touchend', (ev) => { ev.preventDefault(); _onTouchEnd(cont, ev); }, { passive: false });
    hit.addEventListener('touchcancel', (ev) => { _cancelarLongPress(); _onLeave(cont); });

    // Zoom horizontal con la rueda del ratón; doble clic para restablecer
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const cxRel = Math.max(0, Math.min(1, (mx - padLeft) / plotW));
      const factor = ev.deltaY > 0 ? 1.2 : 1 / 1.2;
      _aplicarZoom(cont, factor, cxRel);
      _construir(cont);
    }, { passive: false });
    svg.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      cont._zoomStart = 0;
      cont._zoomEnd = maxD;
      _construir(cont);
    });

    // Indicador de posición (hover): el vehículo elegido por el usuario con su
    // color, superpuesto al SVG (senderista en "Subir tu propia ruta"). Es un
    // div HTML (máscara CSS) para colorear el ícono de forma exacta; como el
    // vehículo sigue al cursor, el clic para abrir el selector se captura en
    // el área de hover (abajo), por eso aquí no se interceptan eventos.
    const hoverCircle = document.createElement('div');
    hoverCircle.className = 'altimetria-hover-vehiculo';
    hoverCircle.innerHTML = TransportConfigModule.divIconoHTML(22, 22, '');
    hoverCircle.style.pointerEvents = 'none';
    hoverCircle.style.display = 'none';
    cont.appendChild(hoverCircle);
    cont._hoverCircle = hoverCircle;
    } catch (err) {
      console.warn('[ALT] Error al dibujar el perfil:', err);
      if (!cont.querySelector('svg')) cont.innerHTML = _prevHTML;
    }
  }

  /** Crea el indicador circular (con su letra incluida en el área clickeable) y tooltip al pasar el mouse. */
  function _crearIndicador(svg, px, py, letra, data, tooltipTexto, labelNombre, color, interactivo) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', px);
    circle.setAttribute('cy', py);
    circle.setAttribute('r', '11');
    circle.setAttribute('fill', color || '#4a6fa5');
    g.appendChild(circle);

    if (letra) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', px);
      text.setAttribute('y', py + 4.5);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-family', 'inherit');
      text.textContent = letra;
      text.style.pointerEvents = 'none';
      g.appendChild(text);
    }

    svg.appendChild(g);

    // Clic instantáneo: abre el menú; si ya está abierto para ESTE marcador, lo cierra.
    if (interactivo !== false) {
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (_menuFlotante && _menuFlotante._menuTarget === g && _menuFlotante.style.display !== 'none') {
          _cerrarMenuFlotante();
        } else {
          _mostrarMenu(ev, data, g);
        }
      });
      g.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); _mostrarMenu(ev, data, g); });
      // En táctiles la etiqueta de hover no debe aparecer al tocar los marcadores.
      if (!_esTactil) {
        g.addEventListener('mouseenter', (ev) => _mostrarTooltipIndicador(ev, tooltipTexto));
        g.addEventListener('mousemove', (ev) => _mostrarTooltipIndicador(ev, tooltipTexto));
        g.addEventListener('mouseleave', () => _ocultarTooltipIndicador());
      }
    }

    // Etiqueta muy pequeña con el nombre (sin departamento) sobre el indicador.
    // Puede salirse por arriba del área de los ejes pero se dibuja al final (z alto).
    if (labelNombre) {
      const cont = svg.parentNode;
      const padLeft = cont._padLeft != null ? cont._padLeft : 52;
      const padTop = cont._padTop != null ? cont._padTop : 6;
      const plotW = cont._plotW != null ? cont._plotW : 200;
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', px);
      lbl.setAttribute('y', Math.max(py - 20, 2));
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('fill', '#666');
      lbl.setAttribute('font-size', '7');
      lbl.setAttribute('font-family', 'inherit');
      lbl.textContent = labelNombre;
      svg.appendChild(lbl);
      try {
        const bb = lbl.getBBox();
        if (bb.x < padLeft) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x - padLeft) - 2);
        else if (bb.x + bb.width > padLeft + plotW) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x + bb.width - padLeft - plotW) - 2);
        if (bb.y < 1) lbl.setAttribute('y', parseFloat(lbl.getAttribute('y')) + (1 - bb.y));
      } catch (e) { /* ignorar */ }
    }
  }

  /** Añade el marcador de un extremo del tramo activo con el icono correcto:
   *  A (origen real), Z (destino real) y ✈ (aeropuerto). En los bordes de
   *  pueblo (escala) y de puerto no se pinta nada porque su letra o símbolo
   *  (B, C, …, 🚢) ya aparece como parada en ese mismo punto. */
  function _agregarIndicadorExtremo(svg, puntos, idx, extremo, zoomStart, zoomEnd, x, y, minAlt, rangoAlt) {
    if (!extremo) return;
    const tipo = extremo.tipo || 'origen';
    if (tipo === 'escala' || tipo === 'puerto') return;
    let letra;
    if (tipo === 'origen') letra = 'A';
    else if (tipo === 'destino') letra = 'Z';
    else if (tipo === 'aeropuerto') letra = '✈';
    else letra = 'A';
    const nombre = extremo.nombre || '';
    const pt = puntos[idx];
    if (!pt) return;
    const dist = pt.d;
    if (dist < zoomStart - 0.001 || dist > zoomEnd + 0.001) return;
    const px = x(dist);
    const alt = pt.e != null ? pt.e : (minAlt + rangoAlt * 0.5);
    const py = y(alt);
    const tooltip = pt.e != null ? `${_nombreSinDepartamento(nombre)} · ${pt.e.toFixed(0)} msnm` : _nombreSinDepartamento(nombre);
    _crearIndicador(svg, px, py, letra, { tipo: letra, lat: pt.coord[1], lon: pt.coord[0], nombre: letra, distKm: dist }, tooltip, _nombreSinDepartamento(nombre));
  }

  /** Marcador de un punto de comparación (1 o 2) sobre el perfil. */
  function _agregarIndicadorComparar(svg, puntos, dist, letra, zoomStart, zoomEnd, x, y, minAlt, rangoAlt) {
    if (dist < zoomStart - 0.001 || dist > zoomEnd + 0.001) return;
    const px = x(dist);
    const alt = _alturaEn(puntos, dist);
    const py = alt != null ? y(alt) : (minAlt + rangoAlt * 0.5);
    const coord = _coordEn(puntos, dist);
    _crearIndicador(
      svg, px, py, letra,
      { tipo: 'comparar', letra, lat: coord ? coord[1] : null, lon: coord ? coord[0] : null, nombre: 'Punto ' + letra, distKm: dist },
      '', '', '#d96c2f', false
    );
  }

  function _mostrarTooltipIndicador(ev, texto) {
    const tt = _getTooltipIndicador();
    tt.textContent = texto;
    tt.style.display = 'block';
    const x = ev.clientX + 12;
    const y = ev.clientY + 12;
    tt.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    tt.style.top = Math.min(y, window.innerHeight - 40) + 'px';
  }

  function _ocultarTooltipIndicador() {
    if (_tooltipIndicador) _tooltipIndicador.style.display = 'none';
  }

  function _getTooltipIndicador() {
    if (!_tooltipIndicador) {
      _tooltipIndicador = document.createElement('div');
      _tooltipIndicador.className = 'altimetria-mark-tooltip';
      _tooltipIndicador.style.display = 'none';
      document.body.appendChild(_tooltipIndicador);
    }
    return _tooltipIndicador;
  }

  /** Posiciona el vehículo del perfil en (mx, cy) con su base apoyada sobre la
   *  curva y orientado por el vector tangente local del perfil (como en el
   *  mapa), de modo que parezca desplazarse sobre el terreno. */
  function _posicionarCarroPerfil(cont, mx, cy) {
    const el = cont._hoverCircle;
    if (!el) return;
    el.style.left = (mx - _CAR_MEDIA) + 'px';
    el.style.top = (cy - 22) + 'px';
    let ang = 0;
    if (cont._puntos && cont._plotW) {
      // Tangente local en píxeles alrededor de mx: ángulo del tramo de la curva.
      const zs = cont._zoomStart || 0;
      const ze = cont._zoomEnd != null ? cont._zoomEnd : cont._maxD;
      const span = (ze - zs) || 1;
      const d = zs + ((mx - cont._padLeft) / cont._plotW) * span;
      let lo = 0;
      while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < d) lo++;
      const hi = Math.min(lo + 1, cont._puntos.length - 1);
      const pLo = cont._puntos[lo];
      const pHi = cont._puntos[hi];
      if (pLo && pHi && pLo.e != null && pHi.e != null && pHi.d > pLo.d) {
        const mxLo = cont._padLeft + ((pLo.d - zs) / span) * cont._plotW;
        const mxHi = cont._padLeft + ((pHi.d - zs) / span) * cont._plotW;
        const cyLo = cont._padTop + cont._plotH - ((pLo.e - cont._minAlt) / cont._rangoAlt) * cont._plotH;
        const cyHi = cont._padTop + cont._plotH - ((pHi.e - cont._minAlt) / cont._rangoAlt) * cont._plotH;
        ang = (Math.atan2(cyHi - cyLo, mxHi - mxLo) * 180) / Math.PI;
      }
    }
    el.style.transform = ang !== 0 ? `rotate(${ang}deg)` : '';
    el.style.display = '';
  }

  function _onHover(cont, ev) {
    const rect = cont._svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const rat = Math.max(0, Math.min(1, (mx - cont._padLeft) / cont._plotW));
    const dist = cont._zoomStart + rat * (cont._zoomEnd - cont._zoomStart);
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < dist) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pt = cont._puntos[lo];
    if (!pt) return;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    let alt;
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (dist - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else {
        alt = pLo.e;
      }
    } else {
      alt = cont._minAlt + cont._rangoAlt * 0.5;
    }
    const cy = cont._padTop + cont._plotH - ((alt - cont._minAlt) / cont._rangoAlt) * cont._plotH;
    let bearing = 0;
    if (pLo && pHi && pLo !== pHi && pLo.coord && pHi.coord) {
      const b = turf.bearing(turf.point(pLo.coord), turf.point(pHi.coord));
      if (!isNaN(b)) bearing = b;
    }
    _posicionarCarroPerfil(cont, mx, cy, bearing);
    _puntoHover = { lat: pt.coord[1], lon: pt.coord[0], dist: dist.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A', bearing };
    if (_onHoverMapa) _onHoverMapa(_puntoHover);
    if (_followActivo && _onCentrarMapa) { _onCentrarMapa(_puntoHover); }
    // En una comparación el perfil va de A a B: la distancia mostrada es la
    // recorrida desde el inicio del perfil y entre paréntesis el total A→B.
    const suffix = cont.id.includes('-panel') ? '-panel' : '';
    const distEl = document.getElementById('altimetria-dist' + suffix);
    const altEl = document.getElementById('altimetria-alt' + suffix);
    if (distEl) {
      if (_compararActivo) {
        const total = cont._zoomEnd - cont._zoomStart;
        distEl.textContent = `${(dist - cont._zoomStart).toFixed(1)} km (de ${total.toFixed(1)} km)`;
      } else {
        distEl.textContent = `${dist.toFixed(1)} km`;
      }
    }
    if (altEl) altEl.textContent = alt != null ? alt.toFixed(0) + ' msnm' : '';
  }

  function _intervaloBonito(rango, divisiones = 5) {
    const bruto = rango / divisiones;
    const magnitud = Math.pow(10, Math.floor(Math.log10(bruto)));
    const residuo = bruto / magnitud;
    let paso;
    if (residuo <= 1.5) paso = magnitud;
    else if (residuo <= 3) paso = 2 * magnitud;
    else if (residuo <= 7) paso = 5 * magnitud;
    else paso = 10 * magnitud;
    return paso || 1;
  }

  function _distTouches(ev) {
    const t0 = ev.touches[0];
    const t1 = ev.touches[1];
    return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
  }

  function _cancelarLongPress() {
    if (_longPressTimer) { clearTimeout(_longPressTimer); _longPressTimer = null; }
  }

  function _iniciarLongPress(cont, touch) {
    _cancelarLongPress();
    const x = touch.clientX;
    const y = touch.clientY;
    _touchTap = { x, y };
    _longPressX = x;
    _longPressY = y;
    _longPressTimer = setTimeout(() => {
      _longPressTimer = null;
      _touchTap = null;
      _suprimirClicComparar = true;
      setTimeout(() => { _suprimirClicComparar = false; }, 700);
      navigator.vibrate && navigator.vibrate(20);
      const punto = _puntoDeEvento(cont, _longPressX, _longPressY);
      if (punto) _mostrarMenuComparar(_longPressX, _longPressY, punto);
    }, 550);
  }

  function _onTouchStart(cont, ev) {
    if (ev.touches.length === 2) {
      _cancelarLongPress();
      _touchTap = null;
      cont._pinchDist = _distTouches(ev);
      const rect = cont._svg.getBoundingClientRect();
      cont._pinchMidX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - rect.left;
      return;
    }
    _iniciarLongPress(cont, ev.touches[0]);
    _onTouchHover(cont, ev);
  }

  function _onTouchMove(cont, ev) {
    if (ev.touches.length === 2 && cont._pinchDist) {
      _cancelarLongPress();
      _touchTap = null;
      const rect = cont._svg.getBoundingClientRect();
      const midX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - rect.left;
      // Desplazamiento con dos dedos: el rango visible se mueve a la par de los
      // dedos (solo tiene efecto cuando el perfil está ampliado, no en el rango
      // completo). El punto medio se conserva como referencia de la posición.
      if (cont._pinchMidX != null) {
        const span = cont._zoomEnd - cont._zoomStart;
        const dKmPx = cont._plotW > 0 ? span / cont._plotW : 0;
        const domIni = cont._domInicio != null ? cont._domInicio : 0;
        const domFin = cont._domFin != null ? cont._domFin : (cont._maxD || 1);
        let ns = cont._zoomStart - (midX - cont._pinchMidX) * dKmPx;
        ns = Math.max(domIni, Math.min(ns, domFin - span));
        cont._zoomStart = ns;
        cont._zoomEnd = ns + span;
      }
      cont._pinchMidX = midX;
      const d = _distTouches(ev);
      if (d > 0) {
        const factor = cont._pinchDist / d;
        const cxRel = Math.max(0, Math.min(1, (midX - cont._padLeft) / cont._plotW));
        _aplicarZoom(cont, factor, cxRel);
        cont._pinchDist = d;
      }
      _construir(cont);
      return;
    }
    if (ev.touches.length === 1) {
      const t = ev.touches[0];
      if (_touchTap && (Math.abs(t.clientX - _touchTap.x) > 10 || Math.abs(t.clientY - _touchTap.y) > 10)) _touchTap = null;
      _onTouchHover(cont, ev);
    }
  }

  function _onTouchEnd(cont, ev) {
    const fueTap = _touchTap;
    _cancelarLongPress();
    _touchTap = null;
    if (ev.touches.length !== 0) return;
    cont._pinchDist = null;
    cont._pinchMidX = null;
    const changed = ev.changedTouches && ev.changedTouches[0];
    if (_suprimirClicComparar) {
      _suprimirClicComparar = false;
      _onLeave(cont);
      return;
    }
    if (_esperandoComparar && changed && fueTap) {
      const punto = _puntoDeEvento(cont, changed.clientX, changed.clientY);
      if (punto) seleccionarPuntoComparacion(punto);
    }
    _onLeave(cont);
  }

  function _onTouchHover(cont, ev) {
    const touch = ev.touches[0];
    if (!touch) return;
    const rect = cont._svg.getBoundingClientRect();
    const mx = touch.clientX - rect.left;
    const my = touch.clientY - rect.top;
    const rat = Math.max(0, Math.min(1, (mx - cont._padLeft) / cont._plotW));
    const dist = cont._zoomStart + rat * (cont._zoomEnd - cont._zoomStart);
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < dist) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pt = cont._puntos[lo];
    if (!pt) return;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    let alt;
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (dist - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else {
        alt = pLo.e;
      }
    } else {
      alt = cont._minAlt + cont._rangoAlt * 0.5;
    }
    const cy = cont._padTop + cont._plotH - ((alt - cont._minAlt) / cont._rangoAlt) * cont._plotH;
    let bearing = 0;
    if (pLo && pHi && pLo !== pHi && pLo.coord && pHi.coord) {
      const b = turf.bearing(turf.point(pLo.coord), turf.point(pHi.coord));
      if (!isNaN(b)) bearing = b;
    }
    _posicionarCarroPerfil(cont, mx, cy, bearing);
    _puntoHover = { lat: pt.coord[1], lon: pt.coord[0], dist: dist.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A', bearing };
    if (_onHoverMapa) _onHoverMapa(_puntoHover);
    if (_followActivo && _onCentrarMapa) { _onCentrarMapa(_puntoHover); }
    // En una comparación el perfil va de A a B: la distancia mostrada es la
    // recorrida desde el inicio del perfil y entre paréntesis el total A→B.
    const suffix = cont.id.includes('-panel') ? '-panel' : '';
    const distEl = document.getElementById('altimetria-dist' + suffix);
    const altEl = document.getElementById('altimetria-alt' + suffix);
    if (distEl) {
      if (_compararActivo) {
        const total = cont._zoomEnd - cont._zoomStart;
        distEl.textContent = `${(dist - cont._zoomStart).toFixed(1)} km (de ${total.toFixed(1)} km)`;
      } else {
        distEl.textContent = `${dist.toFixed(1)} km`;
      }
    }
    if (altEl) altEl.textContent = alt != null ? alt.toFixed(0) + ' msnm' : '';
  }

  function _onLeave(cont) {
    cont._hoverLine.style.display = 'none';
    if (cont._hoverCircle) cont._hoverCircle.style.display = 'none';
    _puntoHover = null;
    if (_onLeaveMapa) _onLeaveMapa();
    if (!_compararActivo) {
      const suffix = cont.id.includes('-panel') ? '-panel' : '';
      const distEl = document.getElementById('altimetria-dist' + suffix);
      const altEl = document.getElementById('altimetria-alt' + suffix);
      if (distEl) distEl.textContent = '';
      if (altEl) altEl.textContent = '';
    }
  }

  function _mostrarTooltip(cont, ev) {
    // placeholder for marker click
  }

  let _menuFlotante = null;

  function _crearMenuFlotante() {
    if (_menuFlotante) return _menuFlotante;
    _menuFlotante = document.createElement('div');
    _menuFlotante.className = 'altimetria-floating-menu';
    const definiciones = [
      ['comparar', 'Comparar este sitio'],
      ['inicio', 'Asignar como punto inicial'],
      ['fin', 'Asignar como punto final'],
      ['ver', 'Ver en el mapa'],
      ['quitar-inicio', 'Quitar como punto inicial'],
      ['quitar-fin', 'Quitar como punto final'],
      ['perfil-completo', 'Mostrar perfil completo'],
      ['eliminar', 'Eliminar esta parada'],
    ];
    definiciones.forEach(([acc, texto]) => {
      const btn = document.createElement('button');
      btn.className = 'altimetria-menu-btn';
      btn.dataset.action = acc;
      btn.textContent = texto;
      _menuFlotante.appendChild(btn);
    });
    document.body.appendChild(_menuFlotante);
    document.addEventListener('click', (e) => {
      if (_menuFlotante && !_menuFlotante.contains(e.target)) _cerrarMenuFlotante();
    });
    return _menuFlotante;
  }

  function _cerrarMenuFlotante() {
    if (_menuFlotante) _menuFlotante.style.display = 'none';
  }

  /** Muestra el perfil completo de A a Z: quita las restricciones de punto
   *  inicial/final asignado para que el perfil vuelva a abarcar toda la ruta. */
  function _mostrarPerfilCompleto() {
    _inicioAsignado = false;
    _inicioOffset = 0;
    _finAsignado = false;
    _finOffset = null;
    _renderizarTodo();
  }

  function _mostrarMenu(ev, data, target) {
    const menu = _crearMenuFlotante();
    menu._menuData = data;
    menu._menuTarget = target || null;
    const btnComparar = menu.querySelector('[data-action="comparar"]');
    const btnInicio = menu.querySelector('[data-action="inicio"]');
    const btnFin = menu.querySelector('[data-action="fin"]');
    const btnVer = menu.querySelector('[data-action="ver"]');
    const btnEliminar = menu.querySelector('[data-action="eliminar"]');
    const btnQuitarIni = menu.querySelector('[data-action="quitar-inicio"]');
    const btnQuitarFin = menu.querySelector('[data-action="quitar-fin"]');
    const btnPerfilCompleto = menu.querySelector('[data-action="perfil-completo"]');
    const esExtremo = data.tipo === 'A' || data.tipo === 'Z';
    const distKm = data.distKm != null ? Number(data.distKm) : null;
    const esInicioActual = _inicioAsignado && distKm != null && Math.abs(_inicioOffset - distKm) < 0.001;
    const esFinActual = _finAsignado && distKm != null && _finOffset != null && Math.abs(_finOffset - distKm) < 0.001;
    // Si el punto es un extremo (A/Z) o ya está asignado como inicio/fin
    // (muestra "Quitar..."), no debe ofrecer la opción contraria de "Asignar...".
    const asignableInicio = !esExtremo && data.tipo !== 'Z' && !esInicioActual && !esFinActual;
    const asignableFin = !esExtremo && data.tipo !== 'A' && !esInicioActual && !esFinActual;
    if (btnComparar) btnComparar.style.display = '';
    btnInicio.style.display = asignableInicio ? '' : 'none';
    btnFin.style.display = asignableFin ? '' : 'none';
    if (btnEliminar) btnEliminar.style.display = esExtremo ? 'none' : '';
    if (btnQuitarIni) btnQuitarIni.style.display = esInicioActual ? '' : 'none';
    if (btnQuitarFin) btnQuitarFin.style.display = esFinActual ? '' : 'none';
    if (btnPerfilCompleto) btnPerfilCompleto.style.display = (_inicioAsignado || _finAsignado) ? '' : 'none';
    if (btnComparar) btnComparar.onclick = () => { _cerrarMenuFlotante(); seleccionarPuntoComparacion(data); };
    btnInicio.onclick = () => { _cerrarMenuFlotante(); if (_onSetInicio) _onSetInicio(data); };
    btnFin.onclick = () => { _cerrarMenuFlotante(); if (_onSetFin) _onSetFin(data); };
    btnVer.onclick = () => { _cerrarMenuFlotante(); if (_onVerMapa) _onVerMapa(data); };
    if (btnEliminar) {
      btnEliminar.onclick = () => { _cerrarMenuFlotante(); if (_onEliminarParada) _onEliminarParada(data); };
    }
    if (btnQuitarIni) btnQuitarIni.onclick = () => { _cerrarMenuFlotante(); quitarRangoInicio(); };
    if (btnQuitarFin) btnQuitarFin.onclick = () => { _cerrarMenuFlotante(); quitarRangoFin(); };
    if (btnPerfilCompleto) {
      btnPerfilCompleto.onclick = () => { _cerrarMenuFlotante(); _mostrarPerfilCompleto(); };
    }
    menu.style.display = 'flex';
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 200;
    menu.style.left = Math.max(4, Math.min(ev.clientX + 8, window.innerWidth - mw - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(ev.clientY - 10, window.innerHeight - mh - 4)) + 'px';
  }

  /** Menú contextual del perfil (clic derecho / pulsación larga): solo
   *  "Comparar este sitio" en el punto bajo el cursor. */
  function _mostrarMenuComparar(clientX, clientY, punto) {
    const menu = _crearMenuFlotante();
    menu._menuData = punto;
    menu._menuTarget = null;
    ['inicio', 'fin', 'ver', 'eliminar', 'quitar-inicio', 'quitar-fin', 'perfil-completo'].forEach((acc) => {
      const b = menu.querySelector('[data-action="' + acc + '"]');
      if (b) b.style.display = 'none';
    });
    const btnComparar = menu.querySelector('[data-action="comparar"]');
    if (btnComparar) {
      btnComparar.style.display = '';
      btnComparar.onclick = () => { _cerrarMenuFlotante(); seleccionarPuntoComparacion(punto); };
    }
    menu.style.display = 'flex';
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 200;
    menu.style.left = Math.max(4, Math.min(clientX + 8, window.innerWidth - mw - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(clientY - 10, window.innerHeight - mh - 4)) + 'px';
  }

  function limpiar() {
    _rutaGeojson = null;
    _elevacion = null;
    _paradas = [];
    _totalKm = 0;
    _puntoHover = null;
    _nSegmentos = 1;
    _segmentoActivo = 0;
    _segmentoExtremos = null;
    _cancelarLongPress();
    _compararA = null;
    _compararB = null;
    _compararActivo = false;
    _esperandoComparar = false;
    _activarSeleccionMapa(false);
    _ocultarBannerComparar();
    _actualizarMarcadoresComparacion();
    ['altimetria-segmentos', 'altimetria-segmentos-panel'].forEach((id) => {
      const c = document.getElementById(id);
      if (c) { c.innerHTML = ''; c.hidden = true; }
    });
    ['', '-panel'].forEach((suffix) => {
      const d = document.getElementById('altimetria-dist' + suffix);
      const a = document.getElementById('altimetria-alt' + suffix);
      if (d) d.textContent = '';
      if (a) a.textContent = '';
    });
  }

  function mostrarHoverEn(distKm, seguir) {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._svg || !cont._puntos || !cont._plotW) return;
    const zs = cont._zoomStart || 0;
    const ze = cont._zoomEnd != null ? cont._zoomEnd : cont._maxD;
    const span = (ze - zs) || 1;
    const rat = Math.max(0, Math.min(1, (distKm - zs) / span));
    const mx = cont._padLeft + rat * cont._plotW;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < distKm) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    let alt = null;
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (distKm - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else {
        alt = pLo.e;
      }
    }
    if (alt != null) {
      const cy = cont._padTop + cont._plotH - ((alt - cont._minAlt) / cont._rangoAlt) * cont._plotH;
      let bearing = 0;
      if (pLo && pHi && pLo !== pHi && pLo.coord && pHi.coord) {
        const b = turf.bearing(turf.point(pLo.coord), turf.point(pHi.coord));
        if (!isNaN(b)) bearing = b;
      }
      _posicionarCarroPerfil(cont, mx, cy, bearing);
    }
    if (seguir !== false && _followActivo && _onCentrarMapa) {
      const pt = cont._puntos[lo];
      if (pt) { _onCentrarMapa({ lat: pt.coord[1], lon: pt.coord[0], dist: distKm.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A' }); }
    }
    if (!_compararActivo) {
      const suffix = cont.id.includes('-panel') ? '-panel' : '';
      const distEl = document.getElementById('altimetria-dist' + suffix);
      const altEl = document.getElementById('altimetria-alt' + suffix);
      if (distEl) distEl.textContent = `${distKm.toFixed(1)} km`;
      if (altEl) altEl.textContent = alt != null ? alt.toFixed(0) + ' msnm' : '';
    }
  }

  function ocultarHover() {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._hoverLine) return;
    cont._hoverLine.style.display = 'none';
    if (cont._hoverCircle) cont._hoverCircle.style.display = 'none';
  }

  function getInfoAt(distKm) {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._puntos) return { alt: null, dist: distKm };
    let ei = 0;
    while (ei < cont._puntos.length - 1 && cont._puntos[ei + 1].d < distKm) ei++;
    const alt = cont._puntos[ei] && cont._puntos[ei].e != null ? cont._puntos[ei].e : null;
    return { alt, dist: distKm };
  }

  // Al cambiar el vehículo o su color se re-dibujan los perfiles visibles
  // (el carro del perfil usa el ícono y color elegidos).
  if (typeof TransportConfigModule !== 'undefined' && TransportConfigModule.setOnCambio) {
    TransportConfigModule.setOnCambio(() => renderizarVisibles());
  }

  return { setDatos, setSegmentosExtremos, setSegmentoActivo, agregarParada, renderizar, renderizarVisibles, limpiar, setOnSetInicio, setOnSetFin, setOnVerMapa, setOnHover, setOnLeave, setOnCentrarMapa, setOnEliminarParada, setExtremos, setRangoInicio, setRangoFin, quitarRangoInicio, quitarRangoFin, toggleFollow, setFollowActivo, isFollowActivo, mostrarHoverEn, ocultarHover, getInfoAt, seleccionarPuntoComparacion, cancelarComparacion, puntoCompararDesdeLatLng, tieneDatos };
})();
