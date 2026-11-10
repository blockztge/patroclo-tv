/* Patroclo TV — navegación con flechas (foco espacial) y diálogos.
   Los elementos navegables llevan el atributo data-nav. El foco es una clase
   (.is-focus), no el foco nativo, para que el navegador no mueva el scroll solo. */
(function (P) {
  'use strict';

  var cur = null, lastKey = 0;

  function root() {
    var m = document.getElementById('modal');
    if (!m.classList.contains('hidden')) return m;
    var s = document.getElementById('setup');
    if (!s.classList.contains('hidden')) return s;
    return document.getElementById('shell');
  }

  function groupOf(el) {
    while (el && el !== document.body) {
      if (el.getAttribute && el.getAttribute('data-nav-group')) return el;
      el = el.parentNode;
    }
    return null;
  }

  function candidates(r) {
    var all = r.querySelectorAll('[data-nav]'), out = [];
    for (var i = 0; i < all.length; i++) if (all[i].offsetParent !== null && !all[i].disabled) out.push(all[i]);
    return out;
  }

  // Elige el elemento más cercano en la dirección pedida: prioriza los que
  // están alineados (sin hueco perpendicular) y después la distancia.
  function pick(from, dir, list) {
    var r = from.getBoundingClientRect(), best = null, bestScore = Infinity;
    var rcx = r.left + r.width / 2, rcy = r.top + r.height / 2;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c === from) continue;
      var q = c.getBoundingClientRect();
      if (!q.width && !q.height) continue;
      var qcx = q.left + q.width / 2, qcy = q.top + q.height / 2, main, gap, off;
      if (dir === 'left' || dir === 'right') {
        if (dir === 'right' ? qcx <= rcx + 1 : qcx >= rcx - 1) continue;
        main = dir === 'right' ? q.left - r.right : r.left - q.right;
        gap = Math.max(0, q.top - r.bottom, r.top - q.bottom);
        off = Math.abs(qcy - rcy);
      } else {
        if (dir === 'down' ? qcy <= rcy + 1 : qcy >= rcy - 1) continue;
        main = dir === 'down' ? q.top - r.bottom : r.top - q.bottom;
        gap = Math.max(0, q.left - r.right, r.left - q.right);
        off = Math.abs(qcx - rcx);
      }
      var score = Math.max(main, 0) + gap * 3 + off * 0.1;
      if (score < bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  // Mantiene visible el elemento dentro de sus contenedores con scroll.
  function reveal(el) {
    var p = el.parentNode, s = P.scale || 1;
    while (p && p !== document.body) {
      var cls = p.className || '';
      if (typeof cls === 'string' && cls.indexOf('scroll-') !== -1) {
        var pr = p.getBoundingClientRect(), er = el.getBoundingClientRect(), m = 40 * s;
        if (cls.indexOf('scroll-y') !== -1) {
          if (er.bottom > pr.bottom - m) p.scrollTop += (er.bottom - pr.bottom + m) / s;
          else if (er.top < pr.top + m) p.scrollTop -= (pr.top + m - er.top) / s;
        }
        if (cls.indexOf('scroll-x') !== -1) {
          if (er.right > pr.right - m) p.scrollLeft += (er.right - pr.right + m) / s;
          else if (er.left < pr.left + m) p.scrollLeft -= (pr.left + m - er.left) / s;
        }
      }
      p = p.parentNode;
    }
  }

  function focus(el, fromMouse) {
    if (!el) return;
    if (cur && cur !== el) {
      cur.classList.remove('is-focus');
      if (cur.tagName === 'INPUT' && document.activeElement === cur) cur.blur();
    }
    cur = el;
    el.classList.add('is-focus');
    var g = groupOf(el);
    if (g) g._last = el;
    if (!fromMouse) reveal(el);
    // En la PC se puede escribir directo; en la TV el teclado se abre con OK.
    if (el.tagName === 'INPUT' && !P.isTizen) el.focus();
    if (el._onFocus) el._onFocus();
  }

  function move(dir) {
    var r = root(), list = candidates(r);
    if (!cur || !r.contains(cur) || cur.offsetParent === null) {
      if (list[0]) focus(list[0]);
      return !!list[0];
    }
    var n = pick(cur, dir, list);
    if (!n) return false;
    var g0 = groupOf(cur), g1 = groupOf(n);
    // Las filas (pestañas, carruseles) no se abandonan hacia los costados.
    if ((dir === 'left' || dir === 'right') && g0 && g1 !== g0 && g0.getAttribute('data-nav-lock') === 'x') return false;
    // Al entrar a otro grupo (fila, columna) volvemos al último elemento usado.
    if (g1 && g1 !== g0) {
      var mem = g1._last;
      if (mem && mem !== n && g1.contains(mem) && mem.offsetParent !== null) n = mem;
    }
    focus(n);
    return true;
  }

  document.addEventListener('mouseover', function (e) {
    if (Date.now() - lastKey < 500) return;
    var t = e.target;
    while (t && t !== document && !(t.hasAttribute && t.hasAttribute('data-nav'))) t = t.parentNode;
    if (t && t !== document && t !== cur && root().contains(t)) focus(t, true);
  });

  P.nav = {
    move: move,
    focus: focus,
    current: function () { return cur && document.body.contains(cur) ? cur : null; },
    keyTick: function () { lastKey = Date.now(); },
    first: function () { var l = candidates(root()); if (l[0]) focus(l[0]); }
  };

  // ---------- diálogos ----------
  P.modal = (function () {
    var box = null, prev = null, content = null, onClose = null;
    function el() { return box || (box = document.getElementById('modal')); }
    return {
      open: function (node, opts) {
        if (!this.isOpen()) prev = P.nav.current();
        P.clear(el());
        box.appendChild(node);
        content = node;
        onClose = (opts && opts.onClose) || null;
        box.classList.remove('hidden');
        var f = node.querySelector('[data-nav]');
        if (f) focus(f);
      },
      close: function () {
        if (!P.modal.isOpen()) return;
        el().classList.add('hidden');
        P.clear(box);
        content = null;
        var cb = onClose;
        onClose = null;
        if (prev && document.body.contains(prev)) focus(prev);
        prev = null;
        if (cb) cb();
      },
      isOpen: function () { return !el().classList.contains('hidden'); },
      content: function () { return content; }
    };
  })();

  P.confirm = function (title, text, yesLabel, onYes) {
    var d = P.el('div', 'dialog confirm');
    d.appendChild(P.el('h2', '', title));
    if (text) d.appendChild(P.el('p', 'confirm-text', text));
    var acts = P.el('div', 'actions center');
    acts.appendChild(P.btn('Cancelar', '', P.modal.close));
    acts.appendChild(P.btn(yesLabel, 'primary', function () { P.modal.close(); onYes(); }));
    d.appendChild(acts);
    P.modal.open(d);
  };
})(PTV);
