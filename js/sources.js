/* Patroclo TV — fuentes de contenido: listas M3U, Xtream Codes e Internet Archive. */
(function (P) {
  'use strict';

  P.DEMOS = {
    ar: {
      label: 'Argentina', badge: 'AR',
      desc: '~200 canales abiertos: noticias, deportes, general. Sin configurar nada.',
      url: 'https://iptv-org.github.io/iptv/countries/ar.m3u',
      extra: 'data/destacados-ar.json'
    },
    spa: {
      label: 'En español', badge: 'ES+',
      desc: '~2.400 canales abiertos de toda Latinoamérica y España.',
      url: 'https://iptv-org.github.io/iptv/languages/spa.m3u',
      extra: 'data/destacados-ar.json'
    },
    freetv: {
      label: 'Free-TV global', badge: 'TV', recommended: true,
      desc: '~2.200 canales de más de 100 países, verificados por la comunidad.',
      url: 'https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8',
      extra: 'data/destacados-ar.json'
    },
    es: {
      label: 'España', badge: 'ES',
      desc: '~326 canales: TV pública y autonómica, Pluto TV ES, Eurosport. Algunos solo funcionan allí.',
      url: 'https://iptv-org.github.io/iptv/countries/es.m3u'
    },
    arc: {
      label: 'Argentina completa', badge: 'AR+',
      desc: '~240 señales con espejos alternativos. Incluye A24, DeporTV y TN.',
      url: 'data/argentina-completa.m3u',
      extra: 'data/destacados-ar.json'
    }
  };
  P.DEMO_ORDER = ['ar', 'spa', 'freetv', 'es', 'arc'];
  // Subirlo cuando cambian los archivos de data/: descarta las listas guardadas.
  P.DATA_VERSION = 2;

  P.sourceLabel = function (cfg) {
    if (!cfg) return '';
    if (cfg.kind === 'demo') return P.DEMOS[cfg.demoId] ? P.DEMOS[cfg.demoId].label : cfg.demoId;
    if (cfg.kind === 'm3u') return 'Lista M3U propia';
    return 'Xtream · ' + P.xtreamBase(cfg.server).replace(/^https?:\/\//, '');
  };

  // ---------- M3U ----------
  var GROUP_ES = {
    news: 'Noticias', sports: 'Deportes', general: 'General', music: 'Música', movies: 'Cine',
    entertainment: 'Entretenimiento', kids: 'Infantil', religious: 'Religión', documentary: 'Documentales',
    education: 'Educación', culture: 'Cultura', lifestyle: 'Estilo de vida', cooking: 'Cocina',
    series: 'Series', comedy: 'Comedia', business: 'Economía', legislative: 'Legislativo', shop: 'Compras',
    travel: 'Viajes', weather: 'Clima', auto: 'Motor', animation: 'Animación', classic: 'Clásicos',
    family: 'Familia', outdoor: 'Aire libre', science: 'Ciencia', relax: 'Relax', undefined: 'Otros'
  };

  function guessType(url) {
    var u = url.toLowerCase().split('?')[0];
    if (u.indexOf('/movie/') !== -1) return 'vod';
    if (u.indexOf('/series/') !== -1) return 'series';
    if (/\.(mp4|mkv|avi|mov|m4v|webm)$/.test(u)) return 'vod';
    return 'live';
  }

  // El nombre va después de la primera coma que no esté entre comillas.
  function nameFrom(line) {
    var inQ = false;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (c === '"') inQ = !inQ;
      else if (c === ',' && !inQ) return line.slice(i + 1).trim();
    }
    return '';
  }

  // Links de YouTube dentro de las listas: canal, video puntual o página a resolver.
  function youTubeInfo(url) {
    if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(url)) return null;
    var m = /\/channel\/(UC[\w-]{22})/.exec(url);
    if (m) return { ytId: m[1] };
    m = /[?&]v=([\w-]{11})/.exec(url) || /youtu\.be\/([\w-]{11})/.exec(url);
    if (m) return { ytVideo: m[1] };
    return { ytPage: true };
  }

  // Averigua el canal de un link del tipo youtube.com/@nombre/live.
  var ytCache = {};
  P.resolveYouTube = function (url, cb) {
    if (ytCache[url]) return cb(null, ytCache[url]);
    P.httpGet(url, { timeout: 20000 }, function (err, html) {
      var m = !err && (/"externalId":"(UC[\w-]{22})"/.exec(html) || /"channelId":"(UC[\w-]{22})"/.exec(html));
      if (!m) return cb(new Error('No se encontró el canal de YouTube'));
      ytCache[url] = m[1];
      cb(null, m[1]);
    });
  };

  P.parseM3U = function (text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [], seen = {}, cur = null, attrRe = /([\w-]+)="([^"]*)"/g, m;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('#EXTINF') === 0) {
        cur = { attrs: {}, name: nameFrom(line) };
        attrRe.lastIndex = 0;
        while ((m = attrRe.exec(line))) cur.attrs[m[1].toLowerCase()] = m[2];
      } else if (line.indexOf('#EXTVLCOPT:') === 0) {
        if (!cur) continue;
        var opt = line.slice(11);
        if (/^http-user-agent=/i.test(opt)) cur.ua = opt.replace(/^http-user-agent=/i, '');
        else if (/^http-referr?er=/i.test(opt)) cur.ref = opt.replace(/^http-referr?er=/i, '');
      } else if (line.indexOf('#EXTGRP:') === 0) {
        if (cur) cur.grp = line.slice(8).trim();
      } else if (line.charAt(0) !== '#') {
        var a = cur ? cur.attrs : {};
        var group = (a['group-title'] || (cur && cur.grp) || '').split(';')[0].trim() || 'General';
        var type = guessType(line);
        var id = type.charAt(0) + P.hash(line);
        if (seen[id]) id += '-' + (seen[id]++); else seen[id] = 1;
        var it = {
          id: id,
          name: (cur && cur.name) || a['tvg-name'] || line.split('/').pop(),
          logo: a['tvg-logo'] || '',
          group: GROUP_ES[group.toLowerCase()] || group,
          url: line,
          type: type
        };
        var yt = youTubeInfo(line);
        if (yt) { it.type = 'live'; P.extend(it, yt); }
        if (cur && cur.ua) it.ua = cur.ua;
        if (cur && cur.ref) it.ref = cur.ref;
        out.push(it);
        cur = null;
      }
    }
    return out;
  };

  function simpleName(n) {
    return P.norm(n).replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Suma los canales destacados (con logos y señales de YouTube) delante de la
  // lista, y completa logo y categoría de los canales de la lista con el mismo nombre.
  function mergeFeatured(featured, items) {
    var out = [], urls = {}, byName = {};
    for (var i = 0; i < featured.length; i++) {
      var f = featured[i];
      urls[f.url] = true;
      byName[simpleName(f.name)] = f;
      out.push(P.extend({ id: 'f' + P.hash(f.url), type: 'live', featured: true }, f));
    }
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      if (urls[it.url]) continue;
      var match = byName[simpleName(it.name)];
      if (match) {
        if (!it.logo) it.logo = match.logo;
        if (it.group === 'General') it.group = match.group;
      }
      out.push(it);
    }
    return out;
  }

  P.loadSource = function (cfg, cb) {
    if (cfg.kind === 'xtream') return loadXtream(cfg, cb);
    var demo = cfg.kind === 'demo' ? P.DEMOS[cfg.demoId] : null;
    var url = demo ? demo.url : cfg.url;
    P.httpGet(url, { timeout: 45000 }, function (err, text) {
      if (err) return cb(new Error('No se pudo descargar la lista: ' + err.message));
      if (!/#EXTINF/i.test(text)) return cb(new Error('El archivo no parece una lista M3U'));
      var items = P.parseM3U(text);
      if (!demo || !demo.extra) return finish(items);
      P.getJSON(demo.extra, {}, function (e2, featured) {
        finish(!e2 && featured ? mergeFeatured(featured, items) : items);
      });
    });
    function finish(items) {
      if (!items.length) return cb(new Error('La lista está vacía'));
      cb(null, { channels: items, info: null });
    }
  };

  // ---------- Xtream Codes ----------
  P.xtreamBase = function (server) {
    var s = String(server || '').trim();
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
    return s.replace(/\/(player_api|get)\.php.*$/i, '').replace(/\/+$/, '');
  };

  function api(cfg, action, extra) {
    return P.xtreamBase(cfg.server) + '/player_api.php?username=' + encodeURIComponent(cfg.user) +
      '&password=' + encodeURIComponent(cfg.pass) + (action ? '&action=' + action : '') + (extra || '');
  }

  function streamBase(cfg, kind) {
    return P.xtreamBase(cfg.server) + '/' + kind + '/' + encodeURIComponent(cfg.user) + '/' + encodeURIComponent(cfg.pass) + '/';
  }

  function loadXtream(cfg, cb) {
    P.getJSON(api(cfg), { timeout: 20000 }, function (err, auth) {
      if (err) return cb(new Error('No se pudo conectar con el servidor: ' + err.message));
      if (!auth || !auth.user_info || String(auth.user_info.auth) !== '1') {
        return cb(new Error('Usuario o contraseña incorrectos'));
      }
      var jobs = ['get_live_categories', 'get_live_streams', 'get_vod_categories',
        'get_vod_streams', 'get_series_categories', 'get_series'];
      var res = {}, pending = jobs.length;
      jobs.forEach(function (a) {
        P.getJSON(api(cfg, a), { timeout: 90000 }, function (e, data) {
          res[a] = !e && data && data.length !== undefined ? data : [];
          if (--pending === 0) build(auth.user_info, res);
        });
      });
    });

    function cats(list) {
      var m = {};
      for (var i = 0; i < list.length; i++) m[list[i].category_id] = list[i].category_name;
      return m;
    }

    function build(ui, res) {
      var out = [], lc = cats(res.get_live_categories), vc = cats(res.get_vod_categories),
        sc = cats(res.get_series_categories), ext = cfg.liveExt || 'm3u8',
        live = streamBase(cfg, 'live'), movie = streamBase(cfg, 'movie');
      res.get_live_streams.forEach(function (s) {
        out.push({
          id: 'l' + s.stream_id, name: s.name, logo: s.stream_icon || '',
          group: lc[s.category_id] || 'Sin categoría', type: 'live',
          url: live + s.stream_id + '.' + ext
        });
      });
      res.get_vod_streams.forEach(function (s) {
        out.push({
          id: 'v' + s.stream_id, name: s.name, logo: s.stream_icon || '',
          group: vc[s.category_id] || 'Sin categoría', type: 'vod',
          url: movie + s.stream_id + '.' + (s.container_extension || 'mp4')
        });
      });
      res.get_series.forEach(function (s) {
        out.push({
          id: 's' + s.series_id, name: s.name, logo: s.cover || '',
          group: sc[s.category_id] || 'Sin categoría', type: 'series', url: '',
          seriesId: s.series_id, synopsis: s.plot || '', year: s.releaseDate || s.year || ''
        });
      });
      if (!out.length) return cb(new Error('El servidor no devolvió canales ni películas'));
      cb(null, {
        channels: out,
        info: { xtream: { status: ui.status, exp: ui.exp_date, max: ui.max_connections, active: ui.active_cons } }
      });
    }
  }

  P.loadSeriesInfo = function (cfg, item, cb) {
    P.getJSON(api(cfg, 'get_series_info', '&series_id=' + encodeURIComponent(item.seriesId)), { timeout: 30000 }, function (err, data) {
      if (err || !data) return cb(err || new Error('Sin datos'));
      var base = streamBase(cfg, 'series'), eps = data.episodes || {}, bySeason = {}, keys = [];
      function add(season, ep) {
        if (!bySeason[season]) { bySeason[season] = []; keys.push(season); }
        bySeason[season].push({
          id: 'e' + ep.id,
          name: ep.title || 'Episodio ' + ep.episode_num,
          episode: ep.episode_num,
          logo: (ep.info && ep.info.movie_image) || item.logo,
          group: item.name + ' · T' + season,
          type: 'episode',
          url: base + ep.id + '.' + (ep.container_extension || 'mp4')
        });
      }
      if (eps.length !== undefined) {
        eps.forEach(function (ep) { add(String(ep.season || 1), ep); });
      } else {
        for (var k in eps) if (eps.hasOwnProperty(k)) (eps[k] || []).forEach(function (ep) { add(k, ep); });
      }
      keys.sort(function (a, b) { return (+a) - (+b); });
      var info = data.info || {};
      cb(null, {
        seasons: keys.map(function (k) { return { num: k, episodes: bySeason[k] }; }),
        plot: info.plot || item.synopsis || '',
        year: info.releaseDate || '',
        genre: info.genre || ''
      });
    });
  };

  // ---------- películas: catálogo local + Internet Archive ----------
  var cat = null;

  P.loadCatalog = function (cb) {
    if (cat) return cb(cat);
    P.getJSON('data/movies.json', { timeout: 15000 }, function (err, d) {
      d = d || {};
      cat = { classics: [], estrenos: [], archive: null };
      (d.classics || []).forEach(function (m) {
        cat.classics.push({
          id: m.id, name: m.title, logo: m.poster, group: 'Clásicos completos', url: m.url,
          type: 'vod', year: m.year,
          synopsis: m.synopsis || 'Película completa de dominio público, desde Internet Archive.'
        });
      });
      (d.sections || []).forEach(function (s) {
        var items = (s.movies || []).map(function (m) {
          return { id: m.id, name: m.title, logo: m.poster, group: s.label, type: 'info', year: m.year, synopsis: m.synopsis };
        });
        if (items.length) cat.estrenos.push({ name: 'Estrenos · ' + s.label, items: items });
      });
      cb(cat);
    });
  };

  function archiveQuery(q, rows, cb) {
    var url = 'https://archive.org/advancedsearch.php?q=' + encodeURIComponent(q) +
      '&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=description' +
      '&sort%5B%5D=downloads%20desc&rows=' + rows + '&output=json';
    P.getJSON(url, { timeout: 20000 }, function (err, d) {
      var docs = (d && d.response && d.response.docs) || [];
      cb(docs.map(function (x) {
        var desc = x.description;
        if (desc && desc.join) desc = desc.join(' ');
        desc = String(desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (desc.length > 420) desc = desc.slice(0, 420) + '…';
        return {
          id: 'ia-' + x.identifier, name: String(x.title || x.identifier),
          logo: 'https://archive.org/services/img/' + x.identifier, group: 'Internet Archive',
          url: 'ia:' + x.identifier, type: 'vod', year: x.year || '', synopsis: desc
        };
      }));
    });
  }

  P.archiveSpanish = function (cb) {
    if (cat && cat.archive) return cb(cat.archive);
    archiveQuery('collection:(feature_films) AND mediatype:(movies) AND language:(spa OR Spanish OR Español)', 80, function (list) {
      if (cat && list.length) cat.archive = list;
      cb(list);
    });
  };

  P.archiveSearch = function (text, cb) {
    var t = String(text).replace(/[^0-9A-Za-zÀ-ÿ ]/g, ' ').trim();
    if (!t) return cb([]);
    archiveQuery('collection:(feature_films) AND mediatype:(movies) AND title:(' + t + ')', 30, cb);
  };

  // Busca el MP4 reproducible de una película de Internet Archive.
  P.resolveArchive = function (id, cb) {
    P.getJSON('https://archive.org/metadata/' + encodeURIComponent(id), { timeout: 20000 }, function (err, d) {
      if (err || !d || !d.files) return cb(new Error('No se pudo abrir la película en Internet Archive'));
      var best = null, bestScore = -1;
      d.files.forEach(function (f) {
        if (!/\.mp4$/i.test(f.name || '')) return;
        var s = 1;
        if (/h\.264/i.test(f.format || '')) s += 2;
        if (/512kb/i.test(f.name)) s -= 1;
        if (s > bestScore) { bestScore = s; best = f; }
      });
      if (!best) return cb(new Error('Esta película no tiene un archivo MP4 compatible'));
      cb(null, 'https://archive.org/download/' + encodeURIComponent(id) + '/' +
        best.name.split('/').map(encodeURIComponent).join('/'));
    });
  };
})(PTV);
