/**
 * src/components/BuscarSitiosBar.jsx
 * ---------------------------------------------------------------------------
 * Barra flotante de búsqueda de sitios cercanos (radio 0–50 km) en React.
 * Vanilla (js/map.js:_mostrarBarraBuscarSitios) es dueña del contenedor
 * `.buscar-sitios-bar` (creación, anclaje sobre el mapa y remoción); React
 * porta aquí su contenido: la etiqueta "0–X km", el deslizador de radio y la X
 * de cierre. Al mover el deslizador se delega en `aplicarRadioBuscarSitios`
 * (re-filtra el listado de la pestaña Descubre) y la X en `cerrarBuscarSitios`
 * (restaura el listado previo).
 *
 * Solo monta cuando el snapshot `datosBuscarSitios()` no es null.
 * ---------------------------------------------------------------------------
 */
import { useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarBuscarSitios() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarBuscarSitios = notificarBuscarSitios;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosBuscarSitios === 'function' ? u.datosBuscarSitios() : null;
}

function Barra() {
  const datos = _datos();
  if (!datos) return null;
  const cont = document.querySelector('.buscar-sitios-bar');
  if (!cont) return null;
  const u = _ui();
  return createPortal(
    <>
      <span className="buscar-sitios-bar__rango">0–{datos.radio} km</span>
      <input
        type="range"
        className="buscar-sitios-bar__slider"
        min="0"
        max="50"
        step="1"
        defaultValue={datos.radio}
        aria-label="Radio de búsqueda de sitios en kilómetros"
        onChange={(e) => {
          if (u && typeof u.aplicarRadioBuscarSitios === 'function') {
            u.aplicarRadioBuscarSitios(Number(e.target.value));
          }
        }}
      />
      <button
        type="button"
        className="buscar-sitios-bar__cerrar"
        aria-label="Cerrar búsqueda de sitios"
        title="Cerrar búsqueda de sitios"
        onClick={() => {
          if (u && typeof u.cerrarBuscarSitios === 'function') u.cerrarBuscarSitios();
        }}
      >
        &times;
      </button>
    </>,
    cont
  );
}

export default function BuscarSitiosBar() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <Barra />;
}