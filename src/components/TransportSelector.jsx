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
 * Mantiene los mismos ids/clases que el original para no tocar el CSS.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../bridge';

const T = () => (typeof window !== 'undefined' ? window.TransportConfigModule : undefined);

function _estiloMascara(path) {
  return {
    width: '26px',
    height: '26px',
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

export default function TransportSelector() {
  const [abierto, setAbierto] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  const [peticion, setPeticion] = useState(null);
  const [activo, setActivo] = useState('');
  const [color, setColor] = useState('#1c1c1c');
  const rootRef = useRef(null);

  // Escucha al puente: abrir/cerrar pedidos desde el código vanilla.
  useEffect(() => {
    const b = window.SimbiosisUI;
    if (!b) return;
    const abrir = (dato) => {
      setPeticion(dato || {});
      setAbierto(true);
    };
    const cerrar = () => setAbierto(false);
    b.on('transport-selector:abrir', abrir);
    b.on('transport-selector:cerrar', cerrar);
    return () => {
      b.off('transport-selector:abrir', abrir);
      b.off('transport-selector:cerrar', cerrar);
    };
  }, []);

  // Refresca el estado activo al abrir o al cambiar vehículo/color en otra parte.
  useEffect(() => {
    const t = T();
    if (!t) return;
    const refrescar = () => {
      setActivo(t.esHiking() ? t.getIconoHiking() : t.getIcono());
      setColor(t.getColor());
    };
    refrescar();
    if (typeof t.setOnCambio === 'function') t.setOnCambio(refrescar);
  }, []);

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

  // Cierra con Escape o clic fuera del selector.
  // Se usa 'mousedown' en lugar de 'click' para evitar que el mismo clic que
  // abre el selector (en el mapa o la altimetría) cierre inmediatamente el
  // panel: mousedown se dispara antes de que el clic se propague al document.
  useEffect(() => {
    if (!abierto) return;
    const alClic = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setAbierto(false);
    };
    const alTecla = (e) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alTecla);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alTecla);
    };
  }, [abierto]);

  const t = T();
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
          onClick={() => setAbierto(false)}
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
