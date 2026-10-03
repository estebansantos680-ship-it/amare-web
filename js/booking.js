/* AMARË — Reserva de cita en línea (reservar.html)
   Flujo: servicio → largo → fecha/franja → datos del cliente → confirmar.
   Al confirmar:
     0. Si el servicio requiere depósito, el cliente hace SINPE/transferencia y
        adjunta el comprobante (JPG/PNG/PDF, obligatorio) antes de confirmar.
     1. Se envían dos correos:
        - Al negocio (facturas@amarecr.com, FormSubmit): pedido completo +
          comprobante adjunto
          + "datos_json" para la automatización en Python → Google Calendar.
        - Al cliente: correo con diseño vía EmailJS (plantilla en
          emails/confirmacion-cliente.html); respaldo de texto por FormSubmit.
     2. La pantalla final ofrece avisar por WhatsApp con el resumen.
   Llegada desde una página de servicio: reservar.html?cat=<categoría>&svc=<servicio>.
   Datos de servicios y precios: js/services-data.js */
(function () {
  'use strict';

  var SERVICES = window.AMARE_SERVICES || [];
  var WHATSAPP_NUMBER = '50688073849';
  // FormSubmit pide activar cada dirección una sola vez ("Activate form").
  // facturas@  → reenvía al Gmail del negocio (pedido completo + datos_json).
  // confirmaciones@ → solo dispara el correo de agradecimiento al cliente;
  //                   Cloudflare descarta la copia que llega a esta dirección.
  var ENDPOINT_NEGOCIO = 'https://formsubmit.co/ajax/facturas@amarecr.com';
  var ENDPOINT_NEGOCIO_ADJUNTOS = 'https://formsubmit.co/facturas@amarecr.com'; // admite comprobante adjunto
  var ENDPOINT_CLIENTE = 'https://formsubmit.co/ajax/confirmaciones@amarecr.com';

  // Servidor de reservas (Google Apps Script, publicación "API pública"). Ver apps-script/INSTALAR.md.
  // Vacío = se usa el flujo anterior (FormSubmit + EmailJS desde el navegador).
  var API_URL = 'https://script.google.com/macros/s/AKfycbzQPBJ3dz8Q201ef0V-dSdVjXwnNK4jmCOQxbSEZvCzqPlHiYYP6A3p6QXuFTjbEyvX/exec';

  // EmailJS: correo con diseño al cliente (plantilla emails/confirmacion-cliente.html).
  // Plan gratis: 200 envíos/mes → solo se usa para el cliente. Si falta algún dato,
  // el sitio vuelve a usar el correo de texto de FormSubmit (ENDPOINT_CLIENTE).
  var EMAILJS = {
    serviceId: 'service_q9qzz65',   // Email Services → Service ID
    templateId: 'template_nrvafoo', // Email Templates → Template ID
    publicKey: 'Yrbk48Pzaxg_eptQn', // Account → General → Public Key
  };

  var state = {
    service: null,
    lengthLabel: null,
    tier: null,
    fecha: null,
    franja: null,
    cliente: null,
    comprobante: null, // File (JPG/PNG/PDF) del SINPE/transferencia
  };

  /* ---------- Helpers ---------- */
  function money(n) {
    return '₡' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function priceRangeLabel(tier) {
    return tier.min === tier.max ? money(tier.min) : money(tier.min) + ' – ' + money(tier.max);
  }

  function hoursLabel(h) {
    if (h == null) return null;
    if (h < 1) return Math.round(h * 60) + ' min';
    if (Number.isInteger(h)) return h + ' h';
    var hh = Math.floor(h);
    var mm = Math.round((h - hh) * 60);
    return hh + ' h ' + mm + ' min';
  }

  function durationLabel(tier) {
    var a = hoursLabel(tier.durMin);
    var b = hoursLabel(tier.durMax);
    if (!a) return '';
    return a === b ? a : a + ' – ' + b;
  }

  // Regla del salón (Blueprint → Pendientes P-001):
  //   procedimientos de ₡25.000 a ₡60.000 → depósito ₡15.000
  //   procedimientos de ₡60.000 en adelante → depósito ₡25.000
  //   menos de ₡25.000 → sin depósito
  // Se usa el precio máximo del largo elegido para no quedar por debajo.
  function calcDeposito(precioMax, requiereDeposito) {
    if (!requiereDeposito || precioMax < 25000) {
      return { requerido: false, monto: 0 };
    }
    if (precioMax < 60000) {
      return { requerido: true, monto: 15000 };
    }
    return { requerido: true, monto: 25000 };
  }

  function fechaLegible(iso) {
    var d = new Date(iso + 'T12:00:00');
    var txt = d.toLocaleDateString('es-CR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- Elements ---------- */
  var els = {
    steps: document.querySelectorAll('#bookingSteps .step'),
    panels: document.querySelectorAll('.booking-panel'),
    selCategoria: document.getElementById('selCategoria'),
    selServicio: document.getElementById('selServicio'),
    toStep2: document.getElementById('toStep2'),
    svcName: document.getElementById('svcName'),
    svcDesc: document.getElementById('svcDesc'),
    lengthGrid: document.getElementById('lengthGrid'),
    toStep3: document.getElementById('toStep3'),
    inpFecha: document.getElementById('inpFecha'),
    franjaButtons: document.querySelectorAll('.franja-option'),
    availabilityResult: document.getElementById('availabilityResult'),
    toStep4: document.getElementById('toStep4'),
    inpNombre: document.getElementById('inpNombre'),
    inpCelular: document.getElementById('inpCelular'),
    inpCorreo: document.getElementById('inpCorreo'),
    inpNotas: document.getElementById('inpNotas'),
    datosError: document.getElementById('datosError'),
    toStep5: document.getElementById('toStep5'),
    bookingSummary: document.getElementById('bookingSummary'),
    chkPolicy: document.getElementById('chkPolicy'),
    envioError: document.getElementById('envioError'),
    btnConfirmar: document.getElementById('btnConfirmar'),
    doneTitle: document.getElementById('doneTitle'),
    doneTexto: document.getElementById('doneTexto'),
    doneWhatsapp: document.getElementById('doneWhatsapp'),
    box: document.getElementById('bookingBox'),
    pagoBox: document.getElementById('pagoBox'),
    pagoMonto: document.getElementById('pagoMonto'),
    pagoConcepto: document.getElementById('pagoConcepto'),
    copiarConcepto: document.getElementById('copiarConcepto'),
    uploadZona: document.getElementById('uploadZona'),
    inpComprobante: document.getElementById('inpComprobante'),
    comprobantePreview: document.getElementById('comprobantePreview'),
    comprobanteThumb: document.getElementById('comprobanteThumb'),
    comprobanteNombre: document.getElementById('comprobanteNombre'),
    comprobanteTam: document.getElementById('comprobanteTam'),
    quitarComprobante: document.getElementById('quitarComprobante'),
  };

  if (!els.bookingSummary) return; // esta página no está cargada

  var currentCategoryServices = [];

  /* ---------- Navegación entre pasos ---------- */
  function goToStep(n) {
    els.panels.forEach(function (p) {
      p.hidden = p.getAttribute('data-panel') !== String(n);
    });
    els.steps.forEach(function (s) {
      var step = Number(s.getAttribute('data-step'));
      s.classList.toggle('active', step === n);
      s.classList.toggle('done', step < n);
    });
    // En celular, llevar la vista al inicio del formulario
    var top = els.box.getBoundingClientRect().top;
    if (top < 0) els.box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  document.querySelectorAll('[data-prev]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      goToStep(Number(btn.getAttribute('data-prev')));
    });
  });

  /* ---------- Paso 1: categoría + servicio ---------- */
  els.selCategoria.addEventListener('change', function () {
    var cat = els.selCategoria.value;
    currentCategoryServices = SERVICES.filter(function (s) { return s.categoria === cat; });
    els.selServicio.innerHTML = '';
    if (!cat) {
      els.selServicio.disabled = true;
      var optEmpty = document.createElement('option');
      optEmpty.value = '';
      optEmpty.textContent = 'Elige primero una categoría';
      els.selServicio.appendChild(optEmpty);
    } else {
      els.selServicio.disabled = false;
      var opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = 'Elige un servicio';
      els.selServicio.appendChild(opt0);
      currentCategoryServices.forEach(function (s, i) {
        var opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = s.servicio;
        els.selServicio.appendChild(opt);
      });
    }
    state.service = null;
    els.toStep2.disabled = true;
  });

  els.selServicio.addEventListener('change', function () {
    var idx = els.selServicio.value;
    state.service = idx === '' ? null : currentCategoryServices[Number(idx)];
    els.toStep2.disabled = !state.service;
  });

  els.toStep2.addEventListener('click', function () {
    if (!state.service) return;
    renderStep2();
    goToStep(2);
    if (window.amareTrack) window.amareTrack('reserva_iniciada', { servicio: state.service.servicio });
  });

  /* ---------- Llegada desde "Reservar este servicio" (?cat=...&svc=...) ---------- */
  function preseleccionarDesdeURL() {
    var params = new URLSearchParams(window.location.search);
    var cat = params.get('cat');
    var svc = params.get('svc');
    if (!cat) return;
    var existeCat = Array.prototype.some.call(els.selCategoria.options, function (o) { return o.value === cat; });
    if (!existeCat) return;
    els.selCategoria.value = cat;
    els.selCategoria.dispatchEvent(new Event('change'));
    if (!svc) return;
    var idx = -1;
    currentCategoryServices.forEach(function (s, i) { if (s.servicio === svc) idx = i; });
    if (idx < 0) return;
    els.selServicio.value = String(idx);
    els.selServicio.dispatchEvent(new Event('change'));
    renderStep2();
    goToStep(2);
    setTimeout(function () { els.box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 250);
  }

  /* ---------- Paso 2: largo de cabello ---------- */
  function renderStep2() {
    var s = state.service;
    els.svcName.textContent = s.servicio;
    var notas = [s.descripcion];
    if (s.horario) notas.push('Horario sugerido: ' + s.horario + '.');
    els.svcDesc.textContent = notas.join(' ');

    els.lengthGrid.innerHTML = '';
    state.lengthLabel = null;
    state.tier = null;
    els.toStep3.disabled = true;

    Object.keys(s.tiers).forEach(function (label) {
      var tier = s.tiers[label];
      var div = document.createElement('button');
      div.type = 'button';
      div.className = 'length-option';
      div.setAttribute('data-length', label);
      div.innerHTML =
        '<span class="len-label">' + label + '</span>' +
        '<span class="len-price">' + priceRangeLabel(tier) + '</span>';
      div.addEventListener('click', function () {
        els.lengthGrid.querySelectorAll('.length-option').forEach(function (el) {
          el.classList.remove('selected');
        });
        div.classList.add('selected');
        state.lengthLabel = label;
        state.tier = tier;
        els.toStep3.disabled = false;
      });
      els.lengthGrid.appendChild(div);
    });
  }

  els.toStep3.addEventListener('click', function () {
    if (!state.tier) return;
    goToStep(3);
    prepararPaso3();
  });

  /* ---------- Paso 3: fecha y franja ---------- */
  // Calendario propio: el selector nativo no permite bloquear días específicos.
  // Se bloquean días pasados, domingos y lunes, y los días llenos según el servidor
  // (API_URL ?accion=disponibilidad): cada reserva ocupa espacio desde que entra,
  // hay un tope de reservas por día y la matriz de reglas (pestaña "Reglas" de la hoja)
  // decide por categoría (No permitir / Requiere aprobación). Se consulta de nuevo al
  // entrar al paso 3, así un rechazo o cancelación libera el día con solo refrescar.
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  // Hasta dónde se puede reservar en línea (último día incluido).
  var FECHA_MAX = new Date(2030, 11, 31, 23, 59);
  var dispo = { dias: {}, reglas: [], tope: 6 };
  var mesVisible = null;

  function toLocalISODate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function cargarBloqueos() {
    if (!API_URL) return Promise.resolve();
    return fetch(API_URL + '?accion=disponibilidad&t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ok && j.dias) dispo = { dias: j.dias, reglas: j.reglas || [], tope: j.tope || 6 }; })
      .catch(function () { /* sin conexión al servidor: solo se bloquean días cerrados */ });
  }

  function norm(t) {
    return String(t == null ? '' : t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // Misma lógica que el servidor (Codigo.gs → evaluarDia_): { accion: 'permitir' | 'aprobacion' | 'bloquear', mensaje }
  function evaluarDia(iso, franja) {
    var dia = dispo.dias[iso] || { total: 0, cats: {} };
    if (dia.total >= dispo.tope) return { accion: 'bloquear', mensaje: 'Ese día ya está completo.' };
    var cat = norm(state.service && state.service.categoria), fr = norm(franja);
    var res = { accion: 'permitir', mensaje: '' };
    dispo.reglas.forEach(function (g) {
      if (g.solicitado !== cat) return;
      if (g.franja && g.franja !== 'cualquier hora' && g.franja !== fr) return;
      var faltan = {};
      g.existentes.forEach(function (e) { faltan[e] = (faltan[e] || 0) + 1; });
      for (var e in faltan) if ((dia.cats[e] || 0) < faltan[e]) return;
      if (g.accion === 'no permitir') res = { accion: 'bloquear', mensaje: g.mensaje || 'Ese día ya no tenemos espacio para este servicio.' };
      else if (res.accion !== 'bloquear') res = { accion: 'aprobacion', mensaje: g.mensaje || MENSAJE_APROBACION };
    });
    return res;
  }
  var MENSAJE_APROBACION = 'Este servicio requiere validación del equipo AMARË antes de confirmar la reserva.';

  function esServicioLargo() {
    return state.tier && Number(state.tier.durMax) > 4;
  }

  // Devuelve null si el día se puede elegir, o el motivo del bloqueo.
  function motivoDiaBloqueado(iso) {
    var d = new Date(iso + 'T12:00:00');
    var hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    if (d < hoy) return 'pasado';
    if (d.getDay() === 0 || d.getDay() === 1) return 'cerrado';
    if (d > FECHA_MAX) return 'lejos';
    if (evaluarDia(iso, 'Mañana').accion === 'bloquear' && evaluarDia(iso, 'Tarde').accion === 'bloquear') return 'lleno';
    return null;
  }

  function capitalizar(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  // Selectores de mes y año para saltar rápido a fechas lejanas (hasta FECHA_MAX).
  function selectorMes(y, m, minMes, maxMes) {
    var h = '<select class="cal-mes" aria-label="Mes">';
    MESES.forEach(function (nombre, i) {
      var f = new Date(y, i, 1);
      var fuera = f < minMes || f > maxMes;
      h += '<option value="' + i + '"' + (i === m ? ' selected' : '') + (fuera ? ' disabled' : '') + '>' + capitalizar(nombre) + '</option>';
    });
    return h + '</select>';
  }
  function selectorAnio(y, minMes, maxMes) {
    var h = '<select class="cal-anio" aria-label="Año">';
    for (var a = minMes.getFullYear(); a <= maxMes.getFullYear(); a++) {
      h += '<option value="' + a + '"' + (a === y ? ' selected' : '') + '>' + a + '</option>';
    }
    return h + '</select>';
  }

  function renderCalendario() {
    var cont = document.getElementById('calendario');
    if (!cont) return;
    var hoy = new Date();
    if (!mesVisible) mesVisible = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    var y = mesVisible.getFullYear(), m = mesVisible.getMonth();
    var primero = new Date(y, m, 1);
    var diasMes = new Date(y, m + 1, 0).getDate();
    var desfase = (primero.getDay() + 6) % 7; // la semana inicia en lunes
    var minMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    var maxMes = new Date(FECHA_MAX.getFullYear(), FECHA_MAX.getMonth(), 1);

    var h = '<div class="cal-head">' +
      '<button type="button" class="cal-nav" data-mes="-1"' + (primero <= minMes ? ' disabled' : '') + ' aria-label="Mes anterior">‹</button>' +
      '<span class="cal-sel">' + selectorMes(y, m, minMes, maxMes) + selectorAnio(y, minMes, maxMes) + '</span>' +
      '<button type="button" class="cal-nav" data-mes="1"' + (primero >= maxMes ? ' disabled' : '') + ' aria-label="Mes siguiente">›</button></div>' +
      '<div class="cal-grid">' + ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(function (d) { return '<span class="cal-dow">' + d + '</span>'; }).join('');
    for (var i = 0; i < desfase; i++) h += '<span></span>';
    for (var dia = 1; dia <= diasMes; dia++) {
      var iso = toLocalISODate(new Date(y, m, dia));
      var motivo = motivoDiaBloqueado(iso);
      var clases = 'cal-dia' + (motivo ? ' off ' + motivo : '') + (state.fecha === iso ? ' selected' : '');
      var titulo = { cerrado: 'Cerrado', lleno: 'Día lleno', pasado: 'Fecha pasada', lejos: 'Aún no disponible' }[motivo] || 'Disponible';
      h += '<button type="button" class="' + clases + '" data-fecha="' + iso + '"' + (motivo ? ' disabled' : '') + ' title="' + titulo + '">' + dia + '</button>';
    }
    h += '</div><p class="cal-leyenda"><span class="punto libre"></span>Disponible <span class="punto lleno"></span>Lleno <span class="punto cerrado"></span>Cerrado</p>';
    cont.innerHTML = h;
  }

  document.addEventListener('change', function (e) {
    if (!e.target.matches || !e.target.matches('.cal-mes, .cal-anio')) return;
    var cont = document.getElementById('calendario');
    var y = Number(cont.querySelector('.cal-anio').value), m = Number(cont.querySelector('.cal-mes').value);
    var hoy = new Date(), minMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    var maxMes = new Date(FECHA_MAX.getFullYear(), FECHA_MAX.getMonth(), 1);
    var f = new Date(y, m, 1);
    if (f < minMes) f = minMes;
    if (f > maxMes) f = maxMes;
    mesVisible = f;
    renderCalendario();
  });

  document.addEventListener('click', function (e) {
    var nav = e.target.closest && e.target.closest('.cal-nav');
    if (nav && !nav.disabled) {
      mesVisible = new Date(mesVisible.getFullYear(), mesVisible.getMonth() + Number(nav.getAttribute('data-mes')), 1);
      renderCalendario();
      return;
    }
    var dia = e.target.closest && e.target.closest('.cal-dia');
    if (dia && !dia.disabled) {
      els.inpFecha.value = dia.getAttribute('data-fecha');
      els.inpFecha.dispatchEvent(new Event('change'));
      renderCalendario();
    }
  });

  function prepararPaso3() {
    renderCalendario();
    cargarBloqueos().then(function () {
      // Si la fecha elegida se llenó mientras tanto, se deselecciona.
      if (state.fecha && motivoDiaBloqueado(state.fecha)) {
        els.inpFecha.value = '';
        els.inpFecha.dispatchEvent(new Event('change'));
      }
      renderCalendario();
      actualizarFranjas();
    });
  }

  function actualizarFranjas() {
    els.franjaButtons.forEach(function (btn) {
      var llena = !!state.fecha && evaluarDia(state.fecha, btn.getAttribute('data-franja')).accion === 'bloquear';
      btn.disabled = llena;
      btn.classList.toggle('llena', llena);
      btn.textContent = btn.getAttribute('data-franja') + (llena ? ' · lleno' : '');
    });
  }

  function resetFranjaSelection() {
    state.franja = null;
    els.franjaButtons.forEach(function (b) { b.classList.remove('selected'); });
    els.availabilityResult.hidden = true;
    els.toStep4.disabled = true;
  }

  function showFranjaMessage() {
    if (!state.fecha || !state.franja) return;
    els.availabilityResult.hidden = false;
    els.availabilityResult.className = 'availability-result ok';
    els.availabilityResult.textContent =
      '¡Excelente elección! Solicitaremos tu espacio para el ' + fechaLegible(state.fecha).toLowerCase() +
      ' en la ' + state.franja.toLowerCase() + '. Nuestro equipo te confirma la hora exacta.';
    var ev = evaluarDia(state.fecha, state.franja);
    if (ev.accion === 'aprobacion') {
      els.availabilityResult.className = 'availability-result review';
      els.availabilityResult.textContent += ' ' + ev.mensaje;
    }
    els.toStep4.disabled = false;
  }

  els.inpFecha.addEventListener('change', function () {
    resetFranjaSelection();
    state.fecha = null;
    if (!els.inpFecha.value) { actualizarFranjas(); return; }
    var motivo = motivoDiaBloqueado(els.inpFecha.value);
    if (motivo) {
      els.availabilityResult.hidden = false;
      els.availabilityResult.className = 'availability-result full';
      els.availabilityResult.textContent = motivo === 'lleno'
        ? 'Ese día ya está lleno. Elige otra fecha, por favor.'
        : 'Domingos y lunes descansamos. Elige un día de martes a sábado.';
      actualizarFranjas();
      return;
    }
    state.fecha = els.inpFecha.value;
    actualizarFranjas();
    // Servicios de más de 4 h ocupan mañana y tarde: se preselecciona la mañana.
    if (esServicioLargo() && !els.franjaButtons[0].disabled) {
      els.franjaButtons[0].click();
    }
  });

  els.franjaButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!state.fecha) {
        els.availabilityResult.hidden = false;
        els.availabilityResult.className = 'availability-result review';
        els.availabilityResult.textContent = 'Primero elige la fecha de tu cita.';
        return;
      }
      if (btn.disabled) return;
      els.franjaButtons.forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      state.franja = btn.getAttribute('data-franja');
      showFranjaMessage();
    });
  });

  els.toStep4.addEventListener('click', function () {
    goToStep(4);
    els.inpNombre.focus({ preventScroll: true });
  });

  /* ---------- Paso 4: datos del cliente ---------- */
  function limpiarCelular(v) {
    return String(v || '').replace(/[^\d+]/g, '');
  }

  function validarDatos() {
    var nombre = els.inpNombre.value.trim();
    var celular = limpiarCelular(els.inpCelular.value);
    var digitos = celular.replace(/\D/g, '');
    var correo = els.inpCorreo.value.trim();
    var errores = [];

    [els.inpNombre, els.inpCelular, els.inpCorreo].forEach(function (i) { i.classList.remove('invalid'); });

    if (nombre.length < 3) { errores.push('tu nombre completo'); els.inpNombre.classList.add('invalid'); }
    if (digitos.length < 8 || digitos.length > 15) { errores.push('un número de celular válido'); els.inpCelular.classList.add('invalid'); }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo)) { errores.push('un correo válido'); els.inpCorreo.classList.add('invalid'); }

    if (errores.length) {
      els.datosError.hidden = false;
      els.datosError.textContent = 'Por favor ingresa ' + errores.join(', ') + '.';
      return null;
    }
    els.datosError.hidden = true;
    // Números de 8 dígitos se asumen de Costa Rica
    var celularCompleto = digitos.length === 8 ? '+506 ' + digitos.slice(0, 4) + '-' + digitos.slice(4) : celular;
    return {
      nombre: nombre,
      celular: celularCompleto,
      correo: correo,
      notas: els.inpNotas.value.trim(),
    };
  }

  els.toStep5.addEventListener('click', function () {
    var cliente = validarDatos();
    if (!cliente) return;
    state.cliente = cliente;
    renderStep5();
    goToStep(5);
  });

  /* ---------- Paso 5: resumen + confirmación ---------- */
  function currentDeposito() {
    return calcDeposito(state.tier.max, state.service.deposito);
  }

  function renderStep5() {
    var s = state.service;
    var tier = state.tier;
    var c = state.cliente;
    var deposito = currentDeposito();

    var rows = [
      ['Servicio', s.servicio + ' (' + s.categoria + ')'],
      ['Largo de cabello', state.lengthLabel],
      ['Precio estimado', priceRangeLabel(tier)],
      ['Duración estimada', durationLabel(tier) || 'Por confirmar'],
      ['Fecha', fechaLegible(state.fecha)],
      ['Momento del día', state.franja],
      ['Nombre', c.nombre],
      ['Celular', c.celular],
      ['Correo', c.correo],
    ];
    if (c.notas) rows.push(['Comentarios', c.notas]);

    var html = '<dl>';
    rows.forEach(function (r) {
      html += '<dt>' + r[0] + '</dt><dd>' + escapeHtml(r[1]) + '</dd>';
    });
    html += '<dt>Depósito</dt><dd class="deposit-highlight">' +
      (deposito.requerido ? money(deposito.monto) + ' (se descuenta del total)' : 'No requiere depósito') +
      '</dd>';
    html += '</dl>';
    els.bookingSummary.innerHTML = html;
    els.envioError.hidden = true;

    // Bloque de pago: solo si el servicio requiere depósito
    els.pagoBox.hidden = !deposito.requerido;
    if (deposito.requerido) {
      els.pagoMonto.textContent = money(deposito.monto);
      els.pagoConcepto.textContent = conceptoPago();
    }
    actualizarBoton();
  }

  // Texto que el cliente pone en la descripción del SINPE (Pendientes P-005):
  // nombre + 1 apellido + día/mes de la cita. Ej.: "Julio Fallas 28/08"
  function conceptoPago() {
    var partes = state.cliente.nombre.split(/\s+/).filter(Boolean);
    var d = new Date(state.fecha + 'T12:00:00');
    var ddmm = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    return partes.slice(0, 2).join(' ') + ' ' + ddmm;
  }

  function actualizarBoton() {
    var necesitaComprobante = state.service && state.tier && currentDeposito().requerido;
    els.btnConfirmar.disabled = !els.chkPolicy.checked || (necesitaComprobante && !state.comprobante);
  }

  els.chkPolicy.addEventListener('change', actualizarBoton);

  /* ---------- Copiar datos de pago ---------- */
  function copiar(texto, btn) {
    var listo = function () {
      var original = btn.textContent;
      btn.classList.add('ok');
      btn.textContent = 'Copiado';
      setTimeout(function () { btn.classList.remove('ok'); btn.textContent = original; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texto).then(listo, listo);
    } else {
      var ta = document.createElement('textarea');
      ta.value = texto; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta); listo();
    }
  }
  document.querySelectorAll('[data-copiar]').forEach(function (btn) {
    btn.addEventListener('click', function () { copiar(btn.getAttribute('data-copiar'), btn); });
  });
  els.copiarConcepto.addEventListener('click', function () { copiar(els.pagoConcepto.textContent, els.copiarConcepto); });

  /* ---------- Comprobante de pago (JPG / PNG / PDF) ---------- */
  var MAX_MB = 8;

  function tamLegible(bytes) {
    return bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
  }

  // Fotos grandes del celular se reducen a 1600 px para que el correo llegue rápido.
  function optimizarImagen(file) {
    return new Promise(function (resolve) {
      if (file.type === 'application/pdf' || file.size < 1200 * 1024 || !window.createImageBitmap) return resolve(file);
      createImageBitmap(file).then(function (bmp) {
        var escala = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * escala);
        canvas.height = Math.round(bmp.height * escala);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(function (blob) {
          if (!blob) return resolve(file);
          var nombre = file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg';
          resolve(new File([blob], nombre, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.85);
      }).catch(function () { resolve(file); });
    });
  }

  function mostrarErrorPago(msg) {
    els.envioError.hidden = !msg;
    els.envioError.textContent = msg || '';
  }

  function cargarComprobante(file) {
    if (!file) return;
    if (!/^(image\/(jpeg|png)|application\/pdf)$/.test(file.type)) {
      mostrarErrorPago('El comprobante debe ser una imagen JPG o PNG, o un PDF.');
      return;
    }
    if (file.size > MAX_MB * 1048576) {
      mostrarErrorPago('El archivo pesa más de ' + MAX_MB + ' MB. Envía una captura de pantalla del comprobante.');
      return;
    }
    mostrarErrorPago('');
    optimizarImagen(file).then(function (final) {
      state.comprobante = final;
      var esPdf = final.type === 'application/pdf';
      els.comprobanteThumb.hidden = esPdf;
      if (!esPdf) els.comprobanteThumb.src = URL.createObjectURL(final);
      els.comprobantePreview.classList.toggle('es-pdf', esPdf);
      els.comprobanteNombre.textContent = file.name;
      els.comprobanteTam.textContent = tamLegible(final.size) + ' · listo para enviar';
      els.comprobantePreview.hidden = false;
      els.uploadZona.hidden = true;
      actualizarBoton();
    });
  }

  els.inpComprobante.addEventListener('change', function () {
    cargarComprobante(els.inpComprobante.files[0]);
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    els.uploadZona.addEventListener(ev, function (e) { e.preventDefault(); els.uploadZona.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.uploadZona.addEventListener(ev, function (e) { e.preventDefault(); els.uploadZona.classList.remove('drag'); });
  });
  els.uploadZona.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files[0]) cargarComprobante(e.dataTransfer.files[0]);
  });
  els.quitarComprobante.addEventListener('click', function () {
    state.comprobante = null;
    els.inpComprobante.value = '';
    els.comprobantePreview.hidden = true;
    els.uploadZona.hidden = false;
    actualizarBoton();
  });

  function whatsappUrl() {
    var s = state.service;
    var c = state.cliente;
    var deposito = currentDeposito();
    var lines = [
      '¡Hola Amarë! Quiero reservar una cita:',
      '• Nombre: ' + c.nombre,
      '• Servicio: ' + s.servicio + ' (' + s.categoria + ')',
      '• Largo: ' + state.lengthLabel + ' — ' + priceRangeLabel(state.tier),
      '• Fecha: ' + fechaLegible(state.fecha) + ' — ' + state.franja,
      '• Depósito: ' + (deposito.requerido ? money(deposito.monto) + ' (ya adjunté el comprobante en la web)' : 'no requiere'),
    ];
    if (c.notas) lines.push('• Comentarios: ' + c.notas);
    return 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent(lines.join('\n'));
  }

  // Filas del pedido (se usan en ambos correos, en este orden).
  function filasPedido() {
    var s = state.service;
    var c = state.cliente;
    var tier = state.tier;
    var deposito = currentDeposito();
    return {
      'Nombre': c.nombre,
      'Celular': c.celular,
      'Servicio': s.servicio,
      'Categoría': s.categoria,
      'Largo de cabello': state.lengthLabel,
      'Precio estimado': priceRangeLabel(tier),
      'Duración estimada': durationLabel(tier) || 'Por confirmar',
      'Fecha': fechaLegible(state.fecha) + ' (' + state.fecha + ')',
      'Momento del día': state.franja,
      'Depósito': deposito.requerido ? money(deposito.monto) + ' (se descuenta del total)' : 'No requiere',
      'Comentarios': c.notas || '—',
    };
  }

  // Datos estructurados para la automatización (Python → Google Calendar).
  function datosAutomatizacion() {
    var s = state.service;
    var c = state.cliente;
    var tier = state.tier;
    var deposito = currentDeposito();
    return {
      version: 1,
      origen: 'amarecr.com/reservar',
      enviado: new Date().toISOString(),
      cliente: { nombre: c.nombre, celular: c.celular, correo: c.correo },
      servicio: {
        codigo: s.codigo || '',
        nombre: s.servicio,
        categoria: s.categoria,
        largo: state.lengthLabel,
        precio_min: tier.min,
        precio_max: tier.max,
        duracion_min_h: tier.durMin,
        duracion_max_h: tier.durMax,
      },
      cita: { fecha: state.fecha, franja: state.franja, horario_sugerido: s.horario || '' },
      deposito: {
        requerido: deposito.requerido,
        monto: deposito.monto,
        comprobante_adjunto: !!state.comprobante,
        descripcion_sinpe: deposito.requerido ? conceptoPago() : '',
      },
      estado: deposito.requerido ? 'pendiente_validacion_pago' : 'pendiente_confirmacion',
      comentarios: c.notas || '',
    };
  }

  function assign(target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  }

  // Correo 1 → negocio (facturas@): pedido + comprobante adjunto + datos_json para la automatización.
  function payloadNegocio() {
    var s = state.service;
    var c = state.cliente;
    var deposito = currentDeposito();
    var estado = deposito.requerido
      ? 'PENDIENTE: validar comprobante de ' + money(deposito.monto) + ' (llega en un correo aparte: "Comprobante de pago: ' + c.nombre + '")'
      : 'Sin depósito: confirmar hora con la clienta';
    return assign(
      {
        _subject: 'Nueva cita: ' + s.servicio + ' · ' + state.fecha + ' ' + state.franja + ' · ' + c.nombre,
        _template: 'table',
        _captcha: 'false',
        _replyto: c.correo,
        _honey: '',
        'Estado de la reserva': estado,
      },
      filasPedido(),
      deposito.requerido ? { 'Descripción esperada del SINPE': conceptoPago() } : {},
      { 'Correo': c.correo },
      { 'datos_json': JSON.stringify(datosAutomatizacion()) }
    );
  }

  // FormSubmit solo conserva archivos en su endpoint normal (no en /ajax/), el
  // campo debe llamarse "attachment" y solo acepta un formulario real enviado en
  // la página (fetch o iframe no llegan). Además rechaza cualquier carácter fuera
  // de ASCII (tildes, ñ, ₡, ·): se limpia el texto visible y el JSON se escapa
  // (é...) para que la automatización recupere los datos exactos.
  function aAscii(texto) {
    return String(texto)
      .replace(/₡/g, 'CRC ').replace(/[·•]/g, '-').replace(/[–—]/g, '-')
      .replace(/¡/g, '').replace(/¿/g, '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7E\n]/g, '');
  }

  function jsonAscii(texto) {
    return texto.replace(/[\u007f-\uffff]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  // Pedido con comprobante: se envía como formulario normal en la misma página
  // (en un iframe oculto FormSubmit lo descarta). FormSubmit redirige a _next,
  // que vuelve a reservar.html?reserva=enviada y ahí se muestra el "¡Gracias!".
  // Correo 2 → negocio: solo el comprobante y los datos para validarlo.
  // Importante: NO incluir datos_json aquí; con adjunto, FormSubmit rechaza el
  // envío si lleva ese JSON (probado 28-sep-2026). Los datos completos van en
  // el correo "Nueva cita" (AJAX).
  function payloadComprobante() {
    var s = state.service;
    var c = state.cliente;
    var deposito = currentDeposito();
    return {
      _subject: 'Comprobante de pago: ' + c.nombre + ' - ' + s.servicio + ' - ' + state.fecha + ' ' + state.franja,
      _template: 'table',
      _captcha: 'false',
      _replyto: c.correo,
      'Estado': 'Validar que el monto y la descripcion coincidan',
      'Nombre': c.nombre,
      'Celular': c.celular,
      'Correo': c.correo,
      'Servicio': s.servicio + ' (' + s.categoria + ')',
      'Fecha de la cita': fechaLegible(state.fecha) + ' - ' + state.franja,
      'Monto del deposito': money(deposito.monto),
      'Descripcion esperada del SINPE': conceptoPago(),
    };
  }

  function enviarNegocioConComprobante(payload) {
    var limpio = {};
    Object.keys(payload).forEach(function (k) {
      limpio[aAscii(k)] = k === 'datos_json' ? jsonAscii(payload[k]) : aAscii(payload[k]);
    });
    var campos = assign({}, limpio, { _next: 'https://amarecr.com/reservar.html?reserva=enviada' });

    var form = document.createElement('form');
    form.method = 'POST';
    form.action = ENDPOINT_NEGOCIO_ADJUNTOS;
    form.enctype = 'multipart/form-data';
    form.hidden = true;
    Object.keys(campos).forEach(function (k) {
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = campos[k];
      form.appendChild(input);
    });
    var archivo = document.createElement('input');
    archivo.type = 'file';
    archivo.name = 'attachment';
    var ext = state.comprobante.type === 'application/pdf' ? '.pdf' : (state.comprobante.type === 'image/png' ? '.png' : '.jpg');
    var nombreArchivo = 'comprobante-' + aAscii(state.cliente.nombre).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase() + ext;
    var dt = new DataTransfer();
    dt.items.add(new File([state.comprobante], nombreArchivo, { type: state.comprobante.type }));
    archivo.files = dt.files;
    form.appendChild(archivo);
    document.body.appendChild(form);
    form.submit();
  }

  // Datos para mostrar el "¡Gracias!" al volver de FormSubmit.
  var CLAVE_RESERVA = 'amare_reserva_enviada';

  function mostrarGracias(datos) {
    els.doneTitle.textContent = '¡Gracias, ' + datos.nombre + '! Recibimos tu reserva';
    els.doneTexto.textContent = datos.conDeposito
      ? 'Recibimos tu comprobante y te enviamos el resumen a tu correo. En cuanto validemos el depósito te confirmamos la hora exacta por WhatsApp.'
      : 'Te enviamos el resumen a tu correo. En breve te escribimos por WhatsApp para confirmar la hora exacta.';
    els.doneWhatsapp.href = datos.wa;
    goToStep(6);
    if (window.amareTrack) window.amareTrack('reserva_confirmada', {
      servicio: datos.servicio, categoria: datos.categoria, value: datos.deposito, currency: 'CRC',
    });
  }

  function reservaEnviadaAlVolver() {
    if (new URLSearchParams(window.location.search).get('reserva') !== 'enviada') return false;
    var datos = null;
    try { datos = JSON.parse(sessionStorage.getItem(CLAVE_RESERVA)); sessionStorage.removeItem(CLAVE_RESERVA); } catch (e) {}
    if (window.history && history.replaceState) history.replaceState(null, '', 'reservar.html');
    if (!datos) return false;
    mostrarGracias(datos);
    setTimeout(function () { els.box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
    return true;
  }

  // Correo 2 → cliente: FormSubmit le envía el saludo (_autoresponse) + la tabla del pedido.
  // La copia que llega a confirmaciones@ se descarta en Cloudflare.
  function payloadCliente() {
    var c = state.cliente;
    var nombre = c.nombre.split(' ')[0];
    return assign(
      {
        _subject: 'Resumen de su reserva en Amarë Beauty Center',
        _template: 'table',
        _captcha: 'false',
        _honey: '',
        _autoresponse: 'Hola ' + nombre + ', ¡muchas gracias por su pedido! En Amarë Beauty Center estamos muy contentos de atenderle. ' +
          'Este es el resumen de su pedido; en breve le escribimos por WhatsApp para confirmar la hora de su cita.',
        // FormSubmit envía la respuesta automática al campo llamado "email".
        email: c.correo,
      },
      filasPedido(),
      { '¡Gracias!': 'Esperamos su visita con mucha ilusión. Amarë Beauty Center · +506 8807-3849 · amarecr.com' }
    );
  }

  function emailjsListo() {
    return !!(EMAILJS.serviceId && EMAILJS.templateId && EMAILJS.publicKey);
  }

  // Variables que usa la plantilla de EmailJS ({{nombre}}, {{servicio}}, ...).
  function paramsEmailJS() {
    var f = filasPedido();
    var c = state.cliente;
    return {
      correo: c.correo,
      nombre: c.nombre.split(' ')[0],
      nombre_completo: c.nombre,
      celular: c.celular,
      servicio: f['Servicio'],
      categoria: f['Categoría'],
      largo: f['Largo de cabello'],
      precio: f['Precio estimado'],
      duracion: f['Duración estimada'],
      fecha: fechaLegible(state.fecha),
      franja: f['Momento del día'],
      deposito: f['Depósito'],
      comentarios: f['Comentarios'],
      nota_pago: currentDeposito().requerido
        ? 'Recibimos su comprobante del depósito de ' + money(currentDeposito().monto) + '. Nuestro equipo lo validará y le confirmará la hora exacta por WhatsApp. Si el monto no coincide, le avisaremos el motivo.'
        : 'Este servicio no requiere depósito. En breve le escribimos por WhatsApp para confirmar la hora exacta.',
    };
  }

  function enviarEmailJS() {
    return fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS.serviceId,
        template_id: EMAILJS.templateId,
        user_id: EMAILJS.publicKey,
        template_params: paramsEmailJS(),
      }),
      keepalive: true,
    }).then(function (r) {
      if (!r.ok) throw new Error('EmailJS HTTP ' + r.status);
      return r.text();
    });
  }

  function enviarCorreo(endpoint, payload) {
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  els.btnConfirmar.addEventListener('click', function () {
    if (!els.chkPolicy.checked || !state.cliente) return;
    var deposito = currentDeposito();
    if (deposito.requerido && !state.comprobante) {
      mostrarErrorPago('Adjunta el comprobante del depósito para confirmar tu reserva.');
      return;
    }
    var datosGracias = {
      nombre: state.cliente.nombre.split(' ')[0],
      conDeposito: deposito.requerido,
      wa: whatsappUrl(),
      servicio: state.service.servicio,
      categoria: state.service.categoria,
      deposito: deposito.monto,
    };
    var negocio = payloadNegocio();
    var cliente = payloadCliente();

    mostrarErrorPago('');
    els.btnConfirmar.classList.add('is-loading');
    els.btnConfirmar.textContent = state.comprobante ? 'Enviando comprobante…' : 'Enviando…';

    // Servidor de reservas (Apps Script): guarda la reserva, el comprobante y envía los correos.
    if (API_URL) {
      enviarAlServidor(deposito)
        .then(function (resp) {
          if (resp.ok) { mostrarGracias(datosGracias); return; }
          if (resp.error === 'franja_llena') {
            els.btnConfirmar.classList.remove('is-loading');
            els.btnConfirmar.textContent = 'Confirmar reserva';
            goToStep(3);
            prepararPaso3();
            els.availabilityResult.hidden = false;
            els.availabilityResult.className = 'availability-result full';
            els.availabilityResult.textContent = (resp.mensaje ? resp.mensaje + ' ' : 'Justo se llenó ese espacio. ') + 'Elige otra fecha o franja, por favor.';
            return;
          }
          throw new Error(resp.error || 'respuesta inválida');
        })
        .catch(function (err) {
          if (window.console) console.warn('Servidor de reservas no disponible, se usa el respaldo:', err);
          flujoRespaldo();
        });
      return;
    }
    flujoRespaldo();

    function flujoRespaldo() {

    function conReintento(endpoint, payload) {
      return enviarCorreo(endpoint, payload)
        .catch(function () { return enviarCorreo(endpoint, payload); })
        .catch(function (err) {
          if (window.console) console.warn('No se pudo enviar el correo (' + endpoint + '):', err);
        });
    }

    // Correo con diseño al cliente (EmailJS; respaldo de texto por FormSubmit).
    function correoCliente() {
      return emailjsListo()
        ? enviarEmailJS().catch(function (err) {
            if (window.console) console.warn('EmailJS falló, se usa FormSubmit:', err);
            return conReintento(ENDPOINT_CLIENTE, cliente);
          })
        : conReintento(ENDPOINT_CLIENTE, cliente);
    }

    if (state.comprobante) {
      // 1) "Nueva cita" por AJAX (datos completos + datos_json)  2) correo al cliente
      // 3) "Comprobante de pago" con el archivo adjunto (la página va a FormSubmit y regresa)
      enviarCorreo(ENDPOINT_NEGOCIO, negocio).catch(function (err) {
        if (window.console) console.warn('Pedido AJAX falló:', err);
      }).then(correoCliente).then(function () {
        try { sessionStorage.setItem(CLAVE_RESERVA, JSON.stringify(datosGracias)); } catch (e) {}
        enviarNegocioConComprobante(payloadComprobante());
      });
      return;
    }

    // Sin depósito: pedido por AJAX (confirma el envío) y luego correo al cliente.
    enviarCorreo(ENDPOINT_NEGOCIO, negocio)
      .then(correoCliente)
      .then(function () { mostrarGracias(datosGracias); })
      .catch(function (err) {
        if (window.console) console.warn('No se pudo enviar la reserva:', err);
        els.btnConfirmar.classList.remove('is-loading');
        els.btnConfirmar.textContent = 'Confirmar reserva';
        mostrarErrorPago('No pudimos enviar tu reserva. Revisa tu conexión e inténtalo de nuevo. Si el problema sigue, escríbenos por WhatsApp al 8807-3849.');
      });
    } // fin flujoRespaldo
  });

  /* ---------- Envío al servidor de reservas (Apps Script) ---------- */
  function leerBase64(file) {
    return new Promise(function (resolve, reject) {
      var lector = new FileReader();
      lector.onload = function () { resolve(String(lector.result).split(',')[1]); };
      lector.onerror = reject;
      lector.readAsDataURL(file);
    });
  }

  function enviarAlServidor(deposito) {
    var s = state.service, c = state.cliente, tier = state.tier;
    var reserva = {
      nombre: c.nombre, celular: c.celular, correo: c.correo, comentarios: c.notas || '',
      categoria: s.categoria, servicio: s.servicio, codigo: s.codigo || '', largo: state.lengthLabel,
      precio_min: tier.min, precio_max: tier.max, dur_min_h: tier.durMin, dur_max_h: tier.durMax,
      fecha: state.fecha, franja: state.franja, horario_sugerido: s.horario || '',
      deposito: deposito.requerido ? deposito.monto : 0,
      descripcion_sinpe: deposito.requerido ? conceptoPago() : ''
    };
    var archivo = state.comprobante ? leerBase64(state.comprobante) : Promise.resolve(null);
    return archivo.then(function (b64) {
      var cuerpo = { reserva: reserva };
      if (b64) cuerpo.comprobante = { base64: b64, tipo: state.comprobante.type, nombre: state.comprobante.name };
      // text/plain evita la verificación CORS previa, que Apps Script no responde.
      return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(cuerpo) });
    }).then(function (r) { return r.json(); });
  }

  if (!reservaEnviadaAlVolver()) preseleccionarDesdeURL();

})();
