/* AMARË — interacciones de interfaz (menú móvil, "leer más") y analítica */

/* ---------- Analítica ----------
   - Cloudflare Web Analytics: visitas y páginas vistas (sin cookies).
   - Google Analytics 4: visitas + conversiones (se activa al poner el ID "G-...").
   Eventos: click_whatsapp, click_reservar_servicio, reserva_iniciada, reserva_confirmada. */
(function () {
  'use strict';
  var CF_BEACON_TOKEN = '';   // Cloudflare → Web Analytics → amarecr.com → token del snippet
  var GA_ID = '';             // Google Analytics 4 → ID de medición (G-XXXXXXXXXX)

  var enProduccion = /(^|\.)amarecr\.com$/.test(window.location.hostname);

  function cargarScript(src, attrs) {
    var s = document.createElement('script');
    s.defer = true; s.src = src;
    Object.keys(attrs || {}).forEach(function (k) { s.setAttribute(k, attrs[k]); });
    document.head.appendChild(s);
  }

  if (enProduccion && CF_BEACON_TOKEN) {
    cargarScript('https://static.cloudflareinsights.com/beacon.min.js',
      { 'data-cf-beacon': JSON.stringify({ token: CF_BEACON_TOKEN }) });
  }

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  if (enProduccion && GA_ID) {
    cargarScript('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  // amareTrack('evento', {datos}) — usado también por booking.js
  window.amareTrack = function (evento, datos) {
    if (enProduccion && GA_ID) window.gtag('event', evento, datos || {});
    if (!enProduccion && window.console) console.info('[analítica]', evento, datos || {});
  };

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (/wa\.me|api\.whatsapp\.com/.test(href)) {
      window.amareTrack('click_whatsapp', { ubicacion: window.location.pathname });
    } else if (a.classList.contains('btn-reservar')) {
      var card = a.closest('.service-card');
      var titulo = card && card.querySelector('h3');
      window.amareTrack('click_reservar_servicio', { servicio: titulo ? titulo.textContent : '' });
    } else if (/reservar\.html/.test(href)) {
      window.amareTrack('click_reservar', { ubicacion: window.location.pathname });
    }
  });
})();

(function () {
  'use strict';

  /* ---------- Menú móvil ---------- */
  var menuToggle = document.getElementById('menuToggle');
  var navLinks = document.getElementById('navLinks');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', function () {
      var isOpen = navLinks.classList.toggle('open');
      menuToggle.classList.toggle('open', isOpen);
      menuToggle.setAttribute('aria-expanded', String(isOpen));
    });

    navLinks.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        navLinks.classList.remove('open');
        menuToggle.classList.remove('open');
        menuToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Sombra del header al hacer scroll ---------- */
  var header = document.querySelector('header.site');
  if (header) {
    var onScroll = function () { header.classList.toggle('scrolled', window.scrollY > 10); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Aparición de secciones al hacer scroll ---------- */
  var reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- Fundido entre fotos (efecto "GIF" del hero) ---------- */
  document.querySelectorAll('.fade-slides').forEach(function (box) {
    var slides = box.querySelectorAll('img');
    if (slides.length < 2 || reduceMotion) return;
    var i = 0;
    setInterval(function () {
      slides[i].classList.remove('is-active');
      i = (i + 1) % slides.length;
      slides[i].classList.add('is-active');
    }, 5000);
  });

  /* ---------- Videos: se cargan y reproducen solo cuando están en pantalla ---------- */
  var videos = document.querySelectorAll('video.lazy-video');
  if (videos.length && 'IntersectionObserver' in window && !reduceMotion) {
    var tryPlay = function (video) {
      if (!video._inView) return;
      var playing = video.play();
      if (playing && playing.catch) playing.catch(function () {});
    };
    var vio = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var video = entry.target;
        video._inView = entry.isIntersecting;
        if (entry.isIntersecting) {
          var source = video.querySelector('source[data-src]');
          if (source) {
            source.src = source.getAttribute('data-src');
            source.removeAttribute('data-src');
            video.addEventListener('canplay', function () { tryPlay(video); });
            video.load();
          } else {
            tryPlay(video);
          }
        } else {
          video.pause();
        }
      });
    }, { threshold: 0.2 });
    videos.forEach(function (v) { vio.observe(v); });
  }

  /* ---------- "Leer más" — sección Sobre nosotros (sobre-nosotros.html) ---------- */
  var readMoreBtn = document.getElementById('readMoreBtn');
  var readMoreText = document.querySelector('.about-extra');

  if (readMoreBtn && readMoreText) {
    readMoreText.id = 'readMoreText';
    readMoreBtn.addEventListener('click', function () {
      var isHidden = readMoreText.hasAttribute('hidden');
      if (isHidden) {
        readMoreText.removeAttribute('hidden');
        readMoreBtn.textContent = 'Leer menos';
        readMoreBtn.setAttribute('aria-expanded', 'true');
      } else {
        readMoreText.setAttribute('hidden', '');
        readMoreBtn.textContent = 'Leer más';
        readMoreBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

})();
