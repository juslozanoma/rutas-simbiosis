const AltimetriaModule = (() => {
  let _rutaGeojson = null;
  let _elevacion = null;
  let _paradas = [];      // [{lat, lon, nombre, distKm}]
  let _totalKm = 0;
  let _puntoHover = null;  // {lat, lon, dist, alt}
  let _onSetInicio = null;
  let _onSetFin = null;
  let _onVerMapa = null;

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

  function setDatos(rutaGeojson, elevacion, totalKm) {
    _rutaGeojson = rutaGeojson;
    _elevacion = elevacion;
    _totalKm = totalKm;
    _paradas = [];
    _puntoHover = null;
  }

  function agregarParada(lat, lon, nombre, distKm) {
    _paradas.push({ lat, lon, nombre, distKm });
  }

  function setOnSetInicio(fn) { _onSetInicio = fn; }
  function setOnSetFin(fn) { _onSetFin = fn; }
  function setOnVerMapa(fn) { _onVerMapa = fn; }

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
    const pad = 10;
    const ancho = cont.clientWidth || 300;
    const alto = cont.clientHeight || 140;
    const w = ancho - pad * 2;
    const h = alto - pad * 2;

    function x(d) { return pad + (d / maxD) * w; }
    function y(e) { return pad + h - ((e - minAlt) / rangoAlt) * h; }

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

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', dLine);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#2f7a6b');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);

    const hoverLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    hoverLine.setAttribute('y1', pad);
    hoverLine.setAttribute('y2', pad + h);
    hoverLine.setAttribute('stroke', '#888');
    hoverLine.setAttribute('stroke-width', '1');
    hoverLine.setAttribute('stroke-dasharray', '4 3');
    hoverLine.style.display = 'none';
    svg.appendChild(hoverLine);

    const hoverCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hoverCircle.setAttribute('r', '4');
    hoverCircle.setAttribute('fill', '#246054');
    hoverCircle.style.display = 'none';
    svg.appendChild(hoverCircle);

    // Hit area for hover
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    hit.setAttribute('x', pad);
    hit.setAttribute('y', pad);
    hit.setAttribute('width', w);
    hit.setAttribute('height', h);
    hit.setAttribute('fill', 'transparent');
    svg.appendChild(hit);

    cont.appendChild(svg);
    cont._svg = svg;
    cont._puntos = puntos;
    cont._hoverLine = hoverLine;
    cont._hoverCircle = hoverCircle;
    cont._w = w;
    cont._h = h;
    cont._pad = pad;
    cont._maxD = maxD;
    cont._minAlt = minAlt;
    cont._rangoAlt = rangoAlt;
    cont._paradas = _paradas;
    cont._ancho = ancho;
    cont._alto = alto;
    cont._coords = coords;

    // Parada markers
    for (const p of _paradas) {
      const dist = p.distKm != null ? p.distKm : turf.distance(turf.point([p.lon, p.lat]), turf.point(coords[0]), { units: 'kilometers' });
      const rat = dist / maxD;
      const px = pad + rat * w;
      // Find elevation at that distance
      let ei = 0;
      while (ei < puntos.length - 1 && puntos[ei + 1].d < dist) ei++;
      const alt = puntos[ei] && puntos[ei].e != null ? puntos[ei].e : (minAlt + rangoAlt * 0.5);
      const py = pad + h - ((alt - minAlt) / rangoAlt) * h;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', px);
      circle.setAttribute('cy', py);
      circle.setAttribute('r', '6');
      circle.setAttribute('fill', '#fff');
      circle.setAttribute('stroke', '#e35c2b');
      circle.setAttribute('stroke-width', '2');
      circle.dataset.tipo = 'parada';
      circle.dataset.idx = p.nombre;
      circle.dataset.lat = p.lat;
      circle.dataset.lon = p.lon;
      circle.style.cursor = 'pointer';
      svg.appendChild(circle);
    }

    // Hover
    hit.addEventListener('mousemove', (ev) => { _onHover(cont, ev); });
    hit.addEventListener('mouseleave', () => { _onLeave(cont); });
    hit.addEventListener('click', (ev) => { if (_puntoHover) { _mostrarTooltip(cont, null); } });
  }

  function _onHover(cont, ev) {
    const rect = cont._svg.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const rat = Math.max(0, Math.min(1, (mx - cont._pad) / cont._w));
    const dist = rat * cont._maxD;
    let idx = Math.round(rat * (cont._puntos.length - 1));
    idx = Math.max(0, Math.min(idx, cont._puntos.length - 1));
    const pt = cont._puntos[idx];
    if (!pt) return;
    cont._hoverLine.setAttribute('x1', mx);
    cont._hoverLine.setAttribute('x2', mx);
    cont._hoverLine.style.display = '';
    cont._hoverCircle.setAttribute('cx', mx);
    const alt = pt.e != null ? pt.e : (cont._minAlt + cont._rangoAlt * 0.5);
    cont._hoverCircle.setAttribute('cy', cont._pad + cont._h - ((alt - cont._minAlt) / cont._rangoAlt) * cont._h);
    cont._hoverCircle.style.display = '';
    _puntoHover = { lat: pt.coord[1], lon: pt.coord[0], dist: dist.toFixed(1), alt: alt != null ? alt.toFixed(0) : 'N/A' };
    const info = document.getElementById('altimetria-info');
    if (info) {
      info.hidden = false;
      info.innerHTML = `<span>${dist.toFixed(1)} km</span><span>${alt != null ? alt.toFixed(0) + ' m' : 'N/A'}</span>`;
    }
  }

  function _onLeave(cont) {
    cont._hoverLine.style.display = 'none';
    cont._hoverCircle.style.display = 'none';
    _puntoHover = null;
    const info = document.getElementById('altimetria-info');
    if (info) info.hidden = true;
  }

  function _mostrarTooltip(cont, ev) {
    // placeholder for marker click
  }

  function limpiar() {
    _rutaGeojson = null;
    _elevacion = null;
    _paradas = [];
    _totalKm = 0;
    _puntoHover = null;
    const info = document.getElementById('altimetria-info');
    if (info) info.hidden = true;
  }

  return { setDatos, agregarParada, renderizar, limpiar, setOnSetInicio, setOnSetFin, setOnVerMapa };
})();