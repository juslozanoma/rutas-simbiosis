/**
 * src/components/CategoriasGrid.jsx
 * ---------------------------------------------------------------------------
 * Grid de categorías (chips de filtro) del panel Descubre Colombia en React.
 * El contenedor #categorias-grid ya existe en la cáscara (PanelLateral.jsx,
 * dentro del dropdown de categorías) y React monta los chips por portal,
 * re-montando entero en cada notificación vanilla (key = versión del store),
 * igual que el innerHTML='' que hacía renderizarCategoriasMenu de
 * js/descubre.js.
 *
 * El estado de selección lo decide el snapshot (state.categoriasSeleccionadas
 * filtrado por descubre.js); al hacer clic, el chip delega en la función
 * global que alterna la categoría. El resto del dropdown (abrir/cerrar) sigue
 * siendo vanilla.
 * ---------------------------------------------------------------------------
 */
import { Fragment, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarCategorias() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarCategorias = notificarCategorias;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosCategorias === 'function' ? u.datosCategorias() : null;
}

function ChipCategoria({ cat, n, selected }) {
  return (
    <span
      className={'categoria-chip' + (selected ? ' categoria-chip--selected' : '')}
      onClick={() => {
        const u = _ui();
        if (u && typeof u.toggleCategoriaDescubre === 'function') u.toggleCategoriaDescubre(cat);
      }}
    >
      {n > 0 ? cat + ' (' + n + ')' : cat}
    </span>
  );
}

function GridCategorias() {
  const datos = _datos();
  const cont = w.document && w.document.getElementById('categorias-grid');
  if (!datos || !cont) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      {datos.map((c) => (
        <ChipCategoria key={c.cat} cat={c.cat} n={c.n} selected={c.selected} />
      ))}
    </Fragment>,
    cont
  );
}

export default function CategoriasGrid() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <GridCategorias />;
}