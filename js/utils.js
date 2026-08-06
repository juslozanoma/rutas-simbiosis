/**
 * utils.js
 * ---------------------------------------------------------------------------
 * Funciones utilitarias genéricas, sin dependencias del DOM de la app.
 * Se agrupan bajo el espacio de nombres `Utils` para no contaminar el
 * ámbito global y para facilitar pruebas unitarias futuras.
 * ---------------------------------------------------------------------------
 */
const Utils = (() => {

  /**
   * Retrasa la ejecución de una función hasta que pase `wait` ms sin
   * que se vuelva a invocar. Útil para inputs de búsqueda y sliders.
   */
  function debounce(fn, wait = 150) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  /** Normaliza texto para búsquedas: minúsculas y sin tildes. */
  function normalizar(texto) {
    return (texto || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /** Formatea distancia en metros a un texto legible (km con 1 decimal). */
  function formatearDistancia(metros) {
    if (metros == null || isNaN(metros)) return '—';
    const km = metros / 1000;
    return `${km.toFixed(km < 10 ? 2 : 1)} km`;
  }

  /** Formatea duración en segundos a "Xh Ym" o "Y min". */
  function formatearDuracion(segundos) {
    if (segundos == null || isNaN(segundos)) return '—';
    const totalMin = Math.round(segundos / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  /** Formatea un número con separador de miles estilo es-CO. */
  function formatearNumero(n) {
    if (n == null || isNaN(n)) return '—';
    return new Intl.NumberFormat('es-CO').format(n);
  }

  /** Calcula una escala cartográfica aproximada 1:N a partir del zoom de Leaflet. */
  function escalaDesdeZoom(zoom, lat) {
    // Resolución (m/px) a nivel de zoom z, ajustada por latitud (proyección Web Mercator)
    const metrosPorPixelEcuador = 156543.03392;
    const resolucion = (metrosPorPixelEcuador * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
    // 1 px ≈ 0.00028 m en pantalla (96 dpi) según especificación OGC
    const escala = resolucion / 0.00028;
    return Math.round(escala);
  }

  /** Genera un color hexadecimal determinístico a partir de un texto (para departamentos, etc). */
  function colorDesdeTexto(texto) {
    let hash = 0;
    for (let i = 0; i < texto.length; i++) {
      hash = texto.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, 45%, 42%)`;
  }

  /** Dispara un archivo de descarga en el navegador a partir de un objeto/string. */
  function descargarArchivo(contenido, nombreArchivo, tipoMime = 'application/json') {
    const texto = typeof contenido === 'string' ? contenido : JSON.stringify(contenido, null, 2);
    const blob = new Blob([texto], { type: tipoMime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Crea un elemento DOM a partir de una cadena HTML simple (un solo nodo raíz). */
  function crearElemento(html) {
    const div = document.createElement('div');
    div.innerHTML = html.trim();
    return div.firstElementChild;
  }

  // -------------------------------------------------------------------
  // Elevación desde API externa (Open-Meteo / SRTM)
  // -------------------------------------------------------------------
  const _cacheElevacion = new Map();

  /**
   * Obtiene la elevación (msnm) para una coordenada dada.
   * Usa la API gratuita de Open-Meteo (sin key, basada en SRTM/ASTER).
   * @param {number} lat
   * @param {number} lon
   * @returns {Promise<number|null>} elevación en metros o null si falla
   */
  async function obtenerElevacion(lat, lon) {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (_cacheElevacion.has(key)) return _cacheElevacion.get(key);
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const alt = data?.elevation?.[0];
      if (alt != null) {
        _cacheElevacion.set(key, alt);
        return alt;
      }
      return null;
    } catch (err) {
      console.warn('[ELEV] Error al obtener elevación:', err.message);
      return null;
    }
  }

  /**
   * Obtiene elevación por lote usando la API de Open-Meteo (gratis, sin key,
   * SRTM/ASTER, permite CORS). Agrupa hasta 100 coordenadas por request.
   * @param {Array<[number,number]>} coords - [[lat, lon], ...]
   * @returns {Promise<Array<number|null>>} elevaciones en mismo orden
   */
  async function obtenerElevacionBatch(coords) {
    if (!coords || coords.length === 0) return [];

    const resultados = new Array(coords.length).fill(null);
    const pendientes = [];

    coords.forEach((c, i) => {
      const key = `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
      if (_cacheElevacion.has(key)) {
        resultados[i] = _cacheElevacion.get(key);
      } else {
        pendientes.push({ idx: i, lat: c[0], lon: c[1] });
      }
    });

    if (pendientes.length === 0) return resultados;

    const MAX_POR_REQUEST = 100;
    for (let i = 0; i < pendientes.length; i += MAX_POR_REQUEST) {
      const chunk = pendientes.slice(i, i + MAX_POR_REQUEST);
      try {
        const lats = chunk.map((p) => p.lat).join(',');
        const lons = chunk.map((p) => p.lon).join(',');
        const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const elevs = Array.isArray(data?.elevation) ? data.elevation : [];
        chunk.forEach((p, j) => {
          const alt = elevs[j];
          if (alt != null) {
            const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
            _cacheElevacion.set(key, alt);
            resultados[p.idx] = alt;
          }
        });
      } catch (err) {
        console.warn('[ELEV] Error en lote:', err.message);
      }
    }

    return resultados;
  }

  return {
    debounce,
    normalizar,
    formatearDistancia,
    formatearDuracion,
    formatearNumero,
    escalaDesdeZoom,
    colorDesdeTexto,
    descargarArchivo,
    crearElemento,
    obtenerElevacion,
    obtenerElevacionBatch,
  };
})();
