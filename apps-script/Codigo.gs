/**
 * AMARË Beauty Center — Servidor de reservas (Google Apps Script)
 * Corre con la cuenta facturas@amarecr.com.
 *
 * Qué hace:
 *  - Recibe cada reserva del sitio (doPost): la guarda en la hoja "Reservas",
 *    guarda el comprobante en Drive, avisa a facturas@ y envía al cliente el
 *    correo "Solicitud recibida" (EmailJS).
 *  - Publica la ocupación de cada día (doGet ?accion=disponibilidad) y la matriz de
 *    reglas (pestaña "Reglas" de la hoja) para que la reserva en línea cierre lo lleno.
 *  - Sirve el panel de administración (doGet sin parámetros), solo para
 *    facturas@amarecr.com con sesión de Google.
 *  - Envía el recordatorio 24 h antes de cada cita confirmada (disparador horario).
 *
 * Ciclo de estados:
 *   pago_por_validar → pago_aprobado → cita_agendada → cita_confirmada → completada / no_asistio
 *                    ↘ pago_rechazado   ↘ dia_saturado → (nueva fecha) ↗
 *   Cualquiera puede pasar a cancelada o eliminada (eliminada solo se oculta; la fila queda).
 *
 * Instalación: ver apps-script/INSTALAR.md
 */

// ------------------------------------------------------------------ Config
var CONFIG = {
  ADMIN_EMAIL: 'facturas@amarecr.com',
  // Publicación "Panel admin" (acceso: solo facturas@). La otra publicación es la API pública.
  PANEL_URL: 'https://script.google.com/a/macros/amarecr.com/s/AKfycbyNGq-K0H7scCaGoJwNtsLFgL7YcKL2q4UHhXm9V01VIWo0rPPoyQJQKNrd1sJ2vLVM/exec',
  ZONA: 'America/Costa_Rica',
  TOPE_DIA: 6,                 // tope de seguridad: máximo de reservas por día, sin importar la franja
  DIAS_CERRADOS: [0, 1],       // domingo y lunes
  HORA_MANANA: [9, 13],        // la mañana va de 9:00 a 13:00
  HORA_TARDE: [13, 18],        // la tarde de 13:00 a 18:00
  HORAS_SERVICIO_LARGO: 4,     // > 4 h ocupa mañana y tarde
  DIAS_DISPONIBILIDAD: 120,
  DIRECCION: 'Calle 42, San José, Costa Rica',
  SENALES: 'Casa color blanca a mano izquierda, contiguo a Minisuper AMD, antes del reductor de velocidad.',
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
      recordatorio: 'template_36l8drt'    // 6. Recordatorio 24 h
    }
  }
};

var ESTADOS = {
  PAGO_POR_VALIDAR: 'pago_por_validar',
  PAGO_APROBADO: 'pago_aprobado',
  PAGO_RECHAZADO: 'pago_rechazado',
  DIA_SATURADO: 'dia_saturado',
  CITA_AGENDADA: 'cita_agendada',     // ya está en Google Calendar, falta confirmarle a la clienta
  CITA_CONFIRMADA: 'cita_confirmada',
  CANCELADA: 'cancelada',
  COMPLETADA: 'completada',           // la cita ya pasó (automático al terminar o manual)
  NO_ASISTIO: 'no_asistio',
  ELIMINADA: 'eliminada'              // oculta del panel; la fila se conserva en la hoja
};

/** Reservas que ocupan espacio en el día (desde que entran, aunque el pago no esté validado). */
var ESTADOS_ACTIVOS = ['pago_por_validar', 'pago_aprobado', 'cita_agendada', 'cita_confirmada'];

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
  'requiere_aprobacion'
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
    var dias = resumenDias_(leerReservas_());
    return json_({
      ok: true, dias: dias, tope: CONFIG.TOPE_DIA,
      reglas: obtenerReglas_(),
      bloqueos: bloqueosCompat_(dias) // para páginas con la versión anterior en caché
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

    r.estado = ESTADOS.PAGO_POR_VALIDAR;
    var archivo = null;
    if (datos.comprobante && datos.comprobante.base64) {
      // Fuera del candado: subir a Drive es lo más lento y no debe hacer esperar a otras reservas.
      archivo = guardarComprobante_(r, datos.comprobante);
      r.comprobante_url = archivo.getUrl();
      r.comprobante_id = archivo.getId();
    } else if (Number(r.deposito) > 0) {
      return json_({ ok: false, error: 'falta_comprobante' });
    } else {
      r.estado = ESTADOS.PAGO_APROBADO; // sin depósito: pasa directo a agendar
    }

    // Revisar cupo y guardar dentro del candado: si llegan varias a la vez, se atienden una por una
    // y nunca se vende dos veces el último espacio.
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var decision = evaluarDia_(resumenDias_(leerReservas_())[r.fecha_solicitada], r.categoria, r.franja, obtenerReglas_());
      if (decision.accion === 'bloquear') {
        if (archivo) archivo.setTrashed(true);
        return json_({ ok: false, error: 'franja_llena', mensaje: decision.mensaje });
      }
      r.requiere_aprobacion = decision.accion === 'aprobacion' ? 'sí' : '';
      r.id = 'AM-' + Utilities.formatDate(new Date(), CONFIG.ZONA, 'yyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
      r.creado = new Date();
      r.historial = fechaTexto_(new Date()) + ' · reserva recibida desde la web';
      guardarFila_(r);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    avisarAdmin_(r);
    enviarCorreo_('solicitud', r, {
      nota_pago: (Number(r.deposito) > 0
        ? 'Recibimos su comprobante del depósito de ' + colones_(r.deposito) + '. Nuestro equipo lo validará y le confirmará la hora exacta de su cita.'
        : 'Este servicio no requiere depósito. En breve le confirmamos la hora exacta de su cita.') +
        (r.requiere_aprobacion ? ' ' + MENSAJE_APROBACION : '')
    });
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
  r.franja = x.franja === 'Tarde' ? 'Tarde' : 'Mañana';
  r.horario_sugerido = texto(x.horario_sugerido, 120);
  r.deposito = Number(x.deposito) || 0;
  r.descripcion_sinpe = texto(x.descripcion_sinpe, 120);
  r.comentarios = texto(x.comentarios, 1000);
  if (r.nombre.length < 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.correo) || !r.servicio) return { error: 'datos_incompletos' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.fecha_solicitada)) return { error: 'fecha_invalida' };
  var d = fechaDesdeISO_(r.fecha_solicitada);
  if (CONFIG.DIAS_CERRADOS.indexOf(d.getDay()) >= 0) return { error: 'dia_cerrado' };
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
// Regla: cada reserva ocupa espacio desde que entra (aunque el pago no esté validado).
// El día se llena por la matriz de la pestaña "Reglas" (por categoría) o al llegar a TOPE_DIA reservas.
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
function evaluarDia_(dia, categoria, franja, reglas) {
  dia = dia || { total: 0, cats: {} };
  if (dia.total >= CONFIG.TOPE_DIA) return { accion: 'bloquear', mensaje: 'Ese día ya está completo.' };
  var cat = norm_(categoria), fr = norm_(franja), resultado = { accion: 'permitir', mensaje: '' };
  reglas.forEach(function (g) {
    if (g.solicitado !== cat) return;
    if (g.franja && g.franja !== 'cualquier hora' && g.franja !== fr) return;
    var faltan = {};
    g.existentes.forEach(function (e) { faltan[e] = (faltan[e] || 0) + 1; });
    for (var e in faltan) if ((dia.cats[e] || 0) < faltan[e]) return;
    if (g.accion === 'no permitir') resultado = { accion: 'bloquear', mensaje: g.mensaje || 'Ese día ya no tenemos espacio para este servicio.' };
    else if (resultado.accion !== 'bloquear') resultado = { accion: 'aprobacion', mensaje: g.mensaje || MENSAJE_APROBACION };
  });
  return resultado;
}

var MENSAJE_APROBACION = 'Este servicio requiere validación del equipo AMARË antes de confirmar la reserva.';

/** Días completos (tope diario) en el formato viejo { fecha: { manana, tarde } }. */
function bloqueosCompat_(dias) {
  var b = {};
  Object.keys(dias).forEach(function (f) { if (dias[f].total >= CONFIG.TOPE_DIA) b[f] = { manana: true, tarde: true }; });
  return b;
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
    reservas: reservas, tope: CONFIG.TOPE_DIA, activos: ESTADOS_ACTIVOS,
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
      celular: r.celular || ''
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

/**
 * "Eliminar" desde el panel: la reserva deja de verse y libera su espacio, pero la fila se conserva en la
 * hoja (estado "eliminada") para no perder el registro. También quita su evento de Calendar. No envía correos.
 */
function eliminarReserva(id) {
  exigirAdmin_();
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
  cancelada: [ESTADOS.PAGO_POR_VALIDAR, ESTADOS.PAGO_APROBADO, ESTADOS.DIA_SATURADO, ESTADOS.CITA_AGENDADA, ESTADOS.CITA_CONFIRMADA],
  cita_confirmada: [ESTADOS.COMPLETADA, ESTADOS.NO_ASISTIO],          // deshacer "completada"
  pago_por_validar: [ESTADOS.PAGO_RECHAZADO, ESTADOS.CANCELADA],     // reabrir
  pago_aprobado: [ESTADOS.CANCELADA, ESTADOS.DIA_SATURADO]
};

function cambiarEstado(id, nuevo) {
  exigirAdmin_();
  var r = buscarReserva_(id);
  var desde = CAMBIOS_SIN_CORREO[nuevo];
  if (!desde || desde.indexOf(r.estado) < 0) throw new Error('No se puede pasar de "' + r.estado + '" a "' + nuevo + '".');
  if (nuevo === ESTADOS.CITA_CONFIRMADA && !r.fecha_cita) throw new Error('Esa reserva no tiene fecha en el calendario.');
  var cambios = { estado: nuevo };
  if (nuevo === ESTADOS.CANCELADA || nuevo === ESTADOS.PAGO_POR_VALIDAR || nuevo === ESTADOS.PAGO_APROBADO) {
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

// ------------------------------------------------------------------ Recordatorio 24 h (disparador cada 15 minutos)
function enviarRecordatorios() {
  var ahora = new Date().getTime();
  leerReservas_().forEach(function (r) {
    // Cierre automático: una cita confirmada cuya hora de fin ya pasó queda como "completada".
    if (r.estado === ESTADOS.CITA_CONFIRMADA && r.fecha_cita && r.hora_fin &&
        fechaHora_(r.fecha_cita, r.hora_fin).getTime() < ahora) {
      actualizarReserva_(r, { estado: ESTADOS.COMPLETADA }, 'completada automáticamente al terminar la cita');
      return;
    }
    if (r.estado !== ESTADOS.CITA_CONFIRMADA || r.recordatorio_enviado || !r.fecha_cita || !r.hora_inicio) return;
    var faltan = (fechaHora_(r.fecha_cita, r.hora_inicio).getTime() - ahora) / 36e5;
    if (faltan > 0 && faltan <= 24) {
      if (enviarCorreo_('recordatorio', r)) {
        actualizarReserva_(r, { recordatorio_enviado: new Date() }, 'recordatorio 24 h enviado');
      }
    }
  });
}

// ------------------------------------------------------------------ Correos
function parametrosCorreo_(r) {
  var fechaTxt = fechaLarga_(r.fecha_cita || r.fecha_solicitada);
  var horaTxt = r.hora_inicio ? hora12_(r.hora_inicio) + (r.hora_fin ? ' – ' + hora12_(r.hora_fin) : '') : r.franja;
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
  var template = PropertiesService.getScriptProperties().getProperty('TEMPLATE_' + clave) || CONFIG.EMAILJS.templates[clave];
  if (!template) { console.warn('Template sin configurar: ' + clave); return false; }
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
  var resp = UrlFetchApp.fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify(cuerpo)
  });
  if (resp.getResponseCode() !== 200) {
    console.error('EmailJS ' + clave + ': ' + resp.getResponseCode() + ' ' + resp.getContentText());
    return false;
  }
  return true;
}

function avisarAdmin_(r) {
  // URL de la publicación "Panel" (solo cuentas de amarecr.com). Ver INSTALAR.md.
  var url = CONFIG.PANEL_URL;
  var filas = [
    ['Estado', r.estado === ESTADOS.PAGO_POR_VALIDAR ? 'Pago por validar' : 'Sin depósito — por agendar'],
    ['Clienta', r.nombre], ['Celular', r.celular], ['Correo', r.correo],
    ['Servicio', r.servicio + ' (' + r.categoria + ') · ' + r.largo],
    ['Fecha solicitada', fechaLarga_(r.fecha_solicitada) + ' · ' + r.franja],
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
  MailApp.sendEmail(CONFIG.ADMIN_EMAIL, (r.estado === ESTADOS.PAGO_POR_VALIDAR ? '[Validar pago] ' : '') +
    'Nueva reserva: ' + r.servicio + ' · ' + r.fecha_solicitada + ' ' + r.franja + ' · ' + r.nombre, 'Nueva reserva ' + r.id, opciones);
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
