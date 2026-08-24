/**
 * src/components/TransportSelector.jsx
 * ---------------------------------------------------------------------------
 * Selector flotante de vehículo (ícono + color) de la ruta terrestre.
 *
 * Antes vivía en js/transport.js construyendo su DOM a mano. Ahora es React y
 * se comunica con la app vanilla mediante el puente `window.SimbiosisUI`:
 *   - vanilla emite 'transport-selector:abrir' { clientX, clientY } / ':cerrar'
 *   - este componente selecciona llamando a `TransportConfigModule.setIcono`,
 *     `setIconoHiking` o `setColor`, y se refresca con `setOnCambio`.
 *
 * La escucha del puente vive a NIVEL DE MÓDULO (no en un useEffect): queda
 * registrada apenas se evalúa este archivo, antes de que corra cualquier
 * script clásico, y el panel se abre con flushSync dentro del mismo evento
 * que lo pide (inmune a remontajes/HMR y a carreras con oyentes del document).
 *
 * Mantiene las mismas clases que el original para no tocar el CSS.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

const T = () => (typeof window !== 'undefined' ? window.TransportConfigModule : undefined);

// Marcador de versión de este componente (diagnóstico en consola).
if (typeof window !== 'undefined') window.SIMBIOSIS_TS_V = 'ts2';

function _estiloMascara(path) {
  return {
    width: '26px',
    height: '26px',
    // Sin fondo la máscara no muestra nada: el glifo se recorta del color.
    backgroundColor: '#14201b',
    WebkitMaskImage: "url('" + path + "')",
    WebkitMaskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    WebkitMaskSize: 'contain',
    maskImage: "url('" + path + "')",
    maskRepeat: 'no-repeat',
    maskPosition: 'center',
    maskSize: 'contain',
  };
}

// ---- Store del puente: vanilla pide abrir/cerrar y React repinta ------------

const VERSION = { n: 0 };
let suscriptor = null;
let estado = { abierto: false, peticion: null };

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

/** Repinta sincrónicamente (flushSync): el panel existe en el DOM antes de que
 *  el evento en curso termine de propagarse por el document. Si flushSync no
 *  está disponible en este contexto, cae a un repintado normal para no perder
 *  el pedido de apertura/cierre. */
function _repintar() {
  const pintar = () => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  };
  try {
    flushSync(pintar);
  } catch (e) {
    pintar();
  }
}

function _cerrarPanel() {
  if (!estado.abierto && !estado.peticion) return;
  estado = { abierto: false, peticion: null };
  _repintar();
}

// Engancha el repintado del panel a los cambios de vehículo/color hechos en
// cualquier parte. Se llama al abrir (el módulo clásico ya existe entonces);
// el flag evita registrar el callback más de una vez.
let cambiosEnganchados = false;

function _engancharCambios() {
  const mod = T();
  if (!mod || cambiosEnganchados || typeof mod.setOnCambio !== 'function') return;
  cambiosEnganchados = true;
  mod.setOnCambio(_repintar);
}

// Registro a nivel de módulo: corre una sola vez, al importar este archivo.
bridge.on('transport-selector:abrir', (dato) => {
  _engancharCambios();
  estado = { abierto: true, peticion: dato || {} };
  _repintar();
});
bridge.on('transport-selector:cerrar', () => {
  _cerrarPanel();
});

export default function TransportSelector() {
  useSyncExternalStore(subscribirse, () => VERSION.n);

  const [pos, setPos] = useState({ left: 0, top: 0 });
  const rootRef = useRef(null);

  const t = T();
  const abierto = estado.abierto;
  const peticion = estado.peticion;
  // Vehículo y color activos se leen del módulo en cada render (no en estado
  // local): así el resaltado siempre refleja el valor real al abrirse y tras
  // cada selección (el enganche _engancharCambios dispara el repintado).
  const activo = t ? (t.esHiking() ? t.getIconoHiking() : t.getIcono()) : '';
  const color = t ? t.getColor() : '#1c1c1c';

  // Al abrir, mide el selector y lo posiciona cerca del clic (mismo recorte
  // que el original: nunca se sale de la ventana).
  useLayoutEffect(() => {
    if (!abierto) return;
    const el = rootRef.current;
    const sw = el ? el.offsetWidth || 236 : 236;
    const sh = el ? el.offsetHeight || 320 : 320;
    setPos({
      left: Math.max(6, Math.min(peticion && peticion.clientX || 0, window.innerWidth - sw - 6)),
      top: Math.max(6, Math.min(peticion && peticion.clientY || 0, window.innerHeight - sh - 6)),
    });
  }, [abierto, peticion]);

  // Cierra con Escape o puntero fuera del selector.
  // 'pointerdown' en fase de captura (respaldo 'mousedown'): el down ocurre
  // antes del click que pudo abrir el panel y no se sintetiza tras touchend,
  // así ningún resto de la interacción que abrió lo cierra. La ventana de
  // gracia de 450 ms cubre además pulsaciones largas y re-tocar el ícono.
  useEffect(() => {
    if (!abierto) return;
    const apertura = Date.now();
    const tipoDown = typeof window !== 'undefined' && window.PointerEvent ? 'pointerdown' : 'mousedown';
    const alCerrar = (e) => {
      if (Date.now() - apertura < 450) return;
      if (rootRef.current && !rootRef.current.contains(e.target)) _cerrarPanel();
    };
    const alTecla = (e) => {
      if (e.key === 'Escape') _cerrarPanel();
    };
    document.addEventListener(tipoDown, alCerrar, true);
    document.addEventListener('keydown', alTecla);
    return () => {
      document.removeEventListener(tipoDown, alCerrar, true);
      document.removeEventListener('keydown', alTecla);
    };
  }, [abierto]);

  if (!t) return null;

  const seleccionarIcono = (file) => {
    if (t.esHiking()) t.setIconoHiking(file);
    else t.setIcono(file);
  };

  return createPortal(
    <div
      ref={rootRef}
      className="transport-selector"
      hidden={!abierto}
      style={{ left: pos.left + 'px', top: pos.top + 'px' }}
    >
      <div className="transport-selector__encabezado">
        <div className="transport-selector__titulo">Vehículo</div>
        <button
          type="button"
          className="transport-selector__cerrar"
          title="Cerrar"
          aria-label="Cerrar selector de vehículo"
          onClick={() => _cerrarPanel()}
        >
          ×
        </button>
      </div>
      <div className="transport-selector__iconos">
        {t.ICONOS.map((icono) => (
          <button
            key={icono.file}
            type="button"
            className={'transport-selector__icono' + (activo === icono.file ? ' transport-selector__icono--activo' : '')}
            title={icono.nombre}
            data-file={icono.file}
            onClick={() => seleccionarIcono(icono.file)}
          >
            <div style={_estiloMascara(icono.path)} />
          </button>
        ))}
      </div>
      <div className="transport-selector__titulo">Color</div>
      <div className="transport-selector__colores">
        {t.COLORES.map((c) => (
          <button
            key={c.hex}
            type="button"
            className={'transport-selector__color' + (color === c.hex ? ' transport-selector__color--activo' : '')}
            title={c.nombre}
            data-hex={c.hex}
            style={{ backgroundColor: c.hex }}
            onClick={() => t.setColor(c.hex)}
          />
        ))}
      </div>
    </div>,
    document.body
  );
}
