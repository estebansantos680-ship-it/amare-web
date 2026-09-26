"""Descarga las fotos de Unsplash usadas en las páginas y las guarda en
assets/images/ como WebP optimizado, reemplazando los enlaces externos.

Uso:  python tools/localize_images.py
"""
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "images"

# Nombre legible para cada foto (id de Unsplash -> nombre de archivo)
NAMES = {
    "photo-1701976333339-1d41dad8138b": "estilista-ondas",
    "photo-1747098393451-6b985f62a2c2": "productos-botellas",
    "photo-1758315949140-1972ace0644e": "alisamiento",
    "photo-1605980625600-88b46abafa8d": "balayage-cenizo",
    "photo-1779350676620-fde279b1d023": "color-parejo",
    "photo-1733685373279-a10ac3f255e7": "tratamiento-capilar",
    "photo-1711274094763-ff442e4719ef": "corte-puntas",
    "photo-1785860333038-5c6dce348544": "cirugia-capilar",
    "photo-1695527081874-b674c46f40fb": "estudio-interior",
    "photo-1700760934268-8aa0ef52ce0a": "corte-estilista",
    "photo-1605980625982-b128a7e7fde2": "mechas-aluminio",
    "photo-1695527081848-1e46c06e6458": "clienta-estudio",
    "photo-1722872065547-515a2e6ec7bb": "productos-neutros",
    "photo-1695527081882-a8b051dac51e": "tocador-productos",
    "photo-1695527081782-33e110235ade": "estante-productos",
    "photo-1624939461078-66a124b3539c": "productos-estilizado",
    "photo-1695527081756-6e15ed27c6a3": "estante-productos-2",
    "photo-1560869713-7d0a29430803": "tenaza-ondas",
    "photo-1554519934-e32b1629d9ee": "rubio-brillo",
    "photo-1787880172059-1c52decb1ca9": "lavacabezas",
    "photo-1695527082039-5f96003b97e4": "recepcion-flores",
    "photo-1695527081827-fdbc4e77be9b": "estudio-sillon",
}

URL_RE = re.compile(r'https://images\.unsplash\.com/(photo-[\w-]+)\?([^"\s]+)')


def local_name(photo_id: str, query: str) -> str:
    w = re.search(r"w=(\d+)", query)
    h = re.search(r"h=(\d+)", query)
    size = f"-{w.group(1)}x{h.group(1)}" if w and h else ""
    return f"{NAMES.get(photo_id, photo_id)}{size}.webp"


def download(photo_id: str, query: str, dest: Path):
    if dest.exists():
        return
    q = query.replace("&amp;", "&").replace("auto=format", "fm=webp")
    q = re.sub(r"q=\d+", "q=72", q)
    req = urllib.request.Request(f"https://images.unsplash.com/{photo_id}?{q}",
                                 headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        dest.write_bytes(r.read())
    print(f"  descargada {dest.name} ({dest.stat().st_size // 1024} KB)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    pages = [p for p in ROOT.glob("*.html") if not p.name.startswith("view-source")]
    for page in sorted(pages):
        html = page.read_text(encoding="utf-8")

        def repl(m):
            name = local_name(m.group(1), m.group(2))
            download(m.group(1), m.group(2), OUT / name)
            return f"assets/images/{name}"

        new = URL_RE.sub(repl, html)
        if new != html:
            page.write_text(new, encoding="utf-8")
            print("actualizada", page.name)


if __name__ == "__main__":
    main()
