// Whip physics: a Verlet particle chain hanging off a rigid, wrist-driven handle.
// Units are px and seconds. Runs at a fixed 240 Hz so it feels the same on 60 and 120 Hz screens.
// The rope gets lighter toward the tip, which is what makes a real whip's tip outrun the hand.
// Loaded by overlay.html, and by test-physics.js under node for tuning.
(function (root) {
  const P = {
    dt: 1 / 240,
    gravity: 1400,
    handleLen: 64,
    segments: 26,         // rope links after the handle
    segLenBase: 22,       // link length near the handle
    segLenTip: 12,        // link length at the tip
    massBase: 1,
    massTip: 0.05,
    airDrag: 1.8,         // fraction of velocity lost per second
    maxStretch: 1.06,     // hard cap on link stretch
    iterations: 4,        // constraint passes per step
    bendBase: 0.5,        // shape memory near the handle (per 60 Hz frame)
    bendTip: 0.01,        // ...and at the tip (floppy)
    restAngle: 1.0,       // handle rest pose, radians above "forward"
    wristK: 500,          // wrist spring while idle
    wristZeta: 0.8,
    lashK: 12000,         // wrist spring during a scripted lash
    aimByVel: 0.0012,     // how much hand speed tilts the handle
    aimClamp: 1.6,
    crackSpeed: 4200,     // tip speed (px/s) that counts as a crack when swinging by hand
    crackCooldown: 0.45,  // long enough to skip the rebound after a lash
    spawnGrace: 0.35,     // no cracks right after spawning
    wallFriction: 0.5,
  };

  // Lash keyframes: [seconds, handle angle above forward, hand push forward in px]
  const LASH = [
    [0.00, null, 0],
    [0.14, 1.8, -20],   // wind up over the shoulder
    [0.28, -0.3, 60],   // snap forward, hand pushes through
    [0.53, null, 0],    // back to rest while the loop unrolls and cracks
  ];

  const smooth = t => t * t * (3 - 2 * t);
  const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

  class Whip {
    constructor(hx, hy, facing) {
      this.facing = facing;
      this.hand = { x: hx, y: hy };
      this.handVel = { x: 0, y: 0 };
      this.held = true;
      this.time = 0;
      this.lastCrack = -1;
      this.lashT = -1;
      this.lashFrom = P.restAngle;
      this.lashStart = -1;
      this.lashPending = false;
      this.prevTipSpeed = 0;
      this.tipSpeed = 0;
      this.onCrack = null;

      const n = P.segments + 2; // 0 = butt, 1 = handle tip, 2.. = rope
      this.n = n;
      this.x = new Float64Array(n); this.y = new Float64Array(n);
      this.px = new Float64Array(n); this.py = new Float64Array(n);
      this.w = new Float64Array(n);   // inverse mass
      this.len = new Float64Array(n); // rest length from i-1 to i
      this.bend = new Float64Array(n);
      for (let i = 2; i < n; i++) {
        const t = (i - 2) / (P.segments - 1);
        this.len[i] = P.segLenBase + (P.segLenTip - P.segLenBase) * t;
        this.w[i] = 1 / (P.massBase + (P.massTip - P.massBase) * Math.pow(t, 0.7));
        const b = P.bendBase + (P.bendTip - P.bendBase) * Math.pow(t, 0.5);
        this.bend[i] = 1 - Math.pow(1 - b, 60 * P.dt);
      }
      this.len[1] = P.handleLen;
      this.reach = this.len.reduce((a, b) => a + b, 0);

      this.angle = this.screenAngle(P.restAngle);
      this.angVel = 0;
      this.placeHandle();
      // Rope starts as a lazy arc curling forward and down.
      let a = this.angle;
      for (let i = 2; i < n; i++) {
        a += this.facing * 0.09;
        this.x[i] = this.x[i - 1] + Math.cos(a) * this.len[i];
        this.y[i] = this.y[i - 1] + Math.sin(a) * this.len[i];
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
      }
    }

    // Angle measured "above forward" -> screen angle (y down), mirrored by facing.
    screenAngle(phi) {
      return Math.atan2(-Math.sin(phi), this.facing * Math.cos(phi));
    }

    handlePhi() {
      return Math.atan2(-Math.sin(this.angle), this.facing * Math.cos(this.angle));
    }

    placeHandle(push = 0) {
      const bx = this.hand.x + this.facing * push;
      const by = this.hand.y;
      this.px[0] = this.x[0]; this.py[0] = this.y[0];
      this.px[1] = this.x[1]; this.py[1] = this.y[1];
      this.x[0] = bx; this.y[0] = by;
      this.x[1] = bx + Math.cos(this.angle) * P.handleLen;
      this.y[1] = by + Math.sin(this.angle) * P.handleLen;
    }

    get tip() { return { x: this.x[this.n - 1], y: this.y[this.n - 1] }; }

    lash() {
      if (!this.held) return;
      this.lashT = 0;
      this.lashFrom = this.handlePhi();
      this.lashStart = this.time;
      this.lashPending = true;
    }

    drop() {
      if (!this.held) return;
      this.held = false;
      this.w[0] = 2; this.w[1] = 2;
      this.len[1] = P.handleLen;
    }

    // Hand position from the mouse, once per rendered frame.
    moveHand(x, y, frameDt) {
      if (frameDt > 0) {
        const k = Math.min(1, frameDt * 20);
        this.handVel.x += ((x - this.hand.x) / frameDt - this.handVel.x) * k;
        this.handVel.y += ((y - this.hand.y) / frameDt - this.handVel.y) * k;
      }
      this.hand.x = x; this.hand.y = y;
    }

    // Turn to face the other way (the handle swings over on its own).
    setFacing(f) { this.facing = f; }

    wrist(dt) {
      let phi = P.restAngle, k = P.wristK, push = 0;
      if (this.lashT >= 0) {
        this.lashT += dt;
        const t = this.lashT;
        const last = LASH[LASH.length - 1];
        if (t >= last[0]) {
          this.lashT = -1;
        } else {
          let j = 1;
          while (LASH[j][0] < t) j++;
          const [t0, a0, p0] = LASH[j - 1];
          const [t1, a1, p1] = LASH[j];
          const s = smooth((t - t0) / (t1 - t0));
          const from = a0 === null ? this.lashFrom : a0;
          const to = a1 === null ? P.restAngle : a1;
          phi = from + (to - from) * s;
          push = p0 + (p1 - p0) * s;
          k = P.lashK;
        }
      }
      if (this.lashT < 0) {
        // Handle leans into the hand's motion: flick forward = strike, pull back = wind up.
        const fwd = this.handVel.x * this.facing;
        const tilt = -fwd * P.aimByVel - this.handVel.y * P.aimByVel * 0.7;
        phi += Math.max(-P.aimClamp, Math.min(P.aimClamp, tilt));
      }
      const target = this.screenAngle(phi);
      const c = 2 * Math.sqrt(k) * P.wristZeta;
      this.angVel += (k * wrapPi(target - this.angle) - c * this.angVel) * dt;
      this.angle = wrapPi(this.angle + this.angVel * dt);
      return push;
    }

    step(W, H) {
      const dt = P.dt;
      this.time += dt;
      const n = this.n;
      const start = this.held ? 2 : 0;
      if (this.held) this.placeHandle(this.wrist(dt));

      const keep = Math.max(0, 1 - P.airDrag * dt);
      const g = P.gravity * dt * dt;
      for (let i = start; i < n; i++) {
        const vx = (this.x[i] - this.px[i]) * keep;
        const vy = (this.y[i] - this.py[i]) * keep;
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
        this.x[i] += vx;
        this.y[i] += vy + g;
      }

      for (let it = 0; it < P.iterations; it++) {
        for (let i = this.held ? 2 : 1; i < n; i++) {
          const dx = this.x[i] - this.x[i - 1], dy = this.y[i] - this.y[i - 1];
          const d = Math.hypot(dx, dy) || 1e-6;
          const wa = this.w[i - 1], wb = this.w[i];
          const corr = (d - this.len[i]) / (d * (wa + wb));
          this.x[i - 1] += dx * corr * wa; this.y[i - 1] += dy * corr * wa;
          this.x[i] -= dx * corr * wb; this.y[i] -= dy * corr * wb;
        }
        // Bending: pull each middle point toward the midpoint of its neighbours. Weighted by
        // inverse mass so it moves the rope without adding momentum.
        for (let i = 2; i < n; i++) {
          const wa = this.w[i - 2], wm = this.w[i - 1], wb = this.w[i];
          const sum = 0.25 * wa + wm + 0.25 * wb;
          if (sum === 0) continue;
          const cx = this.x[i - 1] - (this.x[i - 2] + this.x[i]) / 2;
          const cy = this.y[i - 1] - (this.y[i - 2] + this.y[i]) / 2;
          const k = (this.held ? this.bend[i] : this.bend[i] * 0.3) / sum;
          this.x[i - 2] += 0.5 * wa * k * cx; this.y[i - 2] += 0.5 * wa * k * cy;
          this.x[i - 1] -= wm * k * cx;       this.y[i - 1] -= wm * k * cy;
          this.x[i] += 0.5 * wb * k * cx;     this.y[i] += 0.5 * wb * k * cy;
        }
      }

      if (this.held) {
        for (let i = 2; i < n; i++) {
          let hit = false;
          if (this.x[i] < 0) { this.x[i] = 0; hit = true; }
          else if (this.x[i] > W) { this.x[i] = W; hit = true; }
          if (this.y[i] < 0) { this.y[i] = 0; hit = true; }
          else if (this.y[i] > H) { this.y[i] = H; hit = true; }
          if (hit) {
            this.px[i] += (this.x[i] - this.px[i]) * P.wallFriction;
            this.py[i] += (this.y[i] - this.py[i]) * P.wallFriction;
          }
        }
      }

      // Follow-the-leader pass: no link may stretch past maxStretch. Soaks up the
      // rubber-band spikes the solver leaves when the tip is 20x lighter than the base.
      for (let i = this.held ? 2 : 1; i < n; i++) {
        const dx = this.x[i] - this.x[i - 1], dy = this.y[i] - this.y[i - 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const max = this.len[i] * P.maxStretch;
        if (d > max) {
          this.x[i] = this.x[i - 1] + dx / d * max;
          this.y[i] = this.y[i - 1] + dy / d * max;
        }
      }

      const t = n - 1;
      this.prevTipSpeed = this.tipSpeed;
      this.tipSpeed = Math.hypot(this.x[t] - this.px[t], this.y[t] - this.py[t]) / dt;
      if (this.held) this.detectCrack(this.x[t], this.y[t]);
    }

    detectCrack(tx, ty) {
      // A clicked lash always cracks once: when the loop has rolled out to (nearly) full
      // reach, like a real whip. If a wall or the floor stops it, crack at the end anyway.
      if (this.lashPending) {
        const age = this.time - this.lashStart;
        if (age < LASH[2][0]) return;
        const extended = Math.hypot(tx - this.x[0], ty - this.y[0]) > this.reach * 0.8;
        if (extended || age > LASH[LASH.length - 1][0] + 0.13) {
          this.lashPending = false;
          this.crack(tx, ty, this.tipSpeed);
        }
        return;
      }
      if (
        this.tipSpeed > P.crackSpeed && this.prevTipSpeed <= P.crackSpeed &&
        this.time > P.spawnGrace && this.time - this.lastCrack > P.crackCooldown
      ) {
        this.crack(tx, ty, this.tipSpeed);
      }
    }

    crack(x, y, speed) {
      this.lastCrack = this.time;
      if (this.onCrack) this.onCrack(x, y, speed);
    }

    // Everything below the bottom edge?
    gone(H) {
      for (let i = 0; i < this.n; i++) if (this.y[i] < H + 80) return false;
      return true;
    }
  }

  const api = { Whip, P, LASH };
  if (typeof module !== 'undefined') module.exports = api;
  else root.WhipPhysics = api;
})(this);
