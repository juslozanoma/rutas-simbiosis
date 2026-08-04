/**
 * paradas.js
 * ---------------------------------------------------------------------------
 * Listado de paradas (escalas + sitios agregados + extremos + aeropuertos),
 * menús contextuales y fichas informativas de cada elemento de la ruta.
 * ---------------------------------------------------------------------------
 */

  async function agregarParada(sitio, boton) {
    if (boton) ponerEnCarga(boton, true);
    state.paradas.push(sitio);
    const map = MapModule.getMap();
    const center = map.getCenter();
    const zoom = map.getZoom();
    try {
      if (el.checkAutoOrganizar.checked) {
        await organizarAutomaticamente();
      } else {
        await aplicarRutaConDesvios({ mantenerMapa: true });
        renderizarParadas();
      }
      map.setView(center, zoom, { animate: false });
      limpiarPreview();
      // Actualiza la tarjeta en su lugar (resaltado + botón "−") sin recargar la lista.
      _marcarSitioAgregadoEnLista(sitio);
      MapModule.quitarMarcadorSitio(sitio.id);
    } finally {
      if (boton) ponerEnCarga(boton, false);
    }
  }

  /** Cambia en el lugar la tarjeta de un sitio a "ya agregado" (resaltado y botón −). */

  function _marcarSitioAgregadoEnLista(sitio) {
    const card = el.sitiosLista.querySelector(`[data-sitio-id="${String(sitio.id)}"]`);
    if (!card) return;
    card.classList.add('sitio-card--active');
    const btn = card.querySelector('.sitio-card__add');
    if (!btn) return;
    btn.classList.add('sitio-card__add--quitar');
    btn.title = 'Quitar de la ruta';
    btn.setAttribute('aria-label', 'Quitar ' + sitio.nombre + ' de la ruta');
    btn.innerHTML = '<svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 12h12"/></svg><span class="icon-btn__spinner" aria-hidden="true"></span>';
    btn.onclick = (e) => { e.stopPropagation(); quitarSitioDeLaRuta(sitio, card, btn); };
  }

  /** Quita de la ruta un sitio agregado y restaura su tarjeta a "+" en su lugar. */

  async function quitarSitioDeLaRuta(sitio, card, boton) {
    if (boton) ponerEnCarga(boton, true);
    await eliminarParada(sitio.id);
    if (boton) ponerEnCarga(boton, false);
  }

  // -------------------------------------------------------------------
  // Arrastre de tramo en el mapa (reruteo)
  // -------------------------------------------------------------------


  async function eliminarParada(sitioId) {
    const idx = state.paradas.findIndex((p) => p.id === sitioId);
    if (idx === -1) return;
    const sitio = state.paradas[idx];
    state.paradas.splice(idx, 1);
    sincronizarOrden();
    // Quitar un sitio turístico no afecta el listado de Descubre ni los
    // marcadores de sitios: solo se recalcula la ruta sin ese desvío.
    if (state.rutaActual) {
      await aplicarRutaConDesvios({ mantenerMapa: true });
    }
    renderizarParadas();
    MapModule.setMarcadoresParadas(state.paradas);
    if (sitio) {
      _restaurarSitioEnLista(sitio);
      if (sitio.lat != null && sitio.lon != null) {
        MapModule.agregarMarcadorSitio(TourismModule.crearMarcador(sitio));
      }
    }
  }

  /** Restaura la tarjeta de un sitio a "agregar" (+) sin recargar el listado. */

  function _restaurarSitioEnLista(sitio) {
    const card = el.sitiosLista.querySelector(`[data-sitio-id="${String(sitio.id)}"]`);
    if (!card) return;
    card.classList.remove('sitio-card--active');
    const btn = card.querySelector('.sitio-card__add');
    if (!btn) return;
    btn.classList.remove('sitio-card__add--quitar');
    btn.title = 'Agregar a la ruta';
    btn.setAttribute('aria-label', 'Agregar ' + sitio.nombre + ' a la ruta');
    btn.innerHTML = '<svg class="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg><span class="icon-btn__spinner" aria-hidden="true"></span>';
    btn.onclick = (e) => { e.stopPropagation(); agregarParada(sitio, btn); };
  }


  function cerrarMenuFila() {
    if (_menuFila) {
      _menuFila.remove();
      _menuFila = null;
    }
  }


  function abrirMenuFila(opciones, clientX, clientY) {
    cerrarMenuFila();
    const menu = document.createElement('div');
    menu.className = 'fila-menu';

    opciones.forEach((op) => {
      const item = document.createElement('div');
      item.className = 'fila-menu__item';
      item.textContent = op.etiqueta;
      item.addEventListener('click', (evt) => {
        evt.stopPropagation();
        cerrarMenuFila();
        op.accion();
      });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);
    _menuFila = menu;

    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight - 8) top = window.innerHeight - rect.height - 8;
    left = Math.max(8, left);
    top = Math.max(8, top);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }


  document.addEventListener('click', (evt) => {
    if (_menuFila && !_menuFila.contains(evt.target)) cerrarMenuFila();
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') cerrarMenuFila();
  });

  /** Pulsación larga en móvil (≈550 ms) que abre el menú contextual de la fila. */

  function engancharLongPress(li, alDisparar) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let disparado = false;

    li.addEventListener('touchstart', (evt) => {
      if (evt.touches.length !== 1) return;
      disparado = false;
      const t = evt.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      timer = setTimeout(() => {
        disparado = true;
        _suprimirProximoClic = true;
        setTimeout(() => { _suprimirProximoClic = false; }, 700);
        navigator.vibrate && navigator.vibrate(20);
        alDisparar({ clientX: t.clientX, clientY: t.clientY });
      }, 550);
    }, { passive: true });

    li.addEventListener('touchmove', (evt) => {
      if (!timer) return;
      const t = evt.touches[0];
      if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
        clearTimeout(timer);
        timer = null;
      }
    }, { passive: true });

    li.addEventListener('touchend', (evt) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (disparado) evt.preventDefault();
    });

    li.addEventListener('touchcancel', () => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (disparado) { disparado = false; }
    });
  }

  /** Modo "cambiar origen/destino": mientras está activo, al seleccionar el nuevo
   *  extremo se ocultan los cuadros al instante y se recalcula la ruta (OSRM). */

  function mostrarCuadroParada(sitio) {
    if (!sitio || sitio.lat == null || sitio.lon == null) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(sitio.lat, sitio.lon);

    const distTxt = sitio.distanciaRutaKm != null
      ? `A ${sitio.distanciaRutaKm.toFixed(1)} km del corredor · ~${Math.round(sitio.tiempoDesvioMin)} min de desvío`
      : '';
    const btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'popup-sitio__add popup-sitio__quitar';
    btnQuitar.textContent = 'Quitar de la ruta';
    btnQuitar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      eliminarParada(sitio.id);
    });

    TourismModule.mostrarCuadroInfo({
      categoria: sitio.categoria || '',
      color: TourismModule.colorCategoria(sitio.categoria),
      nombre: sitio.nombre,
      ubicacion: `${sitio.municipio ? sitio.municipio + ', ' : ''}${sitio.departamento || ''}`,
      descripcion: sitio.descripcion || '',
      dist: distTxt,
      botones: [btnQuitar],
    });
  }

  /** Devuelve el municipio completo del catálogo para un punto (por id o nombre). */

  function _datosMunicipio(punto) {
    if (!punto || !state.municipios) return null;
    return state.municipios.find((m) => m.id === punto.id || (punto.nombre && m.nombre === punto.nombre)) || null;
  }

  /** Normaliza la altura a "X msnm" (los datos pueden traer "80 m s. n. m."). */

  function _formatearAltura(altura) {
    if (!altura) return '';
    const m = String(altura).match(/^\s*([\d.,]+)/);
    return m ? m[1] + ' msnm' : String(altura);
  }

  /** Nombre para la ficha: "Ciudad, Departamento (año)" (Bogotá se muestra como "Bogotá, D.C."). */

  function _nombreParaFicha(nombre, departamento, ano) {
    if (!nombre) return '';
    let base;
    if (nombre === 'Bogotá D.C.') base = 'Bogotá, D.C.';
    else if (departamento && departamento !== nombre) base = nombre + ', ' + departamento;
    else base = nombre;
    return ano ? `${base} (${ano})` : base;
  }

  /** Centra el mapa y muestra la ficha centrada de un pueblo intermedio. */

  function mostrarCuadroEscala(escala) {
    if (!escala || escala.lat == null || escala.lon == null) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(escala.lat, escala.lon);

    const btnCambiar = document.createElement('button');
    btnCambiar.type = 'button';
    btnCambiar.className = 'popup-sitio__add';
    btnCambiar.textContent = 'Cambiar pueblo intermedio';
    btnCambiar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      cambiarPueblo(escala);
    });

    const btnEliminar = document.createElement('button');
    btnEliminar.type = 'button';
    btnEliminar.className = 'popup-sitio__add popup-sitio__quitar';
    btnEliminar.textContent = 'Eliminar pueblo intermedio';
    btnEliminar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      eliminarEscala(escala.id);
    });

    const muni = _datosMunicipio(escala);
    TourismModule.mostrarCuadroInfo({
      categoria: 'Pueblo intermedio',
      color: '#4a6fa5',
      nombre: _nombreParaFicha(escala.nombre, escala.departamento, muni ? (muni.ano_fundacion || '') : ''),
      descripcion: muni ? (muni.descripción || '') : '',
      dist: '',
      altura: muni ? _formatearAltura(muni.altura) : '',
      temperatura: muni ? (muni.temperatura_promedio || '') : '',
      poblacion: muni ? (muni.poblacion_total || '') : '',
      superficie_total: muni ? (muni.superficie_total || '') : '',
      botones: [btnCambiar, btnEliminar],
    });
  }

  /** Centra el mapa y muestra la ficha centrada del origen o destino. */

  function mostrarCuadroExtremo(tipo, nombre, departamento) {
    const extremo = tipo === 'origen' ? state.origen : state.destino;
    if (!extremo || extremo.lat == null || extremo.lon == null) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(extremo.lat, extremo.lon);

    const btnCambiar = document.createElement('button');
    btnCambiar.type = 'button';
    btnCambiar.className = 'popup-sitio__add';
    btnCambiar.textContent = tipo === 'origen' ? 'Cambiar lugar de origen' : 'Cambiar lugar de destino';
    btnCambiar.addEventListener('click', () => {
      TourismModule.ocultarPopupSitio();
      if (tipo === 'origen') irCambiarOrigen();
      else irCambiarDestino();
    });

    const muni = _datosMunicipio(extremo);
    TourismModule.mostrarCuadroInfo({
      categoria: tipo === 'origen' ? 'Ciudad de origen' : 'Ciudad de destino',
      color: '#2d7d68',
      nombre: _nombreParaFicha(nombre, departamento, muni ? (muni.ano_fundacion || '') : ''),
      descripcion: muni ? (muni.descripción || '') : '',
      dist: '',
      altura: muni ? _formatearAltura(muni.altura) : '',
      temperatura: muni ? (muni.temperatura_promedio || '') : '',
      poblacion: muni ? (muni.poblacion_total || '') : '',
      superficie_total: muni ? (muni.superficie_total || '') : '',
      botones: [btnCambiar],
    });
  }

  /** Centra el mapa y muestra la ficha de un aeropuerto (salida o llegada) en ruta aérea. */

  function mostrarCuadroAeropuerto(ap, prefijo) {
    if (!ap) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(ap.latitud, ap.longitud);

    const tramos = state.tramosAereo;
    const distTxt = (() => {
      if (!tramos) return '';
      let dist = null;
      if (prefijo === 'Salida') dist = tramos.distCarro1;
      else if (prefijo === 'Llegada') dist = tramos.distCarro2;
      else if (tramos.vuelos && tramos.vuelos[0]) dist = tramos.vuelos[0].distanciaMetros;
      if (dist == null) return '';
      return `${prefijo}: ${(dist / 1000).toFixed(1)} km`;
    })();

    TourismModule.mostrarCuadroInfo({
      categoria: `Aeropuerto de ${prefijo.toLowerCase()}`,
      color: '#4a6fa5',
      nombre: ap.nombre || '',
      ubicacion: ap.ubicacion || '',
      descripcion: ap.descripcion || '',
      dist: distTxt,
      botones: [],
    });
  }

  /** Centra el mapa y muestra la ficha de un puerto fluvial (salida o llegada) en ruta por río. */
  function mostrarCuadroPuerto(p, prefijo) {
    if (!p) return;
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(p.latitud, p.longitud);

    const tramos = state.tramosFluviales;
    const distTxt = (() => {
      if (!tramos) return '';
      let dist = null;
      if (prefijo === 'Salida') dist = tramos.distCarro1;
      else if (prefijo === 'Llegada') dist = tramos.distCarro2;
      else if (tramos.tramos && tramos.tramos[0]) dist = tramos.tramos[0].distanciaMetros;
      if (dist == null) return '';
      return `${prefijo}: ${(dist / 1000).toFixed(1)} km`;
    })();

    TourismModule.mostrarCuadroInfo({
      categoria: `Puerto fluvial de ${prefijo.toLowerCase()}`,
      color: '#2f7a6b',
      nombre: p.nombre || '',
      ubicacion: p.ubicacion || '',
      descripcion: p.descripcion || '',
      dist: distTxt,
      botones: [],
    });
  }

  /** Prefijo de la ruta activa ('Salida'|'Conexión'|'Llegada') si `ap` es un
   *  aeropuerto de la ruta aérea en curso; null si no. */
  function _prefijoAeropuertoRuta(ap) {
    const t = state.tramosAereo;
    if (!t || !ap) return null;
    if (t.apOri && String(t.apOri.id) === String(ap.id)) return 'Salida';
    if (t.apDes && String(t.apDes.id) === String(ap.id)) return 'Llegada';
    if (t.hub && String(t.hub.id) === String(ap.id)) return 'Conexión';
    return null;
  }

  /** Prefijo de la ruta activa ('Salida'|'Conexión'|'Llegada') si `p` es un
   *  puerto de la ruta fluvial en curso; null si no. */
  function _prefijoPuertoRuta(p) {
    const t = state.tramosFluviales;
    if (!t || !p) return null;
    if (t.po && String(t.po.id) === String(p.id)) return 'Salida';
    if (t.pd && String(t.pd.id) === String(p.id)) return 'Llegada';
    if (t.hub && String(t.hub.id) === String(p.id)) return 'Conexión';
    return null;
  }

  /** Centra el mapa y muestra la ficha informativa centrada de un
   *  puerto/aeropuerto del catálogo (o de la ruta, si pertenece a ella), igual
   *  que con los sitios turísticos. `tipo` es 'puerto' | 'aeropuerto'. */
  function mostrarCuadroInfra(tipo, item) {
    if (!item) return;
    const esPuerto = tipo === 'puerto';
    const prefijo = esPuerto ? _prefijoPuertoRuta(item) : _prefijoAeropuertoRuta(item);
    if (prefijo) {
      if (esPuerto) mostrarCuadroPuerto(item, prefijo);
      else mostrarCuadroAeropuerto(item, prefijo);
      return;
    }
    cerrarAltimetria();
    const map = MapModule.getMap();
    if (map) map.closePopup();
    MapModule.centrarEn(item.latitud, item.longitud);
    TourismModule.mostrarCuadroInfo({
      categoria: esPuerto ? 'Puerto fluvial' : 'Aeropuerto',
      color: esPuerto ? '#2f7a6b' : '#4a6fa5',
      nombre: item.nombre || '',
      ubicacion: item.ubicacion || '',
      descripcion: item.descripcion || '',
      dist: '',
      botones: [],
    });
  }


  function renderizarParadas() {
    sincronizarOrden();

    const items = state.orden.map((o) => {
      if (o.tipo === 'escala') {
        const e = state.escalas.find((e) => e.id === o.id);
        if (!e || e.lat == null) return null;
        return { tipo: 'escala', datos: e };
      }
      const p = state.paradas.find((p) => p.id === o.id);
      if (!p) return null;
      return { tipo: 'parada', datos: p };
    }).filter(Boolean).filter((item) => !item.datos._dragGenerated);

    const total = items.length;
    el.paradasLista.innerHTML = '';
    const incluirExtremos = Boolean(state.rutaActual && state.origen && state.destino);
    el.paradasContador.textContent = String(incluirExtremos ? total : total);
    el.paradasContador.hidden = total === 0;
    // En la pestaña Descubre las paradas no deben aparecer aunque haya paradas;
    // tampoco antes de calcular la ruta inicial (seleccionando pueblos
    // intermedios): las paradas se muestran solo tras el primer cálculo.
    el.panelParadas.hidden = estaEnPestanaDescubre() || !state.rutaActual || (!incluirExtremos && total === 0);

    function crearFilaExtremo(letra, nombre, tipo) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = letra;

      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      nombreEl.textContent = nombre;

      if (tipo === 'destino' && state.rutaActual?.distanciaMetros) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        distEl.textContent = ' — ' + (state.rutaActual.distanciaMetros / 1000).toFixed(1) + ' km';
        nombreEl.appendChild(distEl);
      }

      li.appendChild(num);
      li.appendChild(nombreEl);
      li.role = 'button';
      li.tabIndex = 0;

      const accionExtremo = () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        const extremo = tipo === 'origen' ? state.origen : state.destino;
        if (extremo && extremo.lat != null) {
          mostrarCuadroExtremo(tipo, extremo.nombre || '', (extremo.departamento || ''));
        }
      };
      li.addEventListener('click', accionExtremo);
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionExtremo(); }
      });
      const opcionesExtremo = () => {
        const opciones = [];
        if (tipo === 'origen') {
          opciones.push({ etiqueta: 'Cambiar lugar de origen', accion: () => irCambiarOrigen() });
        } else {
          opciones.push({ etiqueta: 'Cambiar lugar de destino', accion: () => irCambiarDestino() });
        }
        opciones.push({
          etiqueta: 'Ubicar en el mapa',
          accion: () => {
            const extremo = tipo === 'origen' ? state.origen : state.destino;
            if (extremo && extremo.lat != null) {
              mostrarCuadroExtremo(tipo, extremo.nombre || '', (extremo.departamento || ''));
            }
          },
        });
        return opciones;
      };
      li.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        abrirMenuFila(opcionesExtremo(), evt.clientX, evt.clientY);
      });
      engancharLongPress(li, (evt) => {
        abrirMenuFila(opcionesExtremo(), evt.clientX, evt.clientY);
      });

      return li;
    }

    function crearFilaAeropuerto(aeropuerto, prefijo, distKm) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = 'aeropuerto';
      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = '✈';
      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      nombreEl.textContent = (prefijo ? prefijo + ': ' : '') + (aeropuerto || '');
      if (distKm != null) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        distEl.textContent = ' — ' + distKm.toFixed(1) + ' km';
        nombreEl.appendChild(distEl);
      }
      li.appendChild(num);
      li.appendChild(nombreEl);
      li.role = 'button';
      li.tabIndex = 0;
      return li;
    }

    function accionAeropuerto(ap, prefijo) {
      return () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        cerrarMenuFila();
        mostrarCuadroAeropuerto(ap, prefijo);
      };
    }

    function construirFilaAeropuerto(tramos, ap, prefijo, distMetros) {
      const li = crearFilaAeropuerto(ap.nombre, prefijo, distMetros != null ? distMetros / 1000 : null);
      li.addEventListener('click', accionAeropuerto(ap, prefijo));
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionAeropuerto(ap, prefijo)(); }
      });
      return li;
    }

    function crearFilaPuerto(puerto, prefijo, distKm) {
      const li = document.createElement('li');
      li.className = 'parada-item parada-item--endpoint';
      li.dataset.tipoParada = 'puerto';
      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = '🚢';
      const nombreEl = document.createElement('span');
      nombreEl.className = 'parada-item__nombre';
      nombreEl.textContent = (prefijo ? prefijo + ': ' : '') + (puerto || '');
      if (distKm != null) {
        const distEl = document.createElement('span');
        distEl.className = 'parada-item__dist';
        distEl.textContent = ' — ' + distKm.toFixed(1) + ' km';
        nombreEl.appendChild(distEl);
      }
      li.appendChild(num);
      li.appendChild(nombreEl);
      li.role = 'button';
      li.tabIndex = 0;
      return li;
    }

    function accionPuerto(p, prefijo) {
      return () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        cerrarMenuFila();
        mostrarCuadroPuerto(p, prefijo);
      };
    }

    function construirFilaPuerto(tramos, p, prefijo, distMetros) {
      const li = crearFilaPuerto(p.nombre, prefijo, distMetros != null ? distMetros / 1000 : null);
      li.addEventListener('click', accionPuerto(p, prefijo));
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionPuerto(p, prefijo)(); }
      });
      return li;
    }

    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('A', formatMunicipio(state.origen), 'origen'));
    }
    if (state.modoAereo && state.tramosAereo && state.tramosAereo.apOri) {
      el.paradasLista.appendChild(construirFilaAeropuerto(state.tramosAereo, state.tramosAereo.apOri, 'Salida', state.tramosAereo.distCarro1));
    }
    if (state.modoAereo && state.tramosAereo && state.tramosAereo.hub && state.tramosAereo.vuelos && state.tramosAereo.vuelos[0]) {
      el.paradasLista.appendChild(construirFilaAeropuerto(state.tramosAereo, state.tramosAereo.hub, 'Conexión', state.tramosAereo.vuelos[0].distanciaMetros));
    }
    if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.po) {
      el.paradasLista.appendChild(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.po, 'Salida', state.tramosFluviales.distCarro1));
    }
    if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.hub && state.tramosFluviales.tramos && state.tramosFluviales.tramos[0]) {
      el.paradasLista.appendChild(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.hub, 'Conexión', state.tramosFluviales.tramos[0].distanciaMetros));
    }

    items.forEach((item, idx) => {
      const e = item.datos;
      const li = document.createElement('li');
      li.className = 'parada-item';
      li.dataset.paradaId = e.id;
      li.dataset.tipoParada = item.tipo;

      const num = document.createElement('span');
      num.className = 'parada-item__num';
      num.textContent = etiquetaIntermedia(idx);

      const nombre = document.createElement('span');
      nombre.className = 'parada-item__nombre';
      const distEl = document.createElement('span');
      distEl.className = 'parada-item__dist';
      if (e._distKm != null) {
        distEl.textContent = ' — ' + e._distKm.toFixed(1) + ' km';
      }
      nombre.appendChild(document.createTextNode(item.tipo === 'escala' ? formatMunicipio(e) : e.nombre));
      nombre.appendChild(distEl);

      const acciones = document.createElement('div');
      acciones.className = 'parada-item__acciones';

      if (!el.checkAutoOrganizar.checked) {
        if (idx > 0) {
          const btnUp = btnIcono('<polyline points="18 15 12 9 6 15"/>');
          btnUp.title = 'Subir';
          btnUp.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx - 1); });
          btnUp.addEventListener('contextmenu', (evt) => evt.stopPropagation());
          acciones.appendChild(btnUp);
        }
        if (idx < total - 1) {
          const btnDown = btnIcono('<polyline points="6 9 12 15 18 9"/>');
          btnDown.title = 'Bajar';
          btnDown.addEventListener('click', (evt) => { evt.stopPropagation(); reordenar(idx, idx + 1); });
          btnDown.addEventListener('contextmenu', (evt) => evt.stopPropagation());
          acciones.appendChild(btnDown);
        }
      }

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'parada-item__btn';
      if (item.tipo === 'escala') {
        btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarEscala(e.id); });
      } else {
        btnDel.addEventListener('click', (evt) => { evt.stopPropagation(); eliminarParada(e.id); });
      }
      btnDel.title = 'Quitar de la ruta';
      btnDel.setAttribute('aria-label', 'Quitar ' + e.nombre + ' de la ruta');
      btnDel.addEventListener('contextmenu', (evt) => evt.stopPropagation());
      btnDel.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>';

      acciones.appendChild(btnDel);
      li.appendChild(num);
      li.appendChild(nombre);
      li.appendChild(acciones);
      li.role = 'button';
      li.tabIndex = 0;

      const accionPrincipal = () => {
        if (_suprimirProximoClic) { _suprimirProximoClic = false; return; }
        cerrarMenuFila();
        if (item.tipo === 'parada') {
          mostrarCuadroParada(e);
        } else if (item.tipo === 'escala') {
          mostrarCuadroEscala(e);
        }
      };
      li.addEventListener('click', accionPrincipal);
      li.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') { evt.preventDefault(); accionPrincipal(); }
      });

      const construirOpcionesContexto = () => {
        if (item.tipo === 'parada') {
          return [
            { etiqueta: 'Ubicar en el mapa', accion: () => mostrarCuadroParada(e) },
            { etiqueta: 'Eliminar de la ruta', accion: () => eliminarParada(e.id) },
          ];
        }
        return [
          { etiqueta: 'Cambiar pueblo intermedio', accion: () => cambiarPueblo(e) },
          { etiqueta: 'Eliminar pueblo intermedio', accion: () => eliminarEscala(e.id) },
          { etiqueta: 'Ubicar en la ruta', accion: () => mostrarCuadroEscala(e) },
        ];
      };

      li.addEventListener('contextmenu', (evt) => {
        evt.preventDefault();
        abrirMenuFila(construirOpcionesContexto(), evt.clientX, evt.clientY);
      });
      engancharLongPress(li, (evt) => {
        abrirMenuFila(construirOpcionesContexto(), evt.clientX, evt.clientY);
      });

      el.paradasLista.appendChild(li);
    });

    if (state.modoAereo && state.tramosAereo && state.tramosAereo.apDes) {
      el.paradasLista.appendChild(construirFilaAeropuerto(state.tramosAereo, state.tramosAereo.apDes, 'Llegada', state.tramosAereo.distCarro2));
    }
    if (state.modoFluvial && state.tramosFluviales && state.tramosFluviales.pd) {
      el.paradasLista.appendChild(construirFilaPuerto(state.tramosFluviales, state.tramosFluviales.pd, 'Llegada', state.tramosFluviales.distCarro2));
    }
    if (incluirExtremos) {
      el.paradasLista.appendChild(crearFilaExtremo('Z', formatMunicipio(state.destino), 'destino'));
    }
  }

