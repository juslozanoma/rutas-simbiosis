/**
 * src/components/MenuFila.jsx
 * ---------------------------------------------------------------------------
 * Menú contextual de filas (paradas, escalas, catálogo y marcadores) en React.
 * Vanilla (js/paradas.js:abrirMenuFila) guarda las opciones con sus acciones
 * y la posición de apertura; React porta el <div class="fila-menu"> a
 * document.body y lo re-monta entero en cada notificación (key = versión del
 * store), replicando el menú que antes se construía con createElement.
 *
 * Al hacer clic en una opción se delega en la función global que ejecuta la
 * acción (por índice) y cierra el menú. El cierre por clic fuera y Escape
 * sigue gestionándose en vanilla consultando el elemento en el DOM. La
 * posición se ajusta al viewport tras el primer render (useLayoutEffect),
 * igual que hacía abrirMenuFila con getBoundingClientRect.
 * ---------------------------------------------------------------------------
 */
import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarMenuFila() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarMenuFila = notificarMenuFila;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosMenuFila === 'function' ? u.datosMenuFila() : null;
}

function MenuContenido({ opciones, x, y }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > w.innerWidth - 8) left = w.innerWidth - rect.width - 8;
    if (top + rect.height > w.innerHeight - 8) top = w.innerHeight - rect.height - 8;
    left = Math.max(8, left);
    top = Math.max(8, top);
    setPos({ left, top });
  }, [x, y]);

  return (
    <div className="fila-menu" ref={ref} style={pos ? { left: pos.left, top: pos.top } : { left: x, top: y }}>
      {opciones.map((op, i) => (
        <div
          key={i}
          className="fila-menu__item"
          onClick={() => {
            const u = _ui();
            if (u && typeof u.ejecutarMenuFila === 'function') u.ejecutarMenuFila(i);
          }}
        >
          {op.icono && (
            <span
              className="fila-menu__ico"
              style={{
                WebkitMaskImage: "url('" + op.icono + "')",
                maskImage: "url('" + op.icono + "')",
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
          )}
          {op.etiqueta}
        </div>
      ))}
    </div>
  );
}

function PortalMenu() {
  const datos = _datos();
  if (!datos || !datos.opciones || !datos.opciones.length) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      <MenuContenido opciones={datos.opciones} x={datos.x} y={datos.y} />
    </Fragment>,
    document.body
  );
}

export default function MenuFila() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalMenu />;
}