"""
Genera las imágenes web (WebP) del sitio a partir de las fotos reales del salón.

Originales: imagenes/ (no se suben a git; vienen del álbum compartido de iCloud, 1536x2048).
Salida:     assets/images/real-*.webp

- Recorte al formato de cada sección (3:4, 4:5) y redimensionado con Lanczos.
- Retoque suave: un poco de contraste, color y nitidez (sin "efecto filtro").
- Formatos anchos (encabezados y banners): la foto vertical nítida sobre un fondo
  desenfocado de la misma foto, para no cortar a la persona.

Uso: python tools/procesar_fotos.py
"""
import os
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, 'imagenes')
DESTINO = os.path.join(RAIZ, 'assets', 'images')
CALIDAD = 86

FOTOS = {
    'liso-castano': 'IMG_0328.jpg',
    'bob-oscuro': 'IMG_2409.jpg',
    'balayage-ondas': 'IMG_2447.jpg',
    'rizos-caramelo': 'IMG_2607.jpg',
    'rubio-liso': 'IMG_2730.jpg',
    'clienta-ondas': 'IMG_3073.jpg',
    'capas-flequillo': 'IMG_3075.jpg',
    'estudio-liso': 'IMG_3080.jpg',
    'estudio-espalda': 'IMG_3081.jpg',
    'cobriza': 'IMG_3092.jpg',
    'cobrizo-ondas': 'IMG_6816.jpg',
    'liso-negro': 'IMG_7152.jpg',
    'platino': 'IMG_7760.jpg',
    'bob-magenta': 'IMG_7923.jpg',
    'balayage-sonrisa': 'IMG_9235.jpg',
}

# (foto, ancho, alto) — vertical: recorte; ancho: composición
VERTICALES = [
    ('balayage-sonrisa', 900, 1125), ('balayage-ondas', 900, 1125), ('liso-negro', 900, 1125),
    ('rizos-caramelo', 600, 800), ('liso-castano', 600, 800), ('rubio-liso', 600, 800), ('bob-oscuro', 600, 800),
    ('estudio-liso', 800, 1000), ('clienta-ondas', 420, 560),
    ('cobrizo-ondas', 700, 875), ('bob-magenta', 700, 875), ('capas-flequillo', 700, 875), ('liso-negro', 700, 875),
    ('rubio-liso', 700, 875), ('balayage-ondas', 700, 875), ('bob-oscuro', 700, 875), ('estudio-espalda', 700, 875),
    ('platino', 700, 875),
]
ANCHAS = [
    ('balayage-ondas', 1800, 900), ('cobrizo-ondas', 1800, 900), ('bob-oscuro', 1800, 900),
    ('liso-castano', 1800, 900), ('estudio-espalda', 1800, 900), ('balayage-sonrisa', 1800, 900),
    ('cobriza', 1600, 800), ('estudio-liso', 1600, 800), ('clienta-ondas', 1600, 800),
]


def abrir(clave):
    im = Image.open(os.path.join(ORIGEN, FOTOS[clave]))
    return ImageOps.exif_transpose(im).convert('RGB')


def retocar(im):
    im = ImageEnhance.Contrast(im).enhance(1.04)
    im = ImageEnhance.Color(im).enhance(1.03)
    return im.filter(ImageFilter.UnsharpMask(radius=1.1, percent=55, threshold=2))


def recortar(im, ancho, alto):
    """Recorta al formato pedido dejando más aire arriba (cabezas) y redimensiona."""
    w, h = im.size
    objetivo = ancho / alto
    if w / h > objetivo:  # sobra ancho
        nuevo = round(h * objetivo)
        x = (w - nuevo) // 2
        im = im.crop((x, 0, x + nuevo, h))
    else:  # sobra alto: se quita 30 % arriba y 70 % abajo
        nuevo = round(w / objetivo)
        y = round((h - nuevo) * 0.3)
        im = im.crop((0, y, w, y + nuevo))
    return im.resize((ancho, alto), Image.LANCZOS)


def componer_ancha(im, ancho, alto):
    """Fondo: la misma foto ampliada y desenfocada. Encima: la foto completa, nítida, a la derecha."""
    fondo = recortar(im, ancho, alto).filter(ImageFilter.GaussianBlur(38))
    fondo = ImageEnhance.Brightness(fondo).enhance(0.82)
    alto_frente = alto
    ancho_frente = round(im.width * alto_frente / im.height)
    frente = im.resize((ancho_frente, alto_frente), Image.LANCZOS)
    x = round(ancho * 0.72 - ancho_frente / 2)
    x = max(0, min(ancho - ancho_frente, x))
    fondo.paste(frente, (x, 0))
    return fondo


def guardar(im, nombre):
    ruta = os.path.join(DESTINO, nombre)
    im.save(ruta, 'WEBP', quality=CALIDAD, method=6)
    return os.path.getsize(ruta)


if __name__ == '__main__':
    total = 0
    for clave, w, h in VERTICALES:
        total += guardar(retocar(recortar(abrir(clave), w, h)), 'real-%s-%dx%d.webp' % (clave, w, h))
    for clave, w, h in ANCHAS:
        total += guardar(retocar(componer_ancha(abrir(clave), w, h)), 'real-%s-ancho-%dx%d.webp' % (clave, w, h))
    print('Listo: %d imágenes, %d KB en total' % (len(VERTICALES) + len(ANCHAS), total // 1024))


# ---------------------------------------------------------------- Foto del equipo (Sobre nosotros)
# Viene de WhatsApp (1290x713, con compresión): se limpia el ruido de bloques, se amplía con Lanczos
# y se le devuelve nitidez. Salen dos tamaños para srcset y un fondo desenfocado para el encabezado.
def procesar_equipo():
    im = ImageOps.exif_transpose(Image.open(os.path.join(ORIGEN, 'Equipo.jpg'))).convert('RGB')
    limpia = Image.blend(im, im.filter(ImageFilter.GaussianBlur(0.7)), 0.45)  # suaviza bloques JPEG sin borrar detalle
    grande = limpia.resize((round(im.width * 1.5), round(im.height * 1.5)), Image.LANCZOS)
    grande = ImageEnhance.Contrast(grande).enhance(1.05)
    grande = ImageEnhance.Color(grande).enhance(1.03)
    grande = grande.filter(ImageFilter.UnsharpMask(radius=1.8, percent=75, threshold=3))
    tam = 0
    for ancho in (1920, 1200):
        alto = round(grande.height * ancho / grande.width)
        tam += guardar(grande.resize((ancho, alto), Image.LANCZOS), 'equipo-amare-%d.webp' % ancho)
    fondo = recortar(grande, 1800, 900).filter(ImageFilter.GaussianBlur(24))
    tam += guardar(ImageEnhance.Brightness(fondo).enhance(0.9), 'equipo-amare-fondo-1800x900.webp')
    print('Equipo listo: %d KB' % (tam // 1024), grande.size)


if __name__ == '__main__':
    procesar_equipo()
