/**
 * app.js
 * ---------------------------------------------------------------------------
 * Punto de entrada: init() coordina todos los módulos y arranca la app.
 * El resto de la lógica vive en archivos por dominio (core, utilApp, teclado,
 * panel, combosApp, escalas, rutas, descubre, paradas, altimetriaApp).
 * ---------------------------------------------------------------------------
 */

  async function init() {
    MapModule.init('map');
    MapModule.setOnEliminarParada(eliminarParada);
    MapModule.setOnMenuPuntoDesvio(abrirMenuPuntoDesvio);
    MapModule.setOnMoverPuntoDesvio(moverPuntoDesvio);
    TourismModule.setOnAgregarParada((sitio, btn) => agregarParada(sitio, btn));
    MapModule.setOnTramoCompletado(onTramoMarcado);
    MapModule.setOnClicMarcadorExtremo((tipo) => {
      const extremo = tipo === 'origen' ? state.origen : state.destino;
      if (extremo) mostrarCuadroExtremo(tipo, extremo.nombre || '', extremo.departamento || '');
    });
    // Clic en un puerto/aeropuerto del mapa: solo líneas hacia sus conexiones
    // (la ficha informativa se muestra al pulsar en la lista de Descubre).
    MapModule.setOnClicInfraGlobal((tipo, item) => {
      const conexiones = tipo === 'puerto' ? _conexionesDePuerto(item) : _conexionesDeAeropuerto(item);
      MapModule.dibujarConexiones(tipo, String(item.id), Number(item.latitud), Number(item.longitud), conexiones, tipo === 'puerto' ? '#2f7a6b' : '#4a6fa5');
    });
    // Arrastre con clic derecho de un puerto del catálogo: actualiza su
    // coordenada en memoria y guarda el JSON de puertos en local.
    MapModule.setOnPuertoMovidoGlobal((id, lat, lng) => {
      const puerto = state.puertos.find((p) => String(p.id) === String(id));
      if (!puerto) return;
      puerto.latitud = Number(lat.toFixed(6));
      puerto.longitud = Number(lng.toFixed(6));
      if (MapModule.estanConexionesAbiertas('puerto', String(id))) {
        MapModule.limpiarConexiones();
        MapModule.dibujarConexiones('puerto', String(puerto.id), puerto.latitud, puerto.longitud, _conexionesDePuerto(puerto), '#2f7a6b');
      }
      if (typeof PersistenciaJsonModule === 'undefined' || typeof PersistenciaJsonModule.guardarPuertos !== 'function') return;
      PersistenciaJsonModule.guardarPuertos(state.puertos).then((res) => {
        if (typeof _mostrarNotificacion !== 'function') return;
        if (res === true) _mostrarNotificacion('Puerto movido: ' + puerto.nombre + ' — JSON guardado.');
        else if (res === false) _mostrarNotificacion('No se pudo guardar el JSON en su ubicación; se descargó una copia.');
      });
    });
    // "Agregar puerto aquí" (clic derecho en el mapa): abre el formulario.
    MapModule.setOnAgregarPuertoEn((lat, lng) => abrirDialogoNuevoPuerto(lat, lng));

    // Clic derecho sobre un puerto del catálogo: menú contextual propio
    // (borrar / mover / editar / ver más información) en vez del arrastre directo.
    MapModule.setOnMenuPuertoGlobal((p, marker, clientX, clientY) => {
      abrirMenuFila([
        { etiqueta: 'Borrar puerto', accion: () => borrarPuerto(p) },
        { etiqueta: 'Mover puerto', accion: () => MapModule.iniciarArrastrePuerto(marker, p.id) },
        { etiqueta: 'Editar información', accion: () => abrirDialogoEditarPuerto(p) },
        { etiqueta: 'Ver más información', accion: () => mostrarCuadroInfra('puerto', p) },
      ], clientX, clientY);
    });

    try {
      const [municipios, sitios] = await Promise.all([
        TourismModule.cargarMunicipios(),
        TourismModule.cargarSitios(),
        RouteWarningsModule.cargar(),
      ]);
      state.municipios = municipios;
      state.sitios = sitios;

      // Cargar sitios de frontera
      try {
        const res = await fetch('data/sitios_turisticos_frontera.json');
        if (res.ok) {
          const frontera = await res.json();
          for (const f of frontera) {
            if (!f.sitios_turisticos_fuera_colombia) continue;
            for (let i = 0; i < f.sitios_turisticos_fuera_colombia.length; i++) {
              const raw = f.sitios_turisticos_fuera_colombia[i];
              const sep = raw.indexOf(' - ');
              const nombre = sep > 0 ? raw.substring(0, sep).trim() : raw.trim();
              const desc = sep > 0 ? raw.substring(sep + 3).trim() : '';
              state.sitios.push({
                id: 'frontera_' + f.id + '_' + i,
                nombre,
                categoria: 'Frontera',
                municipio: f.ciudad_origen,
                departamento: f.departamento,
                lat: f.latitud,
                lon: f.longitud,
                descripcion: desc,
                ubicacion: f.pais_fronterizo + ' (frontera)',
                frontera: true,
              });
            }
          }
        }
      } catch {}
      if (el.sitiosFronteraContador) {
        el.sitiosFronteraContador.textContent = 'Frontera: ' + state.sitios.filter(s => s.frontera).length;
      }

      // Cargar aeropuertos (opción de desplazamiento aéreo)
      state.aeropuertos = [];
      try {
        const resAer = await fetch('data/aeropuertos_colombia.json');
        if (resAer.ok) state.aeropuertos = await resAer.json();
      } catch {}

      // Cargar puertos fluviales (opción de desplazamiento por río)
      state.puertos = [];
      try {
        const resPue = await fetch('data/puertos_fluviales_colombia.json');
        if (resPue.ok) state.puertos = await resPue.json();
      } catch {}
    } catch (err) {
      el.sitiosVacio.textContent = 'Error cargando los datos base: ' + err.message;
      return;
    }

    // Configuración compartida de los cuadros de municipio (módulo único).
    MunicipioCombo.configurar({
      esMovil: () => esMovil(),
      capitales: CAPITALES,
      formatear: formatMunicipio,
      municipios: () => state.municipios,
      seleccionarMapa: iniciarSeleccionMapa,
      teclado: {
        ajustar: ajustarComboAlTeclado,
        reencajar: reencajarConTeclado,
        reposicionar: reposicionarInterfazTeclado,
      },
    });

    initCombos();
    state.categoriasUnicas = obtenerCategoriasUnicas();
    renderizarCategoriasMenu();
    initEscalas();
    initEventos();
    if (typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.initEventos === 'function') {
      RutaArchivoModule.initEventos();
    }
    if (typeof _syncBotonAltimetria === 'function') _syncBotonAltimetria();
    garantizarVisibilidadMovil();
    reordenarAereoMovil();

    // Mostrar todos los sitios de frontera (tecla F los oculta/muestra),
    // todos los puertos del catálogo (tecla P) y aeropuertos (tecla A).
    _syncFrontera();
    _syncPuertos();
    _syncAeropuertos();
    document.addEventListener('keydown', (evt) => {
      if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
      const esInput = evt.target && evt.target.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(evt.target.tagName);
      if (esInput) return;
      const tecla = evt.key.toLowerCase();
      if (tecla === 'f') {
        _fronteraVisibles = !_fronteraVisibles;
        _syncFrontera();
      } else if (tecla === 'p') {
        _puertosVisibles = !_puertosVisibles;
        _syncPuertos();
      } else if (tecla === 'a') {
        _aeropuertosVisibles = !_aeropuertosVisibles;
        _syncAeropuertos();
      } else if (tecla === 'k') {
        if (typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.toggleK === 'function') {
          RutaArchivoModule.toggleK();
        }
      }
    });
  }

  // -------------------------------------------------------------------
  // Formulario "Agregar puerto" (clic derecho en el mapa)
  // -------------------------------------------------------------------

  let _npLat = null;
  let _npLng = null;
  let _npEditandoId = null;

  function _npFijarTitulo(editando) {
    const titulo = document.getElementById('np-titulo');
    if (titulo) titulo.textContent = editando ? 'Editar puerto' : 'Agregar puerto';
    const guardar = document.getElementById('np-guardar');
    if (guardar) guardar.textContent = editando ? 'Guardar cambios' : 'Guardar puerto';
  }

  function abrirDialogoNuevoPuerto(lat, lng) {
    _npLat = lat;
    _npLng = lng;
    _npEditandoId = null;
    _npFijarTitulo(false);
    ['np-nombre', 'np-ciudad', 'np-rio', 'np-descripcion'].forEach((id) => {
      const e = document.getElementById(id);
      if (e) e.value = '';
    });
    const err = document.getElementById('np-error');
    if (err) { err.hidden = true; err.textContent = ''; }
    const dlg = document.getElementById('panel-nuevo-puerto');
    if (dlg) dlg.hidden = false;
    const nombre = document.getElementById('np-nombre');
    if (nombre) setTimeout(() => nombre.focus(), 50);
  }

  function abrirDialogoEditarPuerto(p) {
    _npLat = Number(p.latitud);
    _npLng = Number(p.longitud);
    _npEditandoId = p.id;
    _npFijarTitulo(true);
    const valores = { 'np-nombre': p.nombre, 'np-ciudad': p.ciudad, 'np-rio': p.rio, 'np-descripcion': p.descripcion };
    Object.keys(valores).forEach((id) => {
      const e = document.getElementById(id);
      if (e) e.value = valores[id] || '';
    });
    const err = document.getElementById('np-error');
    if (err) { err.hidden = true; err.textContent = ''; }
    const dlg = document.getElementById('panel-nuevo-puerto');
    if (dlg) dlg.hidden = false;
    const nombre = document.getElementById('np-nombre');
    if (nombre) setTimeout(() => nombre.focus(), 50);
  }

  function cerrarDialogoNuevoPuerto() {
    _npEditandoId = null;
    const dlg = document.getElementById('panel-nuevo-puerto');
    if (dlg) dlg.hidden = true;
  }

  function _generarIdPuerto(nombre) {
    const base = String(nombre || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/\s+/).map((w) => w[0] || '').join('').toUpperCase().slice(0, 4);
    const usado = new Set(state.puertos.map((p) => String(p.id)));
    let id = base || 'P';
    let n = 2;
    while (usado.has(id)) {
      id = (base || 'P').slice(0, 3) + n;
      n++;
    }
    return id;
  }

  function guardarNuevoPuerto() {
    const nombre = (document.getElementById('np-nombre').value || '').trim();
    const ciudad = (document.getElementById('np-ciudad').value || '').trim();
    const rio = (document.getElementById('np-rio').value || '').trim();
    const descripcion = (document.getElementById('np-descripcion').value || '').trim();
    const err = document.getElementById('np-error');
    if (!nombre || !ciudad || !rio) {
      if (err) { err.hidden = false; err.textContent = 'Nombre, ciudad y río son obligatorios.'; }
      return;
    }

    // Edición de un puerto existente: conserva su id y coordenadas.
    if (_npEditandoId) {
      const idx = state.puertos.findIndex((x) => String(x.id) === String(_npEditandoId));
      if (idx >= 0) {
        Object.assign(state.puertos[idx], { nombre, ciudad, rio, descripcion });
        const puerto = state.puertos[idx];
        cerrarDialogoNuevoPuerto();
        if (typeof _syncPuertos === 'function') _syncPuertos();
        if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
        if (typeof PersistenciaJsonModule !== 'undefined' && typeof PersistenciaJsonModule.guardarPuertos === 'function') {
          PersistenciaJsonModule.guardarPuertos(state.puertos).then((res) => {
            if (typeof _mostrarNotificacion !== 'function') return;
            if (res === true) _mostrarNotificacion('Puerto actualizado: ' + nombre + ' — JSON guardado.');
            else if (res === false) _mostrarNotificacion('Puerto actualizado; no se pudo sobrescribir el JSON, se descargó una copia.');
          });
        }
      }
      return;
    }

    const puerto = {
      id: _generarIdPuerto(nombre),
      nombre,
      ciudad,
      rio,
      latitud: Number(_npLat.toFixed(6)),
      longitud: Number(_npLng.toFixed(6)),
      ubicacion: '',
      descripcion,
      destinos_id: [],
    };
    state.puertos.push(puerto);
    cerrarDialogoNuevoPuerto();
    if (typeof _syncPuertos === 'function') _syncPuertos();
    if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
    if (typeof PersistenciaJsonModule !== 'undefined' && typeof PersistenciaJsonModule.guardarPuertos === 'function') {
      PersistenciaJsonModule.guardarPuertos(state.puertos).then((res) => {
        if (typeof _mostrarNotificacion !== 'function') return;
        if (res === true) _mostrarNotificacion('Puerto agregado: ' + nombre + ' — JSON guardado.');
        else if (res === false) _mostrarNotificacion('Puerto agregado; no se pudo sobrescribir el JSON, se descargó una copia.');
      });
    }
  }

  /** Borra un puerto del catálogo (menú contextual del marcador): memoria,
   *  mapa, listado y JSON de puertos. */
  function borrarPuerto(p) {
    state.puertos = state.puertos.filter((x) => String(x.id) !== String(p.id));
    if (typeof _syncPuertos === 'function') _syncPuertos();
    if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
    if (typeof PersistenciaJsonModule !== 'undefined' && typeof PersistenciaJsonModule.guardarPuertos === 'function') {
      PersistenciaJsonModule.guardarPuertos(state.puertos).then((res) => {
        if (typeof _mostrarNotificacion !== 'function') return;
        if (res === true) _mostrarNotificacion('Puerto borrado: ' + p.nombre + ' — JSON guardado.');
        else if (res === false) _mostrarNotificacion('Puerto borrado; no se pudo sobrescribir el JSON, se descargó una copia.');
      });
    }
  }

  function initNuevoPuerto() {
    const guardar = document.getElementById('np-guardar');
    if (guardar) guardar.addEventListener('click', guardarNuevoPuerto);
    const cancelar = document.getElementById('np-cancelar');
    if (cancelar) cancelar.addEventListener('click', cerrarDialogoNuevoPuerto);
    const dlg = document.getElementById('panel-nuevo-puerto');
    if (dlg) {
      dlg.addEventListener('click', (e) => { if (e.target === dlg) cerrarDialogoNuevoPuerto(); });
    }
  }

  // -------------------------------------------------------------------
  // "Reiniciar desde cero" (pestaña Ruta, móvil)
  // -------------------------------------------------------------------

  /** Vuelve todo al estado inicial: borra las rutas subidas (memoria, mapa,
   *  listado y localStorage) y reinicia el viaje (origen, destino, pueblos
   *  intermedios, paradas y ruta calculada). */
  function reiniciarDesdeCero() {
    if (typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.reiniciar === 'function') {
      RutaArchivoModule.reiniciar();
    }

    state.origen = null;
    state.destino = null;
    state.escalas = [];
    state.orden = [];
    state.paradas = [];
    state.rutaBase = null;
    state.rutaActual = null;
    state.modoAereo = false;
    state.tramosAereo = null;
    state.modoFluvial = false;
    state.tramosFluviales = null;
    state.elevacion = null;
    state.altimetriaGeo = null;
    state.altimetriaTotalKm = 0;
    state.previewSitioId = null;
    state.categoriasSeleccionadas = [];

    if (typeof _limpiarCombos === 'function') _limpiarCombos();
    if (el.origenInput) el.origenInput.value = '';
    if (el.destinoInput) el.destinoInput.value = '';
    document.querySelectorAll('.combo--seleccionado').forEach((c) => c.classList.remove('combo--seleccionado'));

    if (typeof MapModule !== 'undefined' && typeof MapModule.limpiarTodo === 'function') MapModule.limpiarTodo();
    if (typeof MapModule.limpiarSitios === 'function') MapModule.limpiarSitios();
    if (typeof MapModule.limpiarSitiosFrontera === 'function') MapModule.limpiarSitiosFrontera();
    if (typeof AltimetriaModule !== 'undefined' && typeof AltimetriaModule.limpiar === 'function') AltimetriaModule.limpiar();
    if (typeof cerrarAltimetria === 'function') cerrarAltimetria();

    if (typeof _limpiarTurfYListado === 'function') _limpiarTurfYListado();
    if (el.sitiosLista) { el.sitiosLista.innerHTML = ''; el.sitiosLista.hidden = true; }
    if (el.sitiosVacio) { el.sitiosVacio.hidden = true; el.sitiosVacio.textContent = ''; }
    if (el.sitiosContador) el.sitiosContador.textContent = '0';
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = '0';
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = '0';
    if (el.paradasLista) el.paradasLista.innerHTML = '';
    if (el.paradasContador) el.paradasContador.textContent = '0';
    if (el.paradasTitulo) el.paradasTitulo.textContent = '';
    if (el.panelEscalas) el.panelEscalas.innerHTML = '';
    if (el.btnAgregarEscala) el.btnAgregarEscala.hidden = false;

    if (typeof renderizarParadas === 'function') renderizarParadas();
    if (typeof sincronizarModoRutaMovil === 'function') sincronizarModoRutaMovil();
    if (typeof actualizarEstadoBotonCalcular === 'function') actualizarEstadoBotonCalcular();
    if (typeof _actualizarTextoBotonesOrden === 'function') _actualizarTextoBotonesOrden();
    if (typeof reordenarAereoMovil === 'function') reordenarAereoMovil();
    if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Todo reiniciado desde cero.');
    if (typeof activarPanelTab === 'function') activarPanelTab('ruta');
    if (typeof esMovil === 'function' && esMovil() && typeof setMobileTab === 'function') setMobileTab('ruta');
  }

  function initReiniciar() {
    const btn = document.getElementById('btn-reiniciar-todo');
    if (btn) btn.addEventListener('click', reiniciarDesdeCero);
  }

  document.addEventListener('DOMContentLoaded', initNuevoPuerto);
  document.addEventListener('DOMContentLoaded', initReiniciar);

  document.addEventListener('DOMContentLoaded', init);