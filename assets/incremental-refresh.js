(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.IncrementalRefresh = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const cutoff = "2026-09-24T00:00:00Z";
  const historyStart = "2026-05-01T00:00:00Z";
  const baseline = [
    ["S1001", "2026-05-12", 10000],
    ["S1002", "2026-07-20", 20000],
    ["S1003", "2026-08-10", 30000],
    ["S1004", "2026-09-01", 40000],
    ["S1005", "2026-09-21", 50000],
    ["S1006", "2026-09-22", 60000]
  ].map(([id, date, cents]) => ({
    id, shippedAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z`, cents
  }));
  const copy = rows => rows.map(row => ({ ...row }));
  const total = rows => rows.reduce((sum, row) => sum + row.cents, 0);
  const inRange = (row, start, end) =>
    Date.parse(row.shippedAt) >= Date.parse(start) && Date.parse(row.shippedAt) < Date.parse(end);

  function create(days = 3) {
    if (![3, 30, 150].includes(days)) throw new Error("Choose a 3, 30 or 150-day refresh window.");
    const start = new Date(Math.max(
      Date.parse(historyStart), Date.parse(cutoff) - days * 86400000
    )).toISOString();
    return {
      phase: "baseline", days, start, end: cutoff,
      source: copy(baseline), model: copy(baseline), lastRead: null
    };
  }

  function applyChanges(state) {
    if (state.phase !== "baseline") throw new Error("Start over before applying another batch of changes.");
    const source = copy(state.source);
    for (const row of source) {
      if (row.id === "S1001" || row.id === "S1005") {
        row.cents += row.id === "S1001" ? 8000 : 5000;
        row.updatedAt = "2026-09-23T00:00:00Z";
      }
    }
    source.push({
      id: "S1007", shippedAt: "2026-09-23T00:00:00Z",
      updatedAt: "2026-09-23T00:00:00Z", cents: 70000
    });
    return { ...state, phase: "changed", source, model: copy(state.model) };
  }

  function replaceRange(state, start, end, phase) {
    const incoming = state.source.filter(row => inRange(row, start, end));
    const retained = state.model.filter(row => !inRange(row, start, end));
    return {
      ...state, phase, source: copy(state.source),
      model: copy([...retained, ...incoming]).sort((a, b) => a.id.localeCompare(b.id)),
      lastRead: { start, end, rows: incoming.length }
    };
  }

  function refresh(state) {
    if (!["changed", "refreshed", "repaired"].includes(state.phase)) {
      throw new Error("Apply the source changes before refreshing.");
    }
    return replaceRange(state, state.start, state.end, "refreshed");
  }

  function repairMay(state) {
    if (state.phase !== "refreshed") throw new Error("Run the incremental refresh before reprocessing May.");
    return replaceRange(state, historyStart, "2026-06-01T00:00:00Z", "repaired");
  }

  function summarize(state) {
    const ids = new Set([...state.source, ...state.model].map(row => row.id));
    const details = [...ids].sort().map(id => {
      const source = state.source.find(row => row.id === id);
      const model = state.model.find(row => row.id === id);
      return {
        id, shippedAt: (source || model).shippedAt,
        source: source ? source.cents : null, model: model ? model.cents : null,
        different: !source || !model || source.cents !== model.cents,
        reread: Boolean(state.lastRead && inRange(source || model, state.lastRead.start, state.lastRead.end))
      };
    });
    return {
      sourceTotal: total(state.source), modelTotal: total(state.model),
      gap: total(state.source) - total(state.model),
      differences: details.filter(row => row.different).length, details
    };
  }

  return Object.freeze({ create, applyChanges, refresh, repairMay, summarize, inRange });
});
