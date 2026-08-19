/**
 * src/components/shell/BarraMovil.jsx
 * ---------------------------------------------------------------------------
 * Barra de pestañas inferior móvil (nav#mobile-tab-bar) convertida a React
 * como cáscara estática: mismo DOM con los mismos ids y clases para que la
 * lógica vanilla (core.js, rutas.js, altimetriaApp.js…) siga enlazando igual.
 *
 * IMPORTANTE: componente memoizado y sin props. React lo renderiza una sola
 * vez y nunca vuelve a tocar su DOM, de modo que las mutaciones que hace el
 * código vanilla en estos nodos (hidden, aria-pressed, clases…) se conservan.
 * ---------------------------------------------------------------------------
 */
import { memo } from 'react';

function BarraMovil() {
  return (
    <nav className="mobile-tab-bar" id="mobile-tab-bar">
      <button type="button" id="btn-tab-altimetria" className="mobile-tab-btn mobile-tab-btn--altimetria" title="Perfil de elevación" aria-label="Perfil de elevación">
        <span className="tab-icon tab-icon--bike tab-icon--26" id="ico-tab-altimetria" aria-hidden="true"></span>
      </button>
      <button type="button" className="mobile-tab-btn mobile-tab-btn--active" data-tab="ruta" id="btn-tab-ruta"><span id="btn-tab-ruta-label">Rutas</span> <span className="tab-icon tab-icon--sign-post tab-icon--20" aria-hidden="true" id="ico-tab-ruta"></span>
      </button>
      <button type="button" id="btn-anadir-ruta-tab" className="mobile-tab-btn mobile-tab-btn--anadir" title="Añadir una nueva ruta" aria-label="Añadir una nueva ruta" hidden>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
      <button type="button" id="btn-cerrar-rutas-archivo" className="mobile-tab-btn mobile-tab-btn--cerrar-rutas" title="Cerrar rutas subidas y volver al menú normal" aria-label="Cerrar rutas subidas y volver al menú normal">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#d64545" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <button type="button" className="mobile-tab-btn" data-tab="descubre" id="btn-tab-descubre">
        <span>Descubre Colombia</span>
        <span className="tab-icon tab-icon--colombia tab-icon--22" aria-hidden="true" id="ico-descubre-tab"></span>
        <span className="badge-count mono" id="sitios-contador-tab" hidden>0</span>
      </button>
      <button type="button" id="btn-reiniciar-movil" className="mobile-tab-btn mobile-tab-btn--reiniciar" title="Reiniciar desde cero (borra las rutas subidas y el viaje)" aria-label="Reiniciar desde cero">
        <span className="panel-tab--reiniciar__icon" aria-hidden="true"></span>
      </button>
    </nav>
  );
}

export default memo(BarraMovil);