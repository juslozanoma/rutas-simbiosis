/**
 * src/components/MobileSummary.jsx
 * ---------------------------------------------------------------------------
 * Barra de resumen móvil (distancia / tiempo + acciones de búsqueda, guardado
 * y pantalla completa). Vive dentro de #mobile-summary, cuyo contenedor y
 * estilos (.mobile-summary) los mantiene style.css. Los ids se conservan para
 * que el código vanilla (utilApp.js, buscarLugar.js, …) siga enlazándolos.
 * ---------------------------------------------------------------------------
 */
export default function MobileSummary() {
  return (
    <>
      <span className="stat-mobile stat-mobile--dist">
        Distancia: <strong id="stat-distancia-mobile">—</strong>
      </span>
      <span className="stat-mobile stat-mobile--sep" aria-hidden="true">·</span>
      <span className="stat-mobile stat-mobile--dur">
        Tiempo: <strong id="stat-tiempo-mobile">—</strong>
      </span>
      <div className="mobile-summary__acciones">
        <button
          type="button"
          id="btn-buscar-lugar"
          className="summary-btn"
          title="Buscar un sitio en el mapa"
          aria-label="Buscar un sitio en el mapa"
          aria-pressed="false"
        >
          <svg className="summary-btn__icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
        <button type="button" id="btn-guardar" className="summary-btn" title="Guardar el estado del mapa" aria-label="Guardar el estado del mapa">
          <img src="./icons/save.svg" alt="" width="15" height="15" style={{ filter: 'brightness(0) invert(1)' }} />
        </button>
        <button
          type="button"
          id="btn-fullscreen"
          className="summary-btn"
          title="Pantalla completa"
          aria-label="Activar o desactivar pantalla completa"
        >
          <svg className="summary-btn__icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </svg>
        </button>
      </div>
    </>
  );
}
