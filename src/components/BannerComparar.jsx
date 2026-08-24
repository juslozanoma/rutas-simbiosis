/**
 * src/components/BannerComparar.jsx
 * ---------------------------------------------------------------------------
 * Aviso de comparación de puntos del perfil (banner VS) en React. Vanilla
 * (js/altimetria.js) crea y es dueño del contenedor .comparar-banner: lo
 * ancla dentro del perfil visible o sobre el mapa, lo posiciona, lo arrastra
 * en celular y recuerda la posición elegida. React solo pinta el CONTENIDO
 * (título, estadísticas y botón de cerrar) por portal al contenedor y lo
 * re-monta entero en cada notificación (key = versión del store).
 *
 * El botón "cerrar" delega en la función global que termina la comparación; el
 * arrastre del aviso sigue gestionándose en vanilla sobre el contenedor.
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

function notificarBannerComparar() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarBannerComparar = notificarBannerComparar;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosBannerComparar === 'function' ? u.datosBannerComparar() : null;
}

function BannerContenido({ banner }) {
  return (
    <Fragment>
      <span className="comparar-banner__titulo">{banner.titulo}</span>
      {banner.stats && <span className="comparar-banner__stats">{banner.stats}</span>}
      <button
        type="button"
        className="comparar-banner__cerrar"
        aria-label="Terminar comparación"
        onClick={() => {
          const u = _ui();
          if (u && typeof u.cerrarBannerComparar === 'function') u.cerrarBannerComparar();
        }}
      >
        cerrar
      </button>
    </Fragment>
  );
}

function PortalBanner() {
  const datos = _datos();
  if (!datos || !datos.cont || !datos.banner) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      <BannerContenido banner={datos.banner} />
    </Fragment>,
    datos.cont
  );
}

export default function BannerComparar() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalBanner />;
}