import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {timeline} from '../showreel/timeline.ts';
import {prog, spring, hash, mix} from '../showreel/kit.ts';
import {limbs, REST} from '../showreel/badger.ts';
import {REPO, FONTS, styles, project} from '../showreel/data.mjs';

const frames = value => (Array.isArray(value) ? value : [value]);
const luminance = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
  .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + .05) / (lo + .05); };

test('the clock is 24 bars at 128 BPM in exactly 45 seconds', () => {
  assert.equal(timeline.duration, 45 * timeline.fps);
  assert.equal(timeline.bars * 4 * timeline.beatFrames, timeline.duration);
  assert.equal(timeline.scenes[0].start, 0);
  assert.equal(timeline.scenes.at(-1).end, timeline.duration);
  timeline.scenes.forEach((scene, i) => {
    assert.ok(scene.end > scene.start);
    if (i) assert.equal(scene.start, timeline.scenes[i - 1].end, `${scene.id} follows the scene before it`);
  });
});

test('every cue is a whole frame inside its own scene, in order', () => {
  for (const scene of timeline.scenes) {
    let last = -1;
    for (const [name, value] of Object.entries(timeline.cues[scene.id])) {
      for (const frame of frames(value)) {
        assert.ok(Number.isInteger(frame), `${scene.id}.${name} is a whole frame`);
        assert.ok(frame >= scene.start && frame <= scene.end, `${scene.id}.${name} is inside ${scene.id}`);
      }
      const first = frames(value)[0];
      // Cues are listed in the order they happen. A range may share its first frame with the cue before it.
      assert.ok(first >= last, `${scene.id}.${name} does not come before the cue listed above it`);
      last = first;
    }
  }
});

test('the end card is still for two seconds and the title follows a silence', () => {
  assert.ok(timeline.duration - timeline.settle >= 2 * timeline.fps);
  assert.ok(timeline.cues.title.url < timeline.settle);
  // After the layout is at rest the only cue is the blink.
  assert.ok(timeline.cues.title.blink > timeline.settle && timeline.cues.title.blink < timeline.duration - 30);
  assert.equal(timeline.silence[1], timeline.cues.title.impact);
  assert.ok(timeline.silence[0] < timeline.silence[1]);
});

test('progress is 0 before an open-ended range, never NaN', () => {
  // A leave time of Infinity once made every colour invalid and the type vanish.
  assert.equal(prog(100, Infinity, Infinity), 0);
  assert.equal(prog(5, 10, 20), 0);
  assert.equal(prog(15, 10, 20), .5);
  assert.equal(prog(25, 10, 20), 1);
});

test('springs start at rest, overshoot once and settle; hashes repeat', () => {
  assert.equal(spring(10, 10), 0);
  assert.ok(Math.max(...Array.from({length: 60}, (_, i) => spring(i, 0))) > 1);
  assert.ok(Math.abs(spring(90, 0) - 1) < .001);
  assert.equal(hash(42), hash(42));
  for (let i = 0; i < 500; i++) assert.ok(hash(i) >= 0 && hash(i) < 1);
});

test('the rig at rest has the limbs of the official mark', () => {
  // Point lists of the three limb paths in design/brand/badger-mark.svg.
  const [back, front, arm] = limbs(REST);
  assert.deepEqual(back, [[31, 59], [24, 69], [17, 66], [16, 68]]);
  assert.deepEqual([front[0], front[2], front[3]], [[43, 59], [52, 71], [57, 69]]);
  assert.deepEqual(arm, [[54, 42], [62, 34]]);
  const svg = fs.readFileSync(path.join(REPO, 'design/brand/badger-mark.svg'), 'utf8');
  assert.ok(svg.includes('m31 59-7 10-7-3-1 2 M43 59l9 12 5-2 M54 42l8-8'), 'the mark still has the limb path this rig copies');
});

test('the run cycle repeats and has no jumps', () => {
  const at = run => limbs({...REST, runAmount: 1, run}).flat(2);
  at(0).forEach((v, i) => assert.ok(Math.abs(v - at(1)[i]) < 1e-9));
  for (let step = 0; step < 200; step++) {
    const a = at(step / 200), b = at((step + 1) / 200);
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1.2, 'a joint moves less than 1.2 units in 1/200 of a stride'));
  }
});

test('styles are the six general presets with their own fonts', async () => {
  const all = styles();
  assert.deepEqual(all.map(style => style.id), ['civic', 'broadsheet', 'newsroom', 'zine', 'field-guide', 'atlas']);
  assert.ok(!JSON.stringify(await project()).toLowerCase().includes('nc local'), 'no client style or name in the public piece');
  const families = new Set(FONTS.map(([family]) => family));
  for (const style of all) assert.ok(families.has(style.font), `${style.label} heading face is loaded`);
  for (const [, file] of FONTS) assert.ok(fs.existsSync(path.join(REPO, file)), `${file} exists`);
});

test('everything shown comes from the fictional fixture', async () => {
  const {experience, copy} = await project();
  assert.equal(experience.name, 'Harborlight Forum');
  assert.equal(experience.sessions.length >= 4, true);
  for (const session of experience.sessions) for (const id of session.speakerIds) assert.ok(experience.speakers.some(s => s.id === id));
  // The canvas code holds no event content and no client style of its own.
  const banned = [experience.name, experience.shortName, experience.venue, experience.dates, copy.day, copy.site, 'nclocal', 'NC Local',
    ...experience.speakers.map(person => person.name), ...experience.sessions.map(session => session.title)];
  for (const file of fs.readdirSync(path.join(REPO, 'video/showreel')).filter(name => name.endsWith('.ts') && name !== 'timeline.ts')) {
    const source = fs.readFileSync(path.join(REPO, 'video/showreel', file), 'utf8');
    for (const value of banned) assert.ok(!source.toLowerCase().includes(value.toLowerCase()), `${file} does not hard-code "${value}"`);
  }
});

test('the standing label, day and site address are read, not typed', async () => {
  const {copy, experience} = await project();
  assert.equal(copy.sample, `${experience.name} · Sample event`);
  assert.match(copy.day, /^Day one · [A-Z][a-z]{2} \d{1,2}$/);
  assert.equal(copy.days, 2);
  assert.equal(copy.site, 'eventrunner.org');
  // The address is typed at 2.5 characters a frame and must be complete when the picture settles.
  assert.ok(timeline.cues.title.url + Math.ceil(copy.site.length / 2.5) <= timeline.settle);
});

test('text colours keep at least 4.5:1', () => {
  const all = styles(), D = all[0].dark;
  for (const key of ['ink', 'inkMuted', 'primary']) assert.ok(contrast(D[key], D.surface) >= 4.5, `brand ${key} on the dark ground`);
  // The standing sample label is drawn at 85% and inactive picker items at 72%.
  assert.ok(contrast(mix(D.surface, D.inkMuted, .85), D.surface) >= 4.5);
  assert.ok(contrast(mix(D.surface, D.inkMuted, .72), D.surface) >= 4.5);
  for (const style of all) {
    for (const key of ['primary', 'accent', 'highlight']) assert.ok(contrast(style.dark.surface, style.dark[key]) >= 4.5, `${style.id} dark surface on ${key} panel`);
    for (const mode of ['light', 'dark']) {
      assert.ok(contrast(style[mode].ink, style[mode].surface) >= 4.5, `${style.id} ${mode} ink`);
      assert.ok(contrast(style[mode].primary, style[mode].surface) >= 4.5, `${style.id} ${mode} primary`);
      assert.ok(contrast(style[mode].inkMuted, style[mode].surfaceAlt) >= 4.5, `${style.id} ${mode} muted`);
    }
  }
});
