/**
 * src/components/AltimetriaSegmentos.jsx
 * ---------------------------------------------------------------------------
 * Botones numerados de segmentos (tramos en carro) del perfil de elevación en
 * React. Los contenedores #altimetria-segmentos y #altimetria-segmentos-panel
 * ya existen en la cáscara (MapaFull.jsx y PanelLateral.jsx); React monta los
 * botones por portal en ambos y re-monta entero en cada notificación vanilla
 * (key = versión del store), igual que el innerHTML='' que hacía
 * _renderSegmentosHeader de js/altimetria.js.
 *
 * Vanilla sigue decidiendo la visibilidad de los contenedores (hidden) y todo
 * el motor SVG (zoom, drag, hover, comparación VS) queda intacto. Al hacer
 * clic, el botón delega en la función global que cambia el segmento activo.
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

function notificarAltimetriaSegmentos() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarAltimetriaSegmentos = notificarAltimetriaSegmentos;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosAltimetriaSegmentos === 'function' ? u.datosAltimetriaSegmentos() : null;
}

function BotonSegmento({ i, activo }) {
  const n = i + 1;
  return (
    <button
      type="button"
      className={'altimetria__segmento' + (activo ? ' altimetria__segmento--activo' : '')}
      title={'Segmento en carro ' + n}
      aria-label={'Segmento en carro ' + n}
      onClick={() => {
        const u = _ui();
        if (u && typeof u.setSegmentoAltimetria === 'function') u.setSegmentoAltimetria(i);
      }}
    >
      {String(n)}
    </button>
  );
}

function Segmentos() {
  const datos = _datos();
  if (!datos || !datos.nSegmentos || datos.nSegmentos <= 1) return null;
  const ids = ['altimetria-segmentos', 'altimetria-segmentos-panel'];
  return (
    <Fragment key={VERSION.n}>
      {ids.map((id) => {
        const cont = w.document && w.document.getElementById(id);
        if (!cont) return null;
        return createPortal(
          <Fragment>
            {Array.from({ length: datos.nSegmentos }, (_, i) => (
              <BotonSegmento key={i} i={i} activo={i === datos.segmentoActivo} />
            ))}
          </Fragment>,
          cont
        );
      })}
    </Fragment>
  );
}

export default function AltimetriaSegmentos() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <Segmentos />;
}