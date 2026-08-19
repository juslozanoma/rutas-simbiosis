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
 * - proxy: en desarrollo el servidor de API (server.js, puerto 5500) se
 *   conserva; Vite reenvía /__server_info__, /api y /events.
 * - Plugin simbiosis-sw: tras el build copia manifest.json y sw.js a dist/ y
 *   rellena el PRECACHE del service worker con la lista real de dist/ (los
 *   assets de Vite tienen nombres con hash).
 * ---------------------------------------------------------------------------
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const API_DEV = 'http://127.0.0.1:5500'; // server.js

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
 *  copia js/ a dist/ en el build. Los scripts clásicos deben conservar su
 *  ámbito global; los .json de data/ y los SVG ya los gestiona publicDir. */
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
    },
  };
}

/** Tras el build: copia manifest.json, genera dist/sw.js con el PRECACHE
 *  real (archivos de dist/, excluyendo data/ que es demasiado grande). */
function pluginSimSimbiosisSW() {
  return {
    name: 'simbiosis-sw',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve('dist');
      if (!fs.existsSync(dist)) return;

      function listar(dir, base) {
        const salida = [];
        for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
          const ruta = path.join(dir, entrada.name);
          const rel = base ? base + '/' + entrada.name : entrada.name;
          if (entrada.isDirectory()) {
            if (rel === 'data') continue;
            salida.push(...listar(ruta, rel));
          } else {
            if (entrada.name === 'sw.js' || entrada.name.endsWith('.map')) continue;
            salida.push('./' + rel);
          }
        }
        return salida;
      }
      const precache = ['./', ...listar(dist, '')].sort((a, b) => a.localeCompare(b, 'es'));

      try {
        fs.copyFileSync(path.resolve('manifest.json'), path.join(dist, 'manifest.json'));
      } catch (err) {
        console.warn('[vite:sw] No se pudo copiar manifest.json:', err.message);
      }
      const swFuente = fs.readFileSync(path.resolve('sw.js'), 'utf8');
      const swBuild = swFuente.replace(/const PRECACHE = \[[\s\S]*?\n\];/, 'const PRECACHE = ' + JSON.stringify(precache, null, 2) + ';');
      fs.writeFileSync(path.join(dist, 'sw.js'), swBuild, 'utf8');
      console.log('[vite:sw] sw.js generado con ' + precache.length + ' archivos en el precache');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    pluginLegacyEstaticos(),
    {
      // En desarrollo la página se marca como servida por server.js para que
      // la app habilite guardado (POST /api/...) y recarga por SSE.
      name: 'simbiosis-dev-header',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/' || req.url.startsWith('/index.html')) {
            res.setHeader('X-Simbiosis-Server', '1');
          }
          next();
        });
      },
    },
    pluginSimSimbiosisSW(),
  ],
  server: {
    proxy: {
      '/__server_info__': { target: API_DEV, changeOrigin: true },
      '/api': { target: API_DEV, changeOrigin: true },
      '/events': { target: API_DEV, changeOrigin: true },
    },
  },
  build: {
    target: 'es2018',
  },
});
