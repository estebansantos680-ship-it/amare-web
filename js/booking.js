/* AMARË — Reserva de cita en línea (reservar.html)
   Flujo: servicio → largo → fecha/franja → datos del cliente → confirmar.
   Al confirmar:
     1. Se envían dos correos (vía FormSubmit):
        - Al negocio (facturas@amarecr.com): pedido completo + "datos_json"
          para la automatización en Python → Google Calendar.
        - Al cliente: correo con diseño vía EmailJS (plantilla en
          emails/confirmacion-cliente.html); respaldo de texto por FormSubmit.
     2. Se abre WhatsApp con el resumen para que el equipo confirme el espacio.
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
  var ENDPOINT_CLIENTE = 'https://formsubmit.co/ajax/confirmaciones@amarecr.com';

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

  function calcDeposito(precioMax, requiereDeposito) {
    if (!requiereDeposito || precioMax < 10000) {
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
    doneWhatsapp: document.getElementById('doneWhatsapp'),
    box: document.getElementById('bookingBox'),
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
  });

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
  });

  /* ---------- Paso 3: fecha y franja ---------- */
  function toLocalISODate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }
  els.inpFecha.min = toLocalISODate(new Date());

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
      ' en la ' + state.franja.toLowerCase() + '. Nuestro equipo te confirma la hora exacta por WhatsApp.';
    els.toStep4.disabled = false;
  }

  els.inpFecha.addEventListener('change', function () {
    resetFranjaSelection();
    if (!els.inpFecha.value) return;
    var d = new Date(els.inpFecha.value + 'T12:00:00');
    if (d.getDay() === 0) {
      state.fecha = null;
      els.availabilityResult.hidden = false;
      els.availabilityResult.className = 'availability-result full';
      els.availabilityResult.textContent = 'Los domingos descansamos. Elige un día de lunes a sábado.';
      return;
    }
    state.fecha = els.inpFecha.value;
  });

  els.franjaButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!state.fecha) {
        els.availabilityResult.hidden = false;
        els.availabilityResult.className = 'availability-result review';
        els.availabilityResult.textContent = 'Primero elige la fecha de tu cita.';
        return;
      }
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
    els.btnConfirmar.disabled = !els.chkPolicy.checked;
  }

  els.chkPolicy.addEventListener('change', function () {
    els.btnConfirmar.disabled = !els.chkPolicy.checked;
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
      '• Depósito: ' + (deposito.requerido ? money(deposito.monto) : 'no requiere'),
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
      deposito: { requerido: deposito.requerido, monto: deposito.monto },
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

  // Correo 1 → negocio (facturas@ → Gmail): todo el pedido + datos_json para la automatización.
  function payloadNegocio() {
    var s = state.service;
    var c = state.cliente;
    return assign(
      {
        _subject: 'Nueva cita: ' + s.servicio + ' · ' + state.fecha + ' ' + state.franja + ' · ' + c.nombre,
        _template: 'table',
        _captcha: 'false',
        _replyto: c.correo,
        _honey: '',
      },
      filasPedido(),
      { 'Correo': c.correo, 'datos_json': JSON.stringify(datosAutomatizacion()) }
    );
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
    var wa = whatsappUrl();
    var negocio = payloadNegocio();
    var cliente = payloadCliente();

    // WhatsApp se abre dentro del mismo clic para que el navegador no lo bloquee.
    window.open(wa, '_blank', 'noopener');

    els.btnConfirmar.classList.add('is-loading');
    els.btnConfirmar.textContent = 'Enviando…';

    // Cada correo tiene un reintento por si la conexión del celular falla.
    // Aunque falle alguno, la solicitud ya salió por WhatsApp.
    function conReintento(endpoint, payload) {
      return enviarCorreo(endpoint, payload)
        .catch(function () { return enviarCorreo(endpoint, payload); })
        .catch(function (err) {
          if (window.console) console.warn('No se pudo enviar el correo (' + endpoint + '):', err);
        });
    }

    // Cliente: correo con diseño por EmailJS (si falla, respaldo de texto por FormSubmit).
    var correoCliente = emailjsListo()
      ? enviarEmailJS().catch(function (err) {
          if (window.console) console.warn('EmailJS falló, se usa FormSubmit:', err);
          return conReintento(ENDPOINT_CLIENTE, cliente);
        })
      : conReintento(ENDPOINT_CLIENTE, cliente);

    Promise.all([
      conReintento(ENDPOINT_NEGOCIO, negocio),
      correoCliente,
    ])
      .then(function () {
        els.doneTitle.textContent = '¡Gracias, ' + state.cliente.nombre.split(' ')[0] + '! Recibimos tu solicitud';
        els.doneWhatsapp.href = wa;
        goToStep(6);
      });
  });

})();
