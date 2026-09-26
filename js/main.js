/* AMARË — interacciones de interfaz (menú móvil, "leer más") */
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
