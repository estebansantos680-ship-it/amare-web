# Cómo publicar el sitio de Amarë Beauty Center

- **Dirección pública:** https://amarecr.com
- **Repositorio:** https://github.com/estebansantos680-ship-it/amare-web
- **Hosting:** GitHub Pages (rama `main`, carpeta raíz)
- **Dominio:** amarecr.com, comprado y administrado en Cloudflare

---

## 1. Flujo de cada lanzamiento

1. Hacer los cambios (o pedírselos a Claude).
2. Si cambiaste el menú, el pie de página, la dirección o los horarios, edítalos en `_partials/` y luego corre:
   ```
   python tools/sync_layout.py
   ```
3. Revisar el sitio en local:
   ```
   python -m http.server 5500
   ```
   y abrir http://localhost:5500
4. Guardar y publicar:
   ```
   git add -A
   git commit -m "Describe el cambio"
   git push
   ```
5. En 1–2 minutos el cambio está en https://amarecr.com (recarga con `Ctrl + F5`).

Cada `git commit` queda registrado con fecha y descripción: es el historial de lanzamientos.
Para ver el historial: `git log --oneline`.

---

## 2. Estructura del proyecto

| Carpeta / archivo | Para qué sirve |
|---|---|
| `*.html` | Las páginas del sitio |
| `css/style.css` | Diseño: colores y tipografías de la guía de marca |
| `js/main.js` | Menú móvil, animaciones y videos |
| `js/booking.js`, `js/services-data.js` | Simulador de reservas y catálogo de servicios |
| `assets/images/` | Fotos (WebP optimizado) |
| `assets/video/` | Videos cortos en loop (MP4, sin audio) + portadas |
| `_partials/` | Header y footer comunes (se copian con `tools/sync_layout.py`) |
| `tools/` | Scripts de mantenimiento |
| `CNAME` | Conecta GitHub Pages con amarecr.com. **No borrar.** |
| `sitemap.xml`, `robots.txt` | Para Google |

Los documentos internos (Excel, PDF, capturas) están en `.gitignore` y **no** se suben: el repositorio es público.

---

## 3. Dominio amarecr.com en Cloudflare

En **dash.cloudflare.com → amarecr.com → DNS → Records**, todos en modo **DNS only** (nube gris, sin proxy naranja):

| Tipo | Nombre | Valor |
|---|---|---|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |
| AAAA | @ | 2606:50c0:8000::153 |
| AAAA | @ | 2606:50c0:8001::153 |
| AAAA | @ | 2606:50c0:8002::153 |
| AAAA | @ | 2606:50c0:8003::153 |
| CNAME | www | estebansantos680-ship-it.github.io |

Copia importable: `dns-github-pages.txt` (Cloudflare → DNS → Import and Export → Import).

En GitHub: **Settings → Pages** → Source: *Deploy from a branch*, rama `main`, carpeta `/ (root)`;
Custom domain: `amarecr.com`. Cuando GitHub emita el certificado, marcar **Enforce HTTPS**.

**Renovación:** dejar activa la renovación automática del dominio en Cloudflare.

---

## 4. Reservas y correo facturas@amarecr.com

- Cada reserva confirmada en `reservar.html` hace dos cosas: abre WhatsApp con el resumen y envía un correo
  automático (vía [FormSubmit](https://formsubmit.co), ya activado) a **facturas@amarecr.com**.
- El cliente recibe una copia de agradecimiento con el resumen (FormSubmit `_autoresponse`, solo texto).
- La tabla del correo trae la fecha también en formato `AAAA-MM-DD` para la futura automatización con Google Calendar.
- **facturas@amarecr.com es un reenvío, no un buzón:** Cloudflare → Email Routing lo reenvía a
  `estebansantos680@gmail.com`. No tiene contraseña ni bandeja propia.
- **Pendiente (decisión del cliente):** pasar a un buzón real con Google Workspace (recomendado por la integración con
  Calendar) o a un Gmail propio del negocio. Al cambiar:
  - Workspace/Zoho: agregar sus registros MX en Cloudflare y **desactivar Email Routing** (no pueden convivir).
  - Gmail del negocio: solo cambiar el destino en Cloudflare → Email Routing → Routing rules.
  - El sitio no cambia en ningún caso.

---

## 5. Créditos de fotos y videos

Fotos de [Unsplash](https://unsplash.com/license) y videos de [Pexels](https://www.pexels.com/license/):
uso comercial gratuito, sin atribución obligatoria. Reemplazar por fotos reales del estudio cuando estén disponibles.
