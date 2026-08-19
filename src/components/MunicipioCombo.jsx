/**
 * src/components/MunicipioCombo.jsx
 * ---------------------------------------------------------------------------
 * Cuadros de selección de municipio (origen, destino, tour y pueblos
 * intermedios) en React.
 *
 * La migración es por comportamiento: el shell sigue siendo estático (los
 * inputs `.combo__trigger` y los chevrons viven en el DOM vanilla/estático) y
 * React solo posee la lista `.combo__list`, que se renderiza por portal:
 *
 *   - Cerrada: dentro de su contenedor `.combo` (hidden).
 *   - Abierta: trasladada a <body> con posición fija para que las opciones no
 *     se corten con el overflow del panel (contrato con js/teclado.js, que
 *     detecta la lista portada cuando `parentElement === document.body`).
 *
 * La fachada vanilla (js/municipioCombo.js) registra cada cuadro llamando a
 * `SimbiosisUI.registrarCombo` con su configuración. Aquí se gestiona el estado
 * del menú (nivel departamentos/municipios/filtrado, selección, teclado) y se
 * exponen las acciones que la app vanilla sigue usando:
 * `configurarCombo`, `registrarCombo`, `deregistrarCombo`, `comboAbrir`,
 * `comboCerrar`, `comboAplicar`, `comboLimpiar`, `comboValor`.
 *
 * Comportamiento equivalente al módulo vanilla original (municipioCombo.js):
 * oprimir el cuadro borra el texto y alterna el menú; enfocar abre; escribir
 * filtra; Escape cierra; Enter con la lista cerrada y un valor elegido ejecuta
 * onEnter; ArrowUp/Down recorren las opciones; clic fuera cierra y desenfoca.
 * ---------------------------------------------------------------------------
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// ---- Registro de cuadros (compartido con la fachada vanilla) ---------------

const VERSION = { n: 0 };
const COMBOS = new Map();
let suscriptor = null;

/** Dependencias globales configuradas por app.js (MunicipioCombo.configurar). */
const DATOS = {
  esMovil: () => false,
  capitales: {},
  formatear: (m) => (m && m.nombre) || '',
  municipios: () => [],
  seleccionarMapa: null,
  teclado: {
    ajustar: () => {},
    reencajar: () => {},
    reposicionar: () => {},
  },
};

let _secuenciaCombo = 0;

function _notificar() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

/** Configura las dependencias globales compartidas por todos los cuadros. */
function configurarCombo(opciones) {
  Object.assign(DATOS, opciones || {});
  _notificar();
}

/** Registra un cuadro para que React renderice su lista dentro de contenedor. */
function registrarCombo(config) {
  if (!config || !config.contenedor) return null;
  const id = config.id || 'combo_' + (++_secuenciaCombo);
  if (COMBOS.has(id)) return id;
  COMBOS.set(id, {
    id,
    contenedor: config.contenedor,
    lineas: config.lineas || 5,
    placeholder: config.placeholder,
    mostrarUbicacionActual: !!config.mostrarUbicacionActual,
    onUbicacionActual: config.onUbicacionActual || null,
    excluirIds: config.excluirIds || null,
    onSeleccionar: config.onSeleccionar || null,
    onEnter: config.onEnter || null,
    scope: config.scope || null,
  });
  _notificar();
  return id;
}

/** Quita un cuadro (p. ej. al eliminar filas de escala) y desmonta su lista. */
function deregistrarCombo(id) {
  if (!COMBOS.delete(id)) return;
  _notificar();
}

function _combo(id) {
  return COMBOS.get(id) || null;
}

function comboAbrir(id) { const c = _combo(id); if (c && c.abrir) c.abrir(); }
function comboCerrar(id) { const c = _combo(id); if (c && c.cerrar) c.cerrar(); }
function comboAplicar(id, m) { const c = _combo(id); if (c && c.aplicar) c.aplicar(m); }
function comboLimpiar(id) { const c = _combo(id); if (c && c.limpiar) c.limpiar(); }
function comboValor(id) { const c = _combo(id); return c && c.valor ? c.valor() : ''; }

// La fachada vanilla usa la misma instancia de SimbiosisUI (bridge.js).
bridge.configurarCombo = configurarCombo;
bridge.registrarCombo = registrarCombo;
bridge.deregistrarCombo = deregistrarCombo;
bridge.comboAbrir = comboAbrir;
bridge.comboCerrar = comboCerrar;
bridge.comboAplicar = comboAplicar;
bridge.comboLimpiar = comboLimpiar;
bridge.comboValor = comboValor;

// ---- Lista de un solo cuadro -------------------------------------------------

function Combo({ cfg }) {
  const [abierto, setAbierto] = useState(false);
  const [nivel, setNivel] = useState('departamentos');
  const [depto, setDepto] = useState(null);
  const [indice, setIndice] = useState(0);
  const [texto, setTexto] = useState('');

  const listRef = useRef(null);
  const estadoRef = useRef({ abierto, nivel, depto, indice, texto, opciones: [] });
  const aplicarRef = useRef(null);
  const seleccionarOpcionRef = useRef(null);
  const abrirRef = useRef(null);
  const cerrarRef = useRef(null);
  const indiceRef = useRef(0);

  function fijarIndice(n) {
    indiceRef.current = n;
    setIndice(n);
  }

  // ---- Datos ----------------------------------------------------------------
  function obtenerDepartamentos() {
    return [...new Set(DATOS.municipios().map((m) => m.departamento))].sort((a, b) => {
      if (a === 'Córdoba' && b === 'Cundinamarca') return -1;
      if (a === 'Cundinamarca' && b === 'Córdoba') return 1;
      return a.localeCompare(b, 'es');
    });
  }

  function obtenerMunicipios(departamento) {
    const capitalNombre = DATOS.capitales[departamento];
    const lista = DATOS.municipios()
      .filter((m) => m.departamento === departamento)
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
    return cfg.excluirIds ? cfg.excluirIds() : new Set();
  }

  // ---- Construcción del menú -------------------------------------------------
  function construirFilas() {
    const excluidos = idsExcluidos();
    const excluye = (m) => excluidos.has(m.id);

    if (nivel === 'municipios') {
      const munis = obtenerMunicipios(depto).filter((m) => !excluye(m));
      return {
        filas: [{ tipo: 'volver' }, ...munis.map((m) => ({ tipo: 'municipio', m, etiqueta: m.nombre }))],
        opciones: munis.map((m) => ({ tipo: 'municipio', m })),
      };
    }

    if (nivel === 'filtrado') {
      const q = texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const munis = DATOS.municipios()
        .filter((m) => {
          if (excluye(m)) return false;
          const nom = m.nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          const dep = m.departamento.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          return nom.includes(q) || dep.includes(q);
        })
        .slice(0, 100);
      if (munis.length === 0) {
        return { filas: [{ tipo: 'vacio' }], opciones: [] };
      }
      const filas = munis.map((m) => ({ tipo: 'municipio', m, etiqueta: m.nombre + ' (' + m.departamento + ')' }));
      return { filas, opciones: filas.slice() };
    }

    // departamentos
    const filas = [];
    const opciones = [];
    if (cfg.mostrarUbicacionActual) {
      filas.push({ tipo: 'ubicacion' });
      opciones.push({ tipo: 'ubicacion' });
    }
    filas.push({ tipo: 'mapa' });
    opciones.push({ tipo: 'mapa' });
    obtenerDepartamentos().forEach((d) => {
      filas.push({ tipo: 'depto', d });
      opciones.push({ tipo: 'depto', d });
    });
    return { filas, opciones };
  }

  // ---- Acciones --------------------------------------------------------------
  function aplicar(m) {
    const t = cfg.contenedor.querySelector('.combo__trigger');
    setAbierto(false);
    if (t) {
      t.value = DATOS.formatear(m);
      t.dataset.selectedId = m.id;
    }
    DATOS.teclado.reposicionar(false);
    if (cfg.onSeleccionar) cfg.onSeleccionar(m);
    if (DATOS.esMovil()) { if (t) t.blur(); }
  }
  aplicarRef.current = aplicar;

  function cerrarYBorrar() {
    setAbierto(false);
    DATOS.teclado.reposicionar(false);
    if (DATOS.esMovil()) {
      const t = cfg.contenedor.querySelector('.combo__trigger');
      if (t) t.blur();
    }
  }

  function seleccionarOpcion(op) {
    if (!op) return;
    if (op.tipo === 'volver') { fijarIndice(0); setNivel('departamentos'); return; }
    if (op.tipo === 'vacio') return;
    if (op.tipo === 'ubicacion') {
      cerrarYBorrar();
      if (cfg.onUbicacionActual) cfg.onUbicacionActual();
      return;
    }
    if (op.tipo === 'mapa') {
      cerrarYBorrar();
      if (cfg.seleccionarMapa) {
        cfg.seleccionarMapa((lat, lon) => {
          aplicarRef.current({
            id: 'map_' + Date.now(),
            lat,
            lon,
            nombre: lat.toFixed(4) + ', ' + lon.toFixed(4),
            departamento: '',
          });
        });
      }
      return;
    }
    if (op.tipo === 'depto') {
      setDepto(op.d);
      const munis = obtenerMunicipios(op.d).filter((m) => !idsExcluidos().has(m.id));
      if (munis.length === 1) aplicarRef.current(munis[0]);
      else { fijarIndice(0); setNivel('municipios'); }
      return;
    }
    if (op.tipo === 'municipio') aplicarRef.current(op.m);
  }
  seleccionarOpcionRef.current = seleccionarOpcion;

  // ---- Abrir/cerrar (función estable: solo usa refs, setters y cfg) --------
  function abrir() {
    const t = cfg.contenedor.querySelector('.combo__trigger');
    const textoActual = t ? t.value.trim() : '';
    if (t && t.dataset.selectedId) {
      t.value = '';
      delete t.dataset.selectedId;
      setNivel('departamentos'); setDepto(null); fijarIndice(0); setTexto('');
    } else if (textoActual) {
      setTexto(textoActual); fijarIndice(0); setNivel('filtrado');
    } else {
      setNivel('departamentos'); setDepto(null); fijarIndice(0); setTexto('');
    }
    setAbierto(true);
    DATOS.teclado.reencajar();
  }
  abrirRef.current = abrir;

  function cerrar() {
    setAbierto(false);
    DATOS.teclado.reencajar();
  }
  cerrarRef.current = cerrar;

  // ---- Eventos imperativos sobre el trigger (la lista la maneja React) ------
  useEffect(() => {
    const contenedor = cfg.contenedor;
    const scope = cfg.scope || contenedor;
    const trigger = contenedor.querySelector('.combo__trigger');
    if (!trigger) return undefined;
    let toqueContrae = false;

    function onPointerDown() {
      const t = contenedor.querySelector('.combo__trigger');
      if (!t || document.activeElement !== t) return;
      toqueContrae = true; // el focus de este toque no debe reabrir
      t.value = '';
      delete t.dataset.selectedId;
      if (estadoRef.current.abierto) cerrarRef.current();
      else abrirRef.current();
    }

    function onFocus(e) {
      e.stopPropagation();
      if (toqueContrae) { toqueContrae = false; return; }
      const t = contenedor.querySelector('.combo__trigger');
      if (t) { t.value = ''; delete t.dataset.selectedId; }
      abrirRef.current();
    }

    function onInput() {
      const t = contenedor.querySelector('.combo__trigger');
      const textoActual = t ? t.value.trim() : '';
      if (textoActual) { setTexto(textoActual); indiceRef.current = 0; setIndice(0); setNivel('filtrado'); }
      else { setNivel('departamentos'); setDepto(null); indiceRef.current = 0; setIndice(0); }
      if (t) delete t.dataset.selectedId;
      DATOS.teclado.reencajar();
    }

    function onBlur() {
      toqueContrae = false;
      cerrarRef.current();
    }

    function onKeyDown(e) {
      const t = contenedor.querySelector('.combo__trigger');
      const est = estadoRef.current;
      if (e.key === 'Escape') { e.preventDefault(); cerrarRef.current(); return; }
      if (e.key === 'Enter' && !est.abierto) {
        if (t && t.dataset.selectedId) {
          e.preventDefault();
          if (cfg.onEnter) cfg.onEnter();
        }
        return;
      }
      if (!est.abierto) return;
      const opciones = est.opciones;
      if (!opciones.length) return;
      let cur = Math.min(indiceRef.current, opciones.length - 1);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cur = Math.min(cur + 1, opciones.length - 1);
        indiceRef.current = cur;
        setIndice(cur);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cur = Math.max(cur - 1, 0);
        indiceRef.current = cur;
        setIndice(cur);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        seleccionarOpcionRef.current(opciones[cur]);
      }
    }

    function onDocClick(e) {
      if (!scope.contains(e.target)) {
        cerrarRef.current();
        const t = contenedor.querySelector('.combo__trigger');
        if (t) t.blur();
      }
    }

    trigger.addEventListener('pointerdown', onPointerDown);
    trigger.addEventListener('focus', onFocus);
    trigger.addEventListener('input', onInput);
    trigger.addEventListener('blur', onBlur);
    trigger.addEventListener('keydown', onKeyDown);
    document.addEventListener('click', onDocClick);

    return () => {
      trigger.removeEventListener('pointerdown', onPointerDown);
      trigger.removeEventListener('focus', onFocus);
      trigger.removeEventListener('input', onInput);
      trigger.removeEventListener('blur', onBlur);
      trigger.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('click', onDocClick);
    };
  }, [cfg]);

  // ---- Contrato con la fachada vanilla --------------------------------------
  // Se asigna en un effect de layout para que, tras registrarCombo (flushSync),
  // las acciones ya estén disponibles cuando la fachada continúa su flujo
  // síncrono (p. ej. combo.abrir() al insertar una fila de escala en el DOM).
  useLayoutEffect(() => {
    const contenedor = cfg.contenedor;
    cfg.abrir = () => abrirRef.current();
    cfg.cerrar = () => cerrarRef.current();
    cfg.aplicar = (m) => aplicarRef.current(m);
    cfg.limpiar = () => {
      const t = contenedor.querySelector('.combo__trigger');
      if (t) { t.value = ''; delete t.dataset.selectedId; }
      setAbierto(false); setNivel('departamentos'); setDepto(null); fijarIndice(0); setTexto('');
      DATOS.teclado.reencajar();
    };
    cfg.fijar = (valor, selectedId) => {
      const t = contenedor.querySelector('.combo__trigger');
      if (!t) return;
      t.value = valor;
      if (selectedId != null) t.dataset.selectedId = selectedId;
      else delete t.dataset.selectedId;
    };
    cfg.valor = () => {
      const t = contenedor.querySelector('.combo__trigger');
      return t ? t.value : '';
    };

    return () => {
      delete cfg.abrir;
      delete cfg.cerrar;
      delete cfg.aplicar;
      delete cfg.limpiar;
      delete cfg.fijar;
      delete cfg.valor;
    };
  }, [cfg]);

  // ---- Posicionamiento: lista portada a <body> (contrato con teclado.js) ----
  // La fila de escala se monta aún fuera del documento (el .combo se agrega al
  // panel después de registrarse); si la lista estuviera abierta en ese momento
  // el rect del cuadro sería 0 y la posición saldría mal. Por eso solo se
  // posiciona cuando el contenedor ya está conectado (escalas.js llama a
  // combo.abrir() tras insertar la fila).
  useLayoutEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const conectado = cfg.contenedor.isConnected;
    if (abierto && conectado) {
      const trigger = cfg.contenedor.querySelector('.combo__trigger');
      listEl._trigger = trigger || null;
      listEl.style.position = 'fixed';
      listEl.style.left = '0px';
      listEl.style.right = 'auto';
      listEl.style.zIndex = '1200';
      listEl.scrollTop = 0;
      if (trigger) {
        DATOS.teclado.ajustar(trigger, listEl);
        DATOS.teclado.reencajar();
      }
    } else {
      delete listEl._trigger;
      listEl.style.position = '';
      listEl.style.left = '';
      listEl.style.right = '';
      listEl.style.top = '';
      listEl.style.bottom = '';
      listEl.style.width = '';
      listEl.style.maxHeight = '';
      listEl.style.zIndex = '';
    }
  }, [abierto, cfg]);

  // ---- Render ---------------------------------------------------------------
  const { filas, opciones } = construirFilas();
  estadoRef.current = { abierto, nivel, depto, indice, texto, opciones };
  indiceRef.current = indice;

  const idxEfectivo = Math.min(indice, Math.max(0, opciones.length - 1));
  let contadorOpciones = 0;

  return createPortal(
    <ul
      ref={listRef}
      className={'combo__list' + ((cfg.lineas || 5) >= 6 ? ' combo__list--6' : '')}
      id={cfg.id + '-list'}
      role="listbox"
      hidden={!abierto}
      onMouseDown={(e) => e.preventDefault()}
    >
      {filas.map((f, i) => {
        let opcionIdx = null;
        if (f.tipo !== 'volver' && f.tipo !== 'vacio') { opcionIdx = contadorOpciones; contadorOpciones += 1; }
        let contenido = '';
        let clase = '';
        if (f.tipo === 'ubicacion') contenido = 'Ubicación actual';
        else if (f.tipo === 'mapa') contenido = 'Seleccionar en el mapa';
        else if (f.tipo === 'depto') contenido = f.d;
        else if (f.tipo === 'municipio') contenido = f.etiqueta;
        else if (f.tipo === 'volver') { contenido = '← Volver'; clase = 'combo__back'; }
        else if (f.tipo === 'vacio') { contenido = 'Sin resultados'; clase = 'no-results'; }
        const resaltado = opcionIdx !== null && opcionIdx === idxEfectivo;
        return (
          <li
            key={i}
            className={clase || undefined}
            aria-selected={resaltado ? 'true' : undefined}
            onClick={(e) => { e.stopPropagation(); seleccionarOpcion(f); }}
          >
            {contenido}
          </li>
        );
      })}
    </ul>,
    abierto ? document.body : cfg.contenedor
  );
}

// ---- Conector: renderiza la lista de cada cuadro registrado -----------------

export default function MunicipioCombos() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  return [...COMBOS.values()].map((cfg) => <Combo key={cfg.id} cfg={cfg} />);
}