// Connectome controls for the JS WormBrain (operate on the brain's live edge arrays).
//  degreePreserving(brain, seed): swap targets between random pairs of chemical synapses (a->b, c->d  =>  a->d, c->b),
//    keeping every neuron's in- and out-degree and every synapse's weight; same for gap-junction partners. No self-loops,
//    no duplicate pairs. Then the homeostatic bias is RECOMPUTED so the rewired brain rests at the same fixed point.
//  crude(brain, seed): the old control (relabel synapse targets by a random permutation), also with the bias recomputed.
import { createRequire } from "node:module"; const require = createRequire(import.meta.url); const { makeRng } = require("./wormcore.js");
export function recomputeBias(brain) {
  const r0 = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, (brain.xRest - brain.theta) / brain.beta)))), rows = new Float64Array(brain.n);
  for (let k = 0; k < brain.wVal.length; k++) rows[brain.wPost[k]] += brain.wVal[k];
  for (let i = 0; i < brain.n; i++) brain.bias[i] = brain.xRest - r0 * rows[i];
}
function recomputeGsum(brain) { brain.gsum.fill(0); for (let k = 0; k < brain.gVal.length; k++) { brain.gsum[brain.gA[k]] += brain.gVal[k]; brain.gsum[brain.gB[k]] += brain.gVal[k]; } }
export function degreePreserving(brain, seed, swapsPerEdge = 10) {
  const g = makeRng(seed), m = brain.wVal.length, key = (a, b) => a * 1000 + b, have = new Set();
  for (let k = 0; k < m; k++) have.add(key(brain.wPre[k], brain.wPost[k]));
  for (let t = 0; t < swapsPerEdge * m; t++) { const i = Math.floor(g.uniform() * m), j = Math.floor(g.uniform() * m); if (i === j) continue;
    const a = brain.wPre[i], b = brain.wPost[i], c = brain.wPre[j], d = brain.wPost[j];
    if (a === d || c === b || have.has(key(a, d)) || have.has(key(c, b))) continue;
    have.delete(key(a, b)); have.delete(key(c, d)); have.add(key(a, d)); have.add(key(c, b)); brain.wPost[i] = d; brain.wPost[j] = b; }
  const G = brain.gVal.length, gk = (a, b) => Math.min(a, b) * 1000 + Math.max(a, b), gh = new Set();
  for (let k = 0; k < G; k++) gh.add(gk(brain.gA[k], brain.gB[k]));
  for (let t = 0; t < swapsPerEdge * G; t++) { const i = Math.floor(g.uniform() * G), j = Math.floor(g.uniform() * G); if (i === j) continue;
    const a = brain.gA[i], b = brain.gB[i], c = brain.gA[j], d = brain.gB[j];
    if (a === d || c === b || gh.has(gk(a, d)) || gh.has(gk(c, b))) continue;
    gh.delete(gk(a, b)); gh.delete(gk(c, d)); gh.add(gk(a, d)); gh.add(gk(c, b)); brain.gB[i] = d; brain.gB[j] = b; }
  recomputeGsum(brain); recomputeBias(brain); brain.x.fill(brain.xRest);
}
export function crude(brain, seed) { brain.setKnockout([], seed); recomputeBias(brain); brain.x.fill(brain.xRest); }
