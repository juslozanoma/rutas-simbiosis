/**
 * src/components/CuadroInfo.jsx
 * ---------------------------------------------------------------------------
 * Ficha informativa genérica sobre el mapa (paradas, escalas, extremos,
 * aeropuertos, puertos, departamentos y municipios) en React. Comparte el
 * contenedor .sitio-overlay con PopupSitio: lo monta vanilla
 * (js/tourism.js:_montarCuadroCentrado) con el posicionamiento; React pinta el
 * contenido .popup-sitio por portal y re-monta entero en cada notificación
 * (key = versión del store).
 *
 * Vanilla (js/tourism.js:mostrarCuadroInfo) guarda un snapshot normalizado y
 * los botones llegan como descriptores { etiqueta, clase, accion }; React los
 * renderiza y delega al hacer clic. El botón de cabecera ("Mostrar sitios
 * turísticos", etc.) también se delega. El cierre (×) llama a cerrarPopupSitio.
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

function notificarCuadroInfo() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarCuadroInfo = notificarCuadroInfo;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosCuadroInfo === 'function' ? u.datosCuadroInfo() : null;
}

function ejecutarCabecera() {
  const u = _ui();
  if (u && typeof u.ejecutarCabeceraCuadro === 'function') u.ejecutarCabeceraCuadro();
}

function CuadroContenido({ info }) {
  const partes = [];
  if (info.poblacion) partes.push(info.poblacion + ' habitantes');
  if (info.superficie_total) partes.push(info.superficie_total);
  const conCabecera = info.botonCabecera && info.botonCabecera.etiqueta;
  return (
    <div className="popup-sitio">
      {!info.categoria && !info.rio && conCabecera && (
        <button type="button" className="popup-sitio__header-btn" onClick={ejecutarCabecera}>{info.botonCabecera.etiqueta}</button>
      )}
      {(info.categoria || info.rio) && (
        <div className="popup-sitio__head">
          {info.categoria && (
            <span className="popup-sitio__cat" style={{ background: info.color + '22', color: info.color }}>{info.categoria}</span>
          )}
          {info.altura && <span className="popup-sitio__stat">{info.altura}</span>}
          {info.temperatura && <span className="popup-sitio__stat">{info.temperatura}</span>}
          {info.rio && <span className="popup-sitio__rio">{info.rio}</span>}
          {conCabecera && (
            <button type="button" className="popup-sitio__header-btn" onClick={ejecutarCabecera}>{info.botonCabecera.etiqueta}</button>
          )}
        </div>
      )}
      <div className="popup-sitio__fila-titulo">
        <h3 className="popup-sitio__nombre">{info.nombre}</h3>
        <button
          type="button"
          className="popup-sitio__close"
          title="Cerrar"
          aria-label="Cerrar"
          onClick={() => {
            const u = _ui();
            if (u && typeof u.cerrarPopupSitio === 'function') u.cerrarPopupSitio();
          }}
        >
          &times;
        </button>
      </div>
      {partes.length > 0 && <div className="popup-sitio__datos">{partes.join(' · ')}</div>}
      {info.ciudad && <p className="popup-sitio__ciudad">{info.ciudad}</p>}
      {info.ubicacion && <p className="popup-sitio__ubicacion">{info.ubicacion}</p>}
      {info.descripcion && <p className="popup-sitio__desc">{info.descripcion}</p>}
      {info.dist && <p className="popup-sitio__dist mono">{info.dist}</p>}
      {info.botones && info.botones.length > 0 && (
        <div className="popup-sitio__acciones">
          {info.botones.map((b, i) => (
            <button
              key={i}
              type="button"
              className={b.clase || 'popup-sitio__add'}
              onClick={() => {
                const u = _ui();
                if (u && typeof u.ejecutarBotonCuadro === 'function') u.ejecutarBotonCuadro(i);
              }}
            >
              {b.etiqueta}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PortalCuadro() {
  const datos = _datos();
  if (!datos || !datos.cont || !datos.info) return null;
  return createPortal(
    <Fragment key={VERSION.n}>
      <CuadroContenido info={datos.info} />
    </Fragment>,
    datos.cont
  );
}

export default function CuadroInfo() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalCuadro />;
}