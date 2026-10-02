"""Per-neuron receptor dominance from CeNGEN expression (via WormNeuroAtlas, offline).

dominance[nt][neuron] = (E - I) / (E + I), where E / I = summed expression of the neuron class's
excitatory / inhibitory ionotropic receptors for transmitter nt (receptor lists from WormNeuroAtlas
SynapseSign; CeNGEN threshold th=2). Resolves most of the edges WormNeuroAtlas marks as conflicting
(neuron expresses both kinds) by which kind dominates. Approximation: ignores receptor localisation.
"""
import numpy as np
from wna_offline import load_atlas

ALIASES = {"DD": "VD_DD", "VD": "VD_DD"}

def class_of(name, ids):
    base = {i.split("_")[0] for i in ids}
    for pre, cl in ALIASES.items():
        if name.startswith(pre) and name[len(pre):].isdigit() and cl in ids: return cl
    n = name
    while n:
        if n in ids or n in base: return n
        n = n[:-1]
    return None

def dominance(neurons, th=2):
    a = load_atlas(); c = a.cengen; ss = a.synapsesign
    ids = [str(x) for x in c.neuron_ids]
    out = {}; unmatched = set()
    for nt in ss.get_neurotransmitters():
        E = np.nansum(c.get_expression(gene_names=list(ss.get_receptors_for(nt, 1)), th=th), axis=1)
        I = np.nansum(c.get_expression(gene_names=list(ss.get_receptors_for(nt, -1)), th=th), axis=1)
        dom = (E - I) / (E + I + 1e-9); has = (E + I) > 0
        base_idx = {}
        for k, i in enumerate(ids): base_idx.setdefault(i.split("_")[0], k); base_idx.setdefault(i, k)
        vals = []
        for n in neurons:
            cl = class_of(n, ids)
            if cl is None: unmatched.add(n); vals.append(None); continue
            k = base_idx[cl]; vals.append(float(dom[k]) if has[k] else None)
        out[str(nt)] = vals
    return out, sorted(unmatched)
