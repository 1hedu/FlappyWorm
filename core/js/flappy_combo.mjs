// Flappy Worm, two senses: the next pellet's ODOUR (AWC, real-time "where to go") + the SALT memory (ASER->AIB/AIY, prior).
// Both feed the connectome; AVA onset -> turn back (flap if sinking, dive if climbing). Headless harness.
import { readFileSync } from "node:fs"; import { createRequire } from "node:module"; import { degreePreserving, crude } from "./rewire.mjs";
const require = createRequire(import.meta.url); const { WormBrain, OnlineDecoder, SaltMemory, makeRng } = require("./wormcore.js");
const BRAIN = JSON.parse(readFileSync(new URL("../../data/brain_v2.json", import.meta.url)));
export const G = { gravity: 0.5, flap: 0.27, dive: -0.08, speed: 0.4, gap: 0.42, pipeEvery: 2.4, pipeW: 0.1, ground: 0.1,
  lamY: 0.15, aserGain: 3.0, tau: 0.15, dz: 4, refr: 0.4, zs: 0.03, lamO: 0.12, odourGain: 3.0, odourRef: 0.05, odourDead: 0.02, odourReach: 0.6,
  lo: 0.35, hi: 0.72, jumpMax: 0.25, F: 0.55, gate: false, painRange: 0.08, painGain: 6.0, painReach: 0.12, predictive: false, horizon: 1.2, margin: 0.05, errRange: 0.12, directional: false, dzB: 2.0, flapQuietZ: 1.0, quietT: 1.5, trigger: "onset", zT: 3.0, zTau: 0.1, retrig: 0.6, startPipe: 0, zRearm: 2.0, zRise: 1.5 };
export function makeWorm(seed = 1, { M_y = 0.55, v = 1, a = 1.0, salt = true, odour = true, pain = false, scrambled = false, control = null, controlSeed = 1 } = {}) {
  const brain = new WormBrain(BRAIN, seed); brain.setKnockout([], scrambled ? 12345 : -1);
  if (control === "dp") degreePreserving(brain, controlSeed); else if (control === "crude") crude(brain, controlSeed);
  const W0 = Float64Array.from(brain.wVal), awc = new Set(brain.sensory.odor_off), edges = [];
  for (let k = 0; k < brain.wVal.length; k++) if (awc.has(brain.wPre[k])) edges.push(k);
  const w = { brain, sm: salt ? new SaltMemory(brain, M_y / G.lamY, v) : null, salt, odour, pain, a,
    setA(x) { this.a = x; for (const k of edges) brain.wVal[k] = W0[k] * Math.min(1.2, Math.max(0, 1.2 * x)); } };
  w.setA(a); return w;
}
let lastGyInit = null;
export function play(worm, seed, { T = 60, g = G, learn = false, eta = 0.1, anchor = 0.3, pellet = 0.1 } = {}) {
  const { brain, sm } = worm; brain.x.fill(brain.xRest); const dec = new OnlineDecoder(brain.readout); const rng = makeRng(100 + seed);
  const S = { y: 0.55, vy: 0, pipes: [], nextPipe: 1.4, dead: 0, lastAct: -9 };
  if (g.startPipe) { const gy = g.lo + rng.uniform() * (g.hi - g.lo); S.pipes.push({ x: g.startPipe, gy, passed: false }); S.nextPipe = g.pipeEvery - (1.1 - g.startPipe) / g.speed; lastGyInit = gy; } let score = 0, steps = 0, simT = 0, prevS = null, dS = 0, prevO = null, dO = 0, target = null, zs = 0, zPrev = 0, zsB = 0, zPrevB = 0, lastGy = (typeof lastGyInit === 'number' ? lastGyInit : g.F), wasAboveL = false, armed = true, minSince = 0;
  const inp = new Float64Array(brain.n), tmp = new Float64Array(brain.n), aser = brain.index["ASER"], awc = brain.sensory.odor_off;
  const act = () => { if (S.dead) return; S.vy = S.vy <= 0 ? g.flap : g.dive; S.lastAct = simT; (S.acts = S.acts || []).push(simT); };
  const nextGap = () => { for (const p of S.pipes) if (p.x + g.pipeW > 0.28 - 0.05) return p; return null; };
  for (let k = 0; k < Math.round(T / brain.dt); k++) {
    simT += brain.dt; steps++; inp.fill(0);
    const pN = nextGap(), reachN = pN ? Math.exp(-Math.max(0, pN.x - 0.28) / g.odourReach) : 0;
    if (worm.salt) { const lnC = S.y / g.lamY; if (prevS !== null) dS += ((lnC - prevS) / brain.dt - dS) * Math.min(1, brain.dt / g.tau); prevS = lnC;
      const w = g.gate && worm.odour ? 1 - reachN : 1;                                          // memory yields as the food smell grows
      if (w > 0) { tmp.fill(0); tmp[aser] = Math.max(-brain.input_gain, Math.min(brain.input_gain, g.aserGain * (-dS))); sm.addInput(tmp, lnC);
        for (let i = 0; i < brain.n; i++) if (tmp[i] !== 0) inp[i] += w * tmp[i] + (1 - w) * (sm.posts.some(p => p[0] === i) ? sm.posts.find(p => p[0] === i)[3] * sm.r0 : 0); } else for (const p of sm.posts) inp[p[0]] += p[3] * sm.r0; }
    let drvLog = 0;
    if (worm.odour) { const p = nextGap(); if (p !== target) { target = p; prevO = null; }
      if (p) { const reach = Math.exp(-Math.max(0, p.x - 0.28) / g.odourReach);                 // the smell is stronger as the pellet gets closer
        const lo = -Math.abs(S.y - p.gy) / g.lamO; if (prevO !== null) dO += ((lo - prevO) / brain.dt - dO) * Math.min(1, brain.dt / g.tau); prevO = lo;
        const drive = reach * Math.min(brain.input_gain, g.odourGain * Math.max(0, -dO - g.odourDead) / g.odourRef); for (const i of awc) inp[i] += drive; drvLog = drive; } }
    if (worm.pain && g.predictive) {   // PREDICTED collision (engineered, like the fly demos' looming input): project the current
      // ballistic path to the next pipe; pain grows with how far outside the opening it would pass, and as the pipe nears
      const p = nextGap(); let pain = 0, painBelow = false;
      if (p) { const t = Math.max(0, p.x - 0.28) / g.speed;
        if (t < g.horizon) { const yp = S.y + S.vy * t - 0.5 * g.gravity * t * t, half = g.gap / 2 - g.margin, e = Math.abs(yp - p.gy) - half;
          if (e > 0) { pain = g.painGain * Math.min(1, e / g.errRange) * (1 - t / g.horizon); painBelow = yp < p.gy; } } }
      const tg = S.vy < 0 ? (S.y - g.ground) / -S.vy : 9; if (tg < g.horizon * 0.6) { const pg = g.painGain * (1 - tg / (g.horizon * 0.6)); if (pg > pain) { pain = pg; painBelow = true; } }   // heading into the ground
      // directional: danger above -> ASH (head nociceptor, -> AVA); danger below -> PLM (posterior touch, -> AVB)
      const ids = g.directional && painBelow ? brain.sensory.touch_posterior : brain.sensory.noxious_nose; if (g.directional && painBelow && pain > 0.1) S.lastPLM = simT;
      for (const i of ids) inp[i] += Math.min(brain.input_gain, pain); worm.lastPain = pain; }
    else if (worm.pain) {   // nociception (ASH): the nose nearing a pipe lip (while the pipe is at the worm) or the ground hurts, graded by distance
      let d = S.y - g.ground;
      for (const q of S.pipes) if (q.x < 0.28 + g.painReach && q.x + g.pipeW > 0.28 - 0.05) d = Math.min(d, (q.gy + g.gap / 2) - S.y, S.y - (q.gy - g.gap / 2));
      const pain = d < g.painRange ? g.painGain * (1 - Math.max(0, d) / g.painRange) : 0; for (const i of brain.sensory.noxious_nose) inp[i] += Math.min(brain.input_gain, pain); worm.lastPain = pain; }
    brain.step(inp); dec.step(brain, brain.dt);
    if (g.trigger === "level") {   // turn back when smoothed z(AVA) CROSSES zT (noise alone never does), again every retrig s while it stays above
      zs += (dec.z.reverse - zs) * Math.min(1, brain.dt / g.zTau);
      minSince = Math.min(minSince, zs);
      if (zs > g.zT && zs - minSince > g.zRise && simT - S.lastAct > g.refr) { act(); S.lastAVAact = simT; minSince = zs; }   // a FRESH rise of AVA above the noise ceiling
    } else { zs += (dec.z.reverse - zs) * Math.min(1, brain.dt / g.zs); const dz = (zs - zPrev) / brain.dt; zPrev = zs; if (dz > g.dz && simT - S.lastAct > g.refr) { act(); S.lastAVAact = simT; } }
    if (g.directional) { zsB += (dec.z.forward - zsB) * Math.min(1, brain.dt / g.zs); const dzb = (zsB - zPrevB) / brain.dt; zPrevB = zsB;
      const avaQuiet = dec.z.reverse < g.flapQuietZ && simT - (S.lastAVAact ?? -9) > g.quietT;   // forward escape only counts when the backward command is off
      if (avaQuiet && dzb > g.dzB && simT - S.lastAct > g.refr && !S.dead) { S.vy = g.flap; S.lastAct = simT; (S.acts = S.acts || []).push(simT);
        const trig = worm.trace = worm.trace || []; trig.push({ plmRecent: simT - (S.lastPLM ?? -9) < 0.6, avaRecent: simT - (S.lastAVAact ?? -9) < 1.5, y: S.y }); } }
    if (worm.traceOn && steps % 20 === 0) { const p = nextGap(); worm.tr.push([simT.toFixed(1), S.y.toFixed(2), p ? p.gy.toFixed(2) : '-', p ? p.x.toFixed(2) : '-', drvLog.toFixed(2), zs.toFixed(1), dec.z.reverse.toFixed(1), (S.acts || []).filter(t => simT - t < 0.1 && simT - t >= 0).length ? (S.vy > 0 ? 'FLAP' : 'DIVE') : '']); }
    if (steps % 4 === 0) { const h = brain.dt * 4; S.vy -= g.gravity * h; S.y += S.vy * h; if (S.y > 0.98) { S.y = 0.98; S.vy = 0; }
      for (const q of S.pipes) { q.x -= g.speed * h; if (!q.passed && q.x + g.pipeW < 0.28 - 0.04) { q.passed = true; score++;
        if (learn && Math.abs(S.y - q.gy) < pellet) { worm.setA(Math.min(1, worm.a + eta * (1 - worm.a)));          // a meal strengthens AWC's synapses
          if (worm.sm) worm.sm.M += (q.gy / g.lamY - worm.sm.M) * anchor; } } }                                       // and pulls the salt memory to the pellet
      S.pipes = S.pipes.filter(q => q.x > -0.3); S.nextPipe -= h;
      if (S.nextPipe <= 0) { const lo = Math.max(g.lo, lastGy - g.jumpMax), hi = Math.min(g.hi, lastGy + g.jumpMax); const gy = lo + rng.uniform() * (hi - lo); lastGy = gy; S.pipes.push({ x: 1.1, gy, passed: false }); S.nextPipe = g.pipeEvery; }
      if (!S.dead) { for (const q of S.pipes) if (q.x < 0.28 + 0.05 && q.x + g.pipeW > 0.28 - 0.05 && Math.abs(S.y - q.gy) > g.gap / 2 - 0.02) { S.dead = simT; worm.cause = (S.y > q.gy ? "top pipe" : "bottom pipe") + (S.vy > 0 ? " while climbing" : " while sinking"); }
        if (S.y <= g.ground + 0.02 && !S.dead) { S.dead = simT; worm.cause = "ground"; }
        if (S.dead) { worm.painAtDeath = worm.lastPain; worm.actsLast2s = S.acts ? S.acts.filter(t => simT - t < 2).length : 0; } }
      if (S.dead) break; }
  }
  worm.lastScore = score; worm.diedAt = S.dead ? simT : null; worm.actRate = (S.acts ? S.acts.length : 0) / Math.max(1, simT) * 60;
  return score;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const m = a => (a.reduce((x, y) => x + y) / a.length).toFixed(1);
  for (const [label, opts] of [["salt memory only (memory at mid height)", { salt: true, odour: false }], ["odour only", { salt: false, odour: true }], ["odour + salt memory", { salt: true, odour: true }]]) {
    const sc = []; for (let s = 1; s <= 8; s++) sc.push(play(makeWorm(1, opts), s)); console.log(`${label.padEnd(40)} mean ${m(sc)} of 24  scores ${sc.join(" ")}`); }
}
