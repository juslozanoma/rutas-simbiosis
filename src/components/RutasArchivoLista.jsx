/**
 * src/components/RutasArchivoLista.jsx
 * ---------------------------------------------------------------------------
 * Lista de rutas cargadas desde archivos (tecla K) en React. Vanilla
 * (js/rutaArchivo.js:_renderTarjetas) guarda el snapshot con los descriptores
 * de cada ficha y desmonta primero la lista de paradas (notificarListaRuta);
 * React porta los <li> a <ul id="paradas-lista"> y re-monta el listado entero
 * en cada notificación (key = versión del store).
 *
 * Solo monta cuando el modo de lista es 'archivo'
 * (window.SimbiosisUI.modoListaRuta()). Cada ficha tiene: ojo (mostrar/ocultar
 * en el mapa), X (quitar de la memoria) y clic (mostrar ruta + altimetría).
 * El clic derecho / pulsación larga abre el menú contextual (abrirMenuFila).
 * ---------------------------------------------------------------------------
 */
import { Fragment, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarRutasArchivo() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarRutasArchivo = notificarRutasArchivo;

function _ui() {
  return w.SimbiosisUI || null;
}

function _modoArchivo() {
  const u = _ui();
  return !!(u && typeof u.modoListaRuta === 'function' && u.modoListaRuta() === 'archivo');
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosRutasArchivo === 'function' ? u.datosRutasArchivo() : null;
}

/** Clic sintético posterior a una pulsación larga (iOS): se ignora para no
 *  abrir la altimetría ni cerrar el menú (contrato con la bandera
 *  `_suprimirProximoClic` de js/core.js). */
function _consumirClic() {
  const u = _ui();
  return !!(u && typeof u.consumirClicSintetico === 'function' && u.consumirClicSintetico());
}

/** Pulsación larga en móvil sobre una ficha (js/paradas.js:engancharLongPress):
 *  abre el menú contextual igual que el clic derecho. */
function usePulsacionLarga(alDisparar) {
  const ref = useRef(null);
  const cbRef = useRef(alDisparar);
  cbRef.current = alDisparar;
  useLayoutEffect(() => {
    const li = ref.current;
    if (!li || typeof w.engancharLongPress !== 'function') return;
    w.engancharLongPress(li, (evt) => cbRef.current(evt));
  }, []);
  return ref;
}

function OjoSvg({ oculta }) {
  if (oculta) {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function Tarjeta({ item }) {
  const u = _ui();
  const clase = 'sitio-card'
    + (item.oculta ? ' sitio-card--ruta-oculta' : '')
    + (item.enUnir && item.unirActiva ? ' sitio-card--unir-seleccionada' : '');
  const tituloOjo = item.oculta ? 'Mostrar en el mapa' : 'Ocultar del mapa';
  const ref = usePulsacionLarga((evt) => {
    if (u && typeof u.abrirMenuTarjetaRutaArchivo === 'function') {
      u.abrirMenuTarjetaRutaArchivo(item.id, evt.clientX, evt.clientY);
    }
  });
  return (
    <li
      ref={ref}
      className={clase}
      data-ruta-archivo-id={item.id}
      onClick={() => {
        if (_consumirClic()) return;
        if (u && typeof u.clicTarjetaRutaArchivo === 'function') u.clicTarjetaRutaArchivo(item.id);
      }}
      onContextMenu={(evt) => {
        evt.preventDefault();
        if (u && typeof u.abrirMenuTarjetaRutaArchivo === 'function') {
          u.abrirMenuTarjetaRutaArchivo(item.id, evt.clientX, evt.clientY);
        }
      }}
    >
      <div className="sitio-card__top">
        <span className="sitio-card__nombre">
          <span className="sitio-card__dot" style={{ background: item.color }} />
          {item.enUnir
            ? (item.unirActiva
                ? <span className="sitio-card__num-badge sitio-card__num-badge--uno">1</span>
                : <span className="sitio-card__num-badge sitio-card__num-badge--dos">2</span>)
            : <span className="sitio-card__num">{item.pos}.</span>}
          &nbsp;{item.nombre}
        </span>
        <div className="sitio-card__top-right">
          <button
            type="button"
            className="sitio-card__ojo"
            title={tituloOjo}
            aria-label={tituloOjo}
            aria-pressed={!item.oculta}
            onClick={(evt) => {
              evt.stopPropagation();
              if (u && typeof u.alternarVisibilidadRutaArchivo === 'function') {
                u.alternarVisibilidadRutaArchivo(item.id);
              }
            }}
          >
            <OjoSvg oculta={item.oculta} />
          </button>
          <button
            type="button"
            className="sitio-card__quitar"
            title="Quitar ruta de la memoria"
            aria-label="Quitar ruta de la memoria"
            onClick={(evt) => {
              evt.stopPropagation();
              if (u && typeof u.quitarRutaArchivo === 'function') u.quitarRutaArchivo(item.id);
            }}
          >
            &times;
          </button>
        </div>
      </div>
      <p className="sitio-card__ciudad">{item.km.toFixed(1)} km totales</p>
    </li>
  );
}

function PortalLista() {
  const datos = _datos();
  if (!_modoArchivo() || !datos || !datos.items) return null;
  const cont = document.getElementById('paradas-lista');
  if (!cont) return null;
  if (!datos.items.length) {
    return createPortal(<Fragment key={VERSION.n} />, cont);
  }
  return createPortal(
    <Fragment key={VERSION.n}>
      {datos.items.map((item) => <Tarjeta key={item.id} item={item} />)}
    </Fragment>,
    cont
  );
}

export default function RutasArchivoLista() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return <PortalLista />;
}