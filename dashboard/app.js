// Token Radar radar-3 — dashboard logic. Data comes from ../data.js (window.RADAR).
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) {
    document.getElementById('meta-line').textContent = 'data failed to load';
    return;
  }

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function fmtFull(n) {
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
  }
  function fmtShort(n) {
    var a = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + Math.round(a);
  }
  function fmtPct(v, digits) {
    var sign = v > 0 ? '+' : '';
    return sign + v.toFixed(digits === undefined ? 1 : digits) + '%';
  }

  var state = {
    view: 'board',
    q: '',
    cat: 'All',
    wlOnly: false,
    sortKey: 'rank',
    sortDir: 1,
    curveCat: 'Global',
    selectedSlug: null,
  };

  // ---- meta line + KPIs ----
  var meta = D.meta, k = D.kpis;
  $('#meta-line').textContent =
    'snapshot ' + meta.asOf + ' · source DefiLlama · ' + meta.protocols +
    ' protocols · control group ' + meta.controlN + ' launched (mcap ≥ $1M) · ' +
    meta.categoriesFitted + ' category curves · floor ' + fmtShort(meta.floorUsd) + ' TVL';
  $('#model-tag').textContent = meta.model + ' · ' + meta.asOf;

  function kpi(label, valueHtml, sub) {
    var box = el('div', 'kpi');
    box.appendChild(el('div', 'k-label', label));
    var v = el('div', 'k-value');
    v.innerHTML = valueHtml;
    box.appendChild(v);
    if (sub) box.appendChild(el('div', 'k-sub', sub));
    return box;
  }
  var kpis = $('#kpis');
  kpis.appendChild(kpi('Median fitted multiple', k.medianMultiple.toFixed(4) + '<span class="unit">x</span>', 'across the 200-row board'));
  kpis.appendChild(kpi('Out-of-sample median APE', '<span class="warn">' + k.oosMedianApePct.toFixed(1) + '%</span>', '5-fold, n=' + D.validation.overall.n + ' launched'));
  kpis.appendChild(kpi('Within ±25% of actual', '<span class="good">' + k.oosWithin25Pct.toFixed(1) + '%</span>', 'of holdout predictions'));
  kpis.appendChild(kpi('Watchlist coverage', k.watchlistCovered + '<span class="unit"> / ' + k.watchlistTotal + '</span>', 'all watchlist protocols on the board'));
  kpis.appendChild(kpi('#1 implied value', fmtShort(k.topImpliedUsd), k.topName));
  // extra KPI row context is folded into the validation view; keep the strip at five.

  // ---- view switching ----
  function showView(name) {
    state.view = name;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.view === name);
    });
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.id === 'view-' + name);
    });
    if (name === 'curve') renderCurve();
    if (name === 'validation') renderValidation();
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      location.hash = b.dataset.view;
      showView(b.dataset.view);
    });
  });
  window.addEventListener('hashchange', function () {
    var h = location.hash.replace('#', '');
    if (h === 'board' || h === 'curve' || h === 'validation') showView(h);
  });

  // ---- board ----
  var catFilter = $('#cat-filter');
  var cats = ['All'].concat(Array.from(new Set(D.rows.map(function (r) { return r.category; })) ).sort());
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c;
    o.textContent = c === 'All' ? 'All categories' : c;
    catFilter.appendChild(o);
  });

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.wlOnly && !r.watchlist) return false;
      if (state.cat !== 'All' && r.category !== state.cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sortKey, dir = state.sortDir;
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      var cmp;
      if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
      else if (typeof av === 'boolean') cmp = (av === bv) ? 0 : (av ? -1 : 1);
      else cmp = String(av).localeCompare(String(bv));
      return cmp * dir;
    });
    return rows;
  }

  function renderBoard() {
    var rows = filteredRows();
    var body = $('#board-body');
    body.innerHTML = '';
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.slug === state.selectedSlug) tr.classList.add('selected');
      tr.dataset.slug = r.slug;
      var cells = [
        { t: String(r.rank), cls: '' },
        { t: null, cls: '' },
        { t: r.category, cls: '' },
        { t: r.chain, cls: '' },
        { t: fmtShort(r.tvl_usd), cls: 'num' },
        { t: fmtShort(r.implied_value_usd), cls: 'num' },
        { t: r.multiple.toFixed(4) + 'x', cls: 'num' },
        { t: fmtPct(r.change_7d), cls: 'num' },
        { t: r.age_days + 'd', cls: 'num' },
        { t: r.watchlist ? '★' : '', cls: '' },
      ];
      cells.forEach(function (c, i) {
        var td = document.createElement('td');
        if (c.cls) td.className = c.cls;
        if (i === 1) {
          var nm = el('div', 'name', r.name);
          var sl = el('div', 'slug', r.slug);
          td.appendChild(nm);
          td.appendChild(sl);
        } else if (i === 7) {
          var sp = el('span', r.change_7d >= 0 ? 'pos' : 'neg', c.t);
          td.appendChild(sp);
        } else if (i === 9) {
          if (c.t) td.appendChild(el('span', 'wl', c.t));
        } else {
          td.textContent = c.t;
        }
        tr.appendChild(td);
      });
      tr.addEventListener('click', function () { openDrawer(r.slug); });
      body.appendChild(tr);
    });
    $('#board-count').textContent = rows.length + ' of ' + D.rows.length + ' rows';
  }

  document.querySelectorAll('#board-table th').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.dataset.key;
      if (state.sortKey === key) state.sortDir = -state.sortDir;
      else { state.sortKey = key; state.sortDir = key === 'rank' ? 1 : -1; }
      renderBoard();
    });
  });
  $('#q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catFilter.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('#wl-only').addEventListener('change', function (e) { state.wlOnly = e.target.checked; renderBoard(); });

  // ---- curve view ----
  var curveSelect = $('#curve-select');
  D.fits.forEach(function (f) {
    var o = document.createElement('option');
    o.value = f.curve;
    o.textContent = f.curve + ' (n=' + f.n + ', R²=' + f.r2.toFixed(2) + ')';
    curveSelect.appendChild(o);
  });
  curveSelect.addEventListener('change', function (e) {
    state.curveCat = e.target.value;
    renderCurve();
  });

  function renderCurve() {
    var svg = $('#curve-svg');
    var fit = D.fits.find(function (f) { return f.curve === state.curveCat; }) || D.fits[0];
    var W = 760, H = 430, ML = 58, MR = 16, MT = 14, MB = 42;
    var xs = D.points.map(function (p) { return p.x; });
    var ys = D.points.map(function (p) { return p.y; });
    var x0 = Math.floor(Math.min.apply(null, xs) - 0.2), x1 = Math.ceil(Math.max.apply(null, xs) + 0.2);
    var y0 = Math.floor(Math.min.apply(null, ys) - 0.2), y1 = Math.ceil(Math.max.apply(null, ys) + 0.2);
    var X = function (x) { return ML + ((x - x0) / (x1 - x0)) * (W - ML - MR); };
    var Y = function (y) { return H - MB - ((y - y0) / (y1 - y0)) * (H - MT - MB); };
    var s = '';
    s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="#0a0e0a"/>';
    for (var gx = Math.ceil(x0); gx <= x1; gx++) {
      s += '<line x1="' + X(gx) + '" y1="' + MT + '" x2="' + X(gx) + '" y2="' + (H - MB) + '" stroke="#1c261a" stroke-width="1"/>';
      var anchor = gx === x1 ? 'end' : 'middle';
      s += '<text x="' + X(gx) + '" y="' + (H - MB + 18) + '" fill="#7d9078" font-size="11" text-anchor="' + anchor + '">' + fmtShort(Math.pow(10, gx)) + '</text>';
    }
    for (var gy = Math.ceil(y0); gy <= y1; gy++) {
      s += '<line x1="' + ML + '" y1="' + Y(gy) + '" x2="' + (W - MR) + '" y2="' + Y(gy) + '" stroke="#1c261a" stroke-width="1"/>';
      s += '<text x="' + (ML - 8) + '" y="' + (Y(gy) + 4) + '" fill="#7d9078" font-size="11" text-anchor="end">' + fmtShort(Math.pow(10, gy)) + '</text>';
    }
    s += '<text x="' + (ML + (W - ML - MR) / 2) + '" y="' + (H - 6) + '" fill="#7d9078" font-size="12" text-anchor="middle">TVL (log10)</text>';
    s += '<text x="14" y="' + (MT + (H - MT - MB) / 2) + '" fill="#7d9078" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + (MT + (H - MT - MB) / 2) + ')">Market cap (log10)</text>';
    // diagonal y = x (multiple 1.0x)
    var d0 = Math.max(x0, y0), d1 = Math.min(x1, y1);
    s += '<line x1="' + X(d0) + '" y1="' + Y(d0) + '" x2="' + X(d1) + '" y2="' + Y(d1) + '" stroke="#2a3a28" stroke-width="1" stroke-dasharray="4 4"/>';
    s += '<text x="' + (X(d1) - 4) + '" y="' + (Y(d1) - 6) + '" fill="#5a6b58" font-size="11" text-anchor="end">1.0x</text>';
    // scatter points
    D.points.forEach(function (p) {
      var on = state.curveCat === 'Global' || p.category === state.curveCat;
      s += '<circle cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="' + (on ? 3 : 2) + '" fill="' + (on ? '#39d98a' : '#54624f') + '" opacity="' + (on ? 0.9 : 0.45) + '"><title>' + p.name + ' — TVL ' + fmtShort(Math.pow(10, p.x)) + ', mcap ' + fmtShort(Math.pow(10, p.y)) + '</title></circle>';
    });
    // fitted curve across the fit's own x-range
    var lo = Math.max(fit.xMin, x0), hi = Math.min(fit.xMax, x1);
    var pts = [];
    for (var i = 0; i <= 60; i++) {
      var xv = lo + ((hi - lo) * i) / 60;
      var yv = fit.a + fit.b * xv + fit.c * xv * xv;
      pts.push(X(xv).toFixed(1) + ',' + Y(yv).toFixed(1));
    }
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#ffb000" stroke-width="2"/>';
    svg.innerHTML = s;
    $('#curve-note').textContent =
      fit.curve + ': log10(mcap) = ' + fit.a.toFixed(3) + ' + ' + fit.b.toFixed(3) + 'x + ' + fit.c.toFixed(3) + 'x² · n=' + fit.n + ' · R²=' + fit.r2.toFixed(4);
  }

  // ---- validation view ----
  function renderValidation() {
    $('#validation-method').textContent = D.validation.method;
    var fb = $('#fold-body');
    fb.innerHTML = '';
    D.validation.folds.forEach(function (f) {
      var tr = document.createElement('tr');
      [String(f.fold), String(f.n), f.medianApePct.toFixed(2) + '%', f.within25Pct.toFixed(2) + '%'].forEach(function (t, i) {
        var td = document.createElement('td');
        if (i > 0) td.className = 'num';
        td.textContent = t;
        tr.appendChild(td);
      });
      fb.appendChild(tr);
    });
    var tr = document.createElement('tr');
    ['Overall', String(D.validation.overall.n), D.validation.overall.medianApePct.toFixed(2) + '%', D.validation.overall.within25Pct.toFixed(2) + '%'].forEach(function (t, i) {
      var td = document.createElement('td');
      if (i > 0) td.className = 'num';
      td.style.fontWeight = 'bold';
      td.textContent = t;
      tr.appendChild(td);
    });
    fb.appendChild(tr);
    var fitb = $('#fit-body');
    fitb.innerHTML = '';
    D.fits.forEach(function (f) {
      var tr2 = document.createElement('tr');
      [f.curve, String(f.n), f.r2.toFixed(4), f.a.toFixed(3), f.b.toFixed(3), f.c.toFixed(3)].forEach(function (t, i) {
        var td = document.createElement('td');
        if (i > 0) td.className = 'num';
        td.textContent = t;
        tr2.appendChild(td);
      });
      fitb.appendChild(tr2);
    });
  }

  // ---- detail drawer ----
  function rowBySlug(slug) {
    return D.rows.find(function (r) { return r.slug === slug; });
  }
  function openDrawer(slug) {
    var r = rowBySlug(slug);
    if (!r) return;
    state.selectedSlug = slug;
    var body = $('#drawer-body');
    body.innerHTML = '';
    body.appendChild(el('h2', '', '#' + r.rank + ' ' + r.name));
    function drow(label, value, cls) {
      var d = el('div', 'd-row');
      d.appendChild(el('span', '', label));
      var v = el('span', cls || '', value);
      d.appendChild(v);
      body.appendChild(d);
    }
    drow('Slug', r.slug);
    drow('Category', r.category);
    drow('Chain', r.chain);
    drow('TVL', fmtFull(r.tvl_usd));
    drow('Implied value', fmtFull(r.implied_value_usd));
    drow('Fitted multiple', r.multiple.toFixed(4) + 'x');
    if (r.mcap_usd != null && r.tvl_usd > 0) {
      drow('Actual multiple', (r.mcap_usd / r.tvl_usd).toFixed(4) + 'x');
      drow('Actual mcap', fmtFull(r.mcap_usd));
    } else {
      drow('Actual multiple', 'unlaunched');
    }
    drow('7d change', fmtPct(r.change_7d));
    drow('Age', r.age_days + ' days');
    drow('Watchlist', r.watchlist ? 'yes' : 'no');
    drow('Curve used', r.fit_curve + ' (' + r.fit_source + ')');
    body.appendChild(el('h2', '', 'Farm plan — 6 steps, netted'));
    var ol = document.createElement('ol');
    r.farm_steps.forEach(function (step, i) {
      var li = document.createElement('li');
      li.textContent = step;
      if (i === 5) li.classList.add('verdict');
      ol.appendChild(li);
    });
    body.appendChild(ol);
    $('#drawer').classList.add('open');
    renderBoard();
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    state.selectedSlug = null;
    renderBoard();
  }
  $('#drawer-close').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  // ---- init ----
  var h = location.hash.replace('#', '');
  if (h === 'curve' || h === 'validation') showView(h);
  else showView('board');
  renderBoard();
})();
