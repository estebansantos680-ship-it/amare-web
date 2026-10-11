"""Banner ancho y limpio a partir de una foto: la foto va a la derecha y hacia la izquierda se extiende,
fila por fila, el color del borde (pared, piso…), sin desenfoque. Lo usan Reservar y Servicios.

Uso: python tools/banner_extendido.py "<foto origen>" <salida.webp> <alto> <ancho> [margen_derecho]
"""
import sys
import numpy as np
from PIL import Image, ImageOps


def banner(origen, destino, alto, ancho, margen=0, fundido=80):
    im = ImageOps.exif_transpose(Image.open(origen)).convert('RGB')
    foto = im.resize((round(im.width * alto / im.height), alto), Image.LANCZOS)
    a = np.asarray(foto).astype(float)
    x0 = ancho - foto.width - margen
    k = np.ones(25) / 25
    suave = lambda c: np.stack([np.convolve(np.pad(c[:, i], 12, mode='edge'), k, mode='valid') for i in range(3)], axis=1)
    izq = suave(np.median(a[:, :30, :], axis=1))
    der = suave(np.median(a[:, -30:, :], axis=1))
    lienzo = np.zeros((alto, ancho, 3))
    lienzo[:, :x0, :] = izq[:, None, :]
    lienzo[:, x0 + foto.width:, :] = der[:, None, :]
    lienzo[:, x0:x0 + foto.width, :] = a
    for i in range(fundido):
        t = i / fundido
        lienzo[:, x0 + i, :] = a[:, i, :] * t + izq * (1 - t)
        if margen:
            j = foto.width - 1 - i
            lienzo[:, x0 + j, :] = a[:, j, :] * t + der * (1 - t)
    Image.fromarray(lienzo.clip(0, 255).astype('uint8')).save(destino, 'WEBP', quality=90, method=6)
    print(destino, ancho, 'x', alto, '· color pared', izq[alto // 4].round())


if __name__ == '__main__':
    banner(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]) if len(sys.argv) > 5 else 0)
