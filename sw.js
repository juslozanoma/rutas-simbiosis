/**
 * sw.js
 * ---------------------------------------------------------------------------
 * Service Worker de Simbiosis Colombia (PWA instalable).
 *
 * Estrategia:
 *  - Precachemos la "cáscara" de la app (HTML, CSS, JS, íconos) en `install`.
 *  - Navegación: network-first con respaldo en la caché (para que recargas
 *    siempre traigan la versión fresca del HTML).
 *  - Mismo origen (CSS/JS/imágenes/JSON): stale-while-revalidate; se sirve la
 *    caché al instante y se actualiza en segundo plano.
 *  - Origen cruzado (Leaflet, Turf, OSM tiles, OSRM, fuentes): cache-first con
 *    actualización en segundo plano, para que la app funcione sin red.
 *  - Se ignoran las peticiones no GET y las rutas de servidor (SSE, API).
 * ---------------------------------------------------------------------------
 */

const VERSION = 'simbiosis-v100';
const CACHE_PRIMARIO = VERSION;
const CACHE_OPACO = 'simbiosis-cdn-v2';

// En desarrollo este listado sirve si alguien sirve la raíz directamente. En
// el build, el plugin de Vite (vite.config.js) reemplaza este array con la
// lista real de archivos de dist/ (nombres con hash incluidos).
const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './style.css',
  './js/altimetria.js',
  './js/altimetriaApp.js',
  './js/app.js',
  './js/buscarLugar.js',
  './js/combosApp.js',
  './js/core.js',
  './js/descubre.js',
  './js/escalas.js',
  './js/filters.js',
  './js/fluvial.js',
  './js/fluvialWorker.js',
  './js/map.js',
  './js/municipioCombo.js',
  './js/panel.js',
  './js/paradas.js',
  './js/persistenciaJson.js',
  './js/routeWarnings.js',
  './js/routing.js',
  './js/rutaArchivo.js',
  './js/rutas.js',
  './js/teclado.js',
  './js/tour.js',
  './js/tourism.js',
  './js/transport.js',
  './js/utilApp.js',
  './js/utils.js',
  './favicon.ico',
  './simbiosis.png',
  './save.svg',
  './scope.svg',
  './bike.svg',
  './gps.svg',
  './satellite.svg',
  './sign-post.svg',
  './colombia.svg',
  './hiking.svg',
  './tour.svg',
  './car.svg',
  './car2.svg',
  './car3.svg',
  './car4.svg',
  './suv.svg',
  './pickup.svg',
  './boat.svg',
  './airplane.svg',
  './warning.svg',
  './direction.svg',
  './helicopter.svg',
  './motorcycle.svg',
  './motorcycle2.svg',
  './motorcycle3.svg',
  './scooter.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Rutas del servidor que nunca deben caer en la caché.
function esNoCacheable(url) {
  const p = url.pathname;
  return p === '/events' || p.startsWith('/__server_info__') || p.startsWith('/api/');
}

self.addEventListener('install', (ev) => {
  ev.waitUntil(
    caches.open(CACHE_PRIMARIO)
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u).catch((e) => console.warn('SW precache', u, e)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_PRIMARIO && k !== CACHE_OPACO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (esNoCacheable(url)) return;

  // Navegación: red primero, caché como respaldo.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches.open(CACHE_PRIMARIO).then((c) => c.put('./index.html', copia));
          return res;
        })
        .catch(() => caches.match('./index.html').then((c) => c || caches.match('./')))
    );
    return;
  }

  const mismoOrigen = url.origin === self.location.origin;

  if (mismoOrigen) {
    // Stale-while-revalidate para recursos locales.
    ev.respondWith(
      caches.match(req).then((enCache) => {
        const refresco = fetch(req)
          .then((res) => {
            // No cachear respuestas enormes (p. ej. la red fluvial de ~37 MB).
            if (res && res.ok && Number(res.headers.get('content-length') || 0) < 10 * 1024 * 1024) {
              const copia = res.clone();
              caches.open(CACHE_PRIMARIO).then((c) => c.put(req, copia)).catch(() => {});
            }
            return res;
          })
          .catch(() => enCache || caches.match('./index.html'));
        return enCache || refresco;
      })
    );
    return;
  }

  // Origen cruzado (CDNs, tiles, OSRM, fuentes): caché primero con refresco.
  // Una respuesta "opaque" (p. ej. la de un <link> sin crossorigin) SOLO puede
  // servirse a peticiones no-CORS. Si se entrega a una petición CORS el
  // navegador la descarta con "an opaque response was used for a request whose
  // type is not no-cors". Por eso se valida la compatibilidad antes de servir
  // desde la caché y en la caída de red.
  ev.respondWith(
    caches.open(CACHE_OPACO).then(async (cache) => {
      const enCache = await cache.match(req);
      const cacheUsable = enCache && !(enCache.type === 'opaque' && req.mode !== 'no-cors');
      const refresco = fetch(req)
        .then((res) => {
          if (res && (res.type === 'opaque' || res.ok) && Number(res.headers.get('content-length') || 0) < 10 * 1024 * 1024) {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => (cacheUsable ? enCache : new Response('', { status: 504 })));
      return (cacheUsable ? enCache : null) || refresco;
    })
  );
});