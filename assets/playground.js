/* sqldoc playground: live parse + lineage graph. Needs sqldoc.js first. */
(function () {
  "use strict";

  var EXAMPLES = {
    "Revenue by category": [
      "-- Monthly revenue by product category and region.",
      "WITH monthly_orders AS (",
      "    SELECT",
      "        o.order_id,",
      "        o.customer_id,",
      "        DATE_TRUNC('month', o.order_date) AS order_month",
      "    FROM sales.orders o",
      "    WHERE o.status <> 'cancelled'",
      "      AND o.order_date >= :start_date",
      "),",
      "order_revenue AS (",
      "    SELECT",
      "        oi.order_id,",
      "        oi.product_id,",
      "        SUM(oi.quantity * oi.unit_price) AS gross_revenue",
      "    FROM sales.order_items oi",
      "    GROUP BY oi.order_id, oi.product_id",
      ")",
      "SELECT",
      "    mo.order_month,",
      "    p.category_name AS category,",
      "    c.region,",
      "    COUNT(DISTINCT mo.order_id) AS order_count,",
      "    SUM(orv.gross_revenue) AS gross_revenue,",
      "    CASE",
      "        WHEN SUM(orv.gross_revenue) > 100000 THEN 'High'",
      "        ELSE 'Low'",
      "    END AS revenue_band",
      "FROM monthly_orders mo",
      "INNER JOIN order_revenue orv ON orv.order_id = mo.order_id",
      "INNER JOIN sales.customers c ON c.customer_id = mo.customer_id",
      "LEFT JOIN sales.products p ON p.product_id = orv.product_id",
      "WHERE c.region IS NOT NULL",
      "GROUP BY mo.order_month, p.category_name, c.region"
    ].join("\n"),

    "Carrier scorecard": [
      "SELECT",
      "    car.carrier_name,",
      "    COUNT(s.shipment_id)                       AS shipments,",
      "    SUM(s.delivered_on_time)                   AS on_time,",
      "    ROUND(AVG(s.transit_days), 1)              AS avg_transit_days,",
      "    SUM(s.net_charge)                          AS total_spend",
      "FROM logistics.shipments s",
      "INNER JOIN logistics.carriers car ON car.carrier_id = s.carrier_id",
      "LEFT JOIN logistics.lanes ln ON ln.lane_id = s.lane_id",
      "WHERE s.ship_date >= '2026-01-01'",
      "  AND s.status = 'DELIVERED'",
      "GROUP BY car.carrier_name",
      "ORDER BY total_spend DESC"
    ].join("\n"),

    "Simple lookup": [
      "SELECT DISTINCT",
      "    c.customer_id,",
      "    c.full_name AS customer_name,",
      "    UPPER(c.region) AS region",
      "FROM crm.customers c",
      "WHERE c.active = 1",
      "  AND c.region IS NOT NULL",
      "ORDER BY c.full_name"
    ].join("\n")
  };

  var input, outEl, graphEl, chipsEl, timer;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function splitSource(src) {
    var i = src.lastIndexOf(".");
    if (i < 0) return { table: "(direct)", column: src };
    return { table: src.slice(0, i), column: src.slice(i + 1) };
  }

  /* ---------- lineage graph ---------- */
  function drawGraph(doc) {
    if (!doc.final || !doc.final.output_columns.length) { graphEl.innerHTML = ""; return; }

    var cols = doc.final.output_columns.slice(0, 12);
    var tables = [];
    cols.forEach(function (c) {
      c.sources.forEach(function (s) {
        var t = splitSource(s).table;
        if (tables.indexOf(t) === -1) tables.push(t);
      });
    });
    if (!tables.length) { graphEl.innerHTML = ""; return; }

    var rowH = 30, padTop = 34, boxW = 168, colW = 176;
    var leftH = tables.length * rowH, rightH = cols.length * rowH;
    var height = Math.max(leftH, rightH) + padTop + 18;
    var width = 640;
    var leftX = 8, rightX = width - colW - 8;

    function leftY(i) { return padTop + i * rowH + (Math.max(rightH - leftH, 0) / 2); }
    function rightY(i) { return padTop + i * rowH + (Math.max(leftH - rightH, 0) / 2); }

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height +
             '" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Inter, sans-serif">');

    svg.push('<text x="' + leftX + '" y="16" font-size="11" font-weight="650" fill="#8b949e" letter-spacing="0.5">SOURCE TABLES</text>');
    svg.push('<text x="' + rightX + '" y="16" font-size="11" font-weight="650" fill="#8b949e" letter-spacing="0.5">OUTPUT COLUMNS</text>');

    // edges first so boxes sit on top
    cols.forEach(function (c, ci) {
      c.sources.forEach(function (s) {
        var t = splitSource(s).table;
        var ti = tables.indexOf(t);
        if (ti < 0) return;
        var y1 = leftY(ti) + 11, y2 = rightY(ci) + 11;
        var x1 = leftX + boxW, x2 = rightX;
        var mx = (x1 + x2) / 2;
        svg.push('<path class="lin-edge" data-col="' + ci + '" d="M' + x1 + ',' + y1 +
                 ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2 +
                 '" fill="none" stroke="#c3cedd" stroke-width="1.3"/>');
      });
    });

    tables.forEach(function (t, i) {
      var y = leftY(i);
      svg.push('<rect x="' + leftX + '" y="' + y + '" width="' + boxW + '" height="22" rx="4" ' +
               'fill="#eef2f8" stroke="#c9d3e0"/>');
      svg.push('<text x="' + (leftX + 9) + '" y="' + (y + 15) + '" font-size="11" ' +
               'font-family="ui-monospace, Consolas, monospace" fill="#1F3864">' +
               esc(t.length > 24 ? t.slice(0, 23) + "\u2026" : t) + '</text>');
    });

    cols.forEach(function (c, i) {
      var y = rightY(i);
      var fill = c.note ? "#f7f9fc" : "#ffffff";
      svg.push('<rect class="lin-node" data-col="' + i + '" x="' + rightX + '" y="' + y +
               '" width="' + boxW + '" height="22" rx="4" fill="' + fill + '" stroke="#c9d3e0"/>');
      svg.push('<text x="' + (rightX + 9) + '" y="' + (y + 15) + '" font-size="11" ' +
               'font-family="ui-monospace, Consolas, monospace" fill="#16191d" pointer-events="none">' +
               esc(c.name.length > 22 ? c.name.slice(0, 21) + "\u2026" : c.name) + '</text>');
    });

    if (doc.final.output_columns.length > cols.length) {
      svg.push('<text x="' + rightX + '" y="' + (height - 4) + '" font-size="10.5" fill="#8b949e">+ ' +
               (doc.final.output_columns.length - cols.length) + ' more</text>');
    }

    svg.push("</svg>");
    graphEl.innerHTML = svg.join("");

    // hover highlight
    Array.prototype.forEach.call(graphEl.querySelectorAll(".lin-node"), function (node) {
      node.addEventListener("mouseenter", function () {
        var id = node.getAttribute("data-col");
        Array.prototype.forEach.call(graphEl.querySelectorAll(".lin-edge"), function (e) {
          var on = e.getAttribute("data-col") === id;
          e.setAttribute("stroke", on ? "#1F3864" : "#e6ebf2");
          e.setAttribute("stroke-width", on ? "2" : "1.1");
        });
      });
      node.addEventListener("mouseleave", function () {
        Array.prototype.forEach.call(graphEl.querySelectorAll(".lin-edge"), function (e) {
          e.setAttribute("stroke", "#c3cedd");
          e.setAttribute("stroke-width", "1.3");
        });
      });
    });
  }

  /* ---------- text output ---------- */
  function render() {
    var sql = input.value;
    if (!sql.trim()) {
      chipsEl.innerHTML = "";
      outEl.innerHTML = '<p class="pg-empty">Paste a SELECT statement above.</p>';
      graphEl.innerHTML = "";
      return;
    }

    var doc;
    try { doc = window.sqldoc.analyse(sql, "query"); }
    catch (err) {
      outEl.innerHTML = '<p class="pg-empty">Could not parse that one. ' + esc(err.message) + "</p>";
      graphEl.innerHTML = "";
      return;
    }

    var f = doc.final;
    if (!f) {
      chipsEl.innerHTML = "";
      outEl.innerHTML = '<p class="pg-empty">No SELECT statement found.</p>';
      graphEl.innerHTML = "";
      return;
    }

    var chips = [
      [f.output_columns.length, "column"],
      [doc.base_tables.length, "table"],
      [f.joins.length, "join"],
      [f.filters.length, "filter"],
      [doc.stages.length - 1, "CTE"]
    ].filter(function (c) { return c[0] > 0; });
    chipsEl.innerHTML = chips.map(function (c) {
      return '<span class="pg-chip"><b>' + c[0] + "</b> " + c[1] + (c[0] === 1 ? "" : "s") + "</span>";
    }).join("");

    var h = [];

    if (doc.base_tables.length) {
      h.push('<h4 class="pg-h">Reads from</h4><p class="pg-tables">' +
             doc.base_tables.map(function (t) { return "<code>" + esc(t) + "</code>"; }).join(" ") +
             "</p>");
    }

    if (doc.parameters.length) {
      h.push('<h4 class="pg-h">Parameters</h4><p class="pg-tables">' +
             doc.parameters.map(function (p) { return "<code>" + esc(p) + "</code>"; }).join(" ") +
             "</p>");
    }

    h.push('<h4 class="pg-h">Output columns</h4>');
    h.push('<div class="table-scroll" role="region" aria-label="Output columns" tabindex="0">' +
           '<table class="pg-table"><tr><th>Column</th><th>Comes from</th><th>Notes</th></tr>');
    f.output_columns.forEach(function (c) {
      var src = c.sources.length
        ? c.sources.map(function (s) { return "<code>" + esc(s) + "</code>"; }).join(" ")
        : '<span class="pg-dim">&mdash;</span>';
      h.push("<tr><td><code>" + esc(c.name) + "</code></td><td>" + src + "</td><td>" +
             (c.note ? '<span class="pg-note">' + esc(c.note) + "</span>" : "") + "</td></tr>");
    });
    h.push("</table></div>");

    if (f.joins.length) {
      h.push('<h4 class="pg-h">Joins</h4>');
      h.push('<div class="table-scroll" role="region" aria-label="Joins" tabindex="0">' +
             '<table class="pg-table"><tr><th>Type</th><th>Table</th><th>On</th></tr>');
      f.joins.forEach(function (j) {
        h.push("<tr><td>" + esc(j.kind.toUpperCase()) + "</td><td><code>" + esc(j.target) +
               "</code></td><td>" + (j.condition ? "<code>" + esc(j.condition) + "</code>" :
               '<span class="pg-dim">&mdash;</span>') + "</td></tr>");
      });
      h.push("</table></div>");
    }

    if (f.filters.length) {
      h.push('<h4 class="pg-h">Filters</h4><ul class="pg-list">');
      f.filters.forEach(function (x) { h.push("<li><code>" + esc(x) + "</code></li>"); });
      h.push("</ul>");
    }

    if (f.group_by.length || f.is_distinct || f.row_limit) {
      h.push('<h4 class="pg-h">Grain</h4><ul class="pg-list">');
      if (f.is_distinct) h.push("<li><code>DISTINCT</code> &mdash; duplicates removed</li>");
      f.group_by.forEach(function (g) { h.push("<li>Grouped by <code>" + esc(g) + "</code></li>"); });
      if (f.row_limit) h.push("<li>Row limit <code>" + esc(f.row_limit) + "</code></li>");
      h.push("</ul>");
    }

    var ctes = doc.stages.filter(function (s) { return s.name !== "final"; });
    if (ctes.length) {
      h.push('<h4 class="pg-h">Intermediate steps</h4><ul class="pg-list">');
      ctes.forEach(function (s) {
        var t = s.sources.map(function (x) { return x.name; }).join(", ");
        h.push("<li><code>" + esc(s.name) + "</code> &mdash; " + s.output_columns.length +
               " columns from " + esc(t || "?") +
               (s.group_by.length ? ", grouped" : "") + "</li>");
      });
      h.push("</ul>");
    }

    outEl.innerHTML = h.join("");
    drawGraph(doc);
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(render, 160); }

  document.addEventListener("DOMContentLoaded", function () {
    input = document.getElementById("pg-input");
    outEl = document.getElementById("pg-output");
    graphEl = document.getElementById("pg-graph");
    chipsEl = document.getElementById("pg-chips");
    var tabs = document.getElementById("pg-tabs");
    if (!input) return;

    Object.keys(EXAMPLES).forEach(function (name, i) {
      var b = document.createElement("button");
      b.className = "pg-tab" + (i === 0 ? " on" : "");
      b.textContent = name;
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(tabs.children, function (c) { c.classList.remove("on"); });
        b.classList.add("on");
        input.value = EXAMPLES[name];
        render();
      });
      tabs.appendChild(b);
    });

    input.value = EXAMPLES[Object.keys(EXAMPLES)[0]];
    input.addEventListener("input", function () {
      Array.prototype.forEach.call(tabs.children, function (c) { c.classList.remove("on"); });
      schedule();
    });
    render();
  });
})();
