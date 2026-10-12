"""Servidor local para revisar el sitio igual que en amarecr.com.

Uso (desde la carpeta del proyecto):
    python tools/servidor_local.py          # http://localhost:5500
    python tools/servidor_local.py 8000     # otro puerto

Como GitHub Pages, entiende las direcciones sin ".html": /sobre-nosotros sirve sobre-nosotros.html.
(El servidor normal de Python, python -m http.server, no lo hace y esos enlaces darían 404.)
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Manejador(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        ruta = super().translate_path(path)
        if not os.path.exists(ruta) and not os.path.splitext(ruta)[1] and os.path.exists(ruta + '.html'):
            return ruta + '.html'
        return ruta


if __name__ == '__main__':
    puerto = int(sys.argv[1]) if len(sys.argv) > 1 else 5500
    servidor = ThreadingHTTPServer(('', puerto), partial(Manejador, directory=str(ROOT)))
    print(f'Sitio de Amarë en http://localhost:{puerto}  (Ctrl+C para detener)')
    servidor.serve_forever()
