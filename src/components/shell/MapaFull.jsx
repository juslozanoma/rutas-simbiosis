/**
 * src/components/shell/MapaFull.jsx
 * ---------------------------------------------------------------------------
 * Zona del mapa a pantalla completa (main.map-full) convertida a React como
 * cáscara estática: mismo DOM con los mismos ids/clases para que la lógica
 * vanilla (map.js, altimetria.js, buscarLugar.js…) siga enlazando igual.
 *
 * IMPORTANTE: componente memoizado y sin props. React lo renderiza una sola
 * vez y nunca vuelve a tocar su DOM, de modo que las mutaciones que hace el
 * código vanilla en estos nodos (hidden, innerHTML, clases…) se conservan.
 * ---------------------------------------------------------------------------
 */
import { memo } from 'react';
import MobileSummary from '../MobileSummary';

function MapaFull() {
  return (
    <main className="map-full">
      <div className="mobile-summary" id="mobile-summary">
        <MobileSummary />
      </div>
      <div className="seguir-ruta" id="seguir-ruta" hidden>
        <span className="seguir-ruta__dot" aria-hidden="true"></span>
        <span id="seguir-ruta-contenido">Seguir ruta</span>
      </div>
      <div id="map" role="application" aria-label="Mapa interactivo de la ruta y los sitios turísticos"></div>
      {/* Cuadro de búsqueda global (se despliega bajo la barra superior) */}
      <div className="buscar-lugar" id="buscar-lugar" hidden>
        <div className="buscar-lugar__barra">
          <input type="search" id="buscar-lugar-input" className="buscar-lugar__input" placeholder="Busca cualquier sitio aquí…" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" aria-label="Buscar un sitio en el mapa" />
          <button type="button" id="buscar-lugar-btn" className="buscar-lugar__btn" title="Buscar" aria-label="Buscar">
            <svg className="summary-btn__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></svg>
          </button>
        </div>
        <ul className="buscar-lugar__lista" id="buscar-lugar-lista" hidden></ul>
      </div>
      <button type="button" id="btn-toggle-sitios-float" className="btn-toggle-sitios btn-toggle-sitios--float" title="Mostrar/ocultar sitios en el mapa" aria-pressed="true" hidden>
        <svg className="btn-toggle-sitios__icon" viewBox="0 0 32 32" width="20" height="20" fill="currentColor"><path d="M29.83,17.45l-2-3A1,1,0,0,0,27,14H17V12h8a1,1,0,0,0,1-1V5a1,1,0,0,0-1-1H17V3a1,1,0,0,0-2,0V4H6a1,1,0,0,0-.71.29l-3,3a1,1,0,0,0,0,1.41l3,3A1,1,0,0,0,6,12h9v2H7a1,1,0,0,0-1,1v6a1,1,0,0,0,1,1h8v6H11a1,1,0,0,0,0,2H21a1,1,0,0,0,0-2H17V22H27a1,1,0,0,0,.83-.45l2-3A1,1,0,0,0,29.83,17.45Z" /></svg>
      </button>
      {/* Altimetría panel (sobre el mapa) */}
      <div id="altimetria" className="altimetria" hidden>
        <div className="altimetria__header">
          <div className="altimetria__titulo-grupo">
            <span className="altimetria__title">Perfil de elevación</span>
            <button type="button" id="btn-comparar-altimetria" className="altimetria__vs" title="Comparar dos sitios del perfil" aria-label="Comparar dos sitios del perfil">VS</button>
          </div>
          <div className="altimetria__segmentos" id="altimetria-segmentos" hidden></div>
          <span className="altimetria__hover-info">
            <span id="altimetria-dist"></span>
            <span id="altimetria-alt"></span>
          </span>
          <button type="button" id="btn-seguimiento-altimetria" className="altimetria__seguimiento" title="Activar o desactivar el seguimiento en el mapa" aria-pressed="true"><img src="/scope.svg" alt="" width="12" height="21" /><span className="altimetria__seguimiento-label">Seguimiento activado</span></button>
          <button type="button" id="btn-cerrar-altimetria" className="altimetria__close">&times;</button>
        </div>
        <div className="altimetria__chart" id="altimetria-chart"></div>
      </div>
      {/* Botones flotantes del mapa */}
      <div className="btns-map" id="btns-map">
        <button type="button" id="btn-altimetria" className="btn-map-icon" title="Perfil de elevación" aria-label="Perfil de elevación">
          <img src="/bike.svg" alt="" width="20" height="20" style={{ filter: 'brightness(0) invert(1)' }} />
        </button>
      </div>
      {/* Botón GPS (ruta desde archivo KML/GPX; en PC va debajo de la rosa de
           los vientos, arriba a la derecha del mapa) */}
      <div className="btns-map btns-map--gps-solo" id="btns-map-gps-solo">
        <button type="button" id="btn-gps" className="btn-map-icon" title="Activar ubicación GPS" aria-label="Activar ubicación GPS" hidden>
          <img src="/gps.svg" alt="" width="22" height="22" style={{ filter: 'brightness(0) invert(1)' }} />
        </button>
      </div>
      {/* Botones de satélite */}
      <div className="btns-map btns-map--gps" id="btns-map-gps">
        <button type="button" id="btn-satelite" className="btn-map-icon" title="Cambiar a vista satelital" aria-label="Cambiar a vista satelital" aria-pressed="false">
          <img src="/satellite.svg" alt="" width="20" height="20" style={{ filter: 'brightness(0) invert(1)' }} />
        </button>
      </div>
      {/* Rosa de los vientos (rotar el mapa en cualquier momento) */}
      <div className="btns-map btns-map--compass" id="btns-map-compass"></div>
    </main>
  );
}

export default memo(MapaFull);