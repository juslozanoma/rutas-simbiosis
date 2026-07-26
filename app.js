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
 *   4. Lista de sitios resultantes, con scroll propio.
 *
 * No se usan mensajes flotantes de carga: la única señal de "procesando"
 * es un pequeño spinner dentro del propio botón que se pulsó.
 * ---------------------------------------------------------------------------
 */
(() => {

  const PERFIL_FIJO = 'driving';

  /** Estado centralizado de la aplicación. */
  const state = {
    municipios: [],
    sitios: [],
    origen: null,       // {id, nombre, departamento, lat, lon}
    destino: null,
    rutaActual: null,   // resultado de RoutingModule.calcularRuta
    sitiosFiltrados: [],
  };

  // -------------------------------------------------------------------
  // Referencias DOM
  // -------------------------------------------------------------------
  const el = {
    statDistancia: document.getElementById('stat-distancia'),
    statTiempo: document.getElementById('stat-tiempo'),

    origenInput: document.getElementById('origen-input'),
    destinoInput: document.getElementById('destino-input'),
    origenList: document.getElementById('origen-list'),
    destinoList: document.getElementById('destino-list'),
    btnCalcular: document.getElementById('btn-calcular'),

    checkDistancia: document.getElementById('check-distancia'),
    filtroDistancia: document.getElementById('filtro-distancia'),
    filtroDistanciaValor: document.getElementById('filtro-distancia-valor'),
    btnAplicarDistancia: document.getElementById('btn-aplicar-distancia'),

    checkTiempo: document.getElementById('check-tiempo'),
    filtroTiempo: document.getElementById('filtro-tiempo'),
    filtroTiempoValor: document.getElementById('filtro-tiempo-valor'),
    btnAplicarTiempo: document.getElementById('btn-aplicar-tiempo'),

    sitiosVacio: document.getElementById('sitios-vacio'),
    sitiosLista: document.getElementById('sitios-lista'),
    sitiosContador: document.getElementById('sitios-contador'),
  };

  // -------------------------------------------------------------------
  // Inicialización
  // -------------------------------------------------------------------
  async function init() {
    MapModule.init('map');

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
    initEventos();
  }

  // -------------------------------------------------------------------
  // Combos de búsqueda (origen / destino)
  // -------------------------------------------------------------------
  function initCombos() {
    setupCombo(el.origenInput, el.origenList, (m) => { state.origen = m; actualizarEstadoBotonCalcular(); });
    setupCombo(el.destinoInput, el.destinoList, (m) => { state.destino = m; actualizarEstadoBotonCalcular(); });
  }

  function setupCombo(input, listEl, onSelect) {
    const render = Utils.debounce((query) => {
      const q = Utils.normalizar(query);
      const resultados = q.length === 0
        ? state.municipios.slice(0, 12)
        : state.municipios
            .filter((m) => Utils.normalizar(m.nombre).includes(q) || Utils.normalizar(m.departamento).includes(q))
            .slice(0, 30);

      listEl.innerHTML = '';
      if (resultados.length === 0) {
        listEl.innerHTML = '<li class="no-results">Sin resultados</li>';
      } else {
        resultados.forEach((m) => {
          const li = document.createElement('li');
          li.setAttribute('role', 'option');
          li.innerHTML = `<span>${m.nombre}</span><small>${m.departamento}</small>`;
          li.addEventListener('mousedown', (e) => {
            e.preventDefault();
            input.value = m.nombre;
            listEl.hidden = true;
            onSelect(m);
          });
          listEl.appendChild(li);
        });
      }
      listEl.hidden = false;
    }, 120);

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('focus', () => render(input.value));
    input.addEventListener('blur', () => setTimeout(() => { listEl.hidden = true; }, 120));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') listEl.hidden = true;
    });
  }

  function actualizarEstadoBotonCalcular() {
    el.btnCalcular.disabled = !(state.origen && state.destino);
  }

  // -------------------------------------------------------------------
  // Eventos generales
  // -------------------------------------------------------------------
  function initEventos() {
    el.btnCalcular.addEventListener('click', calcularRuta);

    el.checkDistancia.addEventListener('change', () => {
      el.filtroDistancia.disabled = !el.checkDistancia.checked;
      actualizarEstadoBotonesFiltro();
    });
    el.checkTiempo.addEventListener('change', () => {
      el.filtroTiempo.disabled = !el.checkTiempo.checked;
      actualizarEstadoBotonesFiltro();
    });

    el.filtroDistancia.addEventListener('input', () => {
      el.filtroDistanciaValor.textContent = `${el.filtroDistancia.value} km`;
    });
    el.filtroTiempo.addEventListener('input', () => {
      el.filtroTiempoValor.textContent = `${el.filtroTiempo.value} min`;
    });

    el.btnAplicarDistancia.addEventListener('click', () => aplicarFiltros(el.btnAplicarDistancia));
    el.btnAplicarTiempo.addEventListener('click', () => aplicarFiltros(el.btnAplicarTiempo));
  }

  function actualizarEstadoBotonesFiltro() {
    const hayRuta = Boolean(state.rutaActual);
    const hayFiltroActivo = el.checkDistancia.checked || el.checkTiempo.checked;
    el.btnAplicarDistancia.disabled = !(hayRuta && hayFiltroActivo);
    el.btnAplicarTiempo.disabled = !(hayRuta && hayFiltroActivo);
  }

  // -------------------------------------------------------------------
  // Cálculo de ruta (solo al pulsar el botón)
  // -------------------------------------------------------------------
  async function calcularRuta() {
    if (!state.origen || !state.destino) return;

    if (state.origen.id === state.destino.id) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'El origen y el destino deben ser municipios diferentes.';
      el.sitiosLista.hidden = true;
      return;
    }

    ponerBotonEnCarga(el.btnCalcular, true);

    try {
      const ruta = await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);
      state.rutaActual = ruta;

      MapModule.dibujarRuta(ruta.geojson);
      MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
      MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);
      MapModule.encuadrar(ruta.geojson);

      el.statDistancia.textContent = Utils.formatearDistancia(ruta.distanciaMetros);
      el.statTiempo.textContent = Utils.formatearDuracion(ruta.duracionSegundos);

      // Una nueva ruta invalida cualquier resultado de sitios anterior.
      MapModule.limpiarSitios();
      state.sitiosFiltrados = [];
      el.sitiosContador.textContent = '0';
      el.sitiosLista.hidden = true;
      el.sitiosLista.innerHTML = '';
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Activa un filtro (distancia o tiempo) y pulsa el botón de aplicar para ver los sitios turísticos cercanos.';

      actualizarEstadoBotonesFiltro();
    } catch (err) {
      el.statDistancia.textContent = '—';
      el.statTiempo.textContent = '—';
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'No se pudo calcular la ruta: ' + err.message;
    } finally {
      ponerBotonEnCarga(el.btnCalcular, false);
    }
  }

  // -------------------------------------------------------------------
  // Filtro espacial + render de sitios sobre el mapa (solo al aplicar)
  // -------------------------------------------------------------------
  function aplicarFiltros(botonOrigenClic) {
    if (!state.rutaActual) return;
    if (!el.checkDistancia.checked && !el.checkTiempo.checked) return;

    ponerBotonEnCarga(botonOrigenClic, true);

    // Se libera al siguiente tick para que el spinner del botón alcance a pintarse
    // antes de una operación de Turf.js potencialmente costosa con muchos registros.
    setTimeout(() => {
      const opciones = {
        usarDistancia: el.checkDistancia.checked,
        usarTiempo: el.checkTiempo.checked,
        distanciaMaximaKm: Number(el.filtroDistancia.value),
        tiempoMaximoMin: Number(el.filtroTiempo.value),
      };

      const sitiosEnCorredor = FiltersModule.filtrarSitiosPorRuta(state.sitios, state.rutaActual.geojson, opciones);
      state.sitiosFiltrados = sitiosEnCorredor;
      renderizarSitios(sitiosEnCorredor);

      ponerBotonEnCarga(botonOrigenClic, false);
    }, 15);
  }

  function renderizarSitios(sitios) {
    MapModule.limpiarSitios();
    el.sitiosLista.innerHTML = '';
    el.sitiosContador.textContent = String(sitios.length);

    if (sitios.length === 0) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'Ningún sitio turístico cumple los filtros activos.';
      el.sitiosLista.hidden = true;
      return;
    }

    el.sitiosVacio.hidden = true;
    el.sitiosLista.hidden = false;

    sitios.forEach((sitio) => {
      const marker = TourismModule.crearMarcador(sitio);
      MapModule.agregarMarcadorSitio(marker);

      const li = document.createElement('li');
      li.className = 'sitio-card';
      li.innerHTML = `
        <div class="sitio-card__top">
          <span class="sitio-card__nombre">${sitio.nombre}</span>
          <span class="sitio-card__cat" style="background:${TourismModule.colorCategoria(sitio.categoria)}"></span>
        </div>
        <div class="sitio-card__meta">
          <span>${sitio.municipio}, ${sitio.departamento}</span>
          <span class="mono">${sitio.distanciaCorredorKm.toFixed(1)} km · ${Math.round(sitio.tiempoDesvioMin)} min</span>
        </div>`;
      li.addEventListener('click', () => {
        MapModule.getMap().setView([sitio.lat, sitio.lon], 13);
        marker.openPopup();
      });
      el.sitiosLista.appendChild(li);
    });
  }

  // -------------------------------------------------------------------
  // Estado de carga contenido en el propio botón (sin mensajes flotantes)
  // -------------------------------------------------------------------
  function ponerBotonEnCarga(boton, cargando) {
    boton.disabled = cargando;
    boton.setAttribute('data-loading', cargando ? 'true' : 'false');
  }

  // -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);
})();
