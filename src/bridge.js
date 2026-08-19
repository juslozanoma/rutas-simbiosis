/**
 * src/bridge.js
 * ---------------------------------------------------------------------------
 * Bus de eventos entre React y la app vanilla (scripts clásicos de /js/).
 *
 * Los scripts clásicos no pueden importar módulos ES, así que React expone un
 * objeto global (`window.SimbiosisUI`) con el que el código vanilla emite
 * eventos (`emit`) que los componentes React escuchan (`on`/`off`).
 *
 * Eventos definidos hasta ahora:
 *   - 'transport-selector:abrir'   { clientX, clientY }
 *   - 'transport-selector:cerrar'
 * ---------------------------------------------------------------------------
 */

const _oyentes = new Map();

function on(evento, fn) {
  if (!_oyentes.has(evento)) _oyentes.set(evento, []);
  _oyentes.get(evento).push(fn);
}

function off(evento, fn) {
  const lista = _oyentes.get(evento);
  if (!lista) return;
  const idx = lista.indexOf(fn);
  if (idx !== -1) lista.splice(idx, 1);
}

function emit(evento, dato) {
  const lista = _oyentes.get(evento);
  if (!lista) return;
  lista.slice().forEach((fn) => {
    try {
      fn(dato);
    } catch (e) {
      console.error('[Simbiosis] Error en oyente de ' + evento, e);
    }
  });
}

export const bridge = { on, off, emit };

if (typeof window !== 'undefined') {
  window.SimbiosisUI = bridge;
}

export default bridge;
