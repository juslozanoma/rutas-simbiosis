/**
 * src/components/PopupSitio.jsx
 * ---------------------------------------------------------------------------
 * Ficha de sitio turístico sobre el mapa en React. El contenedor
 * .sitio-overlay lo monta vanilla (js/tourism.js:_montarCuadroCentrado) con
 * el posicionamiento (centrado en PC, hoja inferior en móvil); React pinta el
 * contenido .popup-sitio por portal y re-monta entero en cada notificación
 * vanilla (key = versión del store), replicando el HTML que antes se clonaba
 * de <template id="tpl-popup-sitio">.
 *
 * El cuadro de información genérico (paradas, escalas, aeropuertos, puertos,
 * municipios…) lo renderiza CuadroInfo.jsx; aquí solo la ficha de sitio
 * turístico. Acciones: botón × cierra (cerrarPopupSitio) y el
 * botón "Agregar a la ruta" delega en la función global (agregarParadaDesdePopup).
 * ---------------------------------------------------------------------------
 */
import { Fragment, useRef, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarPopupSitio() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarPopupSitio = notificarPopupSitio;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosPopupSitio === 'function' ? u.datosPopupSitio() : null;
}

function FichaSitio({ sitio, color }) {
  const btnRef = useRef(null);
  const distTxt = sitio.distanciaCorredorKm != null
    ? `A ${sitio.distanciaCorredorKm.toFixed(1)} km del corredor · ~${Math.round(sitio.tiempoDesvioMin)} min de desvío`
    : '';
  return (
    <div className="popup-sitio">
      <button
        type="button"
        className="popup-sitio__close"
        title="Cerrar"
        onClick={() => {
          const u = _ui();
          if (u && typeof u.cerrarPopupSitio === 'function') u.cerrarPopupSitio();
        }}
      >
        &times;
      </button>
      <span className="popup-sitio__cat" style={{ background: color + '22', color }}>{sitio.categoria}</span>
      <h3 className="popup-sitio__nombre">{sitio.nombre}</h3>
      <p className="popup-sitio__ciudad" />
      <p className="popup-sitio__ubicacion">{sitio.municipio}, {sitio.departamento}</p>
      <p className="popup-sitio__desc">{sitio.descripcion || ''}</p>
      <p className="popup-sitio__dist mono">{distTxt}</p>
      <button
        type="button"
        ref={btnRef}
        className="popup-sitio__add"
        title="Agregar a la ruta"
        onClick={(e) => {
          e.stopPropagation();
          const u = _ui();
          if (u && typeof u.agregarParadaDesdePopup === 'function') {
            u.agregarParadaDesdePopup(sitio, btnRef.current);
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        Agregar a la ruta
      </button>
    </div>
  );
}

function Popup() {
  const datos = _datos();
  if (!datos || !datos.cont || !datos.sitio) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      <FichaSitio sitio={datos.sitio} color={datos.color} />
    </Fragment>,
    datos.cont
  );
}

export default function PopupSitio() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <Popup />;
}