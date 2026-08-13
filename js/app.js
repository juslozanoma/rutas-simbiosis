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
      if (tipo === 'departamento' || tipo === 'municipio') {
        if (typeof mostrarCuadroInfra === 'function') mostrarCuadroInfra(tipo, item);
        return;
      }
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
        { etiqueta: 'Mover puerto', accion: () => MapModule.iniciarArrastreCatalogo(marker, 'puerto', p.id) },
        { etiqueta: 'Editar información', accion: () => abrirDialogoEditarPuerto(p) },
        { etiqueta: 'Ver más información', accion: () => mostrarCuadroInfra('puerto', p) },
      ], clientX, clientY);
    });
    // Menú contextual de aeropuertos, municipios, departamentos y sitios de
    // frontera (editar / borrar / mover / ver información), guardado en local.
    MapModule.setOnMenuCatalogoGlobal((tipo, item, marker, clientX, clientY) => {
      _menuCatalogo(tipo, item, marker, clientX, clientY);
    });
    MapModule.setOnMoverCatalogoGlobal((tipo, id, lat, lng) => _moverItemCatalogo(tipo, id, lat, lng));
    TourismModule.setOnMenuSitio((sitio, marker, clientX, clientY) => {
      _menuCatalogo('sitio', sitio, marker, clientX, clientY);
    });

    try {
      const [municipios, sitios] = await Promise.all([
        TourismModule.cargarMunicipios(),
        TourismModule.cargarSitios(),
        RouteWarningsModule.cargar(),
      ]);
      state.municipios = municipios;
      state.sitios = sitios;
      // Catálogo de departamentos (tecla D): data/departamentos.json.
      state.departamentos = [];
      try {
        const resDep = await fetch('data/departamentos.json');
        if (resDep.ok) state.departamentos = await resDep.json();
      } catch {}
      if (typeof _construirDepartamentos === 'function') _construirDepartamentos();

      // Cargar sitios de frontera
      try {
        const res = await fetch('data/sitios_turisticos_frontera.json');
        if (res.ok) {
          const frontera = await res.json();
          state.sitios = state.sitios.concat(_aplanarFrontera(frontera));
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
        const resPue = await fetch('data/puertos_colombia.json');
        if (resPue.ok) state.puertos = await resPue.json();
      } catch {}
      // Si hay una copia guardada en el navegador (OPFS, de cuando el servidor
      // no pudo escribir el archivo), se usa esa, que es la más reciente.
      if (typeof PersistenciaJsonModule !== 'undefined' && typeof PersistenciaJsonModule.leerPuertosGuardados === 'function') {
        try {
          const guardados = await PersistenciaJsonModule.leerPuertosGuardados();
          if (Array.isArray(guardados) && guardados.length) state.puertos = guardados;
        } catch {}
      }

      // Copias guardadas en el navegador (OPFS) de los demás catálogos
      // editables: se usan si existen (más recientes que el archivo original).
      if (typeof PersistenciaJsonModule !== 'undefined' && typeof PersistenciaJsonModule.leerJson === 'function') {
        const leerLocal = async (clave, aplicar) => {
          try {
            const datos = await PersistenciaJsonModule.leerJson(clave);
            if (datos) aplicar(datos);
          } catch (e) {}
        };
        await leerLocal('aeropuertos', (d) => { state.aeropuertos = d; });
        await leerLocal('municipios', (d) => { state.municipios = d; _construirDepartamentos(); });
        await leerLocal('departamentos', (d) => { state.departamentos = d; _construirDepartamentos(); });
        await leerLocal('sitios', (d) => {
          const frontera = state.sitios.filter((s) => s.frontera);
          state.sitios = d.filter((s) => !s.frontera).concat(frontera);
        });
        await leerLocal('frontera', (d) => {
          const regulares = state.sitios.filter((s) => !s.frontera);
          state.sitios = regulares.concat(_aplanarFrontera(d));
        });
      }
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

    // Cargar el grafo de ríos una sola vez al iniciar (motor fluvial).
    if (typeof FluvialModule !== 'undefined' && typeof FluvialModule.cargar === 'function') {
      FluvialModule.cargar();
    }

    // Mostrar todos los sitios de frontera (tecla F los oculta/muestra),
    // todos los puertos del catálogo (tecla P) y aeropuertos (tecla A).
    _syncFrontera();
    _syncPuertos();
    _syncAeropuertos();
    _syncDepartamentos();
    _syncMunicipios();
    _syncCategorias();
    // En móvil se restaura la vista del mapa guardada con el botón flotante
    // (debajo de "Vista satelital"), si existe.
    if (typeof esMovil === 'function' && esMovil() && typeof restaurarEstadoMapa === 'function') {
      restaurarEstadoMapa();
    }
    document.addEventListener('keydown', (evt) => {
      if (evt.ctrlKey || evt.metaKey || evt.altKey) return;
      const esInput = evt.target && evt.target.tagName && /^(INPUT|TEXTAREA|SELECT)$/.test(evt.target.tagName);
      if (esInput) return;
      const tecla = evt.key.toLowerCase();
      if (tecla === 'f') {
        _toggleCatalogo('frontera');
      } else if (tecla === 'p') {
        _toggleCatalogo('puertos');
      } else if (tecla === 'a') {
        _toggleCatalogo('aeropuertos');
      } else if (tecla === 'd') {
        _toggleCatalogo('departamentos');
      } else if (tecla === 'm') {
        _toggleCatalogo('municipios');
      } else if (tecla === 'c') {
        _toggleCatalogo('categorias');
      } else if (tecla === 'k') {
        if (typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.toggleK === 'function') {
          RutaArchivoModule.toggleK();
        }
      } else if (tecla === 'w') {
        if (typeof MapModule !== 'undefined' && typeof MapModule.toggleRedFluvial === 'function') {
          MapModule.toggleRedFluvial();
        }
      } else if (tecla === 's') {
        if (typeof MapModule !== 'undefined' && typeof MapModule.alternarVistaSatelite === 'function') {
          const activa = MapModule.alternarVistaSatelite();
          const btn = document.getElementById('btn-satelite');
          if (btn) {
            btn.classList.toggle('activo', activa);
            btn.setAttribute('aria-pressed', String(activa));
          }
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

    // Cargar el grafo de ríos una sola vez al iniciar (motor fluvial).
    if (typeof FluvialModule !== 'undefined' && typeof FluvialModule.cargar === 'function') {
      FluvialModule.cargar();
    }
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
    // El diálogo solo se cierra con Guardar o Cancelar (no al hacer clic fuera).
  }

  // -------------------------------------------------------------------
  // Menús contextuales y edición de catálogos (aeropuertos, municipios,
  // departamentos, sitios y sitios de frontera) guardados en local.
  // -------------------------------------------------------------------

  function _etiquetaTipo(tipo) {
    return { aeropuerto: 'aeropuerto', municipio: 'municipio', departamento: 'departamento', sitio: 'sitio turístico', frontera: 'sitio de frontera' }[tipo] || tipo;
  }

  function _itemCatalogo(tipo, id) {
    if (tipo === 'aeropuerto') return state.aeropuertos.find((x) => String(x.id) === String(id));
    if (tipo === 'municipio') return state.municipios.find((x) => String(x.id) === String(id));
    if (tipo === 'departamento') return state.departamentos.find((x) => String(x.id) === String(id));
    if (tipo === 'sitio' || tipo === 'frontera') return state.sitios.find((x) => String(x.id) === String(id));
    return null;
  }

  function _archivoCatalogo(tipo) {
    return { aeropuerto: 'aeropuertos', municipio: 'municipios', departamento: 'departamentos', sitio: 'sitios', frontera: 'frontera' }[tipo];
  }

  /** Aplana sitios_turisticos_frontera.json a los objetos que viven en
   *  state.sitios con `frontera: true`. */
  function _aplanarFrontera(frontera) {
    const sitios = [];
    for (const f of frontera) {
      if (!f.sitios_turisticos_fuera_colombia) continue;
      for (let i = 0; i < f.sitios_turisticos_fuera_colombia.length; i++) {
        const raw = f.sitios_turisticos_fuera_colombia[i];
        const sep = raw.indexOf(' - ');
        const nombre = sep > 0 ? raw.substring(0, sep).trim() : raw.trim();
        const desc = sep > 0 ? raw.substring(sep + 3).trim() : '';
        sitios.push({
          id: 'frontera_' + f.id + '_' + i,
          nombre,
          categoria: 'Frontera',
          municipio: f.ciudad_origen,
          departamento: f.departamento,
          lat: f.latitud,
          lon: f.longitud,
          descripcion: desc,
          ubicacion: (f.pais_fronterizo || '') + ' (frontera)',
          frontera: true,
        });
      }
    }
    return sitios;
  }

  /** Reconstruye sitios_turisticos_frontera.json desde los sitios con
   *  `frontera: true` que viven aplanados en state.sitios. */
  function _reconstruirFrontera() {
    const mapa = new Map();
    state.sitios.forEach((s) => {
      if (!s.frontera) return;
      const partes = String(s.id).split('_');
      const base = partes[1] != null ? partes[1] : 'x';
      if (!mapa.has(base)) {
        mapa.set(base, {
          id: /^\d+$/.test(base) ? Number(base) : base,
          ciudad_origen: s.municipio || '',
          departamento: s.departamento || '',
          pais_fronterizo: (s.ubicacion || '').replace(' (frontera)', ''),
          latitud: s.lat,
          longitud: s.lon,
          sitios_turisticos_fuera_colombia: [],
        });
      }
      const entry = mapa.get(base);
      const raw = `${s.nombre}${s.descripcion ? ' - ' + s.descripcion : ''}`;
      if (!entry.sitios_turisticos_fuera_colombia.includes(raw)) entry.sitios_turisticos_fuera_colombia.push(raw);
    });
    return [...mapa.values()];
  }

  /** Guarda el catálogo modificado en su JSON (servidor o copia en navegador). */
  function _guardarCatalogo(tipo) {
    const clave = _archivoCatalogo(tipo);
    if (!clave || typeof PersistenciaJsonModule === 'undefined' || typeof PersistenciaJsonModule.guardarJson !== 'function') return;
    let datos;
    if (tipo === 'frontera') datos = _reconstruirFrontera();
    else if (tipo === 'sitio') datos = state.sitios.filter((s) => !s.frontera);
    else if (tipo === 'departamento') datos = state.departamentos.map((d) => ({ nombre: d.nombre, capital: d.capital, latitud: d.lat, longitud: d.lon, descripcion: d.descripcion, año_fundacion: d.ano }));
    else if (tipo === 'aeropuerto') datos = state.aeropuertos;
    else if (tipo === 'municipio') datos = state.municipios;
    else return;
    PersistenciaJsonModule.guardarJson(clave, datos).then((res) => {
      if (typeof _mostrarNotificacion !== 'function') return;
      if (res === true) _mostrarNotificacion(_etiquetaTipo(tipo) + ' guardado — JSON actualizado.');
      else _mostrarNotificacion('No se pudo guardar el JSON de ' + _etiquetaTipo(tipo) + '; se guardó una copia en el navegador.');
    });
  }

  /** Abre el menú contextual de un ítem del catálogo (aeropuerto/municipio/
   *  departamento/sitio/frontera). */
  function _menuCatalogo(tipo, item, marker, clientX, clientY) {
    if (!item) return;
    console.log('[menu] contexto catalogo tipo=', tipo, 'item=', item.nombre);
    const opciones = [
      { etiqueta: 'Ver más información', accion: () => _verInfoCatalogo(tipo, item) },
      { etiqueta: 'Mover', accion: () => MapModule.iniciarArrastreCatalogo(marker, tipo, item.id) },
      { etiqueta: 'Editar información', accion: () => _editarItemCatalogo(tipo, item) },
      { etiqueta: 'Borrar', accion: () => _borrarItemCatalogo(tipo, item) },
    ];
    // Si el sitio es una parada o el municipio un pueblo intermedio de la ruta
    // actual, se puede llegar en avión hasta él.
    const esParada = (state.paradas || []).some((p) => String(p.id) === String(item.id));
    const esEscala = (state.escalas || []).some((e) => String(e.id) === String(item.id));
    if (typeof llegarEnAvionAParada === 'function'
      && ((tipo === 'sitio' && esParada) || (tipo === 'municipio' && esEscala))) {
      const tipoItem = tipo === 'sitio' ? 'parada' : 'escala';
      opciones.unshift({ etiqueta: 'Llegar en avión a este lugar', accion: () => llegarEnAvionAParada(item, tipoItem) });
    }
    abrirMenuFila(opciones, clientX, clientY);
  }

  function _verInfoCatalogo(tipo, item) {
    if ((tipo === 'sitio' || tipo === 'frontera') && typeof TourismModule !== 'undefined') {
      TourismModule.mostrarPopupSitio(item);
      return;
    }
    if (typeof mostrarCuadroInfra === 'function') mostrarCuadroInfra(tipo, item);
  }

  function _moverItemCatalogo(tipo, id, lat, lng) {
    const item = _itemCatalogo(tipo, id);
    if (!item) return;
    const nLat = Number(lat.toFixed(6));
    const nLng = Number(lng.toFixed(6));
    if ('latitud' in item || 'longitud' in item) {
      item.latitud = nLat;
      item.longitud = nLng;
    } else {
      item.lat = nLat;
      item.lon = nLng;
    }
    // Si el aeropuerto movido tenía líneas de conexión abiertas, se redibujan.
    if (tipo === 'aeropuerto' && typeof MapModule !== 'undefined'
      && typeof MapModule.estanConexionesAbiertas === 'function'
      && MapModule.estanConexionesAbiertas('aeropuerto', String(id))) {
      MapModule.limpiarConexiones();
      MapModule.dibujarConexiones('aeropuerto', String(id), nLat, nLng, _conexionesDeAeropuerto(item), '#4a6fa5');
    }
    _guardarCatalogo(tipo);
  }

  function _borrarItemCatalogo(tipo, item) {
    if (tipo === 'aeropuerto') {
      state.aeropuertos = state.aeropuertos.filter((x) => String(x.id) !== String(item.id));
      if (_aeropuertosVisibles) _syncAeropuertos();
    } else if (tipo === 'municipio') {
      state.municipios = state.municipios.filter((x) => String(x.id) !== String(item.id));
      if (_municipiosVisibles) _syncMunicipios();
    } else if (tipo === 'departamento') {
      state.departamentos = state.departamentos.filter((x) => String(x.id) !== String(item.id));
      if (_departamentosVisibles) _syncDepartamentos();
    } else {
      state.sitios = state.sitios.filter((x) => String(x.id) !== String(item.id));
      if (_categoriasVisibles && typeof _aplicarFiltroCategorias === 'function') _aplicarFiltroCategorias(_categoriasFiltro);
      if (_fronteraVisibles && typeof _syncFrontera === 'function') _syncFrontera();
    }
    _guardarCatalogo(tipo);
    _mostrarNotificacion('Borrado: ' + (item.nombre || ''));
  }

  function _escHtml(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _camposEdicion(tipo, item) {
    if (tipo === 'aeropuerto') {
      return [
        { label: 'Nombre', key: 'nombre', value: item.nombre || '' },
        { label: 'Descripción', key: 'descripcion', value: item.descripcion || '', textarea: true },
      ];
    }
    if (tipo === 'municipio') {
      return [
        { label: 'Nombre', key: 'nombre', value: item.nombre || '' },
        { label: 'Departamento', key: 'departamento', value: item.departamento || '' },
        { label: 'Descripción', key: 'descripción', value: item.descripción || '', textarea: true },
      ];
    }
    if (tipo === 'departamento') {
      return [
        { label: 'Nombre', key: 'nombre', value: item.nombre || '' },
        { label: 'Capital', key: 'capital', value: item.capital || '' },
        { label: 'Año de fundación', key: 'ano', value: item.ano != null ? String(item.ano) : '' },
        { label: 'Descripción', key: 'descripcion', value: item.descripcion || '', textarea: true },
      ];
    }
    return [
      { label: 'Nombre', key: 'nombre', value: item.nombre || '' },
      { label: 'Municipio', key: 'municipio', value: item.municipio || '' },
      { label: 'Descripción', key: 'descripcion', value: item.descripcion || '', textarea: true },
    ];
  }

  function _despuesEditarCatalogo(tipo) {
    if (tipo === 'aeropuerto' && _aeropuertosVisibles) _syncAeropuertos();
    else if (tipo === 'municipio' && _municipiosVisibles) _syncMunicipios();
    else if (tipo === 'departamento' && _departamentosVisibles) _syncDepartamentos();
    else if (tipo === 'sitio' || tipo === 'frontera') {
      if (_categoriasVisibles) _aplicarFiltroCategorias(_categoriasFiltro);
      if (_fronteraVisibles) _syncFrontera();
    }
  }

  /** Diálogo genérico de edición de un ítem del catálogo. */
  function _editarItemCatalogo(tipo, item) {
    const campos = _camposEdicion(tipo, item);
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    let html = `<div class="dialog">
      <h3 class="dialog__title">Editar ${_etiquetaTipo(tipo)}</h3>`;
    campos.forEach((c, i) => {
      const valor = _escHtml(c.value);
      const attrs = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';
      if (c.textarea) {
        html += `<label class="nuevo-puerto__label">${c.label}<textarea class="nuevo-puerto__input" data-idx="${i}" rows="3" ${attrs}>${valor}</textarea></label>`;
      } else {
        html += `<label class="nuevo-puerto__label">${c.label}<input type="search" class="nuevo-puerto__input" data-idx="${i}" value="${valor}" ${attrs}></label>`;
      }
    });
    html += `<p class="dialog__error" hidden id="catalogo-edit-error"></p>
      <div class="dialog__actions">
        <button type="button" class="dialog__btn dialog__btn--cancel" id="catalogo-edit-cancel">Cancelar</button>
        <button type="button" class="dialog__btn dialog__btn--save" id="catalogo-edit-save">Guardar</button>
      </div>
    </div>`;
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
    const primero = overlay.querySelector('.nuevo-puerto__input');
    if (primero) setTimeout(() => primero.focus(), 50);

    overlay.querySelector('#catalogo-edit-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#catalogo-edit-save').addEventListener('click', () => {
      campos.forEach((c, i) => {
        const el = overlay.querySelector(`[data-idx="${i}"]`);
        if (el) item[c.key] = el.value;
      });
      overlay.remove();
      _despuesEditarCatalogo(tipo);
      _guardarCatalogo(tipo);
      _mostrarNotificacion('Guardado: ' + (item.nombre || ''));
    });
    overlay.querySelector('.dialog').addEventListener('click', (e) => e.stopPropagation());
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
    state.dias = 1;
    state.diasNombres = {};
    state.diasOrden = {};
    state.diaFechaBase = null;
    state.diaFechaValor = null;
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
    if (el.paradasTitulo) el.paradasTitulo.textContent = 'Paradas';
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
    const btn = document.getElementById('btn-reiniciar-pc');
    if (btn) btn.addEventListener('click', reiniciarDesdeCero);
  }

  function initTour() {
    const btn = document.getElementById('btn-iniciar-tour');
    if (btn) btn.addEventListener('click', () => { if (typeof _toggleTour === 'function') _toggleTour(); });
  }

  // -------------------------------------------------------------------
  // Guardar / restaurar el estado del mapa (solo móvil): el botón flotante
  // debajo de "Vista satelital" persiste en localStorage la vista actual del
  // mapa (centro, zoom, rotación, vista satelital y altimetría si la hay).
  // -------------------------------------------------------------------

  const CLAVE_ESTADO_MAPA = 'rutas-simbiosis:estado-mapa';

  function guardarEstadoMapa() {
    const map = MapModule.getMap();
    if (!map) return;
    const centro = map.getCenter();
    const estado = {
      centro: [centro.lat, centro.lng],
      zoom: map.getZoom(),
      bearing: MapModule.getBearing(),
      satelite: MapModule.esVistaSatelite(),
    };
    if (state.altimetriaGeo && state.elevacion && state.elevacion.some((e) => e != null)) {
      estado.altimetria = {
        geo: state.altimetriaGeo,
        elevacion: state.elevacion,
        totalKm: state.altimetriaTotalKm,
      };
    }
    try {
      localStorage.setItem(CLAVE_ESTADO_MAPA, JSON.stringify(estado));
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('Estado del mapa guardado.');
    } catch (err) {
      if (typeof _mostrarNotificacion === 'function') _mostrarNotificacion('No se pudo guardar el estado del mapa.');
    }
  }

  function restaurarEstadoMapa() {
    let guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(CLAVE_ESTADO_MAPA)); } catch (err) { return; }
    if (!guardado || !Array.isArray(guardado.centro)) return;
    const map = MapModule.getMap();
    if (!map) return;
    map.setView(guardado.centro, guardado.zoom, { animate: false });
    MapModule.setBearing(guardado.bearing || 0);
    if (guardado.satelite && !MapModule.esVistaSatelite()) {
      MapModule.alternarVistaSatelite();
      const btn = document.getElementById('btn-satelite');
      if (btn) { btn.classList.add('activo'); btn.setAttribute('aria-pressed', 'true'); }
    }
    if (guardado.altimetria && typeof AltimetriaModule !== 'undefined') {
      state.altimetriaGeo = guardado.altimetria.geo;
      state.elevacion = guardado.altimetria.elevacion;
      state.altimetriaTotalKm = guardado.altimetria.totalKm;
      if (typeof AltimetriaModule.setDatos === 'function') {
        AltimetriaModule.setDatos(state.altimetriaGeo, state.elevacion, state.altimetriaTotalKm);
      }
    }
  }

  function initGuardarMapa() {
    const btn = document.getElementById('btn-guardar');
    if (btn) btn.addEventListener('click', guardarEstadoMapa);
  }

  // Recarga automática SOLO cuando el servidor lo anuncia (server.js), y ese
  // servidor solo avisa cuando cambian .html o .js. No recarga al guardar
  // puertos (JSON), ni por cambios de CSS/SVG. La cabecera X-Simbiosis-Server
  // la añade server.js: si la app corre en otro servidor (p. ej. Live Server
  // de VSCode) no se consulta /__server_info__ y se evita un 404 en consola.
  function initRecargaPorServidor() {
    fetch(location.pathname, { method: 'HEAD' })
      .then((res) => (res && res.headers.get('X-Simbiosis-Server') === '1' ? fetch('/__server_info__') : null))
      .then((res) => (res && res.ok ? res.json() : null))
      .then((info) => {
        if (!info || !info.events) return;
        const es = new EventSource('/events');
        es.onmessage = () => { location.reload(); };
      })
      .catch(() => {});
  }

  document.addEventListener('DOMContentLoaded', initNuevoPuerto);
  document.addEventListener('DOMContentLoaded', initReiniciar);
  document.addEventListener('DOMContentLoaded', initTour);
  document.addEventListener('DOMContentLoaded', initRecargaPorServidor);
  document.addEventListener('DOMContentLoaded', initGuardarMapa);

  document.addEventListener('DOMContentLoaded', init);