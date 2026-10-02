import { G, makeWorm, play } from "../core/js/flappy_combo.mjs";
import { appendFileSync } from "node:fs";
const m = a => a.reduce((x, y) => x + y) / a.length, log = s => { console.log(s); appendFileSync(new URL("results/validation.txt", import.meta.url), s + "\n"); }, s = 2.5;
const g = { ...G, speed: 0.3 / s, pipeEvery: 3.2 * s, gravity: 0.5 / (s * s), flap: 0.27 / s, dive: -0.08 / s, lamO: 0.08, odourReach: 0.8, trigger: "level", zT: 3, zTau: 0.1, zRise: 0.7, odourGain: 10, refr: 0.5, startPipe: 0.75 }, T = 24 * g.pipeEvery + 2;
const games = (opts, noise, courses, seeds = [1, 2, 3, 4], extra = {}) => { const sc = []; for (const sd of seeds) { const w = makeWorm(sd, opts); w.brain.noise = noise; for (const c of courses) sc.push(play(w, c, { g, T, ...extra })); } return sc; };
let r = games({ salt: false, odour: true, a: 1 }, 0.02, [71, 72, 73, 74]); log(`held-out, noise on : ${m(r).toFixed(1)}/24, perfect ${r.filter(x => x >= 24).length}/16`);
r = games({ salt: false, odour: true, a: 1 }, 0, [71, 72, 73, 74]); log(`held-out, noise off: ${m(r).toFixed(1)}/24, perfect ${r.filter(x => x >= 24).length}/16`);
r = games({ salt: false, odour: false, a: 1 }, 0.02, [71, 72]); log(`smell off: ${m(r).toFixed(1)}/24`);
for (const cs of [1, 2, 3]) { r = games({ salt: false, odour: true, a: 1, control: "dp", controlSeed: cs }, 0.02, [71, 72], [1]); log(`degree-preserving shuffle #${cs}: ${r.join(" ")}`); }
for (const learn of [true, false]) { const all = []; for (const sd of [1, 2, 3]) { const w = makeWorm(sd, { salt: false, odour: true, a: 0.4 }); w.brain.noise = 0.02; const sc = []; for (let k = 1; k <= 6; k++) sc.push(play(w, 80 + k, { g, T, learn, eta: 0.1 })); all.push(sc); log(`${learn ? "learning" : "frozen  "} worm ${sd}: ${sc.join(" ")}`); } }
log("DONE");
