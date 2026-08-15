/**
 * municipioCombo.js
 * ---------------------------------------------------------------------------
 * Función única que define los cuadros de selección de municipio de la app:
 * el origen, el destino y los pueblos intermedios. Todas las instancias
 * comparten la misma estructura y el mismo comportamiento:
 *
 *   - Al oprimir el cuadro se borra el texto que contenga y se abre su menú
 *     (toggle: oprimir de nuevo lo cierra). La lista se desplaza junto con el
 *     bloque hacia arriba para no interferir con el teclado.
 *   - Al elegir una opción se cierra el menú, se oculta el teclado y todo
 *     vuelve a su estado anterior.
 *   - Al enfocar un cuadro se oculta la barra inferior (clase combo-enfocado,
 *     gestionada por la infraestructura de teclado de app.js).
 *
 * La instancia se configura por variables (placeholder, cantidad de líneas
 * visibles del menú, exclusión de municipios ya usados, acciones al
 * seleccionar, etc.), de modo que no hay que repetir la lógica por cuadro.
 * ---------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const NO_OP = () => {};

  const config = {
    esMovil: () => false,
    capitales: {},
    formatear: (m) => (m && m.nombre) || '',
    municipios: () => [],
    seleccionarMapa: null, // (callback(lat, lon)) => void
    teclado: {
      ajustar: NO_OP,     // (trigger, listEl) => void
      reencajar: NO_OP,   // () => void
      reposicionar: NO_OP // (activar) => void
    },
  };

  /** Configura las dependencias globales compartidas por todas las instancias. */
  function configurar(opciones) {
    Object.assign(config, opciones);
  }

  /**
   * Crea (o enlaza) un cuadro de selección de municipio.
   * @param {Object} o
   * @param {HTMLElement} [o.contenedor]  Elemento .combo existente (origen/destino);
   *                                      si no se pasa, se crea uno nuevo.
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
   * @returns {{combo, trigger, listEl, abrir, cerrar, aplicar, limpiarTexto, valor}}
   */
  function crear(o) {
    const opciones = o || {};

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

    let listEl = combo.querySelector('.combo__list');
    if (!listEl) {
      listEl = document.createElement('ul');
      listEl.className = 'combo__list';
      listEl.role = 'listbox';
      listEl.hidden = true;
      combo.appendChild(listEl);
    }
    listEl.classList.toggle('combo__list--6', (opciones.lineas || 5) >= 6);

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

    const scope = opciones.scope || combo;

    // ---- Estado local ---------------------------------------------------------
    let deptoSeleccionado = null;
    let _toqueContrae = false;
    let _limpiandoTexto = false;

    // ---- Datos ----------------------------------------------------------------
    function obtenerDepartamentos() {
      return [...new Set(config.municipios().map((m) => m.departamento))].sort((a, b) => {
        if (a === 'Córdoba' && b === 'Cundinamarca') return -1;
        if (a === 'Cundinamarca' && b === 'Córdoba') return 1;
        return a.localeCompare(b, 'es');
      });
    }

    function obtenerMunicipios(depto) {
      const capitalNombre = config.capitales[depto];
      const lista = config.municipios()
        .filter((m) => m.departamento === depto)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      if (capitalNombre) {
        const capitalIdx = lista.findIndex((m) => m.nombre === capitalNombre);
        if (capitalIdx > 0) {
          const capital = lista.splice(capitalIdx, 1)[0];
          lista.unshift(capital);
        }
      }
      return lista;
    }

    function idsExcluidos() {
      return opciones.excluirIds ? opciones.excluirIds() : new Set();
    }

    // ---- Render del menú ------------------------------------------------------
    function renderDepartamentos() {
      deptoSeleccionado = null;
      listEl.innerHTML = '';

      if (opciones.mostrarUbicacionActual) {
        const locLi = document.createElement('li');
        locLi.textContent = 'Ubicación actual';
        locLi.addEventListener('click', (e) => {
          e.stopPropagation();
          listEl.hidden = true;
          _restaurarLista();
          if (config.esMovil()) trigger.blur();
          if (opciones.onUbicacionActual) opciones.onUbicacionActual();
        });
        listEl.appendChild(locLi);
      }

      const pickLi = document.createElement('li');
      pickLi.textContent = 'Seleccionar en el mapa';
      pickLi.addEventListener('click', (e) => {
        e.stopPropagation();
        listEl.hidden = true;
        _restaurarLista();
        config.teclado.reposicionar(false);
        if (config.esMovil()) trigger.blur();
        if (config.seleccionarMapa) {
          config.seleccionarMapa((lat, lon) => {
            aplicar({
              id: 'map_' + Date.now(),
              lat,
              lon,
              nombre: lat.toFixed(4) + ', ' + lon.toFixed(4),
              departamento: '',
            });
          });
        }
      });
      listEl.appendChild(pickLi);

      obtenerDepartamentos().forEach((d) => {
        const li = document.createElement('li');
        li.textContent = d;
        li.addEventListener('click', (e) => {
          e.stopPropagation();
          deptoSeleccionado = d;
          const municipios = obtenerMunicipios(d).filter((m) => !idsExcluidos().has(m.id));
          if (municipios.length === 1) {
            aplicar(municipios[0]);
          } else {
            renderMunicipios();
          }
        });
        listEl.appendChild(li);
      });
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    function renderMunicipios() {
      listEl.innerHTML = '';
      const back = document.createElement('li');
      back.className = 'combo__back';
      back.textContent = '← Volver';
      back.addEventListener('click', (e) => {
        e.stopPropagation();
        renderDepartamentos();
      });
      listEl.appendChild(back);

      obtenerMunicipios(deptoSeleccionado)
        .filter((m) => !idsExcluidos().has(m.id))
        .forEach((m) => {
          const li = document.createElement('li');
          li.textContent = m.nombre;
          li.addEventListener('click', (e) => { e.stopPropagation(); aplicar(m); });
          listEl.appendChild(li);
        });
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    function renderFiltrados(texto) {
      deptoSeleccionado = null;
      listEl.innerHTML = '';
      const q = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const excluidos = idsExcluidos();
      const munis = config.municipios().filter((m) => {
        if (excluidos.has(m.id)) return false;
        const nom = m.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const dep = m.departamento.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return nom.includes(q) || dep.includes(q);
      }).slice(0, 100);
      if (munis.length === 0) {
        const li = document.createElement('li');
        li.className = 'no-results';
        li.textContent = 'Sin resultados';
        listEl.appendChild(li);
      } else {
        munis.forEach((m) => {
          const li = document.createElement('li');
          li.textContent = m.nombre + ' (' + m.departamento + ')';
          li.addEventListener('click', (e) => { e.stopPropagation(); aplicar(m); });
          listEl.appendChild(li);
        });
      }
      listEl.scrollTop = 0;
      listEl.hidden = false;
      resaltar(0);
    }

    // ---- Comportamiento -------------------------------------------------------
    function resaltar(idx) {
      const items = [...listEl.querySelectorAll('li:not(.combo__back):not(.no-results)')];
      items.forEach((li, i) => {
        if (i === idx) { li.setAttribute('aria-selected', 'true'); li.scrollIntoView({ block: 'nearest' }); }
        else li.removeAttribute('aria-selected');
      });
    }

    function cerrar() {
      listEl.hidden = true;
      _restaurarLista();
      config.teclado.reencajar();
    }

    // ---- Menú fuera del panel -------------------------------------------------
    // Para que las opciones puedan desplegarse por completo aunque superen la
    // altura del panel (el .side-panel usa overflow clip/hidden), la lista se
    // traslada temporalmente a <body> con posición fija al abrirse y vuelve a
    // su lugar dentro del cuadro al cerrarse. La posición y el alto los calcula
    // config.teclado.ajustar (teclado.js), que con la lista portada la limita
    // al espacio visible del viewport en la dirección en que se abre.
    listEl._trigger = trigger;

    function _portarLista() {
      if (listEl._portado) { config.teclado.ajustar(trigger, listEl); return; }
      listEl._portado = true;
      listEl._padreOriginal = listEl.parentElement;
      document.body.appendChild(listEl);
      listEl.style.position = 'fixed';
      listEl.style.left = '0px';
      listEl.style.right = 'auto';
      listEl.style.zIndex = '1200';
      config.teclado.ajustar(trigger, listEl);
    }

    function _restaurarLista() {
      if (!listEl._portado) return;
      listEl._portado = false;
      if (listEl._padreOriginal) {
        listEl._padreOriginal.appendChild(listEl);
        listEl._padreOriginal = null;
      }
      listEl.style.position = '';
      listEl.style.left = '';
      listEl.style.right = '';
      listEl.style.top = '';
      listEl.style.bottom = '';
      listEl.style.width = '';
      listEl.style.maxHeight = '';
      listEl.style.zIndex = '';
    }

    function abrir() {
      const texto = trigger.value.trim();
      _portarLista();
      if (trigger.dataset.selectedId) {
        trigger.value = '';
        delete trigger.dataset.selectedId;
        renderDepartamentos();
      } else if (texto) {
        renderFiltrados(texto);
      } else {
        renderDepartamentos();
      }
      config.teclado.reencajar();
    }

    /** Borra el texto del cuadro (también se hace al oprimir, según el requisito). */
    function limpiarTexto() {
      _limpiandoTexto = true;
      trigger.value = '';
      delete trigger.dataset.selectedId;
      _limpiandoTexto = false;
    }

    /** Aplica un municipio (desde la lista, el mapa o la ubicación): cierra el
     *  menú, fija el valor y ejecuta la acción configurada. */
    function aplicar(m) {
      listEl.hidden = true;
      _restaurarLista();
      trigger.value = config.formatear(m);
      trigger.dataset.selectedId = m.id;
      config.teclado.reposicionar(false);
      if (opciones.onSelect) opciones.onSelect(m);
      if (config.esMovil()) trigger.blur();
    }

    // ---- Eventos ---------------------------------------------------------------
    // Toque/clic repetido en el cuadro: borra el texto y alterna el menú (abre
    // si está cerrado, cierra si está abierto). El primer toque lo maneja focus.
    trigger.addEventListener('pointerdown', () => {
      if (document.activeElement !== trigger) return;
      _toqueContrae = true; // el focus de este toque no debe reabrir
      limpiarTexto();
      if (listEl.hidden) abrir(); else cerrar();
    });

    trigger.addEventListener('focus', (e) => {
      e.stopPropagation();
      if (_toqueContrae) { _toqueContrae = false; return; }
      limpiarTexto();
      abrir();
    });

    trigger.addEventListener('input', () => {
      if (_limpiandoTexto) return; // evita doble render tras limpiarTexto
      const texto = trigger.value.trim();
      if (texto) renderFiltrados(texto); else renderDepartamentos();
      delete trigger.dataset.selectedId;
      config.teclado.reencajar();
    });

    trigger.addEventListener('blur', () => {
      _toqueContrae = false;
      cerrar();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { cerrar(); e.preventDefault(); return; }
      if (e.key === 'Enter' && listEl.hidden) {
        if (trigger.dataset.selectedId) {
          e.preventDefault();
          if (opciones.onEnter) opciones.onEnter();
        }
        return;
      }
      if (listEl.hidden) return;
      const items = [...listEl.querySelectorAll('li:not(.combo__back):not(.no-results)')];
      if (items.length === 0) return;
      let cur = items.findIndex((li) => li.hasAttribute('aria-selected'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cur = Math.min(cur + 1, items.length - 1);
        resaltar(cur);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cur = Math.max(cur - 1, 0);
        resaltar(cur);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const sel = items.find((li) => li.hasAttribute('aria-selected')) || items[0];
        if (sel) sel.click();
      }
    });

    // No deja que el clic sobre el menú robe el foco del cuadro.
    listEl.addEventListener('mousedown', (e) => { e.preventDefault(); });

    // Clic fuera del cuadro: cierra el menú y quita el foco (oculta el teclado).
    document.addEventListener('click', (e) => {
      if (!scope.contains(e.target)) { cerrar(); trigger.blur(); }
    });

    return {
      combo,
      trigger,
      listEl,
      abrir,
      cerrar,
      aplicar,
      limpiarTexto,
      valor: () => trigger.value,
    };
  }

  global.MunicipioCombo = { configurar, crear };
})(window);
