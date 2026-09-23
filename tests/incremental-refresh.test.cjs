const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../assets/incremental-refresh.js");

test("baseline has six unique shipments and independent source/model copies", () => {
  const state = engine.create();
  assert.equal(state.model.length, 6);
  assert.equal(new Set(state.model.map(row => row.id)).size, 6);
  assert.equal(engine.summarize(state).gap, 0);
  assert.equal(engine.summarize(state).modelTotal, 210000);
  state.model[0].cents = 0;
  assert.equal(state.source[0].cents, 10000);
  assert.equal(engine.create().model[0].cents, 10000);
});

test("source changes do not silently refresh the model or mutate the baseline", () => {
  const initial = engine.create();
  const snapshot = JSON.stringify(initial);
  const changed = engine.applyChanges(initial);
  assert.equal(JSON.stringify(initial), snapshot);
  assert.equal(changed.source.length, 7);
  const result = engine.summarize(changed);
  assert.equal(result.sourceTotal, 293000);
  assert.equal(result.modelTotal, 210000);
  assert.equal(result.differences, 3);
  assert.equal(result.gap, 83000);
});

for (const [days, rows, gap] of [[3, 3, 8000], [30, 4, 8000], [150, 7, 0]]) {
  test(`${days}-day refresh reads ${rows} rows and leaves a ${gap}-cent gap`, () => {
    const changed = engine.applyChanges(engine.create(days));
    const snapshot = JSON.stringify(changed);
    const refreshed = engine.refresh(changed);
    const result = engine.summarize(refreshed);
    assert.equal(JSON.stringify(changed), snapshot);
    assert.equal(refreshed.lastRead.rows, rows);
    assert.equal(refreshed.model.length, 7);
    assert.equal(result.gap, gap);
    assert.equal(result.sourceTotal, 293000);
    assert.equal(result.modelTotal, 293000 - gap);
    assert.equal(result.differences, gap ? 1 : 0);
    assert.equal(result.details.find(row => row.id === "S1001").model, gap ? 10000 : 18000);
  });
}

test("explicit May repair reconciles history without replacing recent values", () => {
  const refreshed = engine.refresh(engine.applyChanges(engine.create()));
  const snapshot = JSON.stringify(refreshed);
  const repaired = engine.repairMay(refreshed);
  assert.equal(JSON.stringify(refreshed), snapshot);
  assert.equal(repaired.lastRead.rows, 1);
  assert.equal(engine.summarize(repaired).gap, 0);
  assert.equal(engine.summarize(repaired).modelTotal, 293000);
  assert.equal(repaired.model.find(row => row.id === "S1005").cents, 55000);
  assert.equal(repaired.model.find(row => row.id === "S1007").cents, 70000);
  assert.deepEqual(engine.refresh(repaired).model, repaired.model);
});

test("refresh replaces the bounded slice rather than appending duplicates", () => {
  const refreshed = engine.refresh(engine.applyChanges(engine.create()));
  assert.deepEqual(engine.refresh(refreshed).model, refreshed.model);
  assert.equal(new Set(refreshed.model.map(row => row.id)).size, refreshed.model.length);
});

test("date bounds include the start and exclude the end including UTC offsets", () => {
  const { start, end } = engine.create();
  for (const [shippedAt, expected] of [
    ["2026-09-20T23:59:59.999Z", false],
    ["2026-09-21T00:00:00Z", true],
    ["2026-09-23T23:59:59.999Z", true],
    ["2026-09-24T00:00:00Z", false],
    ["2026-09-23T18:00:00-06:00", false]
  ]) assert.equal(engine.inRange({ shippedAt }, start, end), expected);
});

test("a changed audit timestamp does not move May into the shipment-date window", () => {
  const state = engine.applyChanges(engine.create());
  const may = state.source.find(row => row.id === "S1001");
  assert.equal(may.updatedAt, "2026-09-23T00:00:00Z");
  assert.equal(engine.inRange(may, state.start, state.end), false);
});

test("reprocessing a slice captures hard deletes there but leaves history untouched", () => {
  const state = engine.applyChanges(engine.create());
  state.source = state.source.filter(row => !["S1001", "S1005"].includes(row.id));
  const refreshed = engine.refresh(state);
  assert.equal(refreshed.model.some(row => row.id === "S1005"), false);
  assert.equal(refreshed.model.some(row => row.id === "S1001"), true);
  assert.equal(engine.summarize(refreshed).differences, 1);
  assert.equal(engine.summarize(engine.repairMay(refreshed)).differences, 0);
});

test("invalid window or sequence surfaces an error", () => {
  for (const days of [0, -1, 4, NaN, Infinity, "3", null]) {
    assert.throws(() => engine.create(days), /refresh window/);
  }
  assert.throws(() => engine.refresh(engine.create()), /Apply/);
  assert.throws(() => engine.repairMay(engine.create()), /incremental refresh/);
  assert.throws(() => engine.applyChanges(engine.applyChanges(engine.create())), /Start over/);
});

test("the wide refresh is bounded by retained history", () => {
  assert.equal(engine.create(150).start, "2026-05-01T00:00:00.000Z");
});
