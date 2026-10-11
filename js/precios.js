/* Amarë — Precios y descuentos editables desde el panel de reservas.
   La web parte de sus precios (HTML y js/services-data.js) y aplica encima lo que se cambió en el panel:
   - precio normal cambiado → se muestra igual que siempre;
   - descuento → el precio normal tachado y el nuevo más grande y en negrita.
   window.amarePrecios es una promesa con { "Nombre del servicio": { normal, oferta, vence, etiqueta } } (booking.js la usa). */
(function () {
  'use strict';

  var API_URL = 'https://script.google.com/macros/s/AKfycbzQPBJ3dz8Q201ef0V-dSdVjXwnNK4jmCOQxbSEZvCzqPlHiYYP6A3p6QXuFTjbEyvX/exec';
  var CLAVE = 'amare_precios_v1', VIGENCIA = 5 * 60 * 1000;
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function money(n) { return '₡' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function rango(v) { return v[0] === v[1] ? money(v[0]) : money(v[0]) + ' – ' + money(v[1]); }
  function fechaCorta(iso) { var p = String(iso).split('-'); return Number(p[2]) + ' de ' + MESES[Number(p[1]) - 1]; }

  // Copia de 5 minutos en la sesión: al pasar de una página a otra los precios salen al instante.
  function leerCopia() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CLAVE) || 'null');
      return c && Date.now() - c.t < VIGENCIA ? c.precios : null;
    } catch (e) { return null; }
  }
  function guardarCopia(precios) {
    try { sessionStorage.setItem(CLAVE, JSON.stringify({ t: Date.now(), precios: precios })); } catch (e) {}
  }

  var copia = leerCopia();
  window.amarePrecios = copia ? Promise.resolve(copia) :
    fetch(API_URL + '?accion=precios&t=' + Date.now())
      .then(function (r) { return r.json(); })
      .then(function (d) { var p = (d && d.ok && d.precios) || {}; guardarCopia(p); return p; })
      .catch(function () { return {}; });

  /* ---------- Páginas de servicios: tarjetas .service-card ---------- */
  function aplicarEnTarjetas(precios) {
    document.querySelectorAll('.service-card').forEach(function (card) {
      var h3 = card.querySelector('.service-card-head h3');
      var p = h3 && precios[h3.textContent.trim()];
      if (!p) return;
      var hayOferta = false;
      card.querySelectorAll('.price-tier').forEach(function (tier) {
        var etiqueta = tier.querySelector('.tier-label'), valor = tier.querySelector('.tier-value');
        if (!etiqueta || !valor) return;
        var largo = etiqueta.textContent.trim();
        if (largo === 'Precio') largo = 'Corto'; // precio único: todos los largos cuestan lo mismo
        var normal = p.normal && p.normal[largo], oferta = p.oferta && p.oferta[largo];
        var antes = normal ? rango(normal) : valor.textContent.trim();
        if (oferta) {
          hayOferta = true;
          tier.classList.add('con-oferta');
          valor.innerHTML = '<s class="precio-antes">' + antes + '</s><strong class="precio-oferta">' + rango(oferta) + '</strong>';
        } else if (normal) {
          valor.textContent = antes;
        }
      });
      if (hayOferta) {
        card.classList.add('en-oferta');
        var fila = card.querySelector('.badge-row');
        if (fila && !fila.querySelector('.badge-oferta')) {
          var b = document.createElement('span');
          b.className = 'badge badge-oferta';
          b.textContent = (p.etiqueta || 'Precio especial') + (p.vence ? ' · hasta el ' + fechaCorta(p.vence) : '');
          fila.insertBefore(b, fila.firstChild);
        }
      }
    });
  }

  if (document.querySelector('.service-card')) window.amarePrecios.then(aplicarEnTarjetas);
})();
