"""Export a fully resolved brain for engines: final signed weights, gap couplings, homeostatic bias,
integration constants, and I/O neuron indices. Engines implement ONLY the update rule below.

Update rule (semi-implicit Euler), per step, h = dt/tau:
  r_j = 1 / (1 + exp(-clamp((x_j - theta)/beta, -40, 40)))
  num_i = x_i + h * ( sum_j W_ij r_j + bias_i + g_gap * sum_j G_ij x_j + I_i + noise_i )
  x_i  = num_i / (1 + h * (1 + g_gap * Gsum_i))
  knocked-out neurons: their W rows/cols and G rows/cols are zeroed and x_i is held at 0.

Usage: python prep/export_brain.py data/params_v2.json data/brain_v2.json
"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "core" / "python")]
import numpy as np
from brain import Connectome, Params, build_matrices, homeostatic_bias, rest_potential, load_overrides
from io_map import SENSORY, READOUT

def main(params_path, out_path):
    p = Params.load(ROOT / params_path); c = Connectome()
    W, G = build_matrices(c, p)
    bias = homeostatic_bias(W, p)
    pre_post = np.argwhere(W != 0)
    out = {
        "format": "wormmoment-brain/1",
        "params_file": params_path,
        "neurons": c.neurons,
        "W_fields": ["post", "pre", "w"],
        "W": [[int(i), int(j), round(float(W[i, j]), 7)] for i, j in pre_post],
        "G_fields": ["a", "b", "g"],
        "G": [[int(a), int(b), round(float(G[a, b]), 7)] for a, b in np.argwhere(np.triu(G, 1) != 0)],
        "bias": [round(float(v), 7) for v in bias],
        "x_rest": rest_potential(p),
        "consts": {k: getattr(p, k) for k in ("tau", "dt", "theta", "beta", "g_gap", "noise", "input_gain")},
        "sensory": {k: c.ids(v) for k, v in SENSORY.items()},
        "readout": {k: c.ids(v) for k, v in READOUT.items()},
        "provenance": {
            "wiring": "Cook et al. 2019 (hermaphrodite)", "transmitters": "Wang et al. 2024",
            "signs": "CeNGEN receptor dominance via WormNeuroAtlas + cited overrides",
            "overrides": load_overrides() if p.use_overrides else [],
        },
    }
    (ROOT / out_path).write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {out_path}: {len(out['W'])} weights, {len(out['G'])} gap pairs, "
          f"{(ROOT / out_path).stat().st_size // 1024} KB")

if __name__ == "__main__":
    main(*(sys.argv[1:3] if len(sys.argv) > 2 else ("data/params_v2.json", "data/brain_v2.json")))
