/* Patroclo TV (dev) — trae la app desde XAMPP en la PC y la recarga sola
   cuando cambia algún archivo. ES5, como el resto de la app. */
(function () {
  'use strict';

  var STORE_KEY = 'ptv_dev_server';
  var POLL_MS = 3000;
  var statusEl = document.getElementById('dev-status');
  var msgEl = document.getElementById('dev-msg');
  var formEl = document.getElementById('dev-form');
  var input = document.getElementById('dev-server');
  var retryBtn = document.getElementById('dev-retry');
  var exitBtn = document.getElementById('dev-exit');
  var controls = [input, retryBtn, exitBtn];
  var focusIdx = 1;
  var server = normalize(readServer() || window.PTV_DEV_SERVER || '');

  // Acepta "192.168.0.10", "192.168.0.10/patroclo" o la dirección completa.
  function normalize(s) {
    s = String(s || '').trim();
    if (!s) return '';
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    if (!/\/$/.test(s)) s += '/';
    if (/^https?:\/\/[^\/]+\/$/i.test(s)) s += 'patroclo/';
    return s;
  }

  function readServer() {
    try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function saveServer() {
    try { localStorage.setItem(STORE_KEY, server); } catch (e) {}
  }

  function get(url, timeout, cb) {
    var r = new XMLHttpRequest(), done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { r.abort(); } catch (e) {}
      cb(new Error('sin respuesta'));
    }, timeout);
    r.onreadystatechange = function () {
      if (r.readyState !== 4 || done) return;
      done = true;
      clearTimeout(timer);
      if (r.status >= 200 && r.status < 300) cb(null, r.responseText);
      else cb(new Error(r.status ? 'error ' + r.status : 'sin respuesta'));
    };
    try { r.open('GET', url, true); r.send(); } catch (e) { done = true; clearTimeout(timer); cb(e); }
  }

  // ---------- pantalla de estado ----------
  function setFocus(i) {
    focusIdx = (i + controls.length) % controls.length;
    for (var k = 0; k < controls.length; k++) controls[k].classList.toggle('dev-focus', k === focusIdx);
  }

  function showStatus(text, withForm) {
    if (!statusEl.parentNode) {
      statusEl.style.zIndex = '999';
      statusEl.style.background = '#000';
      document.body.appendChild(statusEl);
    }
    msgEl.textContent = text;
    formEl.className = withForm ? 'show' : '';
    input.value = server || 'http://192.168.0.10/patroclo/';
    if (withForm) setFocus(1);
  }

  document.addEventListener('keydown', function (e) {
    if (!statusEl.parentNode || !formEl.className) return;
    var k = e.keyCode;
    if (document.activeElement === input) {
      // Teclado del televisor abierto: Listo / Cancelar lo cierran.
      if (k === 65376 || k === 65385 || k === 13 || k === 10009) { input.blur(); e.preventDefault(); }
      return;
    }
    if (k === 38 || k === 37) setFocus(focusIdx - 1);
    else if (k === 40 || k === 39) setFocus(focusIdx + 1);
    else if (k === 13) {
      if (controls[focusIdx] === input) input.focus();
      else controls[focusIdx].click();
    } else if (k === 10009 || k === 27) exitApp();
    else return;
    e.preventDefault();
  });

  retryBtn.onclick = function () {
    server = normalize(input.value);
    boot();
  };
  exitBtn.onclick = exitApp;

  function exitApp() {
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  // ---------- carga de la app ----------
  function boot() {
    if (!server) return showStatus('Escribí la dirección de la PC donde corre XAMPP.', true);
    showStatus('Conectando con ' + server + ' …', false);
    get(server + 'index.html?t=' + Date.now(), 8000, function (err, html) {
      if (err) return showStatus('No se pudo conectar con la PC en ' + server + ' (' + err.message + ').', true);
      saveServer();
      try {
        inject(html);
      } catch (e) {
        showStatus('La app de la PC no se pudo cargar: ' + e.message, true);
      }
    });
  }

  // Arma la página de la app con el HTML de la PC. Los scripts y estilos se
  // piden a la PC (<base>), pero corren acá, con acceso a AVPlay y al control.
  function inject(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var stamp = 'dev=' + Date.now();
    function fresh(path) { return path.split('?')[0] + '?' + stamp; }

    var base = document.createElement('base');
    base.href = server;
    document.head.appendChild(base);

    var links = doc.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      var l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = fresh(links[i].getAttribute('href'));
      document.head.appendChild(l);
    }

    var scripts = [];
    var found = doc.body.querySelectorAll('script');
    for (var j = 0; j < found.length; j++) {
      if (found[j].getAttribute('src')) scripts.push(found[j].getAttribute('src'));
      found[j].parentNode.removeChild(found[j]);
    }

    statusEl.parentNode.removeChild(statusEl);
    document.body.innerHTML = doc.body.innerHTML;

    (function next(n) {
      if (n >= scripts.length) return watch();
      var s = document.createElement('script');
      s.src = fresh(scripts[n]);
      s.onload = function () { next(n + 1); };
      s.onerror = function () { showStatus('No se pudo cargar ' + scripts[n] + ' desde la PC.', true); };
      document.body.appendChild(s);
    })(0);
  }

  // ---------- recarga automática ----------
  // En línea (GitHub Pages) la versión está en version.txt, que escribe
  // publicar.ps1; con XAMPP en la PC la calcula dev-version.php.
  function watch() {
    var known = null, pending = false, local = /^http:\/\/(192\.168|10\.|172\.|localhost|127\.)/.test(server);
    var file = local ? 'dev-version.php' : 'version.txt';
    setInterval(function () {
      get(server + file + '?t=' + Date.now(), 5000, function (err, v) {
        if (err || !v) return;
        v = v.replace(/\s+/g, '');
        if (known === null) { known = v; return; }
        if (v !== known) pending = true;
        // Si hay un canal en pantalla, espera a que se cierre para no cortarlo.
        var playing = window.PTV && window.PTV.player && window.PTV.player.isOpen();
        if (pending && !playing) location.reload();
      });
    }, local ? POLL_MS : 30000);
  }

  boot();
})();
