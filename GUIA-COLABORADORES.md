# Guía para colaboradores — sitio de Amarë Beauty Center

Bienvenido 👋 Esta guía explica cómo está armado el sitio **amarecr.com**, cómo correrlo en tu compu y cómo hacer
los cambios más comunes (textos, fotos, videos, servicios, estilos) sin romper nada.

> ⚠️ **Lo más importante:** la rama `main` está **en vivo**. Todo lo que llegue a `main` se publica en amarecr.com
> en 1–2 minutos, y el salón ya lo usa con clientas reales (reservas, panel, correos y WhatsApp).
> **Nunca trabajes directo en `main`:** usa una rama y abre un Pull Request para que Esteban lo revise.

---

## 1. Preparar tu compu (una sola vez)

1. Instala **Git** y **Python 3.10+**.
2. Clona el repositorio:
   ```
   git clone https://github.com/estebansantos680-ship-it/amare-web.git
   cd amare-web
   ```
3. Librerías para las herramientas de fotos y videos (opcional, solo si vas a procesar medios):
   ```
   pip install pillow imageio-ffmpeg
   ```
4. Correr el sitio en local:
   ```
   python -m http.server 5500
   ```
   y abrir **http://localhost:5500**. No hay que compilar nada: es HTML, CSS y JavaScript puro.

---

## 2. Cómo trabajar (cada cambio)

```
git checkout main
git pull                                  # traer lo último
git checkout -b cambio/descripcion-corta  # tu rama, ej. cambio/fotos-inicio
```

1. Haz los cambios y revísalos en http://localhost:5500 (en compu **y** en celular: el navegador tiene modo móvil con F12).
2. Si cambiaste el menú, el pie de página, la dirección o los horarios → edita `_partials/` y corre:
   ```
   python tools/sync_layout.py
   ```
3. **Siempre antes de subir** (para que los navegadores no muestren la versión vieja de CSS/JS):
   ```
   python tools/bump_version.py
   ```
4. Guardar y subir tu rama:
   ```
   git add -A
   git commit -m "Qué cambiaste, en una línea"
   git push -u origin cambio/descripcion-corta
   ```
5. En GitHub abre un **Pull Request** hacia `main` con una descripción y, si puedes, capturas de antes/después.
   Esteban lo revisa y lo publica.

---

## 3. Cómo está organizado

| Carpeta / archivo | Qué es |
|---|---|
| `index.html`, `sobre-nosotros.html`, `servicios.html`, `servicios-*.html`, `productos.html`, `valores.html`, `reservar.html` | Las páginas |
| `_partials/` | Header, footer y guía de largos **compartidos**. Se editan aquí y `tools/sync_layout.py` los copia a todas las páginas |
| `css/style.css` | Todo el diseño. Colores y tipografías en las variables de `:root` al inicio |
| `js/main.js` | Menú, animaciones, carruseles de fotos, videos |
| `js/booking.js` | El formulario de reserva (`reservar.html`) |
| `js/services-data.js` | Lista de servicios con precios por largo y duraciones (la usan la reserva y el panel) |
| `js/precios.js` | Aplica en la web los precios y descuentos que el salón cambia desde el panel |
| `assets/media/`, `assets/images/` | Fotos optimizadas (WebP) |
| `assets/video/` | Videos optimizados (MP4/WebM + póster) |
| `assets/wa/`, `assets/email/` | Imágenes de los mensajes de WhatsApp y correos |
| `emails/` | Plantillas HTML de los correos (EmailJS) |
| `apps-script/` | Código del **servidor de reservas** (Google Apps Script) y del panel del salón |
| `tools/` | Scripts de Python: sincronizar layout, versión, fotos, videos, correos |

**No está en el repo** (pídeselo a Esteban si lo necesitas): las fotos y videos originales del cliente
(carpeta `imagenes/`), los documentos internos y las cuentas (Google, Meta/WhatsApp, EmailJS, Cloudflare).

---

## 4. Recetas para los cambios más comunes

### Cambiar un texto
Busca el texto en el `.html` de la página (Ctrl+F en tu editor) y cámbialo ahí. Si el texto está en el header o el
footer, cámbialo en `_partials/` y corre `python tools/sync_layout.py`.

### Cambiar una foto
Opción rápida (con una foto ya lista):
1. Prepara la foto en **WebP**, con la **misma proporción** que la que reemplazas (mira `width` y `height` en la
   etiqueta `<img>`; por ejemplo 600×800 = vertical 3:4). Ancho recomendado: 600–900 px para tarjetas,
   1600–2000 px para banners anchos. Pesa idealmente menos de 200 KB.
   Para convertir: https://squoosh.app (calidad 80–85) o con Python:
   ```
   python -c "from PIL import Image; Image.open('foto.jpg').convert('RGB').save('foto.webp', quality=84)"
   ```
2. Guárdala en `assets/media/` con un **nombre nuevo** (por ejemplo `inicio-color-2.webp`). Con un nombre nuevo,
   todos los navegadores la descargan; si reutilizas el nombre viejo, algunos seguirán mostrando la foto anterior.
3. En el `.html`, cambia el `src="..."` de la `<img>` (y `width`/`height` si cambió el tamaño) y actualiza el `alt`
   (descripción corta de la foto, sirve para accesibilidad y Google).

Opción con los originales del cliente: `tools/procesar_medios_cliente.py` toma las fotos de `imagenes/` (no está en
el repo) y genera las versiones web recortadas. Cada foto está en el diccionario `FOTOS` del script con su
proporción y su punto de enfoque. Corre `python tools/procesar_medios_cliente.py fotos`.

> Si una foto se ve cortada (cabeza o puntas del cabello), el recorte se ajusta con `object-position` en el CSS o con
> el `foco` en `FOTOS`. Las tarjetas con clase `motion` tienen un zoom animado suave: deja un poco de aire arriba y abajo.

### Cambiar un video
Los videos van en `assets/video/` en dos formatos (`.webm` y `.mp4`) más un póster `-poster.webp`.
Los sin sonido se generan con `python tools/procesar_medios_cliente.py mudos` (diccionario `MUDOS`) y los con sonido
con `... sonido` (diccionario `CON_SONIDO`). Si haces uno a mano: MP4 H.264, 720 px de ancho para tarjetas, sin audio
si es de fondo, menos de 5 MB.

### Cambiar dirección, horarios, teléfono o redes
Están en `_partials/footer.html` y `_partials/header.html` → luego `python tools/sync_layout.py`.
El servidor también tiene la dirección para los mensajes (`apps-script/Codigo.gs`, `CONFIG`): avísale a Esteban.

### Servicios (nombres, descripciones, precios base)
Cada servicio aparece en **dos lugares** que deben coincidir **exactamente** (mismo nombre, con tildes):
1. La tarjeta en su página `servicios-<categoría>.html` (`<article class="service-card">`).
2. `js/services-data.js` (lo usan la reserva y el panel).

Si cambias el nombre de un servicio, cámbialo en los dos. Para **precios y descuentos del día a día no hace falta
tocar código**: el salón los cambia desde el panel (botón **Precios**) y la web los aplica sola.

### Colores, tipografías y estilos
En `css/style.css`. Los colores de marca están como variables al inicio (`--black`, `--cream`, `--taupe`, …):
úsalas en vez de escribir colores nuevos. Los bloques nuevos se agregan al **final** del archivo con un comentario
que diga para qué son.

### Agregar una página nueva
Copia una página parecida, cambia `<title>`, la descripción y el contenido. Agrégala en `ACTIVE` dentro de
`tools/sync_layout.py`, en el menú (`_partials/header.html`) y en `sitemap.xml`. Luego `sync_layout.py`.

### Correos a las clientas
Las plantillas están en `emails/` y se generan con `python tools/generar_correos.py`. Se pegan a mano en EmailJS
(lo hace Esteban), así que cambiar el archivo no cambia el correo hasta que se publique allá.

### Servidor de reservas y panel (`apps-script/`)
Es el backend: recibe reservas, agenda en Google Calendar, manda correos y WhatsApp, y sirve el panel del salón.
**Corre en la cuenta de Google del salón**, así que subir cambios a GitHub **no** lo actualiza: Esteban lo publica.
- Puedes proponer cambios en `apps-script/Codigo.gs` y `apps-script/Panel.html` en tu Pull Request.
- No cambies nombres de columnas, de estados ni de campos que manda `js/booking.js`: rompería reservas reales.
- Nunca pongas contraseñas, tokens ni llaves en el código: van en las propiedades del proyecto de Apps Script.

---

## 5. Antes de abrir el Pull Request

- [ ] Lo revisé en local en compu y en celular.
- [ ] No hay errores en la consola del navegador (F12 → Console).
- [ ] Probé `reservar.html` si toqué algo de servicios, `booking.js` o estilos generales (sin enviar una reserva real).
- [ ] Corrí `python tools/bump_version.py` (y `sync_layout.py` si toqué `_partials/`).
- [ ] Las fotos nuevas están en WebP, con nombre nuevo y pesan poco.
- [ ] No subí fotos originales, documentos internos, contraseñas ni tokens.

## 6. Problemas comunes

- **"No veo mi cambio"** → caché del navegador: `Ctrl + F5`. Para fotos, usa un nombre de archivo nuevo.
- **El menú o el footer quedó distinto en una página** → se editó a mano: corrige `_partials/` y corre `sync_layout.py`.
- **La reserva no muestra un servicio o su precio** → el nombre no coincide entre la página y `js/services-data.js`.

¿Dudas? Escríbele a Esteban antes de tocar algo del servidor, del panel o de la reserva.
