/**
 * fluvialWorker.js
 * ---------------------------------------------------------------------------
 * Web Worker del motor de rutas fluviales. Única fuente de cálculo:
 * un grafo de la red hidrográfica (nodos + aristas del cauce). Por defecto
 * usa data/hydrorivers_colombia_graph.json; el mensaje 'cargar' puede indicar
 * otra variante con el campo `url`.
 *
 * Formato real del archivo:
 *   nodes: [[lon, lat], ...]   (índice = id del nodo)
 *   edges: [[from, to, length], ...]  (length en metros)
 *
 * La geometría de una ruta son los propios nodos encadenados: cada arista
 * une dos nodos consecutivos del cauce. Carga el grafo una sola vez,
 * construye un índice espacial (rejilla) y resuelve rutas con A*
 * (heurística = distancia al destino). También reconstruye los "tramos de
 * río" completos (cadenas de nodos) para dibujar la red fluvial.
 * ---------------------------------------------------------------------------
 */

let _nodes = null;      // [[lon, lat], ...]
let _adj = null;        // id -> [{ to, w }]
let _grid = null;       // 'cx,cy' -> [ids]
let _minLon = 0, _minLat = 0;
let _tramosCache = null; // tramos de río ya reconstruidos
const CELL = 0.02;      // tamaño de celda de la rejilla en grados (~2 km)

/** Resuelve una URL relativa contra el script del worker: este vive en /js/,
 *  así que para alcanzar /data/ hay que subir un nivel. */
function _resolverUrl(url) {
  try {
    if (/^(https?:|data:|blob:|file:)/i.test(url) || url.charAt(0) === '/') return url;
    return new URL('../' + url, self.location.href).href;
  } catch (e) {
    return url;
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.tipo === 'cargar') {
    _cargarGrafo(_resolverUrl(m.url || 'data/hydrorivers_colombia_graph.json'));
  } else if (m.tipo === 'ruta') {
    const coords = _calcularRuta(m);
    self.postMessage({ tipo: 'ruta', id: m.id, coords });
  } else if (m.tipo === 'red') {
    if (!_tramosCache) _tramosCache = _tramosRed();
    self.postMessage({ tipo: 'red', id: m.id, lineas: _tramosCache });
  }
};

async function _cargarGrafo(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    _nodes = data.nodes || [];
    const n = _nodes.length;
    _adj = new Array(n);
    const edges = data.edges || [];
    for (const ed of edges) {
      if (!Array.isArray(ed) || ed.length < 2) continue;
      const u = ed[0], v = ed[1];
      if (u < 0 || u >= n || v < 0 || v >= n) continue;
      const w = ed[2] || 0;
      (_adj[u] || (_adj[u] = [])).push({ to: v, w });
      (_adj[v] || (_adj[v] = [])).push({ to: u, w });
    }
    _construirIndice();
    self.postMessage({ tipo: 'listo' });
  } catch (err) {
    self.postMessage({ tipo: 'error', mensaje: String(err) });
  }
}

/** Rejilla uniforme sobre los nodos para localizar el más cercano en O(1..k). */
function _construirIndice() {
  _minLon = Infinity; _minLat = Infinity;
  let maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of _nodes) {
    if (lon < _minLon) _minLon = lon;
    if (lat < _minLat) _minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  _grid = new Map();
  for (let i = 0; i < _nodes.length; i++) {
    const cx = Math.floor((_nodes[i][0] - _minLon) / CELL);
    const cy = Math.floor((_nodes[i][1] - _minLat) / CELL);
    const k = cx + ',' + cy;
    if (!_grid.has(k)) _grid.set(k, []);
    _grid.get(k).push(i);
  }
}

/** Id del nodo más cercano a (lon, lat) usando la rejilla con anillos crecientes. */
function _nodoMasCercano(lon, lat) {
  const cx0 = Math.floor((lon - _minLon) / CELL);
  const cy0 = Math.floor((lat - _minLat) / CELL);
  let bestId = -1;
  let bestD = Infinity;
  const MAX_R = 40; // ~0.8° de radio; los puertos están junto a un río
  for (let r = 0; r <= MAX_R; r++) {
    if (r > 0 && (r - 1) * CELL * 111 > bestD) break;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cell = _grid.get((cx0 + dx) + ',' + (cy0 + dy));
        if (!cell) continue;
        for (let i = 0; i < cell.length; i++) {
          const id = cell[i];
          const d = Math.hypot(_nodes[id][0] - lon, _nodes[id][1] - lat);
          if (d < bestD) { bestD = d; bestId = id; }
        }
      }
    }
  }
  return bestId;
}

/** Distancia haversine en metros entre dos nodos [lon, lat]. */
function _distMetros(a, b) {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * Math.PI / 180;
  const dLon = (b[0] - a[0]) * Math.PI / 180;
  const la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A* (min-heap) desde s hasta t usando exclusivamente aristas del grafo. */
function _aEstrella(s, t) {
  const n = _nodes.length;
  const INF = Infinity;
  const dist = new Float64Array(n).fill(INF);
  const prev = new Int32Array(n).fill(-1);
  const tCoord = _nodes[t];
  const h = (id) => _distMetros(_nodes[id], tCoord);

  dist[s] = 0;
  const heap = [];
  const push = (f, id) => {
    heap.push([f, id]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      const len = heap.length;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let m = i;
        if (l < len && heap[l][0] < heap[m][0]) m = l;
        if (r < len && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  push(0 + h(s), s);
  while (heap.length) {
    const [f, u] = pop();
    if (u === t) break;
    if (f > dist[u] + h(u)) continue;
    const vecinos = _adj[u] || [];
    for (let i = 0; i < vecinos.length; i++) {
      const { to, w } = vecinos[i];
      const nd = dist[u] + w;
      if (nd < dist[to]) {
        dist[to] = nd;
        prev[to] = u;
        push(nd + h(to), to);
      }
    }
  }
  if (dist[t] === INF) return null;
  const ids = [];
  let cur = t;
  while (cur !== -1) {
    ids.push(cur);
    if (cur === s) break;
    cur = prev[cur];
  }
  ids.reverse();
  return ids;
}

/** Ruta fluvial entre dos puertos. Devuelve [[lon, lat], ...] o null. */
function _calcularRuta(m) {
  if (!_nodes) return null;
  const s = _nodoMasCercano(m.lon1, m.lat1);
  const t = _nodoMasCercano(m.lon2, m.lat2);
  if (s < 0 || t < 0) return null;
  if (s === t) return [[m.lon1, m.lat1], [m.lon2, m.lat2]];
  const camino = _aEstrella(s, t);
  if (!camino) return null;
  const coords = [[m.lon1, m.lat1]];
  for (let i = 1; i < camino.length; i++) {
    coords.push(_nodes[camino[i]]);
  }
  coords.push([m.lon2, m.lat2]);
  return coords;
}

/** Reconstruye los tramos de río completos del grafo: cada tramo es la cadena
 *  de nodos entre dos bifurcaciones (grado != 2). Recorre cada arista una sola
 *  vez, extendiéndose por nodos de grado 2 hasta alcanzar otra bifurcación.
 *  Devuelve [[[lon,lat],...], ...]. */
function _tramosRed() {
  if (!_nodes) return [];
  const n = _nodes.length;
  const grado = new Int32Array(n);
  for (let i = 0; i < n; i++) grado[i] = (_adj[i] || []).length;
  const lineas = [];
  const visitada = new Set();
  const key = (u, v) => (u < v ? u + '>' + v : v + '>' + u);

  for (let i = 0; i < n; i++) {
    const vec = _adj[i] || [];
    for (let j = 0; j < vec.length; j++) {
      const b = vec[j].to;
      const k = key(i, b);
      if (visitada.has(k)) continue;
      visitada.add(k);

      // caminar hacia atrás desde i hasta una bifurcación (incluida)
      const back = [i];
      if (grado[i] === 2) {
        let cur = i, from = -1;
        for (;;) {
          const v = _adj[cur] || [];
          let nx = -1;
          for (let t = 0; t < v.length; t++) {
            const c = v[t].to;
            if (c === from) continue;
            if (visitada.has(key(cur, c))) continue;
            nx = c;
            break;
          }
          if (nx === -1) break;
          visitada.add(key(cur, nx));
          if (grado[nx] !== 2) { back.push(nx); break; }
          from = cur;
          cur = nx;
          back.push(cur);
        }
      }

      // caminar hacia adelante desde b hasta una bifurcación (incluida)
      const fwd = [b];
      if (grado[b] === 2) {
        let cur = b, from = i;
        for (;;) {
          const v = _adj[cur] || [];
          let nx = -1;
          for (let t = 0; t < v.length; t++) {
            const c = v[t].to;
            if (c === from) continue;
            if (visitada.has(key(cur, c))) continue;
            nx = c;
            break;
          }
          if (nx === -1) break;
          visitada.add(key(cur, nx));
          if (grado[nx] !== 2) { fwd.push(nx); break; }
          from = cur;
          cur = nx;
          fwd.push(cur);
        }
      }

      // cadena = back invertido + fwd (sin duplicar i/b: back termina en i y
      // fwd empieza en b, que son extremos distintos unidos por la arista actual)
      const cadena = [];
      for (let t = back.length - 1; t >= 0; t--) cadena.push(_nodes[back[t]]);
      for (let t = 0; t < fwd.length; t++) cadena.push(_nodes[fwd[t]]);
      if (cadena.length >= 2) lineas.push(cadena);
    }
  }
  return lineas;
}
