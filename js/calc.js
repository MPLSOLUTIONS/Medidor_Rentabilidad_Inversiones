/* Motor de cálculo: simulación mensual, Monte Carlo para rentabilidades variables,
   TIR anualizada, comparación con inflación y benchmark. Sin dependencias. */
(function (root) {
  'use strict';

  var N_SIM = 1500;

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function randn(r) {
    var u = 0;
    while (!u) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  }

  /* Devuelve una función que muestrea una tasa anual (%) según la distribución. */
  function sampler(inv, r) {
    var p = inv.params || {};
    switch (inv.dist) {
      case 'uniform':
        return function () { return p.min + (p.max - p.min) * r(); };
      case 'normal':
        return function () { return p.mean + p.sd * randn(r); };
      case 'triangular':
        return function () {
          var a = p.min, b = p.max, c = Math.min(Math.max(p.mode, a), b), u = r();
          if (b === a) return a;
          var F = (c - a) / (b - a);
          return u < F ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
        };
      case 'scenarios':
        return function () {
          var sc = p.sc || [], tot = 0, i;
          for (i = 0; i < sc.length; i++) tot += Math.max(0, sc[i].p);
          if (!tot) return 0;
          var u = r() * tot, acc = 0;
          for (i = 0; i < sc.length; i++) { acc += Math.max(0, sc[i].p); if (u <= acc) return sc[i].r; }
          return sc[sc.length - 1].r;
        };
      default:
        return function () { return p.rate; };
    }
  }

  function meanRate(inv) {
    var p = inv.params || {};
    switch (inv.dist) {
      case 'uniform': return (p.min + p.max) / 2;
      case 'normal': return p.mean;
      case 'triangular': return (p.min + p.mode + p.max) / 3;
      case 'scenarios':
        var tot = 0, s = 0;
        (p.sc || []).forEach(function (x) { tot += Math.max(0, x.p); s += Math.max(0, x.p) * x.r; });
        return tot ? s / tot : 0;
      default: return p.rate;
    }
  }

  /* Flujos aportados por el inversionista (índice = mes). */
  function flows(inv, H) {
    var term = Math.min(inv.term, H), f = new Array(H + 1).fill(0), freq = Math.max(1, inv.freq || 1);
    f[0] = inv.amount;
    for (var m = 1; m <= H; m++) if (m < term && inv.contrib > 0 && m % freq === 0) f[m] = inv.contrib;
    return f;
  }

  /* Trayectoria mensual del valor total (capital + efectivo pagado) de una inversión. */
  function path(inv, H, f, rateFor) {
    var term = Math.min(inv.term, H), v = new Array(H + 1);
    var entry = 1 - (inv.entryFee || 0) / 100;
    var bal = inv.amount * entry, cash = 0;
    v[0] = bal;
    for (var m = 1; m <= H; m++) {
      if (m <= term) {
        var ar = Math.max(-99, rateFor(Math.floor((m - 1) / 12))) / 100;
        var it = bal * (Math.pow(1 + ar, 1 / 12) - 1);
        if (inv.reinvest) bal += it; else cash += it;
        cash += bal * (inv.dividends || 0) / 100 / 12;
        bal -= bal * (inv.mgmtFee || 0) / 100 / 12;
        if (f[m] > 0) bal += f[m] * entry;
      }
      v[m] = bal + cash;
    }
    return v;
  }

  /* Referencia: mismos aportes, tasa fija sin comisiones, creciendo hasta el horizonte. */
  function refPath(f, H, annualPct) {
    var mr = Math.pow(1 + annualPct / 100, 1 / 12) - 1, bal = f[0], v = [bal];
    for (var m = 1; m <= H; m++) { bal = bal * (1 + mr) + f[m]; v.push(bal); }
    return v;
  }

  /* TIR mensual por bisección → anualizada (%). */
  function annualized(f, finalValue, H) {
    var invested = f.reduce(function (a, b) { return a + b; }, 0);
    if (!(invested > 0)) return NaN;
    function npv(r) {
      var s = 0;
      for (var m = 0; m <= H; m++) if (f[m]) s -= f[m] / Math.pow(1 + r, m);
      return s + finalValue / Math.pow(1 + r, H);
    }
    var lo = -0.99, hi = 1;
    if (npv(lo) < 0) return -100;
    for (var i = 0; i < 200; i++) {
      var mid = (lo + hi) / 2;
      if (npv(mid) > 0) lo = mid; else hi = mid;
    }
    return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
  }

  function pct(sorted, p) {
    var i = (sorted.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  }

  function fxFactor(from, to, fx) {
    if (from === to) return 1;
    return from === 'USD' ? fx : 1 / fx; // fx = CLP por USD
  }

  /* g: {horizon, inflation, benchRate, currency, fx} — inv: ver app.js */
  function analyze(inv, g) {
    var H = Math.max(1, Math.round(g.horizon));
    var k = fxFactor(inv.cur, g.currency, g.fx);
    var f = flows(inv, H);
    var invested = f.reduce(function (a, b) { return a + b; }, 0);
    var stochastic = inv.dist !== 'fixed';
    var n = stochastic ? N_SIM : 1;
    var r = mulberry32(hash(String(inv.id || inv.name)));
    var draw = sampler(inv, r);
    var years = Math.ceil(Math.min(inv.term, H) / 12) || 1;
    var paths = [];
    for (var i = 0; i < n; i++) {
      var rates = [];
      for (var y = 0; y < years; y++) rates.push(draw());
      paths.push(path(inv, H, f, function (yy) { return rates[yy]; }));
    }
    var p10 = [], p50 = [], p90 = [];
    for (var m = 0; m <= H; m++) {
      var col = paths.map(function (p) { return p[m]; }).sort(function (a, b) { return a - b; });
      p10.push(pct(col, 0.1) * k); p50.push(pct(col, 0.5) * k); p90.push(pct(col, 0.9) * k);
    }
    var finals = paths.map(function (p) { return p[H]; }).sort(function (a, b) { return a - b; });
    var mean = finals.reduce(function (a, b) { return a + b; }, 0) / n;
    var sd = Math.sqrt(finals.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / n);
    var med = pct(finals, 0.5);

    var bench = refPath(f, H, g.benchRate);
    var infl = refPath(f, H, g.inflation);
    var benchFinal = bench[H], inflFinal = infl[H];
    var ann = annualized(f, med, H);

    var lo = finals[0], hi = finals[n - 1], bins = 20, hist = new Array(bins).fill(0), edges = [];
    var w = (hi - lo) / bins || 1;
    finals.forEach(function (x) { hist[Math.min(bins - 1, Math.floor((x - lo) / w))]++; });
    for (var b = 0; b < bins; b++) edges.push((lo + w * (b + 0.5)) * k);

    return {
      id: inv.id, name: inv.name, cur: inv.cur, stochastic: stochastic, months: H,
      meanRate: meanRate(inv),
      invested: invested * k,
      final: { p10: pct(finals, 0.1) * k, p50: med * k, p90: pct(finals, 0.9) * k, mean: mean * k },
      gain: (med - invested) * k,
      simplePct: invested > 0 ? (med - invested) / invested * 100 : NaN,
      annualPct: ann,
      realGain: (med - inflFinal) * k,
      realAnnualPct: ((1 + ann / 100) / (1 + g.inflation / 100) - 1) * 100,
      benchGain: (benchFinal - invested) * k,
      vsBench: (med - benchFinal) * k,
      risk: sd * k,
      probLoss: finals.filter(function (x) { return x < invested; }).length / n,
      probBelowInfl: finals.filter(function (x) { return x < inflFinal; }).length / n,
      probBeatBench: finals.filter(function (x) { return x > benchFinal; }).length / n,
      series: { p10: p10, p50: p50, p90: p90, bench: bench.map(function (x) { return x * k; }) },
      hist: { edges: edges, counts: hist }
    };
  }

  root.Calc = { analyze: analyze, meanRate: meanRate, flows: flows, annualized: annualized, N_SIM: N_SIM };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.Calc;
})(typeof window !== 'undefined' ? window : globalThis);
