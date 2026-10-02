import { G, makeWorm, play } from "../core/js/flappy_combo.mjs";
import { recomputeBias } from "../core/js/rewire.mjs";
import { appendFileSync, writeFileSync } from "node:fs";
const TS = 2.5, g = { ...G, speed: 0.3 / TS, pipeEvery: 3.2 * TS, gravity: 0.5 / (TS * TS), flap: 0.27 / TS, dive: -0.08 / TS, lamO: 0.08, odourReach: 0.8, trigger: "level", zT: 3, zTau: 0.1, zRise: 0.7, odourGain: 10, refr: 0.5, startPipe: 0.75 }, T = 24 * g.pipeEvery + 2;
const LOG = new URL("results/knockouts.txt", import.meta.url), log = s => appendFileSync(LOG, s + "\n"), res = {};
const sets = [["intact", []], ["AIY", ["AIYL","AIYR"]], ["AIB", ["AIBL","AIBR"]], ["RIM", ["RIML","RIMR"]], ["AIZ", ["AIZL","AIZR"]], ["RIA", ["RIAL","RIAR"]], ["AVE", ["AVEL","AVER"]], ["AVD", ["AVDL","AVDR"]], ["FLP", ["FLPL","FLPR"]],
  ["PLM (control)", ["PLML","PLMR"]], ["URYV (control)", ["URYVL","URYVR"]], ["CEP (control)", ["CEPDL","CEPDR","CEPVL","CEPVR"]]];
for (const [label, ko] of sets) { const sc = [], causes = {};
  for (const seed of [1, 2, 3, 4]) { const w = makeWorm(seed, { salt: false, odour: true, a: 1.0 }); const b = w.brain;
    if (ko.length) { b.setKnockout(ko); const awc = new Set(b.sensory.odor_off); for (let k = 0; k < b.wVal.length; k++) if (awc.has(b.wPre[k])) b.wVal[k] *= 1.2; }
    recomputeBias(b); b.x.fill(b.xRest); b.noise = 0.02;
    for (let c = 1; c <= 8; c++) { w.cause = null; sc.push(play(w, 40 + c, { g, T })); const k = w.cause || "survived"; causes[k] = (causes[k] || 0) + 1; } }
  res[label] = { sc, causes }; const mean = sc.reduce((a, b) => a + b) / sc.length;
  log(`${label.padEnd(16)} mean ${mean.toFixed(1)} of 24 | perfect ${sc.filter(x => x >= 24).length}/32 | deaths ${JSON.stringify(causes)}`);
  writeFileSync(new URL("results/knockouts.json", import.meta.url), JSON.stringify(res)); }
log("DONE");
