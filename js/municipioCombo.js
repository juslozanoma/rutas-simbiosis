/**
 * municipioCombo.js
 * ---------------------------------------------------------------------------
 * Fachada del cuadro de selección de municipio (origen, destino, tour y
 * pueblos intermedios). Todo el comportamiento vive en React
 * (src/components/MunicipioCombo.jsx), que se registra a través de
 * `window.SimbiosisUI`; este archivo solo prepara el DOM mínimo del cuadro
 * (input `.combo__trigger` y chevron) y reenvía las llamadas de la app vanilla
 * al registro React correspondiente.
 *
 * La lista `.combo__list` la renderiza React por portal: cerrada dentro del
 * `.combo` (hidden) y abierta trasladada a <body> con posición fija para que
 * las opciones no se corten con el overflow del panel (contrato con
 * js/teclado.js, que detecta la lista portada cuando `parentElement === body`).
 *
 * La instancia se configura por variables (placeholder, cantidad de líneas
 * visibles, exclusión de municipios ya usados, acciones al seleccionar…), de
 * modo que no hay que repetir la lógica por cuadro.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const UI = () => global.SimbiosisUI || null;

  /** Configura las dependencias globales compartidas por todas las instancias. */
  function configurar(opciones) {
    const ui = UI();
    if (ui && typeof ui.configurarCombo === 'function') ui.configurarCombo(opciones);
  }

  /**
   * Crea (o enlaza) un cuadro de selección de municipio.
   * @param {Object} o
   * @param {HTMLElement} [o.contenedor]  Elemento .combo existente (origen/destino/tour);
   *                                      si no se pasa, se crea uno nuevo.
   * @param {string}  [o.id]              Id único del cuadro (origen/destino/tour, o
   *                                      autogenerado para las filas de escala).
   * @param {string}  [o.placeholder]      Texto del cuadro antes de elegir.
   * @param {number}  [o.lineas=5]         Opciones visibles del menú (6+ usa .combo__list--6).
   * @param {boolean} [o.mostrarUbicacionActual] Muestra "Ubicación actual" (solo origen).
   * @param {Function} [o.onUbicacionActual]     Acción al tocar "Ubicación actual".
   * @param {Function} [o.excluirIds]      () => Set de ids de municipios no disponibles.
   * @param {Function} [o.onSelect]        (m) => void al elegir un municipio.
   * @param {Function} [o.onEnter]         Acción al pulsar Enter con lista cerrada y valor elegido.
   * @param {HTMLElement} [o.scope]        Elemento que define "dentro" del cuadro
   *                                       (por defecto el .combo; en escala es la fila).
   * @param {string[]} [o.clases]          Clases extra para el input (p. ej. escala-trigger).
   * @returns {{id, combo, trigger, listEl, abrir, cerrar, aplicar, limpiarTexto, valor}}
   */
  function crear(o) {
    const opciones = o || {};
    const ui = UI();

    // ---- DOM -----------------------------------------------------------------
    let combo = opciones.contenedor || null;
    if (!combo) {
      combo = document.createElement('div');
      combo.className = 'combo';
    }

    let trigger = combo.querySelector('.combo__trigger');
    if (!trigger) {
      trigger = document.createElement('input');
      trigger.type = 'search';
      trigger.className = 'combo__trigger';
      trigger.autocomplete = 'one-time-code';
      trigger.autocorrect = 'off';
      trigger.autocapitalize = 'off';
      trigger.spellcheck = false;
      combo.insertBefore(trigger, combo.firstChild);
    }
    (opciones.clases || []).forEach((c) => trigger.classList.add(c));
    trigger.placeholder = opciones.placeholder || 'Seleccionar municipio';

    if (!combo.querySelector('.combo__chevron')) {
      const chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      chevron.setAttribute('class', 'combo__chevron');
      chevron.setAttribute('viewBox', '0 0 24 24');
      chevron.setAttribute('width', '12');
      chevron.setAttribute('height', '12');
      chevron.setAttribute('fill', 'none');
      chevron.setAttribute('stroke', 'currentColor');
      chevron.setAttribute('stroke-width', '2.5');
      chevron.setAttribute('stroke-linecap', 'round');
      chevron.innerHTML = '<path d="M6 9l6 6 6-6"/>';
      combo.appendChild(chevron);
    }

    // ---- Registro en React ---------------------------------------------------
    let id = null;
    if (ui && typeof ui.registrarCombo === 'function') {
      id = ui.registrarCombo({
        id: opciones.id,
        contenedor: combo,
        placeholder: opciones.placeholder,
        lineas: opciones.lineas,
        mostrarUbicacionActual: opciones.mostrarUbicacionActual,
        onUbicacionActual: opciones.onUbicacionActual,
        excluirIds: opciones.excluirIds,
        onSeleccionar: opciones.onSelect,
        onEnter: opciones.onEnter,
        scope: opciones.scope,
      });
    }
    if (!id) id = opciones.id || 'combo_sin_registro';

    // La lista la renderiza React; aquí solo se expone el contrato con la app.
    return {
      id,
      combo,
      trigger,
      listEl: null,
      abrir: () => { if (ui) ui.comboAbrir(id); },
      cerrar: () => { if (ui) ui.comboCerrar(id); },
      aplicar: (m) => { if (ui) ui.comboAplicar(id, m); },
      limpiarTexto: () => { if (ui) ui.comboLimpiar(id); },
      valor: () => (ui ? ui.comboValor(id) : ''),
    };
  }

  global.MunicipioCombo = { configurar, crear };
})(window);