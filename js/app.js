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
 *        - clic en la tarjeta: previsualizar en el mapa la ruta directa
 *          desde el origen hasta ese sitio (sin alterar la ruta principal).
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

  /** Estado centralizado de la aplicación. */
  const state = {
    municipios: [],
    sitios: [],
    origen: null,        // {id, nombre, departamento, lat, lon}
    destino: null,
    rutaActual: null,    // resultado de RoutingModule.calcularRuta(ConParadas)
    paradas: [],          // sitios agregados a la ruta, en orden de visita
    sitiosFiltrados: [],
    previewSitioId: null, // id del sitio actualmente previsualizado (si hay alguno)
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
    el.btnCalcular.addEventListener('click', calcularRutaPrincipal);

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

    el.btnAplicarDistancia.addEventListener('click', () => aplicarFiltrosConSpinner(el.btnAplicarDistancia));
    el.btnAplicarTiempo.addEventListener('click', () => aplicarFiltrosConSpinner(el.btnAplicarTiempo));
  }

  function actualizarEstadoBotonesFiltro() {
    const hayRuta = Boolean(state.rutaActual);
    const hayFiltroActivo = el.checkDistancia.checked || el.checkTiempo.checked;
    el.btnAplicarDistancia.disabled = !(hayRuta && hayFiltroActivo);
    el.btnAplicarTiempo.disabled = !(hayRuta && hayFiltroActivo);
  }

  // -------------------------------------------------------------------
  // Cálculo de la ruta principal (solo al pulsar el botón)
  // -------------------------------------------------------------------
  async function calcularRutaPrincipal() {
    if (!state.origen || !state.destino) return;

    if (state.origen.id === state.destino.id) {
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'El origen y el destino deben ser municipios diferentes.';
      el.sitiosLista.hidden = true;
      return;
    }

    // Una nueva ruta principal invalida cualquier parada agregada previamente.
    state.paradas = [];
    MapModule.limpiarParadas();
    limpiarPreview();

    ponerEnCarga(el.btnCalcular, true);

    try {
      const ruta = await RoutingModule.calcularRuta(state.origen, state.destino, PERFIL_FIJO);
      aplicarRutaCalculada(ruta);

      // Limpia resultados de una búsqueda de sitios anterior, ya que
      // corresponden a otra ruta.
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
      ponerEnCarga(el.btnCalcular, false);
    }
  }

  /** Dibuja la ruta calculada, coloca los marcadores y actualiza el resumen del panel. */
  function aplicarRutaCalculada(ruta) {
    state.rutaActual = ruta;

    MapModule.dibujarRuta(ruta.geojson, {
      distanciaMetros: ruta.distanciaMetros,
      duracionSegundos: ruta.duracionSegundos,
    });
    MapModule.setMarcadorOrigen(state.origen.lat, state.origen.lon, state.origen.nombre);
    MapModule.setMarcadorDestino(state.destino.lat, state.destino.lon, state.destino.nombre);
    MapModule.setMarcadoresParadas(state.paradas);
    MapModule.encuadrar(ruta.geojson);

    el.statDistancia.textContent = Utils.formatearDistancia(ruta.distanciaMetros);
    el.statTiempo.textContent = Utils.formatearDuracion(ruta.duracionSegundos);
  }

  // -------------------------------------------------------------------
  // Filtro espacial + render de sitios sobre el mapa (solo al aplicar)
  // -------------------------------------------------------------------
  function aplicarFiltrosConSpinner(botonOrigenClic) {
    if (!state.rutaActual) return;
    if (!el.checkDistancia.checked && !el.checkTiempo.checked) return;

    ponerEnCarga(botonOrigenClic, true);

    // Se libera al siguiente tick para que el spinner del botón alcance a pintarse
    // antes de una operación de Turf.js potencialmente costosa con muchos registros.
    setTimeout(() => {
      ejecutarFiltrado();
      ponerEnCarga(botonOrigenClic, false);
    }, 15);
  }

  /** Recalcula qué sitios cumplen los filtros activos y los muestra en el mapa y la lista. */
  function ejecutarFiltrado() {
    if (!state.rutaActual) return;

    const opciones = {
      usarDistancia: el.checkDistancia.checked,
      usarTiempo: el.checkTiempo.checked,
      distanciaMaximaKm: Number(el.filtroDistancia.value),
      tiempoMaximoMin: Number(el.filtroTiempo.value),
      origen: state.origen,
      excluirIds: state.paradas.map((p) => p.id),
    };

    const sitiosResultado = FiltersModule.filtrarSitiosPorRuta(state.sitios, state.rutaActual.geojson, opciones);
    state.sitiosFiltrados = sitiosResultado;
    renderizarSitios(sitiosResultado);
  }

  function renderizarSitios(sitios) {
    limpiarPreview();
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
            <span class="sitio-card__cat" style="background:${TourismModule.colorCategoria(sitio.categoria)}"></span>
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
  async function previsualizarRutaHaciaSitio(sitio, cardEl) {
    // Un segundo clic sobre la misma tarjeta cancela la previsualización.
    if (state.previewSitioId === sitio.id) {
      limpiarPreview();
      return;
    }

    cardEl.classList.add('sitio-card--loading');

    try {
      const ruta = await RoutingModule.calcularRuta(state.origen, sitio, PERFIL_FIJO);
      MapModule.dibujarRutaPreview(ruta.geojson);
      MapModule.encuadrar(ruta.geojson);

      state.previewSitioId = sitio.id;
      marcarTarjetaActiva(cardEl);

      const preview = cardEl.querySelector('.sitio-card__preview');
      preview.hidden = false;
      preview.innerHTML = `Ruta desde el origen: <span class="mono">${Utils.formatearDistancia(ruta.distanciaMetros)} · ${Utils.formatearDuracion(ruta.duracionSegundos)}</span>`;
    } catch (err) {
      const preview = cardEl.querySelector('.sitio-card__preview');
      preview.hidden = false;
      preview.textContent = 'No se pudo calcular la ruta hacia este sitio.';
    } finally {
      cardEl.classList.remove('sitio-card--loading');
    }
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
  // Agregar un sitio como parada de la ruta principal
  // -------------------------------------------------------------------
  async function agregarParada(sitio, boton) {
    ponerEnCarga(boton, true);
    const paradaAnterior = state.paradas.slice();
    state.paradas.push(sitio);

    try {
      const puntos = [state.origen, ...state.paradas, state.destino];
      const ruta = await RoutingModule.calcularRutaConParadas(puntos, PERFIL_FIJO);
      aplicarRutaCalculada(ruta);

      // La ruta cambió: se refresca la lista de candidatos contra el nuevo
      // trazado, excluyendo los sitios que ya son parada.
      if (el.checkDistancia.checked || el.checkTiempo.checked) {
        ejecutarFiltrado();
      } else {
        MapModule.limpiarSitios();
        state.sitiosFiltrados = [];
        el.sitiosContador.textContent = '0';
        el.sitiosLista.hidden = true;
        el.sitiosLista.innerHTML = '';
        el.sitiosVacio.hidden = false;
        el.sitiosVacio.textContent = `${sitio.nombre} se agregó a la ruta. Activa un filtro para ver más sitios cercanos.`;
      }
    } catch (err) {
      state.paradas = paradaAnterior; // revertir si el recálculo falla
      el.sitiosVacio.hidden = false;
      el.sitiosVacio.textContent = 'No se pudo agregar el sitio a la ruta: ' + err.message;
    } finally {
      ponerEnCarga(boton, false);
    }
  }

  // -------------------------------------------------------------------
  // Estado de carga contenido en el propio botón (sin mensajes flotantes)
  // -------------------------------------------------------------------
  function ponerEnCarga(boton, cargando) {
    boton.disabled = cargando;
    boton.setAttribute('data-loading', cargando ? 'true' : 'false');
  }

  // -------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', init);
})();
