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

  const VELOCIDAD_CAMINATA_KMH = 2.25; // ritmo promedio caminando (rutas subidas por el usuario)
  const CLAVE_STORAGE = 'rutas-simbiosis:rutas-archivo';

  // Paleta de colores de las rutas cargadas: cada ruta recibe uno distinto
  // (preferentemente no repetido) para no confundirlas en el mapa.
  const PALETA_RUTAS = ['#2f7a6b', '#d64541', '#4a6fa5', '#9c5fb5', '#d98a2b', '#3a8f4f', '#b05f8f', '#5f7ab0'];

  let _modoActivo = false;       // modo ruta de archivo (panel oculto, rutas en el mapa)
  let _rutaActualId = null;      // ruta "actual" (la más reciente) para el GPS
  let _rutas = [];               // [{ id, nombre, coords, km, seg }]
  const _rutasOcultas = new Set(); // ids de rutas ocultas del mapa (clic en su ficha)
  let _secuencia = 0;            // generador de ids
  let _watcherId = null;
  let _orientationHandler = null; // listener de orientación del dispositivo
  let _rumboActual = null;        // último rumbo de la brújula (grados)
  let _rumboSuave = null;         // rumbo promediado (para que el indicador no salte)
  const _MAX_LECTURAS_RUMBO = 3;  // lecturas de dirección que se promedian
  let _lecturasRumbo = [];        // últimas lecturas (para promediar el rumbo)
  let _ultimaPosicion = null;     // [lat, lon] de la última fijación GPS
  let _quitarOyenteMoveend = null; // desuscribe el seguimiento del movimiento del mapa
  let _inicioSeguimientoMs = 0;   // ms en que se activó el seguimiento (velocidad promedio/ETA)
  let _distanciaRecorridaKm = 0;  // km acumulados entre fijaciones consecutivas
  let _avisoDesvioActivo = false; // evita repetir la alarma de desvío en cada fijación

  // Ruta elegida con "Unir esta ruta con otra": su ficha queda resaltada
  // hasta elegir la segunda ruta, momento en que se unen en una sola.
  let _rutaUnirSeleccionada = null;

  // Copia de las coordenadas originales de cada ruta (id -> coords) para
  // poder "Revertir cambios" tras modificar inicio/fin/sentido, y conjunto de
  // ids con modificaciones aún no revertidas.
  const _coordsOriginales = new Map();
  const _rutaModificada = new Set();

  // Última ruta "activada" en el mapa (clic en su ficha, ojo mostrado o recién
  // cargada): la barra superior muestra su distancia y tiempo.
  let _ultimaRutaActivadaId = null;

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
      if (!r.color || typeof r.color !== 'string') r.color = PALETA_RUTAS[_rutas.indexOf(r) % PALETA_RUTAS.length];
      _coordsOriginales.set(r.id, r.coords.map((c) => c.slice()));
    });
  }

  /** Devuelve un color de la paleta que ninguna ruta actual esté usando;
   *  si todos están ocupados, cicla sobre el total. */
  function _colorParaRutaNueva() {
    const usados = new Set(_rutas.map((r) => r.color).filter(Boolean));
    for (const c of PALETA_RUTAS) if (!usados.has(c)) return c;
    return PALETA_RUTAS[_rutas.length % PALETA_RUTAS.length];
  }

  function _guardar() {
    try {
      const compactas = _rutas.map((r) => ({
        id: r.id,
        nombre: r.nombre,
        km: r.km,
        seg: r.seg,
        color: r.color,
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
        color: _colorParaRutaNueva(),
      };
      ruta.seg = Math.round((ruta.km / VELOCIDAD_CAMINATA_KMH) * 3600);
      _rutas.push(ruta);
      _coordsOriginales.set(ruta.id, ruta.coords.map((c) => c.slice()));
      _guardar();

      _rutaActualId = ruta.id;
      _ultimaRutaActivadaId = ruta.id;
      _activarModo();
      // La ruta nueva queda como la única visible: todas las demás se ocultan
      // del mapa y de la lista (se conservan en la memoria y se pueden volver
      // a mostrar con su ojo).
      _rutas.forEach((r) => {
        if (r.id !== ruta.id) {
          _rutasOcultas.add(r.id);
          MapModule.toggleRutaArchivo(r.id, false);
        }
      });
      _renderTarjetas();
      // En móvil la pantalla completa se pide dentro del gesto del usuario
      // (el mismo patrón que al calcular una ruta principal).
      if (esMovil() && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
      // La altimetría de la ruta nueva se carga y muestra de una vez, y el
      // mapa se centra en ella (con el zoom del PC, igual que al pulsar su ficha).
      if (typeof mostrarAltimetriaRutaArchivo === 'function') {
        mostrarAltimetriaRutaArchivo(_geojsonRuta(ruta), ruta.km, ruta.id);
      }
      setTimeout(() => {
        MapModule.invalidateSize();
        MapModule.ajustarVista(ruta.coords, esMovil() ? [40, 40] : [80, 80]);
      }, 240);
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
    _ultimaRutaActivadaId = _rutas[_rutas.length - 1].id;
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
    // Ajustes del modo K en las pestañas: en móvil la pestaña de altimetría
    // cambia la bicicleta por el senderismo y la pestaña Rutas pasa a
    // "MIS RUTAS"; en PC la pestaña "Ruta" también pasa a "MIS RUTAS". En
    // ambos aparece un "+" para añadir otra ruta desde un archivo.
    _aplicarModoPestanas();
  }

  /** Ajustes del modo K en las pestañas (móvil y PC). */
  function _aplicarModoPestanas() {
    if (esMovil()) {
      if (el.btnTabRutaLabel) el.btnTabRutaLabel.textContent = 'Mis rutas';
      if (el.btnAnadirRutaTab) el.btnAnadirRutaTab.hidden = false;
      if (el.icoTabAltimetria) el.icoTabAltimetria.classList.replace('tab-icon--bike', 'tab-icon--hiking');
    }
    if (el.btnTabPanelRutaLabel) el.btnTabPanelRutaLabel.textContent = 'MIS RUTAS';
    if (el.btnAnadirRutaDesktop) el.btnAnadirRutaDesktop.hidden = false;
  }

  /** Revierte los ajustes del modo K en las pestañas. */
  function _revertirModoPestanas() {
    if (esMovil()) {
      if (el.btnTabRutaLabel) el.btnTabRutaLabel.textContent = 'Rutas';
      if (el.btnAnadirRutaTab) el.btnAnadirRutaTab.hidden = true;
      if (el.icoTabAltimetria) el.icoTabAltimetria.classList.replace('tab-icon--hiking', 'tab-icon--bike');
    }
    if (el.btnTabPanelRutaLabel) el.btnTabPanelRutaLabel.textContent = 'Ruta';
    if (el.btnAnadirRutaDesktop) el.btnAnadirRutaDesktop.hidden = true;
  }

  function _dibujarTodas() {
    _rutas.forEach((r) => {
      if (_rutasOcultas.has(r.id)) return;
      MapModule.dibujarRutaArchivo(r.id, r.coords, { nombre: r.nombre, color: r.color });
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

  /** Clic en la ficha de una ruta: primero abre su altimetría (en móvil la
   *  pestaña cambia el tamaño del mapa) y, una vez el mapa tiene su tamaño
   *  definitivo, centra la vista en la ruta para que quede visible. Si la
   *  ficha estaba oculta, se reactiva la ruta y su ficha (ojo activo). */
  function _clicTarjeta(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta) return;
    if (_rutasOcultas.has(id)) {
      _rutasOcultas.delete(id);
      _renderTarjetas();
    }
    MapModule.toggleRutaArchivo(id, true);
    _ultimaRutaActivadaId = id;
    _actualizarStats();
    if (typeof mostrarAltimetriaRutaArchivo === 'function') {
      mostrarAltimetriaRutaArchivo(_geojsonRuta(ruta), ruta.km, ruta.id);
    }
    // El cambio de pestaña invalida el tamaño del mapa a los ~220 ms
    // (ver setMobileTab); centrar después de eso para usar el tamaño real.
    // En PC el mapa queda con un poco menos de zoom (más margen alrededor).
    setTimeout(() => {
      MapModule.invalidateSize();
      MapModule.ajustarVista(ruta.coords, esMovil() ? [40, 40] : [80, 80]);
    }, 240);
  }

  /** Ojo de la ficha: muestra u oculta la ruta en el mapa sin quitarla. */
  function _alternarVisibilidadRuta(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta) return;
    if (_rutasOcultas.has(id)) {
      _rutasOcultas.delete(id);
      MapModule.toggleRutaArchivo(id, true);
      _ultimaRutaActivadaId = id;
    } else {
      _rutasOcultas.add(id);
      MapModule.toggleRutaArchivo(id, false);
      if (_ultimaRutaActivadaId === id) _ultimaRutaActivadaId = _ultimaVisibleSin(id);
    }
    _renderTarjetas();
    _actualizarStats();
  }

  /** Última ruta visible (para la barra superior) descartando `exceptoId`:
   *  si ninguna, null (la barra muestra "—"). */
  function _ultimaVisibleSin(exceptoId) {
    for (let i = _rutas.length - 1; i >= 0; i--) {
      const r = _rutas[i];
      if (r.id !== exceptoId && !_rutasOcultas.has(r.id)) return r.id;
    }
    return null;
  }

  // -------------------------------------------------------------------
  // Menú contextual de las fichas: renombrar y unir rutas
  // -------------------------------------------------------------------

  /** Menú contextual (clic derecho / pulsación larga) de una ficha de ruta. */
  function _abrirMenuTarjeta(id, clientX, clientY) {
    if (typeof abrirMenuFila !== 'function') return;
    const opciones = [
      { etiqueta: 'Cambiar nombre de la ruta', accion: () => _renombrarRuta(id) },
      { etiqueta: 'Cambiar punto de inicio', accion: () => _elegirPuntoEnMapa(id, 'inicio') },
      { etiqueta: 'Cambiar punto de finalización', accion: () => _elegirPuntoEnMapa(id, 'fin') },
      { etiqueta: 'Cambiar sentido de la ruta', accion: () => _cambiarSentido(id) },
      { etiqueta: 'Descargar ruta', accion: () => _descargarRuta(id) },
    ];
    if (_rutaModificada.has(id)) {
      opciones.push({ etiqueta: 'Revertir cambios', accion: () => _revertirCambiosRuta(id) });
    }
    opciones.push({ etiqueta: 'Unir esta ruta con otra', accion: () => _unirRutaDesdeTarjeta(id) });
    abrirMenuFila(opciones, clientX, clientY);
  }

  /** Pide al usuario marcar en el mapa el nuevo punto de inicio o finalización
   *  de una ruta (clic sobre la ruta) y aplica el cambio. */
  function _elegirPuntoEnMapa(id, tipo) {
    const ruta = _rutas.find((r) => r.id === id);
    const map = (typeof MapModule !== 'undefined' && typeof MapModule.getMap === 'function') ? MapModule.getMap() : null;
    if (!ruta || !map) return;
    const esInicio = tipo === 'inicio';
    if (typeof _mostrarNotificacion === 'function') {
      _mostrarNotificacion('Haz clic en el mapa sobre la ruta para marcar el nuevo ' + (esInicio ? 'punto de inicio' : 'punto de finalización') + '.');
    }
    map.getContainer().style.cursor = 'crosshair';
    const onClick = (ev) => {
      map.off('click', onClick);
      map.getContainer().style.cursor = '';
      const indice = _indicePuntoMasCercano(ruta.coords, ev.latlng);
      if (indice <= 0 || indice >= ruta.coords.length - 1) {
        if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('El punto debe estar dentro de la ruta (no en los extremos).');
        return;
      }
      if (esInicio) _cambiarPuntoInicio(id, indice);
      else _cambiarPuntoFin(id, indice);
    };
    map.on('click', onClick);
  }

  /** Pide el nuevo nombre de la ruta y lo guarda (mapa + lista + storage). */
  function _renombrarRuta(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta) return;
    _pedirNombre('Nombre de la ruta', ruta.nombre, (nombre) => {
      if (!nombre || nombre === ruta.nombre) return;
      ruta.nombre = nombre;
      _guardar();
      _renderTarjetas();
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Ruta renombrada: ' + nombre);
    });
  }

  /** Descarga la ruta como archivo GPX (trk) para compartirla o reutilizarla. */
  function _descargarRuta(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta || !ruta.coords || ruta.coords.length < 2) return;
    const nombreBase = String(ruta.nombre || 'ruta').trim()
      .replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_') || 'ruta';
    const trkpts = ruta.coords.map((c) => `      <trkpt lat="${c[0]}" lon="${c[1]}"></trkpt>`).join('\n');
    const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Rutas Simbiosis" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      '  <trk>\n' +
      '    <name>' + _escapeHtml(ruta.nombre || nombreBase) + '</name>\n' +
      '    <trkseg>\n' + trkpts + '\n    </trkseg>\n' +
      '  </trk>\n</gpx>\n';
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreBase + '.gpx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Ruta descargada: ' + ruta.nombre);
  }

  /** "Unir esta ruta con otra": la primera elección resalta la ficha y la
   *  segunda ejecuta la unión (concatenando el final de la primera con el
   *  inicio de la segunda) pidiendo el nombre de la ruta resultante. */
  function _unirRutaDesdeTarjeta(id) {
    if (_rutaUnirSeleccionada == null) {
      if (_rutas.length < 2) {
        if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Necesitas al menos dos rutas para unirlas.');
        return;
      }
      _rutaUnirSeleccionada = id;
      _renderTarjetas();
      if (typeof _mostrarNotificacion === 'function') {
        _mostrarNotificacion('Ruta 1 seleccionada. El orden es importante: las rutas se unen en el orden en que se agregan y la ruta 1 es el origen. Elige la ruta 2, o pulsa de nuevo la ruta 1 para cambiar el origen.');
      }
      return;
    }
    if (_rutaUnirSeleccionada === id) {
      // Volver a pulsar la ruta 1 cancela la selección (permite elegir otro origen).
      _rutaUnirSeleccionada = null;
      _renderTarjetas();
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Selección de unión cancelada. Puedes elegir otra ruta de origen.');
      return;
    }
    const r1 = _rutas.find((r) => r.id === _rutaUnirSeleccionada);
    const r2 = _rutas.find((r) => r.id === id);
    if (!r1 || !r2) {
      _rutaUnirSeleccionada = null;
      _renderTarjetas();
      return;
    }
    _pedirNombre('Nombre de la ruta unida', r1.nombre + ' + ' + r2.nombre, (nombre) => {
      if (!nombre) return; // cancelado: se mantiene la ficha resaltada
      // Las dos originales se ocultan del mapa y de la lista, pero se
      // conservan en la memoria (se pueden volver a mostrar con su ojo).
      _rutasOcultas.add(r1.id);
      _rutasOcultas.add(r2.id);
      MapModule.toggleRutaArchivo(r1.id, false);
      MapModule.toggleRutaArchivo(r2.id, false);
      const unida = {
        id: 'ruta-' + (++_secuencia),
        nombre: nombre,
        coords: r1.coords.concat(r2.coords),
        km: r1.km + r2.km,
        seg: r1.seg + r2.seg,
        color: _colorParaRutaNueva(),
      };
      _rutas.push(unida);
      _coordsOriginales.set(unida.id, unida.coords.map((c) => c.slice()));
      if (_rutaActualId === r1.id || _rutaActualId === r2.id) _rutaActualId = unida.id;
      _ultimaRutaActivadaId = unida.id;
      _guardar();
      _rutaUnirSeleccionada = null;
      _dibujarTodas();
      _renderTarjetas();
      _actualizarStats();
      if (_watcherId != null) { _desactivarSeguimiento(); activarSeguimiento(); }
      // Apenas se crea la ruta nueva se muestra su altimetría (panel en PC,
      // pestaña de altimetría en móvil), igual que al subir un archivo.
      if (typeof mostrarAltimetriaRutaArchivo === 'function') {
        mostrarAltimetriaRutaArchivo(_geojsonRuta(unida), unida.km, unida.id);
      }
      // Y el mapa se centra en ella, en PC y en el celular.
      setTimeout(() => {
        MapModule.invalidateSize();
        MapModule.ajustarVista(unida.coords, esMovil() ? [40, 40] : [80, 80]);
      }, 240);
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Rutas unidas: ' + nombre);
    });
  }

  /** Diálogo genérico con un campo de texto (reutiliza los estilos de los
   *  diálogos y del input del puerto). alAceptar recibe el texto o null. */
  function _pedirNombre(titulo, valorInicial, alAceptar) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog">
        <h3 class="dialog__title">${_escapeHtml(titulo)}</h3>
        <input type="text" id="pedir-nombre-input" class="nuevo-puerto__input" placeholder="Nombre de la ruta" autocomplete="off" maxlength="80">
        <p class="dialog__error" id="pedir-nombre-error" hidden></p>
        <div class="dialog__actions">
          <button type="button" class="dialog__btn dialog__btn--cancel" id="pedir-nombre-cancelar">Cancelar</button>
          <button type="button" class="dialog__btn dialog__btn--save" id="pedir-nombre-guardar">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('#pedir-nombre-input');
    const error = overlay.querySelector('#pedir-nombre-error');
    input.value = valorInicial || '';

    function limpiar() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
    function aceptar() {
      const nombre = input.value.trim();
      if (!nombre) {
        error.textContent = 'Escribe un nombre para la ruta.';
        error.hidden = false;
        input.focus();
        return;
      }
      limpiar();
      alAceptar(nombre);
    }
    function cancelar() {
      limpiar();
      alAceptar(null);
    }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); aceptar(); }
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#pedir-nombre-guardar').addEventListener('click', aceptar);
    overlay.querySelector('#pedir-nombre-cancelar').addEventListener('click', cancelar);
    input.focus();
    input.select();
  }

  // -------------------------------------------------------------------
  // Menú contextual sobre un punto de la ruta (en el mapa)
  // -------------------------------------------------------------------

  /** Clic derecho (o pulsación larga) sobre un punto de la ruta: ofrece
   *  cambiar el punto de inicio, el de finalización o el sentido (intercambia
   *  inicio por fin). Ambas opciones de extremo requieren un vértice intermedio
   *  (la ruta resultante debe conservar al menos 2 puntos), así que en una
   *  ruta de 2 puntos solo se ofrece cambiar el sentido. */
  function _abrirMenuPuntoRuta(id, latlng, clientX, clientY) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta || ruta.coords.length < 2) return;
    const indice = _indicePuntoMasCercano(ruta.coords, latlng);
    const esIntermedio = indice > 0 && indice < ruta.coords.length - 1;
    const opciones = [];
    if (esIntermedio) {
      opciones.push({ etiqueta: 'Cambiar punto de inicio', accion: () => _cambiarPuntoInicio(id, indice) });
      opciones.push({ etiqueta: 'Cambiar punto de finalización', accion: () => _cambiarPuntoFin(id, indice) });
    }
    opciones.push({ etiqueta: 'Cambiar sentido de la ruta', accion: () => _cambiarSentido(id) });
    if (_rutaModificada.has(id)) {
      opciones.push({ etiqueta: 'Revertir cambios', accion: () => _revertirCambiosRuta(id) });
    }
    opciones.push({ etiqueta: 'Unir esta ruta con otra', accion: () => _unirRutaDesdeTarjeta(id) });
    if (typeof abrirMenuFila === 'function') abrirMenuFila(opciones, clientX, clientY);
  }

  /** Vuelve la ruta a sus coordenadas originales (las de cuando se cargó o
   *  se creó), deshaciendo todos los cambios de inicio/fin/sentido. */
  function _revertirCambiosRuta(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta || !_coordsOriginales.has(id)) return;
    ruta.coords = _coordsOriginales.get(id).map((c) => c.slice());
    _rutaModificada.delete(id);
    _redibujarRutaModificada(id);
    if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Cambios revertidos en la ruta.');
  }

  /** Índice del vértice de la ruta más cercano al punto tocado (aproximación
   *  equirectangular rápida, suficiente para elegir el punto en la línea). */
  function _indicePuntoMasCercano(coords, latlng) {
    const cosLat = Math.cos(latlng.lat * Math.PI / 180);
    let mejor = 0;
    let mejorD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const dLat = coords[i][0] - latlng.lat;
      const dLng = (coords[i][1] - latlng.lng) * cosLat;
      const d = dLat * dLat + dLng * dLng;
      if (d < mejorD) { mejorD = d; mejor = i; }
    }
    return mejor;
  }

  function _cambiarPuntoInicio(id, indice) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta || ruta.coords.length < 3) return;
    if (indice <= 0 || indice >= ruta.coords.length - 1) return;
    ruta.coords = ruta.coords.slice(indice);
    _rutaModificada.add(id);
    _redibujarRutaModificada(id);
    if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Punto de inicio actualizado.');
  }

  function _cambiarPuntoFin(id, indice) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta || ruta.coords.length < 3) return;
    if (indice <= 0 || indice >= ruta.coords.length - 1) return;
    ruta.coords = ruta.coords.slice(0, indice + 1);
    _rutaModificada.add(id);
    _redibujarRutaModificada(id);
    if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Punto de finalización actualizado.');
  }

  function _cambiarSentido(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta || ruta.coords.length < 2) return;
    ruta.coords = ruta.coords.slice().reverse();
    _rutaModificada.add(id);
    _redibujarRutaModificada(id);
    if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Sentido de la ruta cambiado.');
  }

  /** Recalcula km/duración, redibuja la ruta, reinicia el seguimiento GPS si
   *  estaba activo y guarda + refresca la lista. */
  function _redibujarRutaModificada(id) {
    const ruta = _rutas.find((r) => r.id === id);
    if (!ruta) return;
    ruta.km = _distanciaTotal(ruta.coords);
    ruta.seg = Math.round((ruta.km / VELOCIDAD_CAMINATA_KMH) * 3600);
    if (!_rutasOcultas.has(id)) {
      MapModule.dibujarRutaArchivo(id, ruta.coords, { nombre: ruta.nombre, color: ruta.color });
    }
    if (_watcherId != null) { _desactivarSeguimiento(); activarSeguimiento(); }
    _guardar();
    _renderTarjetas();
    _actualizarStats();
    if (typeof altimetriaVisibleDeRutaArchivo === 'function'
        && typeof mostrarAltimetriaRutaArchivo === 'function'
        && altimetriaVisibleDeRutaArchivo()) {
      mostrarAltimetriaRutaArchivo(_geojsonRuta(ruta), ruta.km, ruta.id);
    }
  }

  function _totalKm() {
    return _rutas.reduce((acc, r) => acc + r.km, 0);
  }

  /** Quita una ruta de la memoria (mapa + lista + localStorage). */
  function quitarRuta(id) {
    const idx = _rutas.findIndex((r) => r.id === id);
    if (idx === -1) return;
    _rutas.splice(idx, 1);
    if (_rutaUnirSeleccionada === id) _rutaUnirSeleccionada = null;
    _coordsOriginales.delete(id);
    _rutaModificada.delete(id);
    MapModule.quitarRutaArchivo(id);
    _guardar();

    if (_rutaActualId === id) {
      _desactivarSeguimiento();
      _rutaActualId = _rutas.length ? _rutas[_rutas.length - 1].id : null;
    }
    if (_ultimaRutaActivadaId === id) {
      _ultimaRutaActivadaId = _ultimaVisibleSin(null);
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
    _rutaUnirSeleccionada = null;
    _ultimaRutaActivadaId = null;
    if (el.btnGps) el.btnGps.hidden = true;
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
    _revertirModoPestanas();
    _restaurarPanel();
    cerrarDialogo();
  }

  /** "Reiniciar desde cero": borra TODAS las rutas subidas (memoria, mapa,
   *  listado y localStorage) y vuelve al modo normal de Rutas. */
  function reiniciar() {
    _desactivarSeguimiento();
    _rutas = [];
    _rutasOcultas.clear();
    _coordsOriginales.clear();
    _rutaModificada.clear();
    _secuencia = 0;
    MapModule.limpiarRutasArchivo();
    _guardar();
    _modoActivo = false;
    _rutaArchivoActiva = false;
    _rutaActualId = null;
    _rutaUnirSeleccionada = null;
    _ultimaRutaActivadaId = null;
    if (el.btnGps) el.btnGps.hidden = true;
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
    _revertirModoPestanas();
    _restaurarPanel();
    cerrarDialogo();
    // El listado vuelve al título normal de paradas (no el de las fichas K).
    if (el.paradasTitulo) el.paradasTitulo.textContent = 'Paradas';
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
    if (el.btnGps) el.btnGps.classList.add('activo');
    _rumboActual = null;
    _rumboSuave = null;
    _lecturasRumbo = [];
    _ultimaPosicion = null;
    _inicioSeguimientoMs = Date.now();
    _distanciaRecorridaKm = 0;
    _avisoDesvioActivo = false;
    let primeraFijacion = true;
    _watcherId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (_ultimaPosicion) {
          _distanciaRecorridaKm += turf.distance(
            turf.point([_ultimaPosicion[1], _ultimaPosicion[0]]),
            turf.point([lon, lat]),
            { units: 'kilometers' }
          );
        }
        _ultimaPosicion = [lat, lon];
        // Si el GPS entrega rumbo del desplazamiento, se prefiere sobre la brújula.
        const rumbo = typeof pos.coords.heading === 'number' && pos.coords.heading >= 0
          ? pos.coords.heading
          : _rumboActual;
        MapModule.actualizarPosicionUsuario(lat, lon, _suavizarRumbo(rumbo));
        // Al activar (primera fijación) se centra una sola vez para mostrar la
        // ubicación; después el usuario se mueve libremente sin auto-centrado.
        if (primeraFijacion) {
          primeraFijacion = false;
          MapModule.centrarEn(lat, lon);
        }
        // Si la ubicación queda fuera de la vista, el seguimiento se desactiva
        // (el usuario puede volver a centrar pulsando el botón GPS).
        if (!_enVista()) {
          _desactivarSeguimiento();
          return;
        }
        const km = _progresoKm(linea, lat, lon);
        _actualizarAvanceRuta(rutaActual, km, pos);
        _verificarDesvio(linea, lat, lon);
      },
      () => {
        _desactivarSeguimiento();
        if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('No se pudo obtener tu ubicación.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    // Si el usuario aleja la ubicación del mapa con un paneo, se desactiva
    // enseguida (no espera a la siguiente fijación del GPS).
    if (typeof MapModule.onMoveend === 'function') {
      _quitarOyenteMoveend = MapModule.onMoveend(() => {
        if (_watcherId != null && _ultimaPosicion && !_enVista()) _desactivarSeguimiento();
      });
    }
    _iniciarOrientacion();
  }

  /** ¿La última posición conocida está dentro de la vista actual del mapa? */
  function _enVista() {
    if (!_ultimaPosicion) return true;
    if (typeof MapModule.puntoEnVista !== 'function') return true;
    return MapModule.puntoEnVista(_ultimaPosicion[0], _ultimaPosicion[1]);
  }

  /** Suaviza el rumbo promediando las últimas `_MAX_LECTURAS_RUMBO` lecturas
   *  (media circular, maneja el salto 0°/360°). Así, si llega un salto
   *  aleatorio de la brújula o del GPS, la dirección mostrada sigue siendo la
   *  correcta: con 3 mediciones un valor aislado apenas desvía el promedio. */
  function _suavizarRumbo(nuevo) {
    if (nuevo == null) return _rumboSuave;
    _lecturasRumbo.push(((nuevo % 360) + 360) % 360);
    if (_lecturasRumbo.length > _MAX_LECTURAS_RUMBO) _lecturasRumbo.shift();
    let sen = 0;
    let cos = 0;
    for (const g of _lecturasRumbo) {
      const rad = (g * Math.PI) / 180;
      sen += Math.sin(rad);
      cos += Math.cos(rad);
    }
    _rumboSuave = (Math.atan2(sen, cos) * 180 / Math.PI + 360) % 360;
    return _rumboSuave;
  }

  /** Convierte el evento de orientación del dispositivo en un rumbo de la
   *  brújula (0-360, sentido horario desde el norte) o null si no hay datos. */
  function _rumboDesdeOrientacion(evento) {
    if (evento && typeof evento.webkitCompassHeading === 'number' && isFinite(evento.webkitCompassHeading)) {
      return ((evento.webkitCompassHeading % 360) + 360) % 360;
    }
    if (evento && typeof evento.alpha === 'number' && isFinite(evento.alpha)) {
      return ((360 - evento.alpha) % 360 + 360) % 360;
    }
    return null;
  }

  /** Suscribe el listener de orientación del dispositivo (brújula). En iOS se
   *  solicita permiso primero si hace falta. */
  function _iniciarOrientacion() {
    if (_orientationHandler) return;
    const escuchar = () => {
      if (_orientationHandler) return;
      _orientationHandler = (evento) => {
        const rumbo = _rumboDesdeOrientacion(evento);
        if (rumbo == null) return;
        _rumboActual = _suavizarRumbo(rumbo);
        MapModule.actualizarDireccionUsuario(_rumboActual);
      };
      window.addEventListener('deviceorientationabsolute', _orientationHandler, true);
      window.addEventListener('deviceorientation', _orientationHandler, true);
    };
    if (typeof DeviceOrientationEvent === 'undefined' || !DeviceOrientationEvent) {
      escuchar();
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission()
        .then((estado) => { if (estado === 'granted') escuchar(); })
        .catch(() => escuchar());
    } else {
      escuchar();
    }
  }

  function _desactivarOrientacion() {
    if (_orientationHandler) {
      window.removeEventListener('deviceorientationabsolute', _orientationHandler, true);
      window.removeEventListener('deviceorientation', _orientationHandler, true);
      _orientationHandler = null;
    }
    _rumboActual = null;
    _rumboSuave = null;
    _lecturasRumbo = [];
  }

  function _progresoKm(linea, lat, lon) {
    if (!linea) return 0;
    const snap = turf.nearestPointOnLine(linea, turf.point([lon, lat]), { units: 'kilometers' });
    return Math.max(0, snap.properties.location);
  }

  /** Actualiza la etiqueta de seguimiento con: km recorridos sobre la ruta,
   *  km faltantes, altura actual y —solo tras 30 min de seguimiento—
   *  velocidad promedio y hora estimada de llegada. */
  function _actualizarAvanceRuta(rutaActual, km, pos) {
    if (!el.seguirRutaContenido) return;
    const faltante = Math.max(0, rutaActual.km - km);
    const altitud = (pos.coords.altitude != null && isFinite(pos.coords.altitude))
      ? Math.round(pos.coords.altitude)
      : null;
    let texto = 'Seguir ruta · ' + km.toFixed(1) + ' km · faltan ' + faltante.toFixed(1) + ' km';
    if (altitud != null) texto += ' · ' + altitud + ' m';
    const transcurridoMs = Date.now() - _inicioSeguimientoMs;
    if (transcurridoMs >= 30 * 60 * 1000 && _distanciaRecorridaKm > 0) {
      const horas = transcurridoMs / 3600000;
      const vel = _distanciaRecorridaKm / horas;
      if (vel > 0) {
        const horasRestantes = faltante / vel;
        const llegada = new Date(Date.now() + horasRestantes * 3600000);
        const hh = String(llegada.getHours()).padStart(2, '0');
        const mm = String(llegada.getMinutes()).padStart(2, '0');
        texto += ' · ' + vel.toFixed(1) + ' km/h · llega ' + hh + ':' + mm;
      }
    }
    el.seguirRutaContenido.textContent = texto;
  }

  /** Si la ubicación se aleja más de 10 m de la línea de la ruta, muestra una
   *  notificación y una alerta por voz. Solo vuelve a avisar si el usuario
   *  regresa a la ruta y se vuelve a desviar. */
  function _verificarDesvio(linea, lat, lon) {
    if (!linea) return;
    let distM;
    try {
      distM = turf.pointToLineDistance(turf.point([lon, lat]), linea, { units: 'meters' });
    } catch (e) {
      return;
    }
    if (distM > 10) {
      if (!_avisoDesvioActivo) {
        _avisoDesvioActivo = true;
        if (typeof _mostrarNotificacion === 'function') {
          _mostrarNotificacion('Te estás desviando de la ruta (' + Math.round(distM) + ' m).');
        }
        _hablar('Te estás desviando de la ruta.');
      }
    } else {
      _avisoDesvioActivo = false;
    }
  }

  /** Lee en voz alta un texto usando la síntesis de voz del navegador. */
  function _hablar(texto) {
    try {
      if (typeof window.speechSynthesis === 'undefined') return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'es-ES';
      u.volume = 1;
      u.rate = 1;
      window.speechSynthesis.speak(u);
    } catch (e) { /* sin voz */ }
  }

  function _desactivarSeguimiento() {
    if (_watcherId != null) {
      navigator.geolocation.clearWatch(_watcherId);
      _watcherId = null;
    }
    if (_quitarOyenteMoveend) {
      _quitarOyenteMoveend();
      _quitarOyenteMoveend = null;
    }
    _ultimaPosicion = null;
    _inicioSeguimientoMs = 0;
    _distanciaRecorridaKm = 0;
    _avisoDesvioActivo = false;
    _desactivarOrientacion();
    MapModule.limpiarPosicionUsuario();
    if (el.seguirRuta) el.seguirRuta.hidden = true;
    if (el.btnGps) el.btnGps.classList.remove('activo');
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
    const ruta = _ultimaRutaActivadaId != null
      ? _rutas.find((r) => r.id === _ultimaRutaActivadaId)
      : null;
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = ruta ? ruta.km.toFixed(1) + ' km' : '—';
    if (el.statTiempoMobile) el.statTiempoMobile.textContent = ruta ? _formatearTiempo(ruta.seg) : '—';
    if (el.paradasContador) el.paradasContador.textContent = _totalKm().toFixed(1) + ' km';
  }

  /** Número que muestra cada ficha del listado. Durante una unión en curso la
   *  ruta elegida como origen (1) se marca con un círculo verde y las demás
   *  con un círculo gris (2), para saber cómo se unirán. */
  function _numeroTarjeta(r, i) {
    if (_rutaUnirSeleccionada == null) return (i + 1) + '.';
    return _rutaUnirSeleccionada === r.id
      ? '<span class="sitio-card__num-badge sitio-card__num-badge--uno">1</span>'
      : '<span class="sitio-card__num-badge sitio-card__num-badge--dos">2</span>';
  }

  function _renderTarjetas() {
    if (!el.paradasLista) return;
    el.paradasLista.innerHTML = '';
    _rutas.forEach((r, i) => {
      const oculta = _rutasOcultas.has(r.id);
      const ojoSvg = oculta
        ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      const li = Utils.crearElemento(`
        <li class="sitio-card${oculta ? ' sitio-card--ruta-oculta' : ''}${_rutaUnirSeleccionada === r.id ? ' sitio-card--unir-seleccionada' : ''}" data-ruta-archivo-id="${r.id}">
          <div class="sitio-card__top">
            <span class="sitio-card__nombre"><span class="sitio-card__dot" style="background:${r.color || '#2f7a6b'}"></span><span class="sitio-card__num">${_numeroTarjeta(r, i)}</span>${_escapeHtml(r.nombre)}</span>
            <div class="sitio-card__top-right">
              <button type="button" class="sitio-card__ojo" data-toggle-ruta="${r.id}" title="${oculta ? 'Mostrar en el mapa' : 'Ocultar del mapa'}" aria-label="${oculta ? 'Mostrar en el mapa' : 'Ocultar del mapa'}" aria-pressed="${oculta ? 'false' : 'true'}">${ojoSvg}</button>
              <button type="button" class="sitio-card__quitar" data-quitar-ruta="${r.id}" title="Quitar ruta de la memoria" aria-label="Quitar ruta de la memoria">&times;</button>
            </div>
          </div>
          <p class="sitio-card__ciudad">${r.km.toFixed(1)} km totales</p>
        </li>
      `);
      // Clic derecho (o pulsación larga en táctil) sobre la ficha: menú con
      // "Cambiar nombre de la ruta" y "Unir esta ruta con otra".
      li.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        _abrirMenuTarjeta(r.id, evt.clientX, evt.clientY);
      });
      if (typeof engancharLongPress === 'function') {
        engancharLongPress(li, (evt) => _abrirMenuTarjeta(r.id, evt.clientX, evt.clientY));
      }
      el.paradasLista.appendChild(li);
    });
    _actualizarStats();
    // El listado no lleva la palabra "Ruta" como título (ni móvil ni PC).
    if (el.paradasTitulo) el.paradasTitulo.textContent = '';
    if (el.btnAgregarIntermedio) el.btnAgregarIntermedio.hidden = true;
    if (el.panelParadas) el.panelParadas.hidden = false;
  }

  function _restaurarPanel() {
    if (el.appRoot) el.appRoot.removeAttribute('data-ruta-archivo');
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
    if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
    if (typeof _restaurarPanelRutaInfra === 'function') _restaurarPanelRutaInfra();
    // Si el catálogo de aeropuertos/puertos/departamentos/municipios (A/P/D/M)
    // sigue activo, reponer su listado.
    if ((_puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles || _fronteraVisibles) && typeof renderizarInfraListado === 'function') {
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
    // Clic derecho / pulsación larga sobre un punto de una ruta en el mapa.
    if (typeof MapModule.setOnMenuPuntoRutaArchivo === 'function') {
      MapModule.setOnMenuPuntoRutaArchivo((id, latlng, clientX, clientY) => {
        _abrirMenuPuntoRuta(id, latlng, clientX, clientY);
      });
    }
    // "Subir tu propia ruta" (solo móvil): mismo comportamiento que la tecla K.
    if (el.btnSubirRutaPropia) el.btnSubirRutaPropia.addEventListener('click', toggleK);
    // "+" de la barra de pestañas móvil y de la barra de pestañas de PC
    // (modo K activo): añadir una ruta nueva.
    if (el.btnAnadirRutaTab) el.btnAnadirRutaTab.addEventListener('click', abrirDialogo);
    if (el.btnAnadirRutaDesktop) el.btnAnadirRutaDesktop.addEventListener('click', abrirDialogo);
    // X roja junto a la pestaña Rutas (móvil y PC): cierra las rutas de archivo
    // y vuelve al menú normal de Rutas y Descubre Colombia.
    if (el.btnCerrarRutasArchivo) el.btnCerrarRutasArchivo.addEventListener('click', salirModo);
    if (el.btnCerrarRutasArchivoDesktop) el.btnCerrarRutasArchivoDesktop.addEventListener('click', salirModo);
    if (el.paradasLista) {
      el.paradasLista.addEventListener('click', (e) => {
        // Clic sintético tras una pulsación larga (menú contextual abierto):
        // se ignora para que no cierre el menú ni abra la altimetría.
        if (_suprimirProximoClic) return;
        const ojo = e.target.closest('[data-toggle-ruta]');
        if (ojo) {
          e.stopPropagation();
          _alternarVisibilidadRuta(ojo.getAttribute('data-toggle-ruta'));
          return;
        }
        const btn = e.target.closest('[data-quitar-ruta]');
        if (btn) {
          e.stopPropagation();
          quitarRuta(btn.getAttribute('data-quitar-ruta'));
          return;
        }
        const tarjeta = e.target.closest('[data-ruta-archivo-id]');
        if (tarjeta) {
          _clicTarjeta(tarjeta.getAttribute('data-ruta-archivo-id'));
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
    reiniciar,
    refrescarPanel,
  };
})();
