/**
 * transport.js
 * ---------------------------------------------------------------------------
 * Configuración del vehículo que sigue la ruta terrestre en el mapa y en el
 * perfil de altimetría: al hacer clic sobre el ícono (en el mapa o en la
 * altimetría) se abre un selector con los distintos vehículos disponibles en
 * public/ y una paleta de colores. La elección se guarda en
 * localStorage y se aplica al instante en todos los puntos donde aparece el
 * vehículo (flecha del mapa, carro del perfil y marcador hover del mapa).
 *
 * Expone `TransportConfigModule`.
 * ---------------------------------------------------------------------------
 */
const TransportConfigModule = (() => {

  const _KEY_ICONO = 'transport.icono';
  const _KEY_COLOR = 'transport.color';
  const _KEY_ICONO_HIKING = 'transport.icono-hiking';

  /** Vehículos disponibles. `path` es la ubicación del SVG (negro, monocromo). */
  const ICONOS = [
    { file: 'car.svg', path: 'public/car.svg', nombre: 'Carro' },
    { file: 'car2.svg', path: 'public/car2.svg', nombre: 'Carro deportivo' },
    { file: 'car3.svg', path: 'public/car3.svg', nombre: 'Auto' },
    { file: 'car4.svg', path: 'public/car4.svg', nombre: 'Carro familiar' },
    { file: 'suv.svg', path: 'public/suv.svg', nombre: 'SUV' },
    { file: 'pickup.svg', path: 'public/pickup.svg', nombre: 'Camioneta' },
    { file: 'motorcycle.svg', path: 'public/motorcycle.svg', nombre: 'Moto' },
    { file: 'motorcycle2.svg', path: 'public/motorcycle2.svg', nombre: 'Motocicleta' },
    { file: 'motorcycle3.svg', path: 'public/motorcycle3.svg', nombre: 'Moto clásica' },
    { file: 'scooter.svg', path: 'public/scooter.svg', nombre: 'Scooter' },
    { file: 'bike.svg', path: 'public/bike.svg', nombre: 'Bicicleta' },
    { file: 'boat.svg', path: 'public/boat.svg', nombre: 'Barco' },
    { file: 'airplane.svg', path: 'public/airplane.svg', nombre: 'Avión' },
    { file: 'hiking.svg', path: 'public/hiking.svg', nombre: 'Senderista' },
    { file: 'helicopter.svg', path: 'public/helicopter.svg', nombre: 'Helicóptero' },
  ];

  /** Paleta de colores ofrecida al usuario. */
  const COLORES = [
    { hex: '#1c1c1c', nombre: 'Negro' },
    { hex: '#2f7a6b', nombre: 'Verde' },
    { hex: '#2b6cb0', nombre: 'Azul' },
    { hex: '#c0392b', nombre: 'Rojo' },
    { hex: '#e67e22', nombre: 'Naranja' },
    { hex: '#f1c40f', nombre: 'Amarillo' },
    { hex: '#8e44ad', nombre: 'Morado' },
    { hex: '#16a085', nombre: 'Turquesa' },
    { hex: '#d05278', nombre: 'Rosa' },
    { hex: '#6b7280', nombre: 'Gris' },
    { hex: '#ffffff', nombre: 'Blanco' },
    { hex: '#00bcd4', nombre: 'Cian' },
    { hex: '#9e9d24', nombre: 'Lima' },
    { hex: '#d4a017', nombre: 'Oro' },
  ];

  let _icono = (() => { try { return localStorage.getItem(_KEY_ICONO) || 'car.svg'; } catch (e) { return 'car.svg'; } })();
  let _color = (() => { try { return localStorage.getItem(_KEY_COLOR) || '#1c1c1c'; } catch (e) { return '#1c1c1c'; } })();
  // Ícono del "caminante" en modo ruta de archivo (K): por defecto senderista,
  // pero el usuario puede cambiarlo (p. ej. pulsación larga en móvil).
  let _iconoHiking = (() => { try { return localStorage.getItem(_KEY_ICONO_HIKING) || 'hiking.svg'; } catch (e) { return 'hiking.svg'; } })();

  const _onCambio = [];

  function _persistir() {
    try { localStorage.setItem(_KEY_ICONO, _icono); } catch (e) {}
    try { localStorage.setItem(_KEY_COLOR, _color); } catch (e) {}
  }

  function _notificar() {
    _onCambio.forEach((fn) => { try { fn(); } catch (e) {} });
    if (_selector && !_selector.hidden) _refrescarSelector();
  }

  /** En modo "Subir tu propia ruta" el indicador es siempre un senderista. */
  function esHiking() {
    return (typeof _rutaArchivoActiva !== 'undefined' && !!_rutaArchivoActiva);
  }

  /** Ruta del SVG de un ícono dado (por defecto senderista si no existe). */
  function _pathDeIcono(file) {
    const def = ICONOS.find((i) => i.file === file);
    return def ? def.path : 'public/hiking.svg';
  }

  /** Ruta del SVG (monocromo) que se muestra como vehículo. */
  function iconoPath() {
    return _pathDeIcono(esHiking() ? _iconoHiking : _icono);
  }

  /** Color actual (negro en modo senderista). */
  function color() {
    return esHiking() ? '#000000' : _color;
  }

  function getIcono() { return _icono; }
  function getColor() { return _color; }
  function getIconoHiking() { return _iconoHiking; }

  /** Cambia el ícono usado en modo senderista (ruta de archivo K). */
  function setIconoHiking(file) {
    const def = ICONOS.find((i) => i.file === file);
    if (!def || _iconoHiking === file) return;
    _iconoHiking = file;
    try { localStorage.setItem(_KEY_ICONO_HIKING, file); } catch (e) {}
    _notificar();
  }

  function setIcono(file) {
    const def = ICONOS.find((i) => i.file === file);
    if (!def || _icono === file) return;
    _icono = file;
    _persistir();
    _notificar();
  }

  function setColor(hex) {
    const def = COLORES.find((c) => c.hex.toLowerCase() === String(hex).toLowerCase());
    if (!def || _color === def.hex) return;
    _color = def.hex;
    _persistir();
    _notificar();
  }

  /** Registra una función que se ejecuta al cambiar vehículo o color. */
  function setOnCambio(fn) {
    if (typeof fn === 'function') _onCambio.push(fn);
  }

  /** HTML del vehículo actual con su color (para slots de <img>/divIcon).
   *  El color se aplica con máscara CSS sobre el SVG monocromo. */
  function divIconoHTML(width, height, rotateStyle) {
    const w = (width || 26) + 'px';
    const h = (height || 26) + 'px';
    const rot = rotateStyle || '';
    if (esHiking()) {
      return `<img class="transport-vehiculo" src="${_pathDeIcono(_iconoHiking)}" alt="" style="width:${w};height:${h};${rot}"/>`;
    }
    const path = iconoPath();
    return `<div class="transport-vehiculo" style="width:${w};height:${h};background-color:${_color};-webkit-mask-image:url('${path}');-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain;mask-image:url('${path}');mask-repeat:no-repeat;mask-position:center;mask-size:contain;${rot}"></div>`;
  }

  // -------------------------------------------------------------------
  // Selector flotante (ícono + color)
  // -------------------------------------------------------------------

  let _selector = null;

  function _buildSelector() {
    const sel = document.createElement('div');
    sel.className = 'transport-selector';
    sel.hidden = true;

    const encabezado = document.createElement('div');
    encabezado.className = 'transport-selector__encabezado';
    const t1 = document.createElement('div');
    t1.className = 'transport-selector__titulo';
    t1.textContent = 'Vehículo';
    const btnCerrar = document.createElement('button');
    btnCerrar.type = 'button';
    btnCerrar.className = 'transport-selector__cerrar';
    btnCerrar.title = 'Cerrar';
    btnCerrar.setAttribute('aria-label', 'Cerrar selector de vehículo');
    btnCerrar.textContent = '×';
    btnCerrar.addEventListener('click', () => { sel.hidden = true; });
    encabezado.appendChild(t1);
    encabezado.appendChild(btnCerrar);
    sel.appendChild(encabezado);

    const grid = document.createElement('div');
    grid.className = 'transport-selector__iconos';
    ICONOS.forEach((icono) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'transport-selector__icono';
      btn.title = icono.nombre;
      btn.dataset.file = icono.file;
      btn.innerHTML = `<div style="width:26px;height:26px;background-color:${_color};-webkit-mask-image:url('${icono.path}');-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain;mask-image:url('${icono.path}');mask-repeat:no-repeat;mask-position:center;mask-size:contain;"></div>`;
      btn.addEventListener('click', () => {
        if (esHiking()) setIconoHiking(icono.file);
        else setIcono(icono.file);
      });
      grid.appendChild(btn);
    });
    sel.appendChild(grid);

    const t2 = document.createElement('div');
    t2.className = 'transport-selector__titulo';
    t2.textContent = 'Color';
    sel.appendChild(t2);

    const colores = document.createElement('div');
    colores.className = 'transport-selector__colores';
    COLORES.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'transport-selector__color';
      btn.title = c.nombre;
      btn.dataset.hex = c.hex;
      btn.style.backgroundColor = c.hex;
      btn.addEventListener('click', () => setColor(c.hex));
      colores.appendChild(btn);
    });
    sel.appendChild(colores);

    document.body.appendChild(sel);

    document.addEventListener('click', (e) => {
      if (sel && !sel.hidden && !sel.contains(e.target)) sel.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') sel.hidden = true;
    });

    return sel;
  }

  function _refrescarSelector() {
    if (!_selector) return;
    const activo = esHiking() ? _iconoHiking : _icono;
    _selector.querySelectorAll('.transport-selector__icono').forEach((btn) => {
      btn.classList.toggle('transport-selector__icono--activo', btn.dataset.file === activo);
      const preview = btn.querySelector('div');
      if (preview) preview.style.backgroundColor = _color;
    });
    _selector.querySelectorAll('.transport-selector__color').forEach((btn) => {
      btn.classList.toggle('transport-selector__color--activo', btn.dataset.hex === _color);
    });
  }

  /** Abre el selector flotante cerca de la posición del clic. */
  function abrirSelector(clientX, clientY) {
    if (!_selector) _selector = _buildSelector();
    _refrescarSelector();
    _selector.hidden = false;
    const sw = _selector.offsetWidth || 240;
    const sh = _selector.offsetHeight || 320;
    const left = Math.max(6, Math.min(clientX || 0, window.innerWidth - sw - 6));
    const top = Math.max(6, Math.min(clientY || 0, window.innerHeight - sh - 6));
    _selector.style.left = left + 'px';
    _selector.style.top = top + 'px';
  }

  function cerrarSelector() {
    if (_selector) _selector.hidden = true;
  }

  return { ICONOS, COLORES, getIcono, getColor, setIcono, setColor, setOnCambio, esHiking, iconoPath, color, divIconoHTML, getIconoHiking, setIconoHiking, abrirSelector, cerrarSelector };

})();
