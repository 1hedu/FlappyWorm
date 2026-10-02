// "Real vs shuffled": a separate mode. Two worms race the same course: the real wiring and a degree-preserving
// shuffle of it (each neuron keeps its in/out connection counts and synapse weights; only partners change; resting
// balance recomputed). Both have a fully learned smell (AWC synapses x1.2) and identical controllers.
(() => {
  "use strict";
  const { WormBrain, OnlineDecoder, makeRng } = WormCore;
  const S = 2.5;   // same uniform time-stretch as the main game (classic Flappy physics, played back S x faster)
  const G = { gravity: 0.5 / (S * S), flap: 0.27 / S, dive: -0.08 / S, speed: 0.3 / S, gap: 0.42, pipeEvery: 3.2 * S, pipeW: 0.1, ground: 0.1,
    lam: 0.08, reach: 0.8, gain: 10.0, ref: 0.05, tau: 0.15, dead: 0.02, zT: 3.0, zTau: 0.1, zRise: 0.7, refr: 0.5, lo: 0.35, hi: 0.72, jumpMax: 0.25, startPipe: 0.75, T: 24 * 3.2 * S + 2 };
  const cv = document.getElementById("game"), ctx = cv.getContext("2d");
  function recomputeBias(b) { const r0 = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, (b.xRest - b.theta) / b.beta)))), rows = new Float64Array(b.n);
    for (let k = 0; k < b.wVal.length; k++) rows[b.wPost[k]] += b.wVal[k]; for (let i = 0; i < b.n; i++) b.bias[i] = b.xRest - r0 * rows[i]; }
  function degreePreserving(b, seed) { const g = makeRng(seed), m = b.wVal.length, key = (a, c) => a * 1000 + c, have = new Set();
    for (let k = 0; k < m; k++) have.add(key(b.wPre[k], b.wPost[k]));
    for (let t = 0; t < 10 * m; t++) { const i = Math.floor(g.uniform() * m), j = Math.floor(g.uniform() * m); if (i === j) continue; const a = b.wPre[i], x = b.wPost[i], c = b.wPre[j], d = b.wPost[j];
      if (a === d || c === x || have.has(key(a, d)) || have.has(key(c, x))) continue; have.delete(key(a, x)); have.delete(key(c, d)); have.add(key(a, d)); have.add(key(c, x)); b.wPost[i] = d; b.wPost[j] = x; }
    const Gn = b.gVal.length, gk = (a, c) => Math.min(a, c) * 1000 + Math.max(a, c), gh = new Set(); for (let k = 0; k < Gn; k++) gh.add(gk(b.gA[k], b.gB[k]));
    for (let t = 0; t < 10 * Gn; t++) { const i = Math.floor(g.uniform() * Gn), j = Math.floor(g.uniform() * Gn); if (i === j) continue; const a = b.gA[i], x = b.gB[i], c = b.gA[j], d = b.gB[j];
      if (a === d || c === x || gh.has(gk(a, d)) || gh.has(gk(c, x))) continue; gh.delete(gk(a, x)); gh.delete(gk(c, d)); gh.add(gk(a, d)); gh.add(gk(c, x)); b.gB[i] = d; b.gB[j] = x; }
    b.gsum.fill(0); for (let k = 0; k < Gn; k++) { b.gsum[b.gA[k]] += b.gVal[k]; b.gsum[b.gB[k]] += b.gVal[k]; } }
  function makeWorm(name, shuffled, col, shuffleSeed) {
    const b = new WormBrain(BRAIN, 1); if (shuffled) degreePreserving(b, shuffleSeed); recomputeBias(b); b.x.fill(b.xRest);
    const awc = new Set(b.sensory.odor_off); for (let k = 0; k < b.wVal.length; k++) if (awc.has(b.wPre[k])) b.wVal[k] *= 1.2;   // learned smell
    return { name, col, b, dec: new OnlineDecoder(b.readout), I: new Float64Array(b.n), y: 0.55, vy: 0, dead: 0, score: 0, crashes: 0, lnPrev: null, dln: 0, target: null, zs: 0, minSince: 0, lastAct: -9 };
  }
  let on = false, worms = [], pipes = [], nextPipe = 0, simT = 0, steps = 0, rng, lastGy = 0.55, course = 0, acc = 0, prev = 0, shuffleSeed = 1;
  const tally = { real: 0, shuffled: 0, ties: 0 };
  function newRace() { course++; shuffleSeed = course; rng = makeRng(500 + course); simT = 0; steps = 0; pipes = []; const gy = G.lo + rng.uniform() * (G.hi - G.lo); pipes.push({ x: G.startPipe, gy }); lastGy = gy;
    nextPipe = G.pipeEvery - (1.1 - G.startPipe) / G.speed; worms = [makeWorm("real wiring", false, "#f4eedc"), makeWorm("shuffled wiring", true, "#9aa3ad", shuffleSeed)]; }
  const nextGapFor = () => { for (const p of pipes) if (p.x + G.pipeW > 0.28 - 0.05) return p; return null; };
  function stepWorm(w, dt) {
    const b = w.b; w.I.fill(0); const p = nextGapFor(), gy = p ? p.gy : 0.55; if (p !== w.target) { w.target = p; w.lnPrev = null; }
    const ln = -Math.abs(w.y - gy) / G.lam; if (w.lnPrev !== null) w.dln += ((ln - w.lnPrev) / dt - w.dln) * Math.min(1, dt / G.tau); w.lnPrev = ln;
    const reach = p ? Math.exp(-Math.max(0, p.x - 0.28) / G.reach) : 0, drive = w.dead ? 0 : reach * Math.min(b.input_gain, G.gain * Math.max(0, -w.dln - G.dead) / G.ref);
    for (const i of b.sensory.odor_off) w.I[i] = drive;
    b.step(w.I); w.dec.step(b, dt);
    w.zs += (w.dec.z.reverse - w.zs) * Math.min(1, dt / G.zTau); w.minSince = Math.min(w.minSince, w.zs);
    if (!w.dead && w.zs > G.zT && w.zs - w.minSince > G.zRise && simT - w.lastAct > G.refr) { w.vy = w.vy <= 0 ? G.flap : G.dive; w.lastAct = simT; w.minSince = w.zs; }
  }
  function step(dt) {
    simT += dt; steps++; for (const w of worms) stepWorm(w, dt);
    if (steps % 4 === 0) { const h = dt * 4;
      for (const w of worms) w.py = w.y; for (const p of pipes) p.px = p.x;
      for (const w of worms) { w.vy -= G.gravity * h; w.y += w.vy * h; if (w.y > 0.98) { w.y = 0.98; w.vy = 0; } if (w.dead && w.y < G.ground + 0.03) { w.y = G.ground + 0.03; w.vy = 0; } }
      for (const p of pipes) { const was = p.x + G.pipeW >= 0.28 - 0.04; p.x -= G.speed * h; if (was && p.x + G.pipeW < 0.28 - 0.04) for (const w of worms) if (!w.dead) w.score++; }
      pipes = pipes.filter(p => p.x > -0.3); nextPipe -= h;
      if (nextPipe <= 0) { const lo = Math.max(G.lo, lastGy - G.jumpMax), hi = Math.min(G.hi, lastGy + G.jumpMax), gy = lo + rng.uniform() * (hi - lo); lastGy = gy; pipes.push({ x: 1.1, px: 1.1, gy }); nextPipe = G.pipeEvery; }
      for (const w of worms) if (!w.dead) { for (const p of pipes) if (p.x < 0.28 + 0.05 && p.x + G.pipeW > 0.28 - 0.05 && Math.abs(w.y - p.gy) > G.gap / 2 - 0.02) w.dead = simT; if (w.y <= G.ground + 0.02) w.dead = simT; }
      for (const w of worms) if (w.dead && simT - w.dead > 1.5) {   // respawn mid-screen and try again
        w.crashes++; w.dead = 0; w.y = 0.55; w.vy = 0; w.py = 0.55; w.b.x.fill(w.b.xRest); w.dec = new OnlineDecoder(w.b.readout);
        w.lnPrev = null; w.dln = 0; w.target = null; w.zs = 0; w.minSince = 0; w.lastAct = simT; }
      const over = simT >= G.T;
      if (over) { const [r, s] = worms; if (r.score > s.score) tally.real++; else if (s.score > r.score) tally.shuffled++; else tally.ties++; newRace(); } }
  }
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function drawWorm(w, W, H, Y) { ctx.globalAlpha = w.name.startsWith("shuffled") ? 0.75 : 1; const wx = 0.28 * W, wy = Y(iy(w)), L = 0.13 * W, pitch = Math.max(-0.5, Math.min(1.0, -Math.atan2(w.vy * H, G.speed * W)));   // nose along the flight path (shared rule with the main game)
    ctx.save(); ctx.translate(wx, wy); ctx.rotate(pitch); const pts = []; for (let i = 0; i <= 24; i++) { const u = i / 24; pts.push([-L / 2 + u * L, Math.sin(u * 2 * Math.PI * 1.5 - simT * 2.5) * L * 0.09 * (1 - u * 0.4)]); }
    const rad = u => (0.028 * Math.pow(Math.sin(Math.PI * (0.04 + 0.92 * u)), 0.55) + 0.004) * L * 1.6;
    for (const [i, p] of pts.entries()) { ctx.beginPath(); ctx.arc(p[0], p[1], rad(1 - i / 24) + 1.5, 0, 7); ctx.fillStyle = "#5a4e33"; ctx.fill(); }
    for (const [i, p] of pts.entries()) { ctx.beginPath(); ctx.arc(p[0], p[1], rad(1 - i / 24), 0, 7); ctx.fillStyle = w.dead ? "#d0676d" : w.col; ctx.fill(); }
    ctx.restore(); }
  const lerpA = () => window.__interp === false ? 1 : Math.min(1, ((steps % 4) + acc / 0.005) / 4);
  const ix = p => p.px === undefined ? p.x : p.px + (p.x - p.px) * lerpA(), iy = w => w.py === undefined ? w.y : w.py + (w.y - w.py) * lerpA();
  function draw() {
    const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * d) || cv.height !== Math.round(r.height * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    ctx.setTransform(d, 0, 0, d, 0, 0); const W = r.width, H = r.height, Y = y => (1 - y) * H;
    ctx.fillStyle = css("--sky"); ctx.fillRect(0, 0, W, H);
    for (const p of pipes) { const x = ix(p) * W, w = G.pipeW * W, top = Y(p.gy + G.gap / 2), bot = Y(p.gy - G.gap / 2);
      ctx.fillStyle = css("--pipe"); ctx.fillRect(x, 0, w, top); ctx.fillRect(x, bot, w, H - bot); ctx.fillStyle = css("--pipe2"); ctx.fillRect(x + w * 0.72, 0, w * 0.12, top); ctx.fillRect(x + w * 0.72, bot, w * 0.12, H - bot);
      ctx.fillStyle = css("--pipe"); ctx.strokeStyle = "#2e5a1a"; ctx.lineWidth = 3; for (const yy of [top - 26, bot]) { ctx.fillRect(x - 6, yy, w + 12, 26); ctx.strokeRect(x - 6, yy, w + 12, 26); } }
    const gyG = Y(G.ground); ctx.fillStyle = css("--ground"); ctx.fillRect(0, gyG, W, H - gyG); ctx.fillStyle = css("--grass"); ctx.fillRect(0, gyG, W, 10);
    drawWorm(worms[1], W, H, Y); drawWorm(worms[0], W, H, Y); ctx.globalAlpha = 1;   // real worm drawn on top
    ctx.fillStyle = "rgba(29,38,32,0.82)"; ctx.fillRect(8, 8, 560, 70); ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = 'bold 15px "Atkinson Hyperlegible", system-ui, sans-serif';
    ctx.fillText(`Race ${course}: real ${worms[0].score} pipes, ${worms[0].crashes + (worms[0].dead ? 1 : 0)} crashes  \u00b7  shuffled ${worms[1].score} pipes, ${worms[1].crashes + (worms[1].dead ? 1 : 0)} crashes`, 18, 30);
    ctx.font = '13px "Atkinson Hyperlegible", system-ui, sans-serif'; ctx.fillText(`Races won: real ${tally.real} · shuffled ${tally.shuffled} · ties ${tally.ties}`, 18, 50);
    ctx.fillStyle = "#b9c7b3"; ctx.fillText("Same course, same senses, same settings. Only the wiring differs.", 18, 68);
    ctx.fillStyle = "rgba(29,38,32,0.82)"; ctx.fillRect(8, 82, 330, 26);
    ctx.fillStyle = "#f4eedc"; ctx.beginPath(); ctx.arc(24, 95, 6, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText("real wiring", 36, 99);
    ctx.fillStyle = "#9aa3ad"; ctx.beginPath(); ctx.arc(150, 95, 6, 0, 7); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText("shuffled wiring", 162, 99);
  }
  function advanceV(dt) { acc += dt * S; while (acc >= 0.005) { acc -= 0.005; step(0.005); } draw(); }
  window.__advanceVersus = dt => { if (on) advanceV(dt); };
  function frame(now) { if (!on) return; if (window.__manual) { prev = now; requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now; advanceV(dt); requestAnimationFrame(frame); }
  function start() { on = true; window.__versus = true; newRace(); prev = performance.now(); requestAnimationFrame(frame); }
  function stop() { on = false; window.__versus = false; }
  const btn = document.getElementById("versus");
  btn.onclick = () => { if (on) { stop(); btn.setAttribute("aria-pressed", "false"); btn.textContent = "Real vs shuffled race"; }
    else { start(); btn.setAttribute("aria-pressed", "true"); btn.textContent = "Back to the game"; } };
  window.versusTest = { crashes: () => worms.map(w => w.crashes), drawnX: () => pipes.length ? ix(pipes[0]) : null, state: () => ({ on, course, tally: { ...tally }, scores: worms.map(w => w.score) }), start: () => { if (!on) btn.click(); } };
})();
