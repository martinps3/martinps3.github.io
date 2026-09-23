(function () {
  "use strict";

  var root = document.getElementById("checker");
  if (!root) return;

  var before = document.getElementById("gc-before");
  var after = document.getElementById("gc-after");
  var mapping = document.getElementById("gc-mapping");
  var keyOptions = document.getElementById("gc-key-options");
  var amountSelect = document.getElementById("gc-amount");
  var status = document.getElementById("gc-status");
  var error = document.getElementById("gc-error");
  var results = document.getElementById("gc-results");
  var filter = document.getElementById("gc-filter");
  var pageInfo = document.getElementById("gc-page-info");
  var previousButton = document.getElementById("gc-prev");
  var nextButton = document.getElementById("gc-next");
  var parsed = null;
  var comparison = null;
  var selection = null;
  var page = 0;
  var pageSize = 50;
  var issueLabels = {
    "base-duplicate": "Repeated baseline key",
    "multiplied": "More rows after",
    "missing": "Missing after",
    "added": "New after",
    "amount-changed": "Amount changed"
  };
  var baseline = "shipment_id,net_charge\n101,120.00\n102,80.00\n103,200.00";
  var examples = {
    fanout: baseline.replace("101,120.00", "101,120.00\n101,120.00"),
    matched: baseline,
    missing: "shipment_id,net_charge\n101,120.00\n102,80.00",
    offset: "shipment_id,net_charge\n101,150.00\n102,50.00\n103,200.00"
  };

  function element(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function formatAmount(value) {
    if (value === null) return "Not checked";
    var parts = value.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }

  function formatDelta(value) {
    if (value === null) return "Not checked";
    return (value[0] !== "-" && !/^0(?:\.0+)?$/.test(value) ? "+" : "") + formatAmount(value);
  }

  function clearError() {
    error.hidden = true;
    error.textContent = "";
    before.removeAttribute("aria-invalid");
    after.removeAttribute("aria-invalid");
  }

  function invalidate(message, dataChanged) {
    comparison = null;
    selection = null;
    results.hidden = true;
    [
      "gc-result-title", "gc-result-message", "gc-summary-body", "gc-total-note",
      "gc-findings", "gc-detail-head", "gc-detail-body", "gc-detail-caption", "gc-page-info"
    ].forEach(function (id) { document.getElementById(id).replaceChildren(); });
    status.textContent = message;
    clearError();
    if (dataChanged) {
      parsed = null;
      mapping.disabled = true;
      keyOptions.replaceChildren();
      amountSelect.replaceChildren(element("option", "Row and key checks only"));
      amountSelect.options[0].value = "";
    }
  }

  function attempt(action) {
    clearError();
    try {
      action();
    } catch (err) {
      comparison = null;
      results.hidden = true;
      error.textContent = err instanceof Error ? err.message : "The comparison could not be completed.";
      error.hidden = false;
      status.textContent = "Fix the input or selection, then try again.";
      console.error("Join and grain checker:", err);
    }
  }

  function selectedKeys() {
    return Array.from(keyOptions.querySelectorAll("input:checked"), function (input) { return input.value; });
  }

  function updateAmounts(preferred) {
    var keys = selectedKeys();
    var common = parsed.base.headers.filter(function (header) {
      return parsed.joined.headers.includes(header) && !keys.includes(header);
    });
    var none = element("option", "Row and key checks only");
    none.value = "";
    amountSelect.replaceChildren(none);
    common.forEach(function (header) {
      var option = element("option", header);
      option.value = header;
      amountSelect.append(option);
    });
    if (common.includes(preferred)) amountSelect.value = preferred;
  }

  function readColumns(defaults) {
    invalidate("Reading CSV headers...", true);
    var baseData;
    var joinedData;
    try {
      baseData = window.GrainChecker.parseCSV(before.value, "Before the join");
    } catch (err) {
      before.setAttribute("aria-invalid", "true");
      before.focus();
      throw err;
    }
    try {
      joinedData = window.GrainChecker.parseCSV(after.value, "After the join");
    } catch (err) {
      after.setAttribute("aria-invalid", "true");
      after.focus();
      throw err;
    }
    var common = baseData.headers.filter(function (header) { return joinedData.headers.includes(header); });
    if (!common.length) {
      throw new Error("The CSV headers have no column names in common. Alias the key columns to the same names in both exports.");
    }
    parsed = { base: baseData, joined: joinedData };
    common.forEach(function (header, index) {
      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = "gc-key-" + index;
      input.value = header;
      input.checked = !!defaults && defaults.keys.includes(header);
      var label = element("label");
      label.htmlFor = input.id;
      label.append(input, element("span", header));
      keyOptions.append(label);
    });
    updateAmounts(defaults ? defaults.amount : "");
    mapping.disabled = false;
    status.textContent = baseData.rows.length.toLocaleString("en-US") + " baseline rows and " +
      joinedData.rows.length.toLocaleString("en-US") + " joined rows loaded. Choose the key and optional amount.";
  }

  function appendSummaryRow(label, left, right) {
    var row = element("tr");
    var heading = element("th", label);
    heading.scope = "row";
    row.append(heading, element("td", left), element("td", right));
    document.getElementById("gc-summary-body").append(row);
  }

  function renderDetails() {
    if (!comparison) return;
    var rows = comparison.details.filter(function (detail) {
      if (filter.value === "all") return true;
      if (filter.value === "issues") return detail.issues.length > 0;
      return detail.issues.includes(filter.value);
    });
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.max(0, Math.min(page, pages - 1));
    var headers = selection.keys.concat(["Rows before", "Rows after"]);
    if (selection.amount) headers.push("Amount before", "Amount after", "Difference");
    headers.push("Findings");
    var headRow = element("tr");
    headers.forEach(function (text) {
      var cell = element("th", text);
      cell.scope = "col";
      headRow.append(cell);
    });
    document.getElementById("gc-detail-head").replaceChildren(headRow);
    document.getElementById("gc-detail-caption").textContent =
      rows.length.toLocaleString("en-US") + (rows.length === 1 ? " key" : " keys") + " in this view" +
      (selection.amount ? " \u00b7 Amount: " + selection.amount : " \u00b7 Amounts not checked");
    var body = document.getElementById("gc-detail-body");
    body.replaceChildren();
    if (!rows.length) {
      var emptyRow = element("tr");
      var emptyCell = element("td", "No keys match this filter.");
      emptyCell.colSpan = headers.length;
      emptyRow.append(emptyCell);
      body.append(emptyRow);
    }
    rows.slice(page * pageSize, (page + 1) * pageSize).forEach(function (detail) {
      var row = element("tr");
      detail.key.forEach(function (value) { row.append(element("td", value, "gc-key-cell")); });
      row.append(element("td", detail.baseRows), element("td", detail.joinedRows));
      if (selection.amount) {
        row.append(element("td", formatAmount(detail.baseAmount)));
        row.append(element("td", formatAmount(detail.joinedAmount)));
        row.append(element("td", formatDelta(detail.delta)));
      }
      var finding = element("td", undefined, "gc-issue-cell");
      detail.issues.forEach(function (issue) { finding.append(element("span", issueLabels[issue], "gc-issue")); });
      if (!detail.issues.length) finding.textContent = "No difference";
      row.append(finding);
      body.append(row);
    });
    pageInfo.textContent = rows.length ? "Page " + (page + 1) + " of " + pages : "0 keys";
    previousButton.disabled = page === 0;
    nextButton.disabled = page >= pages - 1;
  }

  function renderComparison(focus) {
    var title = document.getElementById("gc-result-title");
    var message = document.getElementById("gc-result-message");
    document.getElementById("gc-verdict").dataset.state = comparison.status;
    if (comparison.status === "baseline-invalid") {
      title.textContent = "Check the baseline grain first";
      message.textContent = comparison.base.rows === 0
        ? "The baseline has no data rows. The differences below are still shown, but an empty result cannot establish one row per key."
        : "The selected key already repeats in the baseline. Differences are shown below, but this is not a validated one-row-per-key starting point.";
    } else if (comparison.status === "matched") {
      title.textContent = "No differences in the selected fields";
      message.textContent = "Every pasted key has one row on each side" +
        (selection.amount ? " and the same selected amount." : ". Amounts were not checked.") +
        " This does not validate unselected columns, the business definition, or data outside these exports.";
    } else {
      title.textContent = "There are differences to investigate";
      message.textContent = "Compare the keys below with the intended report grain and filters. A difference may be expected; the checker does not decide the correct business rule.";
    }
    document.getElementById("gc-summary-body").replaceChildren();
    appendSummaryRow("Rows", comparison.base.rows.toLocaleString("en-US"), comparison.joined.rows.toLocaleString("en-US"));
    appendSummaryRow("Distinct keys", comparison.base.keys.toLocaleString("en-US"), comparison.joined.keys.toLocaleString("en-US"));
    appendSummaryRow("Keys with multiple rows", comparison.base.duplicateKeys.toLocaleString("en-US"), comparison.joined.duplicateKeys.toLocaleString("en-US"));
    appendSummaryRow(selection.amount ? "Sum of " + selection.amount : "Amount", formatAmount(comparison.base.total), formatAmount(comparison.joined.total));
    var totalNote = document.getElementById("gc-total-note");
    totalNote.textContent = selection.amount
      ? "Total difference (after minus before): " + formatDelta(comparison.totalDelta) +
        ". These are row sums, not deduplicated or corrected totals."
      : "No amount selected. This comparison checks rows and keys only.";
    var findings = document.getElementById("gc-findings");
    findings.replaceChildren();
    [
      [comparison.counts.multiplied, "Keys with more rows after"],
      [comparison.counts.missing, "Keys missing after"],
      [comparison.counts.added, "New keys after"],
      [selection.amount ? comparison.counts.amountChanged : "\u2014", selection.amount ? "Shared keys with changed amounts" : "Amounts not checked"],
      [comparison.counts.baseDuplicates, "Repeated baseline keys"]
    ].forEach(function (item) {
      var box = element("div", undefined, "gc-finding");
      box.append(element("b", item[0]), element("span", item[1]));
      findings.append(box);
    });
    page = 0;
    filter.value = comparison.status === "matched" ? "all" : "issues";
    results.hidden = false;
    renderDetails();
    status.textContent = "Comparison ready. " + title.textContent + ".";
    if (focus) title.focus();
  }

  function compare(focus) {
    if (!parsed) throw new Error("Read the columns again after editing the CSV.");
    selection = { keys: selectedKeys(), amount: amountSelect.value || null };
    comparison = window.GrainChecker.compare(parsed.base, parsed.joined, selection);
    renderComparison(focus);
  }

  function loadExample(focus) {
    before.value = baseline;
    after.value = examples[document.getElementById("gc-example").value];
    readColumns({ keys: ["shipment_id"], amount: "net_charge" });
    compare(focus);
  }

  function downloadComparison() {
    if (!comparison) throw new Error("Run a comparison before downloading the report.");
    var report = {
      tool: "Join and grain checker",
      version: 1,
      scope: "Only the selected columns and supplied CSV rows; not a certification of the query or business grain.",
      keyComparison: "Exact text, case and whitespace sensitive",
      amountComparison: "Exact decimal sums, after minus before; no rounding tolerance or currency conversion",
      selection: selection,
      comparison: comparison
    };
    var url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    var link = element("a");
    link.href = url;
    link.download = "join-grain-comparison.json";
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  before.addEventListener("input", function () { invalidate("CSV changed. Read columns again before comparing.", true); });
  after.addEventListener("input", function () { invalidate("CSV changed. Read columns again before comparing.", true); });
  document.getElementById("gc-read").addEventListener("click", function () { attempt(function () { readColumns(); }); });
  document.getElementById("gc-form").addEventListener("submit", function (event) {
    event.preventDefault();
    attempt(function () { compare(true); });
  });
  keyOptions.addEventListener("change", function () {
    var preferred = amountSelect.value;
    invalidate("Key selection changed. Compare again to refresh the findings.", false);
    updateAmounts(preferred);
  });
  amountSelect.addEventListener("change", function () { invalidate("Amount selection changed. Compare again to refresh the findings.", false); });
  document.getElementById("gc-load-example").addEventListener("click", function () { attempt(function () { loadExample(true); }); });
  document.getElementById("gc-clear").addEventListener("click", function () {
    before.value = "";
    after.value = "";
    invalidate("Inputs cleared. Paste CSV on both sides and read the columns.", true);
    before.focus();
  });
  filter.addEventListener("change", function () { page = 0; renderDetails(); });
  previousButton.addEventListener("click", function () { page--; renderDetails(); });
  nextButton.addEventListener("click", function () { page++; renderDetails(); });
  document.getElementById("gc-download").addEventListener("click", function () { attempt(downloadComparison); });

  document.getElementById("gc-controls").hidden = false;
  if (!window.GrainChecker) {
    error.textContent = "The comparison engine could not load. Reload the page; no CSV was processed.";
    error.hidden = false;
    root.querySelectorAll("button, select, textarea").forEach(function (control) { control.disabled = true; });
    return;
  }
  attempt(function () { loadExample(false); });
})();
