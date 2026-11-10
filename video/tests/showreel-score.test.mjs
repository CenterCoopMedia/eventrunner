import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compose, CHORDS, CLIMB, HOOK, SCALE, PROGRESSION, under} from '../showreel/score.mjs';
import {RATE, bus, place, plate, limit, level, filter, random, saw, render} from '../showreel/audio-kit.mjs';

const {timeline} = await import(new URL('../showreel/timeline.ts', import.meta.url));
// One composition for the whole file: it takes about ten seconds.
const score = compose(timeline, {stems: true});
const sample = frame => Math.round(frame / timeline.fps * RATE), barSample = bar => Math.round((bar - 1) * 4 * 60 / timeline.bpm * RATE);
const digest = s => crypto.createHash('sha256').update(new Uint8Array(s.left.buffer)).update(new Uint8Array(s.right.buffer)).digest('hex');
const mix = {left: score.left, right: score.right};
const bars = (first, last, target = mix) => level(target, barSample(first), Math.min(score.count, barSample(last + 1)));

test('the mix has the exact sample count of the 45-second clock', () => {
  assert.equal(score.count, Math.round(timeline.duration / timeline.fps * RATE));
  assert.equal(score.count, 2160000);
  assert.equal(score.left.length, score.count);
  assert.equal(score.right.length, score.count);
});

test('compose is deterministic', () => {
  assert.equal(digest(compose(timeline)), digest(score));
});

test('the mix is finite and leaves headroom for the encoder', () => {
  let peak = 0;
  for (let i = 0; i < score.count; i++) { assert.ok(Number.isFinite(score.left[i]) && Number.isFinite(score.right[i])); peak = Math.max(peak, Math.abs(score.left[i]), Math.abs(score.right[i])); }
  assert.ok(peak <= .9, `peak ${peak}`);
  assert.ok(peak > .4, `peak ${peak}`);
});

test('the breath before the title and the last three frames are digital silence', () => {
  const zero = (from, to) => { for (let i = from; i < to; i++) if (score.left[i] !== 0 || score.right[i] !== 0) return i; return -1; };
  const [a, b] = timeline.silence;
  assert.equal(zero(sample(a), sample(b)), -1);
  assert.equal(zero(sample(timeline.duration - 3), score.count), -1);
  assert.ok(level(mix, sample(b), sample(b) + RATE / 10) > -30, 'the title chord follows the breath');
});

test('every picture cue has a sound on its frame', () => {
  const expected = [];
  // A range is announced at its start.
  const ranges = ['gather.checkIn', 'gather.delivered', 'stack.riser'];
  for (const [section, cues] of Object.entries(timeline.cues)) for (const [name, value] of Object.entries(cues)) {
    const kind = `${section}.${name}`;
    for (const frame of ranges.includes(kind) ? [value[0]] : [value].flat()) expected.push([kind, frame]);
  }
  for (const [kind, frame] of expected) assert.ok(score.events.some(e => e.kind === kind && e.frame === frame), `${kind} at ${frame}`);
  for (let i = 1; i < score.events.length; i++) assert.ok(score.events[i - 1].frame <= score.events[i].frame, 'events are sorted');
  assert.ok(score.events.every(e => Number.isInteger(e.frame) && e.frame >= 0 && e.frame < timeline.duration));
});

test('every note is in A major, and the home chord waits for the title', () => {
  const key = new Set([9, 11, 1, 2, 4, 6, 8]);
  const notes = [...Object.values(CHORDS).flatMap(c => [c.root, ...c.notes]), ...CLIMB.flatMap(c => [c.root, ...c.notes]), ...Object.values(HOOK).flat().map(([, note]) => note), ...SCALE];
  for (const note of notes) assert.ok(key.has(note % 12), `note ${note} is in the key`);
  // The harmony voice is calculated from the hook, so it is checked note by note:
  // a tone of the bar's chord, three to five semitones under the melody.
  for (const [name, bar] of Object.entries(HOOK)) for (const [, note] of bar) {
    const low = under(note, name), chord = [CHORDS[name].root, ...CHORDS[name].notes].map(n => n % 12);
    assert.ok(key.has(low % 12) && chord.includes(low % 12), `the harmony under ${note} on ${name} is a chord tone in the key`);
    assert.ok(note - low >= 3 && note - low <= 5, `the harmony under ${note} on ${name} is a third or a fourth below`);
  }
  assert.equal(PROGRESSION.length, timeline.bars);
  assert.ok(PROGRESSION.slice(0, 20).every(name => name !== 'A'), 'no bar before the title rests on A');
  assert.deepEqual(PROGRESSION.slice(20), ['A', 'A', 'A', 'A']);
  // Every bar of the hook opens with the 3 + 3 + 2 figure.
  for (const bar of Object.values(HOOK)) assert.deepEqual(bar.slice(0, 3).map(([step]) => step), [0, 3, 6]);
});

test('the arrangement has a shape', () => {
  assert.ok(bars(1, 2) < bars(3, 6) - 4, 'the open is at least 4 dB under the drop');
  assert.ok(bars(11, 12) < bars(13, 14) - 2, 'Gather starts lighter');
  assert.ok(bars(15, 16) < bars(19, 20) - 1.5, 'the stack opens under the montage');
  assert.ok(bars(23, 24) < bars(21, 22) - 4, 'the title decays');
  const montage = bars(19, 20);
  for (let first = 1; first <= 23; first++) if (first !== 19) assert.ok(bars(first, first + 1) < montage, `bars ${first}-${first + 1} are under the montage`);
});

test('the dark-mode bar closes the filter on the music', () => {
  // Share of the music bus above 2 kHz, in bar 9 and in the middle of bar 10.
  const bright = (from, to) => { const hp = [filter().set(2000), filter().set(2000)]; let high = 0, all = 0;
    for (let i = from; i < to; i++) { const l = score.stems.music.left[i], r = score.stems.music.right[i]; hp[0].run(l); hp[1].run(r); high += hp[0].high ** 2 + hp[1].high ** 2; all += l * l + r * r; }
    return high / all; };
  const beat = 60 / timeline.bpm * RATE;
  assert.ok(bright(Math.round(36.8 * beat), Math.round(38.4 * beat)) < bright(barSample(9), barSample(10)) * .25);
});

test('the low end is mono and the mix has width without losing mono', () => {
  const from = barSample(3), to = barSample(7), lp = [filter().set(120), filter().set(120)];
  let lowLR = 0, lowLL = 0, lowRR = 0, lr = 0, ll = 0, rr = 0;
  for (let i = from; i < to; i++) {
    const l = score.left[i], r = score.right[i], a = lp[0].run(l), b = lp[1].run(r);
    lowLR += a * b; lowLL += a * a; lowRR += b * b; lr += l * r; ll += l * l; rr += r * r;
  }
  assert.ok(lowLR / Math.sqrt(lowLL * lowRR) > .97, 'below 120 Hz the two channels agree');
  const correlation = lr / Math.sqrt(ll * rr);
  assert.ok(correlation > .6 && correlation < .97, `correlation ${correlation}`);
});

test('sound design sits under the music in the drops and leads the open', () => {
  assert.ok(bars(3, 6, score.stems.fx) < bars(3, 6, score.stems.music) - 6);
  assert.ok(bars(1, 2, score.stems.fx) > bars(1, 2, score.stems.drums));
});

test('the signal tools behave', () => {
  // The seeded generator repeats and stays in range.
  const a = random(7), b = random(7);
  for (let i = 0; i < 100; i++) { const v = a(); assert.equal(v, b()); assert.ok(v >= 0 && v < 1); }
  // Equal-power pan: centre is 3 dB down on each side, and hard left is silent on the right.
  const target = bus(8), one = Float32Array.of(1);
  place(target, one, 0, 1, 0); place(target, one, 1, 1, -1);
  assert.ok(Math.abs(target.left[0] - Math.SQRT1_2) < 1e-6 && Math.abs(target.right[0] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(target.left[1] - 1) < 1e-6 && Math.abs(target.right[1]) < 1e-6);
  // The plate is stable: an impulse decays by more than 40 dB in three seconds and never grows.
  const source = bus(RATE * 4); source.left[10] = 1; source.right[10] = 1;
  const wet = plate(source, {decay: .42});
  assert.ok(level(wet, RATE * 3, RATE * 4) < level(wet, 0, RATE) - 40);
  assert.ok(wet.left.every(Number.isFinite));
  // The limiter holds its ceiling.
  const loud = bus(4800); for (let i = 0; i < 4800; i++) { loud.left[i] = Math.sin(i / 7) * 1.8; loud.right[i] = Math.cos(i / 5) * 1.4; }
  limit(loud, .8);
  assert.ok(Math.max(...loud.left.map(Math.abs), ...loud.right.map(Math.abs)) <= .8 + 1e-6);
  // A saw near the top of the range stays inside its bounds: the band limit adds no spikes.
  const osc = saw(), high = render(.05, () => osc(7040));
  assert.ok(high.every(v => Math.abs(v) < 1.3));
});
