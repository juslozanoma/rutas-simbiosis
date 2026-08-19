/**
 * src/components/shell/Dialogos.jsx
 * ---------------------------------------------------------------------------
 * Diálogos globales (cargar ruta KML/GPX y nuevo puerto) convertidos a React
 * como cáscara estática y montados en document.body mediante portal, en el
 * mismo lugar que ocupaban en index.html (hijos directos de <body>).
 * La lógica vanilla (rutaArchivo.js, fluvial.js, panel.js…) sigue enlazando
 * por ids y mutando estos nodos (hidden, valores de los inputs…) sin que
 * React los pise.
 *
 * IMPORTANTE: componente memoizado y sin props. React lo renderiza una sola
 * vez y nunca vuelve a tocar su DOM.
 * ---------------------------------------------------------------------------
 */
import { memo } from 'react';
import { createPortal } from 'react-dom';

function Dialogos() {
  return createPortal(
    <>
      {/* Diálogo de carga de ruta desde archivo (tecla K) */}
      <div className="dialog-overlay" id="panel-cargar-ruta" hidden>
        <div className="dialog">
          <h3 className="dialog__title">Cargar ruta</h3>
          <p className="dialog__text">Sube un archivo <strong>KML</strong> o <strong>GPX</strong> para mostrar su ruta en el mapa.</p>
          <label className="cargar-ruta__file">
            <input type="file" id="input-ruta-archivo" className="cargar-ruta__input-file" accept=".kml,.gpx,application/vnd.google-earth.kml+xml,application/gpx+xml" multiple />
            <span id="cargar-ruta-file-label">Elegir archivo…</span>
          </label>
          <button type="button" className="dialog__btn dialog__btn--save cargar-ruta__continuar" id="btn-continuar-ruta" hidden>Continuar con la actual</button>
          <p className="dialog__error" id="cargar-ruta-error" hidden></p>
          <div className="dialog__actions">
            <button type="button" className="dialog__btn dialog__btn--cancel" id="btn-cerrar-cargar-ruta">Cancelar</button>
          </div>
        </div>
      </div>

      {/* Diálogo de nuevo puerto (clic derecho en el mapa) */}
      <div className="dialog-overlay" id="panel-nuevo-puerto" hidden>
        <div className="dialog">
          <h3 className="dialog__title" id="np-titulo">Agregar puerto</h3>
          <p className="dialog__text">Completa los datos. Se guardará con estas coordenadas en el JSON de puertos.</p>
          <label className="nuevo-puerto__label">Nombre
            <input type="search" id="np-nombre" className="nuevo-puerto__input" placeholder="Puerto de ..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" />
          </label>
          <label className="nuevo-puerto__label">Ciudad
            <input type="search" id="np-ciudad" className="nuevo-puerto__input" placeholder="Ciudad (Departamento)" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" />
          </label>
          <label className="nuevo-puerto__label">Río
            <input type="search" id="np-rio" className="nuevo-puerto__input" placeholder="Río ..." autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" />
          </label>
          <label className="nuevo-puerto__label">Descripción
            <textarea id="np-descripcion" className="nuevo-puerto__input nuevo-puerto__input--area" rows="3" placeholder="Descripción del puerto" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"></textarea>
          </label>
          <p className="dialog__error" id="np-error" hidden></p>
          <div className="dialog__actions">
            <button type="button" className="dialog__btn dialog__btn--cancel" id="np-cancelar">Cancelar</button>
            <button type="button" className="dialog__btn dialog__btn--save" id="np-guardar">Guardar puerto</button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

export default memo(Dialogos);