/**
 * transport.js
 * ---------------------------------------------------------------------------
 * Configuración del vehículo que sigue la ruta terrestre en el mapa y en el
 * perfil de altimetría: al hacer clic sobre el ícono (en el mapa o en la
 * altimetría) se abre un selector con los distintos vehículos disponibles en
 * public/transport/ y una paleta de colores. La elección se guarda en
 * localStorage y se aplica al instante en todos los puntos donde aparece el
 * vehículo (flecha del mapa, carro del perfil y marcador hover del mapa).
 *
 * Expone `TransportConfigModule`.
 * ---------------------------------------------------------------------------
 */
const TransportConfigModule = (() => {

  const _KEY_ICONO = 'transport.icono';
  const _KEY_COLOR = 'transport.color';

  /** Vehículos disponibles. `path` es la ubicación del SVG (negro, monocromo). */
  const ICONOS = [
    { file: 'car.svg', path: 'public/transport/car.svg', nombre: 'Carro' },
    { file: 'car2.svg', path: 'public/transport/car2.svg', nombre: 'Carro deportivo' },
    { file: 'car3.svg', path: 'public/transport/car3.svg', nombre: 'Auto' },
    { file: 'people-in-car-side-view-svgrepo-com.svg', path: 'public/transport/people-in-car-side-view-svgrepo-com.svg', nombre: 'Carro familiar' },
    { file: 'suv-transportation-car-suv-svgrepo-com.svg', path: 'public/transport/suv-transportation-car-suv-svgrepo-com.svg', nombre: 'SUV' },
    { file: 'pickup-svgrepo-com.svg', path: 'public/transport/pickup-svgrepo-com.svg', nombre: 'Camioneta' },
    { file: 'motorcycle.svg', path: 'public/transport/motorcycle.svg', nombre: 'Moto' },
    { file: 'motorcycle2.svg', path: 'public/transport/motorcycle2.svg', nombre: 'Motocicleta' },
    { file: 'motorcycle3.svg', path: 'public/transport/motorcycle3.svg', nombre: 'Moto clásica' },
    { file: 'scooter-transport-svgrepo-com.svg', path: 'public/transport/scooter-transport-svgrepo-com.svg', nombre: 'Scooter' },
    { file: 'bike.svg', path: 'public/transport/bike.svg', nombre: 'Bicicleta' },
    { file: 'boat.svg', path: 'public/transport/boat.svg', nombre: 'Barco' },
    { file: 'airplane.svg', path: 'public/transport/airplane.svg', nombre: 'Avión' },
    { file: 'hiking.svg', path: 'public/transport/hiking.svg', nombre: 'Senderista' },
    { file: 'helicopter.svg', path: 'public/transport/helicopter.svg', nombre: 'Helicóptero' },
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
    { hex: '#8b5e3c', nombre: 'Marrón' },
    { hex: '#00bcd4', nombre: 'Cian' },
    { hex: '#9e9d24', nombre: 'Lima' },
    { hex: '#d4a017', nombre: 'Oro' },
  ];

  let _icono = (() => { try { return localStorage.getItem(_KEY_ICONO) || 'car.svg'; } catch (e) { return 'car.svg'; } })();
  let _color = (() => { try { return localStorage.getItem(_KEY_COLOR) || '#1c1c1c'; } catch (e) { return '#1c1c1c'; } })();

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

  /** Ruta del SVG (monocromo) que se muestra como vehículo. */
  function iconoPath() {
    if (esHiking()) return 'public/transport/hiking.svg';
    const def = ICONOS.find((i) => i.file === _icono);
    return def ? def.path : 'public/transport/car.svg';
  }

  /** Color actual (negro en modo senderista). */
  function color() {
    return esHiking() ? '#000000' : _color;
  }

  function getIcono() { return _icono; }
  function getColor() { return _color; }

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
      return `<img class="transport-vehiculo" src="public/transport/hiking.svg" alt="" style="width:${w};height:${h};${rot}"/>`;
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

    const t1 = document.createElement('div');
    t1.className = 'transport-selector__titulo';
    t1.textContent = 'Vehículo';
    sel.appendChild(t1);

    const grid = document.createElement('div');
    grid.className = 'transport-selector__iconos';
    ICONOS.forEach((icono) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'transport-selector__icono';
      btn.title = icono.nombre;
      btn.dataset.file = icono.file;
      btn.innerHTML = `<div style="width:26px;height:26px;background-color:${_color};-webkit-mask-image:url('${icono.path}');-webkit-mask-repeat:no-repeat;-webkit-mask-position:center;-webkit-mask-size:contain;mask-image:url('${icono.path}');mask-repeat:no-repeat;mask-position:center;mask-size:contain;"></div>`;
      btn.addEventListener('click', () => setIcono(icono.file));
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
    _selector.querySelectorAll('.transport-selector__icono').forEach((btn) => {
      btn.classList.toggle('transport-selector__icono--activo', btn.dataset.file === _icono);
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

  return { ICONOS, COLORES, getIcono, getColor, setIcono, setColor, setOnCambio, esHiking, iconoPath, color, divIconoHTML, abrirSelector, cerrarSelector };

})();
