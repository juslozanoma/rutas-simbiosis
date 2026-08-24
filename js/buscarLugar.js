/**
 * buscarLugar.js
 * ---------------------------------------------------------------------------
 * Búsqueda global de lugares (municipios, departamentos, sitios turísticos,
 * aeropuertos y puertos de los JSON en /data). Se abre/cierra desde la lupa de
 * la barra superior de resumen y, al seleccionar un resultado, centra el mapa
 * con un zoom cercano.
 * ---------------------------------------------------------------------------
 */

const BuscarLugarModule = (() => {
  let _abierto = false;
  let _indice = null; // { total, items }
  let _box = null;
  let _btn = null;
  let _input = null;
  let _lista = null;
  let _resultadosActuales = []; // resultados visibles (los lee React)
  let _activoIndex = -1;        // resultado resaltado con el teclado

  /** Normaliza texto para comparar sin tildes ni mayúsculas. */
  function _normalizar(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function _construirIndice() {
    const items = [];
    const push = (tipo, nombre, subtitulo, lat, lon, zoom, ref) => {
      if (nombre == null || lat == null || lon == null) return;
      const n = Number(lat);
      const o = Number(lon);
      if (!isFinite(n) || !isFinite(o)) return;
      items.push({
        tipo,
        nombre,
        subtitulo,
        lat: n,
        lon: o,
        zoom,
        ref,
        busca: _normalizar(nombre) + ' ' + _normalizar(subtitulo),
      });
    };
    (state.municipios || []).forEach((m) => push('Municipio', m.nombre, m.departamento || '', m.lat, m.lon, 12, m));
    (state.departamentos || []).forEach((d) => push('Departamento', d.nombre, 'Capital: ' + (d.capital || ''), d.lat, d.lon, 7, d));
    (state.sitios || []).forEach((s) => push('Sitio turístico', s.nombre, [s.municipio, s.departamento].filter(Boolean).join(', '), s.lat, s.lon, 15, s));
    (state.aeropuertos || []).forEach((a) => push('Aeropuerto', a.nombre, a.ciudad || '', a.latitud, a.longitud, 12, a));
    (state.puertos || []).forEach((p) => push('Puerto', p.nombre, [p.ciudad, p.rio].filter(Boolean).join(', '), p.latitud, p.longitud, 14, p));
    return items;
  }

  /** Índice cacheado; se reconstruye si cambia la cantidad de datos cargados. */
  function _getIndice() {
    const total = (state.municipios || []).length + (state.departamentos || []).length
      + (state.sitios || []).length + (state.aeropuertos || []).length + (state.puertos || []).length;
    if (_indice && _indice.total === total) return _indice.items;
    _indice = { total, items: _construirIndice() };
    return _indice.items;
  }

  /** Puntaje de relevancia sobre el nombre: a menor valor, más coincide.
   *  Exacto < empieza por < empieza por una palabra < contiene. A igualdad,
   *  los nombres más cortos van primero. */
  function _puntajeNombre(nom, q) {
    let base;
    if (nom === q) base = 0;
    else if (nom.startsWith(q)) base = 10;
    else if (nom.split(' ').some((w) => w.startsWith(q))) base = 20;
    else base = 30;
    return base * 1000 + Math.min(nom.length, 999);
  }

  function _buscar(query) {
    const q = _normalizar(query);
    if (!q) return [];
    const conScore = [];
    for (const i of _getIndice()) {
      const nom = _normalizar(i.nombre);
      if (nom.indexOf(q) !== -1) {
        conScore.push({ i, score: _puntajeNombre(nom, q) });
      } else if (_normalizar(i.subtitulo || '').indexOf(q) !== -1) {
        // Coincidencia secundaria en el subtítulo (departamento, ciudad, río…).
        conScore.push({ i, score: 1000000 });
      }
    }
    conScore.sort((a, b) => a.score - b.score);
    return conScore.slice(0, 15).map((x) => x.i);
  }

  function _seleccionar(r) {
    if (typeof MapModule !== 'undefined') {
      if (typeof MapModule.centrarEn === 'function') {
        MapModule.centrarEn(r.lat, r.lon, r.zoom);
      }
      if (typeof MapModule.mostrarLugarBuscado === 'function') {
        MapModule.mostrarLugarBuscado(r.tipo, r);
      }
    }
    // En escritorio la ficha informativa se abre directamente en el panel
    // lateral (#panel-info, funnel de TourismModule). En celular se mantiene
    // el comportamiento previo: queda visible el tooltip con su "×".
    if (typeof esMovil === 'function' && !esMovil() && r.ref && typeof TourismModule !== 'undefined') {
      if (r.tipo === 'Sitio turístico' && typeof TourismModule.mostrarPopupSitio === 'function') {
        TourismModule.mostrarPopupSitio(r.ref);
      } else if (typeof mostrarCuadroInfra === 'function') {
        const tipo = { 'Municipio': 'municipio', 'Departamento': 'departamento', 'Aeropuerto': 'aeropuerto', 'Puerto': 'puerto' }[r.tipo];
        if (tipo) mostrarCuadroInfra(tipo, r.ref);
      }
    }
    // Tras una búsqueda el cuadro se reinicia: queda vacío y la lista oculta.
    _input.value = '';
    _cerrar(true);
  }

  /** Resalta un elemento de la lista (navegación con teclado). La clase la
   *  pinta React (BuscarLugarLista): solo se actualiza el índice y se notifica. */
  function _resaltar(indice) {
    _activoIndex = indice;
    _notificarBuscarLugar();
    const el = _lista.children[indice];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  function _cerrar(conservarTexto) {
    _abierto = false;
    _box.hidden = true;
    _btn.setAttribute('aria-pressed', 'false');
    _resultadosActuales = [];
    _activoIndex = -1;
    _lista.hidden = true;
    _notificarBuscarLugar();
    if (!conservarTexto) _input.value = '';
  }

  function init() {
    const btn = document.getElementById('btn-buscar-lugar');
    const box = document.getElementById('buscar-lugar');
    const input = document.getElementById('buscar-lugar-input');
    const btnBuscar = document.getElementById('buscar-lugar-btn');
    const lista = document.getElementById('buscar-lugar-lista');
    if (!btn || !box || !input || !btnBuscar || !lista) return;
    _box = box;
    _btn = btn;
    _input = input;
    _lista = lista;

    function renderLista(query) {
      const resultados = _buscar(query);
      if (!query || !resultados.length) {
        _resultadosActuales = [];
        _activoIndex = -1;
        _notificarBuscarLugar();
        lista.hidden = true;
        return;
      }
      // Los <li> los renderiza React (BuscarLugarLista, portal a la lista);
      // aquí solo se guarda el snapshot y se notifica al puente.
      _resultadosActuales = resultados;
      _activoIndex = -1;
      _notificarBuscarLugar();
      lista.hidden = false;
    }

    btn.addEventListener('click', () => {
      if (_abierto) { _cerrar(); return; }
      _abierto = true;
      box.hidden = false;
      btn.setAttribute('aria-pressed', 'true');
      renderLista(input.value);
      input.focus();
    });

    input.addEventListener('input', () => renderLista(input.value));

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const resultados = _buscar(input.value);
        if (!resultados.length) return;
        const items = Array.from(lista.children);
        const activo = items.findIndex((li) => li.classList.contains('buscar-lugar__item--activo'));
        _seleccionar(resultados[activo >= 0 ? activo : 0]);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(lista.children);
        if (!items.length) return;
        let idx = items.findIndex((li) => li.classList.contains('buscar-lugar__item--activo'));
        if (idx < 0) {
          // Sin resaltado, el usuario ya está posicionado en el primer resultado
          // (--first): bajar va al segundo; subir resalta el primero.
          idx = e.key === 'ArrowDown' ? 0 : -1;
        }
        idx = e.key === 'ArrowDown' ? Math.min(items.length - 1, idx + 1) : Math.max(0, idx - 1);
        _resaltar(idx);
      } else if (e.key === 'Escape') {
        _cerrar();
      }
    });

    btnBuscar.addEventListener('click', () => {
      const resultados = _buscar(input.value);
      if (resultados.length) _seleccionar(resultados[0]);
    });

    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && !btn.contains(e.target)) {
        lista.hidden = true;
      }
    });

    // Ctrl+F (o Cmd+F) enfoca y resalta el buscador (solo en PC).
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        if (typeof esMovil === 'function' && esMovil()) return;
        e.preventDefault();
        input.focus();
        input.select();
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  // -------------------------------------------------------------------
  // Puente con React (lista de resultados). Los <li> los renderiza el
  // componente BuscarLugarLista (portal a #buscar-lugar-lista) leyendo el
  // snapshot de _resultadosActuales; el resto del buscador sigue siendo
  // vanilla.
  // -------------------------------------------------------------------

  /** Pide a React que vuelva a renderizar los resultados. */
  function _notificarBuscarLugar() {
    if (typeof window !== 'undefined' && window.SimbiosisUI && typeof window.SimbiosisUI.notificarBuscarLugar === 'function') {
      window.SimbiosisUI.notificarBuscarLugar();
    }
  }

  if (typeof window !== 'undefined' && window.SimbiosisUI) {
    /** Snapshot que React necesita para pintar los <li> de resultados. */
    window.SimbiosisUI.datosBuscarLugar = () => ({
      resultados: _resultadosActuales,
      activoIndex: _activoIndex,
    });
    /** Selecciona un resultado por su índice en la lista actual. */
    window.SimbiosisUI.seleccionarBuscarLugar = (i) => {
      const r = _resultadosActuales[i];
      if (r) _seleccionar(r);
    };
  }

  return { init };
})();
