/**
 * src/components/NuevoPuertoDialogo.jsx
 * ---------------------------------------------------------------------------
 * Diálogo "Agregar/Editar puerto" (clic derecho en el mapa) en React. Vanilla
 * (js/app.js) guarda el snapshot con visible/editando/valores/error y notifica;
 * React porta el overlay completo a document.body. Los campos son inputs
 * controlados con estado local: al abrir (transición cerrado → abierto) se
 * inicializan desde el snapshot y el error llega del snapshot (así no se
 * pierde lo escrito cuando la validación falla). Guardar y Cancelar se
 * delegan en los puentes guardarNuevoPuerto/cerrarDialogoNuevoPuerto.
 * ---------------------------------------------------------------------------
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarDialogoNuevoPuerto() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarDialogoNuevoPuerto = notificarDialogoNuevoPuerto;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosDialogoNuevoPuerto === 'function' ? u.datosDialogoNuevoPuerto() : null;
}

const VACIO = { nombre: '', ciudad: '', rio: '', descripcion: '' };

function Dialogo() {
  const datos = _datos();
  const visible = Boolean(datos && datos.visible);
  const prevVisible = useRef(visible);
  const [valores, setValores] = useState(VACIO);

  useLayoutEffect(() => {
    // Al abrir (transición cerrado → abierto) se inicializan los campos desde
    // el snapshot; las notificaciones de error no resetean lo escrito.
    if (visible && !prevVisible.current && datos) {
      setValores({
        nombre: datos.valores.nombre,
        ciudad: datos.valores.ciudad,
        rio: datos.valores.rio,
        descripcion: datos.valores.descripcion,
      });
    }
    prevVisible.current = visible;
  }, [visible, datos]);

  if (!datos || !visible) return null;
  const u = _ui();
  const set = (campo) => (e) => setValores((v) => ({ ...v, [campo]: e.target.value }));

  return createPortal(
    <div className="dialog-overlay" id="panel-nuevo-puerto">
      <div className="dialog">
        <h3 className="dialog__title" id="np-titulo">{datos.editando ? 'Editar puerto' : 'Agregar puerto'}</h3>
        <p className="dialog__text">Completa los datos. Se guardará con estas coordenadas en el JSON de puertos.</p>
        <label className="nuevo-puerto__label">Nombre
          <input type="search" id="np-nombre" className="nuevo-puerto__input" placeholder="Puerto de ..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" value={valores.nombre} onChange={set('nombre')} autoFocus />
        </label>
        <label className="nuevo-puerto__label">Ciudad
          <input type="search" id="np-ciudad" className="nuevo-puerto__input" placeholder="Ciudad (Departamento)" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" value={valores.ciudad} onChange={set('ciudad')} />
        </label>
        <label className="nuevo-puerto__label">Río
          <input type="search" id="np-rio" className="nuevo-puerto__input" placeholder="Río ..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" value={valores.rio} onChange={set('rio')} />
        </label>
        <label className="nuevo-puerto__label">Descripción
          <textarea id="np-descripcion" className="nuevo-puerto__input nuevo-puerto__input--area" rows="3" placeholder="Descripción del puerto" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" value={valores.descripcion} onChange={set('descripcion')}></textarea>
        </label>
        {datos.error && <p className="dialog__error" id="np-error">{datos.error}</p>}
        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__btn dialog__btn--cancel"
            id="np-cancelar"
            onClick={() => {
              if (u && typeof u.cerrarDialogoNuevoPuerto === 'function') u.cerrarDialogoNuevoPuerto();
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="dialog__btn dialog__btn--save"
            id="np-guardar"
            onClick={() => {
              if (u && typeof u.guardarNuevoPuerto === 'function') u.guardarNuevoPuerto(valores);
            }}
          >
            {datos.editando ? 'Guardar cambios' : 'Guardar puerto'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function NuevoPuertoDialogo() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <Dialogo />;
}