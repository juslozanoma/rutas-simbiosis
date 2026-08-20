/**
 * src/components/InfraListado.jsx
 * ---------------------------------------------------------------------------
 * Catálogo de puertos/aeropuertos/departamentos/municipios/categorías/frontera
 * (teclas P/A/D/M/C/F) en React. Vanilla (js/paradas.js:renderizarInfraListado)
 * guarda el snapshot con los descriptores de cada tarjeta y desmonta primero la
 * lista de paradas (notificarListaRuta); React porta los <li> a
 * <ul id="paradas-lista"> y re-monta el listado entero en cada notificación
 * (key = versión del store).
 *
 * Solo monta cuando el modo de lista es 'infra' (window.SimbiosisUI.modoListaRuta()).
 * Al hacer clic en una tarjeta se delega en la función global que resuelve la
 * acción (filtro de categorías, ficha, conexiones…) según el tipo.
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

function notificarInfraListado() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarInfraListado = notificarInfraListado;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosInfraListado === 'function' ? u.datosInfraListado() : null;
}

function clicTarjeta(i) {
  const u = _ui();
  if (u && typeof u.clicTarjetaInfra === 'function') u.clicTarjetaInfra(i);
}

function Tarjeta({ item }) {
  if (item.hint) {
    return <li className="paradas-vacio">{item.texto}</li>;
  }
  const activa = item.activa ? ' sitio-card--active' : '';
  return (
    <li
      className={'sitio-card' + activa}
      data-infra-id={item.id}
      onClick={() => clicTarjeta(item.idx)}
    >
      <div className="sitio-card__top">
        <span className="sitio-card__nombre">
          <span className="sitio-card__num">{item.idx + 1}.</span>&nbsp;{item.nombre}{item.sufijo}
        </span>
        {item.rio && <span className="sitio-card__rio">{item.rio}</span>}
      </div>
      <p className="sitio-card__ciudad">{item.sub}</p>
    </li>
  );
}

function PortalLista() {
  const datos = _datos();
  if (!datos || !datos.items || !datos.items.length) return null;
  const cont = document.getElementById('paradas-lista');
  if (!cont) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      {datos.items.map((item, i) => <Tarjeta key={item.hint ? 'hint' : item.id + '-' + i} item={item} />)}
    </Fragment>,
    cont
  );
}

export default function InfraListado() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalLista />;
}