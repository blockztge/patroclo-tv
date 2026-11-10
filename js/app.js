/* Patroclo TV — pantallas, estado y manejo de teclas. */
(function (P) {
  'use strict';

  var K = P.KEY;
  var CFG_KEY = 'ptv_cfg', CACHE_KEY = 'ptv_cache', FAV_KEY = 'ptv_favs',
    REC_KEY = 'ptv_recents', SET_KEY = 'ptv_settings';
  var CACHE_TTL = 6 * 3600 * 1000;

  var S = P.state = {
    cfg: null, info: null, live: [], vod: [], series: [],
    groups: { live: [], vod: [], series: [] }, mirrors: {}, tab: 'home'
  };
  P.settings = P.extend({ player: 'auto' }, P.store.get(SET_KEY, {}));

  var favs = P.store.get(FAV_KEY, []);
  var recents = P.store.get(REC_KEY, []);
  var setupEl, shellEl, tabsEl, contentEl, clockEl;
  var screens = {}, cur = null, tabDwell = null;

  // ---------- favoritos e historial ----------
  function itemKey(it) { return it.type + '|' + (it.seriesId || it.url || it.id); }

  function mini(it) {
    var o = {}, f = ['id', 'name', 'logo', 'group', 'url', 'type', 'ytId', 'ytVideo', 'ytPage', 'ua', 'seriesId', 'synopsis', 'year'];
    for (var i = 0; i < f.length; i++) if (it[f[i]] != null && it[f[i]] !== '') o[f[i]] = it[f[i]];
    return o;
  }

  function indexOfKey(list, it) {
    var k = itemKey(it);
    for (var i = 0; i < list.length; i++) if (itemKey(list[i]) === k) return i;
    return -1;
  }

  P.isFav = function (it) { return indexOfKey(favs, it) !== -1; };

  P.toggleFav = function (it) {
    if (!it) return false;
    var i = indexOfKey(favs, it), on = i === -1;
    if (on) favs.unshift(mini(it)); else favs.splice(i, 1);
    P.store.set(FAV_KEY, favs);
    P.toast(on ? '★ Agregado a Favoritos' : 'Quitado de Favoritos');
    refreshStars();
    return on;
  };

  P.addRecent = function (it) {
    if (it.type !== 'live') return;
    var i = indexOfKey(recents, it);
    if (i !== -1) recents.splice(i, 1);
    recents.unshift(mini(it));
    if (recents.length > 20) recents.length = 20;
    P.store.set(REC_KEY, recents);
  };

  function markFav(el, it) { el.classList.toggle('fav', P.isFav(it)); }

  function refreshStars() {
    var els = document.querySelectorAll('.has-item');
    for (var i = 0; i < els.length; i++) if (els[i]._item) markFav(els[i], els[i]._item);
    if (cur && cur.onFavChange) cur.onFavChange();
  }

  // ---------- índice de contenido ----------
  function baseName(n) {
    return P.norm(n).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/\b(hd|fhd|sd|uhd|4k)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Todas las señales con el mismo nombre de canal (espejos).
  P.mirrorsOf = function (it) {
    if (it.type !== 'live') return [it];
    var l = S.mirrors[baseName(it.name)];
    if (!l || !l.length) return [it];
    if (indexOfKey(l, it) === -1) l = [it].concat(l);
    return l;
  };

  function useResult(res) {
    S.info = res.info || null;
    S.live = [];
    S.vod = [];
    S.series = [];
    S.mirrors = {};
    var gmap = { live: {}, vod: {}, series: {} }, garr = { live: [], vod: [], series: [] };
    var list = res.channels;
    for (var i = 0; i < list.length; i++) {
      var it = list[i], t = it.type === 'live' ? 'live' : it.type === 'series' ? 'series' : 'vod';
      S[t].push(it);
      var g = gmap[t][it.group];
      if (!g) { g = gmap[t][it.group] = { name: it.group, items: [] }; garr[t].push(g); }
      g.items.push(it);
      if (t === 'live') {
        var b = baseName(it.name);
        (S.mirrors[b] = S.mirrors[b] || []).push(it);
      }
    }
    S.groups = garr;
  }

  function cfgKey(cfg) { return JSON.stringify(cfg) + '|' + P.DATA_VERSION; }

  function saveCache(cfg, res) {
    var ok = P.store.set(CACHE_KEY, { key: cfgKey(cfg), ts: Date.now(), channels: res.channels, info: res.info });
    if (!ok) P.store.del(CACHE_KEY); // listas enormes no entran en el almacenamiento
  }

  // ---------- tarjetas y apertura de contenido ----------
  function card(it, list) {
    var shape = it.type === 'live' ? 'tile' : 'poster';
    var b = P.el('button', 'card has-item ' + shape);
    b.setAttribute('data-nav', '');
    b._item = it;
    var th = P.logo(it.logo, it.name, 'thumb' + (shape === 'poster' ? ' cover' : ''));
    th.appendChild(P.el('span', 'star', '★'));
    b.appendChild(th);
    b.appendChild(P.el('div', 'cap', it.name));
    markFav(b, it);
    b.onclick = function () { P.openItem(it, list); };
    return b;
  }

  P.openItem = function (it, list) {
    if (it.type === 'live') {
      var lives = [], idx = 0;
      (list || [it]).forEach(function (x) {
        if (x.type !== 'live') return;
        if (x === it) idx = lives.length;
        lives.push(x);
      });
      if (!lives.length) lives = [it];
      P.player.open(lives, idx);
      return;
    }
    if (it.type === 'series' && it.seriesId) return openSeries(it);
    openDetail(it);
  };

  function openDetail(it) {
    var d = P.el('div', 'dialog detail');
    d.appendChild(P.logo(it.logo, it.name, 'cover'));
    var body = P.el('div', 'detail-body');
    body.appendChild(P.el('h2', '', it.name));
    var meta = [];
    if (it.year) meta.push(it.year);
    if (it.group) meta.push(it.group);
    body.appendChild(P.el('div', 'meta', meta.join('  ·  ')));
    if (it.synopsis) body.appendChild(P.el('p', 'syn', it.synopsis));
    var acts = P.el('div', 'actions');
    if (it.type === 'info') {
      body.appendChild(P.el('p', 'note', 'Esta película es un estreno: no hay una copia gratuita para ver. Si tu lista Xtream o M3U la tiene, podés buscarla.'));
      acts.appendChild(P.btn('Buscar en mi lista', 'primary', function () { P.modal.close(); goSearch(it.name); }));
    } else {
      acts.appendChild(P.btn('▶ Reproducir', 'primary', function () { P.modal.close(); P.player.open([it], 0); }));
    }
    var fb = P.btn(P.isFav(it) ? '★ En favoritos' : '☆ Agregar a favoritos', '', function () {
      fb.textContent = P.toggleFav(it) ? '★ En favoritos' : '☆ Agregar a favoritos';
    });
    acts.appendChild(fb);
    acts.appendChild(P.btn('Cerrar', '', P.modal.close));
    body.appendChild(acts);
    d.appendChild(body);
    P.modal.open(d);
  }

  function openSeries(it) {
    var d = P.el('div', 'dialog detail series');
    d.appendChild(P.logo(it.logo, it.name, 'cover'));
    var body = P.el('div', 'detail-body');
    body.appendChild(P.el('h2', '', it.name));
    var meta = P.el('div', 'meta', it.group || '');
    var syn = P.el('p', 'syn short', it.synopsis || '');
    var seasons = P.el('div', 'seasons scroll-x');
    seasons.setAttribute('data-nav-group', 'seasons');
    seasons.setAttribute('data-nav-lock', 'x');
    var eps = P.el('div', 'episodes scroll-y');
    eps.setAttribute('data-nav-group', 'episodes');
    eps.appendChild(P.el('div', 'empty', 'Cargando temporadas…'));
    var acts = P.el('div', 'actions');
    var fb = P.btn(P.isFav(it) ? '★ En favoritos' : '☆ Agregar a favoritos', '', function () {
      fb.textContent = P.toggleFav(it) ? '★ En favoritos' : '☆ Agregar a favoritos';
    });
    acts.appendChild(fb);
    acts.appendChild(P.btn('Cerrar', '', P.modal.close));
    body.appendChild(meta);
    body.appendChild(syn);
    body.appendChild(seasons);
    body.appendChild(eps);
    body.appendChild(acts);
    d.appendChild(body);
    P.modal.open(d);

    P.loadSeriesInfo(S.cfg, it, function (err, info) {
      if (P.modal.content() !== d) return;
      P.clear(eps);
      if (err || !info.seasons.length) {
        eps.appendChild(P.el('div', 'empty', 'No se pudieron cargar los episodios de esta serie.'));
        return;
      }
      if (info.plot) syn.textContent = info.plot;
      var m = [];
      if (info.year) m.push(info.year);
      if (info.genre) m.push(info.genre);
      if (it.group) m.push(it.group);
      meta.textContent = m.join('  ·  ');
      var buttons = [];
      function showSeason(si) {
        buttons.forEach(function (b, i) { b.classList.toggle('active', i === si); });
        P.clear(eps);
        var list = info.seasons[si].episodes;
        list.forEach(function (ep, i) {
          var e = P.el('button', 'ep', (ep.episode ? ep.episode + '. ' : '') + ep.name);
          e.setAttribute('data-nav', '');
          e.onclick = function () { P.player.open(list, i); };
          eps.appendChild(e);
        });
        eps.scrollTop = 0;
      }
      info.seasons.forEach(function (s, si) {
        var b = P.el('button', 'season-btn', 'Temporada ' + s.num);
        b.setAttribute('data-nav', '');
        b.onclick = function () { showSeason(si); P.nav.focus(eps.firstChild); };
        buttons.push(b);
        seasons.appendChild(b);
      });
      showSeason(0);
      P.nav.focus(eps.firstChild);
    });
  }

  function emptyMsg(text) { return P.el('div', 'empty', text); }

  // ---------- Inicio ----------
  screens.home = (function () {
    var heroBtn = null;

    function addRow(parent, title, items, full) {
      if (!items.length) return;
      var row = P.el('div', 'row');
      row.appendChild(P.el('h2', '', title));
      var line = P.el('div', 'row-items scroll-x');
      line.setAttribute('data-nav-group', 'row-' + title);
      line.setAttribute('data-nav-lock', 'x');
      items.forEach(function (it) { line.appendChild(card(it, full || items)); });
      row.appendChild(line);
      parent.appendChild(row);
    }

    function render(c) {
      var root = P.el('div', 'home scroll-y');
      var hero = P.el('div', 'hero');
      var text = P.el('div', 'hero-text');
      var last = recents[0];
      if (last) {
        hero.appendChild(P.logo(last.logo, last.name, 'hero-logo'));
        text.appendChild(P.el('div', 'hero-kicker', 'Seguir viendo'));
        text.appendChild(P.el('h2', '', last.name));
        text.appendChild(P.el('p', '', last.group || ''));
        heroBtn = P.btn('▶ Ver ahora', 'primary', function () { P.player.open(recents.slice(), 0); });
      } else {
        text.appendChild(P.el('div', 'hero-kicker', P.sourceLabel(S.cfg)));
        text.appendChild(P.el('h2', '', 'Bienvenido a Patroclo TV'));
        text.appendChild(P.el('p', '', S.live.length + ' canales en vivo' +
          (S.vod.length ? ' · ' + S.vod.length + ' películas' : '') +
          (S.series.length ? ' · ' + S.series.length + ' series' : '')));
        heroBtn = P.btn('Ir a TV en vivo', 'primary', function () { showTab('live', true); });
      }
      text.appendChild(heroBtn);
      hero.appendChild(text);
      root.appendChild(hero);

      addRow(root, 'Vistos recientemente', recents.slice());
      addRow(root, 'Favoritos', favs.slice(0, 30));
      var feat = S.live.filter(function (x) { return x.featured; });
      if (!feat.length) feat = S.live;
      addRow(root, 'Destacados en vivo', feat.slice(0, 30), feat);
      var shown = 0;
      S.groups.live.forEach(function (g) {
        if (shown < 3 && /noticia|deporte|news|sport/i.test(g.name)) { shown++; addRow(root, g.name, g.items.slice(0, 30), g.items); }
      });
      if (S.vod.length) addRow(root, 'Películas de tu lista', S.vod.slice(0, 30), S.vod);
      if (S.series.length) addRow(root, 'Series', S.series.slice(0, 30), S.series);
      c.appendChild(root);
      P.loadCatalog(function (cat) {
        if (cur === screens.home && root.parentNode) addRow(root, 'Clásicos completos', cat.classics);
      });
    }

    return { render: render, first: function () { return heroBtn; } };
  })();

  // ---------- TV en vivo ----------
  screens.live = (function () {
    var ROWS = 11;
    var groupsEl, rowsEl, headEl, posEl, info = {}, groups = [], gi = 0, items = [], sel = 0, top = 0, dwell, infoTimer;

    function allGroups() {
      var g = [{ name: 'Todos los canales', items: S.live }];
      g.push({ name: '★ Favoritos', items: favs.filter(function (f) { return f.type === 'live'; }), fav: true });
      if (recents.length) g.push({ name: 'Vistos recientemente', items: recents.slice() });
      return g.concat(S.groups.live);
    }

    function render(c) {
      var root = P.el('div', 'live');
      groupsEl = P.el('div', 'col-groups scroll-y');
      groupsEl.setAttribute('data-nav-group', 'lgroups');
      var col = P.el('div', 'col-list');
      headEl = P.el('div', 'list-head');
      rowsEl = P.el('div', 'ch-rows');
      rowsEl.setAttribute('data-nav-group', 'lrows');
      posEl = P.el('div', 'list-pos');
      col.appendChild(headEl);
      col.appendChild(rowsEl);
      col.appendChild(posEl);

      var inf = P.el('div', 'col-info');
      info.logo = P.el('div', 'info-logo');
      info.name = P.el('div', 'info-name');
      info.meta = P.el('div', 'info-meta');
      info.play = P.btn('▶ Ver ahora', 'primary block', play);
      info.fav = P.btn('☆ Favorito', 'block', function () {
        if (items[sel]) P.toggleFav(items[sel]);
      });
      var hints = P.el('div', 'hints');
      hints.innerHTML = '<span class="key k-white">OK</span>Ver canal<br><span class="key k-yellow">&nbsp;</span>Favorito<br>' +
        '<span class="key k-white">CH</span>Avanzar de a una página';
      inf.appendChild(info.logo);
      inf.appendChild(info.name);
      inf.appendChild(info.meta);
      inf.appendChild(info.play);
      inf.appendChild(info.fav);
      inf.appendChild(hints);

      groups = allGroups();
      groups.forEach(function (g, i) {
        var b = P.el('button', 'grp');
        b.setAttribute('data-nav', '');
        b._gi = i;
        b.appendChild(P.el('span', 'cnt', String(g.items.length)));
        b.appendChild(document.createTextNode(g.name));
        b._onFocus = function () {
          clearTimeout(dwell);
          dwell = setTimeout(function () { if (gi !== i) selectGroup(i); }, 300);
        };
        b.onclick = function () {
          clearTimeout(dwell);
          if (gi !== i) selectGroup(i);
          focusRow();
        };
        groupsEl.appendChild(b);
      });
      root.appendChild(groupsEl);
      root.appendChild(col);
      root.appendChild(inf);
      c.appendChild(root);
      selectGroup(Math.min(gi, groups.length - 1), true);
    }

    function selectGroup(i, keep) {
      gi = i;
      items = groups[i].items;
      if (!keep) { sel = 0; top = 0; }
      sel = Math.max(0, Math.min(sel, items.length - 1));
      var btns = groupsEl.childNodes;
      for (var k = 0; k < btns.length; k++) btns[k].classList.toggle('active', k === i);
      groupsEl._last = btns[i];
      P.clear(headEl);
      headEl.appendChild(P.el('span', '', groups[i].name));
      headEl.appendChild(P.el('span', 'muted', items.length + ' canales'));
      renderRows();
      updateInfo();
    }

    function renderRows() {
      P.clear(rowsEl);
      if (!items.length) {
        rowsEl.appendChild(emptyMsg(groups[gi].fav
          ? 'Todavía no tenés canales favoritos. Marcalos con el botón amarillo del control.'
          : 'No hay canales en esta categoría.'));
        posEl.textContent = '';
        return;
      }
      if (sel < top) top = sel;
      if (sel >= top + ROWS) top = sel - ROWS + 1;
      top = Math.max(0, Math.min(top, items.length - ROWS));
      for (var i = top; i < Math.min(items.length, top + ROWS); i++) rowsEl.appendChild(row(i));
      rowsEl._last = rowEl(sel);
      posEl.textContent = (sel + 1) + ' / ' + items.length;
    }

    function row(i) {
      var it = items[i], b = P.el('button', 'ch-row has-item' + (i === sel ? ' sel' : ''));
      b.setAttribute('data-nav', '');
      b._item = it;
      b._idx = i;
      b.appendChild(P.el('span', 'num', String(i + 1)));
      b.appendChild(P.logo(it.logo, it.name, 'sm'));
      b.appendChild(P.el('span', 'nm', it.name));
      b.appendChild(P.el('span', 'star', '★'));
      markFav(b, it);
      b._onFocus = function () { setSel(i); };
      b.onclick = function () { sel = i; play(); };
      return b;
    }

    function rowEl(i) {
      var c = rowsEl.childNodes;
      for (var k = 0; k < c.length; k++) if (c[k]._idx === i) return c[k];
      return null;
    }

    function setSel(i) {
      var old = rowEl(sel);
      if (old) old.classList.remove('sel');
      sel = i;
      var r = rowEl(i);
      if (r) r.classList.add('sel');
      posEl.textContent = (sel + 1) + ' / ' + items.length;
      clearTimeout(infoTimer);
      infoTimer = setTimeout(updateInfo, 120);
    }

    function updateInfo() {
      var it = items[sel];
      P.clear(info.logo);
      if (!it) {
        info.name.textContent = '';
        info.meta.textContent = '';
        return;
      }
      info.logo.appendChild(P.logo(it.logo, it.name, ''));
      info.name.textContent = it.name;
      var mirrors = P.mirrorsOf(it).length;
      info.meta.textContent = (it.group || '') + '  ·  Canal ' + (sel + 1) + (mirrors > 1 ? '  ·  ' + mirrors + ' señales' : '');
      info.fav.textContent = P.isFav(it) ? '★ En favoritos' : '☆ Agregar a favoritos';
    }

    function focusRow() {
      if (!items.length) return;
      renderRows();
      var r = rowEl(sel);
      if (r) P.nav.focus(r);
    }

    function moveSel(delta) {
      var n = Math.max(0, Math.min(items.length - 1, sel + delta));
      if (n === sel) return;
      sel = n;
      var r = rowEl(sel);
      if (!r) { renderRows(); r = rowEl(sel); }
      P.nav.focus(r);
    }

    function play() {
      if (!items.length) return;
      var list = items;
      P.player.open(list, sel, {
        onClose: function (idx) {
          if (cur !== screens.live || items !== list) return;
          sel = idx;
          if (P.nav.current() && P.nav.current().className.indexOf('ch-row') !== -1) focusRow();
          else { renderRows(); updateInfo(); }
        }
      });
    }

    function onKey(e, f) {
      if (!f) return false;
      // Entre columnas siempre se vuelve al canal seleccionado.
      var fromGroups = e.keyCode === K.RIGHT && groupsEl.contains(f);
      var fromInfo = e.keyCode === K.LEFT && info.play.parentNode.contains(f);
      if (fromGroups) {
        clearTimeout(dwell);
        if (f._gi !== gi) selectGroup(f._gi);
      }
      if ((fromGroups || fromInfo) && items.length) {
        focusRow();
        return true;
      }
      if (f.className.indexOf('ch-row') === -1) return false;
      switch (e.keyCode) {
        case K.LEFT: P.nav.focus(groupsEl._last || groupsEl.firstChild); return true;
        case K.RIGHT: P.nav.focus(info.play); return true;
        case K.DOWN: moveSel(1); return true;
        case K.UP: if (sel > 0) { moveSel(-1); return true; } return false;
        case K.PGDN: case K.CHDOWN: moveSel(ROWS); return true;
        case K.PGUP: case K.CHUP: moveSel(-ROWS); return true;
      }
      return false;
    }

    function onFavChange() {
      groups[1].items = favs.filter(function (x) { return x.type === 'live'; });
      groupsEl.childNodes[1].firstChild.textContent = String(groups[1].items.length);
      updateInfo();
      if (groups[gi] && groups[gi].fav) {
        items = groups[gi].items;
        sel = Math.min(sel, Math.max(0, items.length - 1));
        renderRows();
      }
    }

    return {
      render: render,
      onKey: onKey,
      onFavChange: onFavChange,
      first: function () { return rowEl(sel) || groupsEl.firstChild; }
    };
  })();

  // ---------- catálogo genérico: categorías + grilla de pósters ----------
  function catalogScreen(id, loadGroups, emptyText) {
    var CHUNK = 30, gi = 0, groupsEl, wrap, head, grid, groups = [], shown = 0, dwell;

    function render(c) {
      var root = P.el('div', 'catalog');
      groupsEl = P.el('div', 'col-groups scroll-y');
      groupsEl.setAttribute('data-nav-group', id + '-groups');
      wrap = P.el('div', 'grid-wrap scroll-y');
      head = P.el('div', 'grid-head');
      grid = P.el('div', 'grid');
      grid.setAttribute('data-nav-group', id + '-grid');
      wrap.appendChild(head);
      wrap.appendChild(grid);
      root.appendChild(groupsEl);
      root.appendChild(wrap);
      c.appendChild(root);
      grid.appendChild(emptyMsg('Cargando…'));
      loadGroups(function (g) {
        if (!root.parentNode) return;
        groups = g.filter(function (x) { return x.items.length; });
        P.clear(grid);
        if (!groups.length) {
          root.removeChild(groupsEl);
          grid.appendChild(emptyMsg(emptyText));
          return;
        }
        groups.forEach(addGroupButton);
        select(Math.min(gi, groups.length - 1));
      });
    }

    function addGroupButton(g, i) {
      var b = P.el('button', 'grp');
      b.setAttribute('data-nav', '');
      b._gi = i;
      b.appendChild(P.el('span', 'cnt', String(g.items.length)));
      b.appendChild(document.createTextNode(g.name));
      b._onFocus = function () {
        clearTimeout(dwell);
        dwell = setTimeout(function () { if (gi !== i) select(i); }, 300);
      };
      b.onclick = function () {
        clearTimeout(dwell);
        if (gi !== i) select(i);
        if (grid.firstChild && grid.firstChild.hasAttribute('data-nav')) P.nav.focus(grid.firstChild);
      };
      groupsEl.appendChild(b);
    }

    function select(i) {
      gi = i;
      var btns = groupsEl.childNodes;
      for (var k = 0; k < btns.length; k++) btns[k].classList.toggle('active', k === i);
      groupsEl._last = btns[i];
      P.clear(head);
      head.appendChild(P.el('span', '', groups[i].name));
      head.appendChild(P.el('span', 'muted', '  ·  ' + groups[i].items.length));
      P.clear(grid);
      grid._last = null;
      shown = 0;
      wrap.scrollTop = 0;
      more();
    }

    function more() {
      var list = groups[gi].items, end = Math.min(list.length, shown + CHUNK);
      for (var i = shown; i < end; i++) grid.appendChild(cardAt(list, i));
      shown = end;
    }

    function cardAt(list, i) {
      var b = card(list[i], list);
      b._onFocus = function () { if (i >= shown - 10 && shown < list.length) more(); };
      return b;
    }

    function firstCard() {
      var f = grid && grid.firstChild;
      return f && f.hasAttribute && f.hasAttribute('data-nav') ? f : null;
    }

    return {
      render: render,
      first: function () { return firstCard() || (groupsEl && groupsEl.firstChild); },
      // Desde las categorías, "derecha" entra a la grilla por el último póster usado.
      onKey: function (e, f) {
        if (e.keyCode === K.LEFT && f && grid && grid.contains(f) && groupsEl.parentNode) {
          if (!P.nav.move('left')) P.nav.focus(groupsEl._last || groupsEl.firstChild);
          return true;
        }
        if (e.keyCode !== K.RIGHT || !f || !groupsEl || !groupsEl.contains(f)) return false;
        clearTimeout(dwell);
        if (f._gi !== gi) select(f._gi);
        if (!firstCard()) return true;
        var mem = grid._last;
        P.nav.focus(mem && grid.contains(mem) ? mem : firstCard());
        return true;
      },
      // Agrega una categoría que llegó más tarde (por ejemplo, de Internet Archive).
      addGroup: function (g) {
        if (!groupsEl || !groupsEl.parentNode || !g.items.length) return;
        groups.push(g);
        addGroupButton(g, groups.length - 1);
      }
    };
  }

  screens.movies = catalogScreen('movies', function (cb) {
    P.loadCatalog(function (cat) {
      var g = [{ name: 'Clásicos completos', items: cat.classics }];
      if (cat.archive) g.push({ name: 'Cine clásico (Internet Archive)', items: cat.archive });
      g = g.concat(S.groups.vod, cat.estrenos);
      cb(g);
      if (!cat.archive) {
        P.archiveSpanish(function (list) {
          if (cur === screens.movies && list.length) {
            screens.movies.addGroup({ name: 'Cine clásico (Internet Archive)', items: list });
          }
        });
      }
    });
  }, 'No hay películas disponibles.');

  screens.series = catalogScreen('series', function (cb) {
    cb(S.groups.series);
  }, 'Tu fuente no tiene series. Las cuentas Xtream Codes suelen incluirlas.');

  screens.favs = catalogScreen('favs', function (cb) {
    function only(fn) { return favs.filter(fn); }
    cb([
      { name: 'Todos', items: favs.slice() },
      { name: 'Canales', items: only(function (x) { return x.type === 'live'; }) },
      { name: 'Películas', items: only(function (x) { return x.type === 'vod' || x.type === 'info' || x.type === 'episode'; }) },
      { name: 'Series', items: only(function (x) { return x.type === 'series'; }) }
    ]);
  }, 'Todavía no tenés favoritos. Apretá el botón amarillo del control sobre cualquier canal o película.');

  // ---------- Buscar ----------
  screens.search = (function () {
    var q = '', input, res, timer, req = 0;

    function render(c) {
      var root = P.el('div', 'search');
      input = P.el('input', 'field search-input');
      input.type = 'text';
      input.setAttribute('data-nav', '');
      input.placeholder = 'Buscar canales, películas o series…';
      input.value = q;
      input.oninput = function () {
        clearTimeout(timer);
        timer = setTimeout(run, 450);
      };
      input._submit = run;
      res = P.el('div', 'search-results scroll-y');
      root.appendChild(input);
      root.appendChild(res);
      c.appendChild(root);
      run();
    }

    function section(title, items) {
      var s = P.el('div', 'sec');
      s.appendChild(P.el('div', 'sec-title', title));
      var g = P.el('div', 'grid');
      g.setAttribute('data-nav-group', 'search-' + title);
      items.forEach(function (it) { g.appendChild(card(it, items)); });
      s.appendChild(g);
      res.appendChild(s);
      return g;
    }

    function matches(list, nq, max, out) {
      for (var i = 0; i < list.length && out.length < max; i++) {
        var it = list[i];
        if (it._n === undefined) it._n = P.norm(it.name);
        if (it._n.indexOf(nq) !== -1) out.push(it);
      }
      return out;
    }

    function run() {
      q = input.value;
      var nq = P.norm(q).trim(), id = ++req;
      P.clear(res);
      if (nq.length < 2) {
        res.appendChild(emptyMsg(P.isTizen
          ? 'Apretá OK sobre el cuadro de búsqueda para abrir el teclado del televisor.'
          : 'Escribí al menos 2 letras.'));
        return;
      }
      var live = matches(S.live, nq, 60, []);
      var vod = matches(S.vod, nq, 60, matches(S.series, nq, 30, []));
      if (live.length) section('Canales', live);
      P.loadCatalog(function (cat) {
        if (id !== req) return;
        var extra = matches(cat.classics, nq, 20, []);
        cat.estrenos.forEach(function (g) { matches(g.items, nq, 20, extra); });
        var all = vod.concat(extra);
        if (all.length) section('Películas y series', all);
        if (!live.length && !all.length) res.appendChild(emptyMsg('Sin resultados en tu lista para "' + q + '".'));
        if (nq.length >= 3) {
          P.archiveSearch(q, function (list) {
            if (id !== req || !list.length) return;
            section('Películas completas en Internet Archive', list);
          });
        }
      });
    }

    return {
      render: render,
      first: function () { return input; },
      setQuery: function (text) { q = text; }
    };
  })();

  function goSearch(text) {
    screens.search.setQuery(text);
    showTab('search', false);
    P.nav.focus(screens.search.first());
  }

  // ---------- Ajustes ----------
  screens.settings = (function () {
    var firstBtn;

    function fmtDate(sec) {
      var d = new Date(parseInt(sec, 10) * 1000);
      return P.pad2(d.getDate()) + '/' + P.pad2(d.getMonth() + 1) + '/' + d.getFullYear();
    }

    function render(c) {
      var root = P.el('div', 'settings scroll-y');
      var w = P.el('div', 'set-wrap');
      root.appendChild(w);
      function row(lbl, val, button) {
        var r = P.el('div', 'set-row');
        r.appendChild(P.el('div', 'lbl', lbl));
        r.appendChild(P.el('div', 'val', val));
        if (button) r.appendChild(button);
        w.appendChild(r);
      }

      firstBtn = P.btn('Cambiar fuente', 'primary', function () { showSetup(); });
      row('Fuente', P.sourceLabel(S.cfg), firstBtn);
      row('Contenido', S.live.length + ' canales · ' + S.vod.length + ' películas · ' + S.series.length + ' series',
        P.btn('Recargar lista', '', function () { P.store.del(CACHE_KEY); loadAndEnter(null); }));

      if (S.info && S.info.xtream) {
        var x = S.info.xtream;
        row('Cuenta Xtream', 'Estado: ' + (x.status || '?') +
          (x.exp ? ' · vence el ' + fmtDate(x.exp) : ' · sin vencimiento') +
          ' · conexiones ' + (x.active || 0) + '/' + (x.max || '?'));
        var ext = S.cfg.liveExt || 'm3u8';
        row('Formato en vivo', ext === 'ts' ? 'MPEG-TS (.ts)' : 'HLS (.m3u8)',
          P.btn(ext === 'ts' ? 'Usar HLS' : 'Usar MPEG-TS', '', function () {
            S.cfg.liveExt = ext === 'ts' ? 'm3u8' : 'ts';
            P.store.set(CFG_KEY, S.cfg);
            loadAndEnter(null);
          }));
      }

      var pb = P.btn('', '', function () {
        P.settings.player = P.settings.player === 'html5' ? 'auto' : 'html5';
        P.store.set(SET_KEY, P.settings);
        pb.textContent = playerLabel();
      });
      pb.textContent = playerLabel();
      row('Reproductor', P.hasAVPlay() ? 'AVPlay de Samsung disponible' : 'HTML5 (navegador)', pb);

      row('Favoritos', favs.length + ' guardados', P.btn('Borrar favoritos', '', function () {
        P.confirm('¿Borrar todos los favoritos?', '', 'Borrar', function () {
          favs = [];
          P.store.set(FAV_KEY, favs);
          showTab('settings', true);
        });
      }));
      row('Historial', recents.length + ' canales vistos', P.btn('Borrar historial', '', function () {
        recents = [];
        P.store.set(REC_KEY, recents);
        showTab('settings', true);
      }));
      row('Datos de la app', 'Fuente, lista guardada, favoritos y ajustes', P.btn('Borrar todo', '', function () {
        P.confirm('¿Borrar todos los datos?', 'La app vuelve a empezar desde cero en este televisor.', 'Borrar todo', function () {
          [CFG_KEY, CACHE_KEY, FAV_KEY, REC_KEY, SET_KEY, 'ptv_pos'].forEach(P.store.del);
          location.reload();
        });
      }));

      var help = P.el('div', 'help');
      help.setAttribute('data-nav', '');
      help.innerHTML = '<h3>Control remoto</h3>' +
        '<p><span class="key k-white">▲▼◀▶</span>Moverse &nbsp; <span class="key k-white">OK</span>Elegir &nbsp; <span class="key k-white">Volver</span>Atrás</p>' +
        '<p>En un canal: <span class="key k-white">▲▼ / CH</span>Cambiar canal &nbsp; <span class="key k-white">0-9</span>Ir al número &nbsp; ' +
        '<span class="key k-green">&nbsp;</span>Otra señal &nbsp; <span class="key k-yellow">&nbsp;</span>Favorito &nbsp; <span class="key k-white">Info</span>Datos</p>' +
        '<p>En una película: <span class="key k-white">OK / Play</span>Pausa &nbsp; <span class="key k-white">◀▶</span>10 seg &nbsp; <span class="key k-white">REW FF</span>30 seg</p>';
      w.appendChild(help);
      w.appendChild(P.el('p', 'version', 'Patroclo TV ' + P.VERSION + (P.isTizen ? ' · Samsung Tizen' : ' · Navegador')));
      c.appendChild(root);
    }

    function playerLabel() {
      return P.settings.player === 'html5' ? 'Modo: HTML5' : 'Modo: Automático';
    }

    return { render: render, first: function () { return firstBtn; } };
  })();

  // ---------- pestañas ----------
  var TABS = [
    { id: 'home', label: 'Inicio' },
    { id: 'live', label: 'TV en vivo' },
    { id: 'movies', label: 'Películas' },
    { id: 'series', label: 'Series' },
    { id: 'search', label: 'Buscar' },
    { id: 'favs', label: 'Favoritos' },
    { id: 'settings', label: 'Ajustes' }
  ];

  function buildTabs() {
    P.clear(tabsEl);
    TABS.forEach(function (t) {
      if (t.id === 'series' && !S.series.length) return;
      var b = P.el('button', 'tab', t.label);
      b.setAttribute('data-nav', '');
      b._tab = t.id;
      // Al quedarse un momento sobre una pestaña, se muestra su contenido.
      b._onFocus = function () {
        clearTimeout(tabDwell);
        tabDwell = setTimeout(function () { if (S.tab !== t.id) showTab(t.id, false); }, 450);
      };
      b.onclick = function () {
        clearTimeout(tabDwell);
        if (S.tab !== t.id) showTab(t.id, false);
        focusContent();
      };
      tabsEl.appendChild(b);
    });
  }

  function tabButton(id) {
    var c = tabsEl.childNodes;
    for (var i = 0; i < c.length; i++) if (c[i]._tab === id) return c[i];
    return c[0];
  }

  function showTab(id, focus) {
    S.tab = id;
    var c = tabsEl.childNodes;
    for (var i = 0; i < c.length; i++) c[i].classList.toggle('active', c[i]._tab === id);
    tabsEl._last = tabButton(id);
    P.clear(contentEl);
    cur = screens[id];
    cur.render(contentEl);
    if (focus) focusContent();
  }

  function focusContent() {
    var f = cur && cur.first && cur.first();
    if (f) P.nav.focus(f);
  }

  // ---------- configuración inicial ----------
  function showSetup(errMsg, prefill) {
    shellEl.classList.add('hidden');
    setupEl.classList.remove('hidden');
    P.clear(setupEl);
    var pre = prefill || S.cfg || {};
    var canGoBack = S.cfg && (S.live.length || S.vod.length || S.series.length);

    var title = P.el('h1', 'brand-xl');
    title.appendChild(P.el('span', 'accent', 'Patroclo'));
    title.appendChild(document.createTextNode(' TV'));
    setupEl.appendChild(title);
    setupEl.appendChild(P.el('p', 'tagline', 'IPTV para Smart TV — elegí cómo querés cargar tu contenido'));
    if (canGoBack) {
      var back = P.btn('Volver', 'setup-back', enterShell);
      setupEl.appendChild(back);
    }
    if (errMsg) setupEl.appendChild(P.el('div', 'error-box', errMsg));

    var row = P.el('div', 'demo-row');
    var focusEl = null;
    P.DEMO_ORDER.forEach(function (id) {
      var d = P.DEMOS[id];
      var b = P.el('button', 'demo' + (d.recommended ? ' rec' : ''));
      b.setAttribute('data-nav', '');
      b.appendChild(P.el('div', 'badge', d.badge));
      b.appendChild(P.el('div', 't', d.label));
      b.appendChild(P.el('div', 'd', d.desc));
      if (d.recommended) b.appendChild(P.el('div', 'rec-tag', 'Recomendado'));
      b.onclick = function () { connect({ kind: 'demo', demoId: id }); };
      if (!focusEl || (pre.kind === 'demo' && pre.demoId === id)) focusEl = b;
      row.appendChild(b);
    });
    setupEl.appendChild(row);

    function field(type, placeholder, value) {
      var f = P.el('input', 'field');
      f.type = type;
      f.placeholder = placeholder;
      f.value = value || '';
      f.setAttribute('data-nav', '');
      f.setAttribute('autocomplete', 'off');
      return f;
    }

    var panels = P.el('div', 'panel-row');
    var pm = P.el('div', 'panel');
    pm.appendChild(P.el('div', 'badge', 'M3U'));
    pm.appendChild(P.el('h3', '', 'Mi lista M3U'));
    var m3u = field('text', 'http://servidor.com/lista.m3u', pre.kind === 'm3u' ? pre.url : '');
    pm.appendChild(m3u);
    pm.appendChild(P.btn('Conectar', 'primary block', function () {
      var url = m3u.value.trim();
      if (!url) return P.toast('Escribí la dirección de la lista');
      connect({ kind: 'm3u', url: url });
    }));
    if (pre.kind === 'm3u') focusEl = m3u;

    var px = P.el('div', 'panel');
    px.appendChild(P.el('div', 'badge', 'XC'));
    px.appendChild(P.el('h3', '', 'Xtream Codes'));
    var xs = field('text', 'http://servidor:8080', pre.kind === 'xtream' ? pre.server : '');
    var xu = field('text', 'Usuario', pre.kind === 'xtream' ? pre.user : '');
    var xp = field('password', 'Contraseña', pre.kind === 'xtream' ? pre.pass : '');
    px.appendChild(xs);
    px.appendChild(xu);
    px.appendChild(xp);
    px.appendChild(P.btn('Conectar', 'primary block', function () {
      if (!xs.value.trim() || !xu.value.trim() || !xp.value) return P.toast('Completá servidor, usuario y contraseña');
      connect({ kind: 'xtream', server: xs.value.trim(), user: xu.value.trim(), pass: xp.value, liveExt: pre.liveExt || 'm3u8' });
    }));
    if (pre.kind === 'xtream') focusEl = xs;

    panels.appendChild(pm);
    panels.appendChild(px);
    setupEl.appendChild(panels);
    setupEl.appendChild(P.el('p', 'foot', 'Los datos se guardan solo en esta TV. Después podés cambiarlos en Ajustes.'));
    P.nav.focus(focusEl);
  }

  function connect(cfg) {
    P.loading('Cargando ' + P.sourceLabel(cfg) + '…');
    P.loadSource(cfg, function (err, res) {
      P.loading(false);
      if (err) return showSetup(err.message, cfg);
      S.cfg = cfg;
      P.store.set(CFG_KEY, cfg);
      saveCache(cfg, res);
      useResult(res);
      S.tab = 'home';
      enterShell();
    });
  }

  function enterShell() {
    setupEl.classList.add('hidden');
    shellEl.classList.remove('hidden');
    buildTabs();
    if (S.tab === 'series' && !S.series.length) S.tab = 'home';
    showTab(S.tab, true);
  }

  function loadAndEnter(stale) {
    P.loading('Cargando ' + P.sourceLabel(S.cfg) + '…');
    P.loadSource(S.cfg, function (err, res) {
      P.loading(false);
      if (err) {
        if (stale && stale.channels && stale.channels.length) {
          useResult(stale);
          enterShell();
          P.toast('No se pudo actualizar la lista: se usa la última guardada', 4000);
        } else {
          showSetup(err.message);
        }
        return;
      }
      saveCache(S.cfg, res);
      useResult(res);
      enterShell();
    });
  }

  // ---------- teclas ----------
  function back() {
    if (P.modal.isOpen()) return P.modal.close();
    if (!setupEl.classList.contains('hidden')) {
      if (S.cfg && (S.live.length || S.vod.length || S.series.length)) enterShell();
      else confirmExit();
      return;
    }
    var f = P.nav.current();
    if (f && !tabsEl.contains(f)) return P.nav.focus(tabButton(S.tab));
    if (S.tab !== 'home') {
      showTab('home', false);
      return P.nav.focus(tabButton('home'));
    }
    confirmExit();
  }

  function confirmExit() {
    P.confirm('¿Salir de Patroclo TV?', '', 'Salir', P.exitApp);
  }

  function inputKey(e, el) {
    var k = e.keyCode;
    if (k === K.DONE || k === K.ENTER) {
      el.blur();
      if (el._submit) el._submit();
    } else if (k === K.CANCEL || k === K.BACK || k === K.ESC) {
      el.blur();
    } else if (k === K.UP || k === K.DOWN) {
      el.blur();
      P.nav.move(k === K.UP ? 'up' : 'down');
    } else if (k === K.LEFT && el.selectionStart === 0 && el.selectionEnd === 0) {
      el.blur();
      P.nav.move('left');
    } else if (k === K.RIGHT && el.selectionStart === el.value.length) {
      el.blur();
      P.nav.move('right');
    } else {
      return; // escribir normalmente
    }
    e.preventDefault();
  }

  function onKeyDown(e) {
    var k = e.keyCode;
    P.nav.keyTick();
    if (P.player.isOpen()) {
      P.player.onKey(e);
      e.preventDefault();
      return;
    }
    if (P.isLoading()) {
      e.preventDefault();
      return;
    }
    var ae = document.activeElement;
    if (ae && ae.tagName === 'INPUT') return inputKey(e, ae);

    var f = P.nav.current();
    if (!P.modal.isOpen() && !shellEl.classList.contains('hidden') && cur && cur.onKey && cur.onKey(e, f)) {
      e.preventDefault();
      return;
    }
    switch (k) {
      case K.LEFT: P.nav.move('left'); break;
      case K.RIGHT: P.nav.move('right'); break;
      case K.UP: P.nav.move('up'); break;
      case K.DOWN: P.nav.move('down'); break;
      case K.ENTER:
        if (!f) P.nav.first();
        else if (f.tagName === 'INPUT') f.focus();
        else f.click();
        break;
      case K.BACK: case K.ESC: case K.BACKSPACE: back(); break;
      case K.YELLOW: case 70:
        if (f && f._item) P.toggleFav(f._item);
        break;
      default: return;
    }
    e.preventDefault();
  }

  // ---------- arranque ----------
  function start() {
    setupEl = document.getElementById('setup');
    shellEl = document.getElementById('shell');
    tabsEl = document.getElementById('tabs');
    contentEl = document.getElementById('content');
    clockEl = document.getElementById('clock');
    tabsEl.setAttribute('data-nav-group', 'tabs');
    tabsEl.setAttribute('data-nav-lock', 'x');

    P.fitStage();
    window.addEventListener('resize', P.fitStage);
    P.registerKeys();
    P.player.init();
    document.addEventListener('keydown', onKeyDown);
    clockEl.textContent = P.clockText();
    setInterval(function () { clockEl.textContent = P.clockText(); }, 15000);

    S.cfg = P.store.get(CFG_KEY, null);
    if (!S.cfg) return showSetup();
    var cache = P.store.get(CACHE_KEY, null);
    if (cache && cache.key !== cfgKey(S.cfg)) cache = null;
    if (cache && Date.now() - cache.ts < CACHE_TTL && cache.channels && cache.channels.length) {
      useResult(cache);
      enterShell();
      return;
    }
    loadAndEnter(cache);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(PTV);
