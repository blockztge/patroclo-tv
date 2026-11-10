/* Patroclo TV — reproductor a pantalla completa.
   En el televisor usa AVPlay de Samsung (HLS y MPEG-TS nativos, sin CORS);
   en el navegador usa <video> con hls.js. Si un canal en vivo falla, prueba
   solo las señales espejo (otros canales con el mismo nombre en la lista). */
(function (P) {
  'use strict';

  var K = P.KEY;
  var layer, video, avEl = null, frame = null, ui = {};
  var timers = {};
  var st = {
    open: false, list: null, index: 0, item: null, token: 0, engine: null, cbs: null,
    mirrors: [], tried: {}, started: false, paused: false, cur: 0, dur: 0,
    onClose: null, hls: null, numBuf: '', lastMove: 0
  };
  var POS_KEY = 'ptv_pos';

  var HINT_LIVE = '<span class="key k-white">▲▼</span>Cambiar canal &nbsp; <span class="key k-white">0-9</span>Ir al número &nbsp; ' +
    '<span class="key k-green">&nbsp;</span>Otra señal &nbsp; <span class="key k-yellow">&nbsp;</span>Favorito &nbsp; <span class="key k-white">Volver</span>Salir';
  var HINT_VOD = '<span class="key k-white">OK</span>Pausa &nbsp; <span class="key k-white">◀▶</span>10 seg &nbsp; ' +
    '<span class="key k-white">REW FF</span>30 seg &nbsp; <span class="key k-yellow">&nbsp;</span>Favorito &nbsp; <span class="key k-white">Volver</span>Salir';

  function T(name, fn, ms) {
    clearTimeout(timers[name]);
    timers[name] = fn ? setTimeout(fn, ms) : null;
  }

  P.hasAVPlay = function () { return !!(window.webapis && window.webapis.avplay); };

  function isLive(it) {
    it = it || st.item;
    return !!it && it.type === 'live';
  }

  // ---------- motores ----------
  var engines = {};

  engines.avplay = {
    start: function (url, it, cb) {
      var a = window.webapis.avplay;
      avEl.style.display = 'block';
      document.documentElement.classList.add('av-on');
      try {
        a.open(url);
        a.setDisplayRect(0, 0, window.innerWidth, window.innerHeight);
        try { a.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e1) {}
        if (it.ua) { try { a.setStreamingProperty('USER_AGENT', it.ua); } catch (e2) {} }
        a.setListener({
          onbufferingstart: function () { cb.buffering(true); },
          onbufferingprogress: function () {},
          onbufferingcomplete: function () { cb.buffering(false); },
          onstreamcompleted: function () { cb.ended(); },
          oncurrentplaytime: function (ms) {
            var d = 0;
            try { d = a.getDuration() / 1000; } catch (e) {}
            cb.time(ms / 1000, d);
          },
          onerror: function (type) { cb.error('Error del reproductor (' + type + ')'); },
          onevent: function () {},
          onsubtitlechange: function () {},
          ondrmevent: function () {}
        });
        a.prepareAsync(function () {
          if (!cb.alive()) return;
          try { a.play(); cb.playing(); } catch (e3) { cb.error(e3.message || 'No se pudo iniciar'); }
        }, function (e4) {
          cb.error('No se pudo abrir la señal (' + ((e4 && e4.name) || e4) + ')');
        });
      } catch (e) {
        cb.error(e.message || String(e));
      }
    },
    stop: function () {
      var a = window.webapis.avplay;
      try {
        var s = a.getState();
        if (s === 'PLAYING' || s === 'PAUSED' || s === 'READY') a.stop();
      } catch (e) {}
      try { a.close(); } catch (e2) {}
      avEl.style.display = 'none';
      document.documentElement.classList.remove('av-on');
    },
    pause: function () { try { window.webapis.avplay.pause(); } catch (e) {} },
    resume: function () { try { window.webapis.avplay.play(); } catch (e) {} },
    seek: function (sec) { try { window.webapis.avplay.seekTo(Math.max(0, sec) * 1000); } catch (e) {} }
  };

  function playVideo() {
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function loadHls(cb) {
    if (window.Hls) return cb();
    var s = document.createElement('script');
    s.src = 'js/lib/hls.min.js';
    s.onload = s.onerror = function () { cb(); };
    document.body.appendChild(s);
  }

  engines.html5 = {
    start: function (url, it, cb) {
      video.style.display = 'block';
      // En la PC se prefiere hls.js aunque el navegador traiga HLS propio:
      // el de Chrome a veces se queda trabado sin avisar ningún error.
      var nativeHls = !!video.canPlayType('application/vnd.apple.mpegurl');
      if (/\.m3u8?(\?|$)/i.test(url) && (!nativeHls || !P.isTizen)) {
        loadHls(function () {
          if (!cb.alive()) return;
          if (!window.Hls || !window.Hls.isSupported()) { video.src = url; playVideo(); return; }
          var h = st.hls = new window.Hls({ maxBufferLength: 30 });
          var retries = 0;
          h.on(window.Hls.Events.ERROR, function (ev, d) {
            if (!d || !d.fatal) return;
            // Recuperación recomendada por hls.js antes de dar la señal por perdida.
            if (retries < 3 && d.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
              retries++;
              if (retries === 2) h.swapAudioCodec();
              h.recoverMediaError();
            } else if (retries < 3 && d.type === window.Hls.ErrorTypes.NETWORK_ERROR &&
                d.details !== window.Hls.ErrorDetails.MANIFEST_LOAD_ERROR &&
                d.details !== window.Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT) {
              // Un corte a mitad de la transmisión se reintenta; si la lista
              // ni siquiera carga, se pasa directo a otra señal.
              retries++;
              h.startLoad();
            } else {
              cb.error('No se pudo reproducir (hls.js: ' + d.details + (d.response && d.response.code ? ', HTTP ' + d.response.code : '') + ')');
            }
          });
          // Solo cuenta como recuperada cuando el video avanza de verdad.
          h.on(window.Hls.Events.FRAG_CHANGED, function () { retries = 0; });
          h.on(window.Hls.Events.MANIFEST_PARSED, playVideo);
          h.loadSource(url);
          h.attachMedia(video);
        });
      } else {
        video.src = url;
        playVideo();
      }
    },
    stop: function () {
      if (st.hls) { try { st.hls.destroy(); } catch (e) {} st.hls = null; }
      try { video.pause(); } catch (e2) {}
      video.removeAttribute('src');
      try { video.load(); } catch (e3) {}
      video.style.display = 'none';
    },
    pause: function () { video.pause(); },
    resume: playVideo,
    seek: function (sec) { try { video.currentTime = Math.max(0, sec); } catch (e) {} }
  };

  // Señales de YouTube en vivo (algunos canales argentinos solo emiten ahí).
  engines.youtube = {
    start: function (url, it, cb) {
      frame = P.el('iframe', 'p-frame');
      frame.setAttribute('frameborder', '0');
      frame.setAttribute('allow', 'autoplay; encrypted-media');
      frame.onload = function () { cb.playing(); };
      frame.src = it.ytVideo
        ? 'https://www.youtube.com/embed/' + encodeURIComponent(it.ytVideo) + '?autoplay=1&controls=0&rel=0&modestbranding=1'
        : 'https://www.youtube.com/embed/live_stream?channel=' + encodeURIComponent(it.ytId) + '&autoplay=1&controls=0&rel=0&modestbranding=1';
      layer.insertBefore(frame, ui.osd);
    },
    stop: function () {
      if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
    },
    pause: function () {},
    resume: function () {},
    seek: function () {}
  };

  function pickEngine(it) {
    if (it.ytId || it.ytVideo || it.ytPage) return 'youtube';
    if (P.settings.player !== 'html5' && P.hasAVPlay()) return 'avplay';
    return 'html5';
  }

  // ---------- ciclo de reproducción ----------
  function stopEngine() {
    T('start');
    T('novideo');
    st.cbs = null;
    if (st.engine) {
      try { engines[st.engine].stop(); } catch (e) {}
      st.engine = null;
    }
  }

  function resolve(it, cb) {
    if (/^ia:/.test(it.url || '')) return P.resolveArchive(it.url.slice(3), cb);
    if (it.ytPage && !it.ytId) {
      return P.resolveYouTube(it.url, function (err, id) {
        if (err) return cb(err);
        it.ytId = id;
        cb(null, it.url);
      });
    }
    if (it.ytId || it.ytVideo) return cb(null, it.url || '');
    if (!it.url) return cb(new Error('Este contenido no tiene una dirección para reproducir'));
    cb(null, it.url);
  }

  function makeCbs(tk) {
    function ok() { return tk === st.token && st.open; }
    return {
      alive: ok,
      playing: function () {
        if (!ok()) return;
        var first = !st.started;
        st.started = true;
        st.lastMove = Date.now();
        T('start');
        spin(false);
        hideError();
        if (first) {
          resumePos();
          hideOsdLater();
          // El navegador no decodifica MPEG-2 (común en señales de TV abierta):
          // se escucha pero no se ve. AVPlay en el televisor sí lo reproduce.
          if (st.engine === 'html5') T('novideo', function () {
            if (ok() && video.videoWidth === 0) noVideo();
          }, 4000);
        }
      },
      buffering: function (on) { if (ok()) spin(on); },
      error: function (msg) { if (ok()) fail(msg); },
      ended: function () {
        if (!ok()) return;
        if (isLive()) return fail('La transmisión se cortó');
        clearPos();
        if (st.list && st.index < st.list.length - 1) {
          st.index++;
          start(st.list[st.index]);
        } else {
          close();
        }
      },
      time: function (cur, dur) {
        if (!ok()) return;
        if ((cur || 0) !== st.cur) st.lastMove = Date.now();
        st.cur = cur || 0;
        st.dur = isFinite(dur) && dur > 0 ? dur : 0;
        drawProgress();
      }
    };
  }

  function start(it, keepMirrors) {
    stopEngine();
    var tk = ++st.token;
    st.item = it;
    st.started = false;
    st.paused = false;
    st.cur = 0;
    st.dur = 0;
    if (!keepMirrors) {
      st.mirrors = P.mirrorsOf(it);
      st.tried = {};
    }
    st.tried[it.url] = true;
    hideError();
    ui.paused.classList.add('hidden');
    spin(true);
    renderOsd();
    showOsd();
    if (isLive(it)) P.addRecent(it);
    resolve(it, function (err, url) {
      if (tk !== st.token) return;
      if (err) return fail(err.message);
      var name = pickEngine(it), cb = makeCbs(tk);
      st.engine = name;
      st.cbs = cb;
      T('start', function () {
        if (tk === st.token && !st.started) fail('La señal no responde');
      }, 25000);
      engines[name].start(url, it, cb);
    });
  }

  function nextUntried() {
    for (var i = 0; i < st.mirrors.length; i++) if (!st.tried[st.mirrors[i].url]) return st.mirrors[i];
    return null;
  }

  function fail(msg) {
    T('start');
    if (isLive()) {
      var next = nextUntried();
      if (next) {
        P.toast('Probando una señal alternativa…');
        start(next, true);
        return;
      }
    }
    stopEngine();
    spin(false);
    showError(msg);
  }

  // Hay audio pero no imagen: se prueba otra señal del mismo canal; si no hay,
  // se sigue con el audio y se avisa.
  function noVideo() {
    var next = isLive() ? nextUntried() : null;
    if (next) {
      P.toast('Esta señal no se ve en el navegador: probando otra…', 3500);
      start(next, true);
    } else {
      P.toast('Esta señal usa un formato de video que el navegador no muestra (solo audio). En el televisor se ve bien.', 6000);
    }
  }

  function switchMirror() {
    if (!isLive() || st.mirrors.length < 2) {
      P.toast('Este canal no tiene señales alternativas');
      return;
    }
    var i = 0;
    for (; i < st.mirrors.length; i++) if (st.mirrors[i].url === st.item.url) break;
    var next = st.mirrors[(i + 1) % st.mirrors.length];
    P.toast('Señal ' + ((i + 1) % st.mirrors.length + 1) + ' de ' + st.mirrors.length);
    start(next, true);
  }

  // ---------- posición de películas (para seguir viendo) ----------
  function savePos() {
    if (isLive() || !st.started || !st.item) return;
    var pos = P.store.get(POS_KEY, {});
    if (st.dur > 300 && st.cur > 60 && st.cur < st.dur - 120) pos[st.item.url] = Math.floor(st.cur);
    else delete pos[st.item.url];
    var keys = Object.keys(pos);
    if (keys.length > 60) delete pos[keys[0]];
    P.store.set(POS_KEY, pos);
  }
  function clearPos() {
    var pos = P.store.get(POS_KEY, {});
    if (st.item && pos[st.item.url]) { delete pos[st.item.url]; P.store.set(POS_KEY, pos); }
  }
  function resumePos() {
    if (isLive()) return;
    var p = P.store.get(POS_KEY, {})[st.item.url];
    if (!p) return;
    var tk = st.token;
    setTimeout(function () {
      if (tk !== st.token || !st.engine) return;
      engines[st.engine].seek(p);
      st.cur = p;
      P.toast('Continuando desde ' + P.fmtTime(p));
    }, 600);
  }

  // ---------- controles ----------
  function zap(dir) {
    if (!st.list || st.list.length < 2) return;
    st.index = (st.index + dir + st.list.length) % st.list.length;
    var it = st.list[st.index];
    stopEngine();
    st.token++;
    st.item = it;
    hideError();
    spin(true);
    renderOsd();
    showOsd();
    // Espera a que el usuario deje de apretar antes de abrir la señal.
    T('zap', function () { start(it); }, 450);
  }

  function numInput(d) {
    st.numBuf = (st.numBuf + d).slice(-4);
    ui.entry.textContent = st.numBuf;
    ui.entry.classList.remove('hidden');
    T('num', function () {
      var n = parseInt(st.numBuf, 10);
      st.numBuf = '';
      ui.entry.classList.add('hidden');
      if (n >= 1 && n <= st.list.length) {
        if (n - 1 !== st.index) { st.index = n - 1; start(st.list[st.index]); }
      } else {
        P.toast('No existe el canal ' + n);
      }
    }, 1600);
  }

  function togglePause() {
    if (!st.engine || !st.started) return;
    if (st.paused) engines[st.engine].resume();
    else engines[st.engine].pause();
    st.paused = !st.paused;
    ui.paused.classList.toggle('hidden', !st.paused);
    showOsd();
  }

  function seek(delta) {
    if (isLive() || !st.engine || !st.started) return;
    var t = Math.max(0, st.cur + delta);
    if (st.dur) t = Math.min(t, st.dur - 5);
    engines[st.engine].seek(t);
    st.cur = t;
    drawProgress();
    showOsd();
  }

  // ---------- interfaz ----------
  function spin(on) { ui.spin.classList.toggle('hidden', !on); }

  function showError(msg) {
    ui.errMsg.textContent = msg || 'No se pudo reproducir';
    var hint = isLive()
      ? 'Probá otro canal con ▲▼, otra señal con el botón verde, o salí con Volver.'
      : 'Apretá Volver para salir.';
    if (!P.isTizen && P.settings.player !== 'avplay') {
      hint += ' En el navegador muchos canales no cargan por restricciones del sitio de origen; en el televisor funcionan mejor.';
    }
    ui.errHint.textContent = hint;
    ui.err.classList.remove('hidden');
    showOsd();
  }
  function hideError() { ui.err.classList.add('hidden'); }

  function renderOsd() {
    var it = st.item;
    if (!it) return;
    var live = isLive(it);
    ui.num.textContent = live && st.list ? String(st.index + 1) : '';
    P.clear(ui.logo);
    ui.logo.appendChild(P.logo(it.logo, it.name, live ? '' : 'cover'));
    ui.logo.className = 'p-logo' + (live ? '' : ' poster');
    ui.name.textContent = it.name + (P.isFav(it) ? '  ★' : '');
    var sub = [];
    if (it.group) sub.push(it.group);
    if (st.list && st.list.length > 1) sub.push((st.index + 1) + ' de ' + st.list.length);
    if (live && st.mirrors.length > 1) sub.push(st.mirrors.length + ' señales');
    ui.sub.textContent = sub.join('  ·  ');
    ui.prog.style.display = live ? 'none' : 'block';
    ui.hints.innerHTML = live ? HINT_LIVE : HINT_VOD;
    drawProgress();
  }

  function drawProgress() {
    if (isLive()) return;
    ui.fill.style.width = st.dur ? Math.min(100, st.cur / st.dur * 100) + '%' : '0';
    ui.tCur.textContent = P.fmtTime(st.cur);
    ui.tDur.textContent = st.dur ? P.fmtTime(st.dur) : '';
  }

  function showOsd() {
    ui.clock.textContent = P.clockText();
    ui.osd.classList.remove('off');
    hideOsdLater();
  }
  function hideOsdLater() {
    T('osd', function () {
      if (st.started && !st.paused && ui.err.classList.contains('hidden')) ui.osd.classList.add('off');
    }, 5000);
  }
  function toggleOsd() {
    if (ui.osd.classList.contains('off')) showOsd();
    else ui.osd.classList.add('off');
  }

  // Un canal en vivo que dejó de avanzar (congelado sin error) se trata como caído.
  function watchdog() {
    if (!st.open || !st.started || st.paused || !isLive()) return;
    if (st.engine !== 'html5' && st.engine !== 'avplay') return;
    // Si nunca llegó a avanzar se descarta antes; si venía andando se le da más margen.
    if (Date.now() - st.lastMove > (st.cur > 5 ? 15000 : 8000)) fail('La señal se congeló');
  }

  // ---------- API ----------
  function open(list, index, opts) {
    if (!list || !list.length) return;
    st.list = list;
    st.index = Math.max(0, Math.min(index || 0, list.length - 1));
    st.onClose = (opts && opts.onClose) || null;
    st.open = true;
    clearInterval(timers.watch);
    timers.watch = setInterval(watchdog, 4000);
    layer.classList.remove('hidden');
    document.documentElement.classList.add('playing');
    start(list[st.index]);
  }

  function close() {
    if (!st.open) return;
    savePos();
    stopEngine();
    st.token++;
    T('osd');
    T('zap');
    T('num');
    st.numBuf = '';
    ui.entry.classList.add('hidden');
    st.open = false;
    clearInterval(timers.watch);
    layer.classList.add('hidden');
    document.documentElement.classList.remove('playing');
    var cb = st.onClose;
    st.onClose = null;
    if (cb) cb(st.index, st.list);
  }

  function onKey(e) {
    var k = e.keyCode, live = isLive();
    if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) {
      if (st.numBuf) { st.numBuf = ''; T('num'); ui.entry.classList.add('hidden'); return; }
      close();
      return;
    }
    if (k >= 48 && k <= 57) {
      if (live && st.list) numInput(k - 48);
      return;
    }
    switch (k) {
      case K.UP: case K.CHUP: case K.PGUP:
        if (live) zap(1); else showOsd();
        break;
      case K.DOWN: case K.CHDOWN: case K.PGDN:
        if (live) zap(-1); else showOsd();
        break;
      case K.LEFT: if (live) showOsd(); else seek(-10); break;
      case K.RIGHT: if (live) showOsd(); else seek(10); break;
      case K.RW: seek(-30); break;
      case K.FF: seek(30); break;
      case K.ENTER: if (live) toggleOsd(); else togglePause(); break;
      case K.PLAYPAUSE: case K.PLAY: case K.PAUSE: case 32: togglePause(); break;
      case K.STOP: close(); break;
      case K.GREEN: case 71: switchMirror(); break;
      case K.YELLOW: case 70: P.toggleFav(st.list ? st.list[st.index] : st.item); renderOsd(); showOsd(); break;
      case K.INFO: case 73: toggleOsd(); break;
    }
  }

  function init() {
    layer = document.getElementById('player');
    if (P.isTizen) {
      avEl = document.createElement('object');
      avEl.id = 'av-player';
      avEl.setAttribute('type', 'application/avplayer');
      avEl.style.display = 'none';
      layer.appendChild(avEl);
    }
    video = P.el('video');
    video.id = 'video';
    video.setAttribute('playsinline', '');
    video.style.display = 'none';
    layer.appendChild(video);
    video.addEventListener('playing', function () { if (st.cbs) st.cbs.playing(); });
    video.addEventListener('waiting', function () { if (st.cbs) st.cbs.buffering(true); });
    video.addEventListener('ended', function () { if (st.cbs) st.cbs.ended(); });
    video.addEventListener('timeupdate', function () { if (st.cbs) st.cbs.time(video.currentTime, video.duration); });
    video.addEventListener('error', function () {
      if (!st.cbs || st.hls || !video.getAttribute('src')) return;
      var e = video.error;
      st.cbs.error('Formato no compatible o señal caída' + (e ? ' (código ' + e.code + (e.message ? ': ' + e.message : '') + ')' : ''));
    });

    ui.osd = P.el('div', 'p-osd');
    var top = P.el('div', 'p-top');
    ui.num = P.el('div', 'p-num');
    ui.logo = P.el('div', 'p-logo');
    var title = P.el('div', 'p-title');
    ui.name = P.el('div', 'p-name');
    ui.sub = P.el('div', 'p-sub');
    ui.clock = P.el('div', 'p-clock');
    title.appendChild(ui.name);
    title.appendChild(ui.sub);
    top.appendChild(ui.num);
    top.appendChild(ui.logo);
    top.appendChild(title);
    top.appendChild(ui.clock);

    var bottom = P.el('div', 'p-bottom');
    ui.prog = P.el('div', 'p-prog');
    var bar = P.el('div', 'p-bar');
    ui.fill = P.el('div', 'p-fill');
    bar.appendChild(ui.fill);
    var times = P.el('div', 'p-times');
    ui.tCur = P.el('span');
    ui.tDur = P.el('span');
    times.appendChild(ui.tCur);
    times.appendChild(ui.tDur);
    ui.prog.appendChild(bar);
    ui.prog.appendChild(times);
    ui.hints = P.el('div', 'p-hints');
    bottom.appendChild(ui.prog);
    bottom.appendChild(ui.hints);
    ui.osd.appendChild(top);
    ui.osd.appendChild(bottom);
    layer.appendChild(ui.osd);

    ui.spin = P.el('div', 'p-spin hidden');
    ui.paused = P.el('div', 'p-paused hidden', '❚❚');
    ui.entry = P.el('div', 'p-entry hidden');
    ui.err = P.el('div', 'p-error hidden');
    ui.err.appendChild(P.el('div', 'p-err-title', 'No se pudo reproducir'));
    ui.errMsg = P.el('div', 'p-err-msg');
    ui.errHint = P.el('div', 'p-err-hint');
    ui.err.appendChild(ui.errMsg);
    ui.err.appendChild(ui.errHint);
    layer.appendChild(ui.spin);
    layer.appendChild(ui.paused);
    layer.appendChild(ui.entry);
    layer.appendChild(ui.err);

    // Si la app pasa a segundo plano (botón Home), se libera el reproductor.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && st.open) close();
    });
  }

  P.player = {
    init: init,
    open: open,
    close: close,
    onKey: onKey,
    isOpen: function () { return st.open; }
  };
})(PTV);
