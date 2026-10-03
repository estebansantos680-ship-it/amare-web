# Sistema de citas · Apps Script

Proyecto: **Amarë Reservas** (script.google.com, cuenta facturas@amarecr.com).

## Archivos
- `Codigo.gs` — servidor: reservas, disponibilidad, panel, correos, Calendar, recordatorios.
- `Panel.html` — panel de administración.
- `appsscript.json` — zona horaria y permisos.

## Instalación desde cero
1. Crear el proyecto en script.google.com con facturas@ y pegar los 3 archivos
   (para ver `appsscript.json`: Configuración del proyecto → "Mostrar el archivo de manifiesto").
2. Ejecutar `instalar` una vez y autorizar. Crea la hoja "Amarë · Reservas", la carpeta
   "Amarë · Comprobantes de pago" y el disparador de `enviarRecordatorios` (cada 15 minutos).
3. Implementar → Nueva implementación → Aplicación web, **dos veces**:
   - **API pública**: ejecutar como "Yo", acceso "Cualquiera". Su URL va en `API_URL` de `js/booking.js`.
   - **Panel**: ejecutar como "Yo", acceso "Solo yo". Su URL va en `CONFIG.PANEL_URL` y en `admin.html`.

## Actualizar el código
Pegar el código nuevo → Guardar → Implementar → Administrar implementaciones → lápiz →
Versión: "Nueva versión" → Implementar. Hacerlo en **las dos** implementaciones.

## Templates de EmailJS
En Configuración del proyecto → Propiedades del script se pueden poner los IDs sin volver a implementar:

| Propiedad | Correo |
|---|---|
| `TEMPLATE_solicitud` | Solicitud recibida (por defecto `template_nrvafoo`) |
| `TEMPLATE_pagoAprobado` | Depósito validado |
| `TEMPLATE_pagoRechazado` | No pudimos validar su pago |
| `TEMPLATE_citaConfirmada` | Cita confirmada |
| `TEMPLATE_diaSaturado` | Coordinemos otra fecha |
| `TEMPLATE_recordatorio` | Recordatorio 24 h antes |

Además, **`EMAILJS_PRIVATE_KEY`** = Private Key de EmailJS (Account → API keys). Es obligatoria porque la cuenta
tiene "strict mode"; sin ella EmailJS responde 403 y no sale ningún correo a la clienta. Para diagnosticar,
ejecutar `probarCorreo` desde el editor: envía la última reserva a facturas@ y deja el error en el registro.

Si una propiedad está vacía se usa el valor de `CONFIG.EMAILJS.templates`; si ambos están vacíos, ese correo no se envía.
El HTML de cada template está en `/emails` (se genera con `tools/generar_correos.py`).
En cada template: To Email `{{correo}}`, From Name `Amarë Beauty Center`, Reply To `facturas@amarecr.com`.

## Reglas de disponibilidad
- Domingo y lunes cerrados para la web. Se puede reservar en línea hasta el 31/12/2030 (`FECHA_MAX` en `js/booking.js`).
- Cada reserva ocupa espacio desde que entra (pago por validar, aprobado, agendada o confirmada).
- Tope de seguridad: `CONFIG.TOPE_DIA` (6) reservas por día, sin importar la franja.
- Matriz por categoría: pestaña **Reglas** de la hoja "Amarë · Reservas" (copiada del Blueprint la primera vez).
  Si el día ya tiene las categorías "Existente 1-3" y alguien pide la "Solicitado":
  - **No permitir** → ese servicio se cierra ese día (franja o día completo).
  - **Requiere aprobación** → se acepta, la clienta ve el aviso y el panel la marca "Requiere aprobación".
  Se edita directamente en la hoja; no hay que volver a publicar.
- El admin puede superponer citas al agendar; los bloqueos solo afectan la reserva en línea.

## Estados
pago_por_validar → pago_aprobado → cita_agendada → cita_confirmada → completada / no_asistio
(rechazada, día saturado, cancelada). "Eliminar" en el panel solo oculta: la fila queda con estado `eliminada`.
Las citas confirmadas pasan solas a `completada` al terminar (disparador cada 15 min).
