/**
 * src/components/BuscarLugarLista.jsx
 * ---------------------------------------------------------------------------
 * Lista de resultados del buscador global de lugares (js/buscarLugar.js) en
 * React. El <ul id="buscar-lugar-lista"> ya existe en la cáscara
 * (MapaFull.jsx) y React monta los <li> por portal, re-montando entero en
 * cada notificación vanilla (key = versión del store), igual que el
 * innerHTML='' que hacía renderLista.
 *
 * Todo lo demás sigue siendo vanilla: apertura/cierre de la caja y de la lupa,
 * focus/select del input, búsqueda e índice (sin debounce), navegación con
 * teclado (Enter/Arrows/Escape), Ctrl+F y click-outside. React solo pinta los
 * resultados (con la clase --activo derivada del snapshot) y, al hacer clic,
 * delega en la función global que selecciona el resultado (centra el mapa).
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

function notificarBuscarLugar() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarBuscarLugar = notificarBuscarLugar;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosBuscarLugar === 'function' ? u.datosBuscarLugar() : null;
}

function ItemLugar({ r, idx, primero, activo }) {
  return (
    <li
      className={
        'buscar-lugar__item' +
        (primero ? ' buscar-lugar__item--first' : '') +
        (activo ? ' buscar-lugar__item--activo' : '')
      }
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const u = _ui();
        if (u && typeof u.seleccionarBuscarLugar === 'function') u.seleccionarBuscarLugar(idx);
      }}
    >
      <span className="buscar-lugar__item-nombre">{r.nombre}</span>
      <span className="buscar-lugar__item-tipo">{r.tipo + (r.subtitulo ? ' · ' + r.subtitulo : '')}</span>
    </li>
  );
}

function ListaBuscarLugar() {
  const datos = _datos();
  const cont = w.document && w.document.getElementById('buscar-lugar-lista');
  if (!datos || !datos.resultados || !datos.resultados.length || !cont) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      {datos.resultados.map((r, i) => (
        <ItemLugar key={String(r.nombre) + '-' + String(r.tipo) + '-' + i} r={r} idx={i} primero={i === 0} activo={i === datos.activoIndex} />
      ))}
    </Fragment>,
    cont
  );
}

export default function BuscarLugarLista() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <ListaBuscarLugar />;
}