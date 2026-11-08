// The pull: how fast you tap decides how far the rope comes your way, with a steep ceiling.
//
// The rope always heads for a target set by your tap rate over the last WINDOW seconds:
//   target = 1 - exp(-(rate / R0)^2)      (metres, never quite 1)
// It rises toward it with time constant RISE and slides back with FALL when you slow down,
// so only the position at the whistle counts and an extra second of mashing adds less and less.

export const ROUND = 6;          // seconds of pulling
export const WINDOW = 1.2;       // seconds of taps that count toward the rate
export const R0 = 11.5;          // taps per second for 63% of a metre
export const RISE = 0.6, FALL = 1.1;
export const PC_BOOST = 1.35;    // a mouse or a space bar is slower than two thumbs

export const target = rate => 1 - Math.exp(-Math.pow(rate / R0, 2));

export function makePull(pc){
  const taps = [];
  let x = 0;
  return {
    tap(t){ taps.push(t); },
    rate(t){ while (taps.length && taps[0] < t - WINDOW) taps.shift(); return taps.length / WINDOW * (pc ? PC_BOOST : 1); },
    step(t, dt){
      const want = target(this.rate(t));
      x += (want - x) * (1 - Math.exp(-dt / (want > x ? RISE : FALL)));
      return x;
    },
    get x(){ return x; },
  };
}

// metres for a steady tapper (with timing jitter), for tuning: node tools/check.mjs
export function simulate(rate, pc, jitter = 0.25, seed = 1, stopAt = 99){
  let r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const p = makePull(pc), dt = 1 / 60;
  let next = 0.2 + rnd() / rate;
  for (let t = 0; t < ROUND; t += dt) {
    while (next <= t && t < stopAt) { p.tap(next); next += (1 + (rnd() * 2 - 1) * jitter) / rate; }
    p.step(t, dt);
  }
  return p.x;
}
