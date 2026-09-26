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
