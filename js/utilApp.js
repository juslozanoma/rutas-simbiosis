/**
 * utilApp.js
 * ---------------------------------------------------------------------------
 * Utilidades generales de la aplicación: helpers de formato, estado de carga,
 * visibilidad móvil y funciones auxiliares reutilizadas por otros módulos.
 * ---------------------------------------------------------------------------
 */

  function _syncFrontera() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresFrontera) return;
    if (_fronteraVisibles) {
      MapModule.setMarcadoresFrontera(state.sitios.filter((s) => s.frontera));
    } else {
      MapModule.limpiarSitiosFrontera();
    }
  }


  // Pestaña que estaba activa antes de activar el catálogo de puertos/
  // aeropuertos (A/P); se restaura al apagar ambas teclas.

  let _pestanaAntesInfra = null;

  let _filtroMunicipiosOk = false; // el listener del filtro de municipios se conecta una sola vez


  function _syncPuertos() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresPuertosGlobal) return;
    if (el.appRoot) el.appRoot.setAttribute('data-puertos-activos', _puertosVisibles ? 'true' : 'false');
    if (_puertosVisibles) {
      MapModule.setMarcadoresPuertosGlobal(state.puertos);
    } else {
      MapModule.limpiarPuertosGlobal();
    }
    _syncModoInfra();
  }


  function _syncAeropuertos() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresAeropuertosGlobal) return;
    if (el.appRoot) el.appRoot.setAttribute('data-aeropuertos-activos', _aeropuertosVisibles ? 'true' : 'false');
    if (_aeropuertosVisibles) {
      MapModule.setMarcadoresAeropuertosGlobal(state.aeropuertos);
    } else {
      MapModule.limpiarAeropuertosGlobal();
    }
    _syncModoInfra();
  }


  /** Procesa el catálogo de departamentos (tecla D) cargado desde
   *  data/departamentos.json: completa cada uno con el año de fundación de su
   *  capital, el total de municipios y la sede de Cundinamarca. */
  function _construirDepartamentos() {
    const conteo = new Map();
    state.municipios.forEach((m) => {
      if (m.departamento) conteo.set(m.departamento, (conteo.get(m.departamento) || 0) + 1);
    });
    const raw = Array.isArray(state.departamentos) ? state.departamentos : [];
    const deps = raw
      .filter((d) => d.nombre && d.latitud != null && d.longitud != null && !isNaN(Number(d.latitud)) && !isNaN(Number(d.longitud)))
      .map((d) => {
        const capitalMuni = state.municipios.find((x) => x.nombre === d.capital);
        return {
          id: d.nombre,
          nombre: d.nombre,
          capital: d.capital || '',
          lat: Number(d.latitud),
          lon: Number(d.longitud),
          descripcion: d.descripcion || '',
          ano: capitalMuni ? (capitalMuni.ano_fundacion || '') : '',
          totalMunicipios: conteo.get(d.nombre) || 0,
          sede: d.nombre === 'Cundinamarca' ? 'Gobernación de Cundinamarca' : null,
        };
      });
    deps.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    state.departamentos = deps;
  }


  function _syncDepartamentos() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresDepartamentosGlobal) return;
    if (el.appRoot) el.appRoot.setAttribute('data-departamentos-activos', _departamentosVisibles ? 'true' : 'false');
    if (_departamentosVisibles) {
      MapModule.setMarcadoresDepartamentosGlobal(state.departamentos);
    } else {
      MapModule.limpiarDepartamentosGlobal();
      // Los sitios mostrados por el catálogo se ocultan al apagarlo.
      _ocultarSitiosCatalogo();
    }
    _syncModoInfra();
  }


  /** Rellena el <select> de departamentos con las 33 opciones del país. */
  function _rellenarFiltroMunicipios() {
    const sel = el.filtroMunicipiosDepto;
    if (!sel) return;
    const actual = sel.value;
    const deps = [...new Set(state.municipios.map((m) => m.departamento).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'es'));
    sel.innerHTML = '';
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Filtrar por departamento…';
    sel.appendChild(vacio);
    deps.forEach((d) => {
      const o = document.createElement('option');
      o.value = d;
      o.textContent = d;
      sel.appendChild(o);
    });
    if (deps.includes(actual)) sel.value = actual;
    else sel.value = '';
    _municipiosFiltroDepto = sel.value;
  }


  /** Aplica el filtro de departamento del modo municipios (tecla M): dibuja en
   *  el mapa y lista solo los municipios del departamento elegido, y encuadra
   *  el departamento para que se vean solo sus municipios. */
  function _aplicarFiltroMunicipios() {
    const sel = el.filtroMunicipiosDepto;
    if (sel) _municipiosFiltroDepto = sel.value;
    const lista = _municipiosFiltroDepto
      ? state.municipios.filter((m) => m.departamento === _municipiosFiltroDepto)
      : [];
    if (typeof MapModule !== 'undefined' && typeof MapModule.setMarcadoresMunicipiosGlobal === 'function') {
      MapModule.setMarcadoresMunicipiosGlobal(lista);
    }
    if (_municipiosFiltroDepto && lista.length >= 2 && typeof MapModule !== 'undefined' && typeof MapModule.encuadrar === 'function') {
      const coords = lista
        .filter((m) => m.lat != null && m.lon != null && !isNaN(Number(m.lat)) && !isNaN(Number(m.lon)))
        .map((m) => [Number(m.lat), Number(m.lon)]);
      if (coords.length >= 2) MapModule.encuadrar(coords, [40, 40]);
    }
    if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
  }


  function _syncMunicipios() {
    if (typeof MapModule === 'undefined' || !MapModule.setMarcadoresMunicipiosGlobal) return;
    if (el.appRoot) el.appRoot.setAttribute('data-municipios-activos', _municipiosVisibles ? 'true' : 'false');
    if (_municipiosVisibles) {
      _rellenarFiltroMunicipios();
      if (!_filtroMunicipiosOk) {
        _filtroMunicipiosOk = true;
        if (el.filtroMunicipiosDepto) el.filtroMunicipiosDepto.addEventListener('change', _aplicarFiltroMunicipios);
      }
      _aplicarFiltroMunicipios();
    } else {
      MapModule.limpiarMunicipiosGlobal();
      // Los sitios mostrados por el catálogo se ocultan al apagarlo.
      _ocultarSitiosCatalogo();
    }
    _syncModoInfra();
  }


  /** Oculta los sitios que el catálogo (D/M/C) pudo mostrar en el mapa y deja
   *  limpio el listado de Descubre. */
  function _ocultarSitiosCatalogo() {
    if (typeof MapModule !== 'undefined' && typeof MapModule.limpiarSitios === 'function') MapModule.limpiarSitios();
    if (typeof _borrarListadoDescubre === 'function') _borrarListadoDescubre();
  }


  let _filtroCategoriasOk = false; // el listener del filtro de categorías se conecta una sola vez

  /** Rellena el <select> de categorías con las categorías y su número de sitios. */
  function _rellenarFiltroCategorias() {
    const sel = el.filtroCategorias;
    if (!sel) return;
    const actual = sel.value;
    const conteo = new Map();
    state.sitios.forEach((s) => {
      const c = s.categoria ? s.categoria.trim() : '';
      if (!c) return;
      conteo.set(c, (conteo.get(c) || 0) + 1);
    });
    const cats = [...conteo.keys()].sort((a, b) => a.length - b.length || a.localeCompare(b, 'es'));
    sel.innerHTML = '';
    const vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = 'Filtrar por categoría…';
    sel.appendChild(vacio);
    cats.forEach((c) => {
      const o = document.createElement('option');
      o.value = c;
      o.textContent = `${c} (${conteo.get(c)})`;
      sel.appendChild(o);
    });
    if (cats.includes(actual)) sel.value = actual;
    else sel.value = '';
    _categoriasFiltro = sel.value;
  }


  /** Aplica el filtro de categoría (tecla C): muestra en el mapa y en Descubre
   *  los sitios de la categoría elegida (una sola a la vez). */
  function _aplicarFiltroCategorias() {
    const sel = el.filtroCategorias;
    if (sel) _categoriasFiltro = sel.value;
    if (_categoriasFiltro) {
      const lista = state.sitios.filter((s) => (s.categoria || '').trim() === _categoriasFiltro);
      state.sitiosFiltradosBase = lista;
      state.sitiosFiltrados = lista;
      state.modoVisibilidad = 'completa';
      if (typeof renderizarSitios === 'function') renderizarSitios(lista);
      // La pestaña Descubre queda disponible.
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
      if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
      if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    } else {
      _ocultarSitiosCatalogo();
    }
    if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
  }


  function _syncCategorias() {
    if (el.appRoot) el.appRoot.setAttribute('data-categorias-activos', _categoriasVisibles ? 'true' : 'false');
    if (_categoriasVisibles) {
      _rellenarFiltroCategorias();
      if (!_filtroCategoriasOk) {
        _filtroCategoriasOk = true;
        if (el.filtroCategorias) el.filtroCategorias.addEventListener('change', _aplicarFiltroCategorias);
      }
      _aplicarFiltroCategorias();
    } else {
      _ocultarSitiosCatalogo();
    }
    _syncModoInfra();
  }


  /** Alterna un catálogo (P/A/D/M/C) manteniéndolos excluyentes: activar uno
   *  apaga los demás; activar el que ya está activo lo apaga. */
  function _toggleCatalogo(tipo) {
    let activando = false;
    if (tipo === 'puertos') activando = !_puertosVisibles;
    else if (tipo === 'aeropuertos') activando = !_aeropuertosVisibles;
    else if (tipo === 'departamentos') activando = !_departamentosVisibles;
    else if (tipo === 'municipios') activando = !_municipiosVisibles;
    else if (tipo === 'categorias') activando = !_categoriasVisibles;
    _puertosVisibles = false;
    _aeropuertosVisibles = false;
    _departamentosVisibles = false;
    _municipiosVisibles = false;
    _categoriasVisibles = false;
    if (activando) {
      if (tipo === 'puertos') _puertosVisibles = true;
      else if (tipo === 'aeropuertos') _aeropuertosVisibles = true;
      else if (tipo === 'departamentos') _departamentosVisibles = true;
      else if (tipo === 'municipios') _municipiosVisibles = true;
      else if (tipo === 'categorias') _categoriasVisibles = true;
    }
    _syncPuertos();
    _syncAeropuertos();
    _syncDepartamentos();
    _syncMunicipios();
    _syncCategorias();
  }


  /** Etiqueta de la pestaña Ruta cuando algún catálogo (P/A/D/M) está activo:
   *  "PUERTOS", "AEROPUERTOS", "DEPARTAMENTOS", "MUNICIPIOS" o combinaciones. */
  function _etiquetaInfra() {
    if (!_puertosVisibles && !_aeropuertosVisibles && !_departamentosVisibles && !_municipiosVisibles && !_categoriasVisibles) return null;
    const partes = [];
    if (_puertosVisibles) partes.push('PUERTOS');
    if (_aeropuertosVisibles) partes.push('AEROPUERTOS');
    if (_departamentosVisibles) partes.push('DEPARTAMENTOS');
    if (_municipiosVisibles) partes.push('MUNICIPIOS');
    if (_categoriasVisibles) partes.push('CATEGORÍAS');
    return partes.join(' Y ');
  }

  /** Renombra la pestaña Ruta (móvil y PC) según el catálogo activo (P/A/D/M). */
  function _actualizarEtiquetaPestanaRutaInfra() {
    const etiqueta = _etiquetaInfra();
    if (!etiqueta) return;
    if (el.btnTabPanelRutaLabel) el.btnTabPanelRutaLabel.textContent = etiqueta;
    if (el.btnTabRutaLabel) el.btnTabRutaLabel.textContent = etiqueta;
  }

  /** Restaura el nombre de la pestaña Ruta al apagar el catálogo (P/A/D/M). */
  function _restaurarEtiquetaPestanaRuta() {
    const enModoK = _rutaArchivoActiva;
    if (el.btnTabPanelRutaLabel) el.btnTabPanelRutaLabel.textContent = enModoK ? 'MIS RUTAS' : 'Ruta';
    if (el.btnTabRutaLabel) el.btnTabRutaLabel.textContent = enModoK ? 'Mis rutas' : 'Rutas';
  }

  function _syncModoInfra() {
    const activo = _puertosVisibles || _aeropuertosVisibles || _departamentosVisibles || _municipiosVisibles || _categoriasVisibles;
    if (el.appRoot) {
      if (activo) el.appRoot.setAttribute('data-infra-activa', 'true');
      else el.appRoot.removeAttribute('data-infra-activa');
    }
    if (activo) {
      if (_pestanaAntesInfra == null) _pestanaAntesInfra = estaEnPestanaDescubre() ? 'descubre' : 'ruta';
      if (estaEnPestanaDescubre()) {
        if (esMovil()) setMobileTab('ruta');
        else activarPanelTab('ruta');
      }
      if (el.panelLocate) el.panelLocate.hidden = true;
      // La pestaña Descubre se oculta solo con puertos/aeropuertos (P/A); con
      // departamentos (D) o municipios (M) queda visible para poder ver los
      // sitios turísticos de cada uno.
      const ocultarDescubre = _puertosVisibles || _aeropuertosVisibles;
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = ocultarDescubre;
      if (el.btnTabDescubre) el.btnTabDescubre.hidden = ocultarDescubre;
      if (el.btnMostrarSitiosCercanos) {
        el.btnMostrarSitiosCercanos.hidden = true;
        el.btnMostrarSitiosCercanos.disabled = true;
      }
      // Con puertos/aeropuertos (P/A) se ocultan del mapa todas las rutas e
      // íconos de sitios; se restauran al apagar las teclas. En departamentos
      // (D) y municipios (M) no se ocultan, para poder mostrar sus sitios.
      const ocultarMapaInfra = _puertosVisibles || _aeropuertosVisibles;
      if (ocultarMapaInfra && typeof MapModule !== 'undefined' && typeof MapModule.ocultarRutasYSitios === 'function') {
        MapModule.ocultarRutasYSitios(true);
      }
      if (typeof renderizarInfraListado === 'function') renderizarInfraListado();
      _actualizarEtiquetaPestanaRutaInfra();
    } else {
      const volverA = _pestanaAntesInfra;
      _pestanaAntesInfra = null;
      if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.hidden = false;
      if (el.btnTabDescubre) el.btnTabDescubre.hidden = false;
      if (typeof MapModule !== 'undefined' && typeof MapModule.ocultarRutasYSitios === 'function') {
        MapModule.ocultarRutasYSitios(false);
      }
      if (typeof _restaurarPanelRutaInfra === 'function') _restaurarPanelRutaInfra();
      // Si la ruta desde archivo (K) sigue activa, reponer su tarjeta en la lista.
      if (_rutaArchivoActiva && typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.refrescarPanel === 'function') {
        RutaArchivoModule.refrescarPanel();
      }
      _restaurarEtiquetaPestanaRuta();
      if (volverA === 'descubre' && !estaEnPestanaDescubre()) {
        activarPanelTab('descubre');
        if (esMovil()) setMobileTab('descubre');
      } else {
        activarPanelTab('ruta');
        if (esMovil()) setMobileTab('ruta');
      }
    }
  }


  function etiquetaIntermedia(idx) {
    return LETRAS_RUTA[Math.min(idx + 1, LETRAS_RUTA.length - 2)];
  }


  function actualizarBotonesOrden() {
    if (!el.btnOrdenOrigen || !el.btnOrdenDestino) return;
    el.btnOrdenOrigen.setAttribute('aria-pressed', String(state.ordenSitios === 'origen'));
    el.btnOrdenDestino.setAttribute('aria-pressed', String(state.ordenSitios === 'destino'));
  }


  function _actualizarTextoBotonesOrden() {
    if (el.btnOrdenOrigenDes) el.btnOrdenOrigenDes.textContent = state.origen?.nombre ? `Desde ${state.origen.nombre}` : 'Desde Origen';
    if (el.btnOrdenDestinoDes) el.btnOrdenDestinoDes.textContent = state.destino?.nombre ? `Desde ${state.destino.nombre}` : 'Desde Destino';
  }


  function _actualizarEstadoBotonesDescubre() {
    if (el.btnOrdenOrigenDes) el.btnOrdenOrigenDes.classList.toggle('descubre-dropdown__item--active', state.ordenSitios === 'origen');
    if (el.btnOrdenDestinoDes) el.btnOrdenDestinoDes.classList.toggle('descubre-dropdown__item--active', state.ordenSitios === 'destino');
  }


  function actualizarEstadoBotonCalcular() {
    const listo = !!(state.origen && state.destino);
    el.btnCalcular.disabled = !listo;
    if (el.btnAereo) el.btnAereo.disabled = !listo;
  }

  /** Activa modo de selección en el mapa: el usuario hace clic y se llama a `callback(lat, lon)`. */

  function esMovil() {
    return window.matchMedia(MEDIA_MOVIL).matches;
  }

  /** El "+" de agregar pueblo intermedio no existe (se oculta con CSS) y el
   *  botón de avión vive en la fila del origen, igual en móvil y escritorio:
   *  la fila del origen y la de cada pueblo intermedio quedan con un botón
   *  de 40px y los cuadros tienen el mismo ancho. */

  function reordenarAereoMovil() {
    const filaOrigen = document.getElementById('row-origen');
    const filaDestino = document.getElementById('row-destino');
    if (!el.btnAereo || !filaOrigen || !filaDestino) return;
    if (el.btnAereo.parentElement !== filaOrigen) filaOrigen.appendChild(el.btnAereo);
    if (el.btnFluvial && el.btnFluvial.parentElement !== filaOrigen) filaOrigen.appendChild(el.btnFluvial);
  }

  window.addEventListener('resize', reordenarAereoMovil);

  /** Indica si la pestaña activa del panel es "Descubre Colombia". */

  function estaEnPestanaDescubre() {
    if (esMovil()) {
      return el.appRoot && el.appRoot.getAttribute('data-mobile-tab') === 'descubre';
    }
    return Boolean(el.btnTabPanelDescubre && el.btnTabPanelDescubre.classList.contains('panel-tab--active'));
  }

  /** Tras calcular la ruta se ocultan los cuadros de origen y destino (aparece el botón "+"). */

  function sincronizarModoRutaMovil() {
    if (state.rutaActual) {
      el.appRoot.setAttribute('data-ruta-lista', 'true');
    } else {
      el.appRoot.removeAttribute('data-ruta-lista');
    }
  }

  // Estado del reposicionamiento en bloque de la interfaz inferior.
  // El bloque (cuadros de búsqueda, botones y barra de navegación) sube con
  // transform EXACTAMENTE lo que el teclado tapa del área visible. Así el panel
  // conserva su altura completa: el espacio en blanco sobre la barra inferior
  // se mantiene y las listas de opciones de TODOS los cuadros (origen, destino
  // y pueblos intermedios) pueden desplegarse sin cortarse.
  // (Con interactive-widget=resizes-content o VirtualKeyboard overlayContent
  // en falso, el panel se encoge con el teclado y las opciones quedan cortadas,
  // por eso el teclado se superpone y el bloque se levanta con transform).
  // SIN temporizadores ni transiciones: cada evento del teclado (visualViewport
  // o geometrychange) aplica el lift al instante, el bloque sigue la animación
  // del teclado y las listas abiertas se reposicionan en el mismo instante.

  function ponerEnCargaRuta(cargando, silencioso = false) {
    if (cargando) el.btnCalcular.disabled = true;
    el.btnCalcular.setAttribute('data-loading', cargando ? 'true' : 'false');
    if (el.btnAereo) el.btnAereo.disabled = cargando || !(state.origen && state.destino);
    if (el.btnFluvial) el.btnFluvial.disabled = cargando;
    // El spinner Monalisa no debe aparecer en la pestaña Descubre ni en recálculos
    // silenciosos (p. ej. al agregar un sitio a la ruta).
    if (el.loadingRuta) el.loadingRuta.hidden = !cargando || silencioso || estaEnPestanaDescubre();
    if (cargando && el.loadingSitios) el.loadingSitios.hidden = true;
    el.btnAgregarEscala.disabled = cargando;
    el.origenInput.disabled = cargando;
    el.destinoInput.disabled = cargando;
    document.querySelectorAll('.combo__trigger.escala-trigger').forEach((b) => { b.disabled = cargando; });
    document.querySelectorAll('.escala-row__calc').forEach((b) => {
      b.disabled = cargando;
      b.setAttribute('data-loading', cargando ? 'true' : 'false');
    });
    document.querySelectorAll('.escala-row__aereo').forEach((b) => { b.disabled = cargando; });
    document.querySelectorAll('.sitio-card__add').forEach((b) => { b.disabled = cargando; });
    if (esMovil()) {
      el.panelLocate.hidden = cargando;
      // El botón "Subir tu propia ruta" no debe verse mientras se calcula
      // (durante el spinner): se oculta igual que el panel de origen/destino.
      if (el.btnSubirRutaPropia) el.btnSubirRutaPropia.hidden = cargando;
      // El testigo "Mostrar sitios" se oculta solo mientras se carga; al terminar
      // su visibilidad la decide activarPanelTab/_habilitarMostrarSitios.
      if (cargando) el.btnMostrarSitiosCercanos.hidden = true;
      if (el.panelParadas) el.panelParadas.hidden = cargando;
    }
  }

  /** Sincroniza el botón flotante del mapa según haya o no listado en Descubre. */

  function _syncBotonSitios() {
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.hidden = state.sitiosFiltrados.length === 0;
  }


  function _habilitarMostrarSitios() {
    // Habilita la pestaña Descubre tras calcular una ruta.
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    if (el.icoDescubreTab) el.icoDescubreTab.hidden = true;
    if (el.icoDescubreTabDesktop) el.icoDescubreTabDesktop.hidden = true;
    if (el.sitiosContadorTab) el.sitiosContadorTab.hidden = false;
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.hidden = false;
    // El testigo "Mostrar sitios" solo aparece tras calcular la PRIMERA ruta
    // y luego se elimina para siempre.
    if (_soMostrarSitiosVisto) {
      el.btnMostrarSitiosCercanos.disabled = true;
      el.btnMostrarSitiosCercanos.hidden = true;
      return;
    }
    _soMostrarSitiosVisto = true;
    el.btnMostrarSitiosCercanos.disabled = false;
    el.btnMostrarSitiosCercanos.hidden = false;
  }


  function formatMunicipio(m) {
    if (!m || !m.nombre) return '';
    if (m.nombre === 'Bogotá D.C.' || !m.departamento) return m.nombre;
    return m.nombre + ', ' + m.departamento;
  }

  /** Sincroniza el botón redondo de "sitios visibles" con el modo de visibilidad actual. */

  function btnIcono(d) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'parada-item__btn';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
    return b;
  }

  // -------------------------------------------------------------------
  // Renderizar lista de paradas en el panel (escalas + sitios turísticos)
  // -------------------------------------------------------------------

  // ---------------------------------------------------------------------
  // Menú contextual de las filas de paradas (clic derecho / pulsación larga)
  // ---------------------------------------------------------------------

  function ponerEnCarga(boton, cargando) {
    boton.disabled = cargando;
    boton.setAttribute('data-loading', cargando ? 'true' : 'false');
  }

  /** Cambia el icono del botón de filtro entre retry y check. */

  // -------------------------------------------------------------------
  // Notificación toast simple, auto-descartable
  // -------------------------------------------------------------------


  function _mostrarNotificacion(texto) {
    const el = document.createElement('div');
    el.className = 'notificacion-toast';
    el.textContent = texto;
    // Anclada al contenedor del mapa (no a toda la ventana): queda centrada
    // sobre el mapa, sin importar el panel lateral, justo debajo de la barra
    // superior de distancia/tiempo.
    const contenedor = document.querySelector('.map-full') || document.body;
    Object.assign(el.style, {
      position: 'absolute',
      top: '48px', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--teal-500, #2f7a6b)', color: '#fff',
      padding: '6px 14px', borderRadius: '8px', zIndex: '10000',
      fontSize: '12.5px', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      transition: 'opacity 0.3s', pointerEvents: 'none',
      whiteSpace: 'nowrap',
    });
    contenedor.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
  }

  // -------------------------------------------------------------------
  // Marcación de tramos peligrosos (clic secundario → confirmación)
  // -------------------------------------------------------------------


  function onTramoMarcado(tramo) {
    _mostrarConfirmacionTramo(tramo);
  }


  function _mostrarConfirmacionTramo(tramo) {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog dialog--confirm">
        <p class="dialog__text">Estás a punto de marcar esta carretera como una vía destapada. ¿Estás seguro?</p>
        <div class="dialog__actions">
          <button type="button" class="dialog__btn dialog__btn--cancel" id="dialog-tramo-cancel">Cancelar</button>
          <button type="button" class="dialog__btn dialog__btn--save" id="dialog-tramo-confirm">Aceptar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#dialog-tramo-cancel').addEventListener('click', () => {
      tramo.limpiar();
      overlay.remove();
    });

    overlay.querySelector('#dialog-tramo-confirm').addEventListener('click', async () => {
      overlay.remove();
      const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
      const nuevaRuta = {
        id,
        nombre: 'Tramo destapado',
        descripcion: 'Ruta destapada, transitar con precaución',
        coordenadas: tramo.segmento || [tramo.punto, tramo.punto],
        mensaje: 'Ruta destapada, transitar con precaución',
        tipo: 'destapada',
        color: '#e5a000',
      };
      try {
        await RouteWarningsModule.agregarPersonalizada(nuevaRuta);
        _mostrarNotificacion('Tramo peligroso guardado');
      } catch (err) {
        console.error('Error al guardar tramo:', err);
        tramo.limpiar();
        return;
      }
      tramo.limpiar();
      if (state.rutaActual) {
        try {
          await calcularRutaPrincipal(true);
        } catch (err) {
          console.error('Error al recalcular ruta tras marcar tramo:', err);
        }
      }
    });

    function onKey(e) {
      if (e.key === 'Escape') { overlay.querySelector('#dialog-tramo-cancel').click(); document.removeEventListener('keydown', onKey); }
    }
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.dialog').addEventListener('click', (e) => e.stopPropagation());
    overlay.addEventListener('click', () => overlay.querySelector('#dialog-tramo-cancel').click());
  }

