"""Actualiza el número de versión (?v=...) de css/js en todas las páginas para
que los navegadores descarguen los archivos nuevos después de cada lanzamiento.

Uso:  python tools/bump_version.py
"""
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = time.strftime("%Y%m%d%H%M")
PATTERN = re.compile(r'((?:href|src)="(?:css|js)/[\w.-]+\.(?:css|js))(?:\?v=\w+)?"')

for page in sorted(ROOT.glob("*.html")):
    if page.name.startswith("view-source"):
        continue
    html = page.read_text(encoding="utf-8")
    new = PATTERN.sub(lambda m: f'{m.group(1)}?v={VERSION}"', html)
    if new != html:
        page.write_text(new, encoding="utf-8")
        print("versión", VERSION, "→", page.name)
