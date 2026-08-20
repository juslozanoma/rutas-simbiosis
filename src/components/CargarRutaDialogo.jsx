/**
 * src/components/CargarRutaDialogo.jsx
 * ---------------------------------------------------------------------------
 * Diálogo de carga de rutas desde archivo (tecla K) en React. Vanilla
 * (js/rutaArchivo.js) guarda el snapshot con el estado del diálogo
 * (visible, error, label, continuarVisible) y notifica; React porta el overlay
 * completo a document.body en el mismo lugar que ocupaba en la cáscara
 * estática. El input de archivo, "Continuar con la actual" y Cancelar se
 * delegan en los puentes procesarArchivosRuta/continuarRuta/cerrarDialogoRuta.
 *
 * El contenido lleva key = versión del store: cada notificación re-monta el
 * diálogo, lo que equivale a los reinicios que hacía vanilla (limpiar el
 * error, la etiqueta y el valor del input).
 * ---------------------------------------------------------------------------
 */
import { Fragment, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarDialogoCargarRuta() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarDialogoCargarRuta = notificarDialogoCargarRuta;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosDialogoCargarRuta === 'function' ? u.datosDialogoCargarRuta() : null;
}

function Dialogo() {
  const datos = _datos();
  if (!datos || !datos.visible) return null;
  const u = _ui();
  return createPortal(
    <div
      className="dialog-overlay"
      id="panel-cargar-ruta"
      onClick={(e) => {
        if (e.target === e.currentTarget && u && typeof u.cerrarDialogoRuta === 'function') {
          u.cerrarDialogoRuta();
        }
      }}
    >
      <div className="dialog" key={VERSION.n}>
        <h3 className="dialog__title">Cargar ruta</h3>
        <p className="dialog__text">Sube un archivo <strong>KML</strong> o <strong>GPX</strong> para mostrar su ruta en el mapa.</p>
        <label className="cargar-ruta__file">
          <input
            type="file"
            id="input-ruta-archivo"
            className="cargar-ruta__input-file"
            accept=".kml,.gpx,application/vnd.google-earth.kml+xml,application/gpx+xml"
            multiple
            onChange={(e) => {
              if (u && typeof u.procesarArchivosRuta === 'function') u.procesarArchivosRuta(e.target.files);
            }}
          />
          <span id="cargar-ruta-file-label">{datos.label}</span>
        </label>
        {datos.continuarVisible && (
          <button
            type="button"
            className="dialog__btn dialog__btn--save cargar-ruta__continuar"
            id="btn-continuar-ruta"
            onClick={() => {
              if (u && typeof u.continuarRuta === 'function') u.continuarRuta();
            }}
          >
            Continuar con la actual
          </button>
        )}
        {datos.error && <p className="dialog__error" id="cargar-ruta-error">{datos.error}</p>}
        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__btn dialog__btn--cancel"
            id="btn-cerrar-cargar-ruta"
            onClick={() => {
              if (u && typeof u.cerrarDialogoRuta === 'function') u.cerrarDialogoRuta();
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function CargarRutaDialogo() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <Dialogo />;
}