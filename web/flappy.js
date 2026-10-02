// Flappy Worm, food-seeking edition: the gap smells; odour fading -> AWC -> (connectome) -> AVA onset -> turn back.
// Passing a gap = eating = strengthens AWC's output synapses. Mirrors core/js/flappy_odour.mjs (validated headless).
(() => {
  "use strict";
  const { WormBrain, OnlineDecoder, makeRng } = WormCore;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const cv = document.getElementById("game"), ctx = cv.getContext("2d"), curveCv = document.getElementById("curve"), cctx = curveCv.getContext("2d");
  // Classic Flappy physics, uniformly time-stretched by TS (speeds / TS, accelerations / TS^2) so the worm's ~0.5 s reflex
  // can keep up; playback is sped up by TS again, so on screen it moves like ordinary Flappy Bird. Validated headless
  // (core/js/flappy_combo.mjs, uniform-stretch search): noise on 16.6 / off 17.3 of 24.
  const TS = 2.5;   // time-stretch factor (S is the game state below)
  const G = { gravity: 0.5 / (TS * TS), flap: 0.27 / TS, dive: -0.08 / TS, speed: 0.3 / TS, gap: 0.42, pipeEvery: 3.2 * TS, pipeW: 0.1, ground: 0.1,
    lam: 0.08, reach: 0.8, gain: 10.0, ref: 0.05, tau: 0.15, dead: 0.02, zT: 3.0, zTau: 0.1, zRise: 0.7, refr: 0.5, eta: 0.1, pellet: 0.1, a0: 0.4,
    gameT: 24 * 3.2 * TS + 2, lo: 0.35, hi: 0.72, jumpMax: 0.25, startPipe: 0.75 };
  // Validated headless (core/js/flappy_combo.mjs, trigger "level"): a turn-back needs z(AVA) above 3 (noise alone never gets there)
  // AND a fresh rise of >= 0.7 since the last one. Slow motion: AVA responds in 0.4-0.7 s and its bursts last ~1.5 s.   // validated headless in core/js/flappy_combo.mjs (odour only)
  let brain, W0, awcEdges, a = G.a0, mode = "real", playing = false, training = false, simT = 0, acc = 0, steps = 0, score = 0, game = 0;
  const history = [];   // {game, score, mode}
  let ashGlow = 0;
  // hidden diagnostics: press D, or open with ?diag=1
  let diag = /[?&]diag=1/.test(location.search); const D = { rec: [], acts: [], trail: [] };
  function newWorm(scrambled = false) { brain = new WormBrain(BRAIN, 1); brain.setKnockout([], scrambled ? 12345 : -1); W0 = Float64Array.from(brain.wVal);
    const awc = new Set(brain.sensory.odor_off); awcEdges = []; for (let k = 0; k < brain.wVal.length; k++) if (awc.has(brain.wPre[k])) awcEdges.push(k); setA(G.a0); }
  function setA(v) { a = v; for (const k of awcEdges) brain.wVal[k] = W0[k] * Math.min(1.2, Math.max(0, 1.2 * a)); }
  newWorm();
  let dec, rng, S, lnPrev, dln, target, zs, minSince, wasSmell;
  const inp = () => new Float64Array(brain.n);
  let I = inp();
  function resetDiag() { D.rec = []; D.acts = []; D.trail = []; }
  function reset() { resetDiag(); game++; rng = makeRng(100 + game); brain.x.fill(brain.xRest); dec = new OnlineDecoder(brain.readout); I = inp();
    S = { y: 0.55, vy: 0, pipes: [], nextPipe: G.pipeEvery - (1.1 - G.startPipe) / G.speed, dead: 0, lastAct: -9, ash: 0, awc: 0, t0: 0, lastGy: 0.55 };
    { const gy = G.lo + rng.uniform() * (G.hi - G.lo); S.pipes.push({ x: G.startPipe, gy, passed: false }); S.lastGy = gy; }   // first pipe (and its smell) present from the start
    score = 0; simT = 0; lnPrev = null; dln = 0; target = null; zs = 0; minSince = 0; }
  const nextGap = () => { for (const p of S.pipes) if (p.x + G.pipeW > 0.28 - 0.05) return p; return null; };
  function act() { if (S.dead) return; S.vy = S.vy <= 0 ? G.flap : G.dive; S.lastAct = simT; }
  function step(dt) {
    simT += dt; steps++; I.fill(0);
    const p = nextGap(), gy = p ? p.gy : 0.55; if (p !== target) { target = p; lnPrev = null; }
    const ln = -Math.abs(S.y - gy) / G.lam; if (lnPrev !== null) dln += ((ln - lnPrev) / dt - dln) * Math.min(1, dt / G.tau); lnPrev = ln;
    const reach = p ? Math.exp(-Math.max(0, p.x - 0.28) / G.reach) : 0;                    // the smell grows as the pellet approaches
    const drive = reach * Math.min(brain.input_gain, G.gain * Math.max(0, -dln - G.dead) / G.ref); S.awc = drive; S.reach = reach; S.smell = reach * Math.exp(ln); S.dln = dln; S.gy = gy;
    if (mode !== "script" && mode !== "you") for (const i of brain.sensory.odor_off) I[i] = drive;
    if (S.dead && simT - S.dead < 0.6) { for (const i of brain.sensory.noxious_nose) I[i] = brain.input_gain; S.ash = 1; } else S.ash = 0;
    brain.step(I); dec.step(brain, dt);
    if (mode === "script") { if (drive > 0.5 && simT - S.lastAct > 0.35) act(); }
    else if (mode !== "you") { zs += (dec.z.reverse - zs) * Math.min(1, dt / G.zTau); minSince = Math.min(minSince, zs);
      if (zs > G.zT && zs - minSince > G.zRise && simT - S.lastAct > G.refr) { const wasSinking = S.vy <= 0; act(); D.acts.push({ t: simT, y: S.y, flap: wasSinking, z: zs, rise: zs - minSince }); minSince = zs; } }   // fresh AVA rise above the noise ceiling
    if (steps % 8 === 0) { D.rec.push({ t: simT, smell: S.smell, drive, z: zs, min: minSince, y: S.y, gy }); if (D.rec.length > 600) D.rec.shift(); D.trail.push([simT, S.y]); if (D.trail.length > 800) D.trail.shift(); }
    if (steps % 4 === 0) { S.py = S.y; for (const q of S.pipes) q.px = q.x; const h = dt * 4; S.vy -= G.gravity * h; S.y += S.vy * h; if (S.y > 0.98) { S.y = 0.98; S.vy = 0; } if (S.dead && S.y < G.ground + 0.03) { S.y = G.ground + 0.03; S.vy = 0; }
      for (const q of S.pipes) { q.x -= G.speed * h; if (!q.passed && q.x + G.pipeW < 0.28 - 0.04) { q.passed = true; score++;
        if (Math.abs(S.y - q.gy) < G.pellet) { q.eaten = true; if (mode === "real") setA(Math.min(1, a + G.eta * (1 - a))); } } }   // a meal strengthens AWC's synapses
      S.pipes = S.pipes.filter(q => q.x > -0.3); S.nextPipe -= h;
      if (S.nextPipe <= 0) { const lo = Math.max(G.lo, S.lastGy - G.jumpMax), hi = Math.min(G.hi, S.lastGy + G.jumpMax), gy = lo + rng.uniform() * (hi - lo); S.lastGy = gy;
        S.pipes.push({ x: 1.1, gy, passed: false }); S.nextPipe = G.pipeEvery; }
      if (!S.dead) { for (const q of S.pipes) if (q.x < 0.28 + 0.05 && q.x + G.pipeW > 0.28 - 0.05 && Math.abs(S.y - q.gy) > G.gap / 2 - 0.02) S.dead = simT; if (S.y <= G.ground + 0.02) S.dead = simT; }
      const over = (S.dead && simT - S.dead > 1.5) || (mode !== "you" && simT >= G.gameT);
      if (over) { history.push({ game, score, mode }); playing = false; if (training) { reset(); playing = true; } } }
  }

  function drawDiagField(W, H, Y) {
    // wireframe smell field of the next gap: iso-lines where smell = level x peak, source line, and a live profile curve
    const p = nextGap(); if (!p) return; const reach = Math.exp(-Math.max(0, p.x - 0.28) / G.reach);
    ctx.save(); ctx.font = '10px ui-monospace, monospace'; ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(200,40,140,0.95)"; ctx.beginPath(); ctx.moveTo(0, Y(p.gy)); ctx.lineTo(W, Y(p.gy)); ctx.stroke();
    ctx.fillStyle = "rgba(200,40,140,1)"; ctx.textAlign = "right"; ctx.fillText(`source (gap centre)  reach ${reach.toFixed(2)}`, W - 4, Y(p.gy) - 3);
    ctx.setLineDash([3, 4]);
    for (const lv of [0.8, 0.6, 0.4, 0.2, 0.1]) { if (reach <= lv) continue; const d = G.lam * Math.log(reach / lv);
      for (const yy of [p.gy + d, p.gy - d]) { if (yy < G.ground || yy > 1) continue; ctx.strokeStyle = `rgba(200,40,140,${0.25 + 0.6 * lv})`; ctx.beginPath(); ctx.moveTo(0, Y(yy)); ctx.lineTo(W, Y(yy)); ctx.stroke();
        ctx.textAlign = "left"; ctx.fillText(lv.toFixed(1), 4, Y(yy) - 2); ctx.textAlign = "right"; } }
    ctx.setLineDash([]);
    // profile: smell(height) right now, plotted sideways just ahead of the worm
    const x0 = 0.28 * W + 70, sx = 60; ctx.strokeStyle = "rgba(40,40,40,0.8)"; ctx.beginPath(); ctx.moveTo(x0, Y(G.ground)); ctx.lineTo(x0, Y(1)); ctx.stroke();
    ctx.strokeStyle = "rgba(200,40,140,1)"; ctx.beginPath();
    for (let py = Y(1); py <= Y(G.ground); py += 2) { const y = 1 - py / H, lv = reach * Math.exp(-Math.abs(y - p.gy) / G.lam), x = x0 + sx * lv; py === Y(1) ? ctx.moveTo(x, py) : ctx.lineTo(x, py); } ctx.stroke();
    ctx.fillStyle = "rgba(40,40,40,0.9)"; ctx.textAlign = "left"; ctx.fillText("smell vs height", x0 + 3, Y(0.9)); ctx.fillText("0", x0 - 8, Y(G.ground) - 2); ctx.fillText("1", x0 + sx - 3, Y(G.ground) - 2);
    ctx.beginPath(); ctx.moveTo(x0 + sx, Y(G.ground)); ctx.lineTo(x0 + sx, Y(G.ground) - 4); ctx.stroke();
    // the worm's current reading on the profile
    const lvW = reach * Math.exp(-Math.abs(S.y - p.gy) / G.lam); ctx.strokeStyle = "#202020"; ctx.beginPath(); ctx.arc(x0 + sx * lvW, Y(S.y), 3.5, 0, 7); ctx.stroke();
    ctx.restore();
  }
  function drawDiag(W, H, Y) {
    const gx = 0.28 * W, tNow = simT, px = t => gx - (tNow - t) * G.speed * W;
    ctx.save(); ctx.lineWidth = 1; ctx.font = '10px ui-monospace, monospace';
    // path (scrolls with the world) and turn-backs as hollow markers
    ctx.strokeStyle = "rgba(20,20,20,0.75)"; ctx.beginPath(); let first = true; for (const [t, y] of D.trail) { const x = px(t); if (x < 0) continue; first ? ctx.moveTo(x, Y(y)) : ctx.lineTo(x, Y(y)); first = false; } ctx.stroke();
    ctx.textAlign = "center";
    for (const a of D.acts) { const x = px(a.t); if (x < -10) continue; const col = a.flap ? "#0a7a2a" : "#b35a00";
      ctx.strokeStyle = col; ctx.beginPath(); ctx.arc(x, Y(a.y), 4, 0, 7); ctx.stroke(); ctx.fillStyle = col; ctx.fillText(a.flap ? "F" : "D", x, Y(a.y) - 7); }
    // velocity vector
    ctx.strokeStyle = "#202020"; ctx.beginPath(); ctx.moveTo(gx, Y(S.y)); ctx.lineTo(gx, Y(S.y) - S.vy * H * 0.6); ctx.stroke();
    // traces: wireframe plot with axes and ticks
    const pw = Math.min(380, W * 0.46), ph = 216, x0 = W - pw - 10, y0 = H - ph - 34;
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.fillRect(x0, y0, pw, ph);
    ctx.strokeStyle = "#202020"; ctx.strokeRect(x0 + 0.5, y0 + 0.5, pw, ph);
    const rows = [["smell at worm", r => r.smell, 0, 1, "#c8288c", [0, 1]], ["AWC drive", r => r.drive, 0, 6, "#1464b4", [0, 6]], ["AVA z", r => r.z, -1, 9, "#0a7a2a", [0, 3, 9]]];
    const rh = ph / rows.length; ctx.strokeStyle = "rgba(32,32,32,0.25)"; for (let k = 1; k < rows.length; k++) { ctx.beginPath(); ctx.moveTo(x0, y0 + k * rh); ctx.lineTo(x0 + pw, y0 + k * rh); ctx.stroke(); } const n = D.rec.length, L = x0 + 30, R = x0 + pw - 6, tx = i => L + (R - L) * i / 599;
    rows.forEach(([label, f, lo, hi, col, ticks], k) => { const top = y0 + k * rh, yy = v => top + rh - 8 - (rh - 18) * (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo);
      ctx.strokeStyle = "rgba(32,32,32,0.5)"; ctx.beginPath(); ctx.moveTo(L, top + 6); ctx.lineTo(L, top + rh - 6); ctx.stroke();
      ctx.fillStyle = "#202020"; ctx.textAlign = "right"; for (const tk of ticks) { ctx.fillText(String(tk), L - 4, yy(tk) + 3); ctx.beginPath(); ctx.moveTo(L - 2, yy(tk)); ctx.lineTo(L, yy(tk)); ctx.stroke(); }
      ctx.textAlign = "left"; ctx.fillStyle = col; ctx.fillText(label, L + 4, top + 12);
      if (k === 2) { ctx.strokeStyle = "rgba(32,32,32,0.7)"; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(L, yy(G.zT)); ctx.lineTo(R, yy(G.zT)); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "#202020"; ctx.textAlign = "right"; ctx.fillText("threshold", R, yy(G.zT) - 3);
        ctx.strokeStyle = "rgba(10,122,42,0.45)"; ctx.setLineDash([1, 3]); ctx.beginPath(); D.rec.forEach((r, i) => { const v = yy(r.min + G.zRise); i ? ctx.lineTo(tx(i), v) : ctx.moveTo(tx(i), v); }); ctx.stroke(); ctx.setLineDash([]); }
      ctx.strokeStyle = col; ctx.beginPath(); D.rec.forEach((r, i) => { i ? ctx.lineTo(tx(i), yy(f(r))) : ctx.moveTo(tx(i), yy(f(r))); }); ctx.stroke(); });
    const t0 = n ? D.rec[0].t : 0, t1 = n ? D.rec[n - 1].t : 1;
    for (const a of D.acts) { if (a.t < t0) continue; const x = tx((a.t - t0) / Math.max(1e-6, t1 - t0) * (n - 1)); ctx.strokeStyle = a.flap ? "rgba(10,122,42,0.6)" : "rgba(179,90,0,0.6)"; ctx.beginPath(); ctx.moveTo(x, y0 + 2); ctx.lineTo(x, y0 + ph - 2); ctx.stroke(); }
    ctx.fillStyle = "#202020"; ctx.textAlign = "right"; ctx.fillText(`last ${(t1 - t0).toFixed(0)} s (sim)`, R, y0 + ph + 12);
    ctx.textAlign = "left";
    ctx.fillText(`smell ${(S.smell || 0).toFixed(2)}   d/dt ${(S.dln || 0).toFixed(2)}/s   AWC ${(S.awc || 0).toFixed(2)}   AVA z ${zs.toFixed(2)}   rise ${(zs - minSince).toFixed(2)} / need ${G.zRise} at z>${G.zT}   vy ${S.vy.toFixed(3)}`, 8, 14);
    ctx.fillText("[D] diagnostics   F = flap   D = dive   dashed = smell iso-lines   dotted green = rise needed", 8, 27);
    ctx.restore();
  }
  const lerpA = () => window.__interp === false ? 1 : Math.min(1, ((steps % 4) + acc / brain.dt) / 4);
  const ix = p => p.px === undefined ? p.x : p.px + (p.x - p.px) * lerpA(), iy = () => S.py === undefined ? S.y : S.py + (S.y - S.py) * lerpA();
  function draw() {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    ctx.setTransform(d, 0, 0, d, 0, 0); const W = r.width, H = r.height, Y = y => (1 - y) * H;
    ctx.fillStyle = css("--sky"); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "rgba(255,255,255,0.7)"; for (let i = 0; i < 4; i++) { const x = ((i * 0.31 - simT * G.speed * 0.15) % 1.3 + 1.3) % 1.3 * W - 0.15 * W, y = (0.18 + i * 0.11) * H;
      for (const [dx, rr] of [[0, 20], [24, 27], [50, 18]]) { ctx.beginPath(); ctx.arc(x + dx, y, rr, 0, 7); ctx.fill(); } }
    if (diag && S) drawDiagField(W, H, Y);
    if (S) for (const p of S.pipes) { const x = ix(p) * W, w = G.pipeW * W, top = Y(p.gy + G.gap / 2), bot = Y(p.gy - G.gap / 2), cy = Y(p.gy);
      ctx.fillStyle = css("--pipe"); ctx.fillRect(x, 0, w, top); ctx.fillRect(x, bot, w, H - bot); ctx.fillStyle = css("--pipe2"); ctx.fillRect(x + w * 0.72, 0, w * 0.12, top); ctx.fillRect(x + w * 0.72, bot, w * 0.12, H - bot);
      ctx.fillStyle = css("--pipe"); ctx.strokeStyle = "#2e5a1a"; ctx.lineWidth = 3; for (const yy of [top - 26, bot]) { ctx.fillRect(x - 6, yy, w + 12, 26); ctx.strokeRect(x - 6, yy, w + 12, 26); }
    }
    const gy = Y(G.ground); ctx.fillStyle = css("--ground"); ctx.fillRect(0, gy, W, H - gy); ctx.fillStyle = css("--grass"); ctx.fillRect(0, gy, W, 10);
    ctx.fillStyle = "#5a8f2b"; for (let x = -((simT * G.speed * W) % 40); x < W; x += 40) ctx.fillRect(x, gy, 20, 10);
    if (S) { const wx = 0.28 * W, wy = Y(iy()), L = 0.13 * W, pitch = Math.max(-0.5, Math.min(1.0, -Math.atan2(S.vy * H, G.speed * W)));   // nose along the flight path (shared rule with race mode)
      ctx.save(); ctx.translate(wx, wy); ctx.rotate(pitch); const pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push([-L / 2 + u * L, Math.sin(u * 2 * Math.PI * 1.5 - simT * 2.5) * L * 0.09 * (1 - u * 0.4)]); }
      const rad = u => (0.028 * Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * u)), 0.55) + 0.004) * L * 1.6;
      for (const [i, p] of pts.entries()) { ctx.beginPath(); ctx.arc(p[0], p[1], rad(1 - i / 24) + 1.5, 0, 7); ctx.fillStyle = "#6f5f3c"; ctx.fill(); }
      for (const [i, p] of pts.entries()) { ctx.beginPath(); ctx.arc(p[0], p[1], rad(1 - i / 24), 0, 7); ctx.fillStyle = S.dead ? "#d0676d" : "#f4eedc"; ctx.fill(); }
      ctx.fillStyle = "#6f5f3c"; ctx.beginPath(); ctx.arc(L / 2 - 6, 0, 2.2, 0, 7); ctx.fill(); ctx.restore();
      ctx.font = 'bold 44px "Atkinson Hyperlegible", system-ui, sans-serif'; ctx.textAlign = "center"; ctx.lineWidth = 6; ctx.strokeStyle = "#333"; ctx.strokeText(String(score), W / 2, 60); ctx.fillStyle = "#fff"; ctx.fillText(String(score), W / 2, 60); }

    if (diag && S) drawDiag(W, H, Y);
    if (!playing) { ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.fillRect(0, 0, W, H); ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = 'bold 24px "Atkinson Hyperlegible", system-ui, sans-serif';
      ctx.fillText(history.length ? `Game ${game}: ${score} pipes (${mode})` : "Press Train to watch a naive worm learn", W / 2, H / 2 - 6);
      ctx.font = '16px "Atkinson Hyperlegible", system-ui, sans-serif'; ctx.fillText(mode === "you" ? "Space or tap to flap." : "Each gap smells of food. Passing one is a meal.", W / 2, H / 2 + 24); }
    // gauges + curve
    document.getElementById("score").textContent = `game ${game || 0} · score ${score}`;
    document.getElementById("assoc").style.width = `${a * 100}%`; document.getElementById("assocv").textContent = a.toFixed(2);
    const lv = k => Math.min(1, Math.max(0, (brain.groupRate(brain.readout[k]) - 0.25) / 0.6));
    document.getElementById("d-plm").style.background = S && S.awc > 0.3 ? css("--glow") : css("--dim");
    document.getElementById("d-ava").style.background = `rgba(142,242,124,${0.15 + 0.85 * lv("reverse")})`;
    const ashLv = Math.min(1, Math.max(0, (brain.groupRate(brain.sensory.noxious_nose) - 0.3) / 0.5)); ashGlow = Math.max(ashLv, ashGlow * 0.97);   // real ASH activity, held so it is visible
    document.getElementById("d-ash").style.background = `rgba(208,103,109,${0.15 + 0.85 * ashGlow})`;
    const cr = curveCv.getBoundingClientRect(); if (curveCv.width !== Math.round(cr.width * d) || curveCv.height !== Math.round(cr.height * d)) { curveCv.width = Math.round(cr.width * d); curveCv.height = Math.round(cr.height * d); }
    cctx.setTransform(d, 0, 0, d, 0, 0); cctx.fillStyle = "#172019"; cctx.fillRect(0, 0, cr.width, cr.height);
    const n = Math.max(20, history.length), bw = (cr.width - 34) / n, maxS = 24, colOf = m => ({ real: "#8ef27c", frozen: "#93a78c", scrambled: "#d0676d", script: "#b58ad6", you: "#e6c85a" })[m];
    history.slice(-n).forEach((hh, i) => { const hgt = (cr.height - 18) * Math.min(1, hh.score / maxS); cctx.fillStyle = colOf(hh.mode); cctx.fillRect(30 + i * bw, cr.height - 6 - hgt, Math.max(1, bw - 2), hgt); });
    cctx.fillStyle = "#93a78c"; cctx.font = '11px "Atkinson Hyperlegible", system-ui, sans-serif'; cctx.textAlign = "left"; cctx.fillText("24", 4, 14); cctx.fillText("0", 10, cr.height - 6);
    document.getElementById("best").textContent = history.length ? `pipes per game (green = learning, grey = learning off, red = scrambled, purple = script)` : "";
  }
  const start = () => { reset(); playing = true; };
  document.getElementById("play").onclick = () => { training = false; document.getElementById("train").setAttribute("aria-pressed", "false"); start(); };
  document.getElementById("train").onclick = e => { training = !training; e.target.setAttribute("aria-pressed", String(training)); if (training && !playing) start(); };
  document.getElementById("newworm").onclick = () => { newWorm(mode === "scrambled"); history.length = 0; game = 0; playing = false; training = false; document.getElementById("train").setAttribute("aria-pressed", "false"); };
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { const was = mode; mode = b.dataset.mode; document.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if ((mode === "scrambled") !== (was === "scrambled")) { const keep = a; newWorm(mode === "scrambled"); setA(keep); } playing = false; });
  const humanFlap = () => { if (mode === "you" && playing) { if (!S.dead) { S.vy = G.flap; S.lastAct = simT; } } else if (!playing) start(); };
  addEventListener("keydown", e => { if (e.key === " ") { e.preventDefault(); humanFlap(); } if (e.key === "d" || e.key === "D") diag = !diag; }); cv.addEventListener("pointerdown", humanFlap);
  let prev = performance.now();
  function advance(dt) { if (playing) { acc += dt * (window.__speedMult || (mode === "you" ? 1.0 : training ? 1.6 : 1.0)) * TS; while (acc >= brain.dt && playing) { acc -= brain.dt; step(brain.dt); } } draw(); }
  // frame-by-frame capture (hidden, for smooth video): window.__manual = true, then call __advance(1/30) per video frame
  window.__advance = dt => advance(dt);
  function frame(now) { if (window.__versus || window.__manual) { prev = now; requestAnimationFrame(frame); return; }   // race mode / manual capture own the canvas
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now; advance(dt); requestAnimationFrame(frame); }
  window.flappyTest = { drawnX: () => S && S.pipes.length ? ix(S.pipes[0]) : null, smell: () => a, diag: v => { diag = v; }, train: () => document.getElementById("train").click(), state: () => ({ playing, training, game, score, a, mode, history: history.slice() }), mode: m => document.querySelector(`[data-mode=${m}]`).click(), newWorm: () => document.getElementById("newworm").click() };
  requestAnimationFrame(frame);
})();
