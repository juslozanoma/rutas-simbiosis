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

  // Offset vertical (px) entre el borde superior del side-panel y el borde
  // inferior de la fila del destino. Se mide mientras la fila está visible
  // (antes de calcular la ruta); después se reutiliza porque la fila se
  // oculta con data-ruta-lista y el botón debe quedar centrado entre el
  // cuadro de destino y la barra de pestañas inferior.
  let _offsetFilaDestino = null;

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
    abrirMenuFila([
      { etiqueta: 'Cambiar nombre de la ruta', accion: () => _renombrarRuta(id) },
      { etiqueta: 'Unir esta ruta con otra', accion: () => _unirRutaDesdeTarjeta(id) },
    ], clientX, clientY);
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
        _mostrarNotificacion('Ruta seleccionada. Elige la segunda y pulsa "Unir esta ruta con otra".');
      }
      return;
    }
    if (_rutaUnirSeleccionada === id) {
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Esta ruta ya está seleccionada para unirse.');
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
      else if (e.key === 'Escape') cancelar();
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('#pedir-nombre-guardar').addEventListener('click', aceptar);
    overlay.querySelector('#pedir-nombre-cancelar').addEventListener('click', cancelar);
    overlay.querySelector('.dialog').addEventListener('click', (e) => e.stopPropagation());
    overlay.addEventListener('click', cancelar);
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
    if (el.paradasTitulo) el.paradasTitulo.textContent = '';
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
            <span class="sitio-card__nombre"><span class="sitio-card__dot" style="background:${r.color || '#2f7a6b'}"></span><span class="sitio-card__num">${i + 1}.</span>${_escapeHtml(r.nombre)}</span>
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

  // Mide el offset de la fila del destino mientras esté visible (ver
  // _offsetFilaDestino).
  function _medirOffsetFilaDestino() {
    const fila = document.getElementById('row-destino');
    const panel = document.querySelector('.side-panel');
    if (!fila || !panel) return;
    if (getComputedStyle(fila).display === 'none') return;
    _offsetFilaDestino = fila.getBoundingClientRect().bottom - panel.getBoundingClientRect().top;
  }

  // Centra el botón "Subir tu propia ruta" (solo móvil) entre la fila del
  // destino y la barra de pestañas inferior. Funciona también después de
  // calcular la ruta, cuando la fila del destino deja de estar visible.
  function _posicionarBotonSubirRuta() {
    const btn = el.btnSubirRutaPropia;
    if (!btn || !esMovil()) return;
    _medirOffsetFilaDestino();
    const panel = document.querySelector('.side-panel');
    const barra = el.mobileTabBar;
    if (!panel || !barra) return;
    const panelTop = panel.getBoundingClientRect().top;
    const filaBottom = _offsetFilaDestino != null
      ? panelTop + _offsetFilaDestino
      : panelTop + 140;
    const barraTop = barra.getBoundingClientRect().top;
    const centro = filaBottom + (barraTop - filaBottom) / 2;
    btn.style.top = Math.round(centro - btn.offsetHeight / 2) + 'px';
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
    // Centrar el botón entre la fila del destino y la barra inferior, y
    // re-posicionarlo cuando cambia el alto del viewport (fullscreen, teclado,
    // rotación) o el ancho cruza el umbral de escritorio/móvil.
    _posicionarBotonSubirRuta();
    window.addEventListener('resize', _posicionarBotonSubirRuta);
    window.addEventListener('orientationchange', _posicionarBotonSubirRuta);
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
