const AltimetriaModule = (() => {
  let _rutaGeojson = null;
  let _elevacion = null;
  let _paradas = [];      // [{lat, lon, nombre, distKm}]
  let _totalKm = 0;
  let _puntoHover = null;  // {lat, lon, dist, alt}
  let _onSetInicio = null;
  let _onSetFin = null;
  let _onVerMapa = null;
  let _onHoverMapa = null;
  let _onLeaveMapa = null;
  let _onCentrarMapa = null;
  let _followActivo = true;
  let _inicioOffset = 0;       // distancia (km) del perfil que se muestra como inicio del eje x
  let _finOffset = null;       // distancia (km) del perfil que se muestra como fin del eje x (null = total)
  let _inicioAsignado = false; // true si el usuario asignó un punto como inicio
  let _finAsignado = false;    // true si el usuario asignó un punto como fin
  let _nombreOrigen = 'Origen';
  let _nombreDestino = 'Destino';
  let _onEliminarParada = null;

  const MIN_SPAN_ZOOM = 0.5;   // km mínimos de rango visible al hacer zoom horizontal

  let _tooltipIndicador = null;

  function _acumular(coords, elev) {
    const total = [];
    let acc = 0;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) {
        acc += turf.distance(turf.point(coords[i - 1]), turf.point(coords[i]), { units: 'kilometers' });
      }
      total.push({ d: acc, e: elev && elev[i] != null ? elev[i] : null, coord: coords[i] });
    }
    return total;
  }

  function setDatos(rutaGeojson, elevacion, totalKm, limpiarParadas = true) {
    _rutaGeojson = rutaGeojson;
    _elevacion = elevacion;
    _totalKm = totalKm;
    if (limpiarParadas) {
      _paradas = [];
      _inicioOffset = 0;
      _finOffset = null;
      _inicioAsignado = false;
      _finAsignado = false;
    }
    _puntoHover = null;
  }

  function agregarParada(lat, lon, nombre, distKm, label, id, tipo) {
    _paradas.push({ lat, lon, nombre, distKm, label: label || '', id: id != null ? id : null, tipo: tipo || 'parada' });
  }

  function setOnEliminarParada(fn) { _onEliminarParada = fn; }

  /** Define los nombres de origen y destino para los indicadores A y Z. */
  function setExtremos(nombreOrigen, nombreDestino) {
    _nombreOrigen = nombreOrigen || 'Origen';
    _nombreDestino = nombreDestino || 'Destino';
  }

  /** Muestra el perfil a partir del punto asignado como inicio (distancia en km). */
  function setRangoInicio(distKm) {
    _inicioAsignado = true;
    _inicioOffset = distKm != null ? Number(distKm) : 0;
    _renderizarTodo();
  }

  /** Muestra el perfil hasta el punto asignado como fin (distancia en km). */
  function setRangoFin(distKm) {
    _finAsignado = true;
    _finOffset = distKm != null ? Number(distKm) : null;
    _renderizarTodo();
  }

  /** Quita el punto asignado como inicio y vuelve al origen del perfil. */
  function quitarRangoInicio() {
    _inicioAsignado = false;
    _inicioOffset = 0;
    _renderizarTodo();
  }

  /** Quita el punto asignado como fin y vuelve al final del perfil. */
  function quitarRangoFin() {
    _finAsignado = false;
    _finOffset = null;
    _renderizarTodo();
  }

  function _renderizarTodo() {
    ['altimetria-chart', 'altimetria-chart-panel'].forEach((id) => {
      const cont = document.getElementById(id);
      if (cont) _construir(cont);
    });
  }

  function setOnSetInicio(fn) { _onSetInicio = fn; }
  function setOnSetFin(fn) { _onSetFin = fn; }
  function setOnVerMapa(fn) { _onVerMapa = fn; }
  function setOnHover(fn) { _onHoverMapa = fn; }
  function setOnLeave(fn) { _onLeaveMapa = fn; }
  function setOnCentrarMapa(fn) { _onCentrarMapa = fn; }
  function toggleFollow() { _followActivo = !_followActivo; return _followActivo; }
  function isFollowActivo() { return _followActivo; }

  /** Interpola la altitud del perfil en una distancia dada (km). */
  function _alturaEn(puntos, distKm) {
    let lo = 0;
    while (lo < puntos.length - 1 && puntos[lo + 1].d < distKm) lo++;
    const hi = Math.min(lo + 1, puntos.length - 1);
    const pLo = puntos[lo];
    const pHi = puntos[hi];
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (distKm - pLo.d) / (pHi.d - pLo.d);
        return pLo.e + f * (pHi.e - pLo.e);
      }
      return pLo.e;
    }
    return null;
  }

  /** Ajusta el rango horizontal visible conservando la proporción bajo el cursor. */
  function _aplicarZoom(cont, factor, cxRel) {    const maxD = cont._maxD || 1;
    const minSpan = Math.min(MIN_SPAN_ZOOM, maxD);
    const start = cont._zoomStart;
    const end = cont._zoomEnd;
    let span = (end - start) * factor;
    span = Math.min(Math.max(span, minSpan), maxD);
    const cursorD = start + cxRel * (end - start);
    let ns = cursorD - cxRel * span;
    ns = Math.max(0, Math.min(ns, maxD - span));
    cont._zoomStart = ns;
    cont._zoomEnd = ns + span;
  }

  /** Elimina las etiquetas de los ejes que se superpongan con las de los extremos. */
  function _quitarEtiquetasSolapadas(eje, bordes) {
    for (const el of eje) {
      let bb;
      try { bb = el.getBBox(); } catch (e) { continue; }
      const colisiona = bordes.some((b) => {
        let bb2;
        try { bb2 = b.getBBox(); } catch (e2) { return false; }
        return !(bb.x + bb.width < bb2.x || bb.x > bb2.x + bb2.width || bb.y + bb.height < bb2.y || bb.y > bb2.y + bb2.height);
      });
      if (colisiona) el.remove();
    }
  }

  function _nombreSinDepartamento(nombre) {
    if (!nombre) return '';
    return String(nombre).split(',')[0].trim();
  }

  function renderizar(containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    _construir(cont);
  }

  function _construir(cont) {
    if (!_rutaGeojson || !_rutaGeojson.geometry) { cont.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);text-align:center;padding:20px 0;">Calcula una ruta primero</p>'; return; }
    const coords = _rutaGeojson.geometry.coordinates;
    if (coords.length < 2) return;
    const puntos = _acumular(coords, _elevacion);
    const maxD = puntos[puntos.length - 1].d || 1;

    // Dominio mostrado: desde el punto asignado como inicio hasta el asignado como fin.
    const domInicio = Math.max(0, Math.min(_inicioOffset != null ? _inicioOffset : 0, maxD));
    const domFin = Math.max(domInicio, Math.min(_finOffset != null ? _finOffset : maxD, maxD));

    // Si cambió la ruta o el rango asignado se reinicia el zoom.
    if (cont._geo !== _rutaGeojson || cont._domInicio !== domInicio || cont._domFin !== domFin) {
      cont._geo = _rutaGeojson;
      cont._domInicio = domInicio;
      cont._domFin = domFin;
      cont._zoomStart = domInicio;
      cont._zoomEnd = domFin;
    }
    if (typeof cont._zoomStart !== 'number') { cont._zoomStart = domInicio; cont._zoomEnd = domFin; }
    cont._zoomStart = Math.max(domInicio, Math.min(cont._zoomStart, domFin));
    cont._zoomEnd = Math.max(cont._zoomStart + Math.min(MIN_SPAN_ZOOM, domFin - domInicio), Math.min(cont._zoomEnd, domFin));
    const zoomStart = cont._zoomStart;
    const zoomEnd = cont._zoomEnd;
    const span = zoomEnd - zoomStart;

    // Alturas visibles dentro del rango de zoom (para ajustar el eje vertical).
    const alturasVis = puntos.filter(p => p.e != null && p.d >= zoomStart - 0.001 && p.d <= zoomEnd + 0.001).map(p => p.e);
    let minAlt, maxAlt, rangoAlt;
    if (alturasVis.length) {
      minAlt = Math.min(...alturasVis);
      maxAlt = Math.max(...alturasVis);
    } else {
      const alturas = puntos.filter(p => p.e != null).map(p => p.e);
      minAlt = alturas.length ? Math.min(...alturas) : 0;
      maxAlt = alturas.length ? Math.max(...alturas) : 1;
    }
    rangoAlt = Math.max(maxAlt - minAlt, 10);

    const padTop = 6;
    const padRight = 10;
    const padBottom = 22;
    const padLeft = 52;
    const ancho = cont.clientWidth || 300;
    const alto = cont.clientHeight || 180;
    const plotW = ancho - padLeft - padRight;
    const plotH = alto - padTop - padBottom;

    function x(d) { return padLeft + ((d - zoomStart) / span) * plotW; }
    function y(e) { return padTop + plotH - ((e - minAlt) / rangoAlt) * plotH; }

    // Posiciones de las etiquetas de borde (para no superponer las etiquetas de los ejes).
    const yBordeMin = y(minAlt);
    const yBordeMax = y(maxAlt);
    const xBordeIni = x(zoomStart);
    const xBordeFin = x(zoomEnd);

    const pasoD = _intervaloBonito(span, 6);
    const pasoA = _intervaloBonito(rangoAlt, 5);
    const altBase = Math.floor(minAlt / pasoA) * pasoA;

    const visibles = puntos.filter(p => p.e != null && p.d >= zoomStart - 0.001 && p.d <= zoomEnd + 0.001);
    let dLine = '';
    for (const p of visibles) {
      if (!dLine) dLine = `M${x(p.d)},${y(p.e)}`;
      else dLine += ` L${x(p.d)},${y(p.e)}`;
    }

    cont.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    cont.appendChild(svg);

    const labelsEjeY = [];
    const labelsBordeY = [];
    const labelsEjeX = [];
    const labelsBordeX = [];

    // Y-axis grid lines + labels (elevation)
    for (let alt = altBase; alt <= maxAlt + pasoA * 0.5; alt += pasoA) {
      if (alt < minAlt) continue;
      const gy = y(alt);
      if (gy < padTop) continue;
      if (Math.abs(gy - yBordeMin) < 7 || Math.abs(gy - yBordeMax) < 7) continue;
      const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      gridLine.setAttribute('x1', padLeft);
      gridLine.setAttribute('x2', padLeft + plotW);
      gridLine.setAttribute('y1', gy);
      gridLine.setAttribute('y2', gy);
      gridLine.setAttribute('stroke', '#e0e0e0');
      gridLine.setAttribute('stroke-width', '0.5');
      gridLine.setAttribute('stroke-dasharray', '3 3');
      svg.appendChild(gridLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padLeft - 14);
      label.setAttribute('y', gy + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#888');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'inherit');
      label.textContent = alt.toFixed(0) + ' m';
      labelsEjeY.push(label);
      svg.appendChild(label);
    }

    // Etiquetas de borde vertical: altura mínima y máxima siempre visibles
    [minAlt, maxAlt].forEach((alt) => {
      const gy = y(alt);
      if (gy < padTop - 4 || gy > alto - 4) return;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', padLeft - 14);
      label.setAttribute('y', gy + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#444');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-weight', '600');
      label.setAttribute('font-family', 'inherit');
      label.textContent = alt.toFixed(0) + ' m';
      labelsBordeY.push(label);
      svg.appendChild(label);
    });

    // X-axis grid lines + labels (visible distance range)
    for (let d = Math.ceil(zoomStart / pasoD) * pasoD; d <= zoomEnd + pasoD * 0.5; d += pasoD) {
      const gx = x(d);
      if (Math.abs(gx - xBordeIni) < 7 || Math.abs(gx - xBordeFin) < 7) continue;
      const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      gridLine.setAttribute('x1', gx);
      gridLine.setAttribute('x2', gx);
      gridLine.setAttribute('y1', padTop);
      gridLine.setAttribute('y2', padTop + plotH);
      gridLine.setAttribute('stroke', '#e0e0e0');
      gridLine.setAttribute('stroke-width', '0.5');
      gridLine.setAttribute('stroke-dasharray', '3 3');
      svg.appendChild(gridLine);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', gx);
      label.setAttribute('y', alto - 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#888');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'inherit');
      label.textContent = (d - domInicio).toFixed(1) + ' km';
      labelsEjeX.push(label);
      svg.appendChild(label);
    }

    // Etiquetas de borde: distancia inicial y final del tramo visible siempre visibles
    [zoomStart, zoomEnd].forEach((d) => {
      const gx = x(d);
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', gx);
      label.setAttribute('y', alto - 5);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', '#444');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-weight', '600');
      label.setAttribute('font-family', 'inherit');
      label.textContent = (d - domInicio).toFixed(1) + ' km';
      labelsBordeX.push(label);
      svg.appendChild(label);
    });

    // Las etiquetas de los ejes no pueden superponerse con las de los extremos: se ocultan.
    _quitarEtiquetasSolapadas(labelsEjeY, labelsBordeY);
    _quitarEtiquetasSolapadas(labelsEjeX, labelsBordeX);

    // Border for plot area
    const border = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    border.setAttribute('x', padLeft);
    border.setAttribute('y', padTop);
    border.setAttribute('width', plotW);
    border.setAttribute('height', plotH);
    border.setAttribute('fill', 'none');
    border.setAttribute('stroke', '#ccc');
    border.setAttribute('stroke-width', '1');
    svg.appendChild(border);

    // Elevation path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', dLine);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#2f7a6b');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);

    // Hover line
    const hoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hoverLine.setAttribute('y1', padTop);
    hoverLine.setAttribute('y2', padTop + plotH);
    hoverLine.setAttribute('stroke', '#666');
    hoverLine.setAttribute('stroke-width', '1');
    hoverLine.setAttribute('stroke-dasharray', '4 3');
    hoverLine.style.display = 'none';
    svg.appendChild(hoverLine);

    // Hover circle
    const hoverCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hoverCircle.setAttribute('r', '4');
    hoverCircle.setAttribute('fill', '#246054');
    hoverCircle.style.display = 'none';
    svg.appendChild(hoverCircle);

    // Hit area for hover / zoom
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', padLeft);
    hit.setAttribute('y', padTop);
    hit.setAttribute('width', plotW);
    hit.setAttribute('height', plotH);
    hit.setAttribute('fill', 'transparent');
    svg.appendChild(hit);

    // Store metadata on container
    cont._svg = svg;
    cont._puntos = puntos;
    cont._hoverLine = hoverLine;
    cont._hoverCircle = hoverCircle;
    cont._plotW = plotW;
    cont._plotH = plotH;
    cont._padLeft = padLeft;
    cont._padTop = padTop;
    cont._maxD = maxD;
    cont._minAlt = minAlt;
    cont._rangoAlt = rangoAlt;
    cont._coords = coords;
    cont._zoomStart = zoomStart;
    cont._zoomEnd = zoomEnd;

    // Parada markers (letra incluida en el área clickeable + tooltip con nombre y altura)
    for (const p of _paradas) {
      const dist = p.distKm != null ? p.distKm : turf.distance(turf.point([p.lon, p.lat]), turf.point(coords[0]), { units: 'kilometers' });
      if (dist < zoomStart - 0.001 || dist > zoomEnd + 0.001) continue;
      const px = x(dist);
      const altP = _alturaEn(puntos, dist);
      const py = y(altP != null ? altP : (minAlt + rangoAlt * 0.5));
      const tooltip = altP != null ? `${_nombreSinDepartamento(p.nombre)} · ${altP.toFixed(0)} msnm` : _nombreSinDepartamento(p.nombre);
      _crearIndicador(svg, px, py, p.label || '', { tipo: p.tipo || 'parada', id: p.id, lat: p.lat, lon: p.lon, nombre: p.nombre, distKm: dist }, tooltip, _nombreSinDepartamento(p.nombre));
    }

    // A (origen) y Z (destino) markers
    _agregarIndicadorExtremo(svg, puntos, 0, 'A', _nombreOrigen, zoomStart, zoomEnd, x, y, minAlt, rangoAlt);
    _agregarIndicadorExtremo(svg, puntos, puntos.length - 1, 'Z', _nombreDestino, zoomStart, zoomEnd, x, y, minAlt, rangoAlt);

    // Las etiquetas del eje X se dibujan al final (z alto) para no quedar ocultas
    // ni cortadas (por ejemplo el "km" del último valor).
    [...labelsEjeX, ...labelsBordeX].filter((l) => l.parentNode === svg).forEach((lbl) => {
      svg.appendChild(lbl);
      try {
        const bb = lbl.getBBox();
        if (bb.x < 2) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x - 2));
        else if (bb.x + bb.width > ancho - 2) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x + bb.width - ancho + 2));
      } catch (e) { /* ignorar */ }
    });

    // Hover listeners
    hit.addEventListener('mousemove', (ev) => { _onHover(cont, ev); });
    hit.addEventListener('mouseleave', () => { _onLeave(cont); });
    hit.addEventListener('click', (ev) => { if (_puntoHover) { _mostrarTooltip(cont, null); } });
    // Touch support for mobile (hover de un dedo y zoom con dos dedos)
    hit.addEventListener('touchstart', (ev) => { ev.preventDefault(); _onTouchStart(cont, ev); }, { passive: false });
    hit.addEventListener('touchmove', (ev) => { ev.preventDefault(); _onTouchMove(cont, ev); }, { passive: false });

    // Zoom horizontal con la rueda del ratón; doble clic para restablecer
    svg.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const cxRel = Math.max(0, Math.min(1, (mx - padLeft) / plotW));
      const factor = ev.deltaY > 0 ? 1.2 : 1 / 1.2;
      _aplicarZoom(cont, factor, cxRel);
      _construir(cont);
    }, { passive: false });
    svg.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      cont._zoomStart = 0;
      cont._zoomEnd = maxD;
      _construir(cont);
    });
  }

  /** Crea el indicador circular (con su letra incluida en el área clickeable) y tooltip al pasar el mouse. */
  function _crearIndicador(svg, px, py, letra, data, tooltipTexto, labelNombre) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.style.cursor = 'pointer';

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', px);
    circle.setAttribute('cy', py);
    circle.setAttribute('r', '11');
    circle.setAttribute('fill', '#4a6fa5');
    g.appendChild(circle);

    if (letra) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', px);
      text.setAttribute('y', py + 4.5);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-weight', '700');
      text.setAttribute('font-family', 'inherit');
      text.textContent = letra;
      text.style.pointerEvents = 'none';
      g.appendChild(text);
    }

    g.addEventListener('click', (ev) => { ev.stopPropagation(); _mostrarMenu(ev, data); });
    g.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); _mostrarMenu(ev, data); });
    g.addEventListener('mouseenter', (ev) => _mostrarTooltipIndicador(ev, tooltipTexto));
    g.addEventListener('mousemove', (ev) => _mostrarTooltipIndicador(ev, tooltipTexto));
    g.addEventListener('mouseleave', () => _ocultarTooltipIndicador());
    svg.appendChild(g);

    // Etiqueta muy pequeña con el nombre (sin departamento) sobre el indicador.
    // Puede salirse por arriba del área de los ejes pero se dibuja al final (z alto).
    if (labelNombre) {
      const cont = svg.parentNode;
      const padLeft = cont._padLeft != null ? cont._padLeft : 52;
      const padTop = cont._padTop != null ? cont._padTop : 6;
      const plotW = cont._plotW != null ? cont._plotW : 200;
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', px);
      lbl.setAttribute('y', Math.max(py - 13, 2));
      lbl.setAttribute('text-anchor', 'middle');
      lbl.setAttribute('fill', '#666');
      lbl.setAttribute('font-size', '7');
      lbl.setAttribute('font-family', 'inherit');
      lbl.textContent = labelNombre;
      svg.appendChild(lbl);
      try {
        const bb = lbl.getBBox();
        if (bb.x < padLeft) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x - padLeft) - 2);
        else if (bb.x + bb.width > padLeft + plotW) lbl.setAttribute('x', lbl.getAttribute('x') - (bb.x + bb.width - padLeft - plotW) - 2);
      } catch (e) { /* ignorar */ }
    }
  }

  function _agregarIndicadorExtremo(svg, puntos, idx, letra, nombre, zoomStart, zoomEnd, x, y, minAlt, rangoAlt) {
    const pt = puntos[idx];
    if (!pt) return;
    const dist = pt.d;
    if (dist < zoomStart - 0.001 || dist > zoomEnd + 0.001) return;
    const px = x(dist);
    const alt = pt.e != null ? pt.e : (minAlt + rangoAlt * 0.5);
    const py = y(alt);
    const tooltip = pt.e != null ? `${_nombreSinDepartamento(nombre)} · ${pt.e.toFixed(0)} msnm` : _nombreSinDepartamento(nombre);
    _crearIndicador(svg, px, py, letra, { tipo: letra, lat: pt.coord[1], lon: pt.coord[0], nombre: letra, distKm: dist }, tooltip, _nombreSinDepartamento(nombre));
  }

  function _mostrarTooltipIndicador(ev, texto) {
    const tt = _getTooltipIndicador();
    tt.textContent = texto;
    tt.style.display = 'block';
    const x = ev.clientX + 12;
    const y = ev.clientY + 12;
    tt.style.left = Math.min(x, window.innerWidth - 180) + 'px';
    tt.style.top = Math.min(y, window.innerHeight - 40) + 'px';
  }

  function _ocultarTooltipIndicador() {
    if (_tooltipIndicador) _tooltipIndicador.style.display = 'none';
  }

  function _getTooltipIndicador() {
    if (!_tooltipIndicador) {
      _tooltipIndicador = document.createElement('div');
      _tooltipIndicador.className = 'altimetria-mark-tooltip';
      _tooltipIndicador.style.display = 'none';
      document.body.appendChild(_tooltipIndicador);
    }
    return _tooltipIndicador;
  }

  function _onHover(cont, ev) {
    const rect = cont._svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const rat = Math.max(0, Math.min(1, (mx - cont._padLeft) / cont._plotW));
    const dist = cont._zoomStart + rat * (cont._zoomEnd - cont._zoomStart);
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < dist) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pt = cont._puntos[lo];
    if (!pt) return;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    cont._hoverCircle.setAttribute('cx', mx);
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    let alt;
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (dist - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else {
        alt = pLo.e;
      }
    } else {
      alt = cont._minAlt + cont._rangoAlt * 0.5;
    }
    cont._hoverCircle.setAttribute('cy', cont._padTop + cont._plotH - ((alt - cont._minAlt) / cont._rangoAlt) * cont._plotH);
    cont._hoverCircle.style.display = '';
    _puntoHover = { lat: pt.coord[1], lon: pt.coord[0], dist: dist.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A' };
    if (_onHoverMapa) _onHoverMapa(_puntoHover);
    if (_followActivo && _onCentrarMapa) { _onCentrarMapa(_puntoHover); }
    const suffix = cont.id.includes('-panel') ? '-panel' : '';
    const distEl = document.getElementById('altimetria-dist' + suffix);
    const altEl = document.getElementById('altimetria-alt' + suffix);
    if (distEl) distEl.textContent = `${dist.toFixed(1)} km`;
    if (altEl) altEl.textContent = alt != null ? alt.toFixed(0) + ' msnm' : '';
  }

  function _intervaloBonito(rango, divisiones = 5) {
    const bruto = rango / divisiones;
    const magnitud = Math.pow(10, Math.floor(Math.log10(bruto)));
    const residuo = bruto / magnitud;
    let paso;
    if (residuo <= 1.5) paso = magnitud;
    else if (residuo <= 3) paso = 2 * magnitud;
    else if (residuo <= 7) paso = 5 * magnitud;
    else paso = 10 * magnitud;
    return paso || 1;
  }

  function _distTouches(ev) {
    const t0 = ev.touches[0];
    const t1 = ev.touches[1];
    return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
  }

  function _onTouchStart(cont, ev) {
    if (ev.touches.length === 2) {
      cont._pinchDist = _distTouches(ev);
      return;
    }
    _onTouchHover(cont, ev);
  }

  function _onTouchMove(cont, ev) {
    if (ev.touches.length === 2 && cont._pinchDist) {
      const d = _distTouches(ev);
      if (d > 0) {
        const factor = cont._pinchDist / d;
        const rect = cont._svg.getBoundingClientRect();
        const midX = (ev.touches[0].clientX + ev.touches[1].clientX) / 2;
        const cxRel = Math.max(0, Math.min(1, (midX - rect.left - cont._padLeft) / cont._plotW));
        _aplicarZoom(cont, factor, cxRel);
        cont._pinchDist = d;
        _construir(cont);
      }
      return;
    }
    if (ev.touches.length === 1) _onTouchHover(cont, ev);
  }

  function _onTouchHover(cont, ev) {
    const touch = ev.touches[0];
    if (!touch) return;
    const rect = cont._svg.getBoundingClientRect();
    const mx = touch.clientX - rect.left;
    const my = touch.clientY - rect.top;
    const rat = Math.max(0, Math.min(1, (mx - cont._padLeft) / cont._plotW));
    const dist = cont._zoomStart + rat * (cont._zoomEnd - cont._zoomStart);
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < dist) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pt = cont._puntos[lo];
    if (!pt) return;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    cont._hoverCircle.setAttribute('cx', mx);
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    let alt;
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (dist - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else {
        alt = pLo.e;
      }
    } else {
      alt = cont._minAlt + cont._rangoAlt * 0.5;
    }
    cont._hoverCircle.setAttribute('cy', cont._padTop + cont._plotH - ((alt - cont._minAlt) / cont._rangoAlt) * cont._plotH);
    cont._hoverCircle.style.display = '';
    _puntoHover = { lat: pt.coord[1], lon: pt.coord[0], dist: dist.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A' };
    if (_onHoverMapa) _onHoverMapa(_puntoHover);
    if (_followActivo && _onCentrarMapa) { _onCentrarMapa(_puntoHover); }
    const suffix = cont.id.includes('-panel') ? '-panel' : '';
    const distEl = document.getElementById('altimetria-dist' + suffix);
    const altEl = document.getElementById('altimetria-alt' + suffix);
    if (distEl) distEl.textContent = `${dist.toFixed(1)} km`;
    if (altEl) altEl.textContent = alt != null ? alt.toFixed(0) + ' msnm' : '';
  }

  function _onLeave(cont) {
    cont._hoverLine.style.display = 'none';
    cont._hoverCircle.style.display = 'none';
    _puntoHover = null;
    if (_onLeaveMapa) _onLeaveMapa();
    const suffix = cont.id.includes('-panel') ? '-panel' : '';
    const distEl = document.getElementById('altimetria-dist' + suffix);
    const altEl = document.getElementById('altimetria-alt' + suffix);
    if (distEl) distEl.textContent = '';
    if (altEl) altEl.textContent = '';
  }

  function _mostrarTooltip(cont, ev) {
    // placeholder for marker click
  }

  let _menuFlotante = null;

  function _crearMenuFlotante() {
    if (_menuFlotante) return _menuFlotante;
    _menuFlotante = document.createElement('div');
    _menuFlotante.className = 'altimetria-floating-menu';
    const definiciones = [
      ['inicio', 'Asignar como punto inicial'],
      ['fin', 'Asignar como punto final'],
      ['ver', 'Ver en el mapa'],
      ['eliminar', 'Eliminar esta parada'],
      ['quitar-inicio', 'Quitar como punto inicial'],
      ['quitar-fin', 'Quitar como punto final'],
    ];
    definiciones.forEach(([acc, texto]) => {
      const btn = document.createElement('button');
      btn.className = 'altimetria-menu-btn';
      btn.dataset.action = acc;
      btn.textContent = texto;
      _menuFlotante.appendChild(btn);
    });
    document.body.appendChild(_menuFlotante);
    document.addEventListener('click', (e) => {
      if (_menuFlotante && !_menuFlotante.contains(e.target)) _cerrarMenuFlotante();
    });
    return _menuFlotante;
  }

  function _cerrarMenuFlotante() {
    if (_menuFlotante) _menuFlotante.style.display = 'none';
  }

  function _mostrarMenu(ev, data) {
    const menu = _crearMenuFlotante();
    menu._menuData = data;
    const btnInicio = menu.querySelector('[data-action="inicio"]');
    const btnFin = menu.querySelector('[data-action="fin"]');
    const btnVer = menu.querySelector('[data-action="ver"]');
    const btnEliminar = menu.querySelector('[data-action="eliminar"]');
    const btnQuitarIni = menu.querySelector('[data-action="quitar-inicio"]');
    const btnQuitarFin = menu.querySelector('[data-action="quitar-fin"]');
    const esExtremo = data.tipo === 'A' || data.tipo === 'Z';
    const distKm = data.distKm != null ? Number(data.distKm) : null;
    const esInicioActual = _inicioAsignado && distKm != null && Math.abs(_inicioOffset - distKm) < 0.001;
    const esFinActual = _finAsignado && distKm != null && _finOffset != null && Math.abs(_finOffset - distKm) < 0.001;
    btnInicio.style.display = (esExtremo || data.tipo === 'Z' || esInicioActual) ? 'none' : '';
    btnFin.style.display = (esExtremo || data.tipo === 'A' || esFinActual) ? 'none' : '';
    if (btnEliminar) btnEliminar.style.display = esExtremo ? 'none' : '';
    if (btnQuitarIni) btnQuitarIni.style.display = esInicioActual ? '' : 'none';
    if (btnQuitarFin) btnQuitarFin.style.display = esFinActual ? '' : 'none';
    btnInicio.onclick = () => { _cerrarMenuFlotante(); if (_onSetInicio) _onSetInicio(data); };
    btnFin.onclick = () => { _cerrarMenuFlotante(); if (_onSetFin) _onSetFin(data); };
    btnVer.onclick = () => { _cerrarMenuFlotante(); if (_onVerMapa) _onVerMapa(data); };
    if (btnEliminar) {
      btnEliminar.onclick = () => { _cerrarMenuFlotante(); if (_onEliminarParada) _onEliminarParada(data); };
    }
    if (btnQuitarIni) btnQuitarIni.onclick = () => { _cerrarMenuFlotante(); quitarRangoInicio(); };
    if (btnQuitarFin) btnQuitarFin.onclick = () => { _cerrarMenuFlotante(); quitarRangoFin(); };
    menu.style.display = 'flex';
    const mw = menu.offsetWidth || 180;
    const mh = menu.offsetHeight || 200;
    menu.style.left = Math.max(4, Math.min(ev.clientX + 8, window.innerWidth - mw - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(ev.clientY - 10, window.innerHeight - mh - 4)) + 'px';
  }

  function limpiar() {
    _rutaGeojson = null;
    _elevacion = null;
    _paradas = [];
    _totalKm = 0;
    _puntoHover = null;
    ['', '-panel'].forEach((suffix) => {
      const d = document.getElementById('altimetria-dist' + suffix);
      const a = document.getElementById('altimetria-alt' + suffix);
      if (d) d.textContent = '';
      if (a) a.textContent = '';
    });
  }

  function mostrarHoverEn(distKm, seguir) {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._svg || !cont._puntos || !cont._plotW) return;
    const zs = cont._zoomStart || 0;
    const ze = cont._zoomEnd != null ? cont._zoomEnd : cont._maxD;
    const span = (ze - zs) || 1;
    const rat = Math.max(0, Math.min(1, (distKm - zs) / span));
    const mx = cont._padLeft + rat * cont._plotW;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    let lo = 0;
    while (lo < cont._puntos.length - 1 && cont._puntos[lo + 1].d < distKm) lo++;
    const hi = Math.min(lo + 1, cont._puntos.length - 1);
    const pLo = cont._puntos[lo];
    const pHi = cont._puntos[hi];
    let alt = null;
    if (pLo && pLo.e != null) {
      if (pHi && pHi.e != null && pHi.d > pLo.d) {
        const f = (distKm - pLo.d) / (pHi.d - pLo.d);
        alt = pLo.e + f * (pHi.e - pLo.e);
      } else {
        alt = pLo.e;
      }
    }
    if (alt != null) {
      cont._hoverCircle.setAttribute('cx', mx);
      cont._hoverCircle.setAttribute('cy', cont._padTop + cont._plotH - ((alt - cont._minAlt) / cont._rangoAlt) * cont._plotH);
      cont._hoverCircle.style.display = '';
    }
    if (seguir !== false && _followActivo && _onCentrarMapa) {
      const pt = cont._puntos[lo];
      if (pt) { _onCentrarMapa({ lat: pt.coord[1], lon: pt.coord[0], dist: distKm.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A' }); }
    }
    const suffix = cont.id.includes('-panel') ? '-panel' : '';
    const distEl = document.getElementById('altimetria-dist' + suffix);
    const altEl = document.getElementById('altimetria-alt' + suffix);
    if (distEl) distEl.textContent = `${distKm.toFixed(1)} km`;
    if (altEl) altEl.textContent = alt != null ? alt.toFixed(0) + ' msnm' : '';
  }

  function ocultarHover() {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._hoverLine) return;
    cont._hoverLine.style.display = 'none';
    cont._hoverCircle.style.display = 'none';
  }

  function getInfoAt(distKm) {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._puntos) return { alt: null, dist: distKm };
    let ei = 0;
    while (ei < cont._puntos.length - 1 && cont._puntos[ei + 1].d < distKm) ei++;
    const alt = cont._puntos[ei] && cont._puntos[ei].e != null ? cont._puntos[ei].e : null;
    return { alt, dist: distKm };
  }

  return { setDatos, agregarParada, renderizar, limpiar, setOnSetInicio, setOnSetFin, setOnVerMapa, setOnHover, setOnLeave, setOnCentrarMapa, setOnEliminarParada, setExtremos, setRangoInicio, setRangoFin, quitarRangoInicio, quitarRangoFin, toggleFollow, isFollowActivo, mostrarHoverEn, ocultarHover, getInfoAt };
})();
