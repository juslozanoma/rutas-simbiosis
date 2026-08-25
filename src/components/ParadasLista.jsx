/**
 * src/components/ParadasLista.jsx
 * ---------------------------------------------------------------------------
 * Lista de paradas de la pestaña Ruta en React (migración por comportamiento
 * del módulo vanilla js/paradas.js:renderizarParadas).
 *
 * La cáscara sigue siendo estática: el <ul id="paradas-lista"> vive en el shell
 * y es un contenedor COMPARTIDO con otros dos renderizados vanilla: el
 * catálogo de puertos/aeropuertos/departamentos/municipios/categorías
 * (js/paradas.js:renderizarInfraListado, teclas P/A/D/M/C) y el listado de
 * rutas desde archivo (js/rutaArchivo.js:_renderTarjetas, tecla K). React solo
 * monta su contenido por portal cuando el modo de lista es 'paradas'
 * (window.SimbiosisUI.modoListaRuta()).
 *
 * El render se fuerza de nuevo en cada notificación vanilla
 * (window.SimbiosisUI.notificarListaRuta) re-MONTAÑDO el componente (key =
 * versión del store). Así el <ul> interno se reemplaza entero con un solo
 * removeChild y el drag & drop de Sortable puede mover los <li> libremente sin
 * romper la reconciliación de React (que de otro modo intentaría re-colocar
 * nodos movidos y fallaría con NotFoundError). Esto equivale al innerHTML=''
 * que hacía renderizarParadas vanilla.
 *
 * El estado de días plegados vive en React pero se reinicia en cada montaje
 * (igual que vanilla: cada renderizarParadas reconstruía la lista y desplegaba
 * todos los días). Los comportamientos pesados (Sortable, swipe para borrar,
 * marquee, observador, pulsación larga) siguen siendo las funciones globales
 * vanilla, enganchadas por efectos sobre los nodos renderizados por React.
 * ---------------------------------------------------------------------------
 */
import { Fragment, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarListaRuta() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarListaRuta = notificarListaRuta;

function _ui() {
  return w.SimbiosisUI || null;
}

/** Clic sintético posterior a una pulsación larga / deslizamiento (iOS): se
 *  ignora para no abrir la ficha ni cerrar el menú (contrato con la bandera
 *  `_suprimirProximoClic` de js/paradas.js y js/core.js). */
function _consumirClic() {
  const u = _ui();
  return !!(u && typeof u.consumirClicSintetico === 'function' && u.consumirClicSintetico());
}

/** Abre el menú contextual de una fila (js/paradas.js:abrirMenuFila). */
function _abrirMenu(opciones, clientX, clientY) {
  if (typeof w.abrirMenuFila === 'function') w.abrirMenuFila(opciones, clientX, clientY);
}

/** Clic derecho sobre una fila: en táctil se suprime (el menú se abre con el
 *  botón hamburguesa); en PC abre el menú contextual (js/paradas.js). */
function _abrirContexto(evt, construirOpciones) {
  if (typeof w._abrirContextoParada === 'function') {
    w._abrirContextoParada(evt.nativeEvent, construirOpciones);
    return;
  }
  evt.preventDefault();
  if (evt.nativeEvent.pointerType === 'touch' || evt.nativeEvent.pointerType === 'pen') return;
  if (typeof w.abrirMenuFila === 'function') w.abrirMenuFila(construirOpciones(), evt.clientX, evt.clientY);
}

/** Pulsación larga en móvil sobre una fila (js/paradas.js:engancharLongPress).
 *  Solo se usa en los encabezados de día: el resto abre su menú únicamente con
 *  el botón hamburguesa. */
function usePulsacionLarga(alDisparar) {
  const ref = useRef(null);
  const cbRef = useRef(alDisparar);
  cbRef.current = alDisparar;
  useLayoutEffect(() => {
    const li = ref.current;
    if (!li || typeof w.engancharLongPress !== 'function') return;
    w.engancharLongPress(li, (evt) => cbRef.current(evt));
  }, []);
  return ref;
}

const etiquetaDia = (d) => (typeof w._etiquetaDia === 'function' ? w._etiquetaDia(d) : 'Día ' + d);
const opcionesDia = (d) => (typeof w._opcionesDia === 'function' ? w._opcionesDia(d) : []);
const etiquetaIntermedia = (idx) => {
  if (typeof w.etiquetaIntermedia === 'function') return w.etiquetaIntermedia(idx);
  return String(idx + 1);
};
const formatMunicipio = (m) => (typeof w.formatMunicipio === 'function' ? w.formatMunicipio(m) : (m && m.nombre) || '');

// ---- Construcción de las filas (equivalente al cuerpo de renderizarParadas) --

function construirFilas(datos) {
  const {
    orden, escalas, paradas, origen, destino, rutaActual,
    dias: diasN, diasOrden, modoAereo, tramosAereo, modoFluvial, tramosFluviales,
  } = datos;

  const items = orden.map((o) => {
    if (o.tipo === 'escala') {
      const e = escalas.find((x) => x.id === o.id);
      if (!e || e.lat == null) return null;
      return { tipo: 'escala', datos: e };
    }
    const p = paradas.find((x) => x.id === o.id);
    if (!p) return null;
    return { tipo: 'parada', datos: p };
    }).filter(Boolean).filter((item) => !item.datos._dragGenerated);

    // Reordenar automáticamente por cercanía al ORIGEN (proyección de cada
    // punto sobre la ruta): el listado y las letras siguen la misma secuencia.
    try {
      const idsTodos = items.map((it) => String(it.datos.id));
      let ordenIds = idsTodos;
      if (w.MapModule && typeof w.MapModule.idsEnOrdenDeRuta === 'function') {
        ordenIds = w.MapModule.idsEnOrdenDeRuta(idsTodos);
      }
      const posDe = new Map(ordenIds.map((id, i) => [id, i]));
      items.sort((a, b) => (
        (posDe.get(String(a.datos.id)) != null ? posDe.get(String(a.datos.id)) : 9999)
        - (posDe.get(String(b.datos.id)) != null ? posDe.get(String(b.datos.id)) : 9999)
      ));
    } catch (e) {
      console.error('[simbiosis] reorden por cercanía falló:', e);
    }


  // Distancia desde la parada anterior: diferencia del km acumulado entre
  // paradas consecutivas (la primera mide desde el origen, km 0). Se calcula
  // en una tabla local sin mutar los objetos de state (a diferencia de
  // vanilla, que escribía e._segKm).
  const segKmPorItem = new Map();
  {
    let prev = 0;
    items.forEach((it) => {
      const e = it.datos;
      if (e && e._distKm != null) {
        segKmPorItem.set(e, Math.max(0, Number(e._distKm) - prev));
        prev = Number(e._distKm);
      } else if (e) {
        segKmPorItem.set(e, null);
      }
    });
  }

    // Letras por secuencia del listado YA ordenado por cercanía al origen:
    // el punto más cercano sigue a A con la siguiente letra, y así sucesivamente.
    const etqDe = (it2, baseIdx) => etiquetaIntermedia(baseIdx);

    const total = items.length;
  const incluirExtremos = Boolean(rutaActual && origen && destino);

  // Días de viaje: cada parada queda en su día. Si se arrastró una parada a
  // otro día (state.diasOrden) se respeta esa posición manual; si no, se usa
  // un reparto parejo por cantidad.
  const dias = Math.max(1, diasN || 1);
  const totalKm = rutaActual && rutaActual.distanciaMetros ? rutaActual.distanciaMetros / 1000 : 0;
  const base = Math.floor(total / dias);
  const resto = total % dias;
  const bordes = [];
  let acc = 0;
  for (let d = 0; d < dias; d++) { bordes.push(acc); acc += base + (d < resto ? 1 : 0); }
  bordes.push(total);
  const keyDeItem = (it) => it.tipo + ':' + it.datos.id;
  const diaDeItemIdx = (idx) => {
    const itx = items[idx];
    if (itx && diasOrden) {
      const manual = diasOrden[keyDeItem(itx)];
      if (manual != null && manual >= 1 && manual <= dias) return manual;
    }
    for (let d = 0; d < dias; d++) if (idx < bordes[d + 1]) return d + 1;
    return dias;
  };

  // Último punto (por km) de cada día, para km por día y "desde <lugar>".
  const finKmDia = new Array(dias).fill(0);
  const ultimoDeCadaDia = {};
  items.forEach((it, idx) => {
    const d = diaDeItemIdx(idx);
    ultimoDeCadaDia[d] = it;
    if (it.datos && it.datos._distKm != null) {
      finKmDia[d - 1] = Math.max(finKmDia[d - 1], Number(it.datos._distKm));
    }
  });
  const kmsDia = (() => {
    const kms = [];
    let prev = 0;
    for (let d = 1; d <= dias; d++) {
      let end = finKmDia[d - 1];
      if (d === dias) end = totalKm;
      kms.push(Math.max(0, end - prev));
      prev = end;
    }
    return kms;
  })();

  /** Lugar donde comienza el día `d` (1-based): el origen si es el día 1, o el
   *  último punto del día anterior (donde termina la ruta del día previo). */
  const ciudadInicioDia = (d) => {
    if (d <= 1) return origen && origen.nombre ? origen.nombre : '';
    const it = ultimoDeCadaDia[d - 1];
    return it && it.datos && it.datos.nombre ? it.datos.nombre : '';
  };

  // Recorre las paradas en el mismo orden que vanilla: extremo A, aeropuertos/
  // puertos intercalados, paradas/escalas con su etiqueta, extremo Z.
  const filas = [];
  let grupoActual = 1;
  let kmActual = 0;
  let ultimoRegular = null;
  let nAux = 0;
  const asegurarDiaPara = (idx) => { grupoActual = diaDeItemIdx(idx); return grupoActual; };
  const agregarItem = (fila, info) => {
    filas.push({ ...fila, day: grupoActual });
    if (info && (info.item.tipo === 'escala' || info.item.tipo === 'parada')) ultimoRegular = info;
  };

  const filaAeropuerto = (ap, prefijo, distKm) => {
    nAux += 1;
    const nombre = (prefijo ? prefijo + ': ' : '') + (ap.nombre || '');
    let distTexto = null;
    if (distKm != null) {
      const totalTramo = kmActual + distKm;
      distTexto = ` — ${distKm.toFixed(1)} km (${totalTramo.toFixed(1)} km)`;
      kmActual = totalTramo;
    }
    return { key: 'ap-' + nAux, tipo: 'aeropuerto', ap, prefijo, nombre, distTexto };
  };

  const filaPuerto = (p, prefijo, distKm) => {
    nAux += 1;
    const nombre = (prefijo ? prefijo + ': ' : '') + (p.nombre || '');
    let distTexto = null;
    if (distKm != null) {
      const totalTramo = kmActual + distKm;
      distTexto = ` — ${distKm.toFixed(1)} km (${totalTramo.toFixed(1)} km)`;
      kmActual = totalTramo;
    }
    return { key: 'puerto-' + nAux, tipo: 'puerto', p, prefijo, nombre, distTexto };
  };

  const filaItem = (item, etiqueta) => {
    const e = item.datos;
    let distTexto = '';
    if (e._distKm != null) {
      const segKm = segKmPorItem.get(e);
      const esPrimerItem = kmActual === 0;
      distTexto = segKm != null
        ? (esPrimerItem
            ? ` — ${segKm.toFixed(1)} km`
            : ` — ${segKm.toFixed(1)} km (${e._distKm.toFixed(1)} km)`)
        : ` — (${e._distKm.toFixed(1)} km)`;
      kmActual = Number(e._distKm);
    }
    const nombre = item.tipo === 'escala' ? formatMunicipio(e) : e.nombre;
    return { key: 'item-' + item.tipo + '-' + e.id, tipo: 'item', item, etiqueta, nombre, distTexto };
  };

  if (incluirExtremos || total > 0) asegurarDiaPara(0);
  if (incluirExtremos) {
    agregarItem({
      key: 'extremo-origen', tipo: 'extremo', letra: 'A', nombre: formatMunicipio(origen),
      subTipo: 'origen', origen, destino,
    });
  }

  // Ruta aérea: la lista sigue el orden físico de la ruta
  // (origen → salida → llegada → pueblo → salida → llegada → … → destino),
  // intercalando los aeropuertos de cada tramo con los puntos intermedios.
  const segsAereos = modoAereo && tramosAereo ? tramosAereo.apSegs : null;
  if (segsAereos && segsAereos.length) {
    const itemsRestantes = items.slice();
    let idxItem = 0;
    for (let i = 0; i < segsAereos.length; i++) {
      const seg = segsAereos[i];
      const dSalida = i === 0
        ? tramosAereo.distCarro1
        : (seg.vuelos && seg.vuelos[0] ? seg.vuelos[0].distanciaMetros : null);
      const dLlegada = i === segsAereos.length - 1
        ? tramosAereo.distCarro2
        : (seg.vuelos && seg.vuelos.length > 1 ? seg.vuelos[1].distanciaMetros
            : (seg.vuelos && seg.vuelos[0] ? seg.vuelos[0].distanciaMetros : null));
      if (seg.apOri) agregarItem(filaAeropuerto(seg.apOri, 'Salida', dSalida != null ? dSalida / 1000 : null));
      if (seg.apDes) agregarItem(filaAeropuerto(seg.apDes, 'Llegada', dLlegada != null ? dLlegada / 1000 : null));
      if (i < segsAereos.length - 1) {
        const pueblo = itemsRestantes.find((it) => it.tipo === 'escala');
        if (pueblo) {
          itemsRestantes.splice(itemsRestantes.indexOf(pueblo), 1);
          asegurarDiaPara(idxItem);
          const etq = etqDe(pueblo, idxItem);
          idxItem++;
          agregarItem(filaItem(pueblo, etq), { item: pueblo, etiqueta: etq });
        }
        while (itemsRestantes.length && itemsRestantes[0].tipo !== 'escala') {
          asegurarDiaPara(idxItem);
          const it = itemsRestantes.shift();
          const etq = etqDe(it, idxItem);
          idxItem++;
          agregarItem(filaItem(it, etq), { item: it, etiqueta: etq });
        }
      }
    }
    while (itemsRestantes.length) {
      asegurarDiaPara(idxItem);
      const it = itemsRestantes.shift();
      const etq = etqDe(it, idxItem);
      idxItem++;
      agregarItem(filaItem(it, etq), { item: it, etiqueta: etq });
    }
    // Ruta multimodal (avión + barco): tras el tramo aéreo se intercalan los
    // puertos fluviales (salida del barco, conexión y llegada).
    if (modoFluvial && tramosFluviales && tramosFluviales.po) {
      agregarItem(filaPuerto(tramosFluviales.po, 'Salida 🚢', tramosFluviales.distCarro1 != null ? tramosFluviales.distCarro1 / 1000 : null));
    }
    if (modoFluvial && tramosFluviales && tramosFluviales.hub && tramosFluviales.tramos && tramosFluviales.tramos[0]) {
      agregarItem(filaPuerto(tramosFluviales.hub, 'Conexión 🚢', tramosFluviales.tramos[0].distanciaMetros != null ? tramosFluviales.tramos[0].distanciaMetros / 1000 : null));
    }
    if (modoFluvial && tramosFluviales && tramosFluviales.pd) {
      agregarItem(filaPuerto(tramosFluviales.pd, 'Llegada 🚢', tramosFluviales.distCarro2 != null ? tramosFluviales.distCarro2 / 1000 : null));
    }
  } else {
    if (modoFluvial && tramosFluviales && tramosFluviales.po) {
      agregarItem(filaPuerto(tramosFluviales.po, 'Salida', tramosFluviales.distCarro1 != null ? tramosFluviales.distCarro1 / 1000 : null));
    }
    if (modoFluvial && tramosFluviales && tramosFluviales.hub && tramosFluviales.tramos && tramosFluviales.tramos[0]) {
      agregarItem(filaPuerto(tramosFluviales.hub, 'Conexión', tramosFluviales.tramos[0].distanciaMetros != null ? tramosFluviales.tramos[0].distanciaMetros / 1000 : null));
    }
    items.forEach((item, idx) => {
      asegurarDiaPara(idx);
      const etq = etqDe(item, idx);
      agregarItem(filaItem(item, etq), { item, etiqueta: etq });
    });
    if (modoFluvial && tramosFluviales && tramosFluviales.pd) {
      agregarItem(filaPuerto(tramosFluviales.pd, 'Llegada', tramosFluviales.distCarro2 != null ? tramosFluviales.distCarro2 / 1000 : null));
    }
  }

  asegurarDiaPara(total);
  if (incluirExtremos) {
    let distTexto = '';
    if (rutaActual && rutaActual.distanciaMetros) {
      const tKm = rutaActual.distanciaMetros / 1000;
      const prev = (ultimoRegular && ultimoRegular.item && ultimoRegular.item.datos && ultimoRegular.item.datos._distKm != null)
        ? Number(ultimoRegular.item.datos._distKm)
        : 0;
      const segKm = Math.max(0, tKm - prev);
      // Sin paradas intermedias solo se muestran Origen y Destino: la distancia
      // del tramo ES la total, no hace falta el paréntesis.
      distTexto = items.length === 0
        ? ` — ${tKm.toFixed(1)} km`
        : ` — ${segKm.toFixed(1)} km (${tKm.toFixed(1)} km)`;
    }
    agregarItem({
      key: 'extremo-destino', tipo: 'extremo', letra: 'Z', nombre: formatMunicipio(destino),
      distTexto, subTipo: 'destino', origen, destino,
    });
  }

  return { filas, dias, kmsDia, ciudadInicioDia };
}

// ---- Filas ------------------------------------------------------------------

function FilaDia({ d, etiqueta, desde, kms, esUltimo, cerrado, onToggle, onAgregar, onQuitar, onMenu }) {
  const liRef = usePulsacionLarga((evt) => onMenu(evt.clientX, evt.clientY));
  const texto = etiqueta + (desde ? ' - desde ' + desde : '');
  return (
    <li
      ref={liRef}
      className={'parada-item parada-item--dia' + (cerrado ? ' parada-item--dia-cerrado' : '')}
      data-tipo-parada="dia"
      role="button"
      tabIndex={0}
      aria-expanded={String(!cerrado)}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}
    >
      <span className="parada-item__dia-flecha">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </span>
      <span className="parada-item__dia-nombre" title={texto.length > 16 ? texto : undefined}>{texto}</span>
      <span className="parada-item__dia-km">{kms.toFixed(1)} km</span>
      <button
        type="button"
        className="parada-item__btn parada-item__dia-add"
        title={esUltimo ? 'Agregar un día más' : 'Quitar este día'}
        aria-label={esUltimo ? 'Agregar un día más' : 'Quitar este día'}
        onClick={(e) => { e.stopPropagation(); if (esUltimo) onAgregar(); else onQuitar(); }}
      >
        {esUltimo
          ? <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          : <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14" /></svg>}
      </button>
    </li>
  );
}

function FilaExtremo({ letra, nombre, distTexto, subTipo, origen, destino }) {
  const accion = () => {
    if (_consumirClic()) return;
    const extremo = subTipo === 'origen' ? origen : destino;
    if (extremo && extremo.lat != null) {
      if (typeof w.mostrarCuadroExtremo === 'function') w.mostrarCuadroExtremo(subTipo, extremo.nombre || '', (extremo.departamento || ''));
      // Tooltip sobre el pin A/Z en el mapa.
      if (w.MapModule && typeof w.MapModule.abrirTooltipExtremo === 'function') {
        w.MapModule.abrirTooltipExtremo(subTipo);
      }
    }
  };
  const opciones = () => {
    const ops = [];
    if (subTipo === 'origen') ops.push({ etiqueta: 'Cambiar lugar de origen', icono: '/rutas-simbiosis/icons/replay.svg', accion: () => w.irCambiarOrigen() });
    else {
      ops.push({ etiqueta: 'Cambiar lugar de destino', icono: '/rutas-simbiosis/icons/replay.svg', accion: () => w.irCambiarDestino() });
      ops.push({ etiqueta: 'Llegar en avión a este lugar', icono: '/rutas-simbiosis/icons/airplane.svg', accion: () => w.llegarEnAvionAlDestino() });
    }
    return ops;
  };
  const abrirMenuBtn = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    _abrirMenu(opciones(), rect.left, rect.bottom + 4);
  };
  const extremo = subTipo === 'origen' ? origen : destino;
  return (
    <li
      className="parada-item parada-item--endpoint"
      data-tipo-parada={subTipo}
      data-parada-id={extremo && extremo.id != null ? extremo.id : undefined}
      role="button"
      tabIndex={0}
      onClick={() => accion()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accion(); } }}
      onContextMenu={(e) => _abrirContexto(e, opciones)}
    >
      <button
        type="button"
        className="parada-item__hamburger"
        title="Opciones"
        aria-label={'Opciones de ' + nombre}
        onClick={abrirMenuBtn}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <span className="parada-item__num">{letra}</span>
      <span className="parada-item__nombre">{nombre}{distTexto ? <span className="parada-item__dist">{distTexto}</span> : null}</span>
    </li>
  );
}

function FilaAeropuerto({ ap, prefijo, nombre, distTexto }) {
  const accion = () => {
    if (_consumirClic()) return;
    if (typeof w.cerrarMenuFila === 'function') w.cerrarMenuFila();
    if (typeof w.mostrarCuadroAeropuerto === 'function') w.mostrarCuadroAeropuerto(ap, prefijo);
  };
  return (
    <li
      className="parada-item parada-item--endpoint"
      data-tipo-parada="aeropuerto"
      role="button"
      tabIndex={0}
      onClick={() => accion()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accion(); } }}
    >
      <span className="parada-item__num">✈</span>
      <span className="parada-item__nombre">
        <span className="parada-item__marquee">{nombre}{distTexto ? <span className="parada-item__dist">{distTexto}</span> : null}</span>
      </span>
    </li>
  );
}

function FilaPuerto({ p, prefijo, nombre, distTexto }) {
  const accion = () => {
    if (_consumirClic()) return;
    if (typeof w.cerrarMenuFila === 'function') w.cerrarMenuFila();
    if (typeof w.mostrarCuadroPuerto === 'function') w.mostrarCuadroPuerto(p, prefijo);
  };
  return (
    <li
      className="parada-item parada-item--endpoint"
      data-tipo-parada="puerto"
      role="button"
      tabIndex={0}
      onClick={() => accion()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accion(); } }}
    >
      <span className="parada-item__num parada-item__num--ico">
        <img src="/rutas-simbiosis/icons/boat.svg" alt="Puerto" style={{ width: 12, height: 12, filter: 'brightness(0) invert(1)' }} />
      </span>
      <span className="parada-item__nombre">
        <span className="parada-item__marquee">{nombre}{distTexto ? <span className="parada-item__dist">{distTexto}</span> : null}</span>
      </span>
    </li>
  );
}

function FilaItem({ item, etiqueta, nombre, distTexto }) {
  const e = item.datos;
  const accionPrincipal = () => {
    if (_consumirClic()) return;
    if (typeof w.cerrarMenuFila === 'function') w.cerrarMenuFila();
    if (item.tipo === 'parada') {
      if (typeof w.mostrarCuadroParada === 'function') w.mostrarCuadroParada(e);
      // Tooltip verde con el nombre sobre el pin del sitio en el mapa.
      if (w.MapModule && typeof w.MapModule.abrirTooltipParada === 'function') {
        w.MapModule.abrirTooltipParada(e.id, e.nombre);
      }
    } else if (item.tipo === 'escala') {
      if (typeof w.mostrarCuadroEscala === 'function') w.mostrarCuadroEscala(e);
      // Tooltip con el nombre sobre el pin del pueblo intermedio.
      if (w.MapModule && typeof w.MapModule.abrirTooltipEscala === 'function') {
        w.MapModule.abrirTooltipEscala(e.id, e.nombre);
      }
    }
  };
  const construirOpciones = () => {
    if (item.tipo === 'parada') {
      return [
        { etiqueta: 'Llegar en avión a este lugar', icono: '/rutas-simbiosis/icons/airplane.svg', accion: () => w.llegarEnAvionAParada(e, 'parada') },
        { etiqueta: 'Ubicar en el mapa', accion: () => w.mostrarCuadroParada(e) },
        { etiqueta: 'Eliminar de la ruta', accion: () => w.eliminarParada(e.id) },
      ];
    }
    return [
      { etiqueta: 'Llegar en avión a este lugar', icono: '/rutas-simbiosis/icons/airplane.svg', accion: () => w.llegarEnAvionAParada(e, 'escala') },
      { etiqueta: 'Cambiar pueblo intermedio', icono: '/rutas-simbiosis/icons/replay.svg', accion: () => w.cambiarPueblo(e) },
    ];
  };
  const abrirMenuBtn = (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    _abrirMenu(construirOpciones(), rect.left, rect.bottom + 4);
  };
  return (
    <li
      className="parada-item"
      data-parada-id={e.id}
      data-tipo-parada={item.tipo}
      role="button"
      tabIndex={0}
      onClick={() => accionPrincipal()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); accionPrincipal(); } }}
      onContextMenu={(e) => _abrirContexto(e, construirOpciones)}
    >
      <button
        type="button"
        className="parada-item__hamburger"
        title="Opciones"
        aria-label={'Opciones de ' + e.nombre}
        onClick={abrirMenuBtn}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      <span className="parada-item__num">{etiqueta}</span>
      <span className="parada-item__nombre">
        <span className="parada-item__marquee">{nombre}{distTexto ? <span className="parada-item__dist">{distTexto}</span> : null}</span>
      </span>
      <div className="parada-item__acciones">
        <button
          type="button"
          className="parada-item__btn"
          title="Quitar de la ruta"
          aria-label={'Quitar ' + e.nombre + ' de la ruta'}
          style={{ color: '#d62828' }}
          onClick={(evt) => {
            evt.stopPropagation();
            if (item.tipo === 'escala') w.eliminarEscala(e.id);
            else w.eliminarParada(e.id);
          }}
          onContextMenu={(evt) => evt.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </li>
  );
}

function Fila({ fila }) {
  if (fila.tipo === 'extremo') {
    return <FilaExtremo letra={fila.letra} nombre={fila.nombre} distTexto={fila.distTexto} subTipo={fila.subTipo} origen={fila.origen} destino={fila.destino} />;
  }
  if (fila.tipo === 'aeropuerto') {
    return <FilaAeropuerto ap={fila.ap} prefijo={fila.prefijo} nombre={fila.nombre} distTexto={fila.distTexto} />;
  }
  if (fila.tipo === 'puerto') {
    return <FilaPuerto p={fila.p} prefijo={fila.prefijo} nombre={fila.nombre} distTexto={fila.distTexto} />;
  }
  return <FilaItem item={fila.item} etiqueta={fila.etiqueta} nombre={fila.nombre} distTexto={fila.distTexto} />;
}

// ---- Lista completa (portal a #paradas-lista) -------------------------------

function ListaParadas({ contenedor }) {
  const listRef = useRef(null);
  const [cerrados, setCerrados] = useState(() => new Set());
  const u = _ui();
  const datos = u && typeof u.datosParadas === 'function' ? u.datosParadas() : null;

  // Tras cada montaje (remontada por key al cambiar la versión) se re-enganchan
  // los comportamientos vanilla sobre el DOM recién renderizado: marquee,
  // observador del panel, drag & drop (Sortable) y swipe para borrar.
  useLayoutEffect(() => {
    if (typeof w._marcarMarqueeParadas === 'function') w._marcarMarqueeParadas();
    if (typeof w._iniciarObservadorParadas === 'function') w._iniciarObservadorParadas();
    if (typeof w._initDragParadas === 'function') w._initDragParadas();
    if (typeof w._initSwipeBorrarParadas === 'function') w._initSwipeBorrarParadas();
    const raf = requestAnimationFrame(() => {
      if (typeof w._marcarMarqueeParadas === 'function') w._marcarMarqueeParadas();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!datos) return null;

  const { filas, dias, kmsDia, ciudadInicioDia } = construirFilas(datos);
  const filasPorDia = {};
  filas.forEach((f) => {
    if (!filasPorDia[f.day]) filasPorDia[f.day] = [];
    filasPorDia[f.day].push(f);
  });

  const alternarDia = (d) => {
    setCerrados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(d)) nuevo.delete(d);
      else nuevo.add(d);
      return nuevo;
    });
  };

  return createPortal(
    <ul ref={listRef} className="paradas-lista">
      {Array.from({ length: dias }, (_, i) => i + 1).map((d) => (
        <Fragment key={'dia-' + d}>
          <FilaDia
            d={d}
            etiqueta={etiquetaDia(d)}
            desde={ciudadInicioDia(d)}
            kms={kmsDia[d - 1]}
            esUltimo={d >= dias}
            cerrado={cerrados.has(d)}
            onToggle={() => alternarDia(d)}
            onAgregar={() => { if (typeof w.agregarDia === 'function') w.agregarDia(); }}
            onQuitar={() => { if (typeof w.quitarDia === 'function') w.quitarDia(d); }}
            onMenu={(x, y) => _abrirMenu(opcionesDia(d), x, y)}
          />
          <div className="parada-dia__grupo" style={cerrados.has(d) ? { display: 'none' } : undefined}>
            {(filasPorDia[d] || []).map((fila) => <Fila key={fila.key} fila={fila} />)}
          </div>
        </Fragment>
      ))}
    </ul>,
    contenedor
  );
}

// ---- Conector: solo monta cuando la lista de paradas es la dueña del contenedor

export default function ParadasLista() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  const contenedor = document.getElementById('paradas-lista');
  if (!contenedor) return null;
  const u = _ui();
  if (!u || typeof u.modoListaRuta !== 'function' || u.modoListaRuta() !== 'paradas') return null;
  // La key = versión fuerza un remontaje completo en cada renderizarParadas:
  // el <ul> interno se reemplaza entero (equivalente al innerHTML='' vanilla) y
  // se evita el conflicto de reconciliación con los nodos movidos por Sortable.
  return <ListaParadas key={VERSION.n} contenedor={contenedor} />;
}
