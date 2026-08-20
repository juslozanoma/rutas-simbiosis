/**
 * src/components/TourDestinosLista.jsx
 * ---------------------------------------------------------------------------
 * Lista de destinos elegidos en el modo tour, en React. Vanilla
 * (js/tour.js:_renderTourDestinos) guarda el snapshot con los destinos y sus
 * conteos de sitios activos; React porta los <li> a <ul id="tour-destinos-lista">
 * y re-monta la lista entera en cada notificación (key = versión del store).
 *
 * Al hacer clic en una fila se delega en la función global que centra el mapa
 * en ese destino (y marca la fila activa localmente, que se limpia en el
 * siguiente re-render igual que antes). El botón × quita el destino.
 * ---------------------------------------------------------------------------
 */
import { Fragment, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarTourDestinos() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarTourDestinos = notificarTourDestinos;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosTourDestinos === 'function' ? u.datosTourDestinos() : null;
}

function centrarDestino(id) {
  const u = _ui();
  if (u && typeof u.centrarDestinoTour === 'function') u.centrarDestinoTour(id);
}

function quitarDestino(id) {
  const u = _ui();
  if (u && typeof u.quitarDestinoTour === 'function') u.quitarDestinoTour(id);
}

function ListaContenido({ destinos }) {
  const [activoId, setActivoId] = useState(null);
  return (
    <Fragment>
      {destinos.map((d) => (
        <li
          key={d.id}
          className={'tour-destino-item' + (String(d.id) === String(activoId) ? ' tour-destino-item--activo' : '')}
          onClick={() => {
            setActivoId(d.id);
            centrarDestino(d.id);
          }}
        >
          <span className="tour-destino-item__info">
            <span className="tour-destino-item__nombre">{d.nombre}</span>
            <span className="tour-destino-item__meta">{d.departamento}</span>
          </span>
          <span className="tour-destino-item__count">({d.conteo})</span>
          <button
            type="button"
            className="tour-destino-item__btn"
            title="Quitar destino"
            aria-label={'Quitar ' + d.nombre}
            onClick={(evt) => {
              evt.stopPropagation();
              quitarDestino(d.id);
            }}
          >
            &times;
          </button>
        </li>
      ))}
    </Fragment>
  );
}

function PortalLista() {
  const datos = _datos();
  if (!datos || !datos.destinos || !datos.destinos.length) return null;
  const cont = document.getElementById('tour-destinos-lista');
  if (!cont) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      <ListaContenido destinos={datos.destinos} />
    </Fragment>,
    cont
  );
}

export default function TourDestinosLista() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalLista />;
}