"""
server.py
---------------------------------------------------------------------------
Servidor HTTP local para Rutas & Destinos. Sirve archivos estáticos y
expone un endpoint POST para guardar cambios en data/rutas_riesgosas.json.

Uso:
    python server.py

Luego abre http://localhost:8000 en el navegador.
---------------------------------------------------------------------------
"""
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import os

DATA_FILE = os.path.join(os.path.dirname(__file__), 'data', 'rutas_riesgosas.json')


class Handler(SimpleHTTPRequestHandler):

    def do_GET(self):
        # Redirigir la raíz a index.html
        if self.path in ('/', ''):
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self):
        if self.path == '/guardar-rutas':
            length = int(self.headers.get('Content-Length', 0))
            if length == 0:
                self._json_response(400, {'error': 'Body vacío'})
                return
            try:
                body = self.rfile.read(length)
                data = json.loads(body)
                if not isinstance(data, list):
                    self._json_response(400, {'error': 'Se esperaba un array'})
                    return
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                self._json_response(200, {'ok': True})
            except json.JSONDecodeError:
                self._json_response(400, {'error': 'JSON inválido'})
            except OSError as e:
                self._json_response(500, {'error': str(e)})
        else:
            self._json_response(404, {'error': 'Ruta no encontrada'})

    def _json_response(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = 8000
    server = HTTPServer(('localhost', port), Handler)
    print(f'Servidor en http://localhost:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nServidor detenido.')
        server.server_close()