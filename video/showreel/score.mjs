// The showreel score and its sound design, second version.
//
// Music: filter house at 128 BPM in A major. The harmony is the loop
// D maj9, E 6/9, C# m7, F# m9 (IV, V, iii, vi), one chord a bar, so each scene
// is one turn of it. The loop never lands on A, the home chord, until the
// title: 37 seconds of leaning forward, then one arrival. The opening builds
// the badge on the first four notes of the hook, the drop states the hook, and
// the last three words of the film are the A major chord, one note a word.
//
// Sound design: every picture event has a designed sound placed where the
// event is on screen, tuned to the key when it has a pitch. The exposure dips
// of the picture are filter dips in the music.
//
// Every sample is calculated here and in audio-kit.mjs. No recording, sample
// pack, loop or borrowed melody is used.
import {RATE, TAU, hz, lerp, smooth, random, saw, pulse, sine, filter, biquad, render, reversed, bus, place, placeStereo, plate, echo, compress, limit} from './audio-kit.mjs';

// Voicings, as MIDI notes. `root` is the bass note.
export const CHORDS = {
  D: {root: 38, notes: [54, 57, 61, 64]},
  E: {root: 40, notes: [56, 59, 61, 66]},
  Cm: {root: 37, notes: [56, 59, 64, 68]},
  Fm: {root: 42, notes: [57, 61, 64, 68]},
  A: {root: 33, notes: [57, 59, 61, 64, 69]},
};
/** One chord for each of the 24 bars. Bars 7 to 10 are replaced by CLIMB. */
export const PROGRESSION = ['Fm', 'E', 'D', 'E', 'Cm', 'Fm', 'D', 'E', 'Fm', 'Fm', 'D', 'E', 'Cm', 'Fm', 'D', 'E', 'Fm', 'E', 'D', 'E', 'A', 'A', 'A', 'A'];
// The six style changes climb: one chord every two beats, top line E F# A B C# E.
export const CLIMB = [
  {root: 38, notes: [54, 57, 61, 64]}, {root: 40, notes: [56, 59, 61, 66]}, {root: 42, notes: [57, 61, 64, 69]},
  {root: 45, notes: [61, 64, 69, 71]}, {root: 47, notes: [62, 66, 69, 73]}, {root: 49, notes: [64, 68, 71, 76]},
];
// The hook: [sixteenth, note, length in sixteenths] for one bar on each chord.
// Every bar opens with the 3 + 3 + 2 figure.
export const HOOK = {
  D: [[0, 78, 3], [3, 76, 3], [6, 73, 2], [8, 76, 6], [14, 73, 2]],
  E: [[0, 71, 3], [3, 73, 3], [6, 76, 2], [8, 78, 4], [12, 80, 2], [14, 76, 2]],
  Cm: [[0, 80, 3], [3, 76, 3], [6, 73, 2], [8, 71, 4], [12, 73, 4]],
  Fm: [[0, 69, 3], [3, 73, 3], [6, 76, 2], [8, 78, 8]],
};
export const SCALE = [69, 71, 73, 76, 78, 81, 83, 85, 88];
/** The harmony voice under a hook note: the nearest tone of the bar's chord, a minor third or more below it. */
export const under = (note, name) => {
  const tones = new Set([CHORDS[name].root, ...CHORDS[name].notes].map(n => n % 12));
  let n = note - 3; while (!tones.has(n % 12)) n--;
  return n;
};

// Balance of the buses in the mix. Found by measurement: see the section table in the README.
const TRIM = {drums: 1, bass: .7, chords: 2.1, lead: 2.3, pad: .9, fx: 1.25, wet: 1.35, master: .74};

export function compose(clock, {stems = false} = {}) {
  const count = Math.round(clock.duration / clock.fps * RATE), beat = 60 / clock.bpm, q = clock.cues;
  const B = b => Math.round(b * beat * RATE), S = frame => Math.round(frame / clock.fps * RATE), step = beat / 4;
  const rnd = random(clock.seed), noise = () => rnd() * 2 - 1;
  const drums = bus(count), bass = bus(count), chords = bus(count), lead = bus(count), pad = bus(count), fx = bus(count);
  const room = bus(count), hall = bus(count), taps = bus(count);
  const events = [], mark = (kind, frame) => events.push({kind, frame});
  const title = B(80), cut = S(clock.silence[0]);

  // Sends: a short plate for drums and effects, a long hall, and a tempo echo.
  const voice = (target, data, at, gain, pan = 0, sends = {}) => {
    place(target, data, at, gain, pan);
    if (sends.room) place(room, data, at, gain * sends.room, pan);
    if (sends.hall) place(hall, data, at, gain * sends.hall, pan);
    if (sends.echo) place(taps, data, at, gain * sends.echo, pan);
  };

  // ---------------------------------------------------------------- drums
  const kick = (weight = 1) => { let ph = 0; const hp = filter().set(1800); return render(.42, t => {
    // Tuned to F#1, the bass note of the home minor chord.
    ph += TAU * (46.25 + 115 * Math.exp(-t / .032) + 260 * Math.exp(-t / .005)) / RATE;
    hp.run(noise());
    const body = Math.sin(ph) * Math.min(1, t / .0015) * Math.exp(-t / (.17 * weight)), click = hp.high * .22 * Math.exp(-t / .004);
    return Math.tanh((body + click) * 1.7) / 1.25; }); };
  const clap = () => { const bp = filter().set(1500, 1.1), bp2 = filter().set(3400, 1.4); return render(.36, t => {
    let env = 0; for (const o of [0, .011, .021]) if (t >= o) env += .8 * Math.exp(-(t - o) / .004);
    if (t >= .031) env += Math.exp(-(t - .031) / .075);
    const n = noise(); bp.run(n); bp2.run(n); return (bp.band * 1.2 + bp2.band * .7) * env; }); };
  const snare = (tone = 190) => { const hp = filter().set(1600), lp = filter().set(7500); return render(.26, t => {
    hp.run(noise()); const n = lp.run(hp.high);
    return (Math.sin(TAU * tone * t) * .6 + Math.sin(TAU * tone * 1.78 * t) * .25) * Math.exp(-t / .045) + n * Math.exp(-t / .09); }); };
  const hat = (decay = .03) => {
    // Six detuned squares, as a metal source, mixed with noise and high-passed.
    const osc = [2, 3, 4.16, 5.43, 6.79, 8.21].map(() => pulse(.5, rnd())), ratios = [2, 3, 4.16, 5.43, 6.79, 8.21], hp = filter().set(7800, .9), bp = filter().set(10200, 1.6);
    return render(decay * 6, t => { let m = 0; for (let i = 0; i < 6; i++) m += osc[i](ratios[i] * 270);
      hp.run(m / 6 * .7 + noise() * .5); bp.run(hp.high); return (hp.high * .5 + bp.band) * Math.exp(-t / decay) * Math.min(1, t / .0008); }); };
  const shaker = () => { const bp = filter().set(6200, .9); return render(.09, t => { bp.run(noise()); return bp.band * Math.min(1, t / .008) * Math.exp(-t / .03); }); };
  const tom = note => { let ph = 0; const f = hz(note); return render(.34, t => { ph += TAU * f * (1 + .6 * Math.exp(-t / .028)) / RATE;
    return (Math.sin(ph) + .2 * Math.sin(ph * 1.59)) * Math.exp(-t / .13) * Math.min(1, t / .002) + noise() * .1 * Math.exp(-t / .01); }); };
  const crash = (len = 1.8) => { const osc = [3.1, 4.7, 5.9, 7.3, 9.1].map(() => pulse(.5, rnd())), hp = filter().set(4200, .7), lp = filter(); return render(len, (t, i) => {
    if ((i & 63) === 0) lp.set(11000 - 5000 * t / len, .6);
    let m = 0; [3.1, 4.7, 5.9, 7.3, 9.1].forEach((r, k) => { m += osc[k](r * 410); });
    hp.run(m / 5 * .5 + noise() * .8); return lp.run(hp.high) * Math.exp(-t / (len * .32)) * Math.min(1, t / .002); }); };
  const impact = (size = 1) => { let ph = 0; const lp = filter(); return render(1.3 * size + .5, (t, i) => {
    if ((i & 15) === 0) lp.set(220 + 3200 * Math.exp(-t / .05), .7);
    ph += TAU * (34 + 80 * Math.exp(-t / .08)) / RATE;
    return Math.tanh((Math.sin(ph) * Math.exp(-t / (.5 * size)) * Math.min(1, t / .002) + lp.run(noise()) * .7 * Math.exp(-t / (.18 * size))) * 1.4) / 1.2; }); };

  const K = kick(), KS = kick(.7), CL = [clap(), clap(), clap()], SN = snare(), SN2 = snare(236), HC = [hat(.022), hat(.03), hat(.026)], HO = hat(.12), SH = shaker(), CR = crash(), CR2 = crash(2.6);
  // The pump: music ducks under each kick and swells back, the breathing of house music.
  const pump = new Float32Array(count).fill(1);
  const duck = (at, depth) => { const n = Math.round(.42 * beat * RATE); for (let i = 0; i < n && at + i < count; i++) { const v = 1 - depth * (1 - smooth(i / n)) * Math.min(1, i / 96); if (v < pump[at + i]) pump[at + i] = v; } };
  const swing = s => (s % 2 ? .1 : 0);
  // Which bars carry which layers.
  const full = bar => (bar >= 3 && bar <= 9) || bar === 13 || bar === 14 || bar >= 19;
  for (let bar = 3; bar <= 20; bar++) {
    const s = 4 * (bar - 1), peak = bar >= 19, light = bar === 11 || bar === 12, open = bar === 15 || bar === 16, build = bar === 17 || bar === 18, thin = bar === 10;
    let kicks = full(bar) ? [0, 1, 2, 3] : [];
    if (thin) kicks = [0];
    if (light) kicks = [0, 2.5];
    if (bar === 17) kicks = [0, 1, 2, 3];
    if (bar === 18) kicks = [0, .5, 1, 1.5, 2, 2.5, 3, 3.5];
    if (bar === 6 || bar === 14) kicks = [0, 1, 2, 3, 3.5];
    for (const k of kicks) { const soft = light || build; place(drums, soft ? KS : K, B(s + k), soft ? .62 : .9 + (peak ? .06 : 0)); duck(B(s + k), soft ? .35 : .62); }
    if (full(bar) || light) for (const k of [1, 3]) { if (light && k === 1) continue; voice(drums, CL[(bar + k) % 3], B(s + k), peak ? .8 : .68, 0, {room: .22}); }
    if (bar >= 7 && bar <= 9 || peak) for (const k of [1, 3]) place(drums, SN, B(s + k), .16);
    // Hats: sixteenths with an accent on the off-beat and a little swing.
    if (full(bar) || light) for (let i = 0; i < 16; i++) {
      const accent = [.34, .16, .62, .2][i % 4] * (light ? .6 : 1) * (peak ? 1.12 : 1);
      place(drums, HC[i % 3], B(s + (i + swing(i)) / 4), accent * (.46 + rnd() * .05), i % 2 ? .22 : -.12);
    }
    if ((bar >= 5 && bar <= 9) || bar === 14 || peak) for (const k of [.5, 1.5, 2.5, 3.5]) place(drums, HO, B(s + k), .18, .15);
    else if (bar === 3 || bar === 4 || bar === 13) place(drums, HO, B(s + 3.5), .12, .15);
    if (bar >= 13 && bar <= 14 || peak || light) for (let i = 0; i < 16; i++) place(drums, SH, B(s + (i + swing(i)) / 4), (i % 4 === 2 ? .2 : .1) * (.9 + rnd() * .2), -.35);
    // Tuned hand percussion: a quiet syncopated answer to the kick.
    if (full(bar) && !peak) for (const [k, note] of [[.75, 57], [1.75, 61], [2.75, 57], [3.25, 64]]) place(drums, tom(note), B(s + k), .1, k > 2 ? .4 : -.4);
    if (open) for (const k of [0, 2.5]) { place(drums, KS, B(s + k), .5); duck(B(s + k), .3); }
  }
  // Fills. Bar 2 into the drop, bar 6, bar 14, and the long roll of bars 17 and 18.
  for (let i = 0; i < 8; i++) voice(drums, i % 2 ? SN2 : SN, B(6 + i / 4), .12 + i * .035, (i - 3.5) * .08, {room: .15});
  for (let i = 0; i < 4; i++) voice(drums, SN, B(23 + i / 4), .16 + i * .04, 0, {room: .15});
  for (let i = 0; i < 4; i++) voice(drums, tom(57 - i * 3), B(55 + i / 4), .3, -.5 + i * .33, {room: .2});
  for (let i = 0; i < 4; i++) voice(drums, SN, B(64 + i), .2 + i * .02, 0, {room: .18});
  for (let i = 0; i < 4; i++) voice(drums, SN, B(68 + i / 2), .22 + i * .02, 0, {room: .18});
  for (let i = 0; i < 8; i++) voice(drums, i % 2 ? SN2 : SN, B(70 + i / 4), .3 + i * .03, 0, {room: .16});
  for (const [b, c, g] of [[8, CR, .3], [24, CR, .22], [40, CR, .16], [52, CR, .2], [56, CR2, .24], [72, CR2, .3]]) voice(drums, c, B(b), g, .1, {hall: .3});

  // ----------------------------------------------------------------- bass
  const bassNote = (note, len, bright = 1) => { const f = hz(note), a = saw(rnd()), b = pulse(.38, rnd()), lp = filter(); let ph = 0; return render(len + .03, (t, i) => {
    // The filter rests at 520 Hz, not at the fundamental: a phone has no sub, and must still hear the line.
    if ((i & 15) === 0) lp.set(520 + (900 + 1700 * bright) * Math.exp(-t / .09), 1.4);
    ph += TAU * f / RATE;
    const tone = lp.run(a(f) * .6 + b(f) * .45), env = Math.min(1, t / .004) * (t < len ? 1 : Math.exp(-(t - len) / .02));
    return Math.tanh((tone * 1.1 + Math.sin(ph) * .6) * 1.6) / 1.3 * env * Math.exp(-t / 1.4); }); };
  // Root, octave and fifth, on the 3 + 3 + 2 of the hook, with the fifth as a pickup into the next bar.
  const line = [[0, 0, 2.4], [3, 0, 2.2], [6, 12, 1.4], [8, 0, 1.8], [10, 12, .9], [11, 7, .9], [12, 0, 1.6], [14, 12, .9]];
  const rootOf = bar => CHORDS[PROGRESSION[bar - 1]].root;
  for (let bar = 3; bar <= 20; bar++) {
    const s = 4 * (bar - 1), root = rootOf(bar);
    if (bar >= 7 && bar <= 9) continue;
    if (bar === 10) { place(bass, bassNote(30, 3.6 * beat, .2), B(s), .8); continue; }
    if (bar === 15 || bar === 16) { place(bass, bassNote(root - 12 < 28 ? root : root - 12, 3.7 * beat, .15), B(s), .78); continue; }
    if (bar === 11 || bar === 12) { for (const [st, iv, len] of [[0, 0, 3], [6, 12, 1.2], [10, 0, 1.6], [14, 7, 1]]) place(bass, bassNote(root + iv, len * step, .5), B(s + st / 4), .78); continue; }
    if (bar === 17 || bar === 18) { for (let i = 0; i < 8; i++) place(bass, bassNote(root + (i % 2 ? 12 : 0), .42 * beat, .5 + i * .05 + (bar - 17) * .3), B(s + i / 2), .74); continue; }
    for (const [st, iv, len] of line) place(bass, bassNote(root + iv, len * step, bar >= 19 ? 1.2 : .8), B(s + st / 4), .82);
    place(bass, bassNote(root + 7, .8 * step, .9), B(s + 15 / 4), .7);
  }
  CLIMB.forEach((chord, i) => { const b = 24 + i * 2; for (const [st, iv, len] of [[0, 0, 2.4], [3, 12, 1], [4, 0, 1.6], [6, 12, 1.2]]) place(bass, bassNote(chord.root + iv, len * step, .9 + i * .08), B(b + st / 4), .82); });

  // --------------------------------------------------- chords, pad, lead
  const stab = (note, len, bright) => {
    // Electric piano by frequency modulation, with a soft saw under it for width.
    const f = hz(note), a = saw(rnd()), lp = filter(); return render(len + .35, (t, i) => {
      if ((i & 15) === 0) lp.set(900 + 5600 * bright * (.3 + .7 * Math.exp(-t / .2)), .9);
      const p = TAU * f * t, fm = Math.sin(p + (2.7 * bright + .6) * Math.exp(-t / .13) * Math.sin(p)) + .12 * Math.sin(p * 14.01) * Math.exp(-t / .03);
      const env = Math.min(1, t / .003) * Math.exp(-t / .55) * (t < len ? 1 : Math.exp(-(t - len) / .07));
      return (fm * .7 + lp.run(a(f * 1.003)) * .42) * env; }); };
  const padChord = (notes, len, cutoff) => {
    // Seven saws a note, spread left and right. Returns a stereo pair.
    const sides = [0, 1].map(side => { const voices = notes.flatMap(n => [-.11, -.05, 0, .06, .12].map(d => ({osc: saw(rnd()), f: hz(n) * 2 ** ((d + (side ? .02 : -.02)) / 12)}))), lp = filter(), norm = 1 / Math.sqrt(voices.length);
      return render(len, (t, i) => { if ((i & 31) === 0) lp.set(cutoff(t), .8); let m = 0; for (const v of voices) m += v.osc(v.f);
        return lp.run(m * norm) * smooth(t / .35) * smooth((len - t) / .5); }); });
    return sides; };
  const leadNote = (note, len, power = 1) => {
    const f = hz(note), a = saw(rnd()), b = saw(rnd()), sub = pulse(.5, rnd()), lp = filter(); return render(len + .3, (t, i) => {
      if ((i & 15) === 0) lp.set(900 + 4200 * power * Math.exp(-t / .14) + 1400 * power, 2.2);
      // Vibrato comes in on held notes only.
      const bend = 2 ** (.11 * smooth((t - .2) / .25) * Math.sin(TAU * 5.6 * t) / 12);
      const tone = lp.run((a(f * 1.004 * bend) + b(f * .996 * bend)) * .5 + sub(f * .5 * bend) * .22);
      return Math.tanh(tone * 1.4) * Math.min(1, t / .005) * (.62 + .38 * Math.exp(-t / .2)) * (t < len ? 1 : Math.exp(-(t - len) / .09)); }); };
  const pluck = (note, len = .12, bright = 1) => { const f = hz(note), a = saw(rnd()), b = pulse(.3, rnd()), lp = filter(); return render(len + .25, (t, i) => {
    if ((i & 15) === 0) lp.set(300 + 6000 * bright * Math.exp(-t / .05), 1.6);
    return lp.run(a(f) * .6 + b(f * 1.005) * .4) * Math.min(1, t / .002) * Math.exp(-t / .19) * (t < len ? 1 : Math.exp(-(t - len) / .05)); }); };
  const bell = (note, len = 1.1, glow = 1) => { const f = hz(note), lp = filter().set(5200 * glow + 1500, .6); return render(len, t => {
    const p = TAU * f * t;
    return lp.run(Math.sin(p + 1.1 * glow * Math.exp(-t / .25) * Math.sin(p * 3.5)) * Math.exp(-t / (len * .32)) + .2 * Math.sin(p * 2.0) * Math.exp(-t / (len * .15))) * Math.min(1, t / .002); }); };

  // Filter position of the chord stabs: closed at the drop, opening through each scene.
  const openness = bar => ({3: .28, 4: .42, 5: .62, 6: .85, 11: .3, 12: .4, 13: .7, 14: .9, 17: .5, 18: .85, 19: 1, 20: 1}[bar] ?? .8);
  for (let bar = 3; bar <= 20; bar++) {
    const s = 4 * (bar - 1), chord = CHORDS[PROGRESSION[bar - 1]];
    if (bar >= 7 && bar <= 10 || bar === 15 || bar === 16) continue;
    // Off-beat stabs. In the build they become eighths, then sixteenths.
    const hits = bar === 17 ? [0, .5, 1, 1.5, 2, 2.5, 3, 3.5] : bar === 18 ? Array.from({length: 16}, (_, i) => i / 4) : [.5, 1.5, 2.5, 3.5];
    hits.forEach((k, h) => chord.notes.forEach((n, j) => voice(chords, stab(n, .2, openness(bar) * (bar === 18 ? .6 + h / 30 : 1)), B(s + k) + j * 96, (bar >= 19 ? .15 : .13) * (h % 2 ? 1 : .86), (j - 1.5) * .28, {room: .2, echo: bar < 17 ? .18 : 0})));
    if (bar >= 19) chord.notes.forEach((n, j) => voice(chords, stab(n + 12, .9, 1), B(s) + j * 140, .12, (j - 1.5) * .3, {hall: .25}));
  }
  CLIMB.forEach((chord, i) => {
    const b = 24 + i * 2;
    // Each style change is a full stab on the beat and two echoes of it in rhythm.
    for (const [k, g] of [[0, 1], [.75, .55], [1.5, .7]]) chord.notes.forEach((n, j) => voice(chords, stab(n, k ? .16 : .5, .7 + i * .06), B(b + k) + j * 110, .17 * g, (j - 1.5) * .3, {room: .22, echo: .2}));
    voice(lead, bell(chord.notes[3] + 12, 1.3, .8), B(b), .16, .15, {hall: .5, echo: .3});
  });
  // Pads hold the harmony under everything, wider in the open bars.
  const padBars = [[1, 'Fm', 4, t => 240 + 1100 * smooth(t / 1.8), .1], [2, 'E', 4, t => 600 + 2600 * smooth(t / 1.8), .15], [10, 'Fm', 4, () => 900, .22], [15, 'D', 4, t => 700 + 1700 * smooth(t / 1.6), .3], [16, 'E', 4, t => 900 + 2200 * smooth(t / 1.6), .3]];
  for (let bar = 3; bar <= 20; bar++) if (![10, 15, 16].includes(bar) && !(bar >= 7 && bar <= 9)) padBars.push([bar, PROGRESSION[bar - 1], 4, () => 1500 + 600 * openness(bar), .13]);
  for (const [bar, name, bars, cutoff, gain] of padBars) { const pair = padChord([CHORDS[name].root + 12, ...CHORDS[name].notes], bars * beat + .4, cutoff), at = B(4 * (bar - 1)); placeStereo(pad, pair, at, gain); placeStereo(hall, pair, at, gain * .35); }
  CLIMB.forEach((chord, i) => { const pair = padChord([chord.root + 12, ...chord.notes], 2 * beat + .3, () => 1500 + i * 260), at = B(24 + i * 2); placeStereo(pad, pair, at, .12); placeStereo(hall, pair, at, .04); });

  const hook = (bar, name, power = 1, gain = .2, harmony = false) => HOOK[name].forEach(([st, note, len]) => {
    const at = B(4 * (bar - 1) + (st + swing(st) * .5) / 4);
    voice(lead, leadNote(note, len * step * .92, power), at, gain, 0, {hall: .22, echo: .3});
    // Two quieter takes, left and right, make the line wide without moving it off centre.
    for (const side of [-1, 1]) voice(lead, leadNote(note + side * .07, len * step * .92, power * .85), at + 180 + side * 90, gain * .42, side * .75, {hall: .15});
    if (harmony) voice(lead, leadNote(under(note, name), len * step * .92, power * .7), at, gain * .45, -.3, {hall: .2});
  });
  // The drop states the hook, the second half of Gather answers it, the montage plays it at full power.
  hook(3, 'D', .7); hook(4, 'E', .75); hook(5, 'Cm', .85); hook(6, 'Fm', .9);
  hook(13, 'Cm', .9, .2, true); hook(14, 'Fm', 1, .2, true);
  hook(19, 'D', 1.25, .23, true); hook(20, 'E', 1.3, .23, true);
  for (const bar of [19, 20]) HOOK[PROGRESSION[bar - 1]].forEach(([st, note, len]) => voice(lead, leadNote(note + 12, len * step * .9, 1.1), B(4 * (bar - 1) + st / 4), .07, .3, {hall: .3}));
  // Gather opens with a bouncing pluck on the chord tones.
  for (const bar of [11, 12]) { const notes = CHORDS[PROGRESSION[bar - 1]].notes; for (let i = 0; i < 16; i++) if (i % 4 !== 3) voice(lead, pluck(notes[[0, 2, 1, 3, 2, 1][i % 6]] + 12, .08, .5 + (i % 4) * .12), B(4 * (bar - 1) + (i + swing(i)) / 4), .12, i % 2 ? .45 : -.45, {echo: .45, room: .2}); }
  // The open bars of the stack remember the hook at half speed, as bells.
  [[56, 78], [57.5, 76], [59, 73], [60, 76], [61.5, 80], [63, 78]].forEach(([b, n], i) => voice(lead, bell(n, 2.2, .7), B(b), .15, i % 2 ? .35 : -.35, {hall: .6, echo: .35}));
  // The build: a pluck line that climbs the scale in sixteenths.
  for (let i = 0; i < 32; i++) voice(lead, pluck(SCALE[Math.floor(i / 4) % 8] + (i >= 16 ? 12 : 0), .07, .5 + i / 40), B(64 + i / 4), .07 + i * .0025, i % 2 ? .5 : -.5, {echo: .3, room: .2});

  // ------------------------------------------------------ sound design
  // Pans follow where an event is on screen, kept inside +-0.6 so both cuts agree.
  const sfx = (data, frame, gain, pan = 0, sends = {room: .18}, offset = 0) => voice(fx, data, S(frame) + Math.round(offset * RATE), gain, pan, sends);
  const pop = (note, len = .09) => { let ph = 0; const f = hz(note); return render(len, t => { ph += TAU * f * (.55 + .45 * (1 - Math.exp(-t / .012))) / RATE; return Math.sin(ph) * Math.min(1, t / .002) * Math.exp(-t / (len * .3)); }); };
  const tick = (freq = 2200, len = .03, body = .4) => { const bp = filter().set(freq, 2.5); return render(len, t => { bp.run(noise()); return bp.band * 1.5 * Math.exp(-t / .004) + Math.sin(TAU * freq * .22 * t) * body * Math.exp(-t / .012); }); };
  const wood = (note, len = .16) => { let ph = 0; const f = hz(note), bp = filter().set(1500, 1.2); return render(len, t => { ph += TAU * f * (1 + .2 * Math.exp(-t / .005)) / RATE; bp.run(noise());
    return (Math.sin(ph) * Math.exp(-t / .055) + .3 * Math.sin(ph * 3.94) * Math.exp(-t / .02)) * Math.min(1, t / .001) + bp.band * .3 * Math.exp(-t / .004); }); };
  const thud = (freq = 90, len = .24, dust = .5) => { const lp = filter().set(700); return render(len, t => (Math.sin(TAU * freq * t * (1 + .35 * Math.exp(-t / .012))) * Math.exp(-t / .06) + lp.run(noise()) * dust * Math.exp(-t / .03)) * Math.min(1, t / .001)); };
  // A whoosh is noise through a band-pass that sweeps, with air above it. `shape` 0 to 1 is where it is loudest.
  const whoosh = (len, f0, f1, shape = .5, q = 1.4) => { const bp = filter(), hp = filter().set(5000); return render(len, (t, i) => { const x = t / len;
    if ((i & 15) === 0) bp.set(f0 * (f1 / f0) ** x, q);
    const n = noise(); bp.run(n); hp.run(n);
    const env = x < shape ? (x / shape) ** 1.6 : (1 - (x - shape) / (1 - shape)) ** 1.8;
    return (bp.band * 2.2 + hp.high * .18) * env; }); };
  const riser = (len, power = 1) => { const bp = filter(), sw = saw(rnd()), lp = filter(); return render(len, (t, i) => { const x = t / len;
    if ((i & 15) === 0) { bp.set(300 * 2 ** (4.6 * x), 2.4); lp.set(700 + 3200 * x, 1); }
    bp.run(noise());
    // Sixteenth tremolo in the last half pulls it into the bar line.
    const trem = 1 - .45 * smooth((x - .5) * 2) * (.5 + .5 * Math.cos(TAU * t / step));
    return (bp.band * 1.5 + lp.run(sw(hz(45) * 2 ** (2 * x))) * .2) * x ** 1.8 * trem * power; }); };
  const swell = (data, len) => { const out = reversed(data.subarray(0, Math.min(data.length, Math.round(len * RATE)))); for (let i = 0; i < 400 && i < out.length; i++) out[out.length - 1 - i] *= i / 400; return out; };
  const scribble = len => { const bp = filter().set(3100, 2.6); let gate = 0, k = 0; return render(len, t => { if (k++ % 420 === 0) gate = .35 + .65 * rnd(); bp.run(noise()); return bp.band * gate * smooth(t / .01) * smooth((len - t) / .03); }); };
  const tear = len => { const bp = filter(); let gate = 1, k = 0; return render(len, (t, i) => { if ((i & 15) === 0) bp.set(3400 - 1700 * t / len, .9); if (k++ % 70 === 0) gate = rnd() < .25 ? .1 : .5 + rnd() * .5; bp.run(noise()); return bp.band * gate * Math.exp(-t / (len * .55)) * 2; }); };
  const printer = len => { const sq = pulse(.3), bp = filter().set(1300, 1.5), whine = sine(); return render(len, t => { bp.run(sq(172) * (.5 + .5 * Math.sign(Math.sin(TAU * 52 * t))));
    return (bp.band * .7 + whine(880 + 380 * t / len) * .12) * smooth(t / .012) * smooth((len - t) / .02); }); };
  const chirp = (f0, f1, len) => { let ph = 0; return render(len, t => { ph += TAU * f0 * (f1 / f0) ** (t / len) / RATE; return Math.sin(ph) * Math.sin(Math.PI * t / len) ** .7; }); };
  const sparkle = (len, density = 18) => { const out = new Float32Array(Math.round(len * RATE)); for (let k = 0; k < density; k++) { const start = Math.floor(rnd() ** 1.4 * (out.length - 2400)), f = 3200 + rnd() * 5200, g = .3 + rnd() * .7; for (let i = 0; i < 2000; i++) out[start + i] += Math.sin(TAU * f * i / RATE) * Math.exp(-i / 330) * g * .4; } return out; };

  const o = q.open, pl = q.plan, sh = q.shape, ga = q.gather, st = q.stack, mo = q.montage, ti = q.title;
  // Open. The four parts of the face play the first four notes of the hook.
  [[o.eyes[0], 78, -.08], [o.eyes[1], 76, .08]].forEach(([frame, note, pan]) => { sfx(pop(note - 12, .11), frame, .5, pan); sfx(bell(note, .9, .6), frame, .13, pan, {hall: .4, echo: .25}); });
  mark('open.eyes', o.eyes[0]); mark('open.eyes', o.eyes[1]);
  sfx(chirp(hz(69), hz(73), .16), o.smile, .2, 0); sfx(bell(73, .9, .6), o.smile, .13, 0, {hall: .6, echo: .25}, .12); sfx(whoosh(.2, 900, 3200, .6, 2), o.smile, .16, [-.15, .15]); mark('open.smile', o.smile);
  sfx(scribble(.4), o.badge, .22, [-.25, .25]); sfx(thud(82, .22, .3), o.badge, .5, 0, {room: .2}, .28); sfx(tick(3300, .05, .1), o.badge, .4, .05, {room: .3}, .23); sfx(bell(76, 1, .6), o.badge, .13, 0, {hall: .6, echo: .25}, .3); mark('open.badge', o.badge);
  sfx(whoosh(.18, 2600, 700, .3, 1.6), o.lanyard, .34, [-.3, .1]); sfx(whoosh(.18, 2400, 650, .3, 1.6), o.lanyard, .3, [.3, -.1], {room: .2}, .03); sfx(thud(74, .28, .5), o.lanyard, .55, 0, {room: .25}, .15); sfx(pop(57, .1), o.lanyard, .3, 0, {room: .2}, .15); mark('open.lanyard', o.lanyard);
  // The crouch: a spring is wound. The riser carries it to the drop.
  sfx(chirp(330, 150, .2), o.windup, .22, 0); sfx(thud(64, .2, .2), o.windup, .34, 0); sfx(tick(1800, .03, .3), o.windup + 14, .2, 0);
  { const len = (B(8) - S(o.windup)) / RATE; sfx(riser(len, 1), o.windup, .36, 0, {room: .2, hall: .2}); }
  mark('open.windup', o.windup);
  sfx(chirp(380, 2600, .14), o.dash, .2, [-.2, .6]); sfx(whoosh((B(8) - S(o.dash)) / RATE + .1, 500, 5200, .62, 1.2), o.dash - 2, .5, [-.5, .7]); mark('open.dash', o.dash);

  // Plan.
  voice(drums, impact(1), B(8), .7, 0, {hall: .25}); sfx(swell(CR, .9), 0, .2, .1, {hall: .3}, (B(8) - Math.round(.9 * RATE)) / RATE); mark('plan.word', pl.word);
  // A card: a tuned knock on the beat as it leaves its rule, and the slide of its rise under it.
  pl.cards.forEach((frame, i) => { sfx(wood([57, 59, 61, 64][i] + 12, .14), frame, .32, .3, {room: .25}); sfx(whoosh(.32, 700, 2400, .35, 1.8), frame, .12, .3); mark('plan.cards', frame); });
  sfx(whoosh(.36, 260, 1500, .5, 1.1), pl.push, .34, [.4, 0]); mark('plan.push', pl.push);
  pl.speakers.forEach((frame, k) => { sfx(whoosh(.5, 1800, 600, .75, 1.6), frame - 6, .2, [.7, .3]); sfx(pop([76, 78][k], .1), frame + 9, .42, .45, {room: .25, echo: .2}); mark('plan.speakers', frame); });
  [0, 2, 3].forEach(index => sfx(pop(66 + index * 2, .07), pl.speakers[1] + 16 + index * 3, .18, .45));
  sfx(whoosh(.34, 1500, 300, .4, 1.1), pl.lift - 4, .3, [0, .35]); sfx(chirp(600, 1300, .09), pl.lift, .16, .3); for (let k = 0; k < 5; k++) sfx(tick(2600 + k * 160, .02, .2), pl.lift + 5 + k * 1.5, .16, .05); mark('plan.lift', pl.lift);
  sfx(whoosh(.5, 500, 1300, .5, 1.3), pl.lift + 12, .13, .3); sfx(wood(45, .2), pl.drop, .5, .3, {room: .25}); sfx(thud(70, .2, .3), pl.drop, .36, .3); mark('plan.drop', pl.drop);
  sfx(tick(1500, .03, .7), pl.publish, .4, .55); sfx(tick(2300, .025, .4), pl.publish + 3, .3, .55); [[76, 0], [81, .11]].forEach(([n, d]) => sfx(bell(n, 1.3, 1), pl.publish + 3, .2, .45, {hall: .5, echo: .3}, d));
  for (let i = 0; i < 5; i++) sfx(whoosh(.5, 3000, 7000, .5, 3), pl.publish + i * 2, .05, [-.1, .6]); mark('plan.publish', pl.publish);
  sfx(riser((B(24) - S(pl.wipe)) / RATE, .8), pl.wipe, .26, 0, {room: .2}); sfx(whoosh(.5, 600, 4200, .7, 1.1), pl.wipe + 9, .5, [.6, -.6]); mark('plan.wipe', pl.wipe);

  // Shape. Each wipe has its own texture, under the chord that marks it.
  const wipes = [
    frame => sfx(thud(96, .2, .4), frame, .3, .3),
    frame => { for (let k = 0; k < 10; k++) sfx(tick(1900 + k * 130, .02, .1), frame + k * .55, .16, lerp(.0, .6, k / 9)); },
    frame => { sfx(chirp(260, 1500, .26), frame, .16, .5); sfx(whoosh(.3, 500, 3000, .7, 1.6), frame, .16, .5); },
    frame => sfx(whoosh(.3, 3800, 900, .35, 2.2), frame, .3, [-.1, .6]),
    frame => { for (let k = 0; k < 4; k++) sfx(whoosh(.14, k % 2 ? 2400 : 1500, k % 2 ? 1200 : 2800, .5, 2.4), frame + k * 1.6, .18, k % 2 ? [.6, 0] : [0, .6]); },
    frame => { for (let k = 0; k < 14; k++) sfx(pop(69 + [0, 2, 4, 7, 9][k % 5] + 12 * Math.floor(k / 5), .05), frame + k * .7, .09, lerp(.0, .6, rnd())); },
  ];
  sh.styles.forEach((frame, i) => { wipes[i](frame); sfx(tick(2500, .02, .5), frame, .22, -.55); mark('shape.styles', frame); });
  sfx(tick(1300, .03, .9), sh.dark, .42, -.25); sfx(tick(900, .03, .9), sh.dark + 2, .3, -.25); sfx(whoosh(.55, 4200, 300, .25, 1.2), sh.dark, .34, [-.1, .6]); mark('shape.dark', sh.dark);
  { const grid = sh.wall - Math.round(clock.beatFrames); for (let k = 0; k < 11; k++) sfx(wood(64 + [0, 2, 4, 7][k % 4], .08), grid + 6 + k, .1, lerp(-.5, .5, k / 10)); sfx(whoosh(.3, 1200, 400, .4, 1.2), grid - 1, .26, [.4, 0]); }
  voice(lead, swell(bell(88, 1.4, 1), .9), S(sh.wall) - Math.round(.9 * RATE), .1, 0, {hall: .5}); sfx(bell(81, 1.4, .9), sh.wall, .12, 0, {hall: .6, echo: .3}); mark('shape.wall', sh.wall);
  sfx(whoosh((B(40) - S(sh.exit)) / RATE, 300, 5200, .72, 1.1), sh.exit, .46, [0, 0]); mark('shape.exit', sh.exit);

  // Gather.
  sfx(printer(.4), ga.ticket, .2, .25); sfx(thud(120, .12, .6), ga.ticket + 12, .3, .3); mark('gather.ticket', ga.ticket);
  ga.steps.forEach((frame, i) => { sfx(wood([62, 64, 66, 69, 71][i] + 12, .14), frame, .26, lerp(-.1, .5, i / 4), {room: .25, echo: .15}); mark('gather.steps', frame); });
  sfx(thud(105, .16, .9), ga.steps[4] + 2, .4, .45); sfx(bell(83, .8, 1), ga.steps[4] + 2, .1, .45, {hall: .5});
  sfx(tear(.24), ga.tear, .34, [.3, .5]); sfx(whoosh(.4, 1400, 500, .3, 1.5), ga.tear + 4, .16, [.5, .1]); mark('gather.tear', ga.tear);
  // Check-in: one small tick for each of the forty badges, at the frame it is checked. Pitch and position follow the grid.
  for (let row = 0; row < 5; row++) for (let col = 0; col < 8; col++) {
    const frame = ga.checkIn[0] + (col + row * 1.4) / (7 + 4 * 1.4) * (ga.checkIn[1] - ga.checkIn[0] - 10);
    sfx(pop(SCALE[(col + row) % 5] + 12, .045), frame, .075, lerp(-.1, .55, col / 7), {room: .2});
  }
  sfx(bell(88, 1, 1), ga.checkIn[1] - 10, .11, .3, {hall: .6}); mark('gather.checkIn', ga.checkIn[0]);
  sfx(whoosh(.34, 2200, 700, .4, 1.4), ga.bookmarks[0] - 9, .18, [.4, .1]);
  ga.bookmarks.forEach((frame, i) => { sfx(pop(69 + i * 2, .07), frame, .34, .25, {room: .25}); sfx(whoosh(.4, 900, 2200, .5, 1.8), frame + 2, .12, [.1, .55]); mark('gather.bookmarks', frame); });
  ga.arrivals.forEach((frame, i) => { sfx(bell([76, 78, 81][i], 1.1, .8), frame, .17, .55, {hall: .5, echo: .25}); sfx(tick(1700, .02, .4), frame, .16, .55); mark('gather.arrivals', frame); });
  sfx(whoosh(.24, 700, 1800, .6, 1.6), ga.send - 8, .12, 0); sfx(tick(1500, .03, .7), ga.send, .36, -.05); sfx(whoosh(.42, 500, 3800, .6, 1.3), ga.send, .4, [-.2, .5]); mark('gather.send', ga.send);
  // Each of the fourteen darts lands at its own frame; the picture and this loop share one formula.
  for (let i = 0; i < 14; i++) {
    const landing = ga.delivered[0] + pictureHash(i * 17 + 3) * (ga.delivered[1] - ga.delivered[0]);
    sfx(bell(SCALE[(i * 3) % 7] + 12, .7, .7), landing, .085, lerp(.1, .6, (i % 5) / 4), {hall: .5});
    sfx(pop(81, .04), landing, .06, .4);
  }
  mark('gather.delivered', ga.delivered[0]);

  // Stack.
  voice(drums, impact(1.5), B(56), .78, 0, {hall: .35}); sfx(whoosh(.9, 300, 2400, .25, .9), st.explode, .3, [0, 0], {hall: .4}); mark('stack.explode', st.explode);
  sfx(sparkle(.5, 14), st.explode + 12, .07, .2, {hall: .4});
  st.callouts.forEach((frame, i) => { sfx(whoosh(.12, 2200, 4200, .6, 3), frame, .12, [.2, .6]); sfx(wood([57, 59, 61, 64, 66][i] + 12, .12), frame + 3, .24, .6, {room: .25, echo: .2}); mark('stack.callouts', frame); });
  sfx(chirp(700, 180, .3), st.compress[0] - 5, .16, .2);
  st.compress.forEach((frame, i) => { sfx(wood([45, 47, 49, 52][i], .22), frame, .5, .2, {room: .3}); sfx(thud(60 + i * 8, .2, .5), frame, .4, .2); sfx(tick(2800, .04, .1), frame + 3, .16, .2, {room: .4}); mark('stack.compress', frame); });
  voice(drums, impact(.9), B(68), .66, 0, {hall: .25}); sfx(whoosh(.36, 400, 2600, .4, 1.2), st.merge - 1, .3, [.2, .3]); mark('stack.merge', st.merge);
  { const len = (B(72) - B(68)) / RATE; place(fx, riser(len, 1.15), B(68), .4, 0); place(room, riser(len, 1), B(68), .08, 0); } mark('stack.riser', st.riser[0]);
  [[81, 0], [85, .09], [88, .18]].forEach(([n, d]) => sfx(bell(n, 1.2, 1), st.line, .14, .4, {hall: .55, echo: .3}, d)); mark('stack.line', st.line);
  sfx(whoosh(.5, 500, 6000, .8, 1), clock.scenes[4].end - 14, .5, [.3, 0]);

  // Montage. Each band is a swipe across the frame and a tuned drum; the drums climb.
  mo.panels.slice(0, 7).forEach((frame, i) => {
    sfx(whoosh(.2, 1200, 5200, .55, 1.7), frame, .26, [-.6, .6]); voice(drums, tom(45 + [0, 2, 4, 7, 9, 12, 14][i]), B(72 + i), .34, lerp(-.3, .3, i / 6), {room: .25});
    mark('montage.panels', frame);
  });
  sfx(whoosh(.2, 1500, 5600, .55, 1.7), mo.panels[6] + 4, .2, [-.6, .6]);
  voice(fx, swell(CR, .42), S(mo.pull) - Math.round(.42 * RATE) + B(.5), .2, 0, {hall: .3}); mark('montage.pull', mo.pull);
  // The fold: everything is drawn down into the point, and the sound goes with it.
  { const len = (cut - B(79)) / RATE - .01; let ph = 0; const bp = filter(); place(fx, render(len, (t, i) => { const x = t / len; if ((i & 15) === 0) bp.set(5200 * (160 / 5200) ** x, 1.5); bp.run(noise()); ph += TAU * (520 * (55 / 520) ** x) / RATE; return (bp.band * 1.6 + Math.sin(ph) * .5) * Math.sin(Math.PI * Math.min(1, x * 1.15)) ** .8; }), B(79), .5, 0); }
  mark('montage.panels', mo.panels[7]); mark('montage.implode', mo.implode);

  // Everything stops for the breath before the title.
  for (const b of [drums, bass, chords, lead, pad, fx, room, hall, taps]) for (const ch of [b.left, b.right]) { for (let i = cut - 200; i < cut; i++) ch[i] *= (cut - i) / 200; ch.fill(0, cut); }

  // Title: the first A major chord of the piece.
  voice(drums, impact(2.2), title, .92, 0, {hall: .4}); voice(drums, CR2, title, .3, 0, {hall: .4}); place(drums, K, title, .9);
  { const pair = padChord([45, 52, ...CHORDS.A.notes], 7.3, t => 700 + 2800 * Math.exp(-t / 1.8)); for (const side of pair) for (let i = 0; i < side.length; i++) side[i] *= Math.exp(-i / RATE / 2.6); placeStereo(pad, pair, title, .4); placeStereo(hall, pair, title, .2); }
  CHORDS.A.notes.forEach((n, j) => voice(chords, stab(n, 3.5, .9), title + j * 420, .16, (j - 2) * .25, {hall: .5}));
  place(bass, bassNote(33, 3.6, .3), title, .75);
  sfx(sparkle(1.4, 30), ti.impact, .12, 0, {hall: .5}); mark('title.impact', ti.impact);
  // He runs on the spot: quick soft steps, left and right.
  for (let k = 0; k < 5; k++) sfx(thud(150, .05, 1.2), ti.impact + 3 + k * 5.6, .1, k % 2 ? .12 : -.12);
  sfx(thud(72, .3, .8), ti.land, .62, -.3, {room: .3}); sfx(whoosh(.3, 2400, 600, .12, 1), ti.land, .3, [-.4, -.1]); sfx(sparkle(1.1, 16), ti.land, .1, -.3, {hall: .4}); mark('title.land', ti.land);
  [0, 4].forEach((d, row) => { sfx(whoosh(.36, 900, 3600, .6, 1.8), ti.wordmark + 2 + d, .2, [-.2, .4]); sfx(bell([76, 81][row], 1.6, .8), ti.wordmark + 2 + d, .15, .1, {hall: .6, echo: .3}); }); mark('title.wordmark', ti.wordmark);
  // The tagline is uncovered letter by letter under a rising run of the home chord.
  [57, 61, 64, 69, 73, 76, 81, 85].forEach((n, k) => voice(lead, pluck(n + 12, .1, .7), S(ti.tagline) + k * Math.round(step * RATE), .1, lerp(-.4, .4, k / 7), {hall: .5, echo: .3}));
  voice(lead, bell(83, 1.6, .8), S(ti.tagline), .13, 0, {hall: .6}); mark('title.tagline', ti.tagline);
  // Plan. Shape. Gather. C sharp, E, A: the chord of home, one note a word.
  ti.words.forEach((frame, i) => { const n = [73, 76, 81][i]; voice(lead, leadNote(n, .5, .8), S(frame), .17, lerp(-.25, .25, i / 2), {hall: .5, echo: .3}); voice(lead, bell(n + 12, 1.8, 1), S(frame), .13, lerp(-.25, .25, i / 2), {hall: .6}); sfx(whoosh(.2, 1500, 4000, .6, 2.4), frame, .08, [-.2, .2]); mark('title.words', frame); });
  for (let k = 0; k < 6; k++) sfx(tick(2500 + (k % 3) * 300, .012, .1), ti.url + k, .1, 0); mark('title.url', ti.url);
  sfx(tick(3000, .012, 0), ti.blink, .05, -.3); sfx(tick(2600, .012, 0), ti.blink + 4, .04, -.3); mark('title.blink', ti.blink);

  // ------------------------------------------------------------- mix
  // Effects returns. The halls are cleared at the title so nothing rings across the silence.
  const roomWet = plate(room, {decay: .42, damping: .35, predelay: .008, clearAt: title});
  // The hall is shorter while the band plays, and long for the last chord.
  const hallWet = plate(hall, {decay: i => (i < title ? .6 : .84), damping: .28, predelay: .025, clearAt: title});
  const tapsWet = echo(taps, B(.75), {feedback: .36, clearAt: title});
  for (const ch of [roomWet, hallWet, tapsWet]) for (const side of [ch.left, ch.right]) side.fill(0, cut, title);

  // The exposure dips of the picture close a low-pass on the music for the same frames.
  const sc = clock.scenes, wall = sh.wall - Math.round(clock.beatFrames);
  const dips = [[pl.push - 1, pl.push + 9], [pl.lift - 5, pl.lift + 7], [pl.wipe + 11, sc[2].start - 3], [wall - 1, wall + 7], [sh.exit + 7, sc[3].start - 2], [sc[3].end - 9, sc[3].end - 1], [st.merge - 1, st.merge + 9], [sc[4].end - 11, sc[4].end - 1]];
  const dipAt = frame => { let d = 0; for (const [a, b] of dips) d = Math.max(d, Math.min(1, (frame - a + 3) / 3, (b + 4 - frame) / 4)); return d; };
  // Bar 10 is the dark mode: the whole band goes under a low-pass and comes back for Gather.
  const dark = b => (b < 36 ? 0 : b < 36.6 ? (b - 36) / .6 : b < 38.5 ? 1 : b < 40 ? 1 - (b - 38.5) / 1.5 : 0);
  const music = bus(count), lpL = filter(), lpR = filter();
  for (let i = 0; i < count; i++) {
    const p = pump[i];
    let l = chords.left[i] * p * TRIM.chords + pad.left[i] * (.35 + .65 * p) * TRIM.pad + lead.left[i] * (.8 + .2 * p) * TRIM.lead + tapsWet.left[i] * TRIM.wet + hallWet.left[i] * TRIM.wet;
    let r = chords.right[i] * p * TRIM.chords + pad.right[i] * (.35 + .65 * p) * TRIM.pad + lead.right[i] * (.8 + .2 * p) * TRIM.lead + tapsWet.right[i] * TRIM.wet + hallWet.right[i] * TRIM.wet;
    if ((i & 31) === 0) { const b = i / RATE / beat, close = Math.max(dipAt(i / RATE * clock.fps) * .8, dark(b)), cutoff = 17000 * (700 / 17000) ** close; lpL.set(cutoff, .8); lpR.set(cutoff, .8); }
    l = lpL.run(l); r = lpR.run(r);
    music.left[i] = l; music.right[i] = r;
  }
  compress(music, {threshold: -16, ratio: 2, attack: .012, release: .18, makeup: 1.5});
  compress(drums, {threshold: -14, ratio: 3, attack: .006, release: .09, makeup: 2});

  // Bass is mono. Effects sit in front of the music; the music dips a little under the loud ones.
  const mix = bus(count), hpL = biquad('highpass', 30), hpR = biquad('highpass', 30), airL = biquad('highshelf', 7000, 3), airR = biquad('highshelf', 7000, 3), mudL = biquad('peak', 280, -1.5, 1), mudR = biquad('peak', 280, -1.5, 1);
  // The arrangement has a shape: the montage is the loudest part, the open bars the quietest.
  const LEVELS = [[1, -1], [3, 0], [7, -.4], [10, -1.5], [11, -2.2], [13, -.2], [15, -2], [17, -1.4], [19, 2.2], [21, 1]];
  const contour = bar => {
    let g = LEVELS[0][1];
    for (let k = 0; k < LEVELS.length && bar >= LEVELS[k][0]; k++) g = lerp(k ? LEVELS[k - 1][1] : LEVELS[k][1], LEVELS[k][1], Math.min(1, (bar - LEVELS[k][0]) / .06));
    // The build rises through its two bars.
    if (bar >= 17 && bar < 19) g = lerp(-1.4, .6, (bar - 17) / 2);
    return 10 ** (g / 20);
  };
  let key = 0, shape = 1; const fall = Math.exp(-1 / (.12 * RATE));
  for (let i = 0; i < count; i++) {
    const fxLevel = Math.max(Math.abs(fx.left[i]), Math.abs(fx.right[i])); key = fxLevel > key ? fxLevel : key * fall;
    const under = 1 - .28 * Math.min(1, key * 3.2), low = (bass.left[i] + bass.right[i]) * .5 * (.25 + .75 * pump[i]) * TRIM.bass;
    if ((i & 255) === 0) shape = contour(i / RATE / beat / 4 + 1);
    const l = (music.left[i] * under + drums.left[i] * TRIM.drums + low) * shape + fx.left[i] * TRIM.fx + roomWet.left[i] * .9;
    const r = (music.right[i] * under + drums.right[i] * TRIM.drums + low) * shape + fx.right[i] * TRIM.fx + roomWet.right[i] * .9;
    mix.left[i] = airL(mudL(hpL(l))) * TRIM.master; mix.right[i] = airR(mudR(hpR(r))) * TRIM.master;
  }
  compress(mix, {threshold: -12, ratio: 1.6, attack: .03, release: .2, makeup: 0});
  for (let i = 0; i < count; i++) { mix.left[i] = Math.tanh(mix.left[i] * 1.05) / 1.05; mix.right[i] = Math.tanh(mix.right[i] * 1.05) / 1.05; }
  limit(mix, .86);
  // Exact silence in the breath and in the last three frames, and a fade to it at the end.
  const last = S(clock.duration - 3), fadeFrom = S(clock.duration - 45);
  for (let i = 0; i < count; i++) {
    let g = Math.min(1, i / 1600);
    if (i >= cut && i < title) g = 0;
    if (i >= fadeFrom) g *= smooth((last - i) / (last - fadeFrom));
    if (i >= last) g = 0;
    mix.left[i] *= g; mix.right[i] *= g;
  }
  for (let i = 0; i < count; i++) if (!Number.isFinite(mix.left[i] + mix.right[i])) throw new Error(`The score is not finite at sample ${i}`);
  events.sort((a, b) => a.frame - b.frame || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  return {left: mix.left, right: mix.right, count, events, ...(stems ? {stems: {drums, bass, chords, lead, pad, fx, music}} : {})};
}

// The picture's integer hash (kit.ts), so sounds land on the frames the picture uses.
function pictureHash(n) {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
