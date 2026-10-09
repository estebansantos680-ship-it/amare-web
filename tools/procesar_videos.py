"""
Convierte los videos reales del salón en clips web en bucle (sin sonido) + póster.

Originales: imagenes/*.mp4 (720p, del álbum compartido de iCloud).
Salida:     assets/video/real-<nombre>.webm (VP9, más liviano), .mp4 (H.264, respaldo) y -poster.webp

Necesita ffmpeg: usa el que trae el paquete imageio-ffmpeg (pip install imageio-ffmpeg).
Uso: python tools/procesar_videos.py
"""
import os
import subprocess
import imageio_ffmpeg
from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, 'imagenes')
DESTINO = os.path.join(RAIZ, 'assets', 'video')
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

# nombre: (archivo, segundo de inicio, duración máxima, segundo para el póster)
VIDEOS = {
    'liso-negro': ('IMG_7159.mp4', 0, 9, 1.0),
    'balayage-ondas': ('IMG_2440.mp4', 0, 10, 1.5),
    'rubio-bob': ('IMG_2731.mp4', 0, 10, 1.0),
}
FILTRO = 'scale=720:-2:flags=lanczos,eq=contrast=1.03:saturation=1.04'


def correr(args):
    subprocess.run([FFMPEG, '-y', '-loglevel', 'error'] + args, check=True)


for nombre, (archivo, inicio, dur, seg_poster) in VIDEOS.items():
    entrada = os.path.join(ORIGEN, archivo)
    base = os.path.join(DESTINO, 'real-' + nombre)
    comun = ['-ss', str(inicio), '-t', str(dur), '-i', entrada, '-an', '-vf', FILTRO]
    correr(comun + ['-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-maxrate', '2M', '-bufsize', '4M', '-profile:v', 'high',
                    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', base + '.mp4'])
    correr(comun + ['-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '1600k', '-row-mt', '1',
                    '-pix_fmt', 'yuv420p', base + '.webm'])
    tmp = base + '-poster.png'
    correr(['-ss', str(inicio + seg_poster), '-i', entrada, '-frames:v', '1', '-vf', FILTRO, tmp])
    Image.open(tmp).save(base + '-poster.webp', 'WEBP', quality=84, method=6)
    os.remove(tmp)
    tam = {ext: os.path.getsize(base + ext) // 1024 for ext in ('.mp4', '.webm', '-poster.webp')}
    print(nombre, tam)
