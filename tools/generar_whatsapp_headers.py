"""Genera las imágenes de encabezado de las plantillas de WhatsApp (assets/wa/*.jpg, 1200x628).

Uso: python tools/generar_whatsapp_headers.py
Tarjeta de presentación 100 % de marca (sin fotos de clientas): fondo negro, marco dorado, monograma y
logotipo AMARË a la izquierda; a la derecha el tipo de mensaje y un titular.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SALIDA = ROOT / 'assets' / 'wa'
FONTS = Path('C:/Windows/Fonts')
W, H = 1200, 628
NEGRO, CREMA, TAUPE, TAUPE_OSC = (11, 11, 11), (245, 243, 239), (181, 164, 138), (138, 122, 99)
GRIS_CLARO = (200, 194, 186)

TARJETAS = {
    'reserva_confirmada': ('CITA CONFIRMADA', ['Tu espacio', 'está reservado']),
    'reserva_en_revision': ('SOLICITUD RECIBIDA', ['Estamos revisando', 'tu reserva']),
    'cita_actualizada': ('CITA ACTUALIZADA', ['Tenemos un nuevo', 'horario para ti']),
    'recordatorio_3_dias': ('RECORDATORIO', ['Tu cita es', 'en 3 días']),
    'recordatorio_1_dia': ('RECORDATORIO', ['¡Mañana', 'es tu cita!']),
}


def fuente(nombre, tam):
    return ImageFont.truetype(str(FONTS / nombre), tam)


def espaciado(d, xy, texto, f, fill, track, centro=False):
    ancho = sum(d.textlength(ch, font=f) + track for ch in texto) - track
    x, y = xy
    if centro:
        x -= ancho / 2
    for ch in texto:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + track


def centrado(d, cx, y, texto, f, fill):
    d.text((cx - d.textlength(texto, font=f) / 2, y), texto, font=f, fill=fill)


def tarjeta(clave, eyebrow, titular):
    im = Image.new('RGB', (W, H), NEGRO)
    d = ImageDraw.Draw(im)
    # Doble marco dorado
    d.rectangle((26, 26, W - 26, H - 26), outline=TAUPE, width=2)
    d.rectangle((38, 38, W - 38, H - 38), outline=TAUPE_OSC, width=1)
    # Lado izquierdo: monograma + logotipo
    cx = 330
    d.ellipse((cx - 92, 110, cx + 92, 294), outline=TAUPE, width=2)
    a = fuente('georgia.ttf', 116)
    centrado(d, cx, 138, 'A', a, CREMA)
    for dx in (-17, 17):
        d.ellipse((cx + dx - 6, 140, cx + dx + 6, 152), fill=TAUPE)
    centrado(d, cx, 330, 'AMARË', fuente('georgia.ttf', 78), CREMA)
    espaciado(d, (cx, 432), 'BEAUTY CENTER', fuente('segoeui.ttf', 20), TAUPE, 8, centro=True)
    # Separador vertical
    d.line((600, 150, 600, H - 150), fill=TAUPE_OSC, width=1)
    # Lado derecho: mensaje
    x0 = 660
    espaciado(d, (x0, 205), eyebrow, fuente('segoeuib.ttf', 20), TAUPE, 6)
    d.line((x0, 246, x0 + 64, 246), fill=TAUPE, width=2)
    tit = fuente('georgiai.ttf', 54)
    y = 272
    for linea in titular:
        d.text((x0, y), linea, font=tit, fill=CREMA)
        y += 68
    espaciado(d, (x0, H - 112), 'San José, Santa Ana  ·  amarecr.com', fuente('segoeui.ttf', 19), GRIS_CLARO, 1)
    SALIDA.mkdir(parents=True, exist_ok=True)
    destino = SALIDA / f'{clave}.jpg'
    im.save(destino, 'JPEG', quality=92, optimize=True, progressive=True)
    return destino


if __name__ == '__main__':
    for clave, (eyebrow, titular) in TARJETAS.items():
        print(tarjeta(clave, eyebrow, titular))


def cabecera_correo():
    """Banda plana de marca para la cabecera de los correos (assets/email/cabecera.jpg), sin fotos de personas."""
    w, h = 1200, 300
    im = Image.new('RGB', (w, h), (245, 243, 239))
    d = ImageDraw.Draw(im)
    cx = w // 2
    d.line((120, h // 2, cx - 90, h // 2), fill=TAUPE, width=2)
    d.line((cx + 90, h // 2, w - 120, h // 2), fill=TAUPE, width=2)
    d.ellipse((cx - 62, h // 2 - 62, cx + 62, h // 2 + 62), outline=TAUPE, width=2)
    centrado(d, cx, h // 2 - 52, 'A', fuente('georgia.ttf', 80), NEGRO)
    for dx in (-12, 12):
        d.ellipse((cx + dx - 5, h // 2 - 50, cx + dx + 5, h // 2 - 40), fill=TAUPE)
    espaciado(d, (cx, h - 62), 'COLOR  ·  ALISAMIENTOS  ·  TRATAMIENTOS CAPILARES', fuente('segoeui.ttf', 17), TAUPE_OSC, 4, centro=True)
    destino = ROOT / 'assets' / 'email' / 'cabecera.jpg'
    im.save(destino, 'JPEG', quality=92, optimize=True, progressive=True)
    return destino


if __name__ == '__main__':
    print(cabecera_correo())
