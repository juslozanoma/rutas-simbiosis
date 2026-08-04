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
        if (typeof RutaArchivoModule !== 'undefined' && typeof RutaArchivoModule.abrirDialogo === 'function') {
          RutaArchivoModule.abrirDialogo();
        }
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);