# Tarjeta "Alisamientos" del inicio: imagenes/IMG_0328.jpg enfocada en el cabello (cabeza y puntas completas),
# sin los esmaltes ni la puerta (la franja izquierda se rellena con el tono de la pared).
import sys
from PIL import Image, ImageOps, ImageFilter
S=sys.argv[1] if len(sys.argv) > 1 else "./"  # carpeta para una copia PNG de revisión
im=ImageOps.exif_transpose(Image.open('imagenes/IMG_0328.jpg')).convert('RGB'); k=1536/600
x0,y0,x1,y1=[round(v*k) for v in (108,84,603,744)]
c=im.crop((x0,y0,x1,y1)).resize((600,800),Image.LANCZOS)
# Muestra de la pared blanca limpia (x 60-68) → tono por fila, muy suavizado
col=c.crop((64,0,72,470)).resize((1,470),Image.BOX).filter(ImageFilter.GaussianBlur(25))
relleno=col.resize((76,470),Image.BILINEAR)
mask=Image.new("L",(76,470),255)
g=Image.linear_gradient('L').rotate(90).resize((16,470)); mask.paste(g,(60,0))  # se funde hacia la derecha
v=Image.linear_gradient('L').resize((76,60)).point(lambda p:255-p); 
base=mask.crop((0,410,76,470)); mask.paste(Image.composite(base,Image.new("L",(76,60),0),v),(0,410))  # se funde hacia abajo
c.paste(relleno,(0,0),mask)
c.save(S+'liso_limpio.png'); c.save('assets/media/inicio-alisamientos.webp','WEBP',quality=86,method=6)
