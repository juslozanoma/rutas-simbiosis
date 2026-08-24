/**
 * descubre.js
 * ---------------------------------------------------------------------------
 * Pestaña Descubre: filtrado progresivo de sitios turísticos, categorías,
 * orden, listado de tarjetas y su interacción con el mapa.
 * ---------------------------------------------------------------------------
 */

  let _tipSitiosFloatMostrado = false; // popup automático del icono flotante de sitios (una sola vez por sesión)
  let _sitiosRenderizados = [];        // última lista mostrada (ordenada), la lee React para renderizar las tarjetas
  let _categoriasChips = [];           // chips de categorías (ordenados), los lee React para el grid

  function ordenarSitios(sitios) {
    const lista = [...sitios];
    // Toggle activo "A-Z/Z-A": orden alfabético por nombre.
    if (state.ordenActivo === 'dir') {
      const dir = state.ordenDir === 'desc' ? -1 : 1;
      lista.sort((a, b) => dir * String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
      return lista;
    }
    // Toggle activo "Desde A/Z": distancia desde el extremo elegido (más cerca primero).
    if (state.ordenSitios === 'origen') {
      lista.sort((a, b) => (a.distanciaOrigenKm ?? a.distanciaRutaKm ?? Infinity) - (b.distanciaOrigenKm ?? b.distanciaRutaKm ?? Infinity));
    } else if (state.ordenSitios === 'destino') {
      lista.sort((a, b) => (a.distanciaDestinoKm ?? a.distanciaRutaKm ?? Infinity) - (b.distanciaDestinoKm ?? b.distanciaRutaKm ?? Infinity));
    }
    return lista;
  }


  function aplicarOrdenSitios(orden) {
    state.ordenSitios = orden;
    actualizarBotonesOrden();
    _actualizarTextoBotonesOrden();
    _actualizarEstadoBotonesDescubre();
    renderizarSitios(state.modoVisibilidad === 'visibles' ? _filtrarVisibles(state.sitiosFiltrados) : state.sitiosFiltrados);
  }

  /** Toggle 1 del menú Ordenar: alterna el extremo de referencia entre el
   *  origen y el destino. El primer clic desde el otro toggle solo activa este
   *  (mantiene el extremo actual); los clics siguientes alternan origen/destino. */
  function alternarOrdenSitios() {
    if (state.ordenActivo !== 'extremo') {
      state.ordenActivo = 'extremo';
      aplicarOrdenSitios(state.ordenSitios);
      return;
    }
    state.ordenSitios = state.ordenSitios === 'origen' ? 'destino' : 'origen';
    aplicarOrdenSitios(state.ordenSitios);
  }

  /** Toggle 2 del menú Ordenar: alterna el orden alfabético entre A-Z y Z-A.
   *  El primer clic desde el otro toggle solo activa este (mantiene la
   *  dirección actual); los clics siguientes alternan ascendente/descendente. */
  function alternarDireccionOrdenSitios() {
    if (state.ordenActivo !== 'dir') {
      state.ordenActivo = 'dir';
      aplicarOrdenSitios(state.ordenSitios);
      return;
    }
    state.ordenDir = state.ordenDir === 'asc' ? 'desc' : 'asc';
    aplicarOrdenSitios(state.ordenSitios);
  }


  function _filtrarVisibles(sitios) {
    const map = MapModule.getMap();
    if (!map) return sitios;
    const bounds = map.getBounds();
    return sitios.filter((s) => {
      const lat = Number(s.lat), lon = Number(s.lon);
      if (isNaN(lat) || isNaN(lon)) return false;
      return bounds.contains([lat, lon]);
    });
  }


  function obtenerCategoriasUnicas() {
    const mapa = new Map();
    state.sitios.forEach((s) => {
      const c = s.categoria ? s.categoria.trim() : '';
      if (!c) return;
      const key = c.toLowerCase();
      if (!mapa.has(key)) mapa.set(key, c);
    });
    return [...mapa.values()].sort((a, b) => a.length - b.length || a.localeCompare(b, 'es'));
  }


  function categoriasDeRuta() {
    if (!conteoCategoriasBase || conteoCategoriasBase.size === 0) return [];
    return [...conteoCategoriasBase.entries()]
      .filter(([, n]) => n > 0)
      .sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0], 'es'));
  }


  function renderizarCategoriasMenu(lista) {
    const cats = lista || categoriasDeRuta();
    // Los chips los renderiza React (CategoriasGrid, portal a #categorias-grid);
    // aquí solo se guarda el snapshot ordenado y se notifica al puente.
    const seleccionadas = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase()));
    cats.sort((a, b) => {
      const an = (Array.isArray(a) ? a[0] : a).toLowerCase();
      const bn = (Array.isArray(b) ? b[0] : b).toLowerCase();
      const aSel = seleccionadas.has(an) ? 0 : 1;
      const bSel = seleccionadas.has(bn) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return an.localeCompare(bn, 'es');
    });
    _categoriasChips = cats.map((ent) => {
      const cat = Array.isArray(ent) ? ent[0] : ent;
      const n = Array.isArray(ent) ? ent[1] : 0;
      return { cat, n, selected: seleccionadas.has(cat.toLowerCase()) };
    });
    _notificarCategorias();
  }


  function toggleCategoria(cat) {
    const idx = state.categoriasSeleccionadas.findIndex((c) => c.toLowerCase() === cat.toLowerCase());
    if (idx !== -1) {
      state.categoriasSeleccionadas.splice(idx, 1);
    } else {
      state.categoriasSeleccionadas.push(cat);
    }
    if (state.rutaActual) {
      ejecutarFiltrado();
    } else if (typeof _tourActivo !== 'undefined' && _tourActivo && typeof _mostrarSitiosTour === 'function') {
      // En el tour las categorías filtran los sitios del destino.
      _mostrarSitiosTour();
    }
  }

  // -------------------------------------------------------------------
  // Eventos generales
  // -------------------------------------------------------------------

  // Mobile tab switching (needed from both initEventos and calcularRutaPrincipal)

  function _asegurarListadoSitios(silencioso = false) {
    if (!state.rutaActual) { _syncBotonSitios(); return; }
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const geojsonListado = rutaFiltro ? rutaFiltro.geojson : null;
    // Si la ruta cambió desde que se calculó el listado, se invalidan las
    // distancias cacheadas (turf) y el listado para recalcularlos con el nuevo
    // trazado al abrir Descubre Colombia.
    if (_listadoParaGeojson !== geojsonListado) {
      state.sitios.forEach((s) => {
        delete s.distanciaRutaKm;
        delete s.tiempoDesvioMin;
        delete s.distanciaOrigenKm;
        delete s.distanciaDestinoKm;
        delete s.distanciaOrigenDesvioKm;
        delete s._offsetLado;
      });
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      _listadoParaGeojson = null;
    }
    if (state.sitiosFiltrados.length > 0) {
      if (silencioso) _syncBotonSitios();
      return;
    }
    if (_calculandoListado) {
      // Si quedó atascado (p. ej. cerraron la pestaña a mitad de carga) se reintenta.
      if (Date.now() - _calculandoListado > 30000) _calculandoListado = 0;
      else return;
    }
    _calculandoListado = Date.now();

    el.checkDistancia.checked = true;
    el.filtroDistancia.disabled = false;
    el.filtroDistancia.value = '5';
    _actualizarThumbValor(el.filtroDistancia, 'filtro-distancia-thumb', 'km');
    if (el.btnTabPanelDescubre) el.btnTabPanelDescubre.disabled = false;
    if (el.btnTabDescubre) el.btnTabDescubre.disabled = false;
    if (el.icoDescubreTab) el.icoDescubreTab.hidden = true;
    if (el.icoDescubreTabDesktop) el.icoDescubreTabDesktop.hidden = true;
    if (el.sitiosContadorTab) el.sitiosContadorTab.hidden = false;
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.hidden = false;
    _syncIndicadorDescubre();
    if (el.loadingRuta) el.loadingRuta.hidden = true;
    el.loadingSitios.hidden = false;
    if (!silencioso) el.panelSitios.hidden = false;
    ejecutarFiltradoProgresivo(() => {
      _calculandoListado = 0;
      _listadoParaGeojson = geojsonListado;
      el.loadingSitios.hidden = true;
      actualizarEstadoBotonesRetry();
      if (silencioso) {
        el.panelSitios.hidden = true;
        _syncBotonSitios();
      } else {
        el.panelSitios.hidden = false;
      }
    });
  }


  function _sincronizarBotonVisibles() {
    if (!el.btnDescubreVisibles) return;
    const activo = state.modoVisibilidad === 'visibles';
    el.btnDescubreVisibles.setAttribute('aria-pressed', String(activo));
    el.btnDescubreVisibles.classList.toggle('descubre-btn--active', activo);
  }

  /** Limpia el listado de la pestaña Descubre cuando cambia el trazado de la ruta. */

  function _borrarListadoDescubre() {
    state.sitiosFiltrados = [];
    state.sitiosFiltradosBase = [];
    state.modoVisibilidad = 'completa';
    conteoCategoriasBase = new Map();
    _sitiosRenderizados = [];
    if (el.buscarSitios) el.buscarSitios.value = '';
    _sincronizarBotonVisibles();
    _actualizarEstadoBotonesDescubre();
    _syncBotonSitios();
    _notificarListaSitios();
    if (el.panelSitios) el.panelSitios.hidden = true;
    if (el.sitiosVacio) el.sitiosVacio.textContent = '';
    if (el.sitiosContador) el.sitiosContador.textContent = '0';
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = '0';
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = '0';
    _syncIndicadorDescubre();
  }

  /** Alterna el filtro "solo sitios visibles": activo filtra, inactivo muestra la lista completa. */

  function toggleSitiosVisibles() {
    if (!state.rutaActual) return;

    if (state.modoVisibilidad === 'visibles') {
      state.modoVisibilidad = 'completa';
    } else {
      state.modoVisibilidad = 'visibles';
    }
    _sincronizarBotonVisibles();

    const fuente = state.sitiosFiltrados.length ? state.sitiosFiltrados : state.sitiosFiltradosBase;
    if (!fuente.length) {
      _asegurarListadoSitios();
      return;
    }
    if (state.modoVisibilidad === 'visibles') {
      renderizarSitios(_filtrarVisibles(fuente));
    } else {
      renderizarSitios(fuente);
    }
  }


  function ejecutarFiltrado() {
    if (!state.rutaActual) return;
    if (el.panelSitios.hidden) return;
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const usarDistancia = el.checkDistancia.checked || (state.categoriasSeleccionadas.length > 0 && !el.checkDistancia.checked && !el.checkTiempo.checked);
    const usarTiempo = el.checkTiempo.checked;
    if (!usarDistancia && !usarTiempo && state.categoriasSeleccionadas.length === 0) return;

    const opciones = {
      usarDistancia,
      usarTiempo,
      distanciaMaximaKm: usarDistancia ? Number(el.filtroDistancia.value) : 5,
      tiempoMaximoMin: usarTiempo ? Number(el.filtroTiempo.value) : 120,
      origen: state.origen,
      destino: state.destino,
      excluirIds: [],
    };
    const sitiosBase = FiltersModule.filtrarSitiosPorRuta(state.sitios, rutaFiltro.geojson, opciones);
    state.sitiosFiltradosBase = sitiosBase;
    conteoCategoriasBase = new Map();
    sitiosBase.forEach((s) => {
      if (!s.categoria) return;
      const c = s.categoria.trim();
      conteoCategoriasBase.set(c, (conteoCategoriasBase.get(c) || 0) + 1);
    });
    let sitiosResultado = sitiosBase;
    if (state.categoriasSeleccionadas.length > 0) {
      const catsNorm = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim()));
      sitiosResultado = sitiosBase.filter((s) => {
        const sc = (s.categoria || '').toLowerCase().trim();
        return catsNorm.has(sc);
      });
    }
    state.sitiosFiltrados = sitiosResultado;
    if (state.modoVisibilidad === 'visibles') {
      renderizarSitios(_filtrarVisibles(sitiosResultado));
    } else {
      renderizarSitios(sitiosResultado);
    }
    renderizarCategoriasMenu();
  }


  function ejecutarFiltradoProgresivo(completado) {
    function terminar() {
      clearInterval(intervaloMensajes);
      if (typeof completado === 'function') completado();
    }
    if (!state.rutaActual) { terminar(); return; }
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const TAMANO_BLOQUE = 150;
    const sitios = state.sitios.filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)));
    const idsExcluidos = new Set();
    const distanciaMax = Number(el.filtroDistancia.value);
    const bbox = FiltersModule.rutaBboxConMargen(rutaFiltro.geojson, distanciaMax);
    const resultados = [];
    const resultadosBase = [];
    const catsNorm = state.categoriasSeleccionadas.length > 0 ? new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim())) : null;
    // Distancias acumuladas de la ruta para calcular, por sitio, la distancia
    // desde el origen hasta su punto de desvío sin repetir el recorrido.
    const coordsAcumDesvio = FiltersModule.distanciasAcumuladasRuta(rutaFiltro.geojson);
    let idx = 0;
    let indiceMensaje = 0;
    const intervaloMensajes = setInterval(() => {
      indiceMensaje = (indiceMensaje + 1) % el.mensajesCarga.length;
      el.loadingMsg.textContent = el.mensajesCarga[indiceMensaje];
    }, 2000);

    function procesarBloque() {
      try {
        const fin = Math.min(idx + TAMANO_BLOQUE, sitios.length);
        for (let i = idx; i < fin; i++) {
          const s = sitios[i];
          if (idsExcluidos.has(s.id)) continue;
          if (FiltersModule.fueraDeBbox(s, bbox)) {
            s.distanciaRutaKm = Infinity;
            continue;
          }
          if (s.distanciaRutaKm == null) {
            s.distanciaRutaKm = FiltersModule.distanciaARuta(s, rutaFiltro.geojson);
            s.tiempoDesvioMin = FiltersModule.aproximarTiempoDesvio(s.distanciaRutaKm);
            s.distanciaOrigenDesvioKm = FiltersModule.distanciaOrigenPuntoDesvio(s, rutaFiltro.geojson, coordsAcumDesvio);
          }
          if (!isFinite(s.distanciaRutaKm)) continue;
          const usarDistanciaProg = el.checkDistancia.checked || (state.categoriasSeleccionadas.length > 0 && !el.checkDistancia.checked && !el.checkTiempo.checked);
          if (usarDistanciaProg && s.distanciaRutaKm > distanciaMax) continue;
          if (el.checkTiempo.checked && (s.tiempoDesvioMin ?? Infinity) > Number(el.filtroTiempo.value)) continue;
          if (s.distanciaOrigenKm == null) {
            s.distanciaOrigenKm = FiltersModule.distanciaAOrigen(s, state.origen);
          }
          if (s.distanciaDestinoKm == null) {
            s.distanciaDestinoKm = FiltersModule.distanciaADestino(s, state.destino);
          }
          resultadosBase.push(s);
          if (catsNorm) {
            const sc = (s.categoria || '').toLowerCase().trim();
            if (!catsNorm.has(sc)) continue;
          }
          resultados.push(s);
        }
        idx = fin;

        if (idx < sitios.length) {
          setTimeout(procesarBloque, 0);
        } else {
          clearInterval(intervaloMensajes);
          resultados.sort((a, b) => (a.distanciaDestinoKm ?? a.distanciaRutaKm) - (b.distanciaDestinoKm ?? b.distanciaRutaKm) || (b.distanciaOrigenKm ?? b.distanciaRutaKm) - (a.distanciaOrigenKm ?? a.distanciaRutaKm));
          conteoCategoriasBase = new Map();
          resultadosBase.forEach((s) => {
            if (!s.categoria) return;
            const c = s.categoria.trim();
            conteoCategoriasBase.set(c, (conteoCategoriasBase.get(c) || 0) + 1);
          });
          state.sitiosFiltradosBase = resultadosBase;
          state.sitiosFiltrados = resultados;
          if (state.modoVisibilidad === 'visibles') {
            renderizarSitios(_filtrarVisibles(resultados));
          } else {
            renderizarSitios(resultados);
          }
          renderizarCategoriasMenu();
          ultimosValoresAplicados.distancia = Number(el.filtroDistancia.value);
          actualizarEstadoBotonesRetry();
          completado();
        }
      } catch (e) {
        console.warn('Error en filtrado progresivo de sitios', e);
        terminar();
      }
    }

    setTimeout(procesarBloque, 30);
  }


  function actualizarEstadoBotonesRetry() {
    const distVal = Number(el.filtroDistancia.value);
    const tiempoVal = Number(el.filtroTiempo.value);
    el.btnAplicarDistancia.disabled = !el.checkDistancia.checked || distVal === ultimosValoresAplicados.distancia;
    el.btnAplicarTiempo.disabled = !el.checkTiempo.checked || tiempoVal === ultimosValoresAplicados.tiempo;
  }


  function aplicarFiltrosConSpinner(botonOrigenClic) {
    if (!state.rutaActual) return;
    if (botonOrigenClic === el.btnAplicarDistancia && !el.checkDistancia.checked) return;
    if (botonOrigenClic === el.btnAplicarTiempo && !el.checkTiempo.checked) return;
    ponerEnCarga(botonOrigenClic, true);
    setTimeout(() => {
      ejecutarFiltrado();
      if (botonOrigenClic === el.btnAplicarDistancia) ultimosValoresAplicados.distancia = Number(el.filtroDistancia.value);
      if (botonOrigenClic === el.btnAplicarTiempo) ultimosValoresAplicados.tiempo = Number(el.filtroTiempo.value);
      ponerEnCarga(botonOrigenClic, false);
      actualizarEstadoBotonesRetry();
    }, 15);
  }


  function renderizarSitios(sitios) {
    limpiarPreview();
    MapModule.limpiarSitios();
    // La lista de tarjetas la renderiza React (componente SitiosLista, portal a
    // #sitios-lista); aquí se guarda la lista ordenada y se notifica al puente.
    _sitiosRenderizados = ordenarSitios(sitios);
    const sitiosOrdenados = _sitiosRenderizados;
    el.sitiosContador.textContent = String(sitiosOrdenados.length);
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = String(sitiosOrdenados.length);
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = String(sitiosOrdenados.length);
    _syncIndicadorDescubre();
    // El botón flotante del mapa solo aparece cuando hay listado.
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.hidden = sitiosOrdenados.length === 0;
    // Aviso automático: la primera vez que se calcula el listado se muestra un
    // popup a la derecha del icono flotante indicando su función.
    if (sitiosOrdenados.length > 0 && !_tipSitiosFloatMostrado) {
      _mostrarTipSitiosFloat();
    }

    if (sitiosOrdenados.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      _syncBotonSitios();
      _notificarListaSitios();
      return;
    }

    el.sitiosVacio.hidden = true;
    el.sitiosLista.hidden = false;
    _syncBotonSitios();

    sitiosOrdenados.forEach((sitio, i) => {
      if (sitio.lat == null || sitio.lon == null || isNaN(Number(sitio.lat)) || isNaN(Number(sitio.lon))) return;
      const marker = TourismModule.crearMarcador(sitio, i + 1);
      // Viceversa: hover en marcador del mapa → destacar en perfil
      if (sitio._distKm != null) {
        marker.on('mouseover', () => { AltimetriaModule.mostrarHoverEn(sitio._distKm); });
        marker.on('mouseout', () => { AltimetriaModule.ocultarHover(); });
      }
      MapModule.agregarMarcadorSitio(marker);
    });
    _notificarListaSitios();
    _aplicarBusquedaSitios();
  }

  /** Aviso automático del icono flotante de mostrar/ocultar sitios: aparece la
   *  primera vez que se calcula el listado, a la derecha del icono, indicando
   *  su función, y desaparece solo a los 3 segundos (o antes si se toca). */
  function _mostrarTipSitiosFloat() {
    const btn = el.btnToggleSitiosFloat;
    if (!btn || btn.hidden) return;
    _tipSitiosFloatMostrado = true;
    const tip = document.createElement('div');
    tip.className = 'btn-mostrar-sitios-tip btn-mostrar-sitios-tip--derecha';
    tip.setAttribute('role', 'status');
    tip.innerHTML = '<span class="btn-mostrar-sitios-tip__texto">Muestra u oculta los sitios de la ruta</span>';
    document.body.appendChild(tip);
    const colocar = () => {
      const r = btn.getBoundingClientRect();
      const tr = tip.getBoundingClientRect();
      let left = r.right + 10;
      if (left + tr.width > window.innerWidth - 8) {
        left = r.left - tr.width - 10;
        tip.classList.remove('btn-mostrar-sitios-tip--derecha');
        tip.classList.add('btn-mostrar-sitios-tip--izquierda');
      }
      left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
      const top = Math.max(8, Math.min(r.top + r.height / 2 - tr.height / 2, window.innerHeight - tr.height - 8));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
    };
    colocar();
    const ocultar = () => {
      tip.classList.add('btn-mostrar-sitios-tip--oculto');
      setTimeout(() => tip.remove(), 400);
    };
    setTimeout(ocultar, 3000);
    btn.addEventListener('click', ocultar, { once: true });
    window.addEventListener('resize', ocultar, { once: true });
  }

  /** Filtra las tarjetas ya renderizadas según la caja de búsqueda del panel. */

  function _aplicarBusquedaSitios() {
    if (!el.buscarSitios) return;
    const q = (el.buscarSitios.value || '').trim().toLowerCase();
    const cards = el.sitiosLista.querySelectorAll('.sitio-card');
    if (!cards.length) return;
    let visibles = 0;
    cards.forEach((card) => {
      const texto = (card.textContent || '').toLowerCase();
      const coincide = !q || texto.includes(q);
      card.style.display = coincide ? '' : 'none';
      if (coincide) visibles++;
    });
    if (el.sitiosContador) el.sitiosContador.textContent = String(visibles);
    if (q && visibles === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio coincide con la búsqueda.';
      el.sitiosLista.hidden = true;
    } else {
      el.sitiosVacio.hidden = true;
      el.sitiosLista.hidden = false;
    }
  }

  // -------------------------------------------------------------------
  // Previsualización: ruta directa de origen a un sitio seleccionado
  // -------------------------------------------------------------------

  function previsualizarRutaHaciaSitio(sitio, cardEl) {
    if (state.previewSitioId === sitio.id) {
      limpiarPreview();
      TourismModule.ocultarPopupSitio();
      return;
    }
    limpiarPreview();
    MapModule.abrirPopupSitio(sitio.id);
    state.previewSitioId = sitio.id;
    marcarTarjetaActiva(cardEl);
  }


  function marcarTarjetaActiva(cardActiva) {
    el.sitiosLista.querySelectorAll('.sitio-card').forEach((card) => {
      card.classList.toggle('sitio-card--active', card === cardActiva);
    });
  }


  function limpiarPreview() {
    state.previewSitioId = null;
    TourismModule.ocultarPopupSitio();
    MapModule.limpiarRutaPreview();
    el.sitiosLista.querySelectorAll('.sitio-card').forEach((card) => {
      card.classList.remove('sitio-card--active');
      const preview = card.querySelector('.sitio-card__preview');
      if (preview) { preview.hidden = true; preview.innerHTML = ''; }
    });
  }

  // -------------------------------------------------------------------
  // Construcción de ruta con desvíos por carretera (OSRM para cada desvío)
  // -------------------------------------------------------------------

  // -------------------------------------------------------------------
  // Puente con React (lista de sitios de Descubre). Las tarjetas las
  // renderiza el componente SitiosLista (portal a #sitios-lista) leyendo
  // _sitiosRenderizados (la última lista mostrada, ya ordenada, para que la
  // numeración coincida con los marcadores del mapa). El resto del módulo
  // sigue siendo vanilla.
  // -------------------------------------------------------------------

  /** Pide a React que vuelva a renderizar las tarjetas de la lista. */
  function _notificarListaSitios() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarListaSitios === 'function') {
      window.SimbiosisUI.notificarListaSitios();
    }
  }

  /** Snapshot que React necesita para renderizar las tarjetas. */
  function _datosSitios() {
    return {
      sitios: _sitiosRenderizados,
      paradas: state.paradas,
    };
  }

  /** Pide a React que vuelva a renderizar los chips del grid de categorías. */
  function _notificarCategorias() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarCategorias === 'function') {
      window.SimbiosisUI.notificarCategorias();
    }
  }

  if (typeof window !== 'undefined' && window.SimbiosisUI) {
    window.SimbiosisUI.datosSitios = _datosSitios;
    /** Snapshot de los chips de categorías (ya ordenados) que React pinta. */
    window.SimbiosisUI.datosCategorias = () => _categoriasChips;
    /** Alterna una categoría desde el clic de un chip. */
    window.SimbiosisUI.toggleCategoriaDescubre = (cat) => toggleCategoria(cat);
  }
