"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const P = require("../assets/padel.js");
require("../assets/padel-rally-data.js");
const match = global.PadelMatch, firstRally = match.rallies[0];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const positions = (x, y) => Array.from({ length: 4 }, () => [x, y]);
const frames = [{ t: 2, positions: positions(1, 1) }, { t: 4, positions: positions(4, 5) },
  { t: 6, positions: positions(4, 8) }];
const rally = () => ({ version: 1, source: "manual", start: 20, duration: 10,
  players: ["A", "B", "C", "D"], frames: structuredClone(frames) });

test("engine has the same browser and Node API; curated tracks cover the exact excerpt", () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "assets", "padel.js"), "utf8"), browser);
  assert.deepEqual(Object.keys(browser.Padel), Object.keys(P));
  const data = firstRally;
  assert.equal(data.source, "manual");
  assert.equal(data.duration, 15);
  assert.equal(data.start, 60.5);
  assert.equal(data.frames.length, 31);
  assert.equal(data.frames.at(-1).t, data.duration);
  assert.equal(P.validate(data), data);
  data.frames.forEach((frame, i) => assert.equal(frame.t, i * 0.5));
  for (let i = 0; i < 4; i++) {
    near(P.heat(data.frames, 15, i).reduce((sum, c) => sum + c.seconds, 0), 15);
    assert.ok(P.metrics(data.frames, 15, i).distance > 0);
  }
});

test("interpolation uses elapsed time, exact points, and never extrapolates", () => {
  assert.deepEqual(P.position(frames, 3, 0), [2.5, 3]);
  assert.deepEqual(P.position(frames, 4, 0), [4, 5]);
  assert.deepEqual(P.position(frames, 6, 0), [4, 8]);
  assert.equal(P.position(frames, 1.9, 0), null);
  assert.equal(P.position(frames, 6.1, 0), null);
  assert.equal(P.position([], 3, 0), null);
  assert.deepEqual(P.position([frames[0]], 2, 0), [1, 1]);
});

test("distance includes partial segments, no pre-span time, and no overrun", () => {
  assert.deepEqual(P.metrics(frames, 1, 0), { distance: 0, seconds: 0 });
  assert.deepEqual(P.metrics(frames, 2, 0), { distance: 0, seconds: 0 });
  assert.deepEqual(P.metrics(frames, 3, 0), { distance: 2.5, seconds: 1 });
  assert.deepEqual(P.metrics(frames, 5, 0), { distance: 6.5, seconds: 3 });
  assert.deepEqual(P.metrics(frames, 30, 0), { distance: 8, seconds: 4 });
  assert.deepEqual(P.metrics([], 30, 0), { distance: 0, seconds: 0 });
  assert.deepEqual(P.metrics([frames[0]], 30, 0), { distance: 0, seconds: 0 });
  assert.equal(P.trail(frames, 4, 0).length, 2);
});

test("stationary positions have zero distance and time-weighted heat", () => {
  const still = [{ t: 0, positions: positions(10, 20) }, { t: 2, positions: positions(10, 20) }];
  assert.equal(P.metrics(still, 2, 0).distance, 0);
  assert.deepEqual(P.heat(still, 1.1, 0), [{ x: 9.5, y: 19.5, seconds: 1.1 }]);
  assert.deepEqual(P.heat(still, 0, 0), []);
  near(P.heat(still, 10, 0).reduce((sum, cell) => sum + cell.seconds, 0), 2);
});

test("heat conserves covered seconds and is independent of annotation density", () => {
  near(P.heat(frames, 5.13, 0).reduce((sum, c) => sum + c.seconds, 0), 3.13);
  const extra = [frames[0], { t: 3, positions: positions(2.5, 3) }, frames[1], frames[2]];
  assert.deepEqual(P.heat(extra, 5, 0), P.heat(frames, 5, 0));
  assert.deepEqual(P.heat(frames, 1, 0), []);
  assert.deepEqual(P.heat([frames[0]], 5, 0), []);
});

test("perspective transform maps corners and round-trips interior positions", () => {
  const corners = [[0.27, 0.18], [0.73, 0.18], [0.9, 0.86], [0.1, 0.86]];
  const calibration = P.calibrate(corners);
  const target = [[0, 0], [10, 0], [10, 20], [0, 20]];
  corners.forEach((point, i) => P.project(calibration.toCourt, point).forEach((n, axis) => near(n, target[i][axis])));
  for (const p of [[2.5, 7], [9.1, 18.2], [5, 10]]) {
    const result = P.project(calibration.toCourt, P.project(calibration.toVideo, p));
    result.forEach((n, axis) => near(n, p[axis]));
  }
});

test("calibration rejects crossed, degenerate, reversed and malformed corners", () => {
  for (const corners of [[], [[0, 0], [1, 1], [1, 0], [0, 1]],
    [[0, 0], [0.2, 0], [0.4, 0], [0.6, 0]], [[0, 0], [0, 1], [1, 1], [1, 0]],
    [[0, 0], [1, 0], [1, NaN], [0, 1]], [[0, 0], [2, 0], [1, 1], [0, 1]]]) {
    assert.throws(() => P.calibrate(corners));
  }
  assert.throws(() => P.project([1, 0, 0, 0, 1, 0, 0, 0, 0], [1, 1]));
});

test("schema rejects invalid provenance, times, duplicate frames, names and coordinates", () => {
  const changes = [
    { version: 2 }, { source: "AI" }, { start: -1 }, { start: NaN }, { duration: 60.001 }, { duration: 0 },
    { duration: "10" }, { players: ["A", "A", "C", "D"] }, { players: ["A", " A ", "C", "D"] },
    { players: ["", "B", "C", "D"] }, { players: ["A".repeat(41), "B", "C", "D"] },
    { frames: [frames[1], frames[0]] }, { frames: [frames[0], frames[0]] },
    { frames: [{ t: 11, positions: positions(1, 1) }] },
    { frames: [{ t: 1, positions: positions(-1, 1) }] },
    { frames: [{ t: 1, positions: positions(1, 21) }] },
    { frames: [{ t: 1, positions: positions(null, 1) }] },
    { frames: [{ t: 1, positions: positions(Infinity, 1) }] },
    { frames: [{ t: 1, positions: [[1, 1]] }] },
    { frames: Array(2402).fill(frames[0]) },
    { media: { name: "video.mp4", duration: 25 } }, { calibration: [] }
  ];
  for (const change of changes) assert.throws(() => P.validate({ ...rally(), ...change }));
  assert.throws(() => P.validate({ ...rally(), source: "simulated" }));
});

test("video experience has real footage and no upload or annotation workspace", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "padel-rally.html"), "utf8");
  assert.match(html, /<video[^>]+src="assets\/padel-changing-sides\.mp4"/);
  assert.doesNotMatch(html, /src="assets\/padel-match\.mp4"/);
  assert.doesNotMatch(html, /Bring your own rally|type="file"|pr-workbench|pr-frame-form/);
  assert.ok(html.indexOf('src="assets/padel.js"') < html.indexOf('src="assets/padel-rally-data.js"'));
  assert.ok(html.indexOf('src="assets/padel-rally-data.js"') < html.indexOf('src="assets/padel-ui.js"'));
});

test("manual marks round-trip onto the actual reference pixels", () => {
  const data = firstRally, matrix = P.calibrate(data.calibration).toVideo;
  const first = [[140, 217], [332, 213], [263, 89], [286, 110]];
  first.forEach(([x, y], player) => {
    const point = P.project(matrix, data.frames[0].positions[player]);
    near(point[0] * 500, x);
    near(point[1] * 281.25, y);
  });
});

test("empty manual sets, interval endpoints and JSON round-trips are valid", () => {
  assert.doesNotThrow(() => P.validate({ ...rally(), frames: [] }));
  const data = { ...rally(), media: { name: "match.mp4", duration: 30 },
    frames: [{ t: 0, positions: positions(0, 0) }, { t: 10, positions: positions(10, 20) }] };
  const restored = P.validate(JSON.parse(JSON.stringify(data)));
  assert.deepEqual(restored, data);
  assert.equal(P.position(restored.frames, 10, 3)[1], 20);
});

test("supports the full 60-second boundary without extending or inflating measurements", () => {
  assert.equal(P.limits.maxDuration, 60);
  const data = P.validate({ ...rally(), start: 0, duration: 60,
    frames: [{ t: 0, positions: positions(0, 0) }, { t: 60, positions: positions(6, 8) }] });
  assert.deepEqual(P.position(data.frames, 30, 0), [3, 4]);
  assert.deepEqual(P.metrics(data.frames, 60, 0), { distance: 10, seconds: 60 });
  assert.deepEqual(P.metrics(data.frames, 61, 0), { distance: 10, seconds: 60 });
  near(P.heat(data.frames, 60, 0).reduce((sum, cell) => sum + cell.seconds, 0), 60);
  assert.doesNotThrow(() => P.validateVideo(data, { duration: 60, width: 1280, height: 720 }));
  assert.throws(() => P.validate({ ...data, duration: 60.001 }), /between 1 and 60/);
});

test("published clips match rally duration and cannot include the full match", () => {
  const data = { ...rally(), duration: 60 };
  for (const duration of [0, NaN, Infinity, "2400", 60.001, 2400]) {
    assert.throws(() => P.validateVideo(data, { duration, width: 1280, height: 720 }), /finite duration/);
  }
  assert.doesNotThrow(() => P.validateVideo(data, { duration: 60, width: 1920, height: 1080 }));
  assert.throws(() => P.validateVideo({ ...data, duration: 60.001 }, { duration: 2400, width: 1280, height: 720 }), /between 1 and 60/);
  assert.throws(() => P.validateVideo(data, { duration: 59.8, width: 1280, height: 720 }), /does not match/);
  assert.throws(() => P.validateVideo(data, { duration: 60, width: 800, height: 600 }), /16:9/);
  assert.throws(() => P.validateVideo(data, { duration: 60, width: NaN, height: 720 }), /16:9/);
  assert.doesNotThrow(() => P.validateVideo(firstRally, { duration: 15, width: 1280, height: 720 }));
});

function playbackHarness({ duration = 60, videoDuration, catalog } = {}) {
  const fixture = catalog || { duration: 120, rallies: [{ ...firstRally, duration, start: 30,
    moments: [{ time: Math.min(5, duration), label: "Test moment", description: "A manually labeled moment." }],
    frames: [{ t: 0, positions: positions(0, 0) }, { t: duration, positions: positions(6, 8) }] }] };
  const baseURI = "http://preview.test/padel-rally.html";
  const ctx = new Proxy({
    measureText: () => ({ width: 100 }),
    createRadialGradient: () => ({ addColorStop() {} })
  }, { get: (target, key) => target[key] || (() => {}) });
  function element() {
    return {
      textContent: "", children: [], attributes: {}, listeners: {}, checked: true,
      style: { setProperty() {} },
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key] || null; },
      addEventListener(type, handler) { (this.listeners[type] ||= []).push(handler); },
      fire(type) { return Promise.all((this.listeners[type] || []).map((handler) => handler())); },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      getContext: () => ctx
    };
  }
  const nodes = new Map(), get = (id) => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const durationLabels = [element(), element()], countLabels = [element(), element()];
  const video = get("pr-video");
  video.attributes.src = fixture.rallies[0].video;
  Object.defineProperty(video, "src", {
    get() { return this.attributes.src; },
    set(value) { this.attributes.src = value; }
  });
  let frameCallback;
  Object.assign(video, {
    duration: videoDuration === undefined ? fixture.rallies[0].duration : videoDuration,
    currentSrc: new URL(fixture.rallies[0].video, baseURI).href,
    videoWidth: 1280, videoHeight: 720, readyState: 2, paused: true, currentTime: 0,
    load() {
      this.currentSrc = new URL(this.src, baseURI).href;
      this.currentTime = 0;
      this.readyState = 1;
      this.duration = videoDuration === undefined ? fixture.rallies.find((rally) => rally.video === this.src).duration : videoDuration;
    },
    pause() { const wasPlaying = !this.paused; this.paused = true; if (wasPlaying) this.fire("pause"); },
    play() { this.paused = false; this.fire("play"); return Promise.resolve(); },
    requestVideoFrameCallback(callback) { frameCallback = callback; return 1; },
    cancelVideoFrameCallback() { frameCallback = null; }
  });
  const document = Object.assign(element(), {
      getElementById: get,
      createElement: element,
      querySelectorAll: (selector) => selector === "[data-rally-duration]" ? durationLabels : countLabels,
      baseURI,
      fullscreenElement: null,
      async exitFullscreen() { this.fullscreenElement = null; await this.fire("fullscreenchange"); }
  });
  get("pr-app").requestFullscreen = async function () {
    document.fullscreenElement = this;
    await document.fire("fullscreenchange");
  };
  const browser = {
    Padel: P,
    PadelMatch: fixture,
    URL,
    document,
    addEventListener() {},
    cancelAnimationFrame() {}
  };
  browser.window = browser;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "assets", "padel-ui.js"), "utf8"), browser);
  video.fire("seeked");
  return { get, video, document, durationLabels, countLabels,
    load() {
      video.fire("loadedmetadata");
      video.readyState = 2;
      video.fire("loadeddata");
      video.fire("seeked");
    },
    frame(time) { video.currentTime = time; frameCallback(0, { mediaTime: time }); } };
}

test("60-second UI updates its timeline, labels, playback endpoint and replay", async () => {
  const ui = playbackHarness(), get = (id) => ui.get("pr-" + id);
  assert.equal(get("time").max, 60);
  assert.equal(get("clock").textContent, "0.0 / 60.0 s");
  assert.equal(get("play").disabled, false);
  assert.ok(ui.durationLabels.every((node) => node.textContent === 60));
  assert.ok(ui.countLabels.every((node) => node.textContent === 2));
  assert.match(ui.video.attributes["aria-label"], /^60-second/);
  get("time").value = "45.2";
  get("time").fire("input");
  ui.video.fire("seeked");
  assert.equal(ui.video.currentTime, 45.2);
  assert.equal(get("clock").textContent, "45.2 / 60.0 s");
  assert.equal(get("time").attributes["aria-valuetext"], "45.2 of 60 seconds");
  await ui.video.play();
  ui.frame(59);
  assert.equal(ui.video.paused, false);
  ui.frame(60);
  assert.equal(ui.video.paused, true);
  assert.equal(get("clock").textContent, "60.0 / 60.0 s");
  assert.equal(get("recap").hidden, false);
  get("replay").fire("click");
  ui.video.fire("seeked");
  assert.equal(ui.video.currentTime, 0);
  assert.equal(get("clock").textContent, "0.0 / 60.0 s");
  assert.equal(get("recap").hidden, true);
});

test("UI refuses mismatched source metadata instead of stretching or misaligning tracks", () => {
  for (const videoDuration of [15, 59.8, 60.2, NaN, Infinity]) {
    const ui = playbackHarness({ videoDuration });
    assert.equal(ui.get("pr-play").disabled, true);
    assert.equal(ui.get("pr-time").disabled, true);
    assert.equal(ui.get("pr-error").hidden, false);
    assert.match(ui.get("pr-error").textContent, /does not match|finite duration/);
    assert.equal(ui.get("pr-players").children[0].children[1].textContent, "--");
  }
  assert.throws(() => playbackHarness({ duration: 60.001 }), /between 1 and 60/);
});

test("source and rally clocks clamp at each excerpt boundary", () => {
  assert.equal(P.rallyTime(firstRally, 0), 0);
  assert.equal(P.rallyTime(firstRally, 63), 2.5);
  assert.equal(P.rallyTime(firstRally, 76), 15);
  assert.equal(P.sourceTime(firstRally, -1), 60.5);
  assert.equal(P.sourceTime(firstRally, 8), 68.5);
  assert.equal(P.sourceTime(firstRally, 16), 75.5);
});

test("net time integrates boundary crossings and does not extrapolate", () => {
  const crossing = [{ t: 2, positions: positions(5, 0) }, { t: 12, positions: positions(5, 20) }];
  assert.equal(P.limits.netZoneMeters, 3);
  near(P.netTime(crossing, 20, 0), 3);
  near(P.netTime(crossing, 7, 0), 1.5);
  near(P.netTime(crossing, 3, 0), 0);
  near(P.netTime(crossing, 1, 0), 0);
  const reverse = [{ t: 0, positions: positions(5, 20) }, { t: 10, positions: positions(5, 0) }];
  near(P.netTime(reverse, 10, 0), 3);
  for (const y of [7, 10, 13]) {
    near(P.netTime([{ t: 0, positions: positions(5, y) }, { t: 10, positions: positions(5, y) }], 10, 0), 10);
  }
  near(P.netTime([{ t: 0, positions: positions(5, 6.99) }, { t: 10, positions: positions(5, 6.99) }], 10, 0), 0);
  assert.equal(P.netTime([], 20, 0), 0);
  assert.equal(P.netTime([crossing[0]], 20, 0), 0);
});

test("match summaries count only distinct annotated time and never bridge gaps", () => {
  const a = { ...firstRally, id: "a", start: 100, duration: 10, moments: [],
    frames: [{ t: 0, positions: positions(0, 10) }, { t: 10, positions: positions(0, 10) }] };
  const b = { ...firstRally, id: "b", start: 400, duration: 20, moments: [],
    frames: [{ t: 0, positions: positions(10, 0) }, { t: 20, positions: positions(10, 0) }] };
  const result = P.summarizeMatch({ duration: 1000, rallies: [a, b] });
  assert.equal(result.rallyCount, 2);
  assert.equal(result.seconds, 30);
  near(result.coverage, 0.03);
  result.players.forEach((p) => {
    assert.equal(p.distance, 0);
    assert.equal(p.netSeconds, 10);
    assert.equal(p.seconds, 30);
    near(p.netSeconds / p.seconds, 1 / 3);
  });
  const actual = P.summarizeMatch(match);
  assert.equal(actual.rallyCount, 3);
  assert.equal(actual.seconds, 38);
  actual.players.forEach((p, i) => {
    near(p.distance, match.rallies.reduce((sum, r) => sum + P.metrics(r.frames, r.duration, i).distance, 0));
    assert.ok(p.netSeconds >= 0 && p.netSeconds <= p.seconds);
  });
});

test("catalog rejects overlap, incomplete coverage, identity changes and invalid markers", () => {
  const cases = [
    (m) => { m.rallies[1].start = 70; },
    (m) => { m.rallies[1].id = m.rallies[0].id; },
    (m) => { m.rallies[1].frames.shift(); },
    (m) => { m.rallies[1].frames.pop(); },
    (m) => { m.rallies[1].players.reverse(); },
    (m) => { m.rallies[1].moments[0].time = 61; },
    (m) => { m.rallies[1].moments[1].time = m.rallies[1].moments[0].time; },
    (m) => { m.rallies[1].moments[0].description = ""; },
    (m) => { m.rallies[1].calibration = null; },
    (m) => { m.rallies[1].video = "https://example.com/full-match.mp4"; },
    (m) => { m.duration = 100; }
  ];
  for (const modify of cases) {
    const invalid = structuredClone(match);
    modify(invalid);
    assert.throws(() => P.validateMatch(invalid));
  }
});

test("rally switching loads separate clips and keeps original timestamps as metadata only", () => {
  const ui = playbackHarness({ catalog: match }), get = (id) => ui.get("pr-" + id);
  get("moment-buttons").children[0].fire("click");
  ui.video.fire("seeked");
  assert.equal(ui.video.currentTime, 2.5);
  assert.equal(get("clock").textContent, "2.5 / 15.0 s");
  assert.equal(get("moment-note").textContent, firstRally.moments[0].description);
  get("next").fire("click");
  ui.load();
  assert.equal(ui.video.currentTime, 0);
  assert.equal(ui.video.src, match.rallies[1].video);
  assert.equal(ui.video.duration, 16);
  assert.match(get("range-note").textContent, /1:20.0/);
  assert.equal(get("time").max, 16);
  assert.equal(get("recap").hidden, true);
  assert.equal(get("moment-note").textContent, "");
  assert.equal(get("coverage").children[1].children[0].textContent, "38.0 s");
  get("next").fire("click");
  ui.load();
  assert.equal(ui.video.currentTime, 0);
  assert.equal(ui.video.src, match.rallies[2].video);
  assert.equal(get("next").disabled, true);
  assert.equal(get("time").max, 7);
  get("previous").fire("click");
  ui.load();
  assert.equal(ui.video.currentTime, 0);
  assert.equal(ui.video.src, match.rallies[1].video);
});

test("stale media events cannot activate overlays for a newly selected clip", () => {
  const ui = playbackHarness({ catalog: match }), get = (id) => ui.get("pr-" + id);
  get("next").fire("click");
  get("next").fire("click");
  const currentSrc = ui.video.currentSrc;
  ui.video.currentSrc = new URL(match.rallies[1].video, ui.document.baseURI).href;
  ui.video.fire("loadedmetadata");
  ui.video.readyState = 2;
  ui.video.fire("seeked");
  assert.equal(get("play").disabled, true);
  ui.video.currentSrc = currentSrc;
  ui.load();
  assert.equal(get("play").disabled, false);
  assert.equal(get("clock").textContent, "0.0 / 7.0 s");
});

test("every published clip exists and the full-match file stays excluded", () => {
  for (const rally of match.rallies) {
    const file = path.join(__dirname, "..", rally.video);
    assert.ok(fs.statSync(file).size > 0);
    const header = Buffer.alloc(12), fd = fs.openSync(file, "r");
    try { fs.readSync(fd, header, 0, header.length, 0); }
    finally { fs.closeSync(fd); }
    assert.equal(header.toString("ascii", 4, 8), "ftyp");
    assert.notEqual(rally.video, "assets/padel-match.mp4");
  }
  assert.match(fs.readFileSync(path.join(__dirname, "..", ".gitignore"), "utf8"), /^assets\/padel-match\.mp4$/m);
});

test("fullscreen targets the complete explorer and handles permission errors visibly", async () => {
  const ui = playbackHarness(), get = (id) => ui.get("pr-" + id);
  await get("fullscreen").fire("click");
  assert.equal(ui.document.fullscreenElement, get("app"));
  assert.equal(get("fullscreen").textContent, "Exit fullscreen");
  await get("fullscreen").fire("click");
  assert.equal(ui.document.fullscreenElement, null);
  get("app").requestFullscreen = async () => { throw new Error("Denied"); };
  await get("fullscreen").fire("click");
  assert.match(get("error").textContent, /Denied/);
  assert.equal(get("error").hidden, false);
  assert.equal(get("play").disabled, false);
});
