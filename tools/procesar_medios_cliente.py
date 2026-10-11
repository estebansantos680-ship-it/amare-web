"""
Fotos y videos del cliente (imagenes/Imagenes cliente, fuera de git) → archivos web en assets/.

- Fotos: WebP recortadas a la proporción de cada lugar (assets/media/*.webp).
- Videos sin sonido (tarjetas, banners, reel): MP4 H.264 + WebM VP9 en bucle, 720 px de ancho, + póster.
- Videos con sonido (se reproducen con controles en la página): MP4 H.264 1080×1920 + AAC, + póster.

Uso:
    python tools/procesar_medios_cliente.py            # todo
    python tools/procesar_medios_cliente.py fotos      # solo fotos
    python tools/procesar_medios_cliente.py mudos      # solo videos sin sonido
    python tools/procesar_medios_cliente.py sonido     # solo videos con sonido
Requiere: pip install pillow imageio-ffmpeg
"""
import os
import sys
import subprocess
import imageio_ffmpeg
from PIL import Image, ImageOps

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, 'imagenes', 'Imagenes cliente')
SERV = os.path.join(ORIGEN, 'Imagenes servicio')
MEDIA = os.path.join(RAIZ, 'assets', 'media')
VIDEO = os.path.join(RAIZ, 'assets', 'video')
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# nombre: (ruta relativa a ORIGEN, (ancho, alto) o None = conservar proporción con ancho máx., ancho máx.)
FOTOS = {
    # Inicio: portada (la rubia primero) y círculo de producto
    'inicio-1': ('Pagina de incio/1.JPG', (900, 1125), {'foco': (0.455, 0.42), 'zoom': 1.15}),  # centrada
    'inicio-2': ('Pagina de incio/2.jpeg', (900, 1125)),
    'inicio-3': ('Pagina de incio/3.jpeg', (900, 1125), {'foco': (0.5, 0.0), 'zoom': 1.0}),  # se ve la parte de arriba
    'inicio-4': ('Pagina de incio/4.jpeg', (900, 1125)),
    'inicio-5': ('Pagina de incio/5.jpeg', (900, 1125)),
    'inicio-6': ('Pagina de incio/6.jpeg', (900, 1125)),
    'inicio-7': ('Pagina de incio/8.jpeg', (900, 1125)),
    'inicio-8': ('Pagina de incio/9.jpeg', (900, 1125), {'foco': (0.40, 0.42), 'zoom': 1.15}),  # centrada
    'producto-circulo': ('Productos/Producto1.png', (420, 420)),
    # "Tu imagen es el reflejo de quien eres"
    'reflejo-1': ('Tu imagen es el reflejo de quien eres/1.1.jpg', (700, 875)),
    'reflejo-2': ('Tu imagen es el reflejo de quien eres/3.1.jpg', (700, 875)),
    'reflejo-3': ('Tu imagen es el reflejo de quien eres/2.1.jpg', (700, 875)),
    # Tarjetas de categoría (servicios.html), proporción 3:4
    'alis-1': ('Imagenes servicio/05 Alisado- nanoplastia/1.jpeg', (600, 800)),
    'alis-2': ('Imagenes servicio/05 Alisado- nanoplastia/2.jpeg', (600, 800)),
    'alis-3': ('Imagenes servicio/05 Alisado- nanoplastia/6.1.jpeg', (600, 800)),
    'cir-1': ('Imagenes servicio/06 Cirugia capilar/Opcion 1 fotos de cirugias.jpg', (600, 800)),
    'cir-2': ('Imagenes servicio/06 Cirugia capilar/Opcion 2 fotos de cirugias.jpg', (600, 800)),
    'trat-1': ('Imagenes servicio/07 tratamientos capilares/1.JPG', (600, 800)),
    'trat-2': ('Imagenes servicio/07 tratamientos capilares/3-julio.jpg', (600, 800)),
    'color-1': ('Imagenes servicio/08 Balayage/3.jpeg', (600, 800)),
    'color-2': ('Imagenes servicio/08 Balayage/2.jpeg', (600, 800)),
    'parejo-1': ('Imagenes servicio/09 Color Parejo/1.jpeg', (600, 800)),
    'parejo-2': ('Imagenes servicio/09 Color Parejo/2.jpeg', (600, 800)),
    'corte-1': ('Imagenes servicio/10 Corte de Cabello/3.jpeg', (600, 800)),
    'rizos-1': ('Imagenes servicio/11 Tratamiento en rizos/4.1.jpg', (600, 800)),
    'rizos-2': ('Imagenes servicio/11 Tratamiento en rizos/IMG_7010.jpeg', (600, 800)),
    # Portada de servicios.html (alternan) y contacto
    'pensados-1': ('Servicios pensados en ti/IMG_4617.JPG', (900, 1125)),
    'pensados-2': ('Servicios pensados en ti/IMG_4662.JPG', (900, 1125)),
    'contacto': ('Servicios pensados en ti/No dudes  en ponerte en contacto con nosostors.jpg', (700, 1000)),
    # Productos (la página): tamaño original como máximo (algunas son pequeñas)
    'producto-p1': ('Productos pagina/1.1.jpeg', None, 600),
    'producto-p2': ('Productos pagina/2.2.jpeg', None, 600),
    'producto-p3': ('Productos pagina/3.3.jpeg', None, 600),
    'producto-p4': ('Productos pagina/4.4.jpeg', None, 600),
    'producto-p5': ('Productos pagina/5.5.jpeg', None, 600),
    'producto-p6': ('Productos pagina/6.webp', None, 600),
    'ubicacion': ('Imagen Ubicacion.png', None, 900),
}

# nombre: (ruta, inicio s, duración s o None, filtro extra, velocidad)
MUDOS = {
    'reel-alisado': ('1 vedeo alisado con brillo.mov', 0, None, '', 1),
    'reel-color': ('3.2 color con presion.mov', 0, None, '', 1),
    'alis-v1': ('Imagenes servicio/05 Alisado- nanoplastia/Opcion video top servicio 2.mov', 0, 10, '', 1),
    'alis-v2': ('Imagenes servicio/05 Alisado- nanoplastia/Opcion video top servicio 1.mov', 0, 10, '', 1),
    'alis-v3': ('Imagenes servicio/05 Alisado- nanoplastia/Opcion video top servicio 3.mov', 0, 10, '', 1),
    'cir-v1': ('Imagenes servicio/06 Cirugia capilar/Opcion de video TOP 1.mov', 0, None, '', 1),
    'cir-banner': ('Imagenes servicio/06 Cirugia capilar/Opcion de video TOP 1.mov', 5.5, 5.5, '', 1),  # donde sonríe
    'trat-v1': ('Imagenes servicio/07 tratamientos capilares/video top opcion 1.MOV', 0, None, '', 1),
    'color-v1': ('Imagenes servicio/08 Balayage/video top 3.mov', 0, None, '', 1),
    'parejo-v1': ('Imagenes servicio/09 Color Parejo/Opcion 3 video.MP4', 0, None, '', 1),
    'corte-v1': ('Imagenes servicio/10 Corte de Cabello/Video para corte minuto 251 a 3 minutos.MP4', 170, 10, 'transpose=2,', 1),
    'rizos-v1': ('Imagenes servicio/11 Tratamiento en rizos/IMG_6998.mov', 0, None, '', 0.5),  # a media velocidad
}

# nombre: ruta (videos completos con sonido)
CON_SONIDO = {
    'amare-estudio': 'Video AMare.mp4',
    'experiencia': '2 video con sonido.mp4',
    'nanoplastia': 'Imagenes servicio/05 Alisado- nanoplastia/1 Agregar este video con sonido Nanoplastia_2.mp4',
    'balayage': 'Imagenes servicio/08 Balayage/01 Timeline 11 balayage.mp4',
}


def correr(args):
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error'] + args, check=True)


def recorte(im, tam, foco=(0.5, 0.4), zoom=1.0):
    """Recorta a la proporción de `tam` centrando en `foco` (x, y de 0 a 1); zoom > 1 acerca para poder centrar."""
    rel = tam[0] / tam[1]
    w, h = im.size
    cw, ch = (w, w / rel) if w / h < rel else (h * rel, h)
    cw, ch = cw / zoom, ch / zoom
    x = min(max(foco[0] * w - cw / 2, 0), w - cw)
    y = min(max(foco[1] * h - ch / 2, 0), h - ch) if foco[1] > 0 else 0
    return im.crop((round(x), round(y), round(x + cw), round(y + ch))).resize(tam, Image.LANCZOS)


def fotos():
    os.makedirs(MEDIA, exist_ok=True)
    for nombre, spec in FOTOS.items():
        ruta = os.path.join(ORIGEN, spec[0])
        im = ImageOps.exif_transpose(Image.open(ruta))
        im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
        if spec[1] and len(spec) > 2 and isinstance(spec[2], dict):
            im = recorte(im, spec[1], **spec[2])
        elif spec[1]:
            im = ImageOps.fit(im, spec[1], Image.LANCZOS, centering=(0.5, 0.4))
        else:
            maximo = spec[2]
            if im.width > maximo:
                im = im.resize((maximo, round(im.height * maximo / im.width)), Image.LANCZOS)
        if im.mode == 'RGBA':
            fondo = Image.new('RGB', im.size, (245, 243, 239))
            fondo.paste(im, mask=im.split()[3])
            im = fondo
        im.save(os.path.join(MEDIA, nombre + '.webp'), 'WEBP', quality=84, method=6)
        print('foto', nombre, im.size)


def poster(mp4, destino, seg=0.5):
    tmp = destino + '.png'
    correr(['-ss', str(seg), '-i', mp4, '-frames:v', '1', tmp])
    Image.open(tmp).convert('RGB').save(destino, 'WEBP', quality=80)
    os.remove(tmp)


def mudos():
    os.makedirs(VIDEO, exist_ok=True)
    for nombre, (ruta, ini, dur, extra, vel) in MUDOS.items():
        entrada = os.path.join(ORIGEN, ruta)
        base = os.path.join(VIDEO, nombre)
        corte = ['-ss', str(ini)] + (['-t', str(dur)] if dur else []) + ['-i', entrada, '-an']
        filtro = extra + ('setpts=%s*PTS,' % (1 / vel) if vel != 1 else '') + \
            "scale='min(720,iw)':-2:flags=lanczos,eq=contrast=1.03:saturation=1.05,fps=30"
        correr(corte + ['-vf', filtro, '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-maxrate', '2500k',
                        '-bufsize', '5M', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', base + '.mp4'])
        correr(['-i', base + '.mp4', '-c:v', 'libvpx-vp9', '-crf', '34', '-b:v', '1800k', '-row-mt', '1',
                '-pix_fmt', 'yuv420p', '-an', base + '.webm'])
        poster(base + '.mp4', base + '-poster.webp')
        print('mudo', nombre, os.path.getsize(base + '.mp4') // 1024, 'KB')


def sonido():
    os.makedirs(VIDEO, exist_ok=True)
    for nombre, ruta in CON_SONIDO.items():
        entrada = os.path.join(ORIGEN, ruta)
        base = os.path.join(VIDEO, nombre)
        correr(['-i', entrada, '-vf', "scale=1080:-2:flags=lanczos,fps=30", '-c:v', 'libx264', '-preset', 'slow',
                '-crf', '23', '-maxrate', '4500k', '-bufsize', '9M', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', base + '.mp4'])
        poster(base + '.mp4', base + '-poster.webp', 1.0)
        print('sonido', nombre, os.path.getsize(base + '.mp4') // 1024, 'KB')


if __name__ == '__main__':
    que = sys.argv[1:] or ['fotos', 'mudos', 'sonido']
    if 'fotos' in que:
        fotos()
    if 'mudos' in que:
        mudos()
    if 'sonido' in que:
        sonido()
