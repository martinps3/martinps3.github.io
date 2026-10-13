(function () {
  "use strict";

  const P = window.Padel, match = P.validateMatch(window.PadelMatch), $ = (id) => document.getElementById("pr-" + id);
  const video = $("video"), overlay = $("overlay"), map = $("map");
  let index = 0, data = match.rallies[0], projection = P.calibrate(data.calibration);
  let time = 0, selected = -1, ready = false, frameRequest = null, animationRequest = null;
  let mediaReady = false, seekTarget = null, resumeAfterSeek = false, completed = false;
  const cards = [];
  let momentButtons = [];
  const sourceClock = (seconds) => Math.floor(seconds / 60) + ":" + (seconds % 60).toFixed(1).padStart(4, "0");
  const clipTime = (value) => Math.max(0, Math.min(data.duration, value));
  const expectedVideo = () => new URL(data.video, document.baseURI).href;

  function showError(message) {
    $("error").textContent = message;
    $("error").hidden = false;
  }
  function summaryRows(target, players) {
    target.replaceChildren();
    players.forEach((player) => {
      const row = document.createElement("tr"), name = document.createElement("th");
      name.scope = "row";
      name.textContent = player.name;
      row.append(name);
      [player.distance.toFixed(1) + " m", player.netSeconds.toFixed(1) + " s",
        (player.seconds ? player.netSeconds / player.seconds * 100 : 0).toFixed(1) + "%"].forEach((text) => {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      });
      target.append(row);
    });
  }
  function renderMatchSummary() {
    const summary = P.summarizeMatch(match);
    summaryRows($("match-body"), summary.players);
    $("coverage").replaceChildren();
    [[summary.rallyCount, "rally excerpts reviewed"], [summary.seconds.toFixed(1) + " s", "annotated footage"],
      [sourceClock(summary.sourceSeconds), "source video duration"], [(summary.coverage * 100).toFixed(1) + "%", "of source video covered"]]
      .forEach(([value, label]) => {
        const item = document.createElement("div"), number = document.createElement("strong"), text = document.createElement("span");
        number.textContent = value;
        text.textContent = label;
        item.append(number, text);
        $("coverage").append(item);
      });
  }
  function updateAvailability() {
    $("play").disabled = !ready;
    $("replay").disabled = !mediaReady;
    $("time").disabled = !mediaReady;
    $("previous").disabled = index === 0;
    $("next").disabled = index === match.rallies.length - 1;
    $("recap-next").hidden = index === match.rallies.length - 1;
    momentButtons.forEach((button) => { button.disabled = !mediaReady; });
  }
  function populateRally() {
    $("rally-select").value = data.id;
    $("time").max = data.duration;
    $("range-note").textContent = "Excerpt " + (index + 1) + " of " + match.rallies.length +
      " / source " + sourceClock(data.start) + " to " + sourceClock(data.start + data.duration) +
      " / " + data.duration + " seconds analyzed";
    $("stage-title").textContent = data.title;
    video.setAttribute("aria-label", data.duration + "-second excerpt: " + data.title);
    document.querySelectorAll("[data-rally-duration]").forEach((element) => { element.textContent = data.duration; });
    document.querySelectorAll("[data-rally-frame-count]").forEach((element) => { element.textContent = data.frames.length; });
    $("moment-buttons").replaceChildren();
    momentButtons = data.moments.map((moment) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = moment.time.toFixed(1) + "s / " + moment.label;
      button.setAttribute("aria-label", "Jump to " + moment.label + " at " + moment.time.toFixed(1) + " seconds");
      button.addEventListener("click", () => {
        seekRelative(moment.time);
        $("moment-note").textContent = moment.description;
      });
      $("moment-buttons").append(button);
      return button;
    });
    $("recap-caption").textContent = data.title + " / estimated totals for " + data.duration + " seconds";
    summaryRows($("recap-body"), P.summarizeRally(data));
    updateAvailability();
  }

  function selectRally(nextIndex) {
    if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= match.rallies.length) {
      showError("That rally is not available in the curated catalog.");
      return;
    }
    video.pause();
    stopFrames();
    resumeAfterSeek = false;
    index = nextIndex;
    data = match.rallies[index];
    projection = P.calibrate(data.calibration);
    time = 0;
    ready = false;
    completed = false;
    seekTarget = null;
    $("moment-note").textContent = "";
    $("playback-status").textContent = "";
    populateRally();
    loadVideo();
  }

  function loadVideo() {
    ready = false;
    mediaReady = false;
    $("error").hidden = true;
    $("video-message").textContent = "Loading selected rally...";
    $("video-message").hidden = false;
    updateAvailability();
    if (video.getAttribute("src") !== data.video) {
      video.src = data.video;
      video.load();
    } else if (video.readyState >= 1) {
      initialize();
    }
    render();
  }

  function seekRelative(value, resume = false) {
    if (!mediaReady) { showError("The source video must load before seeking."); return; }
    video.pause();
    stopFrames();
    resumeAfterSeek = resume;
    seekTarget = clipTime(value);
    time = seekTarget;
    completed = false;
    $("playback-status").textContent = "";
    ready = false;
    $("video-message").textContent = "Loading selected rally...";
    $("video-message").hidden = false;
    if (!video.seeking && Math.abs(video.currentTime - seekTarget) < 0.001 && video.readyState >= 2) {
      completeSeek();
    } else {
      video.currentTime = seekTarget;
      updateAvailability();
      render();
    }
  }
  function completeSeek() {
    if (!mediaReady || video.currentSrc !== expectedVideo() || video.seeking || video.readyState < 2) return;
    if (seekTarget !== null && Math.abs(video.currentTime - seekTarget) > 0.15) return;
    const relative = clipTime(video.currentTime);
    if (Math.abs(video.currentTime - relative) > 0.05) {
      seekRelative(relative);
      return;
    }
    seekTarget = null;
    time = relative;
    ready = true;
    $("video-message").hidden = true;
    updateAvailability();
    render();
    if (time >= data.duration) finishRally();
    else if (resumeAfterSeek) { resumeAfterSeek = false; play(); }
  }

  function path(ctx, points, close = false) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    if (close) ctx.closePath();
  }
  function drawOverlay() {
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (!ready || video.seeking || !$("overlays").checked) return;
    for (let i = 0; i < 4; i++) {
      if (selected !== -1 && selected !== i) continue;
      const point = P.position(data.frames, time, i);
      if (!point) continue;
      const normalized = P.project(projection.toVideo, point);
      const x = normalized[0] * overlay.width, y = normalized[1] * overlay.height;
      const radius = 13 + point[1] * 0.9;
      ctx.save();
      ctx.strokeStyle = P.colors[i];
      ctx.lineWidth = 3;
      ctx.shadowColor = P.colors[i];
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radius * 0.28, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const distance = P.metrics(data.frames, time, i).distance.toFixed(1);
      const text = data.players[i].toUpperCase() + "  " + distance + " m";
      ctx.font = "bold 22px sans-serif";
      const width = ctx.measureText(text).width + 20;
      const labelX = Math.max(width / 2 + 4, Math.min(overlay.width - width / 2 - 4, x));
      const labelY = y - (52 + point[1] * 3) - 34;
      ctx.fillStyle = "#0b1926e8";
      ctx.fillRect(labelX - width / 2, labelY, width, 36);
      ctx.fillStyle = P.colors[i];
      ctx.fillRect(labelX - width / 2, labelY, 3, 36);
      ctx.textAlign = "center";
      ctx.fillText(text, labelX + 2, labelY + 25);
    }
  }
  function drawMap() {
    const ctx = map.getContext("2d"), transform = ([x, y]) => [10 + x * 20, 20 + y * 20];
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 220, 440);
    ctx.fillStyle = "#0c1916";
    ctx.fillRect(10, 20, 200, 400);
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, 20, 200, 400);
    ctx.clip();
    if (ready) for (let i = 0; i < 4; i++) {
      if (selected !== -1 && selected !== i) continue;
      if ($("heat").checked) {
        const cells = P.heat(data.frames, time, i);
        const max = Math.max(0.25, ...cells.map((c) => c.seconds));
        for (const cell of cells) {
          const [x, y] = transform([cell.x, cell.y]);
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, 24);
          gradient.addColorStop(0, P.colors[i]);
          gradient.addColorStop(1, P.colors[i] + "00");
          ctx.globalAlpha = 0.65 * cell.seconds / max;
          ctx.fillStyle = gradient;
          ctx.fillRect(x - 24, y - 24, 48, 48);
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = P.colors[i] + "aa";
      ctx.lineWidth = 1.5;
      path(ctx, P.trail(data.frames, time, i).map(transform));
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "#8ea799";
    ctx.lineWidth = 1.5;
    path(ctx, [[0, 0], [10, 0], [10, 20], [0, 20]].map(transform), true);
    ctx.stroke();
    for (const line of [[[0, 3], [10, 3]], [[0, 17], [10, 17]], [[5, 0], [5, 10]], [[5, 10], [5, 20]], [[0, 10], [10, 10]]]) {
      path(ctx, line.map(transform));
      ctx.stroke();
    }
    if (ready) for (let i = 0; i < 4; i++) {
      if (selected !== -1 && selected !== i) continue;
      const point = P.position(data.frames, time, i);
      if (!point) continue;
      const [x, y] = transform(point);
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = P.colors[i];
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.font = "bold 10px sans-serif";
      ctx.fillText(data.players[i].slice(0, 2).toUpperCase(), x + 7, y - 7);
    }
  }
  function render() {
    $("time").value = time;
    $("clock").textContent = time.toFixed(1) + " / " + data.duration.toFixed(1) + " s";
    $("time").setAttribute("aria-valuetext", time.toFixed(1) + " of " + data.duration + " seconds");
    $("play").textContent = video.paused ? "Play" : "Pause";
    $("play").setAttribute("aria-label", video.paused ? "Play rally" : "Pause rally");
    cards.forEach((card, i) => {
      card.distance.textContent = ready ? P.metrics(data.frames, time, i).distance.toFixed(1) + " m" : "--";
      card.button.setAttribute("aria-pressed", String(selected === i));
      card.button.setAttribute("aria-label", data.players[i] + ": " + card.distance.textContent + " estimated. Isolate player.");
    });
    $("all").setAttribute("aria-pressed", String(selected === -1));
    $("metric-note").textContent = "Estimated distance in this excerpt / interpolated between hand-marked positions. Select a player to isolate their movement.";
    momentButtons.forEach((button, i) => {
      const active = time >= data.moments[i].time && (i === data.moments.length - 1 || time < data.moments[i + 1].time);
      button.setAttribute("aria-current", String(active));
    });
    $("recap").hidden = !ready || time < data.duration;
    drawOverlay();
    drawMap();
  }
  function stopFrames() {
    if (frameRequest !== null) video.cancelVideoFrameCallback(frameRequest);
    if (animationRequest !== null) cancelAnimationFrame(animationRequest);
    frameRequest = null;
    animationRequest = null;
  }
  function advance(mediaTime) {
    time = clipTime(mediaTime);
    render();
    if (time >= data.duration) finishRally();
    else scheduleFrame();
  }
  function finishRally() {
    if (completed || !ready) return;
    completed = true;
    resumeAfterSeek = false;
    video.pause();
    stopFrames();
    time = data.duration;
    const end = data.duration;
    if (Math.abs(video.currentTime - end) > 0.01) {
      seekTarget = end;
      video.currentTime = end;
    }
    $("playback-status").textContent = "Excerpt complete. The rally recap is available below the player cards.";
    render();
  }
  function scheduleFrame() {
    if (video.paused || !ready) return;
    if (video.requestVideoFrameCallback) {
      frameRequest = video.requestVideoFrameCallback((now, metadata) => {
        frameRequest = null;
        advance(metadata.mediaTime);
      });
    } else {
      animationRequest = requestAnimationFrame(() => {
        animationRequest = null;
        advance(video.currentTime);
      });
    }
  }
  function fail(message) {
    video.pause();
    ready = false;
    mediaReady = false;
    resumeAfterSeek = false;
    stopFrames();
    updateAvailability();
    $("video-message").hidden = false;
    $("video-message").textContent = message;
    showError(message);
    render();
  }
  async function play() {
    if (!ready) return;
    if (time >= data.duration - 0.05) { seekRelative(0, true); return; }
    try {
      await video.play();
      $("error").hidden = true;
    } catch (failure) {
      showError("Playback could not start: " + failure.message);
    }
  }
  function initialize() {
    if (mediaReady || video.readyState < 1 || video.currentSrc !== expectedVideo()) return;
    try {
      P.validateVideo(data, {
        duration: video.duration, width: video.videoWidth, height: video.videoHeight
      });
    } catch (failure) {
      fail(failure.message);
      return;
    }
    mediaReady = true;
    video.playbackRate = Number($("speed").value);
    $("error").hidden = true;
    seekRelative(0);
  }

  P.colors.forEach((color, i) => {
    const button = document.createElement("button"), name = document.createElement("span");
    const distance = document.createElement("span"), detail = document.createElement("span");
    button.type = "button";
    button.className = "pr-player";
    button.style.setProperty("--player-color", color);
    name.className = "pr-player-name";
    name.textContent = data.players[i];
    distance.className = "pr-player-distance";
    detail.className = "pr-player-detail";
    detail.textContent = "estimated distance";
    button.append(name, distance, detail);
    button.addEventListener("click", () => { selected = selected === i ? -1 : i; render(); });
    $("players").append(button);
    cards.push({ button, distance });
  });
  $("play").addEventListener("click", () => video.paused ? play() : video.pause());
  $("replay").addEventListener("click", () => seekRelative(0, true));
  $("time").addEventListener("input", () => {
    seekRelative(Number($("time").value));
  });
  $("rally-select").addEventListener("change", () => selectRally(match.rallies.findIndex((rally) => rally.id === $("rally-select").value)));
  $("previous").addEventListener("click", () => selectRally(index - 1));
  $("next").addEventListener("click", () => selectRally(index + 1));
  $("recap-next").addEventListener("click", () => selectRally(index + 1));
  $("fullscreen").addEventListener("click", async () => {
    try {
      if (document.fullscreenElement === $("app")) await document.exitFullscreen();
      else if ($("app").requestFullscreen) await $("app").requestFullscreen();
      else throw new Error("Fullscreen is not supported by this browser. Open the preview in a browser that supports fullscreen.");
    } catch (failure) { showError("Could not change fullscreen mode: " + failure.message); }
  });
  document.addEventListener("fullscreenchange", () => {
    const active = document.fullscreenElement === $("app");
    $("fullscreen").textContent = active ? "Exit fullscreen" : "Fullscreen";
    $("fullscreen").setAttribute("aria-pressed", String(active));
  });
  $("speed").addEventListener("change", () => { video.playbackRate = Number($("speed").value); });
  $("mute").addEventListener("click", () => {
    video.muted = !video.muted;
    $("mute").textContent = video.muted ? "Muted" : "Sound on";
    $("mute").setAttribute("aria-pressed", String(video.muted));
    $("mute").setAttribute("aria-label", video.muted ? "Unmute match audio" : "Mute match audio");
  });
  $("heat").addEventListener("change", render);
  $("overlays").addEventListener("change", render);
  $("all").addEventListener("click", () => { selected = -1; render(); });
  video.addEventListener("loadedmetadata", initialize);
  video.addEventListener("loadeddata", completeSeek);
  video.addEventListener("play", () => { stopFrames(); scheduleFrame(); render(); });
  video.addEventListener("pause", () => {
    stopFrames();
    time = clipTime(video.currentTime);
    render();
  });
  video.addEventListener("seeking", drawOverlay);
  video.addEventListener("seeked", () => {
    completeSeek();
    stopFrames();
    scheduleFrame();
  });
  video.addEventListener("timeupdate", () => {
    if (ready && !video.seeking && !video.paused && video.currentTime >= data.duration) finishRally();
  });
  video.addEventListener("ended", finishRally);
  video.addEventListener("error", () => fail("This rally excerpt could not be loaded. Check your connection and try another rally or reload the page."));
  document.addEventListener("visibilitychange", () => { if (document.hidden) video.pause(); });
  window.addEventListener("pagehide", () => { video.pause(); stopFrames(); });
  match.rallies.forEach((rally, i) => {
    const option = document.createElement("option");
    option.value = rally.id;
    option.textContent = (i + 1) + ". " + rally.title + " (" + rally.duration + "s)";
    $("rally-select").append(option);
  });
  renderMatchSummary();
  populateRally();
  $("app").hidden = false;
  render();
  if (video.error) fail("The rally excerpt could not be loaded. Check your connection and reload the page.");
  else loadVideo();
})();
