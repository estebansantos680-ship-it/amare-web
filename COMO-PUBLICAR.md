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

- Cada reserva confirmada en `reservar.html` abre WhatsApp con el resumen y envía **dos correos**:
  1. **Negocio → facturas@amarecr.com** vía [FormSubmit](https://formsubmit.co) (gratis, sin límite): pedido completo +
     campo `datos_json` para la automatización en Python → Google Calendar.
  2. **Cliente** vía [EmailJS](https://dashboard.emailjs.com) (plan gratis: 200 envíos/mes): correo con diseño de la
     plantilla `emails/confirmacion-cliente.html`. IDs en `js/booking.js` (objeto `EMAILJS`).
     Si EmailJS falla o se acaba la cuota, se envía un respaldo de texto por FormSubmit a través de
     `confirmaciones@amarecr.com` (alias de facturas@).
- **Depósito y comprobante (27-sep-2026):** regla Pendientes P-001 (₡25.000–59.999 → ₡15.000; ₡60.000+ → ₡25.000;
  menos de ₡25.000 sin depósito). El cliente ve SINPE 8807-3849 / IBAN CR79010200009718091249 y debe adjuntar
  comprobante JPG/PNG/PDF para confirmar.
  - **PENDIENTE:** el correo con el comprobante adjunto aún no llega de forma confiable. Hallazgos: FormSubmit
    solo conserva archivos en `https://formsubmit.co/facturas@amarecr.com` (no en `/ajax/`), el campo debe llamarse
    `attachment`, rechaza cualquier carácter no ASCII y descarta envíos desde fetch o iframe; con formulario real
    en la página sí llegó en pruebas simples, pero el envío completo desde la reserva no llegó y `_next` con
    `?reserva=enviada` no redirigió. Mientras tanto el pedido también se envía por AJAX (sin adjunto) como respaldo.
  - Alternativa a evaluar: enviar el comprobante vía EmailJS (plan pago admite adjuntos) o subirlo a Google Drive.
- Si cambias el diseño del correo del cliente: edita `emails/confirmacion-cliente.html` y pégalo de nuevo en
  EmailJS → Email Templates → template_nrvafoo.
- **El correo del dominio está en Google Workspace** (buzón real `facturas@amarecr.com`, se entra por gmail.com).
  Cloudflare Email Routing fue desactivado. DNS de correo en Cloudflare:
  - `MX @ → smtp.google.com` (prioridad 1)
  - `TXT @ → v=spf1 include:_spf.google.com ~all`
  - `TXT @ → google-site-verification=...` (no borrar)
- `confirmaciones@amarecr.com` solo sirve para disparar el correo al cliente: debe existir como **alias** de facturas@ en
  Workspace, con un filtro de Gmail que elimine lo que llegue a esa dirección.
- Pendiente recomendado: activar **DKIM** en Admin de Workspace (Apps → Gmail → Autenticar correo) y agregar el TXT que dé Google.

---

## 5. Créditos de fotos y videos

Fotos de [Unsplash](https://unsplash.com/license) y videos de [Pexels](https://www.pexels.com/license/):
uso comercial gratuito, sin atribución obligatoria. Reemplazar por fotos reales del estudio cuando estén disponibles.
