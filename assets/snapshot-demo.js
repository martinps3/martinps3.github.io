/* Snapshot inflation demo: drag months, watch the reported number diverge
   from the real one. Deterministic synthetic claims - no external data. */
(function () {
  "use strict";

  /* Fixed synthetic book of claims. Each: opens in month o, resolves in month c
     (c = 13 means still open at month 12), with an amount. */
  var CLAIMS = (function () {
    var seed = 20260916;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
    var out = [];
    for (var i = 0; i < 40; i++) {
      var o = 1 + Math.floor(rnd() * 9);
      var life = 1 + Math.floor(rnd() * 6);
      var c = Math.min(o + life, 13);
      out.push({ id: "C-" + (1001 + i), open: o, close: c, amount: Math.round((400 + rnd() * 5200) / 50) * 50 });
    }
    return out;
  })();

  var MAXM = 12;
  var slider, els = {}, chart;

  function compute(n) {
    var rows = 0, naiveSum = 0, distinct = 0, realSum = 0;
    CLAIMS.forEach(function (cl) {
      if (cl.open > n) return;
      distinct++;
      realSum += cl.amount;
      var last = Math.min(cl.close, n);
      var appearances = last - cl.open + 1;
      if (appearances < 1) appearances = 1;
      rows += appearances;
      naiveSum += appearances * cl.amount;
    });
    return { rows: rows, naiveSum: naiveSum, distinct: distinct, realSum: realSum };
  }

  function fmt(n) { return n.toLocaleString("en-US"); }
  function money(n) { return "$" + n.toLocaleString("en-US"); }

  function drawChart(d) {
    var w = 560, h = 132, pad = 96, barH = 26;
    var max = Math.max(d.rows, d.distinct, 1);
    var scale = function (v) { return Math.max(2, (v / max) * (w - pad - 90)); };

    var s = [];
    s.push('<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h +
           '" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif">');

    s.push('<text x="0" y="24" font-size="12" fill="#a4453a" font-weight="620">Reported</text>');
    s.push('<rect x="' + pad + '" y="8" width="' + scale(d.rows) + '" height="' + barH +
           '" rx="4" fill="#e0b9b0"/>');
    s.push('<text x="' + (pad + scale(d.rows) + 10) + '" y="26" font-size="13" font-weight="650" fill="#a4453a">' +
           fmt(d.rows) + '</text>');

    s.push('<text x="0" y="70" font-size="12" fill="#2f6b46" font-weight="620">Actual</text>');
    s.push('<rect x="' + pad + '" y="54" width="' + scale(d.distinct) + '" height="' + barH +
           '" rx="4" fill="#a8c9b5"/>');
    s.push('<text x="' + (pad + scale(d.distinct) + 10) + '" y="72" font-size="13" font-weight="650" fill="#2f6b46">' +
           fmt(d.distinct) + '</text>');

    var factor = d.distinct ? (d.rows / d.distinct) : 1;
    s.push('<line x1="' + pad + '" y1="96" x2="' + (w - 20) + '" y2="96" stroke="#e3e7ec"/>');
    s.push('<text x="0" y="120" font-size="12" fill="#5b646e">Inflation</text>');
    s.push('<text x="' + pad + '" y="120" font-size="13" font-weight="650" fill="' +
           (factor > 1.05 ? "#a4453a" : "#5b646e") + '">' + factor.toFixed(2) + '\u00d7</text>');
    s.push('<text x="' + (pad + 54) + '" y="120" font-size="12" fill="#8b949e">' +
           (factor > 1.05 ? "every count and every total is wrong by this much"
                          : "one snapshot only \u2014 nothing stacked yet") + '</text>');

    s.push("</svg>");
    chart.innerHTML = s.join("");
  }

  function update() {
    var n = parseInt(slider.value, 10);
    var d = compute(n);

    els.months.textContent = n + (n === 1 ? " month" : " months");
    els.rows.textContent = fmt(d.rows);
    els.distinct.textContent = fmt(d.distinct);
    els.naiveSum.textContent = money(d.naiveSum);
    els.realSum.textContent = money(d.realSum);

    drawChart(d);
  }

  document.addEventListener("DOMContentLoaded", function () {
    slider = document.getElementById("sn-slider");
    if (!slider) return;
    ["months", "rows", "distinct", "naiveSum", "realSum"].forEach(function (k) {
      els[k] = document.getElementById("sn-" + k);
    });
    chart = document.getElementById("sn-chart");

    slider.min = 1; slider.max = MAXM; slider.value = 1;
    slider.addEventListener("input", update);
    update();
  });
})();
