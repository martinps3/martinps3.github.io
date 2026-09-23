(function (root) {
  "use strict";

  var limits = Object.freeze({ maxChars: 1000000, maxRows: 10000, maxDecimals: 6, maxColumns: 128 });
  var scale = 1000000n;

  function fail(label, message, record, column) {
    var context = String(label);
    if (record != null) context += ", record " + record;
    if (column != null) context += ", column " + column;
    throw new Error(context + ": " + message);
  }

  function parseCSV(text, label = "CSV") {
    if (typeof text !== "string") fail(label, "Expected CSV text.");
    if (text.length > limits.maxChars) fail(label, "Input exceeds " + limits.maxChars + " characters.");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    var headers = null;
    var rows = [];
    var cells = [];
    var field = "";
    var state = "start";
    var blank = true;
    var record = 1;

    function finishRecord() {
      if (!blank) {
        cells.push(field);
        if (headers === null) {
          headers = cells.map(function (value) { return value.trim(); });
          var seen = new Set();
          headers.forEach(function (header, index) {
            if (!header) fail(label, "Header must not be blank.", record, index + 1);
            if (seen.has(header)) fail(label, "Duplicate header " + JSON.stringify(header) + ".", record, index + 1);
            seen.add(header);
          });
        } else {
          if (cells.length !== headers.length) {
            fail(label, "Expected " + headers.length + " fields, found " + cells.length + ".", record, Math.min(cells.length, headers.length) + 1);
          }
          if (rows.length >= limits.maxRows) fail(label, "Input exceeds " + limits.maxRows + " data rows.", record);
          rows.push(cells);
        }
        record++;
      }
      cells = [];
      field = "";
      state = "start";
      blank = true;
    }

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (state === "quoted") {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            state = "closed";
          }
        } else {
          field += ch;
        }
        continue;
      }
      if (ch === "\n" || ch === "\r") {
        finishRecord();
        if (ch === "\r" && text[i + 1] === "\n") i++;
      } else if (ch === ",") {
        if (cells.length + 1 >= limits.maxColumns) {
          fail(label, "Record exceeds " + limits.maxColumns + " columns.", record, limits.maxColumns + 1);
        }
        cells.push(field);
        field = "";
        state = "start";
        blank = false;
      } else if (state === "closed") {
        fail(label, "Unexpected character after closing quote.", record, cells.length + 1);
      } else if (ch === '"') {
        if (state !== "start") fail(label, "Quote must begin a field.", record, cells.length + 1);
        state = "quoted";
        blank = false;
      } else {
        field += ch;
        state = "unquoted";
        if (ch.trim() !== "") blank = false;
      }
    }
    if (state === "quoted") fail(label, "Unclosed quoted field.", record, cells.length + 1);
    finishRecord();
    if (headers === null) fail(label, "Input is empty; a header record is required.", 1);
    return { headers: headers, rows: rows };
  }

  function validateTable(table, label) {
    if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) {
      fail(label, "Expected headers and rows arrays.");
    }
    if (!table.headers.length) fail(label, "At least one header is required.", 1);
    if (table.headers.length > limits.maxColumns) fail(label, "Record exceeds " + limits.maxColumns + " columns.", 1, limits.maxColumns + 1);
    var seen = new Set();
    Array.from(table.headers).forEach(function (header, index) {
      if (typeof header !== "string" || !header.trim()) fail(label, "Header must be a nonblank string.", 1, index + 1);
      if (seen.has(header)) fail(label, "Duplicate header " + JSON.stringify(header) + ".", 1, index + 1);
      seen.add(header);
    });
    if (table.rows.length > limits.maxRows) fail(label, "Input exceeds " + limits.maxRows + " data rows.");
    Array.from(table.rows).forEach(function (row, index) {
      if (Array.isArray(row) && row.length > limits.maxColumns) fail(label, "Record exceeds " + limits.maxColumns + " columns.", index + 2, limits.maxColumns + 1);
      if (!Array.isArray(row) || row.length !== table.headers.length) fail(label, "Row width must match headers.", index + 2);
      Array.from(row).forEach(function (cell, column) {
        if (typeof cell !== "string") fail(label, "Cells must be strings, not null or other values.", index + 2, column + 1);
      });
    });
  }

  function parseAmount(value, label, record, column) {
    var trimmed = value.trim();
    if (!/^[-+]?\d+(\.\d{1,6})?$/.test(trimmed)) {
      fail(label, "Amount must be a signed decimal with up to 6 decimal places (no currency, grouping, or exponent).", record, column);
    }
    var negative = trimmed[0] === "-";
    var parts = trimmed.replace(/^[-+]/, "").split(".");
    if (parts[0].length > 30) fail(label, "Amount exceeds 30 integer digits.", record, column);
    var valueScaled = BigInt(parts[0]) * scale + BigInt((parts[1] || "").padEnd(6, "0"));
    return negative ? -valueScaled : valueScaled;
  }

  function decimal(value) {
    var negative = value < 0n;
    var absolute = negative ? -value : value;
    var fraction = (absolute % scale).toString().padStart(6, "0").replace(/0+$/, "");
    return (negative ? "-" : "") + (absolute / scale).toString() + "." + fraction.padEnd(2, "0");
  }

  function compare(base, joined, options) {
    validateTable(base, "Base");
    validateTable(joined, "Joined");
    if (!options || !Array.isArray(options.keys) || !options.keys.length) fail("Selection", "Choose at least one key column.");
    var keys = Array.from(options.keys);
    if (new Set(keys).size !== keys.length) fail("Selection", "Key columns must be unique.");
    var amount = options.amount == null ? null : options.amount;
    keys.forEach(function (key) {
      if (typeof key !== "string" || !base.headers.includes(key) || !joined.headers.includes(key)) {
        fail("Selection", "Key column " + JSON.stringify(key) + " must exist in both datasets.");
      }
    });
    if (amount !== null && (typeof amount !== "string" || !base.headers.includes(amount) || !joined.headers.includes(amount))) {
      fail("Selection", "Amount column must exist in both datasets.");
    }
    if (keys.includes(amount)) fail("Selection", "Amount column must not also be a key column.");

    function aggregate(table, label) {
      var keyColumns = keys.map(function (key) { return table.headers.indexOf(key); });
      var amountColumn = amount === null ? -1 : table.headers.indexOf(amount);
      var groups = new Map();
      var total = 0n;
      var duplicates = 0;
      table.rows.forEach(function (row, index) {
        var tuple = keyColumns.map(function (column) {
          if (!row[column].trim()) fail(label, "Key must not be blank or whitespace-only.", index + 2, column + 1);
          return row[column];
        });
        // JSON encodes string tuples without delimiter collisions or object-key hazards.
        var encoded = JSON.stringify(tuple);
        var group = groups.get(encoded);
        if (!group) {
          group = { key: tuple, rows: 0, amount: 0n };
          groups.set(encoded, group);
        }
        group.rows++;
        if (group.rows === 2) duplicates++;
        if (amountColumn >= 0) {
          var value = parseAmount(row[amountColumn], label, index + 2, amountColumn + 1);
          group.amount += value;
          total += value;
        }
      });
      return {
        groups: groups,
        total: total,
        summary: { rows: table.rows.length, keys: groups.size, duplicateKeys: duplicates, total: amount === null ? null : decimal(total) }
      };
    }

    var left = aggregate(base, "Base");
    var right = aggregate(joined, "Joined");
    var counts = { multiplied: 0, missing: 0, added: 0, amountChanged: 0, baseDuplicates: left.summary.duplicateKeys };
    var union = new Set([...left.groups.keys(), ...right.groups.keys()]);
    var details = [];
    var hasIssues = false;
    union.forEach(function (encoded) {
      var before = left.groups.get(encoded);
      var after = right.groups.get(encoded);
      var beforeAmount = before ? before.amount : 0n;
      var afterAmount = after ? after.amount : 0n;
      var issues = [];
      if (before && before.rows > 1) issues.push("base-duplicate");
      if (before && after && after.rows > before.rows) {
        issues.push("multiplied");
        counts.multiplied++;
      }
      if (before && !after) {
        issues.push("missing");
        counts.missing++;
      }
      if (!before && after) {
        issues.push("added");
        counts.added++;
      }
      if (amount !== null && before && after && beforeAmount !== afterAmount) {
        issues.push("amount-changed");
        counts.amountChanged++;
      }
      if (issues.length) hasIssues = true;
      details.push({
        key: (before || after).key,
        baseRows: before ? before.rows : 0,
        joinedRows: after ? after.rows : 0,
        baseAmount: amount === null ? null : decimal(beforeAmount),
        joinedAmount: amount === null ? null : decimal(afterAmount),
        delta: amount === null ? null : decimal(afterAmount - beforeAmount),
        issues: issues
      });
    });
    return {
      status: left.summary.duplicateKeys > 0 || base.rows.length === 0 ? "baseline-invalid" : hasIssues ? "review" : "matched",
      base: left.summary,
      joined: right.summary,
      counts: counts,
      totalDelta: amount === null ? null : decimal(right.total - left.total),
      details: details
    };
  }

  var api = Object.freeze({ parseCSV: parseCSV, compare: compare, limits: limits });
  root.GrainChecker = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(globalThis);
