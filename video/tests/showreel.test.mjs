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

test('the picture has no numbered eyebrow, tracked micro-label or chip', () => {
  // Design rules of the second pass. Mono type is for times and step numbers only.
  const dir = path.join(REPO, 'video/showreel');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.ts') && name !== 'timeline.ts')) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/`0\$\{/.test(source), `${file} does not number a label with a leading zero`);
    assert.ok(!/padStart\(2, '0'\)/.test(source), `${file} does not pad a count with a zero`);
    assert.ok(!/family: 'Mono'[^}]*tracking/.test(source), `${file} has no tracked mono label`);
    assert.ok(!/ — /.test(source.replace(/\/\/.*$/gm, '')), `${file} draws no "number, dash, label" eyebrow`);
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
  // Inactive picker items are drawn at 72%; the sample label is full muted ink.
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

// Two formats. Each scene file exports one LAYOUT table with a landscape and a
// vertical composition; the vertical cut is composed again, not cropped.
const layouts = {
  shared: (await import('../showreel/shared.ts')).LAYOUT,
  page: (await import('../showreel/page.ts')).LAYOUT,
  open: (await import('../showreel/scene-open.ts')).LAYOUT,
  plan: (await import('../showreel/scene-plan.ts')).LAYOUT,
  shape: (await import('../showreel/scene-shape.ts')).LAYOUT,
  gather: (await import('../showreel/scene-gather.ts')).LAYOUT,
  stack: (await import('../showreel/scene-stack.ts')).LAYOUT,
  montage: (await import('../showreel/scene-montage.ts')).LAYOUT,
  title: (await import('../showreel/scene-title.ts')).LAYOUT,
};
const SAFE = {x0: 60, x1: 1020, y0: 250, y1: 1540};
const inX = (x, label) => assert.ok(x >= SAFE.x0 - 1e-9 && x <= SAFE.x1 + 1e-9, `${label}: x ${x} is inside ${SAFE.x0} to ${SAFE.x1}`);
const inY = (y, label) => assert.ok(y >= SAFE.y0 - 1e-9 && y <= SAFE.y1 + 1e-9, `${label}: y ${y} is inside ${SAFE.y0} to ${SAFE.y1}`);
const inBox = ({x, y, w, h}, label) => { inX(x, label); inX(x + w, label); inY(y, label); inY(y + h, label); };
const shape = value => (Array.isArray(value) ? value.map(shape) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, shape(value[key])])) : typeof value);

test('every layout table has both formats with the same keys', () => {
  for (const [name, table] of Object.entries(layouts)) {
    assert.deepEqual(Object.keys(table).sort(), ['landscape', 'vertical'], `${name} has two formats`);
    // Arrays of points may differ in length (the tagline has one line or two); objects must match key for key.
    const keys = value => (Array.isArray(value) ? 'array' : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, keys(value[key])])) : typeof value);
    assert.deepEqual(keys(table.vertical), keys(table.landscape), `${name} has the same keys in both formats`);
  }
  assert.deepEqual(shape(layouts.title.vertical.tagline.lines[0]), shape(layouts.title.landscape.tagline.lines[0]));
});

test('the vertical frame is 1080 by 1920 and its page picture 1080 by 1220', async () => {
  const kit = await import('../showreel/kit.ts');
  assert.deepEqual(kit.FRAME, {landscape: {w: 1920, h: 1080}, vertical: {w: 1080, h: 1920}});
  kit.setFormat('vertical');
  assert.deepEqual([kit.W, kit.H, kit.FORMAT], [1080, 1920, 'vertical']);
  kit.setFormat('landscape');
  assert.deepEqual([kit.W, kit.H, kit.FORMAT], [1920, 1080, 'landscape']);
  assert.throws(() => kit.setFormat('square'));
  assert.deepEqual(layouts.page.vertical, {w: 1080, h: 1220, phone: true});
  assert.deepEqual(layouts.page.landscape, {w: 1920, h: 1080, phone: false});
  assert.equal((await project('vertical')).format, 'vertical');
  assert.equal((await project()).format, 'landscape');
  await assert.rejects(project('square'));
});

test('essential vertical content sits inside the phone safe area', () => {
  const S = layouts.shared.vertical;
  inX(S.sample.x, 'sample note'); inY(S.sample.y, 'sample note');
  inX(S.railX0, 'rails'); inX(S.railX1, 'rails'); S.railY.forEach(y => inY(y, 'rail'));

  const O = layouts.open.vertical;
  assert.deepEqual([O.origin[0] + 240, O.origin[1] + 240], [540, 880], 'the mark centre');

  const P = layouts.plan.vertical;
  inBox(P.publish, 'publish button'); inY(P.day.y, 'day heading');
  for (const t of [P.word, ...P.captions]) { inX(t.x, 'plan type'); inY(t.y, 'plan type'); }
  // Under the push the word, the time and the speakers stay inside the safe area.
  const screen = x => 540 + (x - P.push.x) * P.push.zoom;
  const screenY = y => 960 + (y - (S.railY[1] + P.inset + P.cardH / 2 + P.push.drop)) * P.push.zoom;
  inX(screen(P.word.x), 'Plan. under the push'); inY(screenY(P.word.y - P.word.size * .72), 'Plan. under the push');
  inX(screen(S.railX0 + P.time.x), 'time under the push');
  inX(screen(S.railX1 - P.speaker.right + P.speaker.r), 'speakers under the push');
  inY(screenY(S.railY.at(-1)), 'last rule under the push');
  inY(S.railY.at(-1), 'last card');

  const H = layouts.shape.vertical;
  inBox(H.win, 'site window'); inX(H.word.x, 'Shape.'); inY(H.word.y, 'Shape.');
  for (let i = 0; i < 6; i++) inY(H.list.y + i * H.list.step, 'picker line');
  assert.ok(H.list.y + 5 * H.list.step < H.win.y, 'the picker ends above the window');
  inY(H.win.y + H.win.h + H.under.drop + 9 * H.under.k, 'mode switch row');
  inY(H.wall.y, 'wall title');
  for (let i = 0; i < H.wall.pages.length; i++) {
    const t = H.tile, col = i % t.cols, row = Math.floor(i / t.cols);
    inBox({x: t.x + col * (t.w + t.gap), y: t.y + row * (t.h + t.gap), w: t.w, h: t.h}, `wall tile ${i}`);
  }
  assert.equal(H.wall.pages.at(-1), 11, 'the window becomes the last tile, Atlas dark');

  const G = layouts.gather.vertical, {x: SX, y: SY} = G.stage;
  // The ticket with its stub is 620 wide at k = 1.
  const ticket = 620 * G.ticket.k;
  inBox({x: SX - ticket / 2, y: SY - 30 * G.ticket.k - 135 * G.ticket.k, w: ticket, h: 270 * G.ticket.k}, 'ticket');
  inX(SX + G.stepper.dx - 60, 'first step label'); inX(SX + G.stepper.dx + 4 * G.stepper.gap + 40, 'last step label');
  inY(SY + G.stepper.dy + G.stepper.labelDy, 'step labels');
  inBox({x: SX + G.grid.dx, y: SY + G.grid.dy, w: 7 * 106 + 86, h: 5 * 112 + 16 + 52}, 'check-in grid and count');
  for (let i = 0; i < 3; i++) inBox({x: SX + G.rows.dx, y: SY + G.rows.dy + i * G.rows.step, w: G.rows.w, h: G.rows.h}, `saved row ${i}`);
  inBox(G.phone, 'phone'); inBox(G.card, 'message card');
  for (const [arc, count] of [[0, 4], [1, 5], [2, 5]]) for (let slot = 0; slot < count; slot++) {
    const angle = G.fan.a0 + slot / (count - 1) * G.fan.spread, r = G.fan.r0 + arc * G.fan.dr;
    const x = G.fan.x + Math.cos(angle) * r * G.fan.sx, y = G.fan.y + Math.sin(angle) * r * G.fan.sy;
    inBox({x: x - G.face / 2, y: y - G.face / 2, w: G.face, h: G.face}, `recipient ${arc}.${slot}`);
  }
  for (const t of [G.word, G.caption]) { inX(t.x, 'gather type'); inY(t.y, 'gather type'); }

  const K = layouts.stack.vertical;
  inBox(K.win, 'merged page'); inX(K.label, 'part names'); inY(K.centre.y, 'bottom plate');
  for (const t of [...K.lines, K.note]) { inX(t.x, 'stack type'); inY(t.y, 'stack type'); }

  const M = layouts.montage.vertical;
  inX(M.label.x, 'band label'); assert.ok(M.art.right >= SAFE.x0, 'band drawing keeps the right margin');
  assert.ok(Math.abs(1920 / 8 * M.label.size - 100) < 2, 'band labels are about 100 px');

  const T = layouts.title.vertical;
  inX(T.hero.x, 'hero'); inY(T.hero.y, 'hero'); inY(T.top, 'lockup top');
  for (const l of T.tagline.lines) { inX(l.x, 'tagline'); inY(l.y, 'tagline'); }
  inY(T.words.rule, 'three words'); inY(T.url.y, 'site address');
});

test('vertical secondary type is 32 px or more', () => {
  const P = layouts.plan.vertical, H = layouts.shape.vertical, G = layouts.gather.vertical;
  const sizes = {
    'plan room': P.room.size, 'plan day': P.type.day, 'plan state': P.type.state, 'publish': P.type.publish,
    'speaker name': P.badge.name, 'speaker role': P.badge.role, 'picker': H.list.size, 'mode row': 28 * H.under.k,
    'ticket lines': Math.min(...G.ticket.type), 'step labels': G.stepper.label, 'step numbers': 20 * G.stepper.k, 'check-in count': G.grid.count,
    'row time': G.rows.time, 'row title': G.rows.title, 'phone title': G.phone.title.size, 'phone time': G.phone.slot.time.size,
    'phone session': G.phone.slot.name.size, 'message': G.card.message.size, 'recipients line': G.card.to.size, 'send': G.card.button.size,
  };
  for (const [name, size] of Object.entries(sizes)) assert.ok(size >= 32 - 1e-9, `${name} is ${size} px`);
  assert.ok(H.list.size >= 40, 'the picker labels are 40 px or more');
});

test('the landscape layout keeps its numbers', () => {
  // The whole of every landscape table, against the numbers recorded when the tables were
  // made from the literals of the landscape-only film. A landscape number changes the film
  // that was approved, so a change here must be on purpose: update the record with it.
  const record = JSON.parse(fs.readFileSync(new URL('./showreel-landscape-layout.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(record).sort(), Object.keys(layouts).sort());
  for (const [name, table] of Object.entries(layouts)) assert.deepEqual(JSON.parse(JSON.stringify(table.landscape)), record[name], `${name}: landscape table`);
  assert.deepEqual(layouts.shared.landscape, {railY: [160, 338, 516, 694, 872], railX0: 700, railX1: 1800, sample: {x: 120, y: 1014}});
  assert.deepEqual(layouts.open.landscape.origin, [720, 300]);
  assert.deepEqual(layouts.open.landscape.keys, [[918, 558, 4.4], [954, 558, 3.7], [954, 579, 3.0], [954, 579, 3.0], [960, 528, 1.32], [960, 540, 1]]);
  const P = layouts.plan.landscape;
  assert.deepEqual(P.publish, {x: 1610, y: 66, w: 190, h: 58});
  assert.deepEqual([P.cardH, P.inset, P.rise, P.push], [150, 14, 170, {x: 1290, drop: 10, zoom: 1.4}]);
  const H = layouts.shape.landscape;
  assert.deepEqual(H.win, {x: 700, y: 150, w: 1120, h: 630});
  assert.deepEqual(H.tile, {w: 430, h: 242, gap: 24, x: 64, y: 84, cols: 4, rows: 3});
  assert.deepEqual(H.wall.pages, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(H.crop, false);
  const G = layouts.gather.landscape;
  assert.deepEqual([G.stage, G.card.x, G.card.y, G.phone.x, G.phone.y, G.phone.w, G.phone.h], [{x: 1250, y: 500}, 850, 382, 1500, 238, 236, 470]);
  assert.deepEqual(G.fan, {x: 1100, y: 500, a0: -.86, spread: 1.72, r0: 400, dr: 132, sx: 1, sy: .8});
  const K = layouts.stack.landscape;
  assert.deepEqual([K.plate, K.gap, K.centre, K.win], [{w: 640, h: 400}, 104, {x: 1130, y: 700}, {x: 700, y: 170, w: 1120, h: 630}]);
  assert.deepEqual(layouts.montage.landscape, {label: {x: 120, size: .62, base: .2}, art: {right: 120, pad: 28}});
  const T = layouts.title.landscape;
  assert.deepEqual([T.scale, T.top, T.hero], [1.75, 112, {x: 960, y: 470, size: 7.6}]);
  assert.deepEqual(T.tagline.lines, [{text: 'Make room for your event.', x: 960, y: 726, delay: 0}]);
});

test('each format has its own frame cache, and a render removes only its own stale folders', async () => {
  const {cachePrefix, ownsFolder} = await import('../showreel/render.mjs');
  assert.equal(cachePrefix('landscape'), '');
  assert.equal(cachePrefix('vertical'), 'vertical-');
  assert.ok(ownsFolder('landscape', 'a14c7c478c429d6c') && !ownsFolder('landscape', 'vertical-a14c7c478c429d6c'));
  assert.ok(ownsFolder('vertical', 'vertical-a14c7c478c429d6c') && !ownsFolder('vertical', 'a14c7c478c429d6c'));
});
