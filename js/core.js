/* Patroclo TV — núcleo: utilidades, almacenamiento, red y teclas.
   Todo el código está en ES5 a propósito: los Samsung con Tizen 3/4 traen
   Chromium 47–56, que no entiende let/const, funciones flecha ni módulos. */
var PTV = window.PTV = window.PTV || {};

(function (P) {
  'use strict';

  P.VERSION = '1.0.8';
  P.isTizen = typeof window.tizen !== 'undefined';
  P.W = 1920;
  P.H = 1080;
  P.scale = 1;

  // ---------- DOM ----------
  P.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  P.clear = function (node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  };
  P.btn = function (label, cls, fn) {
    var b = P.el('button', 'btn ' + (cls || ''), label);
    b.setAttribute('data-nav', '');
    b.onclick = fn;
    return b;
  };

  // ---------- texto ----------
  P.norm = function (s) {
    s = String(s || '').toLowerCase();
    try { s = s.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (e) {}
    return s;
  };
  P.hash = function (str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  };
  P.extend = function (a, b) {
    for (var k in b) if (b.hasOwnProperty(k)) a[k] = b[k];
    return a;
  };
  P.pad2 = function (n) { return n < 10 ? '0' + n : String(n); };
  P.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + P.pad2(m) : m) + ':' + P.pad2(s);
  };
  P.clockText = function () {
    var d = new Date();
    return P.pad2(d.getHours()) + ':' + P.pad2(d.getMinutes());
  };
  P.initials = function (name) {
    var w = String(name || '?').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^0-9A-Za-zÀ-ÿ ]/g, ' ').trim().split(/\s+/);
    return ((w[0] || '?').charAt(0) + (w[1] ? w[1].charAt(0) : '')).toUpperCase();
  };

  // Logo o póster con iniciales de respaldo si la imagen no carga.
  P.logo = function (src, name, cls) {
    var box = P.el('div', 'logo ' + (cls || ''));
    box.appendChild(P.el('span', 'logo-fb', P.initials(name)));
    if (src) {
      var img = new Image();
      img.onload = function () { box.classList.add('has-img'); };
      img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
      img.src = src;
      box.appendChild(img);
    }
    return box;
  };

  // ---------- almacenamiento (solo en esta TV) ----------
  P.store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) {
      try { localStorage.removeItem(k); } catch (e) {}
    }
  };

  // ---------- red ----------
  // En el televisor no hay CORS. En el navegador (XAMPP) los pedidos que el
  // sitio remoto bloquea se reintentan a través de proxy.php.
  P.canProxy = function () {
    return !P.isTizen && /^https?:$/.test(location.protocol);
  };

  function rawGet(url, timeout, cb) {
    var r = new XMLHttpRequest(), done = false, timer;
    function finish(err, txt) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      r.onreadystatechange = null;
      cb(err, txt);
    }
    timer = setTimeout(function () {
      try { r.abort(); } catch (e) {}
      var err = new Error('La conexión tardó demasiado');
      err.network = true;
      finish(err);
    }, timeout);
    r.onreadystatechange = function () {
      if (r.readyState !== 4) return;
      // Los archivos locales del paquete .wgt responden con estado 0.
      if ((r.status >= 200 && r.status < 300) || (r.status === 0 && r.responseText)) {
        finish(null, r.responseText);
      } else {
        var err = new Error(r.status ? 'El servidor respondió ' + r.status : 'Sin respuesta del servidor');
        err.network = !r.status;
        finish(err);
      }
    };
    try {
      r.open('GET', url, true);
      r.send();
    } catch (ex) {
      ex.network = true;
      finish(ex);
    }
  }

  P.httpGet = function (url, opts, cb) {
    var timeout = (opts && opts.timeout) || 30000;
    rawGet(url, timeout, function (err, txt) {
      if (!err || !err.network || !P.canProxy() || !/^https?:\/\//i.test(url)) return cb(err, txt);
      rawGet('proxy.php?url=' + encodeURIComponent(url), timeout, function (err2, txt2) {
        cb(err2 ? err : null, txt2);
      });
    });
  };

  P.getJSON = function (url, opts, cb) {
    P.httpGet(url, opts, function (err, txt) {
      if (err) return cb(err);
      var data;
      try { data = JSON.parse(txt); } catch (e) { return cb(new Error('Respuesta inválida del servidor')); }
      cb(null, data);
    });
  };

  // ---------- control remoto ----------
  P.KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 10009, ESC: 27, BACKSPACE: 8,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412,
    CHUP: 427, CHDOWN: 428, PGUP: 33, PGDN: 34,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, INFO: 457,
    DONE: 65376, CANCEL: 65385
  };

  P.registerKeys = function () {
    if (!P.isTizen || !window.tizen.tvinputdevice) return;
    var names = ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward',
      'MediaRewind', 'ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow',
      'ColorF3Blue', 'Info', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
    for (var i = 0; i < names.length; i++) {
      try { window.tizen.tvinputdevice.registerKey(names[i]); } catch (e) {}
    }
  };

  P.exitApp = function () {
    try {
      window.tizen.application.getCurrentApplication().exit();
    } catch (e) {
      P.toast('Cerrá la pestaña para salir');
    }
  };

  // ---------- escala a 1920×1080 ----------
  P.fitStage = function () {
    var w = window.innerWidth, h = window.innerHeight;
    var s = Math.min(w / P.W, h / P.H);
    var x = Math.round((w - P.W * s) / 2), y = Math.round((h - P.H * s) / 2);
    var st = document.getElementById('stage');
    var t = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
    P.scale = s;
    st.style.webkitTransform = t;
    st.style.transform = t;
  };

  // ---------- avisos ----------
  var toastTimer;
  P.toast = function (msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, ms || 2600);
  };

  P.loading = function (msg) {
    var l = document.getElementById('loading');
    if (msg === false) { l.classList.add('hidden'); return; }
    document.getElementById('loading-text').textContent = msg || 'Cargando…';
    l.classList.remove('hidden');
  };
  P.isLoading = function () {
    return !document.getElementById('loading').classList.contains('hidden');
  };
})(PTV);
