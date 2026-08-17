/**
 * descubre.js
 * ---------------------------------------------------------------------------
 * Pestaña Descubre: filtrado progresivo de sitios turísticos, categorías,
 * orden, listado de tarjetas y su interacción con el mapa.
 * ---------------------------------------------------------------------------
 */

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
   *  origen y el destino. Al usarlo queda activo este toggle (el del orden
   *  alfabético pasa a inactivo). */
  function alternarOrdenSitios() {
    state.ordenActivo = 'extremo';
    state.ordenSitios = state.ordenSitios === 'origen' ? 'destino' : 'origen';
    aplicarOrdenSitios(state.ordenSitios);
  }

  /** Toggle 2 del menú Ordenar: alterna el orden alfabético entre A-Z y Z-A.
   *  Al usarlo queda activo este toggle (el de desde A/Z pasa a inactivo). */
  function alternarDireccionOrdenSitios() {
    state.ordenActivo = 'dir';
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
    el.categoriasGrid.innerHTML = '';
    const seleccionadas = new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase()));
    cats.sort((a, b) => {
      const an = (Array.isArray(a) ? a[0] : a).toLowerCase();
      const bn = (Array.isArray(b) ? b[0] : b).toLowerCase();
      const aSel = seleccionadas.has(an) ? 0 : 1;
      const bSel = seleccionadas.has(bn) ? 0 : 1;
      if (aSel !== bSel) return aSel - bSel;
      return an.localeCompare(bn, 'es');
    });
    cats.forEach((ent) => {
      const cat = Array.isArray(ent) ? ent[0] : ent;
      const n = Array.isArray(ent) ? ent[1] : 0;
      const chip = document.createElement('span');
      chip.className = 'categoria-chip';
      if (seleccionadas.has(cat.toLowerCase())) chip.classList.add('categoria-chip--selected');
      chip.textContent = n > 0 ? `${cat} (${n})` : cat;
      chip.addEventListener('click', () => toggleCategoria(cat));
      el.categoriasGrid.appendChild(chip);
    });
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
    if (state.sitiosFiltrados.length > 0) {
      if (silencioso) _syncBotonSitios();
      // Si el listado corresponde a otra ruta (ruta recalculada), se recalcula.
      if (_listadoParaGeojson === geojsonListado) return;
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
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
    if (el.buscarSitios) el.buscarSitios.value = '';
    _sincronizarBotonVisibles();
    _actualizarEstadoBotonesDescubre();
    _syncBotonSitios();
    if (el.panelSitios) el.panelSitios.hidden = true;
    if (el.sitiosVacio) el.sitiosVacio.textContent = '';
    if (el.sitiosContador) el.sitiosContador.textContent = '0';
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = '0';
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = '0';
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
    el.sitiosLista.innerHTML = '';
    const sitiosOrdenados = ordenarSitios(sitios);
    el.sitiosContador.textContent = String(sitiosOrdenados.length);
    if (el.sitiosContadorTab) el.sitiosContadorTab.textContent = String(sitiosOrdenados.length);
    if (el.sitiosContadorTabDesktop) el.sitiosContadorTabDesktop.textContent = String(sitiosOrdenados.length);
    // El botón flotante del mapa solo aparece cuando hay listado.
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.hidden = sitiosOrdenados.length === 0;

    if (sitiosOrdenados.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      _syncBotonSitios();
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
      el.sitiosLista.appendChild(crearTarjetaSitio(sitio, i));
    });
    _aplicarBusquedaSitios();
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

  /** Construye la tarjeta de un sitio en la lista, con acciones de previsualizar y agregar. */

  function crearTarjetaSitio(sitio, idx) {
    const esParada = state.paradas.some((p) => p.id === sitio.id);
    const li = Utils.crearElemento(`
      <li class="sitio-card${esParada ? ' sitio-card--active' : ''}" data-sitio-id="${sitio.id}">
        <div class="sitio-card__top">
          <span class="sitio-card__nombre"><span class="sitio-card__num">${idx != null ? (idx + 1) + '.' : ''}</span>&nbsp;${sitio.nombre}</span>
          <div class="sitio-card__top-right">
            <button type="button" class="icon-btn sitio-card__add${esParada ? ' sitio-card__add--quitar' : ''}" title="${esParada ? 'Quitar de la ruta' : 'Agregar a la ruta'}" aria-label="${esParada ? 'Quitar ' + sitio.nombre + ' de la ruta' : 'Agregar ' + sitio.nombre + ' a la ruta'}">
              <svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">${esParada ? '<path d="M6 12h12"/>' : '<path d="M12 5v14M5 12h14"/>'}</svg>
              <span class="icon-btn__spinner" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="sitio-card__meta">
          <span>${sitio.municipio}, ${sitio.departamento}</span>
          ${_textoDistanciaTarjeta(sitio)}
        </div>
        <p class="sitio-card__preview" hidden></p>
      </li>
    `);

    /** Texto de distancias de la tarjeta: distancia sobre la ruta desde el origen
   *  hasta el punto de desvío y, después, los datos del desvío (km y min). */
  function _textoDistanciaTarjeta(sitio) {
    const partes = [];
    if (sitio.distanciaOrigenDesvioKm != null) {
      partes.push(`${sitio.distanciaOrigenDesvioKm.toFixed(1)} km <span class="sitio-card__dist-note">(Distancia desde el origen hasta el punto de desvío)</span>`);
    }
    if (sitio.distanciaRutaKm != null) {
      partes.push(`desvío: ${sitio.distanciaRutaKm.toFixed(1)} km · ${Math.round(sitio.tiempoDesvioMin)} min`);
    }
    if (!partes.length) return '';
    return `<span class="mono">${partes.join(' · ')}</span>`;
  }

  const btnAdd = li.querySelector('.sitio-card__add');
    btnAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      if (esParada) {
        quitarSitioDeLaRuta(sitio, li, btnAdd);
      } else {
        agregarParada(sitio, btnAdd);
      }
    });

    li.addEventListener('click', () => previsualizarRutaHaciaSitio(sitio, li));

    return li;
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
