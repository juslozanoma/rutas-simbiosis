/**
 * src/components/SitiosLista.jsx
 * ---------------------------------------------------------------------------
 * Lista de sitios turísticos de la pestaña Descubre Colombia en React
 * (migración por comportamiento de js/descubre.js:crearTarjetaSitio).
 *
 * A diferencia de #paradas-lista, el <ul id="sitios-lista"> NO tiene dueños
 * vanilla alternativos: lo único que lo rellena es renderizarSitios
 * (js/descubre.js). React monta las tarjetas por portal directamente como
 * hijos del ul (la cáscara ya trae el <ul class="sitios-lista" id="sitios-lista">)
 * y se re-monta entero en cada notificación vanilla (key = versión del store),
 * igual que el innerHTML='' que hacía renderizarSitios.
 *
 * Todo el resto sigue siendo vanilla: contadores, botón flotante, empty state
 * (#sitios-vacio), caja de búsqueda (_aplicarBusquedaSitios), marcadores del
 * mapa, el preview de ruta (previsualizarRutaHaciaSitio) y el menú de
 * categorías. Las tarjetas solo exponen dos acciones: el botón agregar/quitar
 * de la ruta y el clic de previsualización, que llaman a las funciones
 * globales clásicas (accedidas por window).
 * ---------------------------------------------------------------------------
 */
import { Fragment, useRef, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import bridge from '../bridge';

// Funciones y estado de los scripts clásicos (js/*.js): se acceden por window
// porque los clásicos comparten el ámbito global léxico (no son módulos ES).
const w = window;

// ---- Store del puente: la app vanilla notifica para re-renderizar -----------

const VERSION = { n: 0 };
let suscriptor = null;

function notificarListaSitios() {
  flushSync(() => {
    VERSION.n += 1;
    if (suscriptor) suscriptor();
  });
}

function subscribirse(cb) {
  suscriptor = cb;
  return () => { suscriptor = null; };
}

bridge.notificarListaSitios = notificarListaSitios;

function _ui() {
  return w.SimbiosisUI || null;
}

function _datos() {
  const u = _ui();
  return u && typeof u.datosSitios === 'function' ? u.datosSitios() : null;
}

/** Texto de distancias de la tarjeta: distancia sobre la ruta desde el extremo
 *  y, después, los datos del desvío (km y min). Misma salida que la función
 *  anidada _textoDistanciaTarjeta de js/descubre.js. */
function TextoDistancia({ sitio }) {
  const partes = [];
  if (sitio.distanciaOrigenDesvioKm != null) {
    partes.push(
      <Fragment key="d">
        {sitio.distanciaOrigenDesvioKm.toFixed(1)} km <span className="sitio-card__dist-note" />
      </Fragment>
    );
  }
  if (sitio.distanciaRutaKm != null) {
    partes.push(
      <Fragment key="r">
        desvío: {sitio.distanciaRutaKm.toFixed(1)} km · {Math.round(sitio.tiempoDesvioMin)} min
      </Fragment>
    );
  }
  if (!partes.length) return null;
  return (
    <span>
      {partes.map((p, i) => (
        <Fragment key={i}>{i > 0 ? ' · ' : null}{p}</Fragment>
      ))}
    </span>
  );
}

/** Tarjeta de un sitio en el listado de Descubre (mismo DOM que
 *  js/descubre.js:crearTarjetaSitio). El clic en la fila previsualiza la ruta
 *  hacia el sitio; el botón agrega/quita el sitio de la ruta; el botón del
 *  vehículo calcula y dibuja un recorrido independiente desde el origen. */
function SitioCard({ sitio, numero, esParada }) {
  const liRef = useRef(null);
  const btnRef = useRef(null);
  const recorridoRef = useRef(null);

  // Ícono del vehículo elegido por el usuario (car.svg por defecto).
  const tVehiculo = w.TransportConfigModule;
  const iconoVehiculo = (tVehiculo && typeof tVehiculo.iconoPath === 'function')
    ? tVehiculo.iconoPath()
    : '/rutas-simbiosis/icons/car.svg';

  const accionBoton = (e) => {
    e.stopPropagation();
    if (esParada) {
      if (typeof w.quitarSitioDeLaRuta === 'function') {
        w.quitarSitioDeLaRuta(sitio, liRef.current, btnRef.current);
      }
    } else if (typeof w.agregarParada === 'function') {
      w.agregarParada(sitio, btnRef.current);
    }
  };

  const accionRecorrido = (e) => {
    e.stopPropagation();
    if (typeof w.mostrarRecorridoASitio === 'function') {
      w.mostrarRecorridoASitio(sitio, recorridoRef.current);
    }
  };

  const clicTarjeta = () => {
    if (typeof w.previsualizarRutaHaciaSitio === 'function') {
      w.previsualizarRutaHaciaSitio(sitio, liRef.current);
    }
  };

  return (
    <li
      ref={liRef}
      className={'sitio-card' + (esParada ? ' sitio-card--active' : '')}
      data-sitio-id={String(sitio.id)}
      onClick={clicTarjeta}
    >
      <div className="sitio-card__top">
        <span className="sitio-card__nombre">
          <span className="sitio-card__num">{numero}.</span>&nbsp;{sitio.nombre}
        </span>
        <div className="sitio-card__top-right">
          <button
            ref={recorridoRef}
            type="button"
            className="sitio-card__recorrido"
            title="Mostrar recorrido hasta aquí"
            aria-label={'Mostrar recorrido hasta ' + sitio.nombre}
            onClick={accionRecorrido}
          >
            <span
              className="icon-btn__icon sitio-card__recorrido-ico"
              style={{
                WebkitMaskImage: "url('" + iconoVehiculo + "')",
                maskImage: "url('" + iconoVehiculo + "')",
                WebkitMaskRepeat: 'no-repeat',
                maskRepeat: 'no-repeat',
                WebkitMaskPosition: 'center',
                maskPosition: 'center',
                WebkitMaskSize: 'contain',
                maskSize: 'contain',
              }}
            />
            <span className="icon-btn__spinner" aria-hidden="true"></span>
          </button>
          <button
            ref={btnRef}
            type="button"
            className={'icon-btn sitio-card__add' + (esParada ? ' sitio-card__add--quitar' : '')}
            title={esParada ? 'Quitar de la ruta' : 'Agregar a la ruta'}
            aria-label={esParada ? 'Quitar ' + sitio.nombre + ' de la ruta' : 'Agregar ' + sitio.nombre + ' a la ruta'}
            onClick={accionBoton}
          >
            <svg className="icon-btn__icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              {esParada ? <path d="M6 12h12" /> : <path d="M12 5v14M5 12h14" />}
            </svg>
            <span className="icon-btn__spinner" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div className="sitio-card__meta">
        <span>{sitio.municipio}, {sitio.departamento}</span>
        <TextoDistancia sitio={sitio} />
      </div>
      <p className="sitio-card__preview" hidden></p>
    </li>
  );
}

/** Portal de las tarjetas al <ul id="sitios-lista"> de la cáscara. */
function ListaSitios({ contenedor }) {
  const datos = _datos();
  if (!datos) return null;
  const sitios = datos.sitios || [];
  const paradas = datos.paradas || [];
  const paradaIds = new Set(paradas.map((p) => String(p.id)));

  return createPortal(
    <Fragment>
      {sitios.map((sitio, i) => {
        // Mismas reglas que js/descubre.js:renderizarSitios: sin coordenadas
        // válidas el sitio no genera tarjeta (ni marcador en el mapa), y la
        // numeración conserva el índice real (puede haber saltos).
        if (sitio.lat == null || sitio.lon == null || isNaN(Number(sitio.lat)) || isNaN(Number(sitio.lon))) return null;
        return (
          <SitioCard
            key={sitio.id != null ? String(sitio.id) : 'sitio-' + i}
            sitio={sitio}
            numero={i + 1}
            esParada={paradaIds.has(String(sitio.id))}
          />
        );
      })}
    </Fragment>,
    contenedor
  );
}

/** Conector: monta las tarjetas dentro de #sitios-lista cuando la app vanilla
 *  ya expuso sus getters. La key = versión fuerza un remontaje completo en cada
 *  renderizarSitios (equivalente al innerHTML='' vanilla). */
export default function SitiosLista() {
  useSyncExternalStore(subscribirse, () => VERSION.n);
  const contenedor = document.getElementById('sitios-lista');
  if (!contenedor) return null;
  const u = _ui();
  if (!u || typeof u.datosSitios !== 'function') return null;
  return <ListaSitios key={VERSION.n} contenedor={contenedor} />;
}