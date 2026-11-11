// Title. On the chord Badger is large and running on the spot. The landing
// cuts to the official lockup and the name is uncovered beside the mark.
import {type C, type Project, W, spring, prog, outCubic, outExpo, clamp, rgb, text, ring, line, hash, TAU, setFont} from './kit.ts';
import {badger, REST, type Pose} from './badger.ts';
import {type Scene, ground, word, streaks, SOFT} from './shared.ts';

// Geometry of design/brand/badger-lockup.svg, enlarged by SCALE.
const SCALE = 1.75, MARK = 3 * SCALE, TEXT_X = 248 * SCALE, BASE = [133 * SCALE, 214 * SCALE], SIZE = 92 * SCALE, TOP = 112;

export function title(p: Project): Scene {
  const q = p.clock.cues.title, D = p.brand.dark, start = p.clock.scenes[6].start;
  const inks = {ink: D.ink, accent: D.primary, surface: D.surface};
  const WORDS = ['Plan.', 'Shape.', 'Gather.'];
  const confetti = Array.from({length: 22}, (_, i) => ({
    angle: -Math.PI / 2 + (hash(i * 3 + 1) - .5) * 2.5, speed: 520 + hash(i * 7 + 2) * 900, spin: (hash(i * 11) - .5) * 14,
    color: i % 3 === 0 ? D.ink : p.styles[i % 6].dark.primary, size: 7 + hash(i * 13) * 7, round: i % 4 === 0,
  }));
  let left = 0;

  return {from: start, to: p.clock.duration, draw(c: C, f: number) {
    if (!left) {
      // Centre the lockup on its real width, measured after fonts are ready.
      setFont(c, {family: 'Source', weight: 700, size: SIZE});
      left = (W - (TEXT_X + Math.max(c.measureText('Event').width, c.measureText('Runner').width))) / 2;
    }
    const running = f < q.land ? 1 : 0;
    const mx = left + 40 * MARK, my = TOP + 8 * SCALE + 40 * MARK;
    // Before the landing Badger is large at the centre; the landing is a cut to the lockup.
    const HERO = 7.6, hx = W / 2 - 40 * HERO, hy = 470 - 40 * HERO;
    const [ox, oy] = running ? [W / 2, 470] : [mx, my];
    const burst = outExpo(prog(f, q.impact, q.impact + 22));
    ground(c, D);

    // Impact: soft rings and rays.
    for (const delay of [0, 5, 11]) {
      const wave = prog(f, q.impact + delay, q.impact + delay + 30);
      if (wave > 0 && wave < 1) ring(c, ox, oy, 40 + 1100 * outCubic(wave), rgb(D.primary, SOFT * (1 - wave)), 8 * (1 - wave));
    }
    if (burst < 1) {
      c.save(); c.lineCap = 'round';
      for (let i = 0; i < 28; i++) {
        const a = i / 28 * TAU + hash(i) * .2, r0 = 330 + burst * 800, r1 = r0 + (60 + hash(i * 3) * 260) * (1 - burst);
        line(c, ox + Math.cos(a) * r0, oy + Math.sin(a) * r0, ox + Math.cos(a) * r1, oy + Math.sin(a) * r1, rgb(i % 3 ? D.ink : D.primary, SOFT * (1 - burst)), 5 * (1 - burst));
      }
      c.restore();
    }
    streaks(c, D.ink, running * prog(f, q.impact, q.impact + 5), 71, f);

    // He runs on the spot: the body holds still and bright, the legs are a soft smear.
    // The body does not bob and the limbs stay at SOFT. At this size both count as
    // transitions for the flash screen, and the landing cut is under a second away.
    const pose: Pose = {
      ...REST,
      runAmount: running, bob: 0, run: (f - q.impact) / 30 * 2.6, limbAlpha: running ? SOFT : 1,
      lean: running ? .26 : .16,
      squash: 1 - .14 * Math.max(0, 1 - Math.abs(f - q.land - 1.5) / 3),
      barStretch: 1 + 4 * running,
      blink: Math.max(0, 1 - Math.abs(f - q.blink - 2) / 2.5),
    };
    // Dust where the feet stop.
    for (let i = 0; i < 7; i++) {
      const t = prog(f, q.land, q.land + 16 + i * 2);
      if (t <= 0 || t >= 1) continue;
      const side = i % 2 ? 1 : -1, x = mx + side * (30 + outCubic(t) * (60 + i * 16)), y = TOP + 8 * SCALE + 71 * MARK - outCubic(t) * (8 + i * 5);
      c.beginPath(); c.arc(x, y, 6 + 16 * t, 0, TAU); c.fillStyle = rgb(D.inkMuted, SOFT * (1 - t)); c.fill();
    }
    c.save();
    // He is there at full size on the chord. A grow would sweep bright strokes across the frame.
    if (running) { c.translate(hx, hy); c.scale(HERO, HERO); }
    else { c.translate(left, TOP + 8 * SCALE); c.scale(MARK, MARK); }
    badger(c, pose, inks); c.restore();

    // A little confetti from the landing, gone before the picture settles.
    for (const [i, piece] of confetti.entries()) {
      const t = (f - q.land) / 30;
      if (t <= 0 || t > 2.4) continue;
      const drag = 1 - Math.exp(-t * 2.2), x = mx + Math.cos(piece.angle) * piece.speed * drag / 2.2, y = my + Math.sin(piece.angle) * piece.speed * drag / 2.2 + 520 * t * t;
      c.save(); c.translate(x, y); c.rotate(piece.spin * t + i); c.scale(1, Math.cos(t * 9 + i)); c.fillStyle = rgb(piece.color, clamp(2.2 - t * 1.2));
      if (piece.round) { c.beginPath(); c.arc(0, 0, piece.size / 2, 0, TAU); c.fill(); } else c.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      c.restore();
    }

    // The wordmark is uncovered from the mark outward; the letters do not travel.
    ['Event', 'Runner'].forEach((value, row) => {
      const shown = outCubic(prog(f, q.wordmark + 2 + row * 4, q.wordmark + 13 + row * 4));
      if (shown <= 0) return;
      c.save(); c.beginPath(); c.rect(left + TEXT_X - 10, TOP + BASE[row] - SIZE, (W - left - TEXT_X) * shown, SIZE * 1.4); c.clip();
      text(c, value, left + TEXT_X, TOP + BASE[row], {family: 'Source', weight: 700, size: SIZE, color: rgb(D.ink)}); c.restore();
    });
    word(c, 'Make room for your event.', W / 2, 726, 96, D.ink, f, q.tagline, Infinity, 'center', 1);
    // Three words, one on each of the last three notes.
    setFont(c, {family: 'Source', weight: 700, size: 54});
    const gap = 48, widths = WORDS.map(value => c.measureText(value).width), total = widths.reduce((a, b) => a + b, 0) + gap * 2;
    let x = (W - total) / 2;
    WORDS.forEach((value, i) => {
      const s = spring(f, q.words[i], 3, .5);
      if (s > 0) text(c, value, x, 826 + (1 - s) * 34, {family: 'Source', weight: 700, size: 54, color: rgb(D.primary, clamp(s * 1.5))});
      const ping = prog(f, q.words[i], q.words[i] + 12);
      if (ping > 0 && ping < 1) line(c, x, 846, x + widths[i] * outCubic(ping), 846, rgb(D.primary, 1 - ping), 3);
      x += widths[i] + gap;
    });
    // Typed in whole characters on whole frames, complete before the picture settles.
    const url = p.copy.site, typed = Math.floor(clamp((Math.floor(f) - q.url + 1) * 2.5, 0, url.length));
    if (typed > 0) text(c, url.slice(0, typed), W / 2, 940, {size: 40, weight: 600, align: 'center', color: rgb(D.inkMuted)});
  }};
}
