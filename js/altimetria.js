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
    if (limpiarParadas) _paradas = [];
    _puntoHover = null;
  }

  function agregarParada(lat, lon, nombre, distKm, label) {
    _paradas.push({ lat, lon, nombre, distKm, label: label || '' });
  }

  function setOnSetInicio(fn) { _onSetInicio = fn; }
  function setOnSetFin(fn) { _onSetFin = fn; }
  function setOnVerMapa(fn) { _onVerMapa = fn; }
  function setOnHover(fn) { _onHoverMapa = fn; }
  function setOnLeave(fn) { _onLeaveMapa = fn; }

  function renderizar(containerId) {
    const cont = document.getElementById(containerId);
    if (!cont) return;
    if (!_rutaGeojson || !_rutaGeojson.geometry) { cont.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);text-align:center;padding:20px 0;">Calcula una ruta primero</p>'; return; }
    const coords = _rutaGeojson.geometry.coordinates;
    if (coords.length < 2) return;
    const puntos = _acumular(coords, _elevacion);
    const maxD = puntos[puntos.length - 1].d || 1;
    const alturas = puntos.filter(p => p.e != null).map(p => p.e);
    if (alturas.length === 0) { cont.innerHTML = '<p style="font-size:0.78rem;color:var(--text-muted);text-align:center;padding:20px 0;">Datos de elevación no disponibles</p>'; return; }
    const minAlt = Math.min(...alturas);
    const maxAlt = Math.max(...alturas);
    const rangoAlt = Math.max(maxAlt - minAlt, 10);

    // Asymmetric padding for axes
    const padTop = 6;
    const padRight = 10;
    const padBottom = 22;
    const padLeft = 44;
    const ancho = cont.clientWidth || 300;
    const alto = cont.clientHeight || 180;
    const plotW = ancho - padLeft - padRight;
    const plotH = alto - padTop - padBottom;

    function x(d) { return padLeft + (d / maxD) * plotW; }
    function y(e) { return padTop + plotH - ((e - minAlt) / rangoAlt) * plotH; }

    // Nice intervals
    const pasoD = _intervaloBonito(maxD, 6);
    const pasoA = _intervaloBonito(maxAlt - minAlt, 5);
    const altBase = Math.floor(minAlt / pasoA) * pasoA;
    const distBase = Math.floor(0 / pasoD) * pasoD; // 0

    let dLine = '';
    for (let i = 0; i < puntos.length; i++) {
      if (puntos[i].e == null) continue;
      if (!dLine) dLine = `M${x(puntos[i].d)},${y(puntos[i].e)}`;
      else dLine += ` L${x(puntos[i].d)},${y(puntos[i].e)}`;
    }

    cont.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
    svg.setAttribute('preserveAspectRatio', 'none');

    // Y-axis grid lines + labels (elevation)
    for (let alt = altBase; alt <= maxAlt + pasoA * 0.5; alt += pasoA) {
      if (alt < minAlt) continue;
      const gy = y(alt);
      if (gy < padTop) continue;
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
      label.setAttribute('x', padLeft - 5);
      label.setAttribute('y', gy + 3);
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#888');
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', 'inherit');
      label.textContent = alt.toFixed(0) + ' m';
      svg.appendChild(label);
    }

    // X-axis grid lines + labels (distance)
    for (let d = distBase; d <= maxD + pasoD * 0.5; d += pasoD) {
      const gx = x(d);
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
      label.textContent = d.toFixed(0) + ' km';
      svg.appendChild(label);
    }

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

    // Hit area for hover
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', padLeft);
    hit.setAttribute('y', padTop);
    hit.setAttribute('width', plotW);
    hit.setAttribute('height', plotH);
    hit.setAttribute('fill', 'transparent');
    svg.appendChild(hit);

    cont.appendChild(svg);

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

    // Parada markers
    for (const p of _paradas) {
      const dist = p.distKm != null ? p.distKm : turf.distance(turf.point([p.lon, p.lat]), turf.point(coords[0]), { units: 'kilometers' });
      const rat = dist / maxD;
      const px = padLeft + rat * plotW;
      let ei = 0;
      while (ei < puntos.length - 1 && puntos[ei + 1].d < dist) ei++;
      const alt = puntos[ei] && puntos[ei].e != null ? puntos[ei].e : (minAlt + rangoAlt * 0.5);
      const py = padTop + plotH - ((alt - minAlt) / rangoAlt) * plotH;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', px);
      circle.setAttribute('cy', py);
      circle.setAttribute('r', '11');
      circle.setAttribute('fill', '#4a6fa5');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '2');
      circle.dataset.tipo = 'parada';
      circle.dataset.idx = p.nombre;
      circle.dataset.lat = p.lat;
      circle.dataset.lon = p.lon;
      circle.style.cursor = 'pointer';
      circle.addEventListener('click', (ev) => { ev.stopPropagation(); _mostrarMenu(ev, { tipo: 'parada', lat: p.lat, lon: p.lon, nombre: p.nombre, distKm: p.distKm }); });
      svg.appendChild(circle);
      if (p.label) {
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', px);
        text.setAttribute('y', py + 4.5);
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('fill', '#fff');
        text.setAttribute('font-size', '10');
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', 'inherit');
        text.textContent = p.label;
        svg.appendChild(text);
      }
    }

    // A (origen) y Z (destino) markers
    _agregarMarcadorExtremo(svg, puntos, 0, 'A', padLeft, padTop, plotW, plotH, minAlt, rangoAlt, maxD);
    _agregarMarcadorExtremo(svg, puntos, puntos.length - 1, 'Z', padLeft, padTop, plotW, plotH, minAlt, rangoAlt, maxD);

    // Hover listeners
    hit.addEventListener('mousemove', (ev) => { _onHover(cont, ev); });
    hit.addEventListener('mouseleave', () => { _onLeave(cont); });
    hit.addEventListener('click', (ev) => { if (_puntoHover) { _mostrarTooltip(cont, null); } });
  }

  function _agregarMarcadorExtremo(svg, puntos, idx, letra, padLeft, padTop, plotW, plotH, minAlt, rangoAlt, maxD) {
    const pt = puntos[idx];
    if (!pt) return;
    const px = padLeft + (pt.d / maxD) * plotW;
    const alt = pt.e != null ? pt.e : (minAlt + rangoAlt * 0.5);
    const py = padTop + plotH - ((alt - minAlt) / rangoAlt) * plotH;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', px);
    circle.setAttribute('cy', py);
    circle.setAttribute('r', '11');
    circle.setAttribute('fill', '#4a6fa5');
    circle.setAttribute('stroke', '#fff');
    circle.setAttribute('stroke-width', '2');
    circle.style.cursor = 'pointer';
    circle.addEventListener('click', (ev) => { ev.stopPropagation(); _mostrarMenu(ev, { tipo: letra, lat: pt.coord[1], lon: pt.coord[0], nombre: letra, distKm: pt.d }); });
    svg.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', px);
    text.setAttribute('y', py + 4.5);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('fill', '#fff');
    text.setAttribute('font-size', '10');
    text.setAttribute('font-weight', '700');
    text.setAttribute('font-family', 'inherit');
    text.textContent = letra;
    svg.appendChild(text);
  }

  function _onHover(cont, ev) {
    const rect = cont._svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const rat = Math.max(0, Math.min(1, (mx - cont._padLeft) / cont._plotW));
    const dist = rat * cont._maxD;
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
    ['inicio', 'fin', 'ver'].forEach((acc) => {
      const btn = document.createElement('button');
      btn.className = 'altimetria-menu-btn';
      btn.dataset.action = acc;
      btn.textContent = acc === 'inicio' ? 'Asignar como punto inicial' : acc === 'fin' ? 'Asignar como punto final' : 'Ver en el mapa';
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
    btnInicio.style.display = data.tipo === 'Z' ? 'none' : '';
    btnFin.style.display = data.tipo === 'A' ? 'none' : '';
    btnInicio.onclick = () => { _cerrarMenuFlotante(); if (_onSetInicio) _onSetInicio(data); };
    btnFin.onclick = () => { _cerrarMenuFlotante(); if (_onSetFin) _onSetFin(data); };
    btnVer.onclick = () => { _cerrarMenuFlotante(); if (_onVerMapa) _onVerMapa(data); };
    menu.style.display = 'flex';
    menu.style.left = Math.min(ev.clientX + 8, window.innerWidth - 170) + 'px';
    menu.style.top = Math.max(ev.clientY - 10, 10) + 'px';
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

  function mostrarHoverEn(distKm) {
    const cont = document.getElementById('altimetria-chart') || document.getElementById('altimetria-chart-panel');
    if (!cont || !cont._svg || !cont._puntos || !cont._plotW) return;
    const rat = Math.max(0, Math.min(1, distKm / cont._maxD));
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

  return { setDatos, agregarParada, renderizar, limpiar, setOnSetInicio, setOnSetFin, setOnVerMapa, setOnHover, setOnLeave, mostrarHoverEn, ocultarHover, getInfoAt };
})();