/**
 * server.js
 * ---------------------------------------------------------------------------
 * Servidor local mínimo para la app (Node, sin dependencias).
 *  - Sirve los archivos estáticos del proyecto.
 *  - Expone POST /api/puertos para escribir SIEMPRE en
 *    data/puertos_colombia.json (el archivo real), sin ventanas ni descargas.
 *
 * Uso:  node server.js          (por defecto en http://127.0.0.1:5500)
 *       PORT=3000 node server.js
 * ---------------------------------------------------------------------------
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5500;
const ARCHIVO_PUERTOS = path.join(ROOT, 'data', 'puertos_colombia.json');

// Claves de catálogo → archivo real en data/. Solo estas se pueden escribir.
const ARCHIVOS_PERMITIDOS = new Map([
  ['puertos', 'puertos_colombia.json'],
  ['aeropuertos', 'aeropuertos_colombia.json'],
  ['municipios', 'municipios.json'],
  ['departamentos', 'departamentos.json'],
  ['sitios', 'sitios_turisticos.json'],
  ['frontera', 'sitios_turisticos_frontera.json'],
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  // Marca propia para que el cliente sepa que lo sirve server.js (y no, p. ej.,
  // el Live Server de VSCode) y solo entonces consulte /__server_info__.
  res.setHeader('X-Simbiosis-Server', '1');
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (err) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  // Información del servidor: el cliente lo consulta para saber si hay
  // guardado (POST /api/puertos) y eventos de recarga (SSE /events).
  if (url.pathname === '/__server_info__' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ savable: true, events: true }));
    return;
  }

  // Eventos de recarga (SSE): avisa a los navegadores conectados cuando
  // cambian SOLO archivos .html o .js (nunca por JSON/CSS/SVG).
  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': conectado\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Guardado de puertos: escribe directamente en data/puertos_colombia.json
  if (url.pathname === '/api/puertos' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const datos = JSON.parse(body);
        fs.writeFile(ARCHIVO_PUERTOS, JSON.stringify(datos, null, 2), 'utf8', (err) => {
          if (err) {
            console.error('[server] No se pudo escribir el JSON:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  // Guardado genérico de un catálogo (A/M/D/C/frontera/puertos): escribe en
  // data/<archivo>. La clave se valida contra una lista blanca.
  if (url.pathname === '/api/catalogo' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 50 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const datos = JSON.parse(body);
        const archivo = ARCHIVOS_PERMITIDOS.get(String(datos.clave || ''));
        if (!archivo) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
          return;
        }
        const ruta = path.join(ROOT, 'data', archivo);
        fs.writeFile(ruta, JSON.stringify(datos.datos, null, 2), 'utf8', (err) => {
          if (err) {
            console.error('[server] No se pudo escribir el JSON:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log('Rutas Simbiosis en http://127.0.0.1:' + PORT);
});

// Clientes conectados al SSE de recarga y vigilancia de archivos.
const sseClients = new Set();

function broadcastRecarga() {
  const payload = 'data: reload\n\n';
  sseClients.forEach((res) => {
    try { res.write(payload); } catch (err) { sseClients.delete(res); }
  });
}

// Vigila solo .js y .html: al cambiar se avisa a los navegadores para que
// recarguen. JSON, CSS y SVG NO disparan recarga.
try {
  const dirJs = path.join(ROOT, 'js');
  fs.watch(dirJs, { recursive: true }, (evt, filename) => {
    if (filename && path.extname(filename).toLowerCase() === '.js') broadcastRecarga();
  });
} catch (err) {
  console.warn('[server] No se pudo vigilar js/', err.message);
}
try {
  fs.watch(path.join(ROOT, 'index.html'), () => broadcastRecarga());
} catch (err) {
  console.warn('[server] No se pudo vigilar index.html', err.message);
}
