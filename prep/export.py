"""Export the signed C. elegans connectome to a language-neutral JSON file.

Output: data/connectome_cook2019_herm.json

Sources (all offline):
  wiring        Cook et al. 2019 hermaphrodite (cect)   chemical counts + gap junction counts
  transmitters  Wang et al. 2024 hermaphrodite (cect)   which fast transmitters each neuron releases
  receptor sign WormNeuroAtlas / Fenyves-style prediction from transmitter + ionotropic receptor expression

Per chemical edge we store two sign candidates so the runtime (or fitting) can choose:
  s_simple    ACh +1, GABA -1, Glu 0 (= "use the tunable glu_sign"), none of these -> null
  s_receptor  receptor-based prediction in [-1, 1] (mean across the pre neuron's transmitters), or null
  s_dominance post-synaptic receptor dominance (E-I)/(E+I) from CeNGEN expression, or null
"""
import json, sys, warnings
from pathlib import Path
import numpy as np

warnings.filterwarnings("ignore")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).parent))

from cect.Cells import PREFERRED_HERM_NEURON_NAMES
from cect.readers.Cook2019HermReader import get_instance as cook
from cect.readers.Wang2024HermReader import get_instance as wang
from wna_offline import receptor_signs
from receptor_dominance import dominance

FAST = {"Acetylcholine": "ACh", "GABA": "GABA", "Glutamate": "Glu"}
SLOW = {"Dopamine": "DA", "Serotonin": "5HT", "Tyramine": "TA", "Octopamine": "OA", "Betaine": "Betaine"}
SIMPLE = {"ACh": 1.0, "GABA": -1.0, "Glu": 0.0}


def main():
    neurons = list(PREFERRED_HERM_NEURON_NAMES)
    assert len(neurons) == 302
    idx = {n: i for i, n in enumerate(neurons)}

    c = cook()
    cn = list(c.nodes)
    ci = [cn.index(n) if n in cn else -1 for n in neurons]
    missing = [n for n, k in zip(neurons, ci) if k < 0]
    CS = np.zeros((302, 302)); GJ = np.zeros((302, 302))
    for a, ka in enumerate(ci):
        if ka < 0: continue
        for b, kb in enumerate(ci):
            if kb < 0: continue
            CS[a, b] = c.connections["Generic_CS"][ka, kb]
            GJ[a, b] = c.connections["Generic_GJ"][ka, kb]

    # transmitter identity: a neuron releases X if Wang2024 has any outgoing X connection
    w = wang(); wn = list(w.nodes)
    nt = {n: [] for n in neurons}
    for full, short in {**FAST, **SLOW}.items():
        M = w.connections.get(full)
        if M is None: continue
        for n in neurons:
            if n in wn and M[wn.index(n)].sum() > 0:
                nt[n].append(short)

    rnames, rnts, rsign = receptor_signs()
    ridx = {n: i for i, n in enumerate(rnames)}

    dom, dom_unmatched = dominance(neurons)

    chem = []
    stats = {"edges": 0, "s_simple_null": 0, "s_receptor_null": 0, "glu_edges": 0}
    for a in range(302):
        pre = neurons[a]
        fast = [t for t in nt[pre] if t in SIMPLE]
        for b in range(302):
            k = CS[a, b]
            if k <= 0: continue
            post = neurons[b]
            s_simple = float(np.mean([SIMPLE[t] for t in fast])) if fast else None
            s_rec = None
            if fast and pre in ridx and post in ridx:
                vals = [rsign[rnts.index(t), ridx[post], ridx[pre]] for t in fast if t in rnts]
                vals = [v for v in vals if np.isfinite(v)]
                if vals: s_rec = float(np.mean(vals))
            dvals = [dom[t][b] for t in fast if t in dom and dom[t][b] is not None]
            s_dom = float(np.mean([(1.0 if t != "GABA" else 1.0) * dom[t][b] for t in fast if t in dom and dom[t][b] is not None])) if dvals else None
            chem.append([a, b, int(k), s_simple, s_rec, int("Glu" in fast), s_dom])
            stats["edges"] += 1
            stats["s_simple_null"] += s_simple is None
            stats["s_receptor_null"] += s_rec is None
            stats["glu_edges"] += "Glu" in fast

    gap = [[a, b, int(GJ[a, b])] for a in range(302) for b in range(a + 1, 302) if GJ[a, b] > 0]

    out = {
        "format": "wormmoment-connectome/1",
        "sources": {"wiring": "Cook et al. 2019 (herm)", "transmitters": "Wang et al. 2024 (herm)",
                    "receptor_sign": "WormNeuroAtlas (Randi et al.; Fenyves et al. 2020 method)"},
        "neurons": neurons,
        "nt": [nt[n] for n in neurons],
        "chem_fields": ["pre", "post", "count", "s_simple", "s_receptor", "is_glu", "s_dominance"],
        "chem": chem,
        "gap_fields": ["a", "b", "count"],
        "gap": gap,
        "missing_from_cook": missing,
        "dominance_unmatched": dom_unmatched,
        "stats": stats,
    }
    p = ROOT / "data" / "connectome_cook2019_herm.json"
    p.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {p.relative_to(ROOT)}: {stats['edges']} chem edges, {len(gap)} gap pairs, "
          f"missing={missing}, no-fast-NT edges={stats['s_simple_null']}, "
          f"no-receptor-sign edges={stats['s_receptor_null']}, glu edges={stats['glu_edges']}")
    no_nt = [n for n in neurons if not nt[n]]
    print(f"neurons with no transmitter info: {len(no_nt)} {no_nt[:20]}")


if __name__ == "__main__":
    main()
