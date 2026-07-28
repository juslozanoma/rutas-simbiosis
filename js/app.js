/**
 * app.js
 * ---------------------------------------------------------------------------
 * Punto de entrada de la aplicación. Coordina MapModule, RoutingModule,
 * TourismModule y FiltersModule, y controla el panel lateral fijo:
 *
 *   1. Resumen (distancia total / tiempo estimado) — se llena tras calcular.
 *   2. Origen + destino + botón "Calcular ruta" — el cálculo NUNCA ocurre
 *      antes de pulsar ese botón explícitamente.
 *   3. Dos filtros independientes (distancia y tiempo de desvío), cada uno
 *      con su checkbox de activación y su propio botón "Aplicar". Los
 *      sitios turísticos no se muestran hasta que se aplica un filtro.
 *   4. Lista de sitios resultantes (ordenada por cercanía al origen), con
 *      scroll propio. Cada tarjeta permite:
 *        - clic en la tarjeta: previsualizar en el mapa, en azul continuo,
 *          la ruta desde el punto de la vía principal donde se produce el
 *          desvío hasta ese sitio (sin alterar la ruta principal).
 *        - clic en el botón "+": agregar el sitio como parada de la ruta
 *          principal, que se recalcula pasando por todas las paradas
 *          agregadas en orden; la lista de candidatos se refresca contra
 *          esa nueva ruta.
 *
 * No se usan mensajes flotantes de carga: la única señal de "procesando"
 * es un pequeño spinner dentro del propio botón o tarjeta que se pulsó.
 * ---------------------------------------------------------------------------
 */
(() => {

  const PERFIL_FIJO = 'driving';
  const MEDIA_MOVIL = '(max-width: 860px)';
  const CAPITALES = {
    'Amazonas':'Leticia','Antioquia':'Medellín','Arauca':'Arauca','Atlántico':'Barranquilla',
    'Bogotá D.C.':'Bogotá D.C.','Bolívar':'Cartagena','Boyacá':'Tunja','Caldas':'Manizales',
    'Caquetá':'Florencia','Casanare':'Yopal','Cauca':'Popayán','Cesar':'Valledupar',
    'Chocó':'Quibdó','Córdoba':'Montería','Cundinamarca':'Bogotá D.C.','Guainía':'Puerto Inírida',
    'Guaviare':'San José del Guaviare','Huila':'Neiva','La Guajira':'Riohacha','Magdalena':'Santa Marta',
    'Meta':'Villavicencio','Nariño':'Pasto','Norte de Santander':'Cúcuta','Putumayo':'Mocoa',
    'Quindío':'Armenia','Risaralda':'Pereira','San Andrés y Providencia':'San Andrés',
    'Santander':'Bucaramanga','Sucre':'Sincelejo','Tolima':'Ibagué','Valle del Cauca':'Cali',
    'Vaupés':'Mitú','Vichada':'Puerto Carreño',
  };

  /** Estado centralizado de la aplicación. */
  const state = {
    municipios: [],
    sitios: [],
    origen: null,
    destino: null,
    escalas: [],          // municipios intermedios (recalculan ruta + turf)
    orden: [],            // orden combinado de escalas + paradas para visualización
    rutaBase: null,
    rutaActual: null,
    paradas: [],
    sitiosFiltrados: [],
    sitiosFiltradosBase: [],
    ordenSitios: null,
    previewSitioId: null,
    categoriasSeleccionadas: [],
    categoriasUnicas: [],
  };

  // -------------------------------------------------------------------
  // Referencias DOM
  // -------------------------------------------------------------------
  const el = {
    appRoot: document.getElementById('app'),

    statDistancia: document.getElementById('stat-distancia'),
    statTiempo: document.getElementById('stat-tiempo'),

    origenInput: document.getElementById('origen-input'),
    destinoInput: document.getElementById('destino-input'),
    origenList: document.getElementById('origen-list'),
    destinoList: document.getElementById('destino-list'),
    btnCalcular: document.getElementById('btn-calcular'),

    checkAutoOrganizar: document.getElementById('check-auto-organizar'),

    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    filtroDistanciaValor: document.getElementById('filtro-distancia-valor'),
    sitiosVacio: document.getElementById('sitios-vacio'),
    sitiosLista: document.getElementById('sitios-lista'),
    sitiosContador: document.getElementById('sitios-contador'),
    btnOrdenAz: document.getElementById('btn-orden-az'),
    btnOrdenZa: document.getElementById('btn-orden-za'),

    panelParadas: document.getElementById('panel-paradas'),
    paradasLista: document.getElementById('paradas-lista'),
    paradasContador: document.getElementById('paradas-contador'),

    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    filtroDistanciaValor: document.getElementById('filtro-distancia-valor'),
    btnAplicarDistancia: document.getElementById('btn-aplicar-distancia'),

    checkTiempo: document.getElementById('check-tiempo'),
    filtroTiempo: document.getElementById('filtro-tiempo'),
    filtroTiempoValor: document.getElementById('filtro-tiempo-valor'),
    btnAplicarTiempo: document.getElementById('btn-aplicar-tiempo'),

    btnCategorias: document.getElementById('btn-categorias'),
    panelCategorias: document.getElementById('panel-categorias'),
    btnDesvios: document.getElementById('btn-desvios'),
    panelDesvios: document.getElementById('panel-desvios'),
    categoriasGrid: document.getElementById('categorias-grid'),


    panelEscalas: document.getElementById('panel-escalas'),
    btnAgregarEscala: document.getElementById('btn-agregar-escala'),

    btnToggleSitiosFloat: document.getElementById('btn-toggle-sitios-float'),
    btnFullscreen: document.getElementById('btn-fullscreen'),
    panelSitios: document.getElementById('panel-sites'),
    btnMostrarSitiosCercanos: document.getElementById('btn-mostrar-sitios'),

    statDistanciaMobile: document.getElementById('stat-distancia-mobile'),
    statTiempoMobile: document.getElementById('stat-tiempo-mobile'),
    sitiosContadorTab: document.getElementById('sitios-contador-tab'),
    btnTabDescubre: document.getElementById('btn-tab-descubre'),
    btnTabRuta: document.getElementById('btn-tab-ruta'),
    mobileTabBar: document.getElementById('mobile-tab-bar'),
    hintParadas: document.getElementById('hint-paradas'),
  };

  const LETRAS_RUTA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  function etiquetaIntermedia(idx) {
    return LETRAS_RUTA[Math.min(idx + 1, LETRAS_RUTA.length - 2)];
  }

  function ordenarSitios(sitios) {
    const lista = [...sitios];
    if (state.ordenSitios === 'az') {
      lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));
    } else if (state.ordenSitios === 'za') {
      lista.sort((a, b) => (b.nombre || '').localeCompare(a.nombre || '', 'es', { sensitivity: 'base' }));
    }
    return lista;
  }

  function actualizarBotonesOrden() {
    if (!el.btnOrdenAz || !el.btnOrdenZa) return;
    el.btnOrdenAz.setAttribute('aria-pressed', String(state.ordenSitios === 'az'));
    el.btnOrdenZa.setAttribute('aria-pressed', String(state.ordenSitios === 'za'));
  }

  function aplicarOrdenSitios(orden) {
    state.ordenSitios = orden;
    actualizarBotonesOrden();
    renderizarSitios(state.sitiosFiltrados);
  }

  // -------------------------------------------------------------------
  // Inicialización
  // -------------------------------------------------------------------
  async function init() {
    MapModule.init('map');
    MapModule.setOnEliminarParada(eliminarParada);
    TourismModule.setOnAgregarParada((sitio, btn) => agregarParada(sitio, btn));

    try {
      const [municipios, sitios] = await Promise.all([
        TourismModule.cargarMunicipios(),
        TourismModule.cargarSitios(),
      ]);
      state.municipios = municipios;
      state.sitios = sitios;
    } catch (err) {
      el.sitiosVacio.textContent = 'Error cargando los datos base: ' + err.message;
      return;
    }

    initCombos();
    state.categoriasUnicas = obtenerCategoriasUnicas();
    renderizarCategoriasMenu();
    initEscalas();
    initEventos();
    garantizarVisibilidadMovil();
  }

  // -------------------------------------------------------------------
  // Combos de búsqueda (origen / destino)
  // -------------------------------------------------------------------
  function initCombos() {
    setupCombo(el.origenInput, el.origenList, (m) => { state.origen = m; actualizarEstadoBotonCalcular(); }, () => {
      const ids = new Set();
      if (state.destino?.id) ids.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, true);
    setupCombo(el.destinoInput, el.destinoList, (m) => { state.destino = m; actualizarEstadoBotonCalcular(); }, () => {
      const ids = new Set();
      if (state.origen?.id) ids.add(state.origen.id);
      state.escalas.forEach((e) => { if (e.id != null) ids.add(e.id); });
      return ids;
    }, false);
  }

  function setupCombo(trigger, listEl, onSelect, excluirIdsFn, showCurrentLocation) {
    const combo = trigger.parentElement;
    let deptoSeleccionado = null;

    function obtenerDepartamentos() {
      return [...new Set(state.municipios.map((m) => m.departamento))].sort((a, b) => {
        if (a === 'Córdoba' && b === 'Cundinamarca') return -1;
        if (a === 'Cundinamarca' && b === 'Córdoba') return 1;
        return a.localeCompare(b, 'es');
      });
    }

    function obtenerMunicipios(depto) {
      const capitalNombre = CAPITALES[depto];
      const lista = state.municipios
        .filter((m) => m.departamento === depto)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      if (capitalNombre) {
        const capitalIdx = lista.findIndex((m) => m.nombre === capitalNombre);
        if (capitalIdx > 0) {
          const capital = lista.splice(capitalIdx, 1)[0];
          lista.unshift(capital);
        }
      }
      return lista;
    }

    function renderDepartamentos() {
      deptoSeleccionado = null;
      listEl.innerHTML = '';

      if (showCurrentLocation) {
        const locLi = document.createElement('li');
        locLi.textContent = 'Ubicación actual';
        locLi.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          ponerEnCargaRuta(true);
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const { latitude: lat, longitude: lon } = pos.coords;
              const nombre = 'Mi ubicación';
              const txt = trigger.querySelector('.combo__trigger-text');
              txt.textContent = nombre;
              txt.removeAttribute('data-placeholder');
              trigger.setAttribute('aria-label', 'Ubicación actual');
              onSelect({ id: 'gps_' + Date.now(), lat, lon, nombre, departamento: '' });
              ponerEnCargaRuta(false);
            },
            () => {
              ponerEnCargaRuta(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
          );
        });
        listEl.appendChild(locLi);
      }

      const pickLi = document.createElement('li');
      pickLi.textContent = 'Seleccionar en el mapa';
      pickLi.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.hidden = true;
        iniciarSeleccionMapa((lat, lon) => {
          const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          const txt = trigger.querySelector('.combo__trigger-text');
          txt.textContent = nombre;
          txt.removeAttribute('data-placeholder');
          trigger.setAttribute('aria-label', 'Punto en el mapa');
          onSelect({ id: 'map_' + Date.now(), lat, lon, nombre, departamento: '' });
        });
      });
      listEl.appendChild(pickLi);
      const deptos = obtenerDepartamentos();
      deptos.forEach((d) => {
        const li = document.createElement('li');
        li.textContent = d;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          deptoSeleccionado = d;
          const idsExcluidos = excluirIdsFn ? excluirIdsFn() : new Set();
          const municipios = obtenerMunicipios(d).filter((m) => !idsExcluidos.has(m.id));
          if (municipios.length === 1) {
            const m = municipios[0];
            listEl.hidden = true;
            const txt = trigger.querySelector('.combo__trigger-text');
            txt.textContent = m.nombre;
            txt.removeAttribute('data-placeholder');
            trigger.setAttribute('aria-label', m.nombre + ' — municipio de ' + m.departamento);
            onSelect(m);
          } else {
            renderMunicipios();
          }
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
    }

    function renderMunicipios() {
      listEl.innerHTML = '';
      const back = document.createElement('li');
      back.className = 'combo__back';
      back.textContent = '← Volver';
      back.addEventListener('click', (e) => {
        e.stopPropagation();
        renderDepartamentos();
      });
      listEl.appendChild(back);

      const idsExcluidos = excluirIdsFn ? excluirIdsFn() : new Set();
      const municipios = obtenerMunicipios(deptoSeleccionado).filter((m) => !idsExcluidos.has(m.id));
      municipios.forEach((m) => {
        const li = document.createElement('li');
        li.textContent = m.nombre;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          const txt = trigger.querySelector('.combo__trigger-text');
          txt.textContent = m.nombre;
          txt.removeAttribute('data-placeholder');
          trigger.setAttribute('aria-label', m.nombre + ' — municipio de ' + m.departamento);
          onSelect(m);
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
    }

    function cerrar() {
      listEl.hidden = true;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (listEl.hidden) {
        renderDepartamentos();
      } else {
        cerrar();
      }
    });

    document.addEventListener('click', (e) => {
      if (!combo.contains(e.target)) cerrar();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrar();
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (listEl.hidden) renderDepartamentos();
        else cerrar();
      }
    });
  }

  function actualizarEstadoBotonCalcular() {
    el.btnCalcular.disabled = !(state.origen && state.destino);
  }

  /** Activa modo de selección en el mapa: el usuario hace clic y se llama a `callback(lat, lon)`. */
  function iniciarSeleccionMapa(callback) {
    const map = MapModule.getMap();
    const container = map.getContainer();
    container.style.cursor = 'crosshair';
    const tooltip = L.tooltip({ permanent: true, direction: 'center', className: 'route-tooltip' })
      .setLatLng(map.getCenter())
      .setContent('Haz clic en el mapa para seleccionar')
      .addTo(map);
    function onClick(e) {
      map.off('click', onClick);
      container.style.cursor = '';
      map.removeLayer(tooltip);
      callback(e.latlng.lat, e.latlng.lng);
    }
    map.on('click', onClick);
  }

  // -------------------------------------------------------------------
  // Escalas: municipios intermedios entre origen y destino
  // -------------------------------------------------------------------
  function initEscalas() {
    el.btnAgregarEscala.addEventListener('click', () => agregarEscala());
  }

  function agregarEscala() {
    const row = document.createElement('div');
    row.className = 'escala-row';

    const combo = document.createElement('div');
    combo.className = 'combo';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'combo__trigger escala-trigger';
    trigger.innerHTML = '<span class="combo__trigger-text" data-placeholder="true">Pueblo intermedio</span>'
      + '<svg class="combo__chevron" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>';
    const listEl = document.createElement('ul');
    listEl.className = 'combo__list';
    listEl.role = 'listbox';
    listEl.hidden = true;
    combo.appendChild(trigger);
    combo.appendChild(listEl);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'escala-row__remove';
    removeBtn.title = 'Quitar';
    removeBtn.textContent = '×';

    row.appendChild(combo);
    row.appendChild(removeBtn);
    el.panelEscalas.appendChild(row);

    let seleccion = null;

    function renderDeptos() {
      seleccion = null;
      listEl.innerHTML = '';
      const pickLi = document.createElement('li');
      pickLi.textContent = 'Seleccionar en el mapa';
      pickLi.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.hidden = true;
        iniciarSeleccionMapa((lat, lon) => {
          const nombre = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
          trigger.querySelector('.combo__trigger-text').textContent = nombre;
          trigger.querySelector('.combo__trigger-text').removeAttribute('data-placeholder');
          seleccion = { id: 'map_' + Date.now(), lat, lon, nombre, departamento: '' };
          actualizarEscalas();
        });
      });
      listEl.appendChild(pickLi);
      const deptos = [...new Set(state.municipios.map((m) => m.departamento))].sort((a, b) => {
        if (a === 'Córdoba' && b === 'Cundinamarca') return -1;
        if (a === 'Cundinamarca' && b === 'Córdoba') return 1;
        return a.localeCompare(b, 'es');
      });
      deptos.forEach((d) => {
        const li = document.createElement('li');
        li.textContent = d;
        li.addEventListener('click', (e) => { e.stopPropagation(); renderMunicipios(d); });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
    }
    function renderMunicipios(depto) {
      listEl.innerHTML = '';
      const back = document.createElement('li');
      back.className = 'combo__back';
      back.textContent = '← Volver';
      back.addEventListener('click', (e) => { e.stopPropagation(); renderDeptos(); });
      listEl.appendChild(back);
      const idsNoDisponibles = new Set();
      if (state.origen?.id) idsNoDisponibles.add(state.origen.id);
      if (state.destino?.id) idsNoDisponibles.add(state.destino.id);
      state.escalas.forEach((e) => { if (e.id != null && e._row !== row) idsNoDisponibles.add(e.id); });
      const muns = state.municipios.filter((m) => m.departamento === depto && !idsNoDisponibles.has(m.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
      const capNombre = CAPITALES[depto];
      const capIdx = capNombre ? muns.findIndex((m) => m.nombre === capNombre) : -1;
      if (capIdx > 0) { const cap = muns.splice(capIdx, 1)[0]; muns.unshift(cap); }
      muns.forEach((m) => {
        const li = document.createElement('li');
        li.textContent = m.nombre;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          trigger.querySelector('.combo__trigger-text').textContent = m.nombre;
          trigger.querySelector('.combo__trigger-text').removeAttribute('data-placeholder');
          seleccion = m;
          actualizarEscalas();
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (listEl.hidden) renderDeptos(); else listEl.hidden = true;
    });
    document.addEventListener('click', function onClickOutside(e) {
      if (!row.contains(e.target)) listEl.hidden = true;
    });
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') listEl.hidden = true;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (listEl.hidden) renderDeptos(); else listEl.hidden = true; }
    });

    removeBtn.addEventListener('click', () => {
      const idx = state.escalas.findIndex((e) => e._row === row);
      if (idx !== -1) {
        const e = state.escalas[idx];
        state.escalas.splice(idx, 1);
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
          calcularRutaPrincipal(true);
        }
      }
      row.remove();
      actualizarEstadoBotonCalcular();
    });

    state.escalas.push({ _row: row });
  }

  async function actualizarEscalas() {
    state.escalas.forEach((e) => {
      if (!e._row) return;
      const txt = e._row.querySelector('.combo__trigger-text');
      if (!txt || txt.hasAttribute('data-placeholder')) return;
      const nombre = txt.textContent;
      const m = state.municipios.find((mun) => mun.nombre === nombre);
      if (m) {
        Object.assign(e, m);
      } else {
        const partes = nombre.split(',').map((s) => parseFloat(s.trim()));
        if (partes.length === 2 && !isNaN(partes[0]) && !isNaN(partes[1])) {
          Object.assign(e, { id: 'map_' + Date.now(), lat: partes[0], lon: partes[1], nombre, departamento: '' });
        }
      }
    });
    actualizarEstadoBotonCalcular();
    if (state.origen && state.destino && state.escalas.some((e) => e._row && e.id != null)) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      conteoCategoriasBase = new Map();
      renderizarSitios([]);
      renderizarCategoriasMenu();
      el.loadingMsg.textContent = 'Calculando nueva ruta…';
      if (el.spinnerBike) el.spinnerBike.hidden = true;
      if (el.spinnerPacmanWrap) el.spinnerPacmanWrap.hidden = false;
      el.loadingSitios.hidden = false;
      let idxMsg = 0;
      const msgs = ['Calculando nueva ruta…', 'Espera un poco más, estamos ajustando detalles…'];
      const intervalo = setInterval(() => {
        idxMsg = (idxMsg + 1) % msgs.length;
        el.loadingMsg.textContent = msgs[idxMsg];
      }, 2000);
      try {
        if (el.checkAutoOrganizar.checked) {
          await organizarAutomaticamente();
        } else {
          await calcularRutaPrincipal(true);
        }
        refiltrarSitios();
      } finally {
        clearInterval(intervalo);
        el.loadingSitios.hidden = true;
        if (el.spinnerBike) el.spinnerBike.hidden = false;
        if (el.spinnerPacmanWrap) el.spinnerPacmanWrap.hidden = true;
      }
    }
  }

  // -------------------------------------------------------------------
  // Categorías: extracción, menú flotante y filtrado
  // -------------------------------------------------------------------
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
    if (state.rutaActual) ejecutarFiltrado();
  }

  // -------------------------------------------------------------------
  // Eventos generales
  // -------------------------------------------------------------------
  function initEventos() {
    el.btnCalcular.addEventListener('click', calcularRutaPrincipal);

    function toggleSitiosHandler() {
      const visible = MapModule.toggleSitios();
      if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.setAttribute('aria-pressed', String(visible));
    }
    if (el.btnToggleSitiosFloat) el.btnToggleSitiosFloat.addEventListener('click', toggleSitiosHandler);

    if (el.btnFullscreen) {
      el.btnFullscreen.addEventListener('click', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
          el.btnFullscreen.setAttribute('aria-pressed', 'false');
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
          el.btnFullscreen.setAttribute('aria-pressed', 'true');
        }
      });
      document.addEventListener('fullscreenchange', () => {
        el.btnFullscreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
      });
    }

    function setMobileTab(tab) {
      el.appRoot.setAttribute('data-mobile-tab', tab);
      el.btnTabDescubre.classList.toggle('mobile-tab-btn--active', tab === 'descubre');
      el.btnTabRuta.classList.toggle('mobile-tab-btn--active', tab === 'ruta');
      if (tab === 'descubre' && el.btnMostrarSitiosCercanos && el.btnMostrarSitiosCercanos.parentNode) {
        el.btnMostrarSitiosCercanos.click();
      }
      setTimeout(() => MapModule.invalidateSize(), 220);
    }
    el.btnTabDescubre.addEventListener('click', () => setMobileTab('descubre'));
    el.btnTabRuta.addEventListener('click', () => setMobileTab('ruta'));
    el.checkAutoOrganizar.addEventListener('change', () => {
      if (el.checkAutoOrganizar.checked) organizarAutomaticamente();
    });
    function togglePanel(btn, panel, otroBtn, otroPanel) {
      const seAbre = panel.hidden;
      panel.hidden = !seAbre;
      btn.setAttribute('aria-pressed', String(seAbre));
      if (seAbre) {
        otroPanel.hidden = true;
        otroBtn.setAttribute('aria-pressed', 'false');
      }
    }
    el.btnCategorias.addEventListener('click', () => togglePanel(el.btnCategorias, el.panelCategorias, el.btnDesvios, el.panelDesvios));
    el.btnDesvios.addEventListener('click', () => togglePanel(el.btnDesvios, el.panelDesvios, el.btnCategorias, el.panelCategorias));
    if (el.btnOrdenAz) el.btnOrdenAz.addEventListener('click', () => aplicarOrdenSitios('az'));
    if (el.btnOrdenZa) el.btnOrdenZa.addEventListener('click', () => aplicarOrdenSitios('za'));
    actualizarBotonesOrden();
    el.loadingSitios = document.getElementById('loading-sitios');
    el.loadingMsg = el.loadingSitios.querySelector('.loading-sitios__msg');
    el.spinnerBike = el.loadingSitios.querySelector('.spinner-bike');
    el.spinnerPacmanWrap = el.loadingSitios.querySelector('.spinner-pacman-wrap');
    el.mensajesCarga = [
      'Cargando lugares cercanos…',
      'Buscando sitios turísticos…',
      'Calculando distancias…',
      'Preparando resultados…',
      'Casi listo…',
    ];
    el.btnMostrarSitiosCercanos.addEventListener('click', () => {
      el.btnMostrarSitiosCercanos.remove();
      if (el.hintParadas) el.hintParadas.hidden = true;
      el.checkDistancia.checked = true;
      el.filtroDistancia.disabled = false;
      el.filtroDistancia.value = '5';
      el.filtroDistanciaValor.textContent = '5 km';
      el.loadingSitios.hidden = false;
      ejecutarFiltradoProgresivo(() => {
        el.panelSitios.hidden = false;
        if (el.panelDesvios) {
          el.panelDesvios.hidden = false;
          el.btnDesvios.setAttribute('aria-pressed', 'true');
        }
        if (el.panelCategorias) {
          el.panelCategorias.hidden = true;
          el.btnCategorias.setAttribute('aria-pressed', 'false');
        }
        actualizarEstadoBotonesRetry();
        el.loadingSitios.hidden = true;
        setTimeout(() => cargarFondoSitios(), 100);
        if (esMovil()) {
          setMobileTab('descubre');
        }
      });
    });
    el.btnAplicarDistancia.addEventListener('click', () => aplicarFiltrosConSpinner(el.btnAplicarDistancia));
    el.btnAplicarTiempo.addEventListener('click', () => aplicarFiltrosConSpinner(el.btnAplicarTiempo));

    el.checkDistancia.addEventListener('change', () => {
      el.filtroDistancia.disabled = !el.checkDistancia.checked;
      actualizarEstadoBotonesRetry();
    });
    el.checkTiempo.addEventListener('change', () => {
      el.filtroTiempo.disabled = !el.checkTiempo.checked;
      actualizarEstadoBotonesRetry();
    });
    el.filtroDistancia.addEventListener('input', () => {
      el.filtroDistanciaValor.textContent = `${el.filtroDistancia.value} km`;
      actualizarEstadoBotonesRetry();
    });
    el.filtroTiempo.addEventListener('input', () => {
      el.filtroTiempoValor.textContent = `${el.filtroTiempo.value} min`;
      actualizarEstadoBotonesRetry();
    });

  }
  // -------------------------------------------------------------------
  // Vista móvil: alternar entre panel completo y mapa completo
  // -------------------------------------------------------------------
  function esMovil() {
    return window.matchMedia(MEDIA_MOVIL).matches;
  }

  function garantizarVisibilidadMovil() {
    if (esMovil()) {
      if (el.mobileTabBar) el.mobileTabBar.removeAttribute('hidden');
      if (el.btnMostrarSitiosCercanos) el.btnMostrarSitiosCercanos.removeAttribute('hidden');
      setTimeout(() => MapModule.invalidateSize(), 50);
    }
  }

  window.addEventListener('resize', garantizarVisibilidadMovil);

  let ultimosValoresAplicados = { distancia: null, tiempo: null };
  let conteoCategoriasBase = null;

  /** Habilita/deshabilita todos los controles de entrada durante el cálculo de ruta. */
  function ponerEnCargaRuta(cargando) {
    if (cargando) el.btnCalcular.disabled = true;
    el.btnCalcular.setAttribute('data-loading', cargando ? 'true' : 'false');
    el.btnAgregarEscala.disabled = cargando;
    el.origenInput.disabled = cargando;
    el.destinoInput.disabled = cargando;
    document.querySelectorAll('.combo__trigger.escala-trigger').forEach((b) => { b.disabled = cargando; });
    document.querySelectorAll('.sitio-card__add').forEach((b) => { b.disabled = cargando; });
  }

  // -------------------------------------------------------------------
  // Cálculo de la ruta principal (solo al pulsar el botón)
  // -------------------------------------------------------------------
  async function calcularRutaPrincipal(conservarParadas = false) {
    if (!state.origen || !state.destino) return;

    if (state.origen.id === state.destino.id) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'El origen y el destino deben ser municipios diferentes.';
      el.sitiosLista.hidden = true;
      return;
    }

    // Una nueva ruta principal invalida cualquier parada agregada previamente
    // (excepto cuando se reordenan escalas, que deben conservarse).
    if (!conservarParadas) {
      state.paradas = [];
      state.sitios.forEach((s) => {
        delete s._detourCoords;
        delete s._detourDist;
        delete s._detourDur;
        delete s.distanciaRutaKm;
        delete s.tiempoDesvioMin;
        delete s.distanciaOrigenKm;
        delete s.distanciaDestinoKm;
        delete s._offsetLado;
      });
      MapModule.limpiarSitios();
      MapModule.limpiarParadas();
      MapModule.limpiarEscalas();
      limpiarPreview();
      el.panelSitios.hidden = true;
      if (el.panelDesvios) el.panelDesvios.hidden = true;
      if (el.btnDesvios) el.btnDesvios.setAttribute('aria-pressed', 'false');
      if (el.panelCategorias) el.panelCategorias.hidden = true;
      if (el.btnCategorias) el.btnCategorias.setAttribute('aria-pressed', 'false');
      state.sitiosFiltrados = [];
      state.sitiosFiltradosBase = [];
      state.categoriasSeleccionadas = [];
      conteoCategoriasBase = new Map();
      // Re-insertar el botón "Mostrar sitios" si fue removido del DOM
      if (!el.btnMostrarSitiosCercanos.parentNode) {
        el.loadingSitios.parentNode.insertBefore(el.btnMostrarSitiosCercanos, el.loadingSitios);
      }
      el.btnMostrarSitiosCercanos.disabled = false;
    }

    ponerEnCargaRuta(true);

    try {
      const puntosRuta = [state.origen, ...state.escalas.filter((e) => e.lat != null), state.destino];
      const usarConParadas = puntosRuta.length > 2;
      const ruta = usarConParadas
        ? await RoutingModule.calcularRutaConParadas(puntosRuta, PERFIL_FIJO)
        : await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);
      aplicarRutaCalculada(ruta);
      // Limpia las filas de escala del DOM (pasan a la lista de paradas)
      state.escalas.forEach((e) => { if (e._row && e._row.parentNode) e._row.remove(); });
      state.escalas.forEach((e) => { delete e._row; });
      renderizarParadas();
      el.btnMostrarSitiosCercanos.disabled = false;

      el.checkDistancia.checked = true;
      el.filtroDistancia.value = '5';
      el.filtroDistanciaValor.textContent = '5 km';
      el.filtroDistancia.disabled = false;

      // Volver a la pestaña Ruta en móvil y reiniciar estado de sitios
      if (esMovil()) setMobileTab('ruta');

      // En dispositivos móviles, calcular la ruta pone toda la página en
      // pantalla completa (modo nativo del navegador) sin ocultar el panel.
      if (esMovil() && !document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }

    } catch (err) {
      el.statDistancia.textContent = '—';
      el.statTiempo.textContent = '—';
      if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = '—';
      if (el.statTiempoMobile) el.statTiempoMobile.textContent = '—';
    } finally {
      ponerEnCargaRuta(false);
    }
  }

  async function aplicarRutaCalculada(ruta) {
    state.rutaBase = ruta;
    await aplicarRutaConDesvios();
  }

  // -------------------------------------------------------------------
  // Filtro espacial + render de sitios sobre el mapa (solo al aplicar)
  // -------------------------------------------------------------------
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
      excluirIds: state.paradas.map((p) => p.id),
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
    renderizarSitios(sitiosResultado);
    renderizarCategoriasMenu();
  }

  function ejecutarFiltradoProgresivo(completado) {
    function terminar() {
      clearInterval(intervaloMensajes);
      if (typeof completado === 'function') completado();
    }
    if (!state.rutaActual) { terminar(); return; }
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const TAMANO_BLOQUE = 400;
    const sitios = state.sitios.filter((s) => s.lat != null && s.lon != null && !isNaN(Number(s.lat)) && !isNaN(Number(s.lon)));
    const idsExcluidos = new Set(state.paradas.map((p) => p.id));
    const distanciaMax = Number(el.filtroDistancia.value);
    const bbox = FiltersModule.rutaBboxConMargen(rutaFiltro.geojson, distanciaMax);
    const resultados = [];
    const resultadosBase = [];
    const catsNorm = state.categoriasSeleccionadas.length > 0 ? new Set(state.categoriasSeleccionadas.map((c) => c.toLowerCase().trim())) : null;
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
          }
          if (!isFinite(s.distanciaRutaKm)) continue;
          if (s.distanciaRutaKm > distanciaMax) continue;
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
          renderizarSitios(resultados);
          renderizarCategoriasMenu();
          ultimosValoresAplicados.distancia = Number(el.filtroDistancia.value);
          actualizarEstadoBotonesRetry();
          completado();
        }
      } catch (e) {
        terminar();
      }
    }

    setTimeout(procesarBloque, 30);
  }

  function cargarFondoSitios() {
    if (!state.rutaActual) return;
    const rutaFiltro = state.rutaBase || state.rutaActual;
    const pendientes = state.sitios.filter((s) => s.distanciaRutaKm == null || !isFinite(s.distanciaRutaKm));
    const TAM = 100;
    let i = 0;
    function fondoBloque() {
      const fin = Math.min(i + TAM, pendientes.length);
      for (let j = i; j < fin; j++) {
        const s = pendientes[j];
        if (s.lat == null || s.lon == null || isNaN(Number(s.lat)) || isNaN(Number(s.lon))) continue;
        s.distanciaRutaKm = FiltersModule.distanciaARuta(s, rutaFiltro.geojson);
        s.tiempoDesvioMin = FiltersModule.aproximarTiempoDesvio(s.distanciaRutaKm);
        s.distanciaOrigenKm = FiltersModule.distanciaAOrigen(s, state.origen);
      }
      i = fin;
      if (i < pendientes.length) {
        setTimeout(fondoBloque, 50);
      } else {
        renderizarCategoriasMenu();
      }
    }
    if (pendientes.length > 0) fondoBloque();
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

    if (sitiosOrdenados.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      return;
    }

    el.sitiosVacio.hidden = true;
    el.sitiosLista.hidden = false;

    sitiosOrdenados.forEach((sitio) => {
      if (sitio.lat == null || sitio.lon == null || isNaN(Number(sitio.lat)) || isNaN(Number(sitio.lon))) return;
      const marker = TourismModule.crearMarcador(sitio);
      MapModule.agregarMarcadorSitio(marker);
      el.sitiosLista.appendChild(crearTarjetaSitio(sitio));
    });
  }

  /** Construye la tarjeta de un sitio en la lista, con acciones de previsualizar y agregar. */
  function crearTarjetaSitio(sitio) {
    const li = Utils.crearElemento(`
      <li class="sitio-card" data-sitio-id="${sitio.id}">
        <div class="sitio-card__top">
          <span class="sitio-card__nombre">${sitio.nombre}</span>
          <div class="sitio-card__top-right">
            <button type="button" class="icon-btn sitio-card__add" title="Agregar a la ruta" aria-label="Agregar ${sitio.nombre} a la ruta">
              <svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              <span class="icon-btn__spinner" aria-hidden="true"></span>
            </button>
          </div>
        </div>
        <div class="sitio-card__meta">
          <span>${sitio.municipio}, ${sitio.departamento}</span>
          <span class="mono">${sitio.distanciaRutaKm.toFixed(1)} km · ${Math.round(sitio.tiempoDesvioMin)} min</span>
        </div>
        <p class="sitio-card__preview" hidden></p>
      </li>
    `);

    const btnAdd = li.querySelector('.sitio-card__add');
    btnAdd.addEventListener('click', (e) => {
      e.stopPropagation();
      agregarParada(sitio, btnAdd);
    });

    li.addEventListener('click', () => previsualizarRutaHaciaSitio(sitio, li));

    return li;
  }

  // -------------------------------------------------------------------
  // Previsualización: ruta directa de origen a un sitio seleccionado
  // -------------------------------------------------------------------
  function previsualizarRutaHaciaSitio(sitio, cardEl) {
    // Un segundo clic sobre la misma tarjeta cierra la ficha.
    if (state.previewSitioId === sitio.id) {
      limpiarPreview();
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
  async function construirRutaConDesvios(rutaBase, paradas) {
    if (!rutaBase || paradas.length === 0) return rutaBase;

    const baseLine = turf.lineString(rutaBase.geojson.geometry.coordinates);

    const results = await Promise.all(paradas.map(async (p) => {
      const nearest = turf.nearestPointOnLine(baseLine, turf.point([p.lon, p.lat]));
      const [nearestLon, nearestLat] = nearest.geometry.coordinates;
      try {
        const rutaDesvio = await RoutingModule.calcularRuta(
          { lat: nearestLat, lon: nearestLon },
          { lat: p.lat, lon: p.lon },
          PERFIL_FIJO
        );
        return {
          index: nearest.properties.index,
          detourCoords: rutaDesvio.geojson.geometry.coordinates,
          detourDist: rutaDesvio.distanciaMetros,
          detourDur: rutaDesvio.duracionSegundos,
        };
      } catch {
        return { id: p.id, error: true };
      }
    }));

    let coords = rutaBase.geojson.geometry.coordinates.slice();
    let distanciaExtra = 0;
    let tiempoExtra = 0;
    const idsFallidos = [];
    let offsetAccum = 0;

    for (const r of results) {
      if (r.error) {
        idsFallidos.push(r.id);
        continue;
      }
      const adjustedIndex = r.index + offsetAccum;
      const before = coords.slice(0, adjustedIndex + 1);
      const after = coords.slice(adjustedIndex + 1);
      const returnCoords = r.detourCoords.slice().reverse();
      coords = [...before, ...r.detourCoords, ...returnCoords, ...after];
      offsetAccum += r.detourCoords.length * 2;
      distanciaExtra += r.detourDist * 2;
      tiempoExtra += r.detourDur * 2;
    }

    return {
      geojson: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: coords },
      },
      distanciaMetros: rutaBase.distanciaMetros + Math.round(distanciaExtra),
      duracionSegundos: rutaBase.duracionSegundos + Math.round(tiempoExtra),
      idsFallidos,
    };
  }

  async function aplicarRutaConDesvios() {
    if (!state.rutaBase) return;
    state.rutaActual = await construirRutaConDesvios(state.rutaBase, state.paradas);

    let iteraciones = 0;
    while (state.rutaActual.idsFallidos && state.rutaActual.idsFallidos.length > 0 && iteraciones < 3) {
      const idsSet = new Set(state.rutaActual.idsFallidos);
      state.paradas = state.paradas.filter((p) => !idsSet.has(p.id));
      renderizarParadas();
      state.rutaActual = await construirRutaConDesvios(state.rutaBase, state.paradas);
      iteraciones++;
    }

    MapModule.dibujarRuta(state.rutaActual.geojson, {
      distanciaMetros: state.rutaActual.distanciaMetros,
      duracionSegundos: state.rutaActual.duracionSegundos,
      origenNombre: state.origen?.nombre || 'el origen',
    });

    // Enable drag-to-reroute with current waypoints
    const waypointsCoords = state.orden.map(o => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find(e => e.id === o.id);
        return e && e.lat != null ? [e.lon, e.lat] : null;
      } else {
        const p = state.paradas.find(p => p.id === o.id);
        return p ? [p.lon, p.lat] : null;
      }
    }).filter(Boolean);
    MapModule.habilitarArrastreRuta(waypointsCoords, onRutaDragEnd);
    MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
    MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);

    sincronizarOrden();
    let idxIntermedio = 0;
    state.orden.forEach((o) => {
      const etiqueta = etiquetaIntermedia(idxIntermedio++);
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (e && e.lat != null) e._numero = etiqueta;
      } else {
        const p = state.paradas.find((p) => p.id === o.id);
        if (p) p._numero = etiqueta;
      }
    });
    MapModule.setMarcadoresEscalas(state.escalas);
    MapModule.setMarcadoresParadas(state.paradas);
    MapModule.encuadrar(state.rutaActual.geojson);
    const distTexto = Utils.formatearDistancia(state.rutaActual.distanciaMetros);
    el.statDistancia.textContent = distTexto;
    el.statTiempo.textContent = Utils.formatearDuracion(state.rutaActual.duracionSegundos);
    if (el.statDistanciaMobile) el.statDistanciaMobile.textContent = distTexto;
    if (el.statTiempoMobile) {
      const h = state.rutaActual.duracionSegundos / 3600;
      el.statTiempoMobile.textContent = `${h.toFixed(1)}`;
    }
  }

  // -------------------------------------------------------------------
  // Re-filtrar sitios después de cambios en la ruta (invalida cachés)
  // -------------------------------------------------------------------
  function refiltrarSitios() {
    if (!state.rutaActual) return;
    state.sitios.forEach((s) => {
      delete s.distanciaRutaKm;
      delete s.tiempoDesvioMin;
      delete s.distanciaOrigenKm;
      delete s.distanciaDestinoKm;
      delete s._offsetLado;
    });
    const rutaFiltro = state.rutaBase || state.rutaActual;
    FiltersModule.precomputarSitios(state.sitios, rutaFiltro.geojson, state.origen, state.destino);
    const opciones = {
      usarDistancia: el.checkDistancia.checked || (state.categoriasSeleccionadas.length > 0 && !el.checkDistancia.checked && !el.checkTiempo.checked),
      usarTiempo: el.checkTiempo.checked,
      distanciaMaximaKm: el.checkDistancia.checked ? Number(el.filtroDistancia.value) : 5,
      tiempoMaximoMin: el.checkTiempo.checked ? Number(el.filtroTiempo.value) : 120,
      origen: state.origen,
      destino: state.destino,
      excluirIds: state.paradas.map((p) => p.id),
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
    renderizarSitios(sitiosResultado);
    renderizarCategoriasMenu();
  }

  // -------------------------------------------------------------------
  // Agregar un sitio como desvío (calcula ruta por OSRM ida y vuelta)
  // -------------------------------------------------------------------
  async function agregarParada(sitio, boton) {
    if (boton) ponerEnCarga(boton, true);
    state.paradas.push(sitio);
    try {
      if (el.checkAutoOrganizar.checked) {
        await organizarAutomaticamente();
      } else {
        await aplicarRutaConDesvios();
        renderizarParadas();
      }
      limpiarPreview();
      ejecutarFiltrado();
    } finally {
      if (boton) ponerEnCarga(boton, false);
    }
  }

  // -------------------------------------------------------------------
  // Arrastre de tramo en el mapa (reruteo)
  // -------------------------------------------------------------------

  async function onRutaDragEnd(lnglat, segIdx) {
    const [lng, lat] = lnglat;
    const id = 'drag_' + Date.now();
    const parada = { id, lat, lon: lng, nombre: 'Punto intermedio' };

    // Count how many paradas exist up to segIdx in state.orden
    let paradaCount = 0;
    for (let i = 0; i <= segIdx && i < state.orden.length; i++) {
      if (state.orden[i]?.tipo === 'parada') paradaCount++;
    }

    // Pre-insert at the correct position so sincronizarOrden respects the order
    state.paradas.splice(paradaCount, 0, parada);
    state.orden.splice(segIdx + 1, 0, { tipo: 'parada', id });

    await aplicarRutaConDesvios();
    renderizarParadas();
    refiltrarSitios();
  }

  // -------------------------------------------------------------------
  // Sincronizar el orden combinado de escalas + paradas
  // -------------------------------------------------------------------
  function sincronizarOrden() {
    const escalas = state.escalas.filter((e) => e.lat != null);
    const idsEscalas = new Set(escalas.map((e) => e.id));
    const idsParadas = new Set(state.paradas.map((p) => p.id));

    state.orden = state.orden.filter((o) =>
      (o.tipo === 'escala' && idsEscalas.has(o.id)) ||
      (o.tipo === 'parada' && idsParadas.has(o.id))
    );

    const enOrden = new Set(state.orden.map((o) => o.tipo + '_' + o.id));

    let ultimaEscala = -1;
    for (let i = 0; i < state.orden.length; i++) {
      if (state.orden[i].tipo === 'escala') ultimaEscala = i;
    }

    for (const e of escalas) {
      if (!enOrden.has('escala_' + e.id)) {
        state.orden.splice(ultimaEscala + 1, 0, { tipo: 'escala', id: e.id });
        ultimaEscala++;
        enOrden.add('escala_' + e.id);
      }
    }
    for (const p of state.paradas) {
      if (!enOrden.has('parada_' + p.id)) {
        state.orden.push({ tipo: 'parada', id: p.id });
        enOrden.add('parada_' + p.id);
      }
    }
  }

  async function eliminarParada(sitioId) {
    const idx = state.paradas.findIndex((p) => p.id === sitioId);
    if (idx === -1) return;
    state.paradas.splice(idx, 1);
    await aplicarRutaConDesvios();
    sincronizarOrden();
    renderizarParadas();
    refiltrarSitios();
  }

  function eliminarEscala(id) {
    const idx = state.escalas.findIndex((e) => e.id === id);
    if (idx !== -1) state.escalas.splice(idx, 1);
    sincronizarOrden();
    if (state.rutaActual) {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; delete s.distanciaDestinoKm; delete s._offsetLado; });
      calcularRutaPrincipal(true).then(() => refiltrarSitios());
    } else {
      renderizarParadas();
    }
  }

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
  function renderizarParadas() {
    sincronizarOrden();

    const items = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (!e || e.lat == null) return null;
        return { tipo: 'escala', datos: e };
      }
      const p = state.paradas.find((p) => p.id === o.id);
      if (!p) return null;
      return { tipo: 'parada', datos: p };
    }).filter(Boolean);

    const total = items.length;
    el.paradasLista.innerHTML = '';
    const incluirExtremos = Boolean(state.rutaActual && state.origen && state.destino);
    el.paradasContador.textContent = String(incluirExtremos ? total + 2 : total);
    el.panelParadas.hidden = !incluirExtremos && total === 0;

    function crearFilaExtremo(letra, nombre, tipo) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = letra;

      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      nombreEl.textContent = nombre;

      li.appendChild(num);
      li.appendChild(nombreEl);
      return li;
    }

    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('A', state.origen.nombre, 'origen'));
    }

    items.forEach((item, idx) => {
      const e = item.datos;
      const li = document.createElement('li');
      li.className = 'parada-item';
      li.dataset.paradaId = e.id;
      li.dataset.tipoParada = item.tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = etiquetaIntermedia(idx);

      const nombre = document.createElement('span');
      nombre.className = 'parada-item__nombre';
      nombre.textContent = e.nombre;

      const acciones = document.createElement('div');
      acciones.className = 'parada-item__acciones';

      if (!el.checkAutoOrganizar.checked) {
        if (idx > 0) {
          const btnUp = btnIcono('<polyline points="18 15 12 9 6 15"/>');
          btnUp.title = 'Subir';
          btnUp.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx - 1); });
          acciones.appendChild(btnUp);
        }
        if (idx < total - 1) {
          const btnDown = btnIcono('<polyline points="6 9 12 15 18 9"/>');
          btnDown.title = 'Bajar';
          btnDown.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx + 1); });
          acciones.appendChild(btnDown);
        }
      }

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'parada-item__btn';
      if (item.tipo === 'escala') {
        btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarEscala(e.id); });
      } else {
        btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarParada(e.id); });
      }
      btnDel.title = 'Quitar de la ruta';
      btnDel.setAttribute('aria-label', 'Quitar ' + e.nombre + ' de la ruta');
      btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

      acciones.appendChild(btnDel);
      li.appendChild(num);
      li.appendChild(nombre);
      li.appendChild(acciones);
      li.addEventListener('click', () => {
        if (item.tipo === 'parada') MapModule.abrirPopupSitio(e.id);
      });
      el.paradasLista.appendChild(li);
    });

    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('Z', state.destino.nombre, 'destino'));
    }
  }

  async function organizarAutomaticamente() {
    if (!el.checkAutoOrganizar.checked) return;
    if (!state.origen) return;
    sincronizarOrden();
    const itemsConDistancia = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((ee) => ee.id === o.id);
        if (!e || e.lat == null) return null;
        const dist = FiltersModule.distanciaAOrigen(e, state.origen);
        if (dist == null) return null;
        return { ...o, distancia: dist };
      }
      const p = state.paradas.find((pp) => pp.id === o.id);
      if (!p) return null;
      const dist = p.distanciaOrigenKm ?? FiltersModule.distanciaAOrigen(p, state.origen);
      if (dist == null) return { ...o, distancia: Infinity };
      return { ...o, distancia: dist };
    }).filter(Boolean);

    itemsConDistancia.sort((a, b) => (a.distancia ?? Infinity) - (b.distancia ?? Infinity));
    state.orden = itemsConDistancia.map(({ tipo, id }) => ({ tipo, id }));

    const nuevasEscalas = state.orden
      .filter((o) => o.tipo === 'escala')
      .map((o) => state.escalas.find((e) => e.id === o.id))
      .filter(Boolean);
    const nuevasParadas = state.orden
      .filter((o) => o.tipo === 'parada')
      .map((o) => state.paradas.find((p) => p.id === o.id))
      .filter(Boolean);
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);

    if (state.rutaActual) {
      await calcularRutaPrincipal(true);
    }
    renderizarParadas();
  }

  async function reordenar(desde, hasta) {
    if (desde === hasta) return;
    sincronizarOrden();
    if (desde < 0 || desde >= state.orden.length || hasta < 0 || hasta >= state.orden.length) return;
    const movido = state.orden.splice(desde, 1)[0];
    state.orden.splice(hasta, 0, movido);

    const nuevasEscalas = state.orden
      .filter((o) => o.tipo === 'escala')
      .map((o) => state.escalas.find((e) => e.id === o.id))
      .filter(Boolean);
    const nuevasParadas = state.orden
      .filter((o) => o.tipo === 'parada')
      .map((o) => state.paradas.find((p) => p.id === o.id))
      .filter(Boolean);
    state.escalas.splice(0, state.escalas.length, ...nuevasEscalas);
    state.paradas.splice(0, state.paradas.length, ...nuevasParadas);

    if (movido.tipo === 'escala') {
      state.sitios.forEach((s) => { delete s.distanciaRutaKm; delete s.tiempoDesvioMin; delete s.distanciaOrigenKm; });
      await calcularRutaPrincipal(true);
    } else {
      await aplicarRutaConDesvios();
    }
    renderizarParadas();
  }

  // -------------------------------------------------------------------
  // Estado de carga contenido en el propio botón (sin mensajes flotantes)
  // -------------------------------------------------------------------
  function ponerEnCarga(boton, cargando) {
    boton.disabled = cargando;
    boton.setAttribute('data-loading', cargando ? 'true' : 'false');
  }

  /** Cambia el icono del botón de filtro entre retry y check. */
  // -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);
})();
