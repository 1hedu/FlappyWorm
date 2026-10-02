"""One-sided Mann-Whitney U of each knockout vs intact, Bonferroni-corrected.  python validation/knockout_stats.py"""
import json; from pathlib import Path; import numpy as np; from scipy.stats import mannwhitneyu
r = json.loads((Path(__file__).parent / "results" / "knockouts.json").read_text()); base = np.array(r["intact"]["sc"]); n = len(r) - 1
print(f"intact {base.mean():.1f} of 24 (n={len(base)}); Bonferroni x{n}")
for k, v in r.items():
    if k == "intact": continue
    v = np.array(v["sc"]); p = mannwhitneyu(v, base, alternative="less").pvalue
    print(f"  {k:16s} {v.mean():5.1f}  ({v.mean() - base.mean():+5.1f})  p={p:.4f}  {'SIGNIFICANT' if p * n < 0.05 else ('nominal' if p < 0.05 else 'n.s.')}")
