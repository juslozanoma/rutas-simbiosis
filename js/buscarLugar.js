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

  function _buscar(query) {
    const q = _normalizar(query);
    if (!q) return [];
    return _getIndice()
      .filter((i) => i.busca.indexOf(q) !== -1)
      .slice(0, 15);
  }

  function _seleccionar(r, input, lista) {
    if (typeof MapModule !== 'undefined' && typeof MapModule.centrarEn === 'function') {
      MapModule.centrarEn(r.lat, r.lon, r.zoom);
    }
    lista.hidden = true;
    input.value = r.nombre;
  }

  function init() {
    const btn = document.getElementById('btn-buscar-lugar');
    const box = document.getElementById('buscar-lugar');
    const input = document.getElementById('buscar-lugar-input');
    const btnBuscar = document.getElementById('buscar-lugar-btn');
    const lista = document.getElementById('buscar-lugar-lista');
    if (!btn || !box || !input || !btnBuscar || !lista) return;

    function cerrar() {
      _abierto = false;
      box.hidden = true;
      btn.setAttribute('aria-pressed', 'false');
      lista.hidden = true;
      input.value = '';
    }

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
        li.addEventListener('click', () => _seleccionar(r, input, lista));
        lista.appendChild(li);
      });
      lista.hidden = false;
    }

    btn.addEventListener('click', () => {
      if (_abierto) { cerrar(); return; }
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
        if (resultados.length) _seleccionar(resultados[0], input, lista);
      } else if (e.key === 'Escape') {
        cerrar();
      }
    });

    btnBuscar.addEventListener('click', () => {
      const resultados = _buscar(input.value);
      if (resultados.length) _seleccionar(resultados[0], input, lista);
    });

    // El cuadro se mantiene abierto hasta volver a pulsar la lupa; solo se
    // cierra el listado de resultados al hacer clic fuera de él.
    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && !btn.contains(e.target)) {
        lista.hidden = true;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
