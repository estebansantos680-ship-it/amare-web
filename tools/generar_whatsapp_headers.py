"""Genera las imágenes de encabezado de las plantillas de WhatsApp (assets/wa/*.jpg, 1200x628).

Uso: python tools/generar_whatsapp_headers.py
Cada imagen es una "tarjeta de presentación" de Amarë: foto real a la izquierda y panel crema con la marca,
el tipo de mensaje y un titular. Meta las muestra arriba del texto de la plantilla.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
FOTOS = ROOT / 'assets' / 'images'
SALIDA = ROOT / 'assets' / 'wa'
FONTS = Path('C:/Windows/Fonts')
W, H = 1200, 628
CREMA, NEGRO, TAUPE, TAUPE_OSC, GRIS = (245, 243, 239), (11, 11, 11), (181, 164, 138), (138, 122, 99), (95, 88, 80)

TARJETAS = {
    'reserva_confirmada': ('real-balayage-ondas-900x1125.webp', 'CITA CONFIRMADA', ['Tu espacio', 'está reservado']),
    'reserva_en_revision': ('real-estudio-espalda-700x875.webp', 'SOLICITUD RECIBIDA', ['Estamos revisando', 'tu reserva']),
    'cita_actualizada': ('real-cobrizo-ondas-700x875.webp', 'CITA ACTUALIZADA', ['Tenemos un nuevo', 'horario para ti']),
    'recordatorio_3_dias': ('real-inicio-rubia-900x1125.webp', 'RECORDATORIO', ['Tu cita es', 'en 3 días']),
    'recordatorio_1_dia': ('real-platino-700x875.webp', 'RECORDATORIO', ['¡Mañana', 'es tu cita!']),
}


def fuente(nombre, tam):
    return ImageFont.truetype(str(FONTS / nombre), tam)


def espaciado(draw, xy, texto, f, fill, track):
    x, y = xy
    for ch in texto:
        draw.text((x, y), ch, font=f, fill=fill)
        x += draw.textlength(ch, font=f) + track
    return x


def ancho_espaciado(draw, texto, f, track):
    return sum(draw.textlength(ch, font=f) + track for ch in texto) - track


def foto_cubierta(ruta, w, h):
    im = Image.open(ruta).convert('RGB')
    esc = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * esc), round(im.height * esc)), Image.LANCZOS)
    x, y = (im.width - w) // 2, max(0, (im.height - h) // 3)
    return im.crop((x, y, x + w, y + h))


def tarjeta(clave, foto, eyebrow, titular):
    lienzo = Image.new('RGB', (W, H), CREMA)
    fw = 560
    lienzo.paste(foto_cubierta(FOTOS / foto, fw, H), (0, 0))
    d = ImageDraw.Draw(lienzo)
    # Marco fino dorado alrededor del panel de texto
    x0 = fw + 56
    d.rectangle((fw + 28, 28, W - 28, H - 28), outline=TAUPE, width=2)
    # Marca
    marca = fuente('georgia.ttf', 64)
    d.text((x0, 70), 'AMARË', font=marca, fill=NEGRO)
    espaciado(d, (x0 + 3, 146), 'BEAUTY CENTER', fuente('segoeui.ttf', 17), GRIS, 6)
    d.line((x0, 196, x0 + 70, 196), fill=TAUPE, width=2)
    # Tipo de mensaje
    espaciado(d, (x0, 230), eyebrow, fuente('segoeuib.ttf', 20), TAUPE_OSC, 5)
    # Titular
    tit = fuente('georgiai.ttf', 54)
    y = 280
    for linea in titular:
        d.text((x0, y), linea, font=tit, fill=NEGRO)
        y += 68
    # Pie
    pie = fuente('segoeui.ttf', 19)
    espaciado(d, (x0, H - 92), 'San José, Santa Ana  ·  amarecr.com', pie, GRIS, 1)
    SALIDA.mkdir(parents=True, exist_ok=True)
    destino = SALIDA / f'{clave}.jpg'
    lienzo.save(destino, 'JPEG', quality=90, optimize=True, progressive=True)
    return destino


if __name__ == '__main__':
    for clave, (foto, eyebrow, titular) in TARJETAS.items():
        print(tarjeta(clave, foto, eyebrow, titular))
