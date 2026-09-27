"""Sincroniza header, footer y <head> comunes en todas las páginas de Amarë.

Uso (desde la carpeta del proyecto):
    python tools/sync_layout.py

- El header y el footer se editan UNA sola vez en _partials/ y este script
  los copia a cada página, marcando el enlace activo del menú.
- La guía de largos (_partials/guia-largos.html) se copia donde haya
  <!-- GUIA-LARGOS:START --> ... <!-- GUIA-LARGOS:END -->.
- Es seguro correrlo varias veces.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEADER = (ROOT / "_partials" / "header.html").read_text(encoding="utf-8")
FOOTER = (ROOT / "_partials" / "footer.html").read_text(encoding="utf-8")
# Bloques de contenido compartidos (se insertan donde haya marcadores START/END)
BLOQUES = {
    "guia-largos": (ROOT / "_partials" / "guia-largos.html").read_text(encoding="utf-8"),
}

FONTS = ('<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700'
         '&family=Playfair+Display:ital,wght@0,400;0,500;1,400;1,500&display=swap" rel="stylesheet">')
HEAD_EXTRA = ('<meta name="theme-color" content="#0B0B0B">\n'
              '<link rel="icon" href="assets/icons/favicon.svg" type="image/svg+xml">\n')

# Qué opción del menú queda marcada en cada página
ACTIVE = {
    "index.html": "index",
    "sobre-nosotros.html": "nosotros",
    "productos.html": "productos",
    "valores.html": "valores",
}


def active_key(name: str) -> str:
    if name.startswith("servicios"):
        return "servicios"
    return ACTIVE.get(name, "")


def render_header(name: str) -> str:
    key = active_key(name)

    def repl(m):
        return ' class="active" aria-current="page"' if m.group(1) == key else ""

    return re.sub(r"\{\{active:(\w+)\}\}", repl, HEADER).rstrip() + "\n"


def sync(path: Path) -> bool:
    html = path.read_text(encoding="utf-8")
    original = html

    # Fuentes oficiales de la marca
    html = re.sub(r'<link href="https://fonts\.googleapis\.com/css2\?[^"]*" rel="stylesheet">', FONTS, html)
    # theme-color + favicon
    if 'rel="icon"' not in html:
        html = html.replace('<link rel="preconnect" href="https://fonts.googleapis.com">',
                            HEAD_EXTRA + '<link rel="preconnect" href="https://fonts.googleapis.com">', 1)
    # Header (topbar + nav)
    html = re.sub(r'[ \t]*<div class="topbar">.*?</header>\n', lambda m: render_header(path.name), html,
                  count=1, flags=re.S)
    # Footer + botón flotante de WhatsApp
    html = re.sub(r'[ \t]*<footer id="contacto">.*?</footer>\n(\s*<a class="wa-float".*?</a>\n)?',
                  lambda m: FOOTER.rstrip() + "\n", html, count=1, flags=re.S)

    # Bloques reutilizables marcados con <!-- NOMBRE:START --> ... <!-- NOMBRE:END -->
    for nombre, contenido in BLOQUES.items():
        marca = nombre.upper()
        html = re.sub(
            rf"<!-- {marca}:START -->.*?<!-- {marca}:END -->",
            lambda m: f"<!-- {marca}:START -->\n{contenido.rstrip()}\n    <!-- {marca}:END -->",
            html, flags=re.S)

    if html != original:
        path.write_text(html, encoding="utf-8")
        return True
    return False


def main():
    pages = sorted(p for p in ROOT.glob("*.html") if not p.name.startswith("view-source"))
    for page in pages:
        print(("actualizada  " if sync(page) else "sin cambios  ") + page.name)


if __name__ == "__main__":
    main()
