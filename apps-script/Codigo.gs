/**
 * AMARË Beauty Center — Servidor de reservas (Google Apps Script)
 * Corre con la cuenta facturas@amarecr.com.
 *
 * Qué hace:
 *  - Recibe cada reserva del sitio (doPost): la guarda en la hoja "Reservas", guarda el comprobante y las
 *    fotos del cabello en Drive y avisa al salón. Si la matriz dice "Permitir", la cita se agenda sola en
 *    Google Calendar a la hora elegida (9:00, 13:00 o 15:00) con la duración estimada y la clienta recibe la
 *    confirmación (correo + WhatsApp). Si dice "Requiere aprobación", queda en esa pestaña del panel.
 *  - Publica la ocupación de cada día (doGet ?accion=disponibilidad) y la matriz de
 *    reglas (pestaña "Reglas" de la hoja) para que la reserva en línea cierre lo lleno.
 *  - Sirve el panel de administración (doGet sin parámetros), solo para
 *    facturas@amarecr.com con sesión de Google.
 *  - Envía recordatorios 3 días y 1 día antes de cada cita confirmada (disparador cada 15 min).
 *
 * Ciclo de estados (desde 10-oct-2026 ya no hay validación de pago antes de confirmar):
 *   web "Permitir"            → cita_confirmada (revisada vacía = "Por agendar") → revisada → completada / no_asistio
 *   web "Requiere aprobación" → requiere_aprobacion → (aprobar) cita_confirmada / dia_saturado / cancelada
 *   cita manual del panel     → cita_confirmada (revisada)
 *   Estados antiguos (pago_por_validar, pago_aprobado, cita_agendada) se siguen mostrando y se pueden agendar.
 *   Cualquiera puede pasar a cancelada o eliminada (eliminada solo se oculta; la fila queda).
 *
 * Instalación: ver apps-script/INSTALAR.md
 */

// ------------------------------------------------------------------ Config
var CONFIG = {
  ADMIN_EMAIL: 'facturas@amarecr.com',   // cuenta dueña del sistema (inicio de sesión del panel)
  CORREO_CITAS: 'citas@amarecr.com',     // correo visible para clientas (alias de la cuenta del salón)
  // Publicación "Panel admin" (acceso: solo facturas@). La otra publicación es la API pública.
  PANEL_URL: 'https://script.google.com/a/macros/amarecr.com/s/AKfycbyNGq-K0H7scCaGoJwNtsLFgL7YcKL2q4UHhXm9V01VIWo0rPPoyQJQKNrd1sJ2vLVM/exec',
  ZONA: 'America/Costa_Rica',
  // Valores por defecto de los ajustes que el admin cambia desde el panel (Agenda → Ajustes):
  TOPE_DIA: 4,                 // citas por FRANJA que la cierran en la web (mañana 00:00–11:59, tarde 12:00–23:59)
  LIMITE_HORAS_DIA: 6,         // horas ocupadas por FRANJA que la cierran en la web
  CORTE_FRANJA: 12,            // la mañana termina a las 12:00 y empieza la tarde
  HORAS_SIN_DURACION: 2,       // horas que se asumen para una reserva web sin duración conocida
  FECHA_MAX: '2030-12-31',     // último día reservable en línea (igual que js/booking.js)
  DIAS_CERRADOS: [0, 1],       // domingo y lunes
  HORA_MANANA: [9, 13],        // la mañana va de 9:00 a 13:00
  HORA_TARDE: [13, 18],        // la tarde de 13:00 a 18:00
  HORAS_SERVICIO_LARGO: 4,     // > 4 h ocupa mañana y tarde
  DIAS_DISPONIBILIDAD: 120,
  DIRECCION: 'Calle 42, San José, Santa Ana, Costa Rica',
  SENALES: 'LOCAL COLOR BLANCO a mano izquierda, contiguo a Minisuper AMD, antes del reductor de velocidad.',
  HORAS_INICIO: [9, 13, 15],   // horas de inicio que puede ofrecer la web (cada servicio dice cuáles, ver js/services-data.js)
  MAX_FOTOS: 4,                // fotos del cabello por reserva
  WAZE: 'https://waze.com/ul?ll=9.9252005,-84.1987&navigate=yes',
  MAPS: 'https://maps.google.com/maps/search/Amare%20Beauty%20Center/@9.925200462341309,-84.19869995117188,17z',
  WHATSAPP: 'https://wa.me/50688073849',
  EMAILJS: {
    serviceId: 'service_q9qzz65',
    publicKey: 'Yrbk48Pzaxg_eptQn',
    // IDs de los templates (EmailJS → Email Templates). Vacío = no se envía.
    // También se pueden poner en Configuración del proyecto → Propiedades de la
    // secuencia de comandos como TEMPLATE_pagoAprobado, etc. (tienen prioridad y
    // no requieren volver a publicar).
    templates: {
      solicitud: 'template_nrvafoo',   // 1. Solicitud recibida (ya existe)
      pagoAprobado: 'template_bore1yc',   // 2. Pago confirmado
      pagoRechazado: 'template_irdtu34',  // 3. Pago rechazado
      citaConfirmada: 'template_idaj1xg', // 4. Cita confirmada
      diaSaturado: 'template_17lidvh',    // 5. Día saturado
      recordatorio: 'template_36l8drt',   // 6. Recordatorio 24 h
      recordatorio3d: ''                  // 7. Recordatorio 3 días (crear en EmailJS; vacío = solo WhatsApp)
    }
  },
  // WhatsApp Business Platform (Cloud API de Meta). Token e ID del número van en Propiedades del script:
  // WHATSAPP_TOKEN y WHATSAPP_PHONE_ID. Sin ellos no se envía nada (y el panel ofrece el botón manual).
  WHATSAPP_API: {
    version: 'v21.0',
    idioma: 'es',
    // plantilla → orden de las variables {{1}}, {{2}}… (deben coincidir con las plantillas aprobadas en Meta)
    // Solo las plantillas creadas y aprobadas en Meta (crearPlantillasWhatsApp). Las demás no se envían por WhatsApp.
    plantillas: {
      reserva_confirmada: ['fecha_dia', 'hora', 'servicio', 'inversion'],
      recordatorio_1_dia: ['hora']
    },
    // Encabezado de todas las plantillas: logo de Amarë (tools/generar_whatsapp_headers.py → assets/wa/logo.jpg)
    imagen: 'https://amarecr.com/assets/wa/logo.jpg',
    appId: '2406232719906991'
  }
};

var ESTADOS = {
  PAGO_POR_VALIDAR: 'pago_por_validar',
  PAGO_APROBADO: 'pago_aprobado',
  PAGO_RECHAZADO: 'pago_rechazado',
  DIA_SATURADO: 'dia_saturado',
  CITA_AGENDADA: 'cita_agendada',     // ya está en Google Calendar, falta confirmarle a la clienta
  CITA_CONFIRMADA: 'cita_confirmada',
  REQUIERE_APROBACION: 'requiere_aprobacion',  // la matriz pidió revisión del salón antes de agendar
  CANCELADA: 'cancelada',
  COMPLETADA: 'completada',           // la cita ya pasó (automático al terminar o manual)
  NO_ASISTIO: 'no_asistio',
  ELIMINADA: 'eliminada'              // oculta del panel; la fila se conserva en la hoja
};

/** Reservas que ocupan espacio en el día (desde que entran, aunque el pago no esté validado). */
var ESTADOS_ACTIVOS = ['pago_por_validar', 'pago_aprobado', 'cita_agendada', 'cita_confirmada', 'requiere_aprobacion'];

/**
 * Matriz inicial de reglas (AMARE_Blueprint_AppCitas.xlsx → Reglas_Operativas).
 * Se copia una sola vez a la pestaña "Reglas" de la hoja; desde ahí el salón la edita sin tocar código.
 * [existente 1, existente 2, existente 3, solicitado, franja, acción, mensaje para la clienta]
 * Lectura: si el día ya tiene las categorías existentes y alguien pide la "solicitada":
 *   No permitir → se cierra ese servicio ese día · Requiere aprobación → se acepta, sujeto a validación.
 */
var REGLAS_INICIALES = [
  ["Técnica de Color", "Alisamientos Capilares", "Alisamientos Capilares", "Alisamientos Capilares", "Mañana", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Alisamientos Capilares", "Alisamientos Capilares", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Color Parejo", "Color Parejo", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Cirugia Capilar", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Corte de cabello", "Corte de cabello", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Tratamientos Capilares", "Corte de cabello", "Mañana", "Permitir", ""],
  ["Técnica de Color", "Alisamientos Capilares", "Color Parejo", "Color Parejo", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Cirugia Capilar", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Corte de cabello", "Corte de cabello", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Alisamientos Capilares", "Tratamientos Capilares", "Corte de cabello", "Tarde", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Técnica de Color", "Técnica de Color", "Cualquier hora", "No permitir", "Este horario no está disponible para este servicio. Te sugerimos elegir otra hora o escribirnos por WhatsApp."],
  ["Técnica de Color", "Técnica de Color", "Color Parejo", "Color Parejo", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Alisamientos Capilares", "Cirugia Capilar", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Alisamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Cirugia Capilar", "Tratamientos Capilares", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Técnica de Color", "Alisamientos Capilares", "Corte de cabello", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Técnica de Color", "Cirugia Capilar", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Cirugia Capilar", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Cirugia Capilar", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Cirugia Capilar", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Cirugia Capilar", "Color Parejo", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Cirugia Capilar", "Color Parejo", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Cirugia Capilar", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Color Parejo", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Tratamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Cirugia Capilar", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Color Parejo", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Corte de cabello", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Corte de cabello", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Corte de cabello", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Corte de cabello", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Corte de cabello", "Cirugia Capilar", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Técnica de Color", "Corte de cabello", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Alisamientos Capilares", "Ninguno", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Alisamientos Capilares", "Alisamientos Capilares", "Cualquier hora", "Requiere aprobación", "Este servicio requiere validación del equipo AMARË antes de confirmar la reserva."],
  ["Alisamientos Capilares", "Alisamientos Capilares", "", "", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Color Parejo", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Color Parejo", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Color Parejo", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Cirugia Capilar", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Tratamientos Capilares", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Tratamientos Capilares", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Corte de cabello", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Corte de cabello", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Alisamientos Capilares", "Corte de cabello", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Cirugia Capilar", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Cirugia Capilar", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Cirugia Capilar", "Color Parejo", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Cirugia Capilar", "Tratamientos Capilares", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Tratamientos Capilares", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Tratamientos Capilares", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Tratamientos Capilares", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Tratamientos Capilares", "Cirugia Capilar", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Tratamientos Capilares", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Color Parejo", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Color Parejo", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Color Parejo", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Color Parejo", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Color Parejo", "Tratamientos Capilares", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Color Parejo", "Cirugia Capilar", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Corte de cabello", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Corte de cabello", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Corte de cabello", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Corte de cabello", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Corte de cabello", "Tratamientos Capilares", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Alisamientos Capilares", "Corte de cabello", "Cirugia Capilar", "Color Parejo", "Cualquier hora", "Permitir", ""],
  ["Corte de cabello", "Corte de cabello", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Cirugia Capilar", "Cirugia Capilar", "Cirugia Capilar", "Cirugia Capilar", "Cualquier hora", "Permitir", ""],
  ["Tratamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Tratamientos Capilares", "Cualquier hora", "Permitir", ""],
  ["Corte de cabello", "Corte de cabello", "Corte de cabello", "Corte de cabello", "Cualquier hora", "Permitir", ""],
  ["Color Parejo", "Color Parejo", "Color Parejo", "Color Parejo", "Cualquier hora", "Permitir", ""]
];

var COLUMNAS = [
  'id', 'creado', 'estado', 'nombre', 'celular', 'correo', 'categoria', 'servicio', 'codigo', 'largo',
  'precio_min', 'precio_max', 'dur_min_h', 'dur_max_h', 'fecha_solicitada', 'franja', 'horario_sugerido',
  'deposito', 'descripcion_sinpe', 'comentarios', 'comprobante_url', 'comprobante_id',
  'fecha_cita', 'hora_inicio', 'hora_fin', 'evento_id', 'motivo', 'recordatorio_enviado', 'actualizado', 'historial',
  'requiere_aprobacion',
  'hora_solicitada', 'tipo_cliente', 'expectativas', 'fotos_ids', 'revisada', 'origen', 'recordatorio_3d', 'whatsapp_ok'
];

// ------------------------------------------------------------------ Instalación (ejecutar una vez)
function instalar() {
  var props = PropertiesService.getScriptProperties();
  var hoja = obtenerHoja_();
  obtenerReglas_();
  if (!props.getProperty('CARPETA_ID')) {
    var carpeta = DriveApp.createFolder('Amarë · Comprobantes de pago');
    props.setProperty('CARPETA_ID', carpeta.getId());
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'enviarRecordatorios') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarRecordatorios').timeBased().everyMinutes(15).create(); // el recordatorio sale entre 24 h y 23 h 45 min antes
  Logger.log('Listo. Hoja: ' + hoja.getParent().getUrl());
}

function obtenerHoja_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('HOJA_ID');
  var libro;
  if (id) {
    libro = SpreadsheetApp.openById(id);
  } else {
    libro = SpreadsheetApp.create('Amarë · Reservas');
    props.setProperty('HOJA_ID', libro.getId());
  }
  var hoja = libro.getSheetByName('Reservas');
  if (!hoja) {
    hoja = libro.getSheets()[0];
    hoja.setName('Reservas');
    // Todo como texto: evita que "+506 ..." se lea como fórmula o que las fechas cambien de formato.
    hoja.getRange(1, 1, hoja.getMaxRows(), COLUMNAS.length).setNumberFormat('@');
    hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]).setFontWeight('bold');
    hoja.setFrozenRows(1);
  } else if (hoja.getLastColumn() < COLUMNAS.length) {
    // Columnas nuevas (p. ej. requiere_aprobacion): se agregan al encabezado sin tocar los datos.
    if (hoja.getMaxColumns() < COLUMNAS.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), COLUMNAS.length - hoja.getMaxColumns());
    hoja.getRange(1, 1, 1, COLUMNAS.length).setValues([COLUMNAS]).setFontWeight('bold');
  }
  return hoja;
}

// ------------------------------------------------------------------ Matriz de reglas (pestaña "Reglas")
function obtenerReglas_() {
  var libro = obtenerHoja_().getParent();
  var hoja = libro.getSheetByName('Reglas');
  if (!hoja) {
    hoja = libro.insertSheet('Reglas');
    var cab = ['Existente 1', 'Existente 2', 'Existente 3', 'Solicitado', 'Franja', 'Acción', 'Mensaje para la clienta'];
    hoja.getRange(1, 1, 1, cab.length).setValues([cab]).setFontWeight('bold');
    hoja.getRange(2, 1, REGLAS_INICIALES.length, cab.length).setValues(REGLAS_INICIALES);
    hoja.setFrozenRows(1);
    hoja.getRange(1, 9).setValue('Acción: Permitir / Requiere aprobación / No permitir · Franja: Mañana / Tarde / Cualquier hora · Existentes vacíos = no se exigen.');
  }
  var filas = hoja.getLastRow() > 1 ? hoja.getRange(2, 1, hoja.getLastRow() - 1, 7).getValues() : [];
  return filas.map(function (f) {
    return {
      existentes: [f[0], f[1], f[2]].map(norm_).filter(String),
      solicitado: norm_(f[3]), franja: norm_(f[4]), accion: norm_(f[5]), mensaje: String(f[6] || '').trim()
    };
  }).filter(function (g) { return g.solicitado && (g.accion === 'no permitir' || g.accion === 'requiere aprobacion'); });
}

/** "Cirugía Capilar " → "cirugia capilar" (las categorías del sitio y del Excel no coinciden en tildes/mayúsculas). */
function norm_(t) {
  return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------------ Web: entradas
function doGet(e) {
  var accion = (e && e.parameter && e.parameter.accion) || '';
  if (accion === 'disponibilidad') {
    var reservas = leerReservas_(), aj = ajustes_();
    var dias = resumenDias_(reservas);
    var ocupacion = ocupacion_(reservas), cerrados = cerradosPorFranja_(ocupacion, aj), modos = modosDias_();
    return json_({
      ok: true, dias: dias, tope: aj.tope, limiteHoras: aj.limiteHoras, ocupacion: ocupacion, cerrados: cerrados, modos: modos,
      reglas: obtenerReglas_(),
      bloqueos: bloqueosCompat_(dias, cerrados, modos, aj) // para páginas con la versión anterior en caché
    });
  }
  if (!esAdmin_()) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:40px">Acceso restringido. Inicia sesión con la cuenta de administración de Amarë.</p>');
  }
  return HtmlService.createTemplateFromFile('Panel').evaluate()
    .setTitle('Panel Amarë · Reservas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    var datos = JSON.parse(e.postData.contents);
    if (datos.honey) return json_({ ok: true }); // bots
    var r = validarReserva_(datos.reserva || {});
    if (r.error) return json_({ ok: false, error: r.error });

    // Comprobante (sigue siendo obligatorio si hay depósito, pero ya no se valida antes de confirmar).
    var archivos = [];
    if (datos.comprobante && datos.comprobante.base64) {
      var archivo = guardarComprobante_(r, datos.comprobante);
      archivos.push(archivo);
      r.comprobante_url = archivo.getUrl();
      r.comprobante_id = archivo.getId();
    } else if (Number(r.deposito) > 0) {
      return json_({ ok: false, error: 'falta_comprobante' });
    }
    // Fotos del cabello: obligatorias para clientas nuevas.
    var fotos = (datos.fotos || []).filter(function (x) { return x && x.base64; }).slice(0, CONFIG.MAX_FOTOS);
    if (r.tipo_cliente === 'nuevo' && !fotos.length) {
      archivos.forEach(function (a) { a.setTrashed(true); });
      return json_({ ok: false, error: 'falta_foto' });
    }
    var fotosIds = fotos.map(function (x, i) { var a = guardarFotoCabello_(r, x, i + 1); archivos.push(a); return a.getId(); });
    r.fotos_ids = fotosIds.join(',');

    // Revisar cupo y guardar dentro del candado: si llegan varias a la vez, se atienden una por una
    // y nunca se vende dos veces el último espacio.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    var decision;
    try {
      var todas = leerReservas_(), aj = ajustes_();
      decision = evaluarHora_(todas, aj, r.fecha_solicitada, horaNumero_(r.hora_solicitada), duracionEstimada_(r), r.categoria);
      if (decision.accion === 'bloquear') {
        archivos.forEach(function (a) { a.setTrashed(true); });
        return json_({ ok: false, error: 'franja_llena', mensaje: decision.mensaje });
      }
      r.requiere_aprobacion = decision.accion === 'aprobacion' ? 'sí' : '';
      r.estado = r.requiere_aprobacion ? ESTADOS.REQUIERE_APROBACION : ESTADOS.CITA_CONFIRMADA;
      r.origen = 'web';
      r.id = 'AM-' + Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
      r.creado = new Date();
      r.historial = fechaTexto_(new Date()) + ' · reserva recibida desde la web' + (r.requiere_aprobacion ? ' (requiere aprobación)' : '');
      guardarFila_(r);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    // Fuera del candado: agendar en Calendar (la reserva ya ocupa su espacio en la hoja mientras tanto).
    if (r.estado === ESTADOS.CITA_CONFIRMADA) {
      r = buscarReserva_(r.id);
      ponerEnCalendario_(r, r.fecha_solicitada, r.hora_solicitada, sumarHoras_(r.hora_solicitada, duracionEstimada_(r)));
      actualizarReserva_(r, {}, 'agendada automáticamente en Google Calendar (duración estimada, por revisar)');
      avisarClienta_(r, 'confirmada');
    } else {
      avisarClienta_(r, 'revision');
    }
    avisarAdmin_(r);
    return json_({ ok: true, id: r.id, requiere_aprobacion: !!r.requiere_aprobacion });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'error_servidor' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ Reservas
function validarReserva_(x) {
  var r = {};
  var texto = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); };
  r.nombre = texto(x.nombre, 120);
  r.celular = texto(x.celular, 40);
  r.correo = texto(x.correo, 120);
  r.categoria = texto(x.categoria);
  r.servicio = texto(x.servicio);
  r.codigo = texto(x.codigo, 40);
  r.largo = texto(x.largo, 40);
  r.precio_min = Number(x.precio_min) || 0;
  r.precio_max = Number(x.precio_max) || 0;
  r.dur_min_h = Number(x.dur_min_h) || 0;
  r.dur_max_h = Number(x.dur_max_h) || 0;
  r.fecha_solicitada = texto(x.fecha, 10);
  // Hora de inicio elegida (9:00, 13:00 o 15:00 según el servicio). La franja se deduce de la hora.
  var hora = Number(String(x.hora || '').split(':')[0]);
  if (CONFIG.HORAS_INICIO.indexOf(hora) < 0) return { error: 'hora_invalida' };
  r.hora_solicitada = (hora < 10 ? '0' : '') + hora + ':00';
  r.franja = hora < CONFIG.CORTE_FRANJA ? 'Mañana' : 'Tarde';
  r.tipo_cliente = x.tipo_cliente === 'nuevo' ? 'nuevo' : (x.tipo_cliente === 'regular' ? 'regular' : '');
  r.expectativas = texto(x.expectativas, 1000);
  r.whatsapp_ok = x.whatsapp_ok ? 'sí' : '';
  r.horario_sugerido = texto(x.horario_sugerido, 120);
  r.deposito = Number(x.deposito) || 0;
  r.descripcion_sinpe = texto(x.descripcion_sinpe, 120);
  r.comentarios = texto(x.comentarios, 1000);
  if (r.nombre.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.correo) || !r.servicio) return { error: 'datos_incompletos' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_solicitada)) return { error: 'fecha_invalida' };
  // Domingo y lunes: solo si el panel abrió ese día (o una franja); evaluarHora_ revisa la franja exacta.
  if (diaNoLaboral_(r.fecha_solicitada)) {
    var modoDia = modosDias_()[r.fecha_solicitada] || {};
    if (modoDia.manana !== 'abrir' && modoDia.tarde !== 'abrir') return { error: 'dia_cerrado' };
  }
  return r;
}

function guardarComprobante_(r, c) {
  var carpeta = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('CARPETA_ID'));
  var tipo = /^(image\/(jpeg|png)|application\/pdf)$/.test(c.tipo) ? c.tipo : 'application/octet-stream';
  var ext = tipo === 'application/pdf' ? '.pdf' : (tipo === 'image/png' ? '.png' : '.jpg');
  var nombre = r.fecha_solicitada + ' · ' + r.nombre + ' · ' + r.servicio + ext;
  var blob = Utilities.newBlob(Utilities.base64Decode(c.base64), tipo, nombre);
  return carpeta.createFile(blob);
}

/** Foto del cabello (ya llega comprimida desde la página, JPEG/PNG). Carpeta privada "Fotos de cabello". */
function guardarFotoCabello_(r, f, n) {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('FOTOS_CARPETA_ID');
  var carpeta;
  if (id) carpeta = DriveApp.getFolderById(id);
  else { carpeta = DriveApp.createFolder('Amarë · Fotos de cabello'); props.setProperty('FOTOS_CARPETA_ID', carpeta.getId()); }
  var tipo = /^image\/(jpeg|png|webp)$/.test(f.tipo) ? f.tipo : 'image/jpeg';
  var nombre = r.fecha_solicitada + ' · ' + r.nombre + ' · foto ' + n + (tipo === 'image/png' ? '.png' : '.jpg');
  return carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(f.base64), tipo, nombre));
}

/** Horas estimadas de la reserva (la mayor del rango; el salón la corrige en el panel). */
function duracionEstimada_(r) { return Number(r.dur_max_h) || Number(r.dur_min_h) || CONFIG.HORAS_SIN_DURACION; }

function sumarHoras_(hhmm, horas) {
  var t = Math.min(Math.round(horaNumero_(hhmm) * 60 + horas * 60), 23 * 60 + 59);
  return ('0' + Math.floor(t / 60)).slice(-2) + ':' + ('0' + (t % 60)).slice(-2);
}

function valorCelda_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, CONFIG.ZONA, 'yyyy-MM-dd HH:mm');
  return String(v);
}

function guardarFila_(r) {
  var hoja = obtenerHoja_();
  r.actualizado = new Date();
  var fila = hoja.getLastRow() + 1;
  var rango = hoja.getRange(fila, 1, 1, COLUMNAS.length);
  rango.setNumberFormat('@');
  rango.setValues([COLUMNAS.map(function (c) { return valorCelda_(r[c]); })]);
}

function leerReservas_() {
  var hoja = obtenerHoja_();
  var valores = hoja.getDataRange().getValues();
  var cab = valores.shift();
  return valores.map(function (fila, i) {
    var o = { _fila: i + 2 };
    cab.forEach(function (c, j) { o[c] = fila[j]; });
    ['fecha_solicitada', 'fecha_cita'].forEach(function (k) {
      if (o[k] instanceof Date) o[k] = Utilities.formatDate(o[k], CONFIG.ZONA, 'yyyy-MM-dd');
    });
    ['hora_inicio', 'hora_fin'].forEach(function (k) {
      if (o[k] instanceof Date) o[k] = Utilities.formatDate(o[k], CONFIG.ZONA, 'HH:mm');
    });
    return o;
  }).filter(function (o) { return o.id; });
}

function buscarReserva_(id) {
  var r = leerReservas_().filter(function (o) { return o.id === id; })[0];
  if (!r) throw new Error('Reserva no encontrada: ' + id);
  return r;
}

function actualizarReserva_(r, cambios, nota) {
  var hoja = obtenerHoja_();
  Object.keys(cambios).forEach(function (k) { r[k] = cambios[k]; });
  r.actualizado = new Date();
  r.historial = (r.historial ? r.historial + '\n' : '') + fechaTexto_(new Date()) + ' · ' + nota;
  // Si mientras tanto se eliminó otra reserva, las filas se corrieron: volver a ubicar esta por su id.
  if (String(hoja.getRange(r._fila, 1).getValue()) !== r.id) {
    var ids = hoja.getRange(1, 1, hoja.getLastRow(), 1).getValues().map(function (f) { return String(f[0]); });
    var i = ids.indexOf(r.id);
    if (i < 0) throw new Error('La reserva ' + r.id + ' ya no existe.');
    r._fila = i + 1;
  }
  var rango = hoja.getRange(r._fila, 1, 1, COLUMNAS.length);
  rango.setNumberFormat('@');
  rango.setValues([COLUMNAS.map(function (c) { return valorCelda_(r[c]); })]);
  return r;
}

// ------------------------------------------------------------------ Cupos y disponibilidad
// Cada FRANJA se llena por separado (mañana 00:00–11:59, tarde 12:00–23:59) al llegar a TOPE_DIA citas o
// LIMITE_HORAS_DIA horas dentro de ella. Una cita que cruza las 12:00 cuenta como cita en ambas y sus horas se
// reparten según dónde caen. El día completo se cierra solo si las dos franjas están cerradas.
// Además: bloqueo/apertura manual por franja desde el panel y la matriz de la pestaña "Reglas" (por categoría).
// Cada reserva web ocupa espacio desde que entra (aunque el pago no esté validado).
function tieneHorario_(r) {
  return (r.estado === ESTADOS.CITA_CONFIRMADA || r.estado === ESTADOS.CITA_AGENDADA) && r.fecha_cita && r.hora_inicio && r.hora_fin;
}

function esActiva_(r) { return ESTADOS_ACTIVOS.indexOf(r.estado) >= 0; }

function fechaDe_(r) { return tieneHorario_(r) ? r.fecha_cita : r.fecha_solicitada; }

/** { 'yyyy-MM-dd': { total: n, cats: { 'tecnica de color': 2, ... } } } — solo conteos, sin datos personales. */
function resumenDias_(reservas, excluirId) {
  var dias = {};
  reservas.forEach(function (r) {
    if (!esActiva_(r) || r.id === excluirId) return;
    var f = fechaDe_(r);
    if (!f) return;
    var d = dias[f] = dias[f] || { total: 0, cats: {} };
    var c = norm_(r.categoria);
    d.total++;
    d.cats[c] = (d.cats[c] || 0) + 1;
  });
  return dias;
}

/**
 * ¿Se puede pedir esta categoría ese día y franja? → { accion: 'permitir' | 'aprobacion' | 'bloquear', mensaje }
 * Misma lógica que js/booking.js (evaluarDia), para que la página y el servidor decidan igual.
 */
function evaluarDia_(dia, categoria, franja, reglas, modoFranja, cierreFranja) {
  dia = dia || { total: 0, cats: {} };
  // Disponibilidad manual del panel para esa franja: 'bloquear' la cierra; 'abrir' ignora citas, horas y
  // "No permitir" (los avisos de aprobación se mantienen); sin modo = reglas normales.
  if (modoFranja === 'bloquear') return { accion: 'bloquear', mensaje: 'Ese horario no está disponible ese día.' };
  var abierto = modoFranja === 'abrir';
  if (!abierto && cierreFranja) return { accion: 'bloquear', mensaje: 'Ese horario ya está completo.' };
  var cat = norm_(categoria), fr = norm_(franja), resultado = { accion: 'permitir', mensaje: '' };
  reglas.forEach(function (g) {
    if (g.solicitado !== cat) return;
    if (g.franja && g.franja !== 'cualquier hora' && g.franja !== fr) return;
    var faltan = {};
    g.existentes.forEach(function (e) { faltan[e] = (faltan[e] || 0) + 1; });
    for (var e in faltan) if ((dia.cats[e] || 0) < faltan[e]) return;
    if (g.accion === 'no permitir' && !abierto) resultado = { accion: 'bloquear', mensaje: g.mensaje || 'Ese día ya no tenemos espacio para este servicio.' };
    else if (resultado.accion !== 'bloquear') resultado = { accion: 'aprobacion', mensaje: g.mensaje || MENSAJE_APROBACION };
  });
  return resultado;
}

var MENSAJE_APROBACION = 'Este servicio requiere validación del equipo AMARË antes de confirmar la reserva.';

/** Franjas cerradas en el formato viejo { fecha: { manana, tarde } } (páginas con booking.js anterior en caché). */
function bloqueosCompat_(dias, cerrados, modos, aj) {
  var b = {}, fechas = {};
  [cerrados, modos].forEach(function (m) { Object.keys(m).forEach(function (f) { fechas[f] = 1; }); });
  Object.keys(fechas).forEach(function (f) {
    var estado = {};
    ['manana', 'tarde'].forEach(function (fr) {
      var modo = (modos[f] || {})[fr];
      estado[fr] = modo === 'bloquear' || (modo !== 'abrir' && !!(cerrados[f] || {})[fr]);
    });
    if (estado.manana || estado.tarde) b[f] = estado;
  });
  return b;
}

function franjaClave_(franja) { return norm_(franja) === 'tarde' ? 'tarde' : 'manana'; }

/** Franjas que toca un tramo [ini, fin) en horas: ['manana'], ['tarde'] o ambas. */
function franjasDeTramo_(ini, fin) {
  var f = [];
  if (ini < CONFIG.CORTE_FRANJA && fin > 0) f.push('manana');
  if (fin > CONFIG.CORTE_FRANJA) f.push('tarde');
  return f.length ? f : ['manana'];
}

/**
 * ¿Se puede reservar ese día a esa hora (con esa duración)? Misma lógica que js/booking.js (evaluarHora).
 * Revisa: hora ya pasada, espacio bloqueado, bloqueo/apertura manual, franjas llenas (citas u horas) en TODAS
 * las franjas que ocupa el servicio, y la matriz de reglas por categoría. → { accion, mensaje }
 */
function evaluarHora_(reservas, aj, fecha, hora, dur, categoria) {
  if (horaPasada_(fecha, hora)) return { accion: 'bloquear', mensaje: 'Ese horario de hoy ya pasó.' };
  var modos = modosDias_()[fecha] || {}, cierres = cerradosPorFranja_(ocupacion_(reservas), aj)[fecha] || {};
  var noLaboral = diaNoLaboral_(fecha);
  var franjas = franjasDeTramo_(hora, hora + dur);
  for (var i = 0; i < franjas.length; i++) {
    var fr = franjas[i], cierre = cierres[fr], modo = modos[fr];
    if (cierre === 'bloqueo') return { accion: 'bloquear', mensaje: 'Ese horario no está disponible ese día.' };
    if (modo === 'bloquear') return { accion: 'bloquear', mensaje: 'Ese horario no está disponible ese día.' };
    // Domingo/lunes abierto a mano: la franja se ofrece, pero con el cupo normal (citas y horas).
    if (noLaboral && modo !== 'abrir') return { accion: 'bloquear', mensaje: 'Ese día no abrimos en ese horario.' };
    if (cierre && (modo !== 'abrir' || noLaboral)) return { accion: 'bloquear', mensaje: 'Ese horario ya está completo.' };
  }
  var inicial = franjas[0] === 'tarde' || hora >= CONFIG.CORTE_FRANJA ? 'Tarde' : 'Mañana';
  var modoInicial = noLaboral ? '' : modos[franjaClave_(inicial)];
  return evaluarDia_(resumenDias_(reservas)[fecha], categoria, inicial, obtenerReglas_(), modoInicial, '');
}

/** Domingo y lunes (CONFIG.DIAS_CERRADOS): cerrados salvo que el panel los abra. */
function diaNoLaboral_(fecha) {
  return CONFIG.DIAS_CERRADOS.indexOf(fechaDesdeISO_(fecha).getDay()) >= 0;
}

/** ¿La hora de inicio de hoy ya pasó? (hora de Costa Rica) */
function horaPasada_(fecha, hora) {
  var ahora = new Date();
  var hoy = Utilities.formatDate(ahora, CONFIG.ZONA, 'yyyy-MM-dd');
  var h = Number(Utilities.formatDate(ahora, CONFIG.ZONA, 'H')) + Number(Utilities.formatDate(ahora, CONFIG.ZONA, 'm')) / 60;
  return fecha < hoy || (fecha === hoy && h >= hora);
}

/** ¿Esa franja ya pasó? (hora de Costa Rica). La mañana termina a las 12:00 y la tarde al cierre del salón. */
function franjaPasada_(fecha, clave) {
  var ahora = new Date();
  var hoy = Utilities.formatDate(ahora, CONFIG.ZONA, 'yyyy-MM-dd');
  var hora = Number(Utilities.formatDate(ahora, CONFIG.ZONA, 'H')) + Number(Utilities.formatDate(ahora, CONFIG.ZONA, 'm')) / 60;
  var fin = clave === 'tarde' ? CONFIG.HORA_TARDE[1] : CONFIG.CORTE_FRANJA;
  return fecha < hoy || (fecha === hoy && hora >= fin);
}

// ------------------------------------------------------------------ Ajustes y bloqueos de día (los cambia el admin)
function ajustes_() {
  var p = PropertiesService.getScriptProperties();
  var horas = Number(p.getProperty('LIMITE_HORAS_DIA')), tope = Number(p.getProperty('TOPE_DIA'));
  return { limiteHoras: horas > 0 ? horas : CONFIG.LIMITE_HORAS_DIA, tope: tope > 0 ? tope : CONFIG.TOPE_DIA };
}

function listaFechas_(clave) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(clave) || '[]'); } catch (e) { return []; }
}

/**
 * Disponibilidad manual por franja: { 'yyyy-MM-dd': { manana: 'bloquear'|'abrir', tarde: 'bloquear'|'abrir' } }.
 * Sin entrada = automático. Incluye las listas de la versión anterior (DIAS_BLOQUEADOS / DIAS_ABIERTOS = día completo).
 */
function modosDias_() {
  var mapa = {};
  try { mapa = JSON.parse(PropertiesService.getScriptProperties().getProperty('DISPONIBILIDAD_MANUAL') || '{}'); } catch (e) { mapa = {}; }
  listaFechas_('DIAS_BLOQUEADOS').forEach(function (f) { mapa[f] = mapa[f] || { manana: 'bloquear', tarde: 'bloquear' }; });
  listaFechas_('DIAS_ABIERTOS').forEach(function (f) { mapa[f] = mapa[f] || { manana: 'abrir', tarde: 'abrir' }; });
  return mapa;
}

/**
 * Reparte un tramo horario [ini, fin) (en horas del día, 0–24) entre mañana y tarde y lo suma a la ocupación:
 * cada franja que toca recibe +1 cita y las horas que caen en ella.
 */
function sumarTramo_(ocup, fecha, ini, fin) {
  var corte = CONFIG.CORTE_FRANJA;
  var partes = { manana: Math.min(fin, corte) - Math.max(ini, 0), tarde: Math.min(fin, 24) - Math.max(ini, corte) };
  var d = ocup[fecha] = ocup[fecha] || { manana: { citas: 0, horas: 0 }, tarde: { citas: 0, horas: 0 } };
  ['manana', 'tarde'].forEach(function (fr) {
    if (partes[fr] <= 0) return;
    d[fr].citas++;
    d[fr].horas = Math.round((d[fr].horas + partes[fr]) * 100) / 100;
  });
}

/**
 * Ocupación por franja en Google Calendar (todos los eventos con hora, también los creados a mano; los de todo
 * el día no cuentan). Se guarda 2 min en caché porque leer el calendario hasta FECHA_MAX tarda; las acciones
 * del panel limpian la caché.
 */
function ocupacionCalendario_() {
  var cache = CacheService.getScriptCache(), guardado = cache.get('OCUP_CAL2');
  if (guardado) return JSON.parse(guardado);
  var hoy = Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd');
  var ocup = {}, hora = function (d) { return Number(Utilities.formatDate(d, CONFIG.ZONA, 'H')) + Number(Utilities.formatDate(d, CONFIG.ZONA, 'm')) / 60; };
  CalendarApp.getDefaultCalendar().getEvents(fechaHora_(hoy, '00:00'), fechaHora_(CONFIG.FECHA_MAX, '23:59')).forEach(function (ev) {
    var ini = ev.getStartTime(), fin = ev.getEndTime();
    var f = Utilities.formatDate(ini, CONFIG.ZONA, 'yyyy-MM-dd');
    if (esBloqueo_(ev)) { marcarBloqueo_(ocup, ev, f, hora); return; }  // "Espacio bloqueado" cierra sus franjas
    if (ev.isAllDayEvent()) return;
    var finH = Utilities.formatDate(fin, CONFIG.ZONA, 'yyyy-MM-dd') > f ? 24 : hora(fin); // si pasa de medianoche, hasta las 24
    sumarTramo_(ocup, f, hora(ini), finH);
  });
  try { cache.put('OCUP_CAL2', JSON.stringify(ocup), 120); } catch (e) { /* muy grande para la caché */ }
  return ocup;
}

var PREFIJO_BLOQUEO = 'Espacio bloqueado';
function esBloqueo_(ev) { return String(ev.getTitle()).indexOf(PREFIJO_BLOQUEO) === 0; }

/** Un espacio bloqueado (todo el día o por horas) cierra en la web cada franja que toca, en cada día que abarca. */
function marcarBloqueo_(ocup, ev, f, hora) {
  var vacio = function () { return { manana: { citas: 0, horas: 0 }, tarde: { citas: 0, horas: 0 } }; };
  var ini = ev.getStartTime(), fin = ev.getEndTime();
  var dia = new Date(ini.getTime()), ultimo = Utilities.formatDate(new Date(fin.getTime() - 1), CONFIG.ZONA, 'yyyy-MM-dd');
  for (var k = 0; k < 400; k++) {
    var fd = Utilities.formatDate(dia, CONFIG.ZONA, 'yyyy-MM-dd');
    if (fd > ultimo) break;
    var d = ocup[fd] = ocup[fd] || vacio();
    var franjas = ev.isAllDayEvent() || fd !== f || fd !== ultimo
      ? ['manana', 'tarde']
      : franjasDeTramo_(hora(ini), Utilities.formatDate(fin, CONFIG.ZONA, 'yyyy-MM-dd') > f ? 24 : hora(fin));
    franjas.forEach(function (fr) { d[fr].bloqueo = true; });
    dia = new Date(dia.getTime() + 864e5);
  }
}

function limpiarCacheCalendario_() { CacheService.getScriptCache().remove('OCUP_CAL2'); }

/**
 * Ocupación por franja = eventos del calendario + reservas web que aún no tienen hora (se ubican al inicio de la
 * franja que pidieron, 9:00 o 13:00, con su duración estimada; si es larga, también ocupa la tarde).
 */
function ocupacion_(reservas) {
  var ocup = JSON.parse(JSON.stringify(ocupacionCalendario_()));
  reservas.forEach(function (r) {
    if (!esActiva_(r) || tieneHorario_(r) || !r.fecha_solicitada) return;
    var ini = r.hora_solicitada ? horaNumero_(r.hora_solicitada) : (r.franja === 'Tarde' ? CONFIG.HORA_TARDE[0] : CONFIG.HORA_MANANA[0]);
    var dur = Number(r.dur_max_h) || Number(r.dur_min_h) || CONFIG.HORAS_SIN_DURACION;
    sumarTramo_(ocup, r.fecha_solicitada, ini, Math.min(ini + dur, 24));
  });
  return ocup;
}

/** { fecha: { manana: 'citas'|'horas', tarde: ... } } — franjas llenas por las reglas automáticas. */
function cerradosPorFranja_(ocupacion, aj) {
  var cerrados = {};
  Object.keys(ocupacion).forEach(function (f) {
    ['manana', 'tarde'].forEach(function (fr) {
      var o = ocupacion[f][fr];
      var motivo = o.bloqueo ? 'bloqueo' : (o.citas >= aj.tope ? 'citas' : (o.horas >= aj.limiteHoras ? 'horas' : ''));
      if (motivo) (cerrados[f] = cerrados[f] || {})[fr] = motivo;
    });
  });
  return cerrados;
}

/**
 * Disponibilidad manual desde el panel, por día completo o por franja.
 * modo: 'bloquear' (no se ofrece en la web) · 'abrir' (se ofrece aunque las reglas la cierren) · 'auto' (reglas normales).
 * franja: 'dia' (mañana y tarde) · 'manana' · 'tarde'. Acepta true/false (versión anterior: bloquear / auto).
 */
function bloquearDia(fecha, modo, franja) {
  exigirAdmin_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha inválida.');
  if (modo === true) modo = 'bloquear';
  if (modo === false) modo = 'auto';
  franja = franja || 'dia';
  if (['bloquear', 'abrir', 'auto'].indexOf(modo) < 0) throw new Error('Modo inválido.');
  if (['dia', 'manana', 'tarde'].indexOf(franja) < 0) throw new Error('Franja inválida.');
  var hoy = Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyyy-MM-dd');
  var mapa = modosDias_(), limpio = {};
  Object.keys(mapa).forEach(function (f) { if (f >= hoy) limpio[f] = mapa[f]; }); // quita días pasados
  var dia = limpio[fecha] || {};
  (franja === 'dia' ? ['manana', 'tarde'] : [franja]).forEach(function (fr) {
    if (modo === 'auto') delete dia[fr]; else dia[fr] = modo;
  });
  if (dia.manana || dia.tarde) limpio[fecha] = dia; else delete limpio[fecha];
  var props = PropertiesService.getScriptProperties();
  props.setProperty('DISPONIBILIDAD_MANUAL', JSON.stringify(limpio));
  props.deleteProperty('DIAS_BLOQUEADOS'); props.deleteProperty('DIAS_ABIERTOS'); // ya migradas al mapa
  return { modos: limpio };
}

/** Ajustes editables desde el panel. */
function guardarAjustes(limiteHoras, tope) {
  exigirAdmin_();
  limiteHoras = Number(limiteHoras); tope = Number(tope);
  if (!(limiteHoras > 0 && limiteHoras <= 12)) throw new Error('Las horas por franja deben estar entre 1 y 12.');
  if (!(tope >= 1 && tope <= 50)) throw new Error('Las citas por franja deben estar entre 1 y 50.');
  PropertiesService.getScriptProperties().setProperties({ LIMITE_HORAS_DIA: String(limiteHoras), TOPE_DIA: String(Math.round(tope)) });
  return ajustes_();
}

// ------------------------------------------------------------------ Panel de administración
function esAdmin_() {
  var email = (Session.getActiveUser().getEmail() || '').toLowerCase();
  return email === CONFIG.ADMIN_EMAIL;
}

function exigirAdmin_() {
  if (!esAdmin_()) throw new Error('Acceso restringido.');
}

function panelDatos() {
  exigirAdmin_();
  var todas = leerReservas_(); // una sola lectura de la hoja para todo el panel
  var reservas = todas.filter(function (r) { return r.estado !== ESTADOS.ELIMINADA; }).map(reservaPlana_).reverse();
  // Agenda de Google Calendar: 2 semanas atrás y 4 meses adelante (el panel pide otros rangos con agenda()).
  var hoy = new Date();
  var desde = Utilities.formatDate(new Date(hoy.getTime() - 14 * 864e5), CONFIG.ZONA, 'yyyy-MM-dd');
  var hasta = Utilities.formatDate(new Date(hoy.getTime() + 120 * 864e5), CONFIG.ZONA, 'yyyy-MM-dd');
  return {
    reservas: reservas, activos: ESTADOS_ACTIVOS, ajustes: ajustes_(), modos: modosDias_(), inicios: { manana: CONFIG.HORA_MANANA[0], tarde: CONFIG.HORA_TARDE[0] },
    corte: CONFIG.CORTE_FRANJA, horasInicio: CONFIG.HORAS_INICIO,
    horasSinDuracion: CONFIG.HORAS_SIN_DURACION, whatsappApi: whatsappListo_(),
    hoy: Utilities.formatDate(hoy, CONFIG.ZONA, 'yyyy-MM-dd'),
    agenda: agenda_(desde, hasta, todas), agendaDesde: desde, agendaHasta: hasta
  };
}

function reservaPlana_(r) {
  var o = {};
  Object.keys(r).forEach(function (k) { o[k] = r[k] instanceof Date ? r[k].toISOString() : r[k]; });
  return o;
}

/** Eventos del calendario entre dos fechas 'yyyy-MM-dd' (incluye los que el admin crea a mano en Calendar). */
function agenda(desde, hasta) {
  exigirAdmin_();
  return agenda_(desde, hasta);
}

function agenda_(desde, hasta, reservas) {
  var porEvento = {};
  (reservas || leerReservas_()).forEach(function (r) { if (r.evento_id) porEvento[r.evento_id] = r; });
  var f = function (d, p) { return Utilities.formatDate(d, CONFIG.ZONA, p); };
  return CalendarApp.getDefaultCalendar().getEvents(fechaHora_(desde, '00:00'), fechaHora_(hasta, '23:59')).map(function (ev) {
    var r = porEvento[ev.getId()] || {};
    var s = ev.getStartTime(), e = ev.getEndTime();
    return {
      titulo: ev.getTitle(), fecha: f(s, 'yyyy-MM-dd'), ini: f(s, 'HH:mm'), fin: f(e, 'yyyy-MM-dd') > f(s, 'yyyy-MM-dd') ? '23:59' : f(e, 'HH:mm'),
      todoElDia: ev.isAllDayEvent(), reserva: r.id || '', estado: r.estado || '', nombre: r.nombre || '', servicio: r.servicio || '',
      celular: r.celular || '', id: ev.getId(), bloqueo: esBloqueo_(ev)
    };
  });
}

/** Respuesta liviana de las acciones: solo la reserva actualizada (el panel ya movió la tarjeta al instante). */
function respuesta_(r, correo) { return { reserva: reservaPlana_(r), correo: correo }; }

function aprobarPago(id) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  actualizarReserva_(r, { estado: ESTADOS.PAGO_APROBADO, motivo: '' }, 'pago aprobado');
  return respuesta_(r, enviarCorreo_('pagoAprobado', r));
}

function rechazarPago(id, motivo) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  actualizarReserva_(r, { estado: ESTADOS.PAGO_RECHAZADO, motivo: motivo || '' }, 'pago rechazado: ' + (motivo || 'sin motivo'));
  return respuesta_(r, enviarCorreo_('pagoRechazado', r, { motivo: motivo || 'No pudimos verificar el depósito con los datos del comprobante.' }));
}

function marcarDiaSaturado(id, nota) {
  exigirAdmin_();
  limpiarCacheCalendario_();
  var r = buscarReserva_(id);
  borrarEvento_(r);
  actualizarReserva_(r, { estado: ESTADOS.DIA_SATURADO, motivo: nota || '', evento_id: '', fecha_cita: '', hora_inicio: '', hora_fin: '' },
    'día saturado, contactar para nueva fecha');
  return respuesta_(r, enviarCorreo_('diaSaturado', r));
}

/**
 * Paso 1: poner la cita en Google Calendar (sin avisar a la clienta todavía).
 * fecha 'yyyy-MM-dd', horaInicio/horaFin 'HH:mm'. El admin decide; puede cruzarse con otras citas.
 * Si la cita ya estaba confirmada y se mueve, vuelve a "agendada" para enviar el correo con la nueva hora.
 */
function agendarCita(id, fecha, horaInicio, horaFin) {
  exigirAdmin_();
  limpiarCacheCalendario_();
  var r = buscarReserva_(id);
  var inicio = fechaHora_(fecha, horaInicio);
  var fin = fechaHora_(fecha, horaFin);
  if (!(fin > inicio)) throw new Error('La hora de fin debe ser posterior a la de inicio.');

  borrarEvento_(r);
  var evento = CalendarApp.getDefaultCalendar().createEvent('Por confirmar · ' + tituloEvento_(r), inicio, fin, {
    location: CONFIG.DIRECCION,
    description: [
      'Clienta: ' + r.nombre,
      'Correo: ' + r.correo,
      'Celular: ' + r.celular,
      'Servicio: ' + r.servicio + ' (' + r.categoria + ') · largo ' + r.largo,
      'Depósito SINPE: ' + (Number(r.deposito) > 0 ? colones_(r.deposito) + ' · descripción "' + r.descripcion_sinpe + '"' : 'no requiere'),
      'Precio estimado: ' + colones_(r.precio_min) + ' – ' + colones_(r.precio_max),
      r.comentarios ? 'Comentarios: ' + r.comentarios : '',
      r.comprobante_url ? 'Comprobante: ' + r.comprobante_url : '',
      'Reserva: ' + r.id
    ].filter(String).join('\n')
  });
  try { evento.setColor(CalendarApp.EventColor.YELLOW); } catch (e) { /* color opcional */ }
  actualizarReserva_(r, {
    estado: ESTADOS.CITA_AGENDADA, fecha_cita: fecha, hora_inicio: horaInicio, hora_fin: horaFin,
    evento_id: evento.getId(), recordatorio_enviado: '', motivo: ''
  }, 'agendada en calendario ' + fecha + ' ' + horaInicio + '–' + horaFin);
  return respuesta_(r);
}

/** Paso 2: confirmar la cita ya agendada y enviarle el correo a la clienta. */
function confirmarCita(id) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  if (r.estado !== ESTADOS.CITA_AGENDADA || !r.evento_id) throw new Error('Primero ponga la cita en el calendario.');
  try {
    var ev = CalendarApp.getDefaultCalendar().getEventById(r.evento_id);
    ev.setTitle(tituloEvento_(r));
    ev.setColor(CalendarApp.EventColor.GREEN);
  } catch (e) { console.warn('No se pudo actualizar el evento: ' + e); }
  actualizarReserva_(r, { estado: ESTADOS.CITA_CONFIRMADA }, 'cita confirmada a la clienta ' + r.fecha_cita + ' ' + r.hora_inicio + '–' + r.hora_fin);
  return respuesta_(r, enviarCorreo_('citaConfirmada', r));
}

/** Crea (o recrea) el evento de Calendar de una reserva. Color: verde = confirmada. */
function ponerEnCalendario_(r, fecha, horaInicio, horaFin) {
  var inicio = fechaHora_(fecha, horaInicio), fin = fechaHora_(fecha, horaFin);
  if (!(fin > inicio)) throw new Error('La hora de fin debe ser posterior a la de inicio.');
  borrarEvento_(r);
  var evento = CalendarApp.getDefaultCalendar().createEvent(tituloEvento_(r), inicio, fin, {
    location: CONFIG.DIRECCION, description: descripcionEvento_(r)
  });
  try { evento.setColor(CalendarApp.EventColor.GREEN); } catch (e) { /* color opcional */ }
  r.fecha_cita = fecha; r.hora_inicio = horaInicio; r.hora_fin = horaFin; r.evento_id = evento.getId();
  limpiarCacheCalendario_();
  return evento;
}

function descripcionEvento_(r) {
  return [
    'Clienta: ' + (r.nombre || '—'),
    r.correo ? 'Correo: ' + r.correo : '',
    r.celular ? 'Celular: ' + r.celular : '',
    'Servicio: ' + r.servicio + (r.categoria ? ' (' + r.categoria + ')' : '') + (r.largo ? ' · largo ' + r.largo : ''),
    Number(r.deposito) > 0 ? 'Depósito SINPE: ' + colones_(r.deposito) + ' · descripción "' + r.descripcion_sinpe + '"' : '',
    r.precio_min ? 'Precio estimado: ' + colones_(r.precio_min) + ' – ' + colones_(r.precio_max) : '',
    r.tipo_cliente ? 'Clienta ' + r.tipo_cliente : '',
    r.expectativas ? 'Expectativas: ' + r.expectativas : '',
    r.comentarios ? 'Comentarios: ' + r.comentarios : '',
    r.comprobante_url ? 'Comprobante: ' + r.comprobante_url : '',
    r.origen === 'manual' ? 'Cita creada desde el panel' : '',
    'Reserva: ' + r.id
  ].filter(String).join('\n');
}

/** "Requiere aprobación" → aprobar: se agenda a la hora pedida y se le confirma a la clienta. */
function aprobarReserva(id) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  if (r.estado !== ESTADOS.REQUIERE_APROBACION) throw new Error('Esa reserva no está pendiente de aprobación.');
  var ini = r.hora_solicitada || (r.franja === 'Tarde' ? '13:00' : '09:00');
  ponerEnCalendario_(r, r.fecha_solicitada, ini, sumarHoras_(ini, duracionEstimada_(r)));
  actualizarReserva_(r, { estado: ESTADOS.CITA_CONFIRMADA, revisada: '', motivo: '' }, 'aprobada y agendada ' + r.fecha_cita + ' ' + r.hora_inicio);
  return respuesta_(r, avisarClienta_(r, 'confirmada'));
}

/**
 * Ajustar fecha/horario desde "Por agendar" o "Confirmadas" (duración real del procedimiento).
 * Si solo cambia la hora de fin no se avisa a la clienta (libera o toma espacio en silencio);
 * si cambia la fecha o la hora de inicio, o la cita aún no estaba en el calendario, se le avisa.
 */
function ajustarHorario(id, fecha, horaInicio, horaFin) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  var antes = { fecha: r.fecha_cita, ini: r.hora_inicio, evento: r.evento_id };
  ponerEnCalendario_(r, fecha, horaInicio, horaFin);
  var avisar = !antes.evento || antes.fecha !== fecha || antes.ini !== horaInicio;
  var cambios = { estado: ESTADOS.CITA_CONFIRMADA, revisada: 'sí', motivo: '' };
  if (avisar) { cambios.recordatorio_enviado = ''; cambios.recordatorio_3d = ''; }
  actualizarReserva_(r, cambios, 'horario ajustado ' + fecha + ' ' + horaInicio + '–' + horaFin + (avisar ? ' (se avisó a la clienta)' : ''));
  return respuesta_(r, avisar ? avisarClienta_(r, antes.evento ? 'actualizada' : 'confirmada') : null);
}

/** "Horario correcto": pasa de Por agendar a Confirmadas sin cambiar nada. */
function marcarRevisada(id) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  actualizarReserva_(r, { revisada: 'sí' }, 'horario revisado por el salón');
  return respuesta_(r);
}

/**
 * Cita creada por el salón (teléfono, WhatsApp, reservas de noviembre/diciembre…). Se comporta como una cita
 * real: bloquea el calendario, queda en la base de datos, recibe recordatorios y (si hay contacto) confirmación.
 * datos: { categoria, servicio, codigo, largo, nombre, celular, correo, fecha, horaInicio, horaFin, comentarios,
 *          precio_min, precio_max, dur_min_h, dur_max_h, enviarWhatsapp, enviarCorreo }
 */
function crearCitaManual(datos) {
  exigirAdmin_();
  var t = function (v, max) { return String(v == null ? '' : v).trim().slice(0, max || 200); };
  if (!t(datos.servicio)) throw new Error('Elegí el servicio.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t(datos.fecha))) throw new Error('Fecha inválida.');
  var r = {
    nombre: t(datos.nombre, 120) || 'Cita manual', celular: t(datos.celular, 40), correo: t(datos.correo, 120),
    categoria: t(datos.categoria), servicio: t(datos.servicio), codigo: t(datos.codigo, 40), largo: t(datos.largo, 40),
    precio_min: Number(datos.precio_min) || 0, precio_max: Number(datos.precio_max) || 0,
    dur_min_h: Number(datos.dur_min_h) || 0, dur_max_h: Number(datos.dur_max_h) || 0,
    fecha_solicitada: t(datos.fecha, 10), hora_solicitada: t(datos.horaInicio, 5),
    comentarios: t(datos.comentarios, 1000), origen: 'manual', revisada: 'sí',
    whatsapp_ok: datos.enviarWhatsapp ? 'sí' : '', estado: ESTADOS.CITA_CONFIRMADA, deposito: 0
  };
  r.franja = horaNumero_(r.hora_solicitada) < CONFIG.CORTE_FRANJA ? 'Mañana' : 'Tarde';
  if (r.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.correo)) throw new Error('El correo no es válido.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    r.id = 'AM-' + Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
    r.creado = new Date();
    r.historial = fechaTexto_(new Date()) + ' · cita creada desde el panel';
    guardarFila_(r);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  r = buscarReserva_(r.id);
  ponerEnCalendario_(r, r.fecha_solicitada, t(datos.horaInicio, 5), t(datos.horaFin, 5));
  actualizarReserva_(r, {}, 'agendada en Google Calendar ' + r.fecha_cita + ' ' + r.hora_inicio + '–' + r.hora_fin);
  var aviso = null;
  if (datos.enviarWhatsapp || datos.enviarCorreo) aviso = avisarClienta_(r, 'confirmada', { whatsapp: !!datos.enviarWhatsapp, correo: !!datos.enviarCorreo });
  return respuesta_(r, aviso);
}

/** "Espacio bloqueado" (vacaciones, ausencia, viaje…): evento gris en Calendar, sin clienta ni avisos. */
function crearBloqueo(fecha, horaInicio, horaFin, motivo, fechaFin) {
  exigirAdmin_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha inválida.');
  var titulo = PREFIJO_BLOQUEO + (motivo ? ' · ' + String(motivo).slice(0, 80) : '');
  var cal = CalendarApp.getDefaultCalendar(), ev;
  if (!horaInicio) {   // días completos (de fecha a fechaFin, inclusive)
    var hasta = fechaFin && fechaFin >= fecha ? fechaFin : fecha;
    ev = cal.createAllDayEvent(titulo, fechaDesdeISO_(fecha), new Date(fechaDesdeISO_(hasta).getTime() + 864e5),
      { description: 'Bloqueo interno creado desde el panel. No es una cita.' });
  } else {
    var ini = fechaHora_(fecha, horaInicio), fin = fechaHora_(fecha, horaFin);
    if (!(fin > ini)) throw new Error('La hora de fin debe ser posterior a la de inicio.');
    ev = cal.createEvent(titulo, ini, fin, { description: 'Bloqueo interno creado desde el panel. No es una cita.' });
  }
  try { ev.setColor(CalendarApp.EventColor.GRAY); } catch (e) { /* opcional */ }
  limpiarCacheCalendario_();
  return { bloqueo: ev.getId() };
}

function quitarBloqueo(eventoId) {
  exigirAdmin_();
  var ev = CalendarApp.getDefaultCalendar().getEventById(eventoId);
  if (!ev) throw new Error('Ese bloqueo ya no existe.');
  if (!esBloqueo_(ev)) throw new Error('Ese evento no es un espacio bloqueado.');
  ev.deleteEvent();
  limpiarCacheCalendario_();
  return { bloqueoQuitado: eventoId };
}

/** Fotos del cabello de una reserva, para el visor del panel (llegan comprimidas desde la página). */
function fotosReserva(id) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  return String(r.fotos_ids || '').split(',').filter(String).map(function (fid) {
    try {
      var b = DriveApp.getFileById(fid).getBlob();
      return { nombre: b.getName(), url: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()), drive: 'https://drive.google.com/file/d/' + fid + '/view' };
    } catch (e) { return { nombre: 'No disponible', url: '', drive: '' }; }
  });
}

/**
 * "Eliminar" desde el panel: la reserva deja de verse y libera su espacio, pero la fila se conserva en la
 * hoja (estado "eliminada") para no perder el registro. También quita su evento de Calendar. No envía correos.
 */
function eliminarReserva(id) {
  exigirAdmin_();
  limpiarCacheCalendario_();
  var r = buscarReserva_(id);
  borrarEvento_(r);
  actualizarReserva_(r, { estado: ESTADOS.ELIMINADA, evento_id: '' }, 'eliminada desde el panel (estado anterior: ' + r.estado + ')');
  return respuesta_(r);
}

/**
 * Cambios de estado sin correo (arrastrar entre pestañas o botones de la tarjeta).
 * Solo se permiten estos destinos; los que envían correo tienen su propia función.
 */
var CAMBIOS_SIN_CORREO = {
  completada: [ESTADOS.CITA_CONFIRMADA, ESTADOS.CITA_AGENDADA, ESTADOS.NO_ASISTIO],
  no_asistio: [ESTADOS.CITA_CONFIRMADA, ESTADOS.CITA_AGENDADA, ESTADOS.COMPLETADA],
  cancelada: [ESTADOS.PAGO_POR_VALIDAR, ESTADOS.PAGO_APROBADO, ESTADOS.DIA_SATURADO, ESTADOS.CITA_AGENDADA, ESTADOS.CITA_CONFIRMADA, ESTADOS.REQUIERE_APROBACION],
  cita_confirmada: [ESTADOS.COMPLETADA, ESTADOS.NO_ASISTIO],          // deshacer "completada"
  pago_por_validar: [ESTADOS.PAGO_RECHAZADO],                        // reabrir reservas antiguas
  requiere_aprobacion: [ESTADOS.CANCELADA, ESTADOS.DIA_SATURADO],      // reabrir
  pago_aprobado: [ESTADOS.CANCELADA, ESTADOS.DIA_SATURADO]
};

function cambiarEstado(id, nuevo) {
  exigirAdmin_();
  limpiarCacheCalendario_();
  var r = buscarReserva_(id);
  var desde = CAMBIOS_SIN_CORREO[nuevo];
  if (!desde || desde.indexOf(r.estado) < 0) throw new Error('No se puede pasar de "' + r.estado + '" a "' + nuevo + '".');
  if (nuevo === ESTADOS.CITA_CONFIRMADA && !r.fecha_cita) throw new Error('Esa reserva no tiene fecha en el calendario.');
  var cambios = { estado: nuevo };
  if (nuevo === ESTADOS.CITA_CONFIRMADA) cambios.revisada = 'sí';
  if (nuevo === ESTADOS.CANCELADA || nuevo === ESTADOS.PAGO_POR_VALIDAR || nuevo === ESTADOS.PAGO_APROBADO || nuevo === ESTADOS.REQUIERE_APROBACION) {
    borrarEvento_(r);
    cambios.evento_id = '';
    cambios.fecha_cita = ''; cambios.hora_inicio = ''; cambios.hora_fin = '';
  }
  actualizarReserva_(r, cambios, 'cambiada a ' + nuevo + ' desde el panel');
  return respuesta_(r);
}

function tituloEvento_(r) { return r.servicio + ' · ' + r.nombre; }

function borrarEvento_(r) {
  if (!r.evento_id) return;
  try { CalendarApp.getDefaultCalendar().getEventById(r.evento_id).deleteEvent(); } catch (e) { /* ya no existe */ }
}

// ------------------------------------------------------------------ Recordatorios 3 días y 1 día (disparador cada 15 minutos)
function enviarRecordatorios() {
  var ahora = new Date().getTime();
  leerReservas_().forEach(function (r) {
    // Cierre automático: una cita confirmada cuya hora de fin ya pasó queda como "completada".
    if (r.estado === ESTADOS.CITA_CONFIRMADA && r.fecha_cita && r.hora_fin &&
        fechaHora_(r.fecha_cita, r.hora_fin).getTime() < ahora) {
      actualizarReserva_(r, { estado: ESTADOS.COMPLETADA }, 'completada automáticamente al terminar la cita');
      return;
    }
    if (r.estado !== ESTADOS.CITA_CONFIRMADA || !r.fecha_cita || !r.hora_inicio) return;
    var inicio = fechaHora_(r.fecha_cita, r.hora_inicio).getTime();
    var faltan = (inicio - ahora) / 36e5;
    // Horas de anticipación con que se hizo la reserva: si reservó con menos de 3 días (o de 1 día), ese
    // recordatorio se omite — acaba de recibir la confirmación con la fecha.
    var anticipacion = horasAnticipacion_(r, inicio);
    if (!r.recordatorio_3d && faltan > 24 && faltan <= 72 && anticipacion !== null && anticipacion <= 72) {
      actualizarReserva_(r, { recordatorio_3d: 'omitido' }, 'recordatorio 3 días omitido (reservó con menos de 3 días)');
      return;
    }
    if (!r.recordatorio_enviado && faltan > 0 && faltan <= 24 && anticipacion !== null && anticipacion <= 24) {
      actualizarReserva_(r, { recordatorio_enviado: 'omitido', recordatorio_3d: r.recordatorio_3d || 'omitido' },
        'recordatorio 1 día omitido (reservó con menos de 1 día)');
      return;
    }
    if (!r.recordatorio_3d && faltan > 24 && faltan <= 72) {
      var envio3 = avisarClienta_(r, 'recordatorio3');
      if (envio3) actualizarReserva_(r, { recordatorio_3d: new Date() }, 'recordatorio 3 días enviado (' + envio3 + ')');
    } else if (!r.recordatorio_enviado && faltan > 0 && faltan <= 24) {
      var envio1 = avisarClienta_(r, 'recordatorio1');
      if (envio1) actualizarReserva_(r, { recordatorio_enviado: new Date(), recordatorio_3d: r.recordatorio_3d || 'omitido' }, 'recordatorio 1 día enviado (' + envio1 + ')');
    }
  });
}

/** Horas entre la creación de la reserva ("yyyy-MM-dd HH:mm") y el inicio de la cita, o null si no se sabe. */
function horasAnticipacion_(r, inicio) {
  var c = r.creado instanceof Date ? r.creado : null;
  if (!c && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(r.creado))) c = fechaHora_(String(r.creado).slice(0, 10), String(r.creado).slice(11, 16));
  return c ? (inicio - c.getTime()) / 36e5 : null;
}

// ------------------------------------------------------------------ Avisos a la clienta (correo + WhatsApp)
/**
 * tipo: 'confirmada' | 'revision' | 'actualizada' | 'recordatorio3' | 'recordatorio1'
 * canales: { whatsapp, correo } (por defecto ambos). Devuelve texto con lo enviado ('correo+whatsapp'…) o ''.
 */
function avisarClienta_(r, tipo, canales) {
  canales = canales || { whatsapp: true, correo: true };
  var enviados = [];
  var correo = {
    confirmada: ['citaConfirmada'], actualizada: ['citaConfirmada'], recordatorio1: ['recordatorio'], recordatorio3: ['recordatorio3d'],
    revision: ['solicitud', { nota_pago: 'Recibimos su reserva. ' + MENSAJE_APROBACION + ' Le escribiremos para confirmarla.' }]
  }[tipo];
  var wa = { confirmada: 'reserva_confirmada', actualizada: 'cita_actualizada', revision: 'reserva_en_revision',
             recordatorio3: 'recordatorio_3_dias', recordatorio1: 'recordatorio_1_dia' }[tipo];
  // Se preparan las dos solicitudes y salen en paralelo (la reserva en la web espera menos).
  var tareas = [];
  if (canales.correo && r.correo && correo) {
    var sc = solicitudCorreo_(correo[0], r, correo[1]);
    if (sc && sc.directo) { if (enviarCorreoDirecto_(correo[0], r, correo[1])) enviados.push('correo'); }
    else if (sc) tareas.push({ canal: 'correo', nombre: correo[0], req: sc });
  }
  if (canales.whatsapp && r.celular && wa) {
    var sw = solicitudWhatsApp_(wa, r);
    if (sw) tareas.push({ canal: 'whatsapp', nombre: wa, req: sw });
  }
  if (tareas.length) {
    var resps = UrlFetchApp.fetchAll(tareas.map(function (t) { return t.req; }));
    resps.forEach(function (resp, i) {
      var ok = resp.getResponseCode() < 300;
      if (ok) enviados.push(tareas[i].canal);
      else console.error(tareas[i].canal + ' ' + tareas[i].nombre + ': ' + resp.getResponseCode() + ' ' + resp.getContentText());
    });
  }
  return enviados.join('+');
}

function whatsappListo_() {
  var p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('WHATSAPP_TOKEN') && p.getProperty('WHATSAPP_PHONE_ID'));
}

/** Número de Costa Rica a formato internacional (8 dígitos → 506XXXXXXXX). */
function telefonoWhatsApp_(cel) {
  var d = String(cel || '').replace(/\D/g, '');
  if (d.length === 8) d = '506' + d;
  return d.length >= 10 ? d : '';
}

/** Envía una plantilla aprobada de WhatsApp (Cloud API de Meta). Sin token configurado no hace nada. */
function enviarWhatsApp_(plantilla, r) {
  var req = solicitudWhatsApp_(plantilla, r);
  if (!req) return false;
  var resp = UrlFetchApp.fetch(req.url, req);
  if (resp.getResponseCode() >= 300) { console.error('WhatsApp ' + plantilla + ': ' + resp.getResponseCode() + ' ' + resp.getContentText()); return false; }
  return true;
}

/** Solicitud lista para UrlFetchApp (o null si no corresponde enviar: sin configurar, sin plantilla o modo prueba). */
function solicitudWhatsApp_(plantilla, r) {
  if (!whatsappListo_()) return null;
  var tel = telefonoWhatsApp_(r.celular);
  var orden = CONFIG.WHATSAPP_API.plantillas[plantilla];
  if (!tel || !orden) return null;
  var p = PropertiesService.getScriptProperties();
  // Modo prueba POR DEFECTO: mientras WHATSAPP_ACTIVO no sea "si", solo se envía al número de pruebas
  // (WHATSAPP_SOLO_NUMERO, o el de Esteban). Las clientas reales no reciben nada hasta encenderlo.
  if (String(p.getProperty('WHATSAPP_ACTIVO') || '').toLowerCase() !== 'si') {
    var soloA = String(p.getProperty('WHATSAPP_SOLO_NUMERO') || '50672808979').replace(/\D/g, '');
    if (tel !== soloA) { console.log('WhatsApp en modo prueba: no se envía a ' + tel); return null; }
  }
  var vals = {
    nombre: String(r.nombre || '').split(' ')[0] || 'clienta', servicio: r.servicio,
    fecha: fechaLarga_(r.fecha_cita || r.fecha_solicitada),
    hora: hora12_(r.hora_inicio || r.hora_solicitada || (r.franja === 'Tarde' ? '13:00' : '09:00')),
    direccion: CONFIG.DIRECCION,
    fecha_dia: fechaLarga_(r.fecha_cita || r.fecha_solicitada).replace(/ de \d{4}$/, '').replace(',', ''),
    inversion: inversion_(r)
  };
  return {
    url: 'https://graph.facebook.com/' + CONFIG.WHATSAPP_API.version + '/' + p.getProperty('WHATSAPP_PHONE_ID') + '/messages',
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + p.getProperty('WHATSAPP_TOKEN') },
    payload: JSON.stringify({
      messaging_product: 'whatsapp', to: tel, type: 'template',
      template: { name: plantilla, language: { code: CONFIG.WHATSAPP_API.idioma },
        components: componentesWhatsApp_(plantilla, orden, vals) }
    })
  };
}

/** Precio para el mensaje: "₡40.000" o "₡40.000 – ₡50.000". */
function inversion_(r) {
  var a = Number(r.precio_min) || 0, b = Number(r.precio_max) || 0;
  if (!a && !b) return 'Según valoración';
  return !b || a === b ? colones_(a || b) : colones_(a) + ' – ' + colones_(b);
}

function componentesWhatsApp_(plantilla, orden, vals) {
  var c = [];
  if (CONFIG.WHATSAPP_API.imagen) c.push({ type: 'header', parameters: [{ type: 'image', image: { link: CONFIG.WHATSAPP_API.imagen } }] });
  c.push({ type: 'body', parameters: orden.map(function (k) { return { type: 'text', text: String(vals[k] || '') }; }) });
  return c;
}

/**
 * Configuración inicial desde el editor (una vez pegado WHATSAPP_TOKEN): busca el número del salón en la cuenta de
 * WhatsApp Business (WHATSAPP_WABA_ID, por defecto la de Amarë) y guarda su ID en WHATSAPP_PHONE_ID.
 * No envía ningún mensaje. El resultado queda en el registro de ejecución.
 */
function configurarWhatsApp() {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('WHATSAPP_TOKEN');
  if (!token) throw new Error('Falta la propiedad WHATSAPP_TOKEN.');
  var waba = p.getProperty('WHATSAPP_WABA_ID') || '391116127424870';
  var resp = UrlFetchApp.fetch('https://graph.facebook.com/' + CONFIG.WHATSAPP_API.version + '/' + waba +
    '/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,status,quality_rating', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  console.log('Respuesta ' + resp.getResponseCode() + ': ' + resp.getContentText());
  if (resp.getResponseCode() >= 300) throw new Error('Meta rechazó la consulta (revisa permisos del token sobre la cuenta ' + waba + ').');
  var numeros = JSON.parse(resp.getContentText()).data || [];
  var salon = numeros.filter(function (n) { return String(n.display_phone_number).replace(/\D/g, '').indexOf('88073849') >= 0; })[0];
  if (!salon) throw new Error('No encontré el +506 8807-3849 en la cuenta ' + waba + '.');
  p.setProperty('WHATSAPP_PHONE_ID', salon.id);
  p.setProperty('WHATSAPP_WABA_ID', waba);
  console.log('Listo: WHATSAPP_PHONE_ID = ' + salon.id + ' (' + salon.verified_name + ', ' + salon.platform_type + ', ' + salon.status + ')');
}

// Textos aprobados por el cliente (oct-2026). {{n}} = variables en el orden de CONFIG.WHATSAPP_API.plantillas.
var PLANTILLAS_WHATSAPP = {
  reserva_confirmada: {
    texto: 'Hola 👋🏻 esperamos que te encuentres muy bien ✨\n\nEn Amarë hemos reservado un espacio especial para ti:\n\n' +
      '📌 {{1}}\n⏰ {{2}}\n📍 Servicio: {{3}}\n💲 Inversión: {{4}}\n\n' +
      '📝 Importante: te recomendamos asistir lo más cómod@ posible para que disfrutes de una experiencia relajante y especial durante tu visita 💫\n\n' +
      'Gracias por confiar en Amarë 🤍\n\n🤍 Recuerda que somos Amarë un espacio donde la belleza nace del amor por servir ✨',
    ejemplo: ['Martes 3 de septiembre', '9:00 a.m.', 'Nanoplastia', '₡40.000']
  },
  recordatorio_1_dia: {
    texto: 'Buenas 💫 esperamos que te encuentres muy bien ✨\n\nQueremos confirmar tu cita para mañana:\n⏰ {{1}}\n\n' +
      'Será un gusto atenderte y brindarte una experiencia especial en Amarë 🤍\n\n' +
      '🤍 Recuerda que somos Amarë un espacio donde la belleza nace del amor por servir ✨',
    ejemplo: ['9:00 a.m.']
  }
};

/**
 * Crea en Meta las plantillas de PLANTILLAS_WHATSAPP (categoría Utilidad, español, encabezado con el logo).
 * Se ejecuta una vez desde el editor; Meta las revisa (minutos a 24 h). Si ya existen, Meta responde con error y no pasa nada.
 */
function crearPlantillasWhatsApp() {
  var p = PropertiesService.getScriptProperties();
  var token = p.getProperty('WHATSAPP_TOKEN'), waba = p.getProperty('WHATSAPP_WABA_ID') || '391116127424870';
  if (!token) throw new Error('Falta WHATSAPP_TOKEN.');
  var base = 'https://graph.facebook.com/' + CONFIG.WHATSAPP_API.version + '/';
  // 1) Subir la imagen del encabezado (API de carga reanudable) para obtener su "handle" de ejemplo
  var img = UrlFetchApp.fetch(CONFIG.WHATSAPP_API.imagen).getBlob();
  var bytes = img.getBytes();
  var sesion = JSON.parse(UrlFetchApp.fetch(base + CONFIG.WHATSAPP_API.appId + '/uploads?file_name=logo.jpg&file_length=' + bytes.length +
    '&file_type=image/jpeg', { method: 'post', headers: { Authorization: 'Bearer ' + token } }).getContentText()).id;
  var subida = UrlFetchApp.fetch(base + sesion, { method: 'post', contentType: 'image/jpeg', payload: bytes,
    headers: { Authorization: 'OAuth ' + token, file_offset: '0' }, muteHttpExceptions: true });
  console.log('Carga del encabezado: ' + subida.getResponseCode() + ' ' + subida.getContentText());
  var handle = JSON.parse(subida.getContentText()).h;
  // 2) Crear cada plantilla
  Object.keys(PLANTILLAS_WHATSAPP).forEach(function (nombre) {
    var t = PLANTILLAS_WHATSAPP[nombre];
    var resp = UrlFetchApp.fetch(base + waba + '/message_templates', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({
        name: nombre, language: CONFIG.WHATSAPP_API.idioma, category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } },
          { type: 'BODY', text: t.texto, example: { body_text: [t.ejemplo] } }
        ]
      })
    });
    console.log(nombre + ': ' + resp.getResponseCode() + ' ' + resp.getContentText());
  });
}

/** Estado de revisión de las plantillas en Meta (APPROVED / PENDING / REJECTED). */
function estadoPlantillasWhatsApp() {
  var p = PropertiesService.getScriptProperties();
  var waba = p.getProperty('WHATSAPP_WABA_ID') || '391116127424870';
  var resp = UrlFetchApp.fetch('https://graph.facebook.com/' + CONFIG.WHATSAPP_API.version + '/' + waba +
    '/message_templates?fields=name,status,category,language,rejected_reason&limit=50',
    { headers: { Authorization: 'Bearer ' + p.getProperty('WHATSAPP_TOKEN') }, muteHttpExceptions: true });
  console.log(resp.getContentText());
}

/**
 * Prueba desde el editor: envía las 5 plantillas SOLO al número de prueba (WHATSAPP_SOLO_NUMERO, o el que se pase).
 * No toca la hoja ni el calendario. Ver el resultado en el registro de ejecución.
 */
function probarWhatsApp(numero) {
  var p = PropertiesService.getScriptProperties();
  var tel = String(numero || p.getProperty('WHATSAPP_SOLO_NUMERO') || '50672808979').replace(/\D/g, '');
  if (!tel) throw new Error('Pon el número de prueba en la propiedad WHATSAPP_SOLO_NUMERO (ej. 50672808979).');
  var hoy = Utilities.formatDate(new Date(Date.now() + 3 * 864e5), CONFIG.ZONA, 'yyyy-MM-dd');
  var r = { nombre: 'Prueba Amarë', celular: tel, servicio: 'Balayage', fecha_solicitada: hoy, fecha_cita: hoy, hora_inicio: '09:00',
            precio_min: 40000, precio_max: 40000 };
  Object.keys(CONFIG.WHATSAPP_API.plantillas).forEach(function (pl) {
    console.log(pl + ': ' + (enviarWhatsApp_(pl, r) ? 'enviado' : 'NO salió (ver errores arriba)'));
  });
}

// ------------------------------------------------------------------ Correos
function parametrosCorreo_(r) {
  var fechaTxt = fechaLarga_(r.fecha_cita || r.fecha_solicitada);
  var horaTxt = r.hora_inicio ? hora12_(r.hora_inicio) + (r.hora_fin ? ' – ' + hora12_(r.hora_fin) : '')
    : (r.hora_solicitada ? hora12_(r.hora_solicitada) : r.franja);
  var p = {
    correo: r.correo,
    nombre: String(r.nombre).split(' ')[0],
    nombre_completo: r.nombre,
    celular: r.celular,
    servicio: r.servicio,
    categoria: r.categoria,
    largo: r.largo,
    precio: colones_(r.precio_min) + (r.precio_max && r.precio_max !== r.precio_min ? ' – ' + colones_(r.precio_max) : ''),
    duracion: duracionTexto_(r.dur_min_h, r.dur_max_h),
    fecha: fechaLarga_(r.fecha_solicitada),
    franja: r.franja,
    fecha_hora: fechaTxt + ' · ' + horaTxt,
    deposito: Number(r.deposito) > 0 ? colones_(r.deposito) + ' (se descuenta del total)' : 'No requiere',
    comentarios: r.comentarios || '—',
    direccion: CONFIG.DIRECCION,
    senales: CONFIG.SENALES,
    waze: CONFIG.WAZE,
    maps: CONFIG.MAPS,
    whatsapp: CONFIG.WHATSAPP,
    correo_salon: CONFIG.CORREO_CITAS,
    reserva_id: r.id,
    calendario_url: ''
  };
  if (r.fecha_cita && r.hora_inicio && r.hora_fin) {
    var fmt = function (d) { return Utilities.formatDate(d, 'UTC', "yyyyMMdd'T'HHmmss'Z'"); };
    p.calendario_url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(r.servicio + ' · Amarë Beauty Center') +
      '&dates=' + fmt(fechaHora_(r.fecha_cita, r.hora_inicio)) + '/' + fmt(fechaHora_(r.fecha_cita, r.hora_fin)) +
      '&location=' + encodeURIComponent(CONFIG.DIRECCION) +
      '&details=' + encodeURIComponent('Su cita en Amarë Beauty Center. ' + CONFIG.SENALES);
  }
  return p;
}

/** Diagnóstico: ejecutar desde el editor. Envía el correo "solicitud" de la última reserva a facturas@ y registra la respuesta de EmailJS. */
function probarCorreo() {
  exigirAdmin_();
  var r = leerReservas_().pop();
  r.correo = CONFIG.ADMIN_EMAIL;
  Logger.log('Resultado: ' + enviarCorreo_('solicitud', r, { nota_pago: 'Prueba de diagnóstico.' }));
}

function enviarCorreo_(clave, r, extra) {
  var req = solicitudCorreo_(clave, r, extra);
  if (!req) return false;
  if (req.directo) return enviarCorreoDirecto_(clave, r, extra);
  var resp = UrlFetchApp.fetch(req.url, req);
  if (resp.getResponseCode() !== 200) {
    console.error('EmailJS ' + clave + ': ' + resp.getResponseCode() + ' ' + resp.getContentText());
    return false;
  }
  return true;
}

/** Solicitud a EmailJS lista para UrlFetchApp; { directo: true } si ese correo sale por Gmail; null si no hay plantilla. */
function solicitudCorreo_(clave, r, extra) {
  var template = PropertiesService.getScriptProperties().getProperty('TEMPLATE_' + clave) || CONFIG.EMAILJS.templates[clave];
  if (!template && CORREOS_DIRECTOS[clave]) return { directo: true };
  if (!template) { console.warn('Template sin configurar: ' + clave); return null; }
  var params = parametrosCorreo_(r);
  Object.keys(extra || {}).forEach(function (k) { params[k] = extra[k]; });
  var cuerpo = {
    service_id: CONFIG.EMAILJS.serviceId,
    template_id: template,
    user_id: CONFIG.EMAILJS.publicKey,
    template_params: params
  };
  // Con "strict mode" activo en EmailJS (Account → Security) hace falta la Private Key.
  // Se guarda en Propiedades del script como EMAILJS_PRIVATE_KEY (nunca en el código).
  var privada = PropertiesService.getScriptProperties().getProperty('EMAILJS_PRIVATE_KEY');
  if (privada) cuerpo.accessToken = privada;
  return { url: 'https://api.emailjs.com/api/v1.0/email/send', method: 'post', contentType: 'application/json',
           muteHttpExceptions: true, payload: JSON.stringify(cuerpo) };
}

/**
 * Correos que no están en EmailJS: se envían desde la cuenta del salón (Gmail) con el HTML publicado en
 * amarecr.com/emails (generado por tools/generar_correos.py). Respuestas → citas@amarecr.com.
 */
var CORREOS_DIRECTOS = {
  recordatorio3d: { archivo: 'recordatorio-3dias.html', asunto: 'Su cita en Amarë es en 3 días · {{servicio}}' }
};

function enviarCorreoDirecto_(clave, r, extra) {
  var def = CORREOS_DIRECTOS[clave];
  if (!r.correo) return false;
  try {
    var cache = CacheService.getScriptCache(), html = cache.get('CORREO_' + clave);
    if (!html) {
      html = UrlFetchApp.fetch('https://amarecr.com/emails/' + def.archivo).getContentText('UTF-8');
      try { cache.put('CORREO_' + clave, html, 21600); } catch (e) { /* muy grande */ }
    }
    var params = parametrosCorreo_(r);
    Object.keys(extra || {}).forEach(function (k) { params[k] = extra[k]; });
    var llenar = function (t) { return t.replace(/\{\{(\w+)\}\}/g, function (m, k) { return params[k] == null ? '' : String(params[k]); }); };
    MailApp.sendEmail({ to: r.correo, subject: llenar(def.asunto), htmlBody: llenar(html),
      name: 'Amarë Beauty Center', replyTo: CONFIG.CORREO_CITAS });
    return true;
  } catch (e) {
    console.error('Correo directo ' + clave + ': ' + e);
    return false;
  }
}

/** Prueba desde el editor: manda el recordatorio de 3 días de muestra al correo de pruebas (no toca la hoja). */
function probarRecordatorio3d() {
  var dia = Utilities.formatDate(new Date(Date.now() + 3 * 864e5), CONFIG.ZONA, 'yyyy-MM-dd');
  var r = { nombre: 'Prueba Amarë', correo: 'estebansantos680@gmail.com', servicio: 'Balayage', categoria: 'Técnica de Color',
            largo: 'Mediano', fecha_cita: dia, fecha_solicitada: dia, hora_inicio: '09:00', hora_fin: '13:00', dur_min_h: 4, dur_max_h: 4, id: 'PRUEBA' };
  console.log('Recordatorio 3 días: ' + (enviarCorreoDirecto_('recordatorio3d', r) ? 'enviado' : 'NO salió'));
}

function avisarAdmin_(r) {
  // URL de la publicación "Panel" (solo cuentas de amarecr.com). Ver INSTALAR.md.
  var url = CONFIG.PANEL_URL;
  var filas = [
    ['Estado', r.estado === ESTADOS.REQUIERE_APROBACION ? 'REQUIERE APROBACIÓN (no está en el calendario todavía)' : 'Agendada en Google Calendar — revisar duración en "Por agendar"'],
    ['Clienta', r.nombre + (r.tipo_cliente ? ' (clienta ' + r.tipo_cliente + ')' : '')], ['Celular', r.celular], ['Correo', r.correo],
    ['Servicio', r.servicio + ' (' + r.categoria + ') · ' + r.largo],
    ['Fecha y hora', fechaLarga_(r.fecha_solicitada) + ' · ' + hora12_(r.hora_solicitada || '09:00')],
    ['Fotos del cabello', r.fotos_ids ? String(r.fotos_ids).split(',').length + ' (ver en el panel)' : 'No adjuntó'],
    ['Expectativas', r.expectativas || '—'],
    ['Depósito', Number(r.deposito) > 0 ? colones_(r.deposito) : 'No requiere'],
    ['Descripción esperada del SINPE', r.descripcion_sinpe || '—'],
    ['Comentarios', r.comentarios || '—'],
    ['Reserva', r.id]
  ];
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#0B0B0B">' +
    '<h2 style="font-weight:normal">Nueva reserva: ' + esc_(r.servicio) + ' · ' + esc_(r.nombre) + '</h2>' +
    '<table cellpadding="8" style="border-collapse:collapse">' +
    filas.map(function (f) { return '<tr><td style="border-bottom:1px solid #eee;color:#8A7A63">' + f[0] + '</td><td style="border-bottom:1px solid #eee">' + esc_(f[1]) + '</td></tr>'; }).join('') +
    '</table>' +
    (r.requiere_aprobacion ? '<p style="background:#f5ecd6;padding:10px 12px"><b>Requiere aprobación:</b> esta reserva completa una combinación de la matriz de reglas. Revísala antes de confirmar.</p>' : '') +
    (r.comprobante_url ? '<p><a href="' + r.comprobante_url + '">Ver comprobante en Drive</a> (también va adjunto)</p>' : '') +
    '<p><a href="' + url + '" style="background:#0B0B0B;color:#F5F3EF;padding:12px 20px;text-decoration:none;display:inline-block">Abrir panel de reservas</a></p></div>';
  var opciones = { htmlBody: html, name: 'Reservas Amarë', replyTo: r.correo };
  if (r.comprobante_id) opciones.attachments = [DriveApp.getFileById(r.comprobante_id).getBlob()];
  MailApp.sendEmail(CONFIG.ADMIN_EMAIL, (r.estado === ESTADOS.REQUIERE_APROBACION ? '[Requiere aprobación] ' : '') +
    'Nueva reserva: ' + r.servicio + ' · ' + r.fecha_solicitada + ' ' + hora12_(r.hora_solicitada || '09:00') + ' · ' + r.nombre, 'Nueva reserva ' + r.id, opciones);
}

// ------------------------------------------------------------------ Utilidades
function fechaDesdeISO_(iso) { var p = iso.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12); }
function horaNumero_(hhmm) { var p = String(hhmm).split(':'); return Number(p[0]) + Number(p[1] || 0) / 60; }
function fechaHora_(iso, hhmm) {
  var p = iso.split('-'), h = String(hhmm).split(':');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), Number(h[0]), Number(h[1] || 0));
}
function fechaTexto_(d) { return Utilities.formatDate(d, CONFIG.ZONA, 'dd/MM/yyyy HH:mm'); }
function fechaLarga_(iso) {
  if (!iso) return '';
  var dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var d = fechaDesdeISO_(iso);
  return dias[d.getDay()] + ', ' + d.getDate() + ' de ' + meses[d.getMonth()] + ' de ' + d.getFullYear();
}
function hora12_(hhmm) {
  var p = String(hhmm).split(':'), h = Number(p[0]), m = p[1] || '00';
  return (h % 12 || 12) + ':' + m + (h < 12 ? ' a.m.' : ' p.m.');
}
function colones_(n) { return '₡' + String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function duracionTexto_(a, b) {
  var f = function (h) { h = Number(h); if (!h) return ''; if (h < 1) return Math.round(h * 60) + ' min'; var e = Math.floor(h), m = Math.round((h - e) * 60); return m ? e + ' h ' + m + ' min' : e + ' h'; };
  var x = f(a), y = f(b);
  return !x ? 'Por confirmar' : (x === y || !y ? x : x + ' – ' + y);
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
