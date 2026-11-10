// Signal tools for the showreel score. Everything is calculated: oscillators,
// seeded noise, recursive filters and delay lines. No samples, no loops, no
// instrument bank. Buffers are mono Float32Array unless a name says stereo.
import {RATE} from '../synth.mjs';

export {RATE};
export const TAU = Math.PI * 2;
export const hz = note => 440 * 2 ** ((note - 69) / 12);
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
export const db = value => 10 ** (value / 20);

/** Seeded generator of numbers in [0, 1). */
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Oscillators. Each returns a function of frequency that advances one sample.
// Saw and pulse use polyBLEP, so high notes do not alias into the mids.
const blep = (t, dt) => (t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0);
export function saw(phase = 0) {
  return f => { const dt = f / RATE; phase += dt; if (phase >= 1) phase -= 1; return 2 * phase - 1 - blep(phase, dt); };
}
export function pulse(width = .5, phase = 0) {
  return f => {
    const dt = f / RATE; phase += dt; if (phase >= 1) phase -= 1;
    let second = phase + 1 - width; if (second >= 1) second -= 1;
    return (phase < width ? 1 : -1) + blep(phase, dt) - blep(second, dt);
  };
}
export function sine(phase = 0) {
  return f => { phase += f / RATE; if (phase >= 1) phase -= 1; return Math.sin(TAU * phase); };
}

/**
 * State-variable filter (trapezoidal). `set` is cheap to skip: callers update
 * the cutoff every 16 samples, which is far above any envelope they use.
 */
export function filter() {
  let s1 = 0, s2 = 0, a1 = 0, a2 = 0, a3 = 0, k = 1;
  const f = {
    low: 0, band: 0, high: 0,
    set(cutoff, q = .707) {
      const g = Math.tan(Math.PI * clamp(cutoff, 16, RATE * .45) / RATE); k = 1 / q;
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2; return f;
    },
    run(x) {
      const v3 = x - s2, v1 = a1 * s1 + a2 * v3, v2 = s2 + a2 * s1 + a3 * v3;
      s1 = 2 * v1 - s1; s2 = 2 * v2 - s2;
      f.low = v2; f.band = v1; f.high = x - k * v1 - v2; return v2;
    },
  };
  return f.set(1000);
}

/** RBJ biquad for the mix: 'highpass', 'lowshelf', 'highshelf' or 'peak'. */
export function biquad(type, freq, gainDb = 0, q = .707) {
  const A = 10 ** (gainDb / 40), w = TAU * freq / RATE, cos = Math.cos(w), sin = Math.sin(w), alpha = sin / (2 * q);
  let b0, b1, b2, a0, a1, a2;
  if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
  else if (type === 'peak') { b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; }
  else {
    const root = 2 * Math.sqrt(A) * alpha, sign = type === 'lowshelf' ? 1 : -1;
    b0 = A * ((A + 1) - sign * (A - 1) * cos + root); b1 = sign * 2 * A * ((A - 1) - sign * (A + 1) * cos); b2 = A * ((A + 1) - sign * (A - 1) * cos - root);
    a0 = (A + 1) + sign * (A - 1) * cos + root; a1 = -sign * 2 * ((A - 1) + sign * (A + 1) * cos); a2 = (A + 1) + sign * (A - 1) * cos - root;
  }
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return x => { const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}

/** Renders `seconds` of a voice: fn(t, i) gives one sample. A 3 ms fade ends it without a click. */
export function render(seconds, fn) {
  const n = Math.max(2, Math.round(seconds * RATE)), out = new Float32Array(n), fade = RATE * .003;
  for (let i = 0; i < n; i++) out[i] = fn(i / RATE, i) * Math.min(1, (n - 1 - i) / fade);
  return out;
}
export const reversed = data => Float32Array.from(data).reverse();

/** A stereo bus of the whole piece. */
export function bus(count) {
  return {left: new Float32Array(count), right: new Float32Array(count)};
}
/**
 * Adds a mono voice to a bus at a sample offset. `pan` is -1 to 1, or a pair
 * [from, to] for a sound that crosses the picture. Equal-power law.
 */
export function place(target, data, start, gain = 1, pan = 0) {
  const count = target.left.length, from = Math.max(0, -start), to = Math.min(data.length, count - start), moving = Array.isArray(pan);
  let gl = 0, gr = 0;
  const setPan = p => { const a = clamp((p + 1) / 2) * Math.PI / 2; gl = Math.cos(a) * gain; gr = Math.sin(a) * gain; };
  if (!moving) setPan(pan);
  for (let i = from; i < to; i++) {
    if (moving && (i & 31) === 0) setPan(lerp(pan[0], pan[1], i / data.length));
    target.left[start + i] += data[i] * gl; target.right[start + i] += data[i] * gr;
  }
}
/** Adds a stereo pair [left, right] of equal length. */
export function placeStereo(target, pair, start, gain = 1) {
  const count = target.left.length, from = Math.max(0, -start), to = Math.min(pair[0].length, count - start);
  for (let i = from; i < to; i++) { target.left[start + i] += pair[0][i] * gain; target.right[start + i] += pair[1][i] * gain; }
}
export function addBus(target, source, gain = 1) {
  for (let i = 0; i < target.left.length; i++) { target.left[i] += source.left[i] * gain; target.right[i] += source.right[i] * gain; }
}

// A delay line with taps, for the reverb.
function line(length) {
  const data = new Float32Array(Math.max(2, Math.round(length))), n = data.length; let at = 0;
  return {
    n,
    read: back => data[(at - Math.min(n - 1, Math.max(1, Math.round(back))) + n) % n],
    // Linear interpolation for the two modulated delays.
    readAt(back) { const whole = Math.floor(back), frac = back - whole, a = data[(at - whole + n) % n], b = data[(at - whole - 1 + n) % n]; return a + (b - a) * frac; },
    write(x) { data[at] = x; at = at + 1 === n ? 0 : at + 1; },
  };
}

/**
 * Plate reverb after Dattorro (1997): four input diffusers into a figure-eight
 * tank with two modulated all-passes. `decay` 0 to 1 sets the tail (a number,
 * or a function of the sample index for a tail that changes), `damping` 0 to 1
 * darkens it, `predelay` is in seconds. Returns a new wet bus.
 */
export function plate(source, {decay = .5, damping = .3, predelay = .012, bandwidth = .9, clearAt = -1} = {}) {
  const count = source.left.length, wet = bus(count), k = RATE / 29761;
  const pre = line(predelay * RATE + 2), diffusers = [[142, .75], [107, .75], [379, .625], [277, .625]].map(([n, g]) => ({d: line(n * k + 1), n: n * k, g}));
  const make = () => ({
    ap1: line(1000 * k), d1: line(4500 * k), ap2: line(2700 * k), d2: line(3800 * k), damp: 0,
  });
  let L = make(), R = make(), band = 0, crossL = 0, crossR = 0, phase = 0, amount = typeof decay === 'function' ? decay(0) : decay;
  const lengths = {L: [672, 4453, 1800, 3720], R: [908, 4217, 2656, 3163]};
  const side = (t, len, input, wobble) => {
    // Modulated all-pass, delay, damping, decay, all-pass, delay, decay.
    const back = len[0] * k + wobble, d = t.ap1.readAt(back), v = input + .7 * d; t.ap1.write(v);
    const a = d - .7 * v;
    const d1 = t.d1.read(len[1] * k); t.d1.write(a);
    t.damp = d1 * (1 - damping) + t.damp * damping;
    const x = t.damp * amount, d2 = t.ap2.read(len[2] * k), w = x - .5 * d2; t.ap2.write(w);
    const b = d2 + .5 * w, out = t.d2.read(len[3] * k); t.d2.write(b);
    return out * amount;
  };
  for (let i = 0; i < count; i++) {
    if (i === clearAt) { L = make(); R = make(); band = 0; crossL = 0; crossR = 0; }
    if (typeof decay === 'function' && (i & 255) === 0) amount = decay(i);
    let x = (source.left[i] + source.right[i]) * .5;
    const delayed = pre.read(predelay * RATE); pre.write(x);
    band += bandwidth * (delayed - band); x = band;
    for (const stage of diffusers) { const d = stage.d.read(stage.n), v = x - stage.g * d; stage.d.write(v); x = d + stage.g * v; }
    phase += 1 / RATE; const wobble = 8 * k * Math.sin(TAU * .9 * phase);
    const outL = side(L, lengths.L, x + crossR, wobble), outR = side(R, lengths.R, x + crossL, -wobble);
    crossL = outL; crossR = outR;
    wet.left[i] = .6 * (R.d1.read(266 * k) + R.d1.read(2974 * k) - R.ap2.read(1913 * k) + R.d2.read(1996 * k) - L.d1.read(1990 * k) - L.ap2.read(187 * k) - L.d2.read(1066 * k));
    wet.right[i] = .6 * (L.d1.read(353 * k) + L.d1.read(3627 * k) - L.ap2.read(1228 * k) + L.d2.read(2673 * k) - R.d1.read(2111 * k) - R.ap2.read(335 * k) - R.d2.read(121 * k));
  }
  return wet;
}

/** Ping-pong echo: `time` in samples, filtered feedback. Returns a new wet bus. */
export function echo(source, time, {feedback = .35, low = 3800, high = 350, clearAt = -1} = {}) {
  const count = source.left.length, wet = bus(count), lp = [filter().set(low), filter().set(low)], hp = [filter().set(high), filter().set(high)];
  for (let i = time; i < count; i++) {
    // Echoes of the music before `clearAt` do not ring into what follows it.
    const dead = clearAt >= 0 && i >= clearAt && i - time < clearAt;
    const l = dead ? 0 : source.right[i - time] + wet.right[i - time] * feedback, r = dead ? 0 : source.left[i - time] + wet.left[i - time] * feedback;
    hp[0].run(lp[0].run(l)); hp[1].run(lp[1].run(r));
    wet.left[i] = hp[0].high; wet.right[i] = hp[1].high;
  }
  return wet;
}

/** Feed-forward compressor on a bus, in place. Threshold in dB, times in seconds. */
export function compress(target, {threshold = -18, ratio = 2, attack = .02, release = .15, makeup = 0} = {}) {
  const up = Math.exp(-1 / (attack * RATE)), down = Math.exp(-1 / (release * RATE)), gain = db(makeup); let env = 0;
  for (let i = 0; i < target.left.length; i++) {
    const level = Math.max(Math.abs(target.left[i]), Math.abs(target.right[i]));
    env = level > env ? level + (env - level) * up : level + (env - level) * down;
    const over = 20 * Math.log10(Math.max(env, 1e-9)) - threshold, g = over > 0 ? db(-over * (1 - 1 / ratio)) * gain : gain;
    target.left[i] *= g; target.right[i] *= g;
  }
}

/** Look-ahead peak limiter on a bus, in place. `ceiling` is a linear level. */
export function limit(target, ceiling = .89, lookahead = .004, release = .09) {
  const count = target.left.length, ahead = Math.round(lookahead * RATE), need = new Float32Array(count);
  for (let i = 0; i < count; i++) { const peak = Math.max(Math.abs(target.left[i]), Math.abs(target.right[i])); need[i] = peak > ceiling ? ceiling / peak : 1; }
  // The gain at each sample is the lowest gain needed in the window ahead, then it recovers slowly.
  const coef = Math.exp(-1 / (release * RATE)); let gain = 1;
  for (let i = 0; i < count; i++) {
    let low = 1;
    for (let j = i; j < Math.min(count, i + ahead); j++) if (need[j] < low) low = need[j];
    gain = low < gain ? low : low + (gain - low) * coef;
    target.left[i] *= gain; target.right[i] *= gain;
  }
}

/** Mean level of a range of a bus, in dBFS (plain RMS of both channels). */
export function level(target, from = 0, to = target.left.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += target.left[i] ** 2 + target.right[i] ** 2;
  return 10 * Math.log10(Math.max(sum / (2 * Math.max(1, to - from)), 1e-12));
}
