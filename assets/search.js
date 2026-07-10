
(function () {
  var SITE = new URL('..', document.currentScript.src).href;
  var pf = null, pfErr = null;

  function engine() {
    if (pf) return Promise.resolve(pf);
    if (pfErr) return Promise.reject(pfErr);
    return import(SITE + 'pagefind/pagefind.js').then(function (m) {
      m.init();
      pf = m;
      return pf;
    }).catch(function (e) { pfErr = e; throw e; });
  }

  // Pinned title matches: BM25 over thousands of short records saturates, so
  // a query that IS a document/concept title can drown among claims. A tiny
  // local title+alias list guarantees named things surface first; Pagefind
  // still ranks all content below the pins.
  var titlesP = null;
  function loadTitles() {
    if (!titlesP) {
      titlesP = fetch(SITE + 'assets/titles.json')
        .then(function (r) { return r.json(); })
        .then(function (arr) {
          return arr.map(function (x) {
            return { t: x.t, l: x.t.toLowerCase(), u: x.u, k: x.k,
                     al: (x.a || []).map(function (a) { return a.toLowerCase(); }) };
          });
        })
        .catch(function () { return []; });
    }
    return titlesP;
  }
  function titleMatches(q, titles) {
    q = q.toLowerCase();
    var words = q.split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var scored = [];
    titles.forEach(function (t) {
      var s = 0;
      if (t.l === q) s = 4;
      else if (t.l.indexOf(q) === 0) s = 3;
      else if (t.al.indexOf(q) >= 0) s = 2.5;
      else if (t.l.indexOf(q) >= 0) s = 2;
      else if (t.al.some(function (a) { return a.indexOf(q) === 0; })) s = 1.5;
      else {
        var tw = t.l.split(/[^0-9a-zÀ-ɏ]+/);
        if (words.every(function (w) {
          return tw.some(function (x) { return x.indexOf(w) === 0; });
        })) s = 1;
      }
      if (s) scored.push([s - t.l.length / 200, t]);
    });
    scored.sort(function (a, b) { return b[0] - a[0]; });
    return scored.slice(0, 3).map(function (x) { return x[1]; });
  }

  function escHtml(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }
  function resolve(u) { return SITE + String(u).replace(/^\/+/, ''); }
  function rtype(d) {
    return (d.meta && d.meta.type) ||
      (d.filters && d.filters.type && d.filters.type[0]) || 'document';
  }
  function offlineMsg() {
    return "<div class='sres muted'>Search needs the site served over HTTP " +
      "(pagefind fetches its index) — run <code>make serve</code>.</div>";
  }

  // ---- nav quick-jump dropdown (present on every page) ----
  var box = document.getElementById('navq');
  var drop = document.getElementById('navdrop');
  if (box && drop) {
    var items = [], idx = -1;
    var close = function () { drop.hidden = true; drop.innerHTML = ''; items = []; idx = -1; };
    var highlight = function (i) {
      idx = i;
      items.forEach(function (el, j) { el.classList.toggle('active', j === idx); });
      if (idx >= 0) items[idx].scrollIntoView({ block: 'nearest' });
    };
    var fullUrl = function (q) {
      return SITE + 'search.html?q=' + encodeURIComponent(q);
    };
    var resLine = function (url, type, title, doc) {
      return "<a class='sres' href='" + url + "'>" +
        "<span class='sline'><span class='badge t-" + type + "'>" + type + "</span>" +
        "<span class='st'>" + escHtml(title) + "</span></span>" +
        (doc ? "<span class='sdoc muted'>" + escHtml(doc) + "</span>" : "") +
        "</a>";
    };
    var renderDrop = function (q, pins, ds) {
      if (box.value.trim() !== q) return;  // stale response
      var seen = {}, h = '', n = 0;
      pins.forEach(function (p) {
        seen[resolve(p.u)] = 1;
        h += resLine(resolve(p.u), p.k, p.t, '');
        n++;
      });
      ds.forEach(function (d) {
        var u = resolve(d.url);
        if (seen[u] || n >= 8) return;
        seen[u] = 1;
        h += resLine(u, rtype(d), d.meta.title, d.meta.doc);
        n++;
      });
      if (!n) h = "<div class='sres muted'>No matches</div>";
      h += "<a class='sres sall' href='" + fullUrl(q) + "'>See all results &#8629;</a>";
      drop.innerHTML = h;
      drop.hidden = false;
      items = Array.prototype.slice.call(drop.querySelectorAll('a.sres'));
      idx = -1;
    };
    box.addEventListener('input', function () {
      var q = box.value.trim();
      if (!q) { close(); return; }
      Promise.all([
        engine().then(function (p) { return p.debouncedSearch(q, {}, 220); }),
        loadTitles()
      ]).then(function (rt) {
        var res = rt[0];
        if (!res) return;  // superseded by a newer keystroke
        var pins = titleMatches(q, rt[1]);
        return Promise.all(res.results.slice(0, 8).map(function (r) { return r.data(); }))
          .then(function (ds) { renderDrop(q, pins, ds); });
      }).catch(function () { drop.innerHTML = offlineMsg(); drop.hidden = false; });
    });
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && items.length) {
        e.preventDefault(); highlight(Math.min(idx + 1, items.length - 1));
      } else if (e.key === 'ArrowUp' && items.length) {
        e.preventDefault(); highlight(Math.max(idx - 1, 0));
      } else if (e.key === 'Enter') {
        if (idx >= 0 && items[idx]) location.href = items[idx].href;
        else if (box.value.trim()) location.href = fullUrl(box.value.trim());
      } else if (e.key === 'Escape') { close(); box.blur(); }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.navsearch')) close();
    });
    document.addEventListener('keydown', function (e) {
      var t = e.target;
      var typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); box.focus(); box.select();
      } else if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); box.focus(); box.select();
      }
    });
  }

  // ---- full result list (search.html only) ----
  var sq = document.getElementById('sq');
  if (sq) {
    var out = document.getElementById('sresults');
    var count = document.getElementById('scount');
    var more = document.getElementById('smore');
    var chips = Array.prototype.slice.call(document.querySelectorAll('.sfilters button'));
    var results = [], shown = 0, PAGE = 30, active = 'all', pinned = {};
    var card = function (url, type, title, excerpt, doc) {
      return "<div class='card scard'>" +
        "<div class='sline'><span class='badge t-" + type + "'>" + type + "</span>" +
        "<a href='" + url + "'>" + escHtml(title) + "</a></div>" +
        (excerpt ? "<div class='sx'>" + excerpt + "</div>" : "") +
        (doc ? "<div class='muted'>" + escHtml(doc) + "</div>" : "") +
        "</div>";
    };
    var renderMore = function () {
      var batch = results.slice(shown, shown + PAGE);
      shown += batch.length;
      return Promise.all(batch.map(function (r) { return r.data(); })).then(function (ds) {
        out.insertAdjacentHTML('beforeend', ds.map(function (d) {
          var u = resolve(d.url);
          if (pinned[u]) return '';
          return card(u, rtype(d), d.meta.title, d.excerpt, d.meta.doc);
        }).join(''));
        more.hidden = shown >= results.length;
      });
    };
    var run = function () {
      var q = sq.value.trim();
      var url = new URL(location);
      if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
      history.replaceState(null, '', url);
      if (!q) { out.innerHTML = ''; count.textContent = ''; more.hidden = true; return; }
      var opts = active === 'all' ? {} : { filters: { type: active } };
      Promise.all([
        engine().then(function (p) { return p.debouncedSearch(q, opts, 200); }),
        loadTitles()
      ]).then(function (rt) {
        var res = rt[0];
        if (!res) return;
        results = res.results; shown = 0; out.innerHTML = ''; pinned = {};
        var pins = titleMatches(q, rt[1]).filter(function (p) {
          return active === 'all' || p.k === active;
        });
        pins.forEach(function (p) {
          var u = resolve(p.u);
          pinned[u] = 1;
          out.insertAdjacentHTML('beforeend', card(u, p.k, p.t, '', ''));
        });
        count.textContent = results.length + (results.length === 1 ? ' result' : ' results');
        more.hidden = true;
        return renderMore();
      }).catch(function () { out.innerHTML = offlineMsg(); count.textContent = ''; });
    };
    chips.forEach(function (btn) {
      btn.addEventListener('click', function () {
        active = btn.dataset.type;
        chips.forEach(function (b) { b.classList.toggle('active', b === btn); });
        run();
      });
    });
    more.addEventListener('click', renderMore);
    sq.addEventListener('input', run);
    var q0 = new URLSearchParams(location.search).get('q');
    if (q0) { sq.value = q0; run(); }
    sq.focus();
  }
})();
