"""Reference brain: graded rate model on the signed connectome.

tau * dx_i/dt = -x_i + sum_j W_ij r_j + b_i + g_gap * sum_j G_ij (x_j - x_i) + I_i
b_i = x0 - r0 * sum_j W_ij  (homeostatic bias: all neurons rest at rate r0 = rest_rate)
r_j = sigmoid((x_j - theta) / beta)

W_ij = g_chem * sign_ij * count_ij / count_scale          (norm="global", default; Shiu-style)
     or g_chem * sign_ij * count_ij / sum_k count_ik    (norm="row")
G_ij = gapcount_ij / gap_scale  (or row-normalised)

Sign resolution per chemical edge:
  sign_mode=dominance and dominance known -> clip(dom_sharp * dominance)   [default]
  then data/sign_overrides.json (short, cited list) wins
  receptor prediction decisive (+/-)  -> use it
  both ends locomotor interneurons      -> cmd_conflict (if set)
  else by transmitter: ACh -> ach_conflict, Glu -> glu_conflict, GABA -> -1, unknown -> unknown_sign
The JS engine (core/js/wormcore.js) implements the same model.
"""
from __future__ import annotations
import json
from dataclasses import dataclass, asdict, field
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONNECTOME = ROOT / "data" / "connectome_cook2019_herm.json"


@dataclass
class Params:
    g_chem: float = 1.0
    g_gap: float = 0.3
    ach_conflict: float = 1.0
    glu_conflict: float = -0.5
    cmd_conflict: float | None = None  # sign for ambiguous edges among locomotor interneurons (Rakowski 2013); None = off
    unknown_sign: float = 0.0
    use_receptor: bool = True
    sign_mode: str = "dominance"   # "dominance" (CeNGEN receptor dominance) | "receptor" (WNA ternary + conflict knobs)
    dom_sharp: float = 1.0          # sign = clip(dom_sharp * dominance, -1, 1)
    use_overrides: bool = True      # apply data/sign_overrides.json
    tau: float = 0.1        # s
    theta: float = 1.0
    beta: float = 0.25
    dt: float = 0.005       # s
    norm: str = "global"   # "global": divide by count_scale (Shiu-style); "row": by each neuron's total input
    count_scale: float = 20.0
    gap_scale: float = 10.0
    input_gain: float = 2.0  # scale applied to sensory drive by io layer
    noise: float = 0.0       # std of additive input noise per sqrt(s)
    rest_rate: float | None = 0.1  # homeostatic bias puts every neuron at this rate at rest (None = off)

    def to_dict(self): return asdict(self)

    @classmethod
    def load(cls, path):
        return cls(**json.loads(Path(path).read_text()))


# Locomotor command interneurons whose mutual synapses Rakowski et al. 2013 fit as mostly inhibitory.
CMD_PREFIXES = ("AVA", "AVB", "AVD", "AVE", "PVC", "DVA")


def is_cmd(name: str) -> bool:
    return name.startswith(CMD_PREFIXES)


def edge_sign(s_simple, s_receptor, is_glu, p: Params, cmd_edge=False, s_dom=None) -> float:
    if p.sign_mode == "dominance" and s_dom is not None:
        return float(np.clip(p.dom_sharp * s_dom, -1.0, 1.0))
    if p.use_receptor and s_receptor is not None and s_receptor != 0:
        return float(s_receptor)
    if cmd_edge and p.cmd_conflict is not None and s_simple is not None:
        return p.cmd_conflict
    if s_simple is None:
        return p.unknown_sign
    if is_glu and s_simple == 0.0:
        return p.glu_conflict
    if s_simple > 0:           # ACh
        return p.ach_conflict
    if s_simple < 0:           # GABA
        return -1.0
    # mixed ACh+Glu etc. average to something in between
    return 0.5 * (p.ach_conflict + p.glu_conflict)


class Connectome:
    def __init__(self, path=DEFAULT_CONNECTOME):
        d = json.loads(Path(path).read_text())
        self.raw = d
        self.neurons: list[str] = d["neurons"]
        self.n = len(self.neurons)
        self.index = {n: i for i, n in enumerate(self.neurons)}
        self.chem = d["chem"]
        self.gap = d["gap"]

    def ids(self, names):
        """Accepts exact names or class prefixes ending in '*' (e.g. 'AVA*')."""
        out = []
        for nm in names:
            if nm.endswith("*"):
                out += [i for n, i in self.index.items() if n.startswith(nm[:-1])]
            else:
                out.append(self.index[nm])
        return sorted(set(out))


def load_overrides(path=ROOT / "data" / "sign_overrides.json"):
    return json.loads(Path(path).read_text())["overrides"]


def build_matrices(conn: Connectome, p: Params, knockout=(), shuffle_seed=None):
    n = conn.n
    W = np.zeros((n, n)); G = np.zeros((n, n))
    cmd = np.array([is_cmd(nm) for nm in conn.neurons])
    ovr = load_overrides() if p.use_overrides else []
    for pre, post, k, s, r, g, *rest in conn.chem:
        s_dom = rest[0] if rest else None
        sg = edge_sign(s, r, g, p, bool(cmd[pre] and cmd[post]), s_dom)
        for o in ovr:
            if conn.neurons[pre].startswith(tuple(o["pre"])) and conn.neurons[post].startswith(tuple(o["post"])):
                sg = o["sign"]
        W[post, pre] += k * sg
    counts_in = np.zeros(n)
    for pre, post, k, *_ in conn.chem:
        counts_in[post] += k
    for a, b, k in conn.gap:
        G[a, b] += k; G[b, a] += k
    if shuffle_seed is not None:      # control: same weights, scrambled targets
        rng = np.random.default_rng(shuffle_seed)
        W = W[rng.permutation(n)][:, rng.permutation(n)]
        G = G[rng.permutation(n)]; G = (G + G.T) / 2
        counts_in = np.abs(W).sum(1)
    if p.norm == "row":
        W = p.g_chem * W / np.maximum(counts_in, 1)[:, None]
        G = G / np.maximum(G.sum(1), 1)[:, None]
    else:
        W = p.g_chem * W / p.count_scale
        G = G / p.gap_scale
    ko = np.array(list(knockout), dtype=int)
    if ko.size:
        W[:, ko] = 0; W[ko, :] = 0; G[:, ko] = 0; G[ko, :] = 0
    return W, G


def rest_potential(p: Params) -> float:
    if p.rest_rate is None:
        return 0.0
    r0 = p.rest_rate
    return p.theta + p.beta * np.log(r0 / (1 - r0))


def homeostatic_bias(W, p: Params):
    """Intrinsic offset so that x_i = x0 for all i (rate r0) is an exact resting fixed point.
    With uniform x the gap-junction term cancels, so bias_i = x0 - sum_j W_ij r0."""
    n = W.shape[0]
    if p.rest_rate is None:
        return np.zeros(n)
    return rest_potential(p) - W.sum(1) * p.rest_rate


class Brain:
    def __init__(self, conn: Connectome | None = None, params: Params | None = None,
                 knockout=(), shuffle_seed=None, seed=0):
        self.conn = conn or Connectome()
        self.p = params or Params()
        self.ko = self.conn.ids(knockout) if knockout else []
        self.W, self.G = build_matrices(self.conn, self.p, self.ko, shuffle_seed)
        self.Gsum = self.G.sum(1)
        self.bias = homeostatic_bias(self.W, self.p)
        self.rng = np.random.default_rng(seed)
        self.x = np.full(self.conn.n, rest_potential(self.p))

    def rate(self, x=None):
        x = self.x if x is None else x
        z = np.clip((x - self.p.theta) / self.p.beta, -40, 40)
        return 1.0 / (1.0 + np.exp(-z))

    def step(self, I: np.ndarray):
        p = self.p
        # Semi-implicit Euler: leak and gap self-coupling (diagonal) implicit, the rest explicit.
        # x' = (x + h*(W r + g_gap*G x + I)) / (1 + h*(1 + g_gap*sum_j G_ij)),  h = dt/tau
        r = self.rate()
        h = p.dt / p.tau
        if p.noise > 0:
            I = I + p.noise / np.sqrt(p.dt) * self.rng.standard_normal(self.conn.n)
        num = self.x + h * (self.W @ r + self.bias + p.g_gap * (self.G @ self.x) + I)
        self.x = num / (1.0 + h * (1.0 + p.g_gap * self.Gsum))
        if self.ko:
            self.x[self.ko] = 0.0
        return self.x

    def run(self, stim_fn, T: float):
        """stim_fn(t) -> input vector. Returns (times, X[t, n])."""
        steps = int(round(T / self.p.dt))
        X = np.zeros((steps, self.conn.n)); ts = np.arange(steps) * self.p.dt
        for k in range(steps):
            X[k] = self.step(stim_fn(ts[k]))
        return ts, X
