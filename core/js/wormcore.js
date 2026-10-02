// wormmoment core runtime in JavaScript. Mirrors core/python/runtime.py, online_decoder.py, body.py.
// Verified against core/spec/golden_v2.json by core/js/golden_test.mjs.
(function (root) {
  "use strict";
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // Seeded Gaussian RNG (mulberry32 + Box-Muller) so demos are reproducible.
  function makeRng(seed) {
    let a = seed >>> 0;
    const u = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { uniform: u, gauss() { const x = Math.max(u(), 1e-12), y = u(); return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * y); } };
  }

  class WormBrain {
    constructor(d, seed = 1) {
      this.d = d; this.neurons = d.neurons; this.n = d.neurons.length;
      this.index = {}; d.neurons.forEach((nm, i) => (this.index[nm] = i));
      Object.assign(this, d.consts); this.xRest = d.x_rest;
      this.sensory = d.sensory; this.readout = d.readout; this.rng = makeRng(seed);
      this.x = new Float64Array(this.n); this.r = new Float64Array(this.n); this.acc = new Float64Array(this.n);
      this.setKnockout([]);
    }
    // scrambleSeed >= 0 remaps each synapse target to a random neuron (control condition)
    setKnockout(names, scrambleSeed = -1) {
      this.ko = new Uint8Array(this.n);
      for (const nm of names) if (nm in this.index) this.ko[this.index[nm]] = 1;
      const perm = Array.from({ length: this.n }, (_, i) => i);
      if (scrambleSeed >= 0) { const g = makeRng(scrambleSeed);
        for (let i = this.n - 1; i > 0; i--) { const j = Math.floor(g.uniform() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; } }
      const W = this.d.W.filter(e => !this.ko[perm[e[0]]] && !this.ko[e[1]]);
      this.wPost = Int32Array.from(W, e => perm[e[0]]); this.wPre = Int32Array.from(W, e => e[1]); this.wVal = Float64Array.from(W, e => e[2]);
      const G = this.d.G.filter(e => !this.ko[perm[e[0]]] && !this.ko[perm[e[1]]]);
      this.gA = Int32Array.from(G, e => perm[e[0]]); this.gB = Int32Array.from(G, e => perm[e[1]]); this.gVal = Float64Array.from(G, e => e[2]);
      this.gsum = new Float64Array(this.n);
      for (let k = 0; k < this.gVal.length; k++) { this.gsum[this.gA[k]] += this.gVal[k]; this.gsum[this.gB[k]] += this.gVal[k]; }
      this.bias = Float64Array.from(this.d.bias);
      for (let i = 0; i < this.n; i++) this.x[i] = this.ko[i] ? 0 : this.xRest;
    }
    rate(i) { const z = clamp((this.x[i] - this.theta) / this.beta, -40, 40); return 1 / (1 + Math.exp(-z)); }
    step(inp) {
      const n = this.n, h = this.dt / this.tau, x = this.x, r = this.r, acc = this.acc;
      for (let i = 0; i < n; i++) { r[i] = this.rate(i); acc[i] = this.bias[i] + inp[i]; }
      for (let k = 0; k < this.wVal.length; k++) acc[this.wPost[k]] += this.wVal[k] * r[this.wPre[k]];
      for (let k = 0; k < this.gVal.length; k++) { const a = this.gA[k], b = this.gB[k], g = this.g_gap * this.gVal[k];
        acc[a] += g * x[b]; acc[b] += g * x[a]; }
      if (this.noise > 0) { const s = this.noise / Math.sqrt(this.dt); for (let i = 0; i < n; i++) acc[i] += s * this.rng.gauss(); }
      for (let i = 0; i < n; i++) x[i] = this.ko[i] ? 0 : (x[i] + h * acc[i]) / (1 + h * (1 + this.g_gap * this.gsum[i]));
    }
    groupRate(ids) { if (!ids.length) return 0; let s = 0; for (const i of ids) s += this.rate(i); return s / ids.length; }
  }

  const KEYS = ["reverse", "forward", "omega", "turn_ventral", "turn_dorsal"];
  class OnlineDecoder {
    constructor(readout, p = {}) {
      Object.assign(this, { base_tau: 90.0, forward_tau: 10.0, warmup: 0.5, enter_z: 2.5, exit_z: 1.0, min_rev: 1.0, max_rev: 5.0,
        speed_gain: 0.3, rev_speed_gain: 0.05, omega_z: 1.5, omega_after: 2.5, sd_floor: 0.02, shallow_turn: 0.6, shallow_time: 1.2, refractory: 4.0, dorsal_margin: 3.0, refr_lo: 6.0, refr_hi: 9.0, omega_lo: 110.0, omega_hi: 200.0,
        sd0: { reverse: 0.050, forward: 0.016, omega: 0.019, turn_ventral: 0.018, turn_dorsal: 0.025 } }, p);
      this.ro = readout; this.m = {}; this.v = {}; this.z = {};
      for (const k of KEYS) { this.m[k] = null; this.v[k] = this.sd0[k] * this.sd0[k]; this.z[k] = 0; }
      this.t = 0; this.reversing = false; this.rev_t = 0; this.peak_omega = 0; this.steer_t = 0; this.steer_sign = 0; this.refr_t = 0; this.omega_angle = 150;
    }
    step(brain, dt) {
      this.t += dt; const rates = {}, z = this.z;
      for (const k of KEYS) { rates[k] = brain.groupRate(this.ro[k]);
        z[k] = this.m[k] === null ? 0 : (rates[k] - this.m[k]) / (Math.sqrt(this.v[k]) + this.sd_floor); }
      let omega = 0;
      if (this.t > this.warmup) {
        if (this.refr_t > 0) this.refr_t -= dt;
        if (!this.reversing && this.refr_t <= 0 && z.reverse > this.enter_z) { this.reversing = true; this.rev_t = 0; this.peak_omega = 0; }
        else if (this.reversing) {
          this.rev_t += dt; this.peak_omega = Math.max(this.peak_omega, z.omega);
          if ((this.rev_t >= this.min_rev && z.reverse < this.exit_z) || this.rev_t >= this.max_rev) {
            this.reversing = false;
            const u = (rates.omega * 1e4) % 1; this.refr_t = this.refr_lo + (this.refr_hi - this.refr_lo) * u;
            this.omega_angle = this.omega_lo + (this.omega_hi - this.omega_lo) * ((rates.turn_ventral * 1e4) % 1);
            const side = (z.turn_dorsal - z.turn_ventral) > this.dorsal_margin ? -1 : 1;
            if (this.peak_omega > this.omega_z || this.rev_t > this.omega_after) omega = side;
            else { this.steer_t = this.shallow_time; this.steer_sign = side; }
          }
        }
      }
      if (!this.reversing && this.refr_t <= 0) {
        for (const k of KEYS) { const a = dt / (k === "forward" ? this.forward_tau : this.base_tau); if (this.m[k] === null) { this.m[k] = rates[k]; continue; }
          const d = rates[k] - this.m[k]; this.m[k] += a * d; this.v[k] = (1 - a) * (this.v[k] + a * d * d); } }
      const speed = this.reversing ? clamp(0.5 + this.rev_speed_gain * z.reverse, 0.4, 1) : clamp(0.5 + this.speed_gain * z.forward, 0.1, 1);
      let steer = 0; if (this.steer_t > 0) { this.steer_t -= dt; steer = this.shallow_turn * this.steer_sign; }
      return { reverse: this.reversing, speed, omega, steer, omega_angle: this.omega_angle };
    }
  }

  class WormBody {
    constructor(p = {}) {
      Object.assign(this, { n_seg: 24, length: 1.0, wavelength: 0.65, amplitude: 6.0, freq_max: 0.6, freq_min: 0.15, K: 30.0,
        steer_gain: 4.0, head_frac: 0.3, omega_curv: 10.0, omega_time: 2.0, reverse_freq_scale: 0.8, omega_angle: 150.0, turn_rate: 30.0 }, p);
      this.setup();
    }
    setup(x = 0, y = 0, heading = 0) {
      const n = this.n_seg; this.s = Float64Array.from({ length: n }, (_, i) => (i + 0.5) / n); this.ds = this.length / n;
      this.pos = [x, y]; this.ang = heading; this.phase = 0; this.omega_t = -1; this.omega_sign = 1; this.steer = 0; this.omegaEnv = 0;
      [this.sx, this.sy] = this._shape(this._kappa());
    }
    _kappa() {
      const n = this.n_seg, k = new Float64Array(n), L = this.length;
      const env = this.omega_t >= 0 ? Math.sin(Math.PI * Math.min(this.omega_t / this.omega_time, 1)) : 0;
      for (let i = 0; i < n; i++) {
        let v = this.amplitude / L * Math.sin(2 * Math.PI * this.s[i] / this.wavelength - this.phase);
        v += this.steer_gain / L * this.steer * clamp(1 - this.s[i] / this.head_frac, 0, 1);
        if (this.omega_t >= 0) { const q = (this.s[i] - 0.35) / 0.25; v += this.omega_sign * this.omega_curv / L * env * Math.exp(-q * q); }
        k[i] = v;
      }
      return k;
    }
    _shape(k) {
      const n = this.n_seg, ds = this.ds, xs = new Float64Array(n), ys = new Float64Array(n);
      let th = 0, px = 0, py = 0, cx = 0, cy = 0;
      for (let i = 0; i < n; i++) { th += k[i] * ds; const t = th - k[i] * ds / 2, tx = Math.cos(t), ty = Math.sin(t);
        px += tx * ds; py += ty * ds; xs[i] = px - tx * ds / 2; ys[i] = py - ty * ds / 2; cx += xs[i]; cy += ys[i]; }
      cx /= n; cy /= n;
      for (let i = 0; i < n; i++) { xs[i] = -(xs[i] - cx); ys[i] = -(ys[i] - cy); }
      return [xs, ys];
    }
    step(dt, speed = 0.5, reverse = false, steer = 0, omega = false, omegaSign = 1, omegaAngle = null) {
      if (omega && this.omega_t < 0) { this.omega_t = 0; this.omega_sign = omegaSign; this.omegaEnv = 0; this._omegaAngle = omegaAngle == null ? this.omega_angle : omegaAngle; }
      let f = this.freq_min + (this.freq_max - this.freq_min) * clamp(speed, 0, 1), dir = 1;
      if (reverse) { dir = -1; f *= this.reverse_freq_scale; }
      this.steer = clamp(steer, -1, 1); this.phase += 2 * Math.PI * f * dir * dt;
      if (this.omega_t >= 0) { this.omega_t += dt; if (this.omega_t > this.omega_time) this.omega_t = -1; }
      if (this.omega_t >= 0) { const env = 0.5 * (1 - Math.cos(Math.PI * Math.min(this.omega_t / this.omega_time, 1)));
        this.ang += this.omega_sign * (this._omegaAngle ?? this.omega_angle) * Math.PI / 180 * (env - this.omegaEnv); this.omegaEnv = env; } else this.omegaEnv = 0;
      this.ang += this.turn_rate * Math.PI / 180 * this.steer * dt;
      const [nx, ny] = this._shape(this._kappa()), n = this.n_seg;
      const ux = new Float64Array(n), uy = new Float64Array(n);
      for (let i = 0; i < n; i++) { ux[i] = (nx[i] - this.sx[i]) / dt; uy[i] = (ny[i] - this.sy[i]) / dt; }
      this.sx = nx; this.sy = ny; this._rft(ux, uy, dt);
    }
    _rft(ux, uy, dt) {
      const n = this.n_seg, c = Math.cos(this.ang), s = Math.sin(this.ang);
      const PX = new Float64Array(n), PY = new Float64Array(n), UX = new Float64Array(n), UY = new Float64Array(n);
      for (let i = 0; i < n; i++) { PX[i] = c * this.sx[i] - s * this.sy[i]; PY[i] = s * this.sx[i] + c * this.sy[i];
        UX[i] = c * ux[i] - s * uy[i]; UY[i] = s * ux[i] + c * uy[i]; }
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0], Ct = 1, Cn = this.K;
      for (let i = 0; i < n; i++) {
        let tx, ty;
        if (i === 0) { tx = PX[1] - PX[0]; ty = PY[1] - PY[0]; }
        else if (i === n - 1) { tx = PX[i] - PX[i - 1]; ty = PY[i] - PY[i - 1]; }
        else { tx = (PX[i + 1] - PX[i - 1]) / 2; ty = (PY[i + 1] - PY[i - 1]) / 2; }
        const nr = Math.hypot(tx, ty) + 1e-12; tx /= nr; ty /= nr;
        const d00 = Cn + (Ct - Cn) * tx * tx, d01 = (Ct - Cn) * tx * ty, d11 = Cn + (Ct - Cn) * ty * ty, rx = PX[i], ry = PY[i];
        const F = [[-d00, -d01, -(d00 * -ry + d01 * rx)], [-d01, -d11, -(d01 * -ry + d11 * rx)]];
        const F0x = -(d00 * UX[i] + d01 * UY[i]), F0y = -(d01 * UX[i] + d11 * UY[i]);
        for (let col = 0; col < 3; col++) { A[0][col] += F[0][col]; A[1][col] += F[1][col]; A[2][col] += rx * F[1][col] - ry * F[0][col]; }
        b[0] += F0x; b[1] += F0y; b[2] += rx * F0y - ry * F0x;
      }
      const det = M => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
      const D = det(A), y = [-b[0], -b[1], -b[2]], sol = [0, 0, 0];
      for (let k = 0; k < 3; k++) { const M = A.map(r => r.slice()); for (let r = 0; r < 3; r++) M[r][k] = y[r]; sol[k] = det(M) / D; }
      this.pos[0] += sol[0] * dt; this.pos[1] += sol[1] * dt; if (this.noRftRotation ? !this.replay : (this.omega_t < 0 || this.rftRotateAlways)) this.ang += sol[2] * dt;
    }
    worldPoints() { const c = Math.cos(this.ang), s = Math.sin(this.ang), out = [];
      for (let i = 0; i < this.n_seg; i++) out.push([c * this.sx[i] - s * this.sy[i] + this.pos[0], s * this.sx[i] + c * this.sy[i] + this.pos[1]]);
      return out; }
  }

  const api = { WormBrain, OnlineDecoder, WormBody, makeRng };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.WormCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

// ---------------------------------------------------------------------------------------------
// EigenBody: data-driven body. Not used by the game; needs a body model JSON that is not included.
(function (root) {
  "use strict";
  const api = (typeof module !== "undefined" && module.exports) ? module.exports : root.WormCore;
  // exact (s * 1103515245 + 12345) mod 2^31 without exceeding 2^53: split the multiplier into 16-bit halves
  const lcg = s => { const M = 2147483648, A = 1103515245, hi = Math.floor(A / 65536), lo = A % 65536;
    s = (((s * hi) % M) * 65536 + s * lo + 12345) % M; return [s, s / M]; };
  class EigenBody {
    constructor(model, p = {}, x = 0, y = 0, heading = 0) {
      Object.assign(this, { length: 1.0, K: 60.0, speed_min: 0.4, speed_max: 1.2, amp_tau: 0.4, turn_scale_omega: 1.0,
        turn_scale_shallow: 0.45, blend_in: 0.5, blend_out: 0.8, noise_scale: 1.0, noise3_scale: 0.3, curve_gain: 1.2, seed: 1 }, p);
      this.curve = 0;
      this.m = model; this.E = model.basis; this.n = model.n_angles; this.ds = this.length / this.n;
      const m3 = model.mode3_scale || 1; this.tmpl = model.turn_template.map(v => v * m3); this.tmplDt = model.turn_template_dt;
      this.library = model.turn_library.map(e => [e.frames.map(r => [r[0], r[1], r[2] * m3, r[3]]), e.peak_index]);
      this.libCum = this.library.map(([f]) => { let s = 0; const c = f.map(r => (s += Math.abs(r[2]))); return c.map(v => v / Math.max(1e-9, s)); });
      [this.tmpl4, this.peak4] = this.library[0]; this.ampScale = model.amp_scale || 1;
      this.pos = [x, y]; this.ang = heading; this.phi = 0; this.A = model.amp_fwd * this.ampScale;
      this.a3 = 0; this.a4 = 0; this.n3 = 0; this.n4 = 0; this.turn_t = -1; this.turnSide = 1; this.turnScale = 1;
      this.omega_t = -1; this.rng = this.seed; this.blend = 0; this.blend12 = 0; this.replay = null; this.turnElapsed = 0;
      this.rftRotateAlways = false; this.noRftRotation = true; this.turnTarget = 0; this.turnRamp = 0;   // heading follows an imposed ramp during a replayed coil (RFT under-rotates coils)
      this.sx = new Float64Array(this.n); this.sy = new Float64Array(this.n); this._shape(this.coeffs(), this.sx, this.sy);
    }
    coeffs() { return [this.A * Math.cos(this.phi), this.A * Math.sin(this.phi), this.a3 + this.n3 - this.curve_gain * this.curve, this.a4 + this.n4]; }
    _shape(a, xs, ys) {
      const n = this.n, E = this.E, th = new Float64Array(n); let mean = 0;
      for (let i = 0; i < n; i++) { th[i] = E[i][0] * a[0] + E[i][1] * a[1] + E[i][2] * a[2] + E[i][3] * a[3]; mean += th[i]; }
      mean /= n; let px = 0, py = 0, cx = 0, cy = 0;
      for (let i = 0; i < n; i++) { const t = th[i] - mean, tx = Math.cos(t), ty = Math.sin(t); px += tx * this.ds; py += ty * this.ds;
        xs[i] = px - tx * this.ds / 2; ys[i] = py - ty * this.ds / 2; cx += xs[i]; cy += ys[i]; }
      cx /= n; cy /= n; for (let i = 0; i < n; i++) { xs[i] = -(xs[i] - cx); ys[i] = -(ys[i] - cy); }
    }
    step(dt, speed = 0.5, reverse = false, steer = 0, omega = false, omegaSign = 1, omegaAngle = null, curve = 0) {
      const m = this.m; this.curve = Math.min(1, Math.max(-1, curve));
      if (omega && this.turn_t < 0) {
        this.turnSide = omegaSign; this.turnScale = this.turn_scale_omega;
        const u = omegaAngle == null ? 0 : Math.min(0.999, Math.max(0, (omegaAngle - 110) / 90));
        const li = Math.floor(u * this.library.length); [this.tmpl4, this.peak4] = this.library[li]; this.cum = this.libCum[li];
        this.turnTarget = (omegaAngle == null ? 150 : omegaAngle) * Math.PI / 180 * this.turnSide; this.turnRamp = 0;   // imposed net reorientation over the coil
        const cur = Math.atan2(Math.sin(this.phi), Math.cos(this.phi)); let best = 0, bd = 1e9;
        for (let i = 0; i < this.peak4; i++) { const c = this.tmpl4[i], ph = Math.atan2(c[1] * this.turnSide, c[0] * this.turnSide);
          const d = Math.abs((((ph - cur + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
          if (d < bd) { bd = d; best = i; } }
        this.turn_t = best * this.tmplDt; this.turnElapsed = 0;
      } else if (steer !== 0 && this.turn_t < 0) { this.turn_t = 0; this.turnSide = steer > 0 ? 1 : -1; this.turnScale = this.turn_scale_shallow; }
      const sc = this.speed_min + (this.speed_max - this.speed_min) * Math.min(1, Math.max(0, speed));
      let w, At;
      if (reverse) { w = m.omega_rev_deg_s * Math.PI / 180; At = m.amp_rev * this.ampScale; }
      else { w = m.omega_fwd_deg_s * Math.PI / 180 * sc; At = m.amp_fwd * this.ampScale; }
      this.phi += w * dt; this.A += (At - this.A) * Math.min(1, dt / this.amp_tau);
      this.blend = 0; this.blend12 = 0; this.replay = null;
      if (this.turn_t >= 0) {
        this.turn_t += dt; this.turnElapsed += dt;
        if (this.turnScale >= 0.99) {
          const T = (this.tmpl4.length - 1) * this.tmplDt, k = this.turn_t / this.tmplDt;
          if (this.turn_t >= T) { this.turn_t = -1; const last = this.tmpl4[this.tmpl4.length - 1];
            this.phi = Math.atan2(last[1] * this.turnSide, last[0] * this.turnSide); this.A = Math.hypot(last[0], last[1]); this._rotateAboutTail(this.turnTarget - this.turnRamp); this.turnRamp = this.turnTarget; }
          else { const i = Math.floor(k), f = k - i, a = this.tmpl4[i], b = this.tmpl4[i + 1];
            this.replay = [0, 1, 2, 3].map(j => this.turnSide * (a[j] + (b[j] - a[j]) * f));
            this.blend12 = Math.min(1, this.turnElapsed / this.blend_in); this.blend = Math.min(1, this.turnElapsed / this.blend_in, (T - this.turn_t) / this.blend_out);
            const ci = Math.min(this.cum.length - 1, k), c0 = this.cum[Math.floor(ci)], c1 = this.cum[Math.min(this.cum.length - 1, Math.floor(ci) + 1)], env = c0 + (c1 - c0) * (ci - Math.floor(ci));
            const tgt = this.turnTarget * env; this._rotateAboutTail(tgt - this.turnRamp); this.turnRamp = tgt; }
        } else { const k = this.turn_t / this.tmplDt;
          if (k >= this.tmpl.length - 1) { this.turn_t = -1; this.a3 = 0; }
          else { const i = Math.floor(k); this.a3 = this.turnSide * this.turnScale * (this.tmpl[i] + (this.tmpl[i + 1] - this.tmpl[i]) * (k - i)); } }
      }
      const coil = this.replay && Math.abs(this.replay[2]) > 0.4 * Math.abs(this.tmpl4[this.peak4][2]);
      this.omega_t = coil ? this.turn_t : -1;
      const tau = m.a34_tau_s, a = Math.min(1, dt / tau); let u1, u2, u3, u4;
      [this.rng, u1] = lcg(this.rng); [this.rng, u2] = lcg(this.rng);
      const g1 = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2);
      [this.rng, u3] = lcg(this.rng); [this.rng, u4] = lcg(this.rng);
      const g2 = Math.sqrt(-2 * Math.log(Math.max(u3, 1e-12))) * Math.cos(2 * Math.PI * u4);
      const s3 = m.a3_sd_fwd * this.noise3_scale, s4 = m.a4_sd_fwd * this.noise_scale;
      this.n3 += -a * this.n3 + s3 * Math.sqrt(2 * a) * g1; this.n4 += -a * this.n4 + s4 * Math.sqrt(2 * a) * g2;
      let c = this.coeffs();
      if (this.replay) { const w = [this.blend12, this.blend12, this.blend, this.blend]; c = c.map((v, j) => (1 - w[j]) * v + w[j] * this.replay[j]); }
      const nx = new Float64Array(this.n), ny = new Float64Array(this.n); this._shape(c, nx, ny);
      const ux = new Float64Array(this.n), uy = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) { ux[i] = (nx[i] - this.sx[i]) / dt; uy[i] = (ny[i] - this.sy[i]) / dt; }
      this.sx = nx; this.sy = ny; api.WormBody.prototype._rft.call(this, ux, uy, dt);
    }
    _rotateAboutTail(dth) { if (dth === 0) return; const c = Math.cos(this.ang), s = Math.sin(this.ang), i = Math.floor(0.8 * this.n);
      const px = c * this.sx[i] - s * this.sy[i] + this.pos[0], py = s * this.sx[i] + c * this.sy[i] + this.pos[1]; this.ang += dth;
      const c2 = Math.cos(dth), s2 = Math.sin(dth), dx = this.pos[0] - px, dy = this.pos[1] - py; this.pos[0] = px + c2 * dx - s2 * dy; this.pos[1] = py + s2 * dx + c2 * dy; }
    worldPoints() { return api.WormBody.prototype.worldPoints.call(this); }
    get n_seg() { return this.n; }
  }
  api.EigenBody = EigenBody;
})(typeof globalThis !== "undefined" ? globalThis : this);

// ---------------------------------------------------------------------------------------------
// SaltMemory: receptor-level salt-concentration memory on ASER -> AIB / AIY.
(function (root) {
  "use strict";
  const api = (typeof module !== "undefined" && module.exports) ? module.exports : root.WormCore;
  const E_I = 0.03, E_E = 10.0, KB = 3.0, BURST = 0.15, G_LO = 0.15, G_HI = 0.85;
  const H = (g, E) => g / (g + E);
  const W_E = BURST / (H(1.0, E_E) - H(1.0 - BURST, E_E));
  const resp = (g0, d, we, wi, glr1 = true) => { const g1 = Math.min(1, Math.max(0, g0 + d)); return (glr1 ? we * (H(g1, E_E) - H(g0, E_E)) : 0) - wi * (H(g1, E_I) - H(g0, E_I)); };
  let lo = 0, hi = 50; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (resp(0.5, BURST, W_E, mid) > 0) lo = mid; else hi = mid; }
  const W_I = (lo + hi) / 2;
  class SaltMemory {
    // brain: WormBrain (JS). Replaces the static Cook ASER->AIB/AIY synapses with the dynamic receptor model.
    constructor(brain, M = 0, valence = 1, glr1 = true) {
      this.b = brain; this.M = M; this.v = valence; this.glr1 = glr1; this.aser = brain.index["ASER"]; this.r0 = brain.d.consts ? 0.3 : 0.3;
      this.r0 = 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, (brain.xRest - brain.theta) / brain.beta))));   // resting rate
      this.posts = []; this.zeroed = [];
      for (const [name, kind] of [["AIBL", "aib"], ["AIBR", "aib"], ["AIYL", "aiy"], ["AIYR", "aiy"]]) {
        const i = brain.index[name];
        for (let k = 0; k < brain.wVal.length; k++) if (brain.wPre[k] === this.aser && brain.wPost[k] === i && brain.wVal[k] !== 0) {
          this.posts.push([i, kind, Math.abs(brain.wVal[k]), brain.wVal[k]]); this.zeroed.push([k, brain.wVal[k]]); brain.wVal[k] = 0; }
      }
    }
    restore() { for (const [k, w] of this.zeroed) this.b.wVal[k] = w; }
    g0(lnC) { return G_LO + (G_HI - G_LO) / (1 + Math.exp(-KB * (this.M - lnC))); }
    // adds the dynamic ASER->AIB/AIY input into inp (Float64Array), returns g0
    addInput(inp, lnC) {
      const g0 = this.g0(lnC), rA = this.b.rate(this.aser), d = BURST * (rA - this.r0) / (1 - this.r0);
      for (const [i, kind, mag, wStatic] of this.posts) {
        const r = kind === "aib" ? resp(g0, d, W_E, W_I, this.glr1) : -resp(g0, d, W_E, W_I, true);
        inp[i] += this.v * mag * (r / BURST) * (1 - this.r0) + wStatic * this.r0;
      }
      return g0;
    }
    static gain(g0, glr1 = true) { return resp(g0, BURST, W_E, W_I, glr1) / BURST; }
  }
  SaltMemory.W_E = W_E; SaltMemory.W_I = W_I;
  api.SaltMemory = SaltMemory;
})(typeof globalThis !== "undefined" ? globalThis : this);
