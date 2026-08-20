/**
 * vite.config.js
 * ---------------------------------------------------------------------------
 * Configuración de Vite para la migración incremental de Simbiosis Colombia.
 *
 * - publicDir: la carpeta public/ se sirve/copia tal cual (estándar de Vite);
 *   ahí viven los SVGs, iconos, favicon y data/ (los JSON se leen con fetch).
 * - js/ NO entra en publicDir (Vite transformaría sus .js y rompería el ámbito
 *   global de los scripts clásicos). Un plugin propio lo sirve en bruto en
 *   desarrollo y lo copia a dist/ en el build.
 * - Plugin simbiosis-api-local: sustituye a server.js. En desarrollo expone la
 *   API de guardado (POST /api/catalogo) que escribe directamente en
 *   public/data/<archivo>.json, de modo que editar puertos/aeropuertos/
 *   municipios/sitios… actualiza el archivo real del proyecto. También vigila
 *   js/ y recarga el navegador (HMR full-reload) al cambiar scripts clásicos.
 * - Plugin simbiosis-legacy-estaticos: tras el build copia js/ y manifest.json
 *   a dist/. Ya no se genera sw.js (se eliminó el service worker).
 * ---------------------------------------------------------------------------
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/** Sirve en bruto /js (y manifest.json) en desarrollo, sin transformarlos, y
 *  copia js/ y manifest.json a dist/ en el build. Los scripts clásicos deben
 *  conservar su ámbito global; los .json de data/ y los SVG ya los gestiona
 *  publicDir. */
function pluginLegacyEstaticos() {
  return {
    name: 'simbiosis-legacy-estaticos',
    configureServer(server) {
      // Antes de los middlewares internos de Vite: responde sin transformar
      // (los scripts clásicos deben conservar su ámbito global).
      server.middlewares.use((req, res, next) => {
        let nombre;
        try {
          const p = new URL(req.url, 'http://localhost').pathname;
          if (p === '/manifest.json') nombre = 'manifest.json';
          else {
            const m = p.match(/^\/js\/(.+)$/);
            if (m) nombre = m[1];
          }
        } catch (e) {
          return next();
        }
        if (!nombre) return next();
        const archivo = path.normalize(path.join(process.cwd(), nombre));
        if (!archivo.startsWith(process.cwd())) {
          res.statusCode = 403;
          return res.end('Forbidden');
        }
        let stat;
        try {
          stat = fs.statSync(archivo);
        } catch (e) {
          return next();
        }
        if (!stat.isFile()) return next();
        res.setHeader('Content-Type', MIME[path.extname(archivo).toLowerCase()] || 'application/octet-stream');
        fs.createReadStream(archivo).pipe(res);
      });
    },
    closeBundle() {
      const dist = path.resolve('dist');
      if (!fs.existsSync(dist)) return;
      // Copia los scripts clásicos (js/) que la app carga con <script src>.
      for (const carpeta of ['js']) {
        const origen = path.resolve(carpeta);
        if (fs.existsSync(origen)) {
          fs.cpSync(origen, path.join(dist, carpeta), { recursive: true });
        }
      }
      // manifest.json (PWA): se conserva aunque ya no haya service worker.
      try {
        fs.copyFileSync(path.resolve('manifest.json'), path.join(dist, 'manifest.json'));
      } catch (err) {
        console.warn('[vite] No se pudo copiar manifest.json:', err.message);
      }
    },
  };
}

/** API de guardado local (sustituye a server.js, que se eliminó). En
 *  desarrollo, POST /api/catalogo escribe directamente en
 *  public/data/<archivo>.json para que editar puertos/aeropuertos/municipios/
 *  departamentos/sitios/frontera actualice el archivo real del proyecto.
 *  Además vigila js/ y, al cambiar scripts clásicos, pide al navegador una
 *  recarga completa por el canal de HMR de Vite (los módulos ES ya recargan
 *  solos; los clásicos no). */
function pluginApiLocal() {
  const ARCHIVOS = new Map([
    ['puertos', 'puertos_colombia.json'],
    ['aeropuertos', 'aeropuertos_colombia.json'],
    ['municipios', 'municipios.json'],
    ['departamentos', 'departamentos.json'],
    ['sitios', 'sitios_turisticos.json'],
    ['frontera', 'sitios_turisticos_frontera.json'],
  ]);

  function leerCuerpo(req) {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 50 * 1024 * 1024) req.destroy();
      });
      req.on('end', () => resolve(body));
    });
  }

  function responder(res, estado, datos) {
    res.statusCode = estado;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(datos));
  }

  return {
    name: 'simbiosis-api-local',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        let url;
        try {
          url = new URL(req.url, 'http://localhost');
        } catch (e) {
          return next();
        }
        // Guardado de puertos: API previa de server.js, mantenida por
        // compatibilidad (persistenciaJson.js usa el genérico /api/catalogo).
        if (url.pathname === '/api/puertos' && req.method === 'POST') {
          try {
            const datos = JSON.parse(await leerCuerpo(req));
            const ruta = path.join(process.cwd(), 'public', 'data', 'puertos_colombia.json');
            await fs.promises.writeFile(ruta, JSON.stringify(datos, null, 2), 'utf8');
            responder(res, 200, { ok: true });
          } catch (e) {
            responder(res, 400, { ok: false });
          }
          return;
        }
        // Guardado genérico de un catálogo (A/M/D/C/frontera/puertos): escribe
        // en public/data/<archivo>. La clave se valida contra una lista blanca.
        if (url.pathname === '/api/catalogo' && req.method === 'POST') {
          try {
            const body = JSON.parse(await leerCuerpo(req));
            const archivo = ARCHIVOS.get(String(body.clave || ''));
            if (!archivo) return responder(res, 400, { ok: false });
            const ruta = path.join(process.cwd(), 'public', 'data', archivo);
            await fs.promises.writeFile(ruta, JSON.stringify(body.datos, null, 2), 'utf8');
            responder(res, 200, { ok: true });
          } catch (e) {
            responder(res, 400, { ok: false });
          }
          return;
        }
        next();
      });

      // Recarga completa del navegador al cambiar scripts clásicos de /js.
      try {
        const dirJs = path.join(process.cwd(), 'js');
        fs.watch(dirJs, { recursive: true }, (evt, filename) => {
          if (filename && path.extname(filename).toLowerCase() === '.js') {
            server.ws.send({ type: 'full-reload', path: '/' });
          }
        });
        console.log('[vite:api] Vigilando js/ para recargar los scripts clásicos');
      } catch (e) {
        console.warn('[vite:api] No se pudo vigilar js/:', e.message);
      }
    },
  };
}

export default defineConfig({
  base: '/rutas-simbiosis/',
  plugins: [
    react(),
    pluginLegacyEstaticos(),
    pluginApiLocal(),
  ],
  build: {
    target: 'es2018',
  },
});