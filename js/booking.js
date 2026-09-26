/* AMARË — Simulador de reserva de cita (reservar.html)
   No hay backend: todo corre en el navegador con los datos reales de
   js/services-data.js. La disponibilidad por franja es una simulación
   determinística (no lee ninguna agenda real) y el paso final abre
   WhatsApp con el resumen, que es como hoy se confirman las citas de
   verdad. Ver nota de "Peso operativo" en services-data.js: la regla
   de cupo liviano/pesado es una aproximación pendiente de validar con
   el cliente (ver Pendientes P-011/P-013 del blueprint de la app). */
(function () {
  'use strict';

  var SERVICES = window.AMARE_SERVICES || [];
  var CAPACIDAD_POR_FRANJA = 4; // respuesta real de Julio en Pendientes P-011
  var WHATSAPP_NUMBER = '50688073849';

  var state = {
    service: null,
    lengthLabel: null,
    tier: null,
    fecha: null,
    franja: null,
    disponibilidad: null,
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

  function hashSeed(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function evaluarDisponibilidad(fecha, franja, service) {
    var ocupados = hashSeed(fecha + '|' + franja) % (CAPACIDAD_POR_FRANJA + 1);
    var libres = CAPACIDAD_POR_FRANJA - ocupados;
    var franjaTexto = franja.toLowerCase();
    if (libres > 0) {
      return {
        estado: 'ok', ocupados: ocupados, libres: libres,
        mensaje: 'Hay ' + libres + ' de ' + CAPACIDAD_POR_FRANJA + ' cupos disponibles en la franja de ' + franjaTexto + '.',
      };
    }
    if (service.pesoLiviano) {
      return {
        estado: 'review', ocupados: ocupados, libres: 0,
        mensaje: 'La franja de ' + franjaTexto + ' está al cupo completo (' + CAPACIDAD_POR_FRANJA + '/' + CAPACIDAD_POR_FRANJA + '), pero por ser un servicio liviano nuestro equipo podría abrir un espacio adicional. Lo confirmamos por WhatsApp.',
      };
    }
    return {
      estado: 'full', ocupados: ocupados, libres: 0,
      mensaje: 'La franja de ' + franjaTexto + ' está al cupo completo (' + CAPACIDAD_POR_FRANJA + '/' + CAPACIDAD_POR_FRANJA + '). Tu solicitud quedará pendiente de aprobación mientras buscamos un espacio.',
    };
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
    bookingSummary: document.getElementById('bookingSummary'),
    chkPolicy: document.getElementById('chkPolicy'),
    whatsappSubmit: document.getElementById('whatsappSubmit'),
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

    // Si el cliente vuelve atrás y cambia de servicio, la fecha/franja
    // elegidas antes ya no aplican (la disponibilidad depende del servicio).
    state.fecha = null;
    state.franja = null;
    state.disponibilidad = null;
    els.inpFecha.value = '';
    els.franjaButtons.forEach(function (b) { b.classList.remove('selected'); });
    els.availabilityResult.hidden = true;
    els.toStep4.disabled = true;

    Object.keys(s.tiers).forEach(function (label) {
      var tier = s.tiers[label];
      var div = document.createElement('div');
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
    state.disponibilidad = null;
    els.franjaButtons.forEach(function (b) { b.classList.remove('selected'); });
    els.availabilityResult.hidden = true;
    els.toStep4.disabled = true;
  }

  function checkAvailability() {
    if (!state.fecha || !state.franja) return;
    var disponibilidad = evaluarDisponibilidad(state.fecha, state.franja, state.service);
    state.disponibilidad = disponibilidad;
    els.availabilityResult.hidden = false;
    els.availabilityResult.className = 'availability-result ' + disponibilidad.estado;
    els.availabilityResult.textContent = disponibilidad.mensaje;
    els.toStep4.disabled = false;
  }

  els.inpFecha.addEventListener('change', function () {
    resetFranjaSelection();
    if (!els.inpFecha.value) return;
    var d = new Date(els.inpFecha.value + 'T12:00:00');
    var day = d.getDay(); // 0 = domingo, 1 = lunes
    if (day === 0 || day === 1) {
      state.fecha = null;
      els.availabilityResult.hidden = false;
      els.availabilityResult.className = 'availability-result full';
      els.availabilityResult.textContent = 'Cerrado ese día. Atendemos de martes a sábado.';
      return;
    }
    state.fecha = els.inpFecha.value;
  });

  els.franjaButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!state.fecha) return;
      els.franjaButtons.forEach(function (b) { b.classList.remove('selected'); });
      btn.classList.add('selected');
      state.franja = btn.getAttribute('data-franja');
      checkAvailability();
    });
  });

  els.toStep4.addEventListener('click', function () {
    renderStep4();
    goToStep(4);
  });

  /* ---------- Paso 4: resumen + envío por WhatsApp ---------- */
  function renderStep4() {
    var s = state.service;
    var tier = state.tier;
    var deposito = calcDeposito(tier.max, s.deposito);

    var rows = [
      ['Servicio', s.servicio + ' (' + s.categoria + ')'],
      ['Largo de cabello', state.lengthLabel],
      ['Precio estimado', priceRangeLabel(tier)],
      ['Duración estimada', durationLabel(tier) || 'Por confirmar'],
      ['Fecha solicitada', state.fecha],
      ['Franja', state.franja],
      ['Disponibilidad simulada', state.disponibilidad ? state.disponibilidad.mensaje : ''],
    ];

    var html = '<dl>';
    rows.forEach(function (r) {
      html += '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>';
    });
    html += '<dt>Depósito</dt><dd class="deposit-highlight">' +
      (deposito.requerido ? money(deposito.monto) + ' (se descuenta del total)' : 'No requiere depósito') +
      '</dd>';
    html += '</dl>';
    els.bookingSummary.innerHTML = html;

    updateWhatsappLink(deposito);
  }

  function updateWhatsappLink(deposito) {
    var s = state.service;
    var tier = state.tier;
    var enabled = els.chkPolicy.checked;
    els.whatsappSubmit.classList.toggle('disabled-link', !enabled);

    var lines = [
      'Hola AMARË! Quiero solicitar una cita (vista previa desde la web):',
      '- Servicio: ' + s.servicio + ' (' + s.categoria + ')',
      '- Largo: ' + state.lengthLabel + ' — ' + priceRangeLabel(tier),
      '- Fecha: ' + state.fecha + ' — Franja: ' + state.franja,
      '- Depósito estimado: ' + (deposito.requerido ? money(deposito.monto) : 'no requiere'),
    ];
    var text = encodeURIComponent(lines.join('\n'));
    els.whatsappSubmit.href = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + text;
  }

  els.chkPolicy.addEventListener('change', function () {
    if (state.service && state.tier) {
      var deposito = calcDeposito(state.tier.max, state.service.deposito);
      updateWhatsappLink(deposito);
    }
  });

})();
