(function (root) {
  "use strict";

  const court = [[0, 0], [10, 0], [10, 20], [0, 20]];
  const colors = ["#d8f56a", "#ffab76", "#83d8ff", "#e4d5ff"];
  const limits = Object.freeze({ maxDuration: 60, netZoneMeters: 3 });
  const finite = (n) => typeof n === "number" && Number.isFinite(n);

  function homography(from, to) {
    const rows = from.flatMap(([x, y], i) => {
      const [u, v] = to[i];
      return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u],
        [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
    });
    for (let col = 0; col < 8; col++) {
      let pivot = col;
      for (let row = col + 1; row < 8; row++) {
        if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
      }
      if (Math.abs(rows[pivot][col]) < 1e-10) throw new Error("Court corners are too close or collinear.");
      [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
      const divisor = rows[col][col];
      rows[col] = rows[col].map((n) => n / divisor);
      for (let row = 0; row < 8; row++) {
        if (row === col) continue;
        const factor = rows[row][col];
        rows[row] = rows[row].map((n, i) => n - factor * rows[col][i]);
      }
    }
    return rows.map((row) => row[8]).concat(1);
  }

  function project(matrix, [x, y]) {
    const w = matrix[6] * x + matrix[7] * y + matrix[8];
    if (Math.abs(w) < 1e-10) throw new Error("This point cannot be mapped onto the court.");
    return [(matrix[0] * x + matrix[1] * y + matrix[2]) / w,
      (matrix[3] * x + matrix[4] * y + matrix[5]) / w];
  }

  function calibrate(corners) {
    if (!Array.isArray(corners) || corners.length !== 4 ||
      corners.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !finite(n) || n < 0 || n > 1))) {
      throw new Error("Calibration needs four video corners, each with normalized coordinates from 0 to 1.");
    }
    const turns = corners.map((a, i) => {
      const b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
      return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    });
    if (turns.some((n) => n < 0.0001)) {
      throw new Error("Select a convex court in order: far left, far right, near right, near left.");
    }
    return { toCourt: homography(corners, court), toVideo: homography(court, corners) };
  }

  function validate(data) {
    if (!data || data.version !== 1 || data.source !== "manual") {
      throw new Error("Expected a version 1 rally with manually marked positions.");
    }
    if (!finite(data.start) || data.start < 0 || !finite(data.duration) || data.duration < 1 || data.duration > limits.maxDuration) {
      throw new Error("Start must be nonnegative and rally duration must be between 1 and " + limits.maxDuration + " seconds.");
    }
    if (!Array.isArray(data.players) || data.players.length !== 4 ||
      data.players.some((p) => typeof p !== "string" || !p.trim() || p.length > 40) ||
      new Set(data.players.map((p) => p.trim())).size !== 4) {
      throw new Error("Use four distinct player names, each 1 to 40 characters.");
    }
    if (!Array.isArray(data.frames) || data.frames.length > 2401) throw new Error("Use at most 2,401 keyframes.");
    let last = -1;
    for (const frame of data.frames) {
      if (!frame || !finite(frame.t) || frame.t < 0 || frame.t > data.duration || frame.t <= last) {
        throw new Error("Keyframe times must be unique, increasing, and inside the rally.");
      }
      if (!Array.isArray(frame.positions) || frame.positions.length !== 4 ||
        frame.positions.some((p) => !Array.isArray(p) || p.length !== 2 ||
          !finite(p[0]) || !finite(p[1]) || p[0] < 0 || p[0] > 10 || p[1] < 0 || p[1] > 20)) {
        throw new Error("Each keyframe needs four positions: x from 0 to 10 m, y from 0 to 20 m.");
      }
      last = frame.t;
    }
    if (data.calibration != null) calibrate(data.calibration);
    if (data.media != null && (typeof data.media.name !== "string" || data.media.name.length > 255 ||
      !finite(data.media.duration) || data.media.duration <= 0 ||
      data.start + data.duration > data.media.duration + 0.05)) {
      throw new Error("Video metadata is invalid or the rally extends beyond the video.");
    }
    return data;
  }

  function validateVideo(data, media) {
    validate(data);
    if (!media || !finite(media.duration) || media.duration < 1 || media.duration > limits.maxDuration) {
      throw new Error("The excerpt must have a finite duration between 1 and " + limits.maxDuration + " seconds.");
    }
    if (Math.abs(data.duration - media.duration) > 0.1) {
      throw new Error("This video does not match the selected " + data.duration + "-second rally excerpt.");
    }
    if (!finite(media.width) || !finite(media.height) || media.width <= 0 || media.height <= 0 ||
      Math.abs(media.width / media.height - 16 / 9) > 0.001) {
      throw new Error("The source video must use the 16:9 camera view matching the court calibration.");
    }
  }

  function validateMatch(match) {
    if (!match || !finite(match.duration) || match.duration < 1 ||
      !Array.isArray(match.rallies) || !match.rallies.length) {
      throw new Error("A match needs its source duration and at least one curated rally.");
    }
    const ids = new Set();
    let previousEnd = 0;
    for (const rally of match.rallies) {
      validate(rally);
      if (typeof rally.id !== "string" || !rally.id.trim() || ids.has(rally.id) ||
        typeof rally.title !== "string" || !rally.title.trim()) {
        throw new Error("Each rally needs a unique ID and a title.");
      }
      ids.add(rally.id);
      if (typeof rally.video !== "string" || !/^assets\/padel-[a-z0-9-]+\.mp4$/.test(rally.video)) {
        throw new Error("Each rally needs a local, publishable MP4 excerpt.");
      }
      if (rally.start < previousEnd || rally.start + rally.duration > match.duration) {
        throw new Error("Curated rallies must be chronological, non-overlapping and inside the source video.");
      }
      previousEnd = rally.start + rally.duration;
      if (!rally.calibration || rally.frames.length < 2 || rally.frames[0].t !== 0 ||
        rally.frames[rally.frames.length - 1].t !== rally.duration) {
        throw new Error("Each curated rally needs calibration and position samples covering its entire excerpt.");
      }
      if (rally.players.some((name, i) => name !== match.rallies[0].players[i])) {
        throw new Error("Player identities and order must stay consistent across curated rallies.");
      }
      if (!Array.isArray(rally.moments)) throw new Error("Each rally needs a key-moments array.");
      let previousTime = -1;
      for (const moment of rally.moments) {
        if (!moment || !finite(moment.time) || moment.time < 0 || moment.time > rally.duration ||
          moment.time <= previousTime || typeof moment.label !== "string" || !moment.label.trim() ||
          typeof moment.description !== "string" || !moment.description.trim()) {
          throw new Error("Key moments need labels, descriptions and unique increasing times inside the rally.");
        }
        previousTime = moment.time;
      }
    }
    return match;
  }

  function rallyTime(data, sourceTime) {
    return Math.max(0, Math.min(data.duration, sourceTime - data.start));
  }

  function sourceTime(data, time) {
    return data.start + Math.max(0, Math.min(data.duration, time));
  }

  function position(frames, t, player) {
    if (!frames.length || t < frames[0].t || t > frames[frames.length - 1].t) return null;
    let left = 0, right = frames.length - 1;
    while (left < right) {
      const middle = Math.floor((left + right) / 2);
      if (frames[middle].t < t) left = middle + 1;
      else right = middle;
    }
    const b = frames[right];
    if (right === 0 || b.t === t) return b.positions[player].slice();
    const a = frames[right - 1], fraction = (t - a.t) / (b.t - a.t);
    return a.positions[player].map((n, axis) => n + (b.positions[player][axis] - n) * fraction);
  }

  function trail(frames, t, player) {
    const result = frames.filter((frame) => frame.t <= t).map((frame) => frame.positions[player]);
    const point = position(frames, t, player);
    if (point && !frames.some((frame) => frame.t === t)) result.push(point);
    return result;
  }

  function metrics(frames, t, player) {
    const points = trail(frames, t, player);
    let distance = 0;
    for (let i = 1; i < points.length; i++) {
      distance += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    const seconds = frames.length ? Math.max(0, Math.min(t, frames[frames.length - 1].t) - frames[0].t) : 0;
    return { distance, seconds };
  }

  function heat(frames, t, player) {
    const cells = new Map();
    if (frames.length < 2) return [];
    const end = Math.min(t, frames[frames.length - 1].t);
    for (let at = frames[0].t; at < end; at += 0.25) {
      const weight = Math.min(0.25, end - at);
      const p = position(frames, at + weight / 2, player);
      const x = Math.min(9, Math.floor(p[0])), y = Math.min(19, Math.floor(p[1]));
      const key = x + "," + y;
      const cell = cells.get(key) || { x: x + 0.5, y: y + 0.5, seconds: 0 };
      cell.seconds += weight;
      cells.set(key, cell);
    }
    return Array.from(cells.values());
  }

  function netTime(frames, t, player) {
    let seconds = 0;
    const low = 10 - limits.netZoneMeters, high = 10 + limits.netZoneMeters;
    for (let i = 1; i < frames.length && frames[i - 1].t < t; i++) {
      const a = frames[i - 1], b = frames[i];
      const end = Math.min(t, b.t), span = end - a.t;
      const y = a.positions[player][1];
      const change = (b.positions[player][1] - y) * span / (b.t - a.t);
      if (change === 0) {
        if (y >= low && y <= high) seconds += span;
      } else {
        const first = (low - y) / change, last = (high - y) / change;
        const enter = Math.max(0, Math.min(first, last));
        const exit = Math.min(1, Math.max(first, last));
        seconds += Math.max(0, exit - enter) * span;
      }
    }
    return seconds;
  }

  function summarizeRally(rally) {
    validate(rally);
    return rally.players.map((name, i) => ({
      name,
      ...metrics(rally.frames, rally.duration, i),
      netSeconds: netTime(rally.frames, rally.duration, i)
    }));
  }

  function summarizeMatch(match) {
    validateMatch(match);
    const summaries = match.rallies.map(summarizeRally);
    const seconds = match.rallies.reduce((total, rally) => total + rally.duration, 0);
    return {
      rallyCount: match.rallies.length,
      seconds,
      sourceSeconds: match.duration,
      coverage: seconds / match.duration,
      players: summaries[0].map((player, i) => ({
        name: player.name,
        distance: summaries.reduce((total, summary) => total + summary[i].distance, 0),
        seconds: summaries.reduce((total, summary) => total + summary[i].seconds, 0),
        netSeconds: summaries.reduce((total, summary) => total + summary[i].netSeconds, 0)
      }))
    };
  }

  const api = { colors, limits, calibrate, project, validate, validateVideo, validateMatch,
    rallyTime, sourceTime, position, trail, metrics, heat, netTime, summarizeRally, summarizeMatch };
  root.Padel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
