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
    { file: 'car.svg', path: '/icons/car.svg', nombre: 'Carro' },
    { file: 'car2.svg', path: '/icons/car2.svg', nombre: 'Carro deportivo' },
    { file: 'car3.svg', path: '/icons/car3.svg', nombre: 'Auto' },
    { file: 'car4.svg', path: '/icons/car4.svg', nombre: 'Carro familiar' },
    { file: 'suv.svg', path: '/icons/suv.svg', nombre: 'SUV' },
    { file: 'pickup.svg', path: '/icons/pickup.svg', nombre: 'Camioneta' },
    { file: 'motorcycle.svg', path: '/icons/motorcycle.svg', nombre: 'Moto' },
    { file: 'motorcycle2.svg', path: '/icons/motorcycle2.svg', nombre: 'Motocicleta' },
    { file: 'motorcycle3.svg', path: '/icons/motorcycle3.svg', nombre: 'Moto clásica' },
    { file: 'scooter.svg', path: '/icons/scooter.svg', nombre: 'Scooter' },
    { file: 'bike.svg', path: '/icons/bike.svg', nombre: 'Bicicleta' },
    { file: 'boat.svg', path: '/icons/boat.svg', nombre: 'Barco' },
    { file: 'airplane.svg', path: '/icons/airplane.svg', nombre: 'Avión' },
    { file: 'hiking.svg', path: '/icons/hiking.svg', nombre: 'Senderista' },
    { file: 'helicopter.svg', path: '/icons/helicopter.svg', nombre: 'Helicóptero' },
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
  }

  /** En modo "Subir tu propia ruta" el indicador es siempre un senderista. */
  function esHiking() {
    return (typeof _rutaArchivoActiva !== 'undefined' && !!_rutaArchivoActiva);
  }

  /** Ruta del SVG de un ícono dado (por defecto senderista si no existe). */
  function _pathDeIcono(file) {
    const def = ICONOS.find((i) => i.file === file);
    return def ? def.path : '/icons/hiking.svg';
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
  // El selector lo renderiza React (src/components/TransportSelector.jsx);
  // aquí solo se avisa al puente `window.SimbiosisUI` para abrirlo/cerrarlo.

  /** Abre el selector flotante cerca de la posición del clic. */
  function abrirSelector(clientX, clientY) {
    if (typeof window !== 'undefined' && window.SimbiosisUI) {
      window.SimbiosisUI.emit('transport-selector:abrir', { clientX: clientX || 0, clientY: clientY || 0 });
    }
  }

  function cerrarSelector() {
    if (typeof window !== 'undefined' && window.SimbiosisUI) {
      window.SimbiosisUI.emit('transport-selector:cerrar');
    }
  }

  return { ICONOS, COLORES, getIcono, getColor, setIcono, setColor, setOnCambio, esHiking, iconoPath, color, divIconoHTML, getIconoHiking, setIconoHiking, abrirSelector, cerrarSelector };

})();
