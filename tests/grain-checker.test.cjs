"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const checker = require("../assets/grain-checker.js");
const { parseCSV, compare, limits } = checker;
const options = { keys: ["id"], amount: "amount" };
const table = (body) => parseCSV("id,amount\n" + body);
const run = (before, after, selection = options) => compare(table(before), table(after), selection);

test("exports the same zero-dependency API in Node and the browser", () => {
  assert.equal(globalThis.GrainChecker, checker);
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "assets", "grain-checker.js"), "utf8"), browser);
  assert.deepEqual(Object.keys(browser.GrainChecker), Object.keys(checker));
  assert.equal(browser.GrainChecker.compare(browser.GrainChecker.parseCSV("id\n1"), browser.GrainChecker.parseCSV("id\n1"), { keys: ["id"], amount: null }).status, "matched");
  assert.deepEqual(limits, { maxChars: 1000000, maxRows: 10000, maxDecimals: 6, maxColumns: 128 });
});

test("fanout counts keys and calculates exact totals and changed aggregates", () => {
  const result = run("101,120\n102,80", "101,120\n101,120\n102,80");
  assert.equal(result.status, "review");
  assert.deepEqual(result.base, { rows: 2, keys: 2, duplicateKeys: 0, total: "200.00" });
  assert.deepEqual(result.joined, { rows: 3, keys: 2, duplicateKeys: 1, total: "320.00" });
  assert.deepEqual(result.counts, { multiplied: 1, missing: 0, added: 0, amountChanged: 1, baseDuplicates: 0 });
  assert.equal(result.totalDelta, "120.00");
  assert.deepEqual(result.details[0], { key: ["101"], baseRows: 1, joinedRows: 2, baseAmount: "120.00", joinedAmount: "240.00", delta: "120.00", issues: ["multiplied", "amount-changed"] });
});

test("matched preserves all details in base-first order despite joined ordering", () => {
  const result = run("102,80\n101,120", "101,120.00\n102,+80.000000");
  assert.equal(result.status, "matched");
  assert.equal(result.totalDelta, "0.00");
  assert.deepEqual(result.details.map((row) => row.key), [["102"], ["101"]]);
  assert.ok(result.details.every((row) => row.issues.length === 0));
});

test("missing and added keys cannot hide behind equal counts and totals", () => {
  const result = run("a,120\nb,80", "c,120\nb,80");
  assert.equal(result.status, "review");
  assert.equal(result.totalDelta, "0.00");
  assert.deepEqual(result.details.map((row) => row.key), [["a"], ["b"], ["c"]]);
  assert.deepEqual(result.details[0], { key: ["a"], baseRows: 1, joinedRows: 0, baseAmount: "120.00", joinedAmount: "0.00", delta: "-120.00", issues: ["missing"] });
  assert.deepEqual(result.details[2], { key: ["c"], baseRows: 0, joinedRows: 1, baseAmount: "0.00", joinedAmount: "120.00", delta: "120.00", issues: ["added"] });
  assert.deepEqual(result.counts, { multiplied: 0, missing: 1, added: 1, amountChanged: 0, baseDuplicates: 0 });
});

test("duplicate baseline is invalid even when perfectly equal", () => {
  const result = run("a,1\na,2\na,3\nb,1\nb,2", "a,1\na,2\na,3\nb,1\nb,2");
  assert.equal(result.status, "baseline-invalid");
  assert.equal(result.counts.baseDuplicates, 2);
  assert.equal(result.base.duplicateKeys, 2);
  assert.equal(result.counts.multiplied, 0);
  assert.deepEqual(result.details[0].issues, ["base-duplicate"]);
});

test("multiplication compares row counts to each baseline group", () => {
  const result = run("a,1\na,2\nb,0", "a,3\nb,0\nb,0");
  assert.equal(result.status, "baseline-invalid");
  assert.equal(result.counts.multiplied, 1);
  assert.equal(result.counts.amountChanged, 0);
  assert.deepEqual(result.details[1].issues, ["multiplied"]);
});

test("amount changes without fanout are detected", () => {
  const result = run("a,1", "a,1.000001");
  assert.equal(result.status, "review");
  assert.equal(result.counts.multiplied, 0);
  assert.equal(result.counts.amountChanged, 1);
  assert.equal(result.totalDelta, "0.000001");
  assert.deepEqual(result.details[0].issues, ["amount-changed"]);
});

test("cancelling per-key changes are detected with unchanged grand totals", () => {
  const result = run("a,100\nb,200", "a,90\nb,210");
  assert.equal(result.status, "review");
  assert.equal(result.counts.amountChanged, 2);
  assert.equal(result.totalDelta, "0.00");
  assert.deepEqual(result.details.map((row) => row.delta), ["-10.00", "10.00"]);
});

test("decimal arithmetic handles zero, negatives, six places and beyond Number precision", () => {
  const result = run("a,9007199254740993.000001\nb,-0.010000\nc,-0.000000", "a,9007199254740993.000002\nb,-0.010001\nc,+0");
  assert.equal(result.base.total, "9007199254740992.990001");
  assert.equal(result.joined.total, result.base.total);
  assert.equal(result.totalDelta, "0.00");
  assert.deepEqual(result.details.map((row) => row.delta), ["0.000001", "-0.000001", "0.00"]);
  assert.equal(result.details[1].baseAmount, "-0.01");
  assert.equal(result.details[2].baseAmount, "0.00");
});

test("accepts 30 integer digits and totals larger than one amount", () => {
  const value = "9".repeat(30) + ".999999";
  const result = run(`a,${value}\nb,${value}`, `a,${value}\nb,${value}`);
  assert.equal(result.base.total, "1999999999999999999999999999999.999998");
  assert.equal(run("a,  +001.230000  ", "a,1.23").status, "matched");
});

test("no amount selection never parses amounts and produces only null monetary fields", () => {
  const result = run("a,not money", "a,also not money\na,", { keys: ["id"], amount: null });
  assert.equal(result.base.total, null);
  assert.equal(result.joined.total, null);
  assert.equal(result.totalDelta, null);
  assert.equal(result.details[0].baseAmount, null);
  assert.equal(result.details[0].joinedAmount, null);
  assert.equal(result.details[0].delta, null);
  assert.deepEqual(result.details[0].issues, ["multiplied"]);
});

test("composite tuples cannot collide and dangerous object keys remain ordinary strings", () => {
  const base = parseCSV('a,b,amount\n"a|b",c,1\na,"b|c",2\n__proto__,constructor,3\n"[a,b]","x,y",4');
  const result = compare(base, base, { keys: ["a", "b"], amount: "amount" });
  assert.equal(result.status, "matched");
  assert.equal(result.base.keys, 4);
  const dangerous = run("__proto__,1\nconstructor,2\ntoString,3", "__proto__,1\nconstructor,2\ntoString,3");
  assert.equal(dangerous.base.keys, 3);
});

test("keys retain case, whitespace, leading zeros and literal NULL", () => {
  const base = table("A,1\na,2\n a,3\na ,4\n01,5\n1,6\nNULL,7");
  const result = compare(base, base, options);
  assert.equal(result.base.keys, 7);
  assert.deepEqual(result.details.map((row) => row.key[0]), ["A", "a", " a", "a ", "01", "1", "NULL"]);
});

test("header-only datasets are valid CSV but empty baselines are invalid", () => {
  assert.deepEqual(table(""), { headers: ["id", "amount"], rows: [] });
  assert.equal(run("", "").status, "baseline-invalid");
  const emptyBase = run("", "a,1");
  assert.equal(emptyBase.status, "baseline-invalid");
  assert.equal(emptyBase.counts.added, 1);
  assert.equal(emptyBase.base.total, "0.00");
  const emptyJoined = run("a,1", "");
  assert.equal(emptyJoined.status, "review");
  assert.equal(emptyJoined.counts.missing, 1);
  assert.equal(emptyJoined.totalDelta, "-1.00");
});

test("comparison does not mutate inputs, options or return input key arrays", () => {
  const base = table("a,1");
  const joined = table("a,2");
  for (const input of [base, joined]) {
    input.rows.forEach(Object.freeze);
    Object.freeze(input.rows);
    Object.freeze(input.headers);
    Object.freeze(input);
  }
  const selection = Object.freeze({ keys: Object.freeze(["id"]), amount: "amount" });
  const result = compare(base, joined, selection);
  result.details[0].key[0] = "changed";
  assert.equal(base.rows[0][0], "a");
});

test("CSV handles BOM, trimmed headers, quoted commas, escaped quotes and CRLF/newlines", () => {
  assert.deepEqual(parseCSV('\uFEFF id , note \r\n001,"first, ""quoted""\r\nsecond\nthird"\r\n002,  text  \n'), {
    headers: ["id", "note"],
    rows: [["001", 'first, "quoted"\r\nsecond\nthird'], ["002", "  text  "]]
  });
});

test("CSV skips blank physical lines but retains delimiter and quoted-empty records", () => {
  assert.deepEqual(parseCSV('\n  \r\nid,note\n\n,\n"",""\n \t \n1,"a\n\nb"\n'), {
    headers: ["id", "note"], rows: [["", ""], ["", ""], ["1", "a\n\nb"]]
  });
  assert.deepEqual(parseCSV('id\n""\n\n'), { headers: ["id"], rows: [[""]] });
});

test("CSV preserves trailing empty fields and final records without newlines", () => {
  assert.deepEqual(parseCSV("a,b\nx,"), { headers: ["a", "b"], rows: [["x", ""]] });
  assert.deepEqual(parseCSV("id"), { headers: ["id"], rows: [] });
  assert.deepEqual(parseCSV('id\n"a"'), { headers: ["id"], rows: [["a"]] });
});

for (const [name, text, pattern] of [
  ["empty input", "", /empty/i],
  ["only BOM and whitespace", "\uFEFF \n\t\r\n", /empty/i],
  ["duplicate headers", "id, id \nx,y", /Duplicate header/],
  ["blank header", "id, \nx,y", /Header must not be blank/],
  ["quoted blank header", '""\nx', /Header must not be blank/],
  ["too few fields", "a,b\nx", /Expected 2 fields, found 1/],
  ["too many fields", "a,b\nx,y,z", /Expected 2 fields, found 3/],
  ["unclosed quote", 'a,b\nx,"unfinished', /Unclosed/],
  ["quote within unquoted field", 'a,b\nx,y"z', /Quote must begin/],
  ["text after closing quote", 'a,b\nx,"y"z', /after closing quote/],
  ["space after closing quote", 'a,b\nx,"y" ', /after closing quote/],
  ["space before opening quote", 'a,b\nx, "y"', /Quote must begin/]
]) {
  test("CSV rejects " + name + " with dataset/record context", () => {
    assert.throws(() => parseCSV(text, "Upload"), (error) => error instanceof Error && /Upload, record \d+/.test(error.message) && pattern.test(error.message));
  });
}

test("CSV error includes column context", () => {
  assert.throws(() => parseCSV('a,b\nx,"y"x', "Joined file"), /Joined file, record 2, column 2/);
  assert.throws(() => parseCSV(null), /CSV: Expected CSV text/);
});

test("CSV does not guess alternate delimiters", () => {
  assert.deepEqual(parseCSV("id;amount\n1;2"), { headers: ["id;amount"], rows: [["1;2"]] });
  assert.deepEqual(parseCSV("id\tamount\n1\t2"), { headers: ["id\tamount"], rows: [["1\t2"]] });
});

test("CSV character limit is inclusive and includes BOM and trailing blank content", () => {
  const text = "id\n" + "x".repeat(limits.maxChars - 3);
  assert.equal(parseCSV(text).rows[0][0].length, limits.maxChars - 3);
  assert.throws(() => parseCSV(text + "\n"), /exceeds 1000000 characters/);
  assert.throws(() => parseCSV("\uFEFF" + text), /exceeds 1000000 characters/);
  assert.throws(() => parseCSV("id\n" + " ".repeat(limits.maxChars - 2)), /exceeds 1000000 characters/);
});

test("CSV row limit is inclusive, excludes headers/blanks, includes quoted empty records", () => {
  const text = "id\n" + "x\n".repeat(limits.maxRows);
  assert.equal(parseCSV(text + "\n  \n").rows.length, limits.maxRows);
  assert.throws(() => parseCSV(text + "x"), /exceeds 10000 data rows/);
  assert.throws(() => parseCSV(text + '""'), /exceeds 10000 data rows/);
  const quoted = 'id\n"' + "\n".repeat(limits.maxRows + 1) + '"';
  assert.equal(parseCSV(quoted).rows.length, 1);
});

test("CSV accepts 128 header-only columns and rejects 129 with contextual errors", () => {
  const headers = Array.from({ length: 128 }, (_, index) => "column" + index);
  assert.deepEqual(parseCSV(headers.join(",")), { headers, rows: [] });
  for (const ending of ["", "\n", "\r\n"]) {
    assert.throws(() => parseCSV(headers.join(",") + ",extra" + ending, "Wide upload"), /Wide upload, record 1, column 129: Record exceeds 128 columns/);
  }
});

test("CSV enforces 128 columns on every data record without counting quoted commas", () => {
  const headers = Array.from({ length: 128 }, (_, index) => "column" + index).join(",");
  const row = Array(128).fill('"a,b"').join(",");
  assert.deepEqual(parseCSV(headers + "\n" + row).rows, [Array(128).fill("a,b")]);
  for (const ending of ["", "\n", "\r\n"]) {
    assert.throws(() => parseCSV(headers + "\n" + row + "\n" + row + "," + ending, "Joined"), /Joined, record 3, column 129: Record exceeds 128 columns/);
  }
  assert.throws(() => parseCSV("id\n" + ",".repeat(128), "Delimited"), /Delimited, record 2, column 129: Record exceeds 128 columns/);
});

test("CSV rejects excess columns before parsing their trailing contents", () => {
  const headers = Array.from({ length: 128 }, (_, index) => "column" + index).join(",");
  assert.throws(() => parseCSV(headers + ',"unclosed', "Header"), /Header, record 1, column 129: Record exceeds 128 columns/);
  assert.throws(() => parseCSV(headers + "\n" + "x,".repeat(128) + '"unclosed', "Data"), /Data, record 2, column 129: Record exceeds 128 columns/);
});

test("compare validates the column limit on headers and data rows in both datasets", () => {
  const headers = Array.from({ length: 128 }, (_, index) => "column" + index);
  const valid = { headers, rows: [Array(128).fill("x")] };
  const selection = { keys: ["column0"], amount: null };
  assert.equal(compare(valid, valid, selection).status, "matched");
  assert.equal(compare({ headers, rows: [] }, valid, selection).status, "baseline-invalid");
  for (const [bad, record] of [
    [{ headers: [...headers, "extra"], rows: [] }, 1],
    [{ headers, rows: [Array(129).fill("x")] }, 2]
  ]) {
    assert.throws(() => compare(bad, valid, selection), new RegExp("Base, record " + record + ", column 129: Record exceeds 128 columns"));
    assert.throws(() => compare(valid, bad, selection), new RegExp("Joined, record " + record + ", column 129: Record exceeds 128 columns"));
  }
});

test("amount validation rejects blanks, non-decimals, unsupported precision and oversized integers", () => {
  for (const amount of ["", " ", "NULL", "NaN", "Infinity", "1e3", "$2", "1,000", "1.0000001", ".1", "1.", "+", "--1", "9".repeat(31)]) {
    const bad = { headers: ["id", "amount"], rows: [["a", amount]] };
    assert.throws(() => compare(bad, table("a,1"), options), /Base, record 2, column 2: Amount/);
    assert.throws(() => compare(table("a,1"), bad, options), /Joined, record 2, column 2: Amount/);
  }
});

test("selection validation rejects missing, duplicate and overlapping columns", () => {
  const base = table("a,1");
  for (const selection of [null, {}, { keys: [] }, { keys: "id" }, { keys: ["id", "id"] }, { keys: ["missing"] }, { keys: [null] }, { keys: ["id"], amount: "missing" }, { keys: ["id"], amount: "id" }, { keys: ["id"], amount: 1 }]) {
    assert.throws(() => compare(base, base, selection), /Selection:/);
  }
  assert.throws(() => compare(base, parseCSV("other,amount\na,1"), options), /must exist in both datasets/);
  assert.throws(() => compare(base, parseCSV("id,other\na,1"), options), /Amount column must exist in both/);
});

test("blank and whitespace-only keys are rejected rather than dropped", () => {
  for (const key of ["", " ", "\t", "\r\n"]) {
    const bad = { headers: ["id", "amount"], rows: [[key, "1"]] };
    assert.throws(() => compare(bad, table("a,1"), options), /Base, record 2, column 1: Key must not be blank/);
    assert.throws(() => compare(table("a,1"), bad, options), /Joined, record 2, column 1: Key must not be blank/);
  }
});

test("invalid table shapes and null cells are rejected explicitly", () => {
  for (const bad of [null, {}, { headers: [], rows: [] }, { headers: ["id", "id"], rows: [] }, { headers: [" "], rows: [] }, { headers: ["id"], rows: [[]] }, { headers: ["id"], rows: [[null]] }, { headers: ["id"], rows: [[123]] }]) {
    assert.throws(() => compare(bad, table("a,1"), options), /Base/);
  }
  assert.throws(() => compare({ headers: ["id"], rows: Array(limits.maxRows + 1).fill(["a"]) }, parseCSV("id\na"), { keys: ["id"] }), /exceeds 10000 data rows/);
});

test("sparse arrays are invalid rather than silently dropping rows or columns", () => {
  const base = table("a,1");
  for (const bad of [{ headers: Array(1), rows: [] }, { headers: ["id"], rows: Array(1) }, { headers: ["id"], rows: [Array(1)] }]) {
    assert.throws(() => compare(bad, base, options), /Base/);
  }
  assert.throws(() => compare(base, base, { keys: Array(1) }), /Selection:/);
});
