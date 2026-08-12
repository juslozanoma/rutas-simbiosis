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

  /** Normaliza texto para comparar sin tildes ni mayúsculas. */
  function _normalizar(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function _construirIndice() {
    const items = [];
    const push = (tipo, nombre, subtitulo, lat, lon, zoom) => {
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
        busca: _normalizar(nombre) + ' ' + _normalizar(subtitulo),
      });
    };
    (state.municipios || []).forEach((m) => push('Municipio', m.nombre, m.departamento || '', m.lat, m.lon, 12));
    (state.departamentos || []).forEach((d) => push('Departamento', d.nombre, 'Capital: ' + (d.capital || ''), d.lat, d.lon, 7));
    (state.sitios || []).forEach((s) => push('Sitio turístico', s.nombre, [s.municipio, s.departamento].filter(Boolean).join(', '), s.lat, s.lon, 15));
    (state.aeropuertos || []).forEach((a) => push('Aeropuerto', a.nombre, a.ciudad || '', a.latitud, a.longitud, 12));
    (state.puertos || []).forEach((p) => push('Puerto', p.nombre, [p.ciudad, p.rio].filter(Boolean).join(', '), p.latitud, p.longitud, 14));
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
    // Abrir la ficha informativa del lugar seleccionado.
    _abrirFichaLugar(r);
    // Tras una búsqueda el cuadro se reinicia: queda vacío y la lista oculta.
    _input.value = '';
    _cerrar(true);
  }

  /** Resalta un elemento de la lista (navegación con teclado). */
  function _resaltar(indice) {
    const items = Array.from(_lista.children);
    items.forEach((li, i) => li.classList.toggle('buscar-lugar__item--activo', i === indice));
    const el = items[indice];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  /** Abre la ficha informativa del lugar elegido en el buscador, buscando el
   *  objeto completo en el estado (municipios, departamentos, sitios,
   *  aeropuertos o puertos). */
  function _abrirFichaLugar(r) {
    if (typeof TourismModule === 'undefined') return;
    const porLatLon = (lat, lon, dato) => (dato || []).find((s) => Number(s.lat) === lat && Number(s.lon) === lon);
    const porLatLonExt = (lat, lon, dato) => (dato || []).find((s) => Number(s.latitud) === lat && Number(s.longitud) === lon);
    if (r.tipo === 'Sitio turístico') {
      const sitio = porLatLon(r.lat, r.lon, state.sitios);
      if (sitio && typeof TourismModule.mostrarPopupSitio === 'function') TourismModule.mostrarPopupSitio(sitio);
      return;
    }
    if (typeof mostrarCuadroInfra !== 'function') return;
    if (r.tipo === 'Municipio') {
      const m = porLatLon(r.lat, r.lon, state.municipios);
      if (m) mostrarCuadroInfra('municipio', m);
    } else if (r.tipo === 'Departamento') {
      const d = porLatLon(r.lat, r.lon, state.departamentos);
      if (d) mostrarCuadroInfra('departamento', d);
    } else if (r.tipo === 'Aeropuerto') {
      const a = porLatLonExt(r.lat, r.lon, state.aeropuertos);
      if (a) mostrarCuadroInfra('aeropuerto', a);
    } else if (r.tipo === 'Puerto') {
      const p = porLatLonExt(r.lat, r.lon, state.puertos);
      if (p) mostrarCuadroInfra('puerto', p);
    }
  }

  function _cerrar(conservarTexto) {
    _abierto = false;
    _box.hidden = true;
    _btn.setAttribute('aria-pressed', 'false');
    _lista.hidden = true;
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
      if (!query || !resultados.length) { lista.hidden = true; return; }
      lista.innerHTML = '';
      resultados.forEach((r, i) => {
        const li = document.createElement('li');
        li.className = 'buscar-lugar__item' + (i === 0 ? ' buscar-lugar__item--first' : '');
        const nom = document.createElement('span');
        nom.className = 'buscar-lugar__item-nombre';
        nom.textContent = r.nombre;
        const sub = document.createElement('span');
        sub.className = 'buscar-lugar__item-tipo';
        sub.textContent = r.tipo + (r.subtitulo ? ' · ' + r.subtitulo : '');
        li.appendChild(nom);
        li.appendChild(sub);
        li.addEventListener('mousedown', (e) => e.preventDefault());
        li.addEventListener('click', () => _seleccionar(r));
        lista.appendChild(li);
      });
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
        if (idx < 0) idx = e.key === 'ArrowDown' ? -1 : items.length;
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
  return { init };
})();
