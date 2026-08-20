/**
 * src/components/MenuAltimetria.jsx
 * ---------------------------------------------------------------------------
 * Menú contextual del perfil de elevación (marcadores de parada, clic derecho
 * sobre el perfil o pulsación larga) en React. Vanilla
 * (js/altimetria.js:_abrirMenuFlotante) guarda el snapshot con las opciones y
 * sus acciones más la posición de apertura; React porta el
 * <div class="altimetria-floating-menu"> a document.body y lo re-monta entero
 * en cada notificación (key = versión del store).
 *
 * Al hacer clic en una opción se delega en la función global que ejecuta la
 * acción (por índice), la cual cierra el menú. El cierre por clic fuera y
 * Escape sigue gestionándose en vanilla consultando el elemento en el DOM. La
 * posición se ajusta al viewport tras el primer render (useLayoutEffect).
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

function notificarMenuAltimetria() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarMenuAltimetria = notificarMenuAltimetria;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosMenuAltimetria === 'function' ? u.datosMenuAltimetria() : null;
}

function MenuContenido({ items, x, y }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > w.innerWidth - 4) left = w.innerWidth - rect.width - 4;
    if (top + rect.height > w.innerHeight - 4) top = w.innerHeight - rect.height - 4;
    left = Math.max(4, left);
    top = Math.max(4, top);
    setPos({ left, top });
  }, [x, y]);

  return (
    <div
      className="altimetria-floating-menu"
      ref={ref}
      style={{ display: 'flex', left: pos ? pos.left : x, top: pos ? pos.top : y }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          className="altimetria-menu-btn"
          onClick={() => {
            const u = _ui();
            if (u && typeof u.ejecutarMenuAltimetria === 'function') u.ejecutarMenuAltimetria(i);
          }}
        >
          {item.texto}
        </button>
      ))}
    </div>
  );
}

function PortalMenu() {
  const datos = _datos();
  if (!datos || !datos.items || !datos.items.length) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      <MenuContenido items={datos.items} x={datos.x} y={datos.y} />
    </Fragment>,
    document.body
  );
}

export default function MenuAltimetria() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalMenu />;
}