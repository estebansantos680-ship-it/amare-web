"""Banner "Tu momento Amarë" del inicio: la foto 2.11 (fondo rosado) con fondo color crema.
Separa a las personas con rembg (modelo birefnet-portrait) y las pone sobre un degradado crema de la página.
Uso: python tools/fondo_crema_cta.py   →  assets/media/inicio-cta-crema.webp"""
import os
from PIL import Image, ImageOps, ImageFilter
from rembg import remove, new_session

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGEN = os.path.join(RAIZ, 'imagenes', 'Imagenes cliente', '2.11.jpg')
DESTINO = os.path.join(RAIZ, 'assets', 'media', 'inicio-cta-crema.webp')

im = ImageOps.exif_transpose(Image.open(ORIGEN)).convert('RGB')
recorte = remove(im, session=new_session('birefnet-portrait'))
alfa = recorte.split()[3].point(lambda v: 0 if v < 40 else (255 if v > 215 else int((v - 40) * 255 / 175)))

# Fondo crema (los mismos tonos del sitio), un poco más claro arriba a la izquierda
w, h = im.size
fondo = Image.new('RGB', (w, h), (243, 236, 225))
luz = Image.radial_gradient('L').resize((w * 2, h * 2)).crop((w // 2, h // 2, w // 2 + w, h // 2 + h))
fondo = Image.composite(fondo, Image.new('RGB', (w, h), (251, 248, 243)), luz)
# Sombra suave bajo las personas para que no se vean "pegadas"
sombra = alfa.filter(ImageFilter.GaussianBlur(18)).point(lambda v: int(v * 0.22))
fondo = Image.composite(Image.new('RGB', (w, h), (190, 170, 145)), fondo, sombra)
fondo.paste(im, (0, 0), alfa)
# Restos del rosado que el modelo dejó como "persona" (abajo, entre el cabello y el hombro, en sombra):
# se pasan a crema con la misma luz. El rosado se distingue de la piel porque azul ≈ verde (la piel tiene menos azul).
px, ori = fondo.load(), im.load()
CREMA = (243, 236, 225)
for y in range(940, h):
    for x in range(420, 600):
        r, g, b = ori[x, y]
        if r > 120 and r - g > 35 and abs(b - g) <= 7:
            k = min(1.0, (0.3 * r + 0.59 * g + 0.11 * b) / 214.0)
            px[x, y] = tuple(int(c * k) for c in CREMA)
fondo.save(DESTINO, 'WEBP', quality=86, method=6)
fondo.resize((w * 600 // h, 600)).save(os.path.join(os.environ.get('TEMP', '.'), 'inicio-cta-previa.jpg'))
print('ok', fondo.size)
