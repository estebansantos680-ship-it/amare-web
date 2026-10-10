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
| `TEMPLATE_recordatorio` | Recordatorio 1 día antes (`emails/recordatorio.html`) |
| `TEMPLATE_recordatorio3d` | Recordatorio 3 días antes (`emails/recordatorio-3dias.html`; crear el template en EmailJS) |

## WhatsApp automático (Cloud API de Meta)
Propiedades `WHATSAPP_TOKEN` (token permanente de un usuario del sistema) y `WHATSAPP_PHONE_ID` (ID del número).
Sin ellas el WhatsApp no sale y el panel lo indica; los correos siguen igual. Plantillas que deben estar aprobadas en
Meta (idioma `es`, parámetros en este orden): `reserva_confirmada`, `reserva_en_revision`, `cita_actualizada`,
`recordatorio_3_dias`, `recordatorio_1_dia` → ver `CONFIG.WHATSAPP_API`. Requisitos: `_interno/WhatsApp-API-requisitos.md`.

Además, **`EMAILJS_PRIVATE_KEY`** = Private Key de EmailJS (Account → API keys). Es obligatoria porque la cuenta
tiene "strict mode"; sin ella EmailJS responde 403 y no sale ningún correo a la clienta. Para diagnosticar,
ejecutar `probarCorreo` desde el editor: envía la última reserva a facturas@ y deja el error en el registro.

Si una propiedad está vacía se usa el valor de `CONFIG.EMAILJS.templates`; si ambos están vacíos, ese correo no se envía.
El HTML de cada template está en `/emails` (se genera con `tools/generar_correos.py`).
En cada template: To Email `{{correo}}`, From Name `Amarë Beauty Center`, Reply To `citas@amarecr.com`
(alias de facturas@ en Google Workspace).

## Reglas de disponibilidad
- Domingo y lunes cerrados para la web. Se puede reservar en línea hasta el 31/12/2030 (`FECHA_MAX` en `js/booking.js`).
- La clienta elige la **hora de inicio** (9:00, 13:00 o 15:00 según el servicio: campo `horas` de `js/services-data.js`,
  columna V del Blueprint). El servidor valida que la hora esté en `CONFIG.HORAS_INICIO`.
- Cada reserva ocupa espacio desde que entra, desde su hora de inicio y con su duración estimada; un servicio de más
  de 4 h ocupa las dos franjas y solo se ofrece si ambas tienen espacio. Las horas de hoy que ya pasaron no se ofrecen.
- **Espacio bloqueado** (panel → Bloquear): evento gris "Espacio bloqueado…" en Calendar, por horas o días completos.
  Cierra en la web las franjas que toca, sin avisos a nadie. Se quita desde la Agenda.
- Cupo por FRANJA: mañana (00:00–11:59) y tarde (12:00–23:59) se llenan por separado al llegar a
  `TOPE_DIA` citas (4) o `LIMITE_HORAS_DIA` horas (6) dentro de cada una (editables en el panel: Agenda → Ajustes).
  Cuentan todos los eventos con hora de Google Calendar y las reservas web sin hora (ubicadas a las 9:00 o 13:00
  con su duración estimada). Una cita que cruza las 12:00 cuenta como cita en ambas y sus horas se reparten.
  El día completo se cierra solo si las dos franjas están cerradas.
- Disponibilidad manual por día o franja (panel → botón Disponibilidad): Bloquear / Abrir / Automático
  (propiedad DISPONIBILIDAD_MANUAL).
- Matriz por categoría: pestaña **Reglas** de la hoja "Amarë · Reservas" (copiada del Blueprint la primera vez).
  Si el día ya tiene las categorías "Existente 1-3" y alguien pide la "Solicitado":
  - **No permitir** → ese servicio se cierra ese día (franja o día completo).
  - **Requiere aprobación** → se acepta como solicitud (la reserva que completa la combinación, en cualquier orden),
    la clienta ve el aviso y queda en la pestaña "Requiere aprobación" del panel hasta que el salón la apruebe.
  Se edita directamente en la hoja; no hay que volver a publicar.
- El admin puede superponer citas al agendar; los bloqueos solo afectan la reserva en línea.

## Estados y pestañas del panel
Ya no hay validación de pagos (el comprobante se sigue pidiendo y queda adjunto en la reserva).
- Web, matriz "Permitir" → `cita_confirmada` al instante: se agenda en Calendar a la hora elegida con la duración
  estimada y se le confirma a la clienta (WhatsApp + correo). Queda en **Por agendar** (columna `revisada` vacía) para
  que el salón ajuste la duración real: cambiar solo la hora de fin no avisa; cambiar fecha o inicio sí avisa.
  "Horario correcto" la pasa a **Confirmadas** sin cambios.
- Web, matriz "Requiere aprobación" → `requiere_aprobacion` (pestaña **Requiere aprobación**); al aprobar se agenda a la
  hora pedida y se le confirma; "No aprobar" la cancela sin aviso (se le escribe por WhatsApp).
- **+ Cita** (cita manual): servicio, datos opcionales de la clienta, fecha, hora y duración; bloquea Calendar, queda en
  la hoja (`origen` = manual) y recibe los mismos recordatorios; confirmación por WhatsApp y/o correo opcional.
- Recordatorios automáticos 3 días y 1 día antes (WhatsApp + correo), disparador cada 15 min.
- Las clientas no pueden cancelar ni reagendar solas: se coordina por WhatsApp con el salón.
- `completada` / `no_asistio` / `cancelada` → **Historial**. Las confirmadas pasan solas a `completada` al terminar.
- Estados anteriores (`pago_por_validar`, `pago_aprobado`, `cita_agendada`, `dia_saturado`) siguen funcionando para
  reservas viejas. "Eliminar" solo oculta: la fila queda con estado `eliminada`.
- Búsqueda por nombre, correo, teléfono o fecha en cada pestaña, e "Historial de la clienta" en cada tarjeta.
