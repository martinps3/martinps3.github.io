/* sqldoc - browser port of the Python analyser.
   Same logic: depth- and literal-aware scanning, no regex-only shortcuts.
   Exposes window.sqldoc.analyse(sql) */
(function (global) {
  "use strict";

  var QUOTES = { "'": "'", '"': '"', "`": "`", "[": "]" };

  function stripComments(sql) {
    var out = [], i = 0, n = sql.length;
    while (i < n) {
      var ch = sql[i];
      if (QUOTES[ch]) {
        var close = QUOTES[ch];
        out.push(ch); i++;
        while (i < n) {
          if (sql[i] === close) {
            if (i + 1 < n && sql[i + 1] === close && close !== "]") {
              out.push(sql[i], sql[i + 1]); i += 2; continue;
            }
            out.push(sql[i]); i++; break;
          }
          out.push(sql[i]); i++;
        }
        continue;
      }
      if (ch === "-" && sql[i + 1] === "-") { while (i < n && sql[i] !== "\n") i++; continue; }
      if (ch === "/" && sql[i + 1] === "*") {
        i += 2;
        while (i + 1 < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
        i += 2; continue;
      }
      out.push(ch); i++;
    }
    return out.join("");
  }

  /* callback(index, char, depth, inLiteral) */
  function scanDepth(sql, cb) {
    var depth = 0, i = 0, n = sql.length;
    while (i < n) {
      var ch = sql[i];
      if (QUOTES[ch]) {
        var close = QUOTES[ch], start = i;
        i++;
        while (i < n) {
          if (sql[i] === close) {
            if (i + 1 < n && sql[i + 1] === close && close !== "]") { i += 2; continue; }
            i++; break;
          }
          i++;
        }
        for (var j = start; j < Math.min(i, n); j++) cb(j, sql[j], depth, true);
        continue;
      }
      if (ch === "(") { depth++; cb(i, ch, depth, false); }
      else if (ch === ")") { cb(i, ch, depth, false); depth--; }
      else cb(i, ch, depth, false);
      i++;
    }
  }

  function isWordChar(c) { return c && /[A-Za-z0-9_]/.test(c); }

  function splitTopLevel(sql, separator) {
    separator = separator || ",";
    var parts = [], buf = [], sep = separator.toLowerCase(),
        seplen = sep.length, lowered = sql.toLowerCase(), skipUntil = -1,
        checkBefore = !/\s/.test(sep[0]),
        checkAfter = !/\s/.test(sep[sep.length - 1]);

    scanDepth(sql, function (i, ch, depth, inLit) {
      if (i < skipUntil) { buf.push(ch); return; }
      if (depth === 0 && !inLit && lowered.startsWith(sep, i)) {
        if (seplen > 1) {
          var beforeOk = true, afterOk = true;
          if (checkBefore) beforeOk = (i === 0) || !isWordChar(lowered[i - 1]);
          if (checkAfter) {
            var after = i + seplen;
            afterOk = (after >= lowered.length) || !isWordChar(lowered[after]);
          }
          if (!(beforeOk && afterOk)) { buf.push(ch); return; }
        }
        parts.push(buf.join("")); buf = []; skipUntil = i + seplen; return;
      }
      buf.push(ch);
    });

    parts.push(buf.join(""));
    return parts.map(function (p) { return p.trim(); }).filter(Boolean);
  }

  function findTopLevel(sql, keyword) {
    var lowered = sql.toLowerCase(), kw = keyword.toLowerCase(),
        klen = kw.length, found = -1;
    scanDepth(sql, function (i, ch, depth, inLit) {
      if (found >= 0 || depth !== 0 || inLit) return;
      if (!lowered.startsWith(kw, i)) return;
      var beforeOk = (i === 0) || !isWordChar(lowered[i - 1]);
      var after = i + klen;
      var afterOk = (after >= lowered.length) || !isWordChar(lowered[after]);
      if (beforeOk && afterOk) found = i;
    });
    return found;
  }

  function normWs(t) { return t.split(/\s+/).filter(Boolean).join(" "); }

  var CLAUSES = ["select", "from", "where", "group by", "having",
                 "qualify", "order by", "limit", "offset", "fetch"];
  var AGGREGATES = ["sum", "count", "avg", "min", "max", "median", "stddev", "array_agg"];

  function splitClauses(selectSql) {
    var positions = [];
    CLAUSES.forEach(function (kw) {
      var idx = findTopLevel(selectSql, kw);
      if (idx >= 0) positions.push([idx, kw]);
    });
    positions.sort(function (a, b) { return a[0] - b[0]; });

    var clauses = {};
    positions.forEach(function (p, n) {
      var start = p[0] + p[1].length;
      var end = (n + 1 < positions.length) ? positions[n + 1][0] : selectSql.length;
      clauses[p[1]] = selectSql.slice(start, end).trim();
    });
    return clauses;
  }

  function extractCtes(sql) {
    if (findTopLevel(sql, "with") !== 0) return [[], sql];
    var body = sql.slice(4).replace(/^\s+/, "");
    var ctes = [];

    for (;;) {
      var m = /^([A-Za-z_][\w$]*)\s+as\s*\(/i.exec(body);
      if (!m) break;
      var name = m[1];
      var openIdx = m[0].length - 1;
      var depth = 0, closeIdx = -1;
      for (var i = openIdx; i < body.length; i++) {
        if (body[i] === "(") depth++;
        else if (body[i] === ")") { depth--; if (depth === 0) { closeIdx = i; break; } }
      }
      if (closeIdx < 0) break;
      ctes.push([name, body.slice(openIdx + 1, closeIdx).trim()]);
      var rest = body.slice(closeIdx + 1).replace(/^\s+/, "");
      if (rest.startsWith(",")) { body = rest.slice(1).replace(/^\s+/, ""); continue; }
      body = rest;
      break;
    }
    return [ctes, body];
  }

  function parseOutputColumn(item, aliasMap) {
    var expr = normWs(item), name = "", body;
    var m = /\s+as\s+([A-Za-z_"\[][\w$"\]]*)\s*$/i.exec(expr);
    if (m) {
      name = m[1].replace(/^["\[]|["\]]$/g, "");
      body = expr.slice(0, m.index).trim();
    } else {
      var idx = expr.lastIndexOf(" ");
      var tail = idx >= 0 ? expr.slice(idx + 1) : "";
      var head = idx >= 0 ? expr.slice(0, idx) : expr;
      if (idx >= 0 && /^[A-Za-z_"\[][\w$"\]]*$/.test(tail) &&
          ["end", "desc", "asc", "null"].indexOf(tail.toLowerCase()) === -1 &&
          !/[,(+\-*/]$/.test(head.replace(/\s+$/, ""))) {
        name = tail.replace(/^["\[]|["\]]$/g, "");
        body = head.trim();
      } else body = expr;
    }

    if (!name) {
      if (body.indexOf(".") >= 0 && /^[\w$"\[\]]+\.[\w$"\[\]]+$/.test(body)) {
        name = body.split(".").pop().replace(/^["\[]|["\]]$/g, "");
      } else if (/^[A-Za-z_][\w$]*$/.test(body)) name = body;
      else name = "(expression)";
    }

    var sources = [], re = /\b([A-Za-z_][\w$]*)\.([A-Za-z_][\w$]*)\b/g, mm;
    while ((mm = re.exec(body)) !== null) {
      var table = aliasMap[mm[1].toLowerCase()] || mm[1];
      var entry = table + "." + mm[2];
      if (sources.indexOf(entry) === -1) sources.push(entry);
    }
    if (!sources.length && /^[A-Za-z_][\w$]*$/.test(body)) sources.push(body);

    var lowered = body.toLowerCase();
    var isAgg = AGGREGATES.some(function (fn) {
      return new RegExp("\\b" + fn + "\\s*\\(").test(lowered);
    });

    var note = "";
    if (/\bcase\s+when\b/.test(lowered)) note = "conditional logic";
    else if (/\bover\s*\(/.test(lowered)) note = "window function";
    else if (isAgg) note = "aggregated";

    return { name: name, expression: body, sources: sources,
             is_aggregate: isAgg, note: note };
  }

  function parseTableRef(ref) {
    ref = normWs(ref).trim();
    if (!ref) return null;
    if (ref[0] === "(") {
      var depth = 0, end = ref.length;
      for (var i = 0; i < ref.length; i++) {
        if (ref[i] === "(") depth++;
        else if (ref[i] === ")") { depth--; if (depth === 0) { end = i; break; } }
      }
      var alias = ref.slice(end + 1).trim().replace(/^as\s+/i, "").replace(/^["\[ ]+|["\] ]+$/g, "");
      return { name: alias || "(subquery)", alias: alias, kind: "subquery" };
    }
    var parts = ref.split(/\s+/);
    var name = parts[0].replace(/^["\[]|["\]]$/g, "");
    var al = "";
    if (parts.length >= 3 && parts[1].toLowerCase() === "as") al = parts[2].replace(/^["\[]|["\]]$/g, "");
    else if (parts.length === 2) al = parts[1].replace(/^["\[]|["\]]$/g, "");
    return { name: name, alias: al, kind: "table" };
  }

  function parseFrom(fromSql) {
    var sources = [], joins = [];
    var tokens = fromSql.split(/\b((?:inner|left|right|full|cross)?\s*(?:outer\s+)?join)\b/i);

    var first = (tokens[0] || "").trim();
    if (first) {
      splitTopLevel(first, ",").forEach(function (r) {
        var st = parseTableRef(r); if (st) sources.push(st);
      });
    }

    for (var i = 1; i < tokens.length; i += 2) {
      var kind = normWs(tokens[i] || "").toLowerCase();
      var body = tokens[i + 1] || "";
      var onIdx = findTopLevel(body, "on");
      var condition = "", targetSql = body;
      if (onIdx >= 0) {
        targetSql = body.slice(0, onIdx);
        condition = normWs(body.slice(onIdx + 2));
      }
      var st = parseTableRef(targetSql);
      if (st) {
        sources.push(st);
        joins.push({ kind: kind || "join", target: st.name, condition: condition });
      }
    }
    return [sources, joins];
  }

  function splitConditions(text) {
    if (!text || !text.trim()) return [];
    return splitTopLevel(normWs(text), " and ").map(normWs);
  }

  function analyseSelect(name, selectSql, cteNames) {
    var clauses = splitClauses(selectSql);
    var stage = { name: name, output_columns: [], sources: [], joins: [],
                  filters: [], group_by: [], having: [], order_by: [],
                  is_distinct: false, row_limit: "" };

    var fj = parseFrom(clauses["from"] || "");
    var sources = fj[0];
    sources.forEach(function (s) {
      if (cteNames.indexOf(s.name.toLowerCase()) >= 0) s.kind = "cte";
    });
    stage.sources = sources;
    stage.joins = fj[1];

    var aliasMap = {};
    sources.forEach(function (s) {
      if (s.alias) aliasMap[s.alias.toLowerCase()] = s.name;
      if (!(s.name.toLowerCase() in aliasMap)) aliasMap[s.name.toLowerCase()] = s.name;
    });

    var selectBody = clauses["select"] || "";
    if (/^\s*distinct\b/i.test(selectBody)) {
      stage.is_distinct = true;
      selectBody = selectBody.replace(/^\s*distinct\b/i, "");
    }
    var mTop = /^\s*top\s+(\d+)\b/i.exec(selectBody);
    if (mTop) { stage.row_limit = "TOP " + mTop[1]; selectBody = selectBody.slice(mTop[0].length); }

    splitTopLevel(selectBody, ",").forEach(function (item) {
      stage.output_columns.push(parseOutputColumn(item, aliasMap));
    });

    stage.filters = splitConditions(clauses["where"]);
    stage.having = splitConditions(clauses["having"]);
    stage.group_by = splitTopLevel(clauses["group by"] || "", ",").map(normWs);
    stage.order_by = splitTopLevel(clauses["order by"] || "", ",").map(normWs);
    if (clauses["limit"]) stage.row_limit = "LIMIT " + normWs(clauses["limit"]);

    return stage;
  }

  function analyse(sql, name) {
    name = name || "query";
    var cleaned = stripComments(sql).trim();
    var statements = splitTopLevel(cleaned, ";");
    var doc = { name: name, stages: [], base_tables: [], parameters: [] };
    if (!statements.length) return doc;

    var ec = extractCtes(statements[0].trim());
    var ctes = ec[0], main = ec[1];
    var cteNames = ctes.map(function (c) { return c[0].toLowerCase(); });

    ctes.forEach(function (c) { doc.stages.push(analyseSelect(c[0], c[1], cteNames)); });
    doc.stages.push(analyseSelect("final", main, cteNames));

    doc.stages.forEach(function (st) {
      st.sources.forEach(function (s) {
        if (s.kind === "table" && doc.base_tables.indexOf(s.name) === -1) {
          doc.base_tables.push(s.name);
        }
      });
    });

    var pre = /[:@]([A-Za-z_][\w$]*)/g, pm;
    while ((pm = pre.exec(cleaned)) !== null) {
      if (doc.parameters.indexOf(pm[1]) === -1) doc.parameters.push(pm[1]);
    }

    doc.final = doc.stages.length ? doc.stages[doc.stages.length - 1] : null;
    return doc;
  }

  var api = { analyse: analyse, stripComments: stripComments,
              splitTopLevel: splitTopLevel, findTopLevel: findTopLevel };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.sqldoc = api;
})(typeof window !== "undefined" ? window : globalThis);
