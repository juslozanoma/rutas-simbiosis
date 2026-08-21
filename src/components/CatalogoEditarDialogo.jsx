/**
 * src/components/CatalogoEditarDialogo.jsx
 * ---------------------------------------------------------------------------
 * Diálogo genérico de edición de catálogo (aeropuerto / municipio /
 * departamento / sitio / frontera) en React. Vanilla (js/app.js) guarda el
 * snapshot { visible, tipo, etiqueta, campos } y notifica; React porta el
 * overlay completo a document.body. Los campos son inputs controlados con
 * estado local: al abrir (transición cerrado → abierto) se inicializan desde
 * el snapshot y se mantienen mientras el diálogo siga visible.
 * ---------------------------------------------------------------------------
 */
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

const w = window;

// ---- Store del puente: vanilla notifica para re-renderizar ------------------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarDialogoCatalogo() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarDialogoCatalogo = notificarDialogoCatalogo;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosDialogoCatalogo === 'function' ? u.datosDialogoCatalogo() : null;
}

function Dialogo() {
  const datos = _datos();
  const visible = Boolean(datos && datos.visible);
  const prevVisible = useRef(visible);
  const [valores, setValores] = useState([]);

  useLayoutEffect(() => {
    if (visible && !prevVisible.current && datos && Array.isArray(datos.campos)) {
      setValores(datos.campos.map((c) => c.value || ''));
    }
    prevVisible.current = visible;
  }, [visible, datos]);

  if (!datos || !visible) return null;
  const u = _ui();
  const campos = Array.isArray(datos.campos) ? datos.campos : [];

  const setValor = (idx) => (e) => {
    const v = e.target.value;
    setValores((prev) => {
      const copia = prev.slice();
      copia[idx] = v;
      return copia;
    });
  };

  return createPortal(
    <div className="dialog-overlay">
      <div className="dialog">
        <h3 className="dialog__title">Editar {datos.etiqueta}</h3>
        {campos.map((c, i) => {
          const attrs = {
            autoComplete: 'off',
            autoCorrect: 'off',
            autoCapitalize: 'off',
            spellCheck: 'false',
          };
          return (
            <label key={c.key + '-' + i} className="nuevo-puerto__label">
              {c.label}
              {c.textarea ? (
                <textarea
                  className="nuevo-puerto__input"
                  rows="3"
                  value={valores[i] ?? ''}
                  onChange={setValor(i)}
                  {...attrs}
                />
              ) : (
                <input
                  type="search"
                  className="nuevo-puerto__input"
                  value={valores[i] ?? ''}
                  onChange={setValor(i)}
                  {...attrs}
                />
              )}
            </label>
          );
        })}
        <div className="dialog__actions">
          <button
            type="button"
            className="dialog__btn dialog__btn--cancel"
            onClick={() => {
              if (u && typeof u.cerrarDialogoCatalogo === 'function') u.cerrarDialogoCatalogo();
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="dialog__btn dialog__btn--save"
            onClick={() => {
              if (u && typeof u.guardarCatalogoEdit === 'function') u.guardarCatalogoEdit(valores);
            }}
          >
            Guardar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function CatalogoEditarDialogo() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <Dialogo />;
}
