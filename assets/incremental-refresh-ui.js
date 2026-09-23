(function () {
  "use strict";
  const engine = window.IncrementalRefresh;
  const $ = id => document.getElementById(id);
  const money = cents => cents === null ? "Not loaded" :
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
  const date = value => new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC"
  }).format(new Date(value));
  let state;

  function render() {
    const result = engine.summarize(state);
    $("ir-source-total").textContent = money(result.sourceTotal);
    $("ir-model-total").textContent = money(result.modelTotal);
    $("ir-gap").textContent = money(result.gap);
    $("ir-range").textContent =
      `SHIPPED_AT >= ${date(state.start)} 00:00 and < ${date(state.end)} 00:00 UTC`;
    const messages = {
      baseline: "Baseline loaded: six shipments, $2,100 in both places. Apply the source changes to begin.",
      changed: "Snowflake now has a new $700 shipment, a recent $50 correction and an old $80 correction. Power BI still holds the baseline.",
      refreshed: result.differences ?
        "Refresh completed. The new shipment and recent correction are loaded, but May is still $80 behind. A successful refresh is not the same as a reconciled model." :
        "Refresh completed. The wider window includes May, so both corrections and the new shipment are loaded. The model now matches the source.",
      repaired: "May was explicitly reprocessed. The $80 historical correction is now in the model; source and model both total $2,930."
    };
    $("ir-status").textContent = messages[state.phase];
    $("ir-status").dataset.stale = String(result.differences > 0);
    $("ir-change").disabled = state.phase !== "baseline";
    $("ir-refresh").disabled = state.phase !== "changed";
    $("ir-repair").disabled = state.phase !== "refreshed" || result.differences === 0;
    $("ir-work").textContent = state.lastRead ?
      `Last operation: ${state.lastRead.rows} source row(s) selected between ${date(state.lastRead.start)} and ${date(state.lastRead.end)} (end excluded). This is not a measurement of Snowflake rows scanned, credits or refresh duration.` :
      "The initial historical load is already represented here. No incremental read has run yet.";

    $("ir-months").replaceChildren();
    for (const [month, name] of [["05", "May"], ["06", "June"], ["07", "July"], ["08", "August"], ["09", "September"]]) {
      const start = `2026-${month}-01T00:00:00Z`;
      const end = new Date(Date.UTC(2026, Number(month), 1)).toISOString();
      const visited = Boolean(state.lastRead &&
        Date.parse(state.lastRead.start) < Date.parse(end) &&
        Date.parse(state.lastRead.end) > Date.parse(start));
      const stale = result.details.some(row => row.shippedAt.slice(5, 7) === month && row.different);
      const block = document.createElement("div");
      block.className = "ir-month";
      block.dataset.read = String(visited);
      const title = document.createElement("strong");
      title.textContent = name;
      const label = document.createElement("span");
      const full = visited && Date.parse(state.lastRead.start) <= Date.parse(start) &&
        Date.parse(state.lastRead.end) >= Date.parse(end);
      label.textContent = `${visited ? (full ? "Re-read" : "Partly re-read") : "Not re-read"}${stale ? " / values differ" : ""}`;
      block.append(title, label);
      $("ir-months").append(block);
    }

    $("ir-rows").replaceChildren();
    for (const row of result.details) {
      const tr = document.createElement("tr");
      tr.dataset.stale = String(row.different);
      const note = row.different ?
        (row.model === null ? "New row not loaded" : "Correction not loaded") :
        (row.reread ? "Re-read from source" : "Stored value matches");
      for (const [index, text] of [row.id, date(row.shippedAt), money(row.source), money(row.model), note].entries()) {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) cell.scope = "row";
        cell.textContent = text;
        tr.append(cell);
      }
      $("ir-rows").append(tr);
    }
  }

  function attempt(action) {
    try {
      action();
      render();
      $("ir-error").hidden = true;
      $("ir-error").textContent = "";
    } catch (error) {
      console.error("Incremental refresh example:", error);
      $("ir-error").textContent = error.message;
      $("ir-error").hidden = false;
    }
  }

  $("ir-window").addEventListener("change", () => attempt(() => {
    state = engine.create(Number($("ir-window").value));
  }));
  $("ir-reset").addEventListener("click", () => attempt(() => {
    state = engine.create(Number($("ir-window").value));
  }));
  $("ir-change").addEventListener("click", () => attempt(() => { state = engine.applyChanges(state); }));
  $("ir-refresh").addEventListener("click", () => attempt(() => { state = engine.refresh(state); }));
  $("ir-repair").addEventListener("click", () => attempt(() => { state = engine.repairMay(state); }));
  attempt(() => { state = engine.create(); });
  $("ir-controls").hidden = false;
})();
