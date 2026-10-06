/* Interfaz: estado, formularios, tabla de resultados, gráficos, guardar/cargar. */
(function () {
  'use strict';

  var STORE_KEY = 'medidor-rentabilidad-v1';
  var COLORS = ['#1f6feb', '#e07b00', '#1a9e5f', '#c2399b', '#7a5cd6', '#c0392b', '#0c9aa6', '#8a6d00'];
  var $ = function (id) { return document.getElementById(id); };
  var charts = {};
  var state;

  /* ---------- plantillas y ejemplo ---------- */
  function today() { return new Date().toISOString().slice(0, 10); }
  var uid = 0;
  function newId() { uid++; return 'inv' + Date.now().toString(36) + uid; }

  function template(kind) {
    var base = {
      id: newId(), name: '', cur: 'CLP', startDate: today(), amount: 10000000, term: 12,
      contrib: 0, freq: 1, reinvest: true, dividends: 0, mgmtFee: 0, entryFee: 0,
      dist: 'fixed', params: { rate: 5.5 }
    };
    switch (kind) {
      case 'triangular': base.dist = 'triangular'; base.params = { min: 0, mode: 4, max: 9 }; base.term = 24; break;
      case 'uniform': base.dist = 'uniform'; base.params = { min: 2, max: 8 }; break;
      case 'normal': base.dist = 'normal'; base.params = { mean: 6, sd: 3 }; base.contrib = 200000; base.mgmtFee = 1; base.term = 24; break;
      case 'scenarios': base.dist = 'scenarios';
        base.params = { sc: [{ r: 0, p: 25 }, { r: 5, p: 50 }, { r: 12, p: 25 }] }; base.term = 24; break;
      case 'usd': base.cur = 'USD'; base.amount = 10000; base.params = { rate: 4.8 }; break;
    }
    return base;
  }

  function exampleState() {
    var a = template('fixed'); a.name = 'DAP 12 meses (tasa fija)'; a.term = 12; a.params = { rate: 5.5 };
    var b = template('triangular'); b.name = 'Depósito variable (triangular 0–4–9%)'; b.term = 24;
    var c = template('normal'); c.name = 'Fondo renta fija (normal 6% ± 3%) + aportes'; c.term = 24;
    var d = template('scenarios'); d.name = 'Depósito estructurado (3 escenarios)'; d.term = 24;
    var e = template('usd'); e.name = 'Depósito en USD (4,8%)'; e.term = 24; e.params = { rate: 4.8 };
    return {
      lang: guessLang(), currency: 'CLP', horizon: 24, inflation: 4, benchName: 'Benchmark', benchRate: 6, fx: 950,
      investments: [a, b, c, d, e]
    };
  }

  function guessLang() { return (navigator.language || 'es').toLowerCase().indexOf('en') === 0 ? 'en' : 'es'; }
  function t(k) { return (I18N[state.lang] && I18N[state.lang][k]) || k; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- persistencia ---------- */
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ } }
  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) { var s = JSON.parse(raw); if (valid(s)) return s; }
    } catch (e) { /* ignorar */ }
    return exampleState();
  }
  function valid(s) { return s && Array.isArray(s.investments) && typeof s.horizon === 'number'; }
  function sanitize(s) {
    var d = exampleState();
    ['lang', 'currency', 'horizon', 'inflation', 'benchName', 'benchRate', 'fx'].forEach(function (k) { if (s[k] != null) d[k] = s[k]; });
    d.investments = s.investments.map(function (i) {
      var b = template('fixed'); Object.keys(i).forEach(function (k) { b[k] = i[k]; });
      if (!b.params) b.params = {}; if (!b.id) b.id = newId();
      return b;
    });
    return d;
  }

  /* ---------- textos estáticos ---------- */
  function applyI18n() {
    document.documentElement.lang = state.lang;
    document.title = t('title');
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    var sel = $('tplSelect');
    sel.innerHTML = ['fixed', 'triangular', 'uniform', 'normal', 'scenarios', 'usd'].map(function (k) {
      return '<option value="' + k + '">' + esc(t('tpl_' + k)) + '</option>';
    }).join('');
  }

  function syncGeneral() {
    $('lang').value = state.lang; $('currency').value = state.currency;
    ['horizon', 'inflation', 'benchName', 'benchRate', 'fx'].forEach(function (k) { $(k).value = state[k]; });
  }

  /* ---------- formulario de inversiones ---------- */
  function field(i, key, label, type, extra) {
    var v = i[key];
    return '<label><span>' + esc(t(label)) + '</span><input data-f="' + key + '" type="' + type + '" value="' + esc(v) + '" ' + (extra || '') + '></label>';
  }
  function pfield(i, key, label) {
    return '<label><span>' + esc(t(label)) + '</span><input data-p="' + key + '" type="number" step="any" value="' + esc(i.params[key]) + '"></label>';
  }

  function distFields(i) {
    switch (i.dist) {
      case 'fixed': return pfield(i, 'rate', 'rate');
      case 'uniform': return pfield(i, 'min', 'min') + pfield(i, 'max', 'max');
      case 'normal': return pfield(i, 'mean', 'mean') + pfield(i, 'sd', 'sd');
      case 'triangular': return pfield(i, 'min', 'min') + pfield(i, 'mode', 'mode') + pfield(i, 'max', 'max');
      case 'scenarios':
        return '<div style="grid-column:1/-1">' + (i.params.sc || []).map(function (s, n) {
          return '<div class="sc"><span class="tag">' + esc(t('scenario')) + ' ' + (n + 1) + '</span>'
            + '<label><span>' + esc(t('scRate')) + '</span><input data-s="' + n + '.r" type="number" step="any" value="' + esc(s.r) + '"></label>'
            + '<label><span>' + esc(t('scProb')) + '</span><input data-s="' + n + '.p" type="number" step="any" value="' + esc(s.p) + '"></label></div>';
        }).join('') + '</div>';
    }
    return '';
  }

  function renderInvestments() {
    var list = $('invList');
    list.innerHTML = state.investments.map(function (i) {
      var dists = ['fixed', 'uniform', 'normal', 'triangular', 'scenarios'].map(function (d) {
        return '<option value="' + d + '"' + (i.dist === d ? ' selected' : '') + '>' + esc(t('d_' + d)) + '</option>';
      }).join('');
      return '<article class="inv" data-id="' + esc(i.id) + '">'
        + '<div class="inv-head"><input data-f="name" type="text" value="' + esc(i.name) + '" aria-label="' + esc(t('name')) + '">'
        + '<div class="actions"><button data-act="dup">' + esc(t('duplicate')) + '</button>'
        + '<button class="danger" data-act="del">' + esc(t('remove')) + '</button></div></div>'
        + '<div class="grid">'
        + '<label><span>' + esc(t('cur')) + '</span><select data-f="cur"><option' + (i.cur === 'CLP' ? ' selected' : '') + '>CLP</option><option'
        + (i.cur === 'USD' ? ' selected' : '') + '>USD</option></select></label>'
        + field(i, 'startDate', 'startDate', 'date')
        + field(i, 'amount', 'amount', 'number', 'min="0" step="any"')
        + field(i, 'term', 'term', 'number', 'min="1" step="1"')
        + field(i, 'contrib', 'contrib', 'number', 'min="0" step="any"')
        + field(i, 'freq', 'freq', 'number', 'min="1" step="1"')
        + field(i, 'dividends', 'dividends', 'number', 'min="0" step="any"')
        + field(i, 'mgmtFee', 'mgmtFee', 'number', 'min="0" step="any"')
        + field(i, 'entryFee', 'entryFee', 'number', 'min="0" step="any"')
        + '<label class="check"><input data-f="reinvest" type="checkbox"' + (i.reinvest ? ' checked' : '') + '><span>' + esc(t('reinvest')) + '</span></label>'
        + '</div>'
        + '<div class="dist"><label style="max-width:360px"><span>' + esc(t('dist')) + '</span><select data-f="dist">' + dists + '</select></label>'
        + '<div class="grid" style="margin-top:10px">' + distFields(i) + '</div>'
        + (i.dist === 'fixed' ? '' : '<p class="hint">' + esc(t('hintDist')) + '</p>') + '</div>'
        + '</article>';
    }).join('');
  }

  function findInv(el) {
    var card = el.closest('.inv');
    if (!card) return null;
    var id = card.getAttribute('data-id');
    return state.investments.filter(function (i) { return i.id === id; })[0];
  }

  function onChange(e) {
    var el = e.target, inv = findInv(el);
    if (!inv) return;
    var rerender = false;
    if (el.hasAttribute('data-f')) {
      var k = el.getAttribute('data-f');
      if (el.type === 'checkbox') inv[k] = el.checked;
      else if (el.type === 'number') inv[k] = num(el.value);
      else inv[k] = el.value;
      if (k === 'dist') {
        var d = template('fixed'); var defaults = {
          fixed: { rate: 5.5 }, uniform: { min: 2, max: 8 }, normal: { mean: 6, sd: 3 },
          triangular: { min: 0, mode: 4, max: 9 }, scenarios: { sc: [{ r: 0, p: 25 }, { r: 5, p: 50 }, { r: 12, p: 25 }] }
        };
        inv.params = defaults[inv.dist] || d.params; rerender = true;
      }
    } else if (el.hasAttribute('data-p')) {
      inv.params[el.getAttribute('data-p')] = num(el.value);
    } else if (el.hasAttribute('data-s')) {
      var parts = el.getAttribute('data-s').split('.');
      inv.params.sc[+parts[0]][parts[1]] = num(el.value);
    }
    if (rerender) renderInvestments();
    update();
  }

  function onClick(e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var inv = findInv(b);
    var idx = state.investments.indexOf(inv);
    if (b.getAttribute('data-act') === 'del') state.investments.splice(idx, 1);
    else {
      var c = JSON.parse(JSON.stringify(inv)); c.id = newId(); c.name = inv.name + ' (' + t('copy') + ')';
      state.investments.splice(idx + 1, 0, c);
    }
    renderInvestments(); update();
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  /* ---------- cálculo y resultados ---------- */
  function globals() {
    return { horizon: Math.max(1, Math.round(state.horizon)), inflation: state.inflation, benchRate: state.benchRate,
      currency: state.currency, fx: state.fx > 0 ? state.fx : 1 };
  }

  function money(v) {
    if (!isFinite(v)) return '–';
    var cur = state.currency;
    return new Intl.NumberFormat(state.lang === 'es' ? 'es-CL' : 'en-US', {
      style: 'currency', currency: cur, maximumFractionDigits: cur === 'USD' ? 2 : 0
    }).format(v);
  }
  function pctFmt(v, d) {
    if (!isFinite(v)) return '–';
    return new Intl.NumberFormat(state.lang === 'es' ? 'es-CL' : 'en-US', { minimumFractionDigits: d || 1, maximumFractionDigits: d || 1 }).format(v) + '%';
  }
  function cls(v) { return isFinite(v) ? (v >= 0 ? 'pos' : 'neg') : ''; }

  var results = [];

  function renderTable() {
    var box = $('results');
    if (!results.length) { box.innerHTML = '<p class="hint">' + esc(t('empty')) + '</p>'; return; }
    var best = results.reduce(function (a, b) { return b.realGain > a.realGain ? b : a; });
    var cols = ['c_name', 'c_invested', 'c_final', 'c_range', 'c_gain', 'c_simple', 'c_annual', 'c_realGain', 'c_realAnnual',
      'c_vsBench', 'c_risk', 'c_pLoss', 'c_pInfl'];
    var head = '<tr>' + cols.map(function (c) { return '<th>' + esc(t(c)) + '</th>'; }).join('') + '</tr>';
    var rows = results.map(function (r) {
      var range = r.stochastic ? money(r.final.p10) + ' – ' + money(r.final.p90) : '–';
      var pl = r.stochastic ? pctFmt(r.probLoss * 100, 0) : '–', pi = r.stochastic ? pctFmt(r.probBelowInfl * 100, 0) : (r.realGain < 0 ? '100%' : '0%');
      return '<tr><td>' + esc(r.name) + (r === best ? '<span class="badge">' + esc(t('best')) + '</span>' : '') + '</td>'
        + '<td>' + money(r.invested) + '</td><td>' + money(r.final.p50) + '</td><td>' + range + '</td>'
        + '<td class="' + cls(r.gain) + '">' + money(r.gain) + '</td>'
        + '<td class="' + cls(r.simplePct) + '">' + pctFmt(r.simplePct) + '</td>'
        + '<td class="' + cls(r.annualPct) + '">' + pctFmt(r.annualPct, 2) + '</td>'
        + '<td class="' + cls(r.realGain) + '">' + money(r.realGain) + '</td>'
        + '<td class="' + cls(r.realAnnualPct) + '">' + pctFmt(r.realAnnualPct, 2) + '</td>'
        + '<td class="' + cls(r.vsBench) + '">' + money(r.vsBench) + '</td>'
        + '<td>' + (r.stochastic ? money(r.risk) : '–') + '</td><td>' + pl + '</td><td>' + pi + '</td></tr>';
    }).join('');
    box.innerHTML = '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }

  function chart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    if (typeof Chart === 'undefined') return;
    charts[id] = new Chart($(id), cfg);
  }

  function renderCharts() {
    var H = globals().horizon, labels = [];
    for (var m = 0; m <= H; m++) labels.push(m);
    var style = getComputedStyle(document.body), txt = style.color, grid = 'rgba(128,128,128,.2)';
    var scales = function (xt, yt) {
      return {
        x: { title: { display: true, text: xt, color: txt }, ticks: { color: txt, maxTicksLimit: 12 }, grid: { color: grid } },
        y: { title: { display: true, text: yt, color: txt }, ticks: { color: txt }, grid: { color: grid } }
      };
    };

    var ds = [];
    results.forEach(function (r, n) {
      var c = COLORS[n % COLORS.length];
      ds.push({ label: r.name, data: r.series.p50, borderColor: c, backgroundColor: c, pointRadius: 0, borderWidth: 2, tension: .2 });
      if (r.stochastic) {
        ds.push({ label: '', data: r.series.p10, borderWidth: 0, pointRadius: 0, fill: false });
        ds.push({ label: '', data: r.series.p90, borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: c + '26' });
      }
    });
    chart('chEvolution', {
      type: 'line', data: { labels: labels, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: scales(t('month'), t('value') + ' (' + state.currency + ')'),
        plugins: {
          legend: { labels: { color: txt, filter: function (l) { return l.text !== ''; } } },
          tooltip: { filter: function (it) { return it.dataset.label !== ''; }, callbacks: { label: function (c) { return c.dataset.label + ': ' + money(c.parsed.y); } } }
        }
      }
    });

    chart('chCompare', {
      type: 'bar',
      data: {
        labels: results.map(function (r) { return r.name; }),
        datasets: [
          { label: t('gainNom'), data: results.map(function (r) { return r.gain; }), backgroundColor: '#1f6feb' },
          { label: t('gainReal'), data: results.map(function (r) { return r.realGain; }), backgroundColor: '#1a9e5f' },
          { label: t('gainBench') + ' (' + (state.benchName || 'Benchmark') + ')', data: results.map(function (r) { return r.benchGain; }), backgroundColor: '#9aa7b6' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { color: txt }, grid: { color: grid } }, y: { ticks: { color: txt }, grid: { color: grid } } },
        plugins: { legend: { labels: { color: txt } }, tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + money(c.parsed.y); } } } }
      }
    });

    var pick = $('distPick'), vars = results.filter(function (r) { return r.stochastic; });
    var prev = pick.value;
    pick.innerHTML = vars.map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name) + '</option>'; }).join('');
    if (vars.some(function (r) { return r.id === prev; })) pick.value = prev;
    $('distNote').textContent = vars.length ? '' : t('noVariable');
    var sel = vars.filter(function (r) { return r.id === pick.value; })[0] || vars[0];
    if (!sel) { if (charts.chDist) { charts.chDist.destroy(); delete charts.chDist; } return; }
    chart('chDist', {
      type: 'bar',
      data: { labels: sel.hist.edges.map(function (x) { return money(x); }), datasets: [{ label: t('frequency'), data: sel.hist.counts, backgroundColor: '#7a5cd6' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { ticks: { color: txt, maxTicksLimit: 8 }, grid: { display: false } }, y: { ticks: { color: txt }, grid: { color: grid } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function update() {
    var g = globals();
    results = state.investments.map(function (i) { return Calc.analyze(i, g); });
    renderTable(); renderCharts(); save();
  }

  /* ---------- exportar / importar ---------- */
  function download(name, text, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function status(msg, bad) { var s = $('status'); s.textContent = msg; s.style.color = bad ? 'var(--bad)' : 'var(--good)'; }

  function exportCsv() {
    var cols = ['c_name', 'c_invested', 'c_final', 'c_gain', 'c_simple', 'c_annual', 'c_realGain', 'c_realAnnual', 'c_vsBench', 'c_risk', 'c_pLoss', 'c_pInfl'];
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    var lines = [cols.map(function (c) { return q(t(c)); }).join(',')];
    results.forEach(function (r) {
      lines.push([q(r.name), r.invested.toFixed(2), r.final.p50.toFixed(2), r.gain.toFixed(2), r.simplePct.toFixed(2),
        r.annualPct.toFixed(2), r.realGain.toFixed(2), r.realAnnualPct.toFixed(2), r.vsBench.toFixed(2), r.risk.toFixed(2),
        (r.probLoss * 100).toFixed(1), (r.probBelowInfl * 100).toFixed(1)].join(','));
    });
    download('resultados.csv', '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  function fullRender() {
    applyI18n(); syncGeneral(); renderInvestments(); update();
  }

  function init() {
    state = load();
    fullRender();

    $('lang').addEventListener('change', function () { state.lang = this.value; fullRender(); });
    $('currency').addEventListener('change', function () { state.currency = this.value; update(); });
    ['horizon', 'inflation', 'benchRate', 'fx'].forEach(function (k) {
      $(k).addEventListener('change', function () { state[k] = num(this.value); update(); });
    });
    $('benchName').addEventListener('change', function () { state.benchName = this.value; update(); });
    $('distPick').addEventListener('change', renderCharts);

    $('invList').addEventListener('change', onChange);
    $('invList').addEventListener('click', onClick);
    $('btnAdd').addEventListener('click', function () {
      var inv = template($('tplSelect').value); inv.name = t('tpl_' + $('tplSelect').value);
      state.investments.push(inv); renderInvestments(); update();
    });

    $('btnSave').addEventListener('click', function () { download('inversiones.json', JSON.stringify(state, null, 2), 'application/json'); });
    $('btnLoad').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function () {
      var f = this.files[0], input = this;
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var s = JSON.parse(rd.result);
          if (!valid(s)) throw new Error('bad');
          state = sanitize(s); fullRender(); status(t('imported'));
        } catch (err) { status(t('badFile'), true); }
        input.value = '';
      };
      rd.readAsText(f);
    });
    $('btnCsv').addEventListener('click', exportCsv);
    $('btnReset').addEventListener('click', function () {
      if (confirm(t('confirmReset'))) { var l = state.lang; state = exampleState(); state.lang = l; fullRender(); }
    });
    $('btnClear').addEventListener('click', function () {
      if (confirm(t('confirmClear'))) { state.investments = []; fullRender(); }
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
