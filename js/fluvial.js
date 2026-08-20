/**
 * fluvial.js
 * ---------------------------------------------------------------------------
 * Motor de rutas fluviales basado en hydrorivers_colombia_graph.json.
 * Carga el grafo una sola vez (en un Web Worker) y resuelve rutas entre dos
 * puertos con A* sobre la red real de ríos. Devuelve la polilínea exacta
 * [[lon, lat], ...] del cauce. También expone la red fluvial completa
 * (tramos de río) para dibujarla en el mapa.
 * ---------------------------------------------------------------------------
 */
const FluvialModule = (() => {

  let _worker = null;
  let _listo = false;
  let _fallo = false;
  const _esperasListo = [];
  const _pendientes = new Map();
  let _idSeq = 0;
  let _url = 'data/hydrorivers_colombia_graph.json';
  let _onCambio = null;

  function _iniciar() {
    if (_worker || _fallo) return;
    try {
      _worker = new Worker('js/fluvialWorker.js');
    } catch (err) {
      _fallo = true;
      _esperasListo.splice(0).forEach((r) => r());
      return;
    }
    _worker.onmessage = (e) => {
      const m = e.data;
      if (m.tipo === 'listo') {
        _listo = true;
        _esperasListo.splice(0).forEach((r) => r());
        if (_onCambio) _onCambio();
      } else if (m.tipo === 'error') {
        _fallo = true;
        _esperasListo.splice(0).forEach((r) => r());
      } else if (m.tipo === 'ruta' || m.tipo === 'red') {
        const p = _pendientes.get(m.id);
        if (p) { _pendientes.delete(m.id); p(m); }
      }
    };
    _worker.onerror = () => {
      _fallo = true;
      _esperasListo.splice(0).forEach((r) => r());
    };
    _worker.postMessage({ tipo: 'cargar', url: _url });
  }

  /** Carga el grafo una sola vez (resuelve cuando está listo o falla). */
  function cargar() {
    _iniciar();
    if (_listo || _fallo) return Promise.resolve();
    return new Promise((res) => _esperasListo.push(res));
  }

  function estaListo() { return _listo; }
  function fallo() { return _fallo; }

  /** Ruta fluvial entre dos puntos (lat/lon). Resuelve [[lon, lat], ...] o null. */
  async function rutaEntre(lat1, lon1, lat2, lon2) {
    await cargar();
    if (_fallo || !_worker) return null;
    return new Promise((resolve) => {
      const id = ++_idSeq;
      _pendientes.set(id, (m) => resolve(m.coords || null));
      _worker.postMessage({ tipo: 'ruta', id, lat1, lon1, lat2, lon2 });
    });
  }

  /** Red fluvial completa: tramos de río [[lon,lat],...]. Resuelve array o null. */
  async function red() {
    await cargar();
    if (_fallo || !_worker) return null;
    return new Promise((resolve) => {
      const id = ++_idSeq;
      _pendientes.set(id, (m) => resolve(m.lineas || null));
      _worker.postMessage({ tipo: 'red', id });
    });
  }

  return { cargar, rutaEntre, red, estaListo, fallo };
})();
