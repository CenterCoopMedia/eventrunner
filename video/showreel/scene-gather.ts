// Gather. One object becomes the next: a ticket bought in steps, torn into a
// badge that joins everyone at check-in, sessions saved to a phone, and one
// announcement sent to everyone registered.
import {type C, type Project, type Point, H, spring, prog, outCubic, inCubic, inOutCubic, inQuint, outExpo, clamp, lerp, rgb, mix, text, fillBox, strokeBox, disc, ring, line, shadowed, quadPoints, along, trace, hash} from './kit.ts';
import {type Scene, ground, word, phrase, sample, streaks, SOFT} from './shared.ts';
import {face} from './badger.ts';

const SX = 1250, SY = 500;

export function gather(p: Project): Scene {
  const q = p.clock.cues.gather, D = p.brand.dark, [start, end] = [p.clock.scenes[3].start, p.clock.scenes[3].end];
  const enter = p.clock.cues.shape.exit + 6, e = p.experience;
  const inks = {ink: D.ink, accent: D.primary, surface: D.surface};
  const STEPS = ['Tickets', 'Attendees', 'Questions', 'Review', 'Pay'];
  const COLS = 8, ROWS = 5, CELL = 86, GX = SX - 400, GY = SY - 262;
  const cell = (col: number, row: number): Point => [GX + col * 106 + CELL / 2, GY + row * 112 + CELL / 2];
  const checkedAt = (col: number, row: number) => q.checkIn[0] + (col + row * 1.4) / (COLS - 1 + (ROWS - 1) * 1.4) * (q.checkIn[1] - q.checkIn[0] - 10);
  const rowY = (i: number) => SY - 190 + i * 118;
  const PHONE = {x: SX + 250, y: SY - 262, w: 236, h: 470};
  const slotY = (i: number) => PHONE.y + 104 + i * 92;
  const saved = e.sessions.slice(0, 3);

  function ticket(c: C, f: number) {
    const torn = prog(f, q.tear, q.tear + 14);
    if (f < q.ticket || torn >= 1) return;
    // The ticket is uncovered from the left where it lies, like a print leaving a slot.
    const land = outCubic(prog(f, q.ticket, q.ticket + 12)), w = 620, h = 270, stub = 168;
    const paid = spring(f, q.steps[4] + 2, 3, .45);
    // The main part shrinks to the first badge of the check-in grid.
    const [bx, by] = cell(0, 0), m = inOutCubic(torn);
    // Paper goes dark in three frames, before it travels.
    const dark = prog(f, q.tear, q.tear + 3);
    c.save();
    if (land < 1) { c.beginPath(); c.rect(SX - 420, SY - 260, 860 * land, 520); c.clip(); }
    c.translate(lerp(SX - stub / 2, bx, m), lerp(SY - 30, by, m)); c.rotate(lerp(-.06, 0, m));
    const mw = lerp(w - stub, CELL * .76, m), mh = lerp(h, CELL * .76, m);
    shadowed(c, 50, 24, .45 * (1 - m), () => fillBox(c, -mw / 2, -mh / 2, mw, mh, lerp(8, 14, m), rgb(mix(D.ink, D.surface, dark))));
    if (dark < 1) {
      const a = 1 - dark;
      // Plain ticket: the ticket type, then the event, then when and where.
      text(c, 'General admission', -mw / 2 + 40, -mh / 2 + 96, {family: 'Bricolage', weight: 800, size: 46, tracking: -1, color: rgb(D.surface, a)});
      text(c, e.name, -mw / 2 + 40, -mh / 2 + 160, {size: 30, weight: 700, color: rgb(D.surface, a)});
      text(c, `${e.dates} · ${e.venue}`, -mw / 2 + 40, -mh / 2 + 206, {size: 26, weight: 400, color: rgb(D.surfaceAlt, a)});
      if (paid > 0) {
        c.save(); c.translate(mw / 2 - 74, -mh / 2 + 48); c.rotate(-.1); c.scale(paid, paid);
        strokeBox(c, -50, -24, 100, 48, 4, rgb(D.surface, a), 3);
        text(c, 'Paid', 0, 2, {size: 28, weight: 700, align: 'center', baseline: 'middle', color: rgb(D.surface, a)}); c.restore();
      }
    }
    // The stub is joined at a perforation until the tear, then falls away.
    const fall = (f - q.tear) / 30, gone = Math.max(0, fall);
    c.save(); c.translate(mw / 2 + stub / 2 + gone * 190, gone * gone * 1500); c.rotate(gone * 2.6);
    if (dark < 1) {
      const a = 1 - dark;
      fillBox(c, -stub / 2, -h / 2, stub, h, 8, rgb(D.ink, a));
      text(c, '1 ×', 0, 12, {family: 'Bricolage', weight: 800, size: 56, align: 'center', color: rgb(D.surface, a)});
      for (let i = 0; i < 9 && fall < 0; i++) disc(c, -stub / 2, -h / 2 + 30 + i * 26.5, 6, rgb(D.surface));
    }
    c.restore(); c.restore();
  }

  function stepper(c: C, f: number) {
    const show = outCubic(prog(f, q.steps[0] - 12, q.steps[0] - 2)) * (1 - prog(f, q.tear - 2, q.tear + 5));
    if (show <= 0) return;
    const y = SY + 222, x0 = SX - 384, gap = 150;
    let done = 0;
    q.steps.forEach((cue, i) => { if (i) done += outCubic(prog(f, cue - 5, cue + 2)); });
    c.globalAlpha = show; c.lineCap = 'round';
    line(c, x0, y, x0 + gap * 4, y, rgb(mix(D.surface, D.ink, .22)), 4);
    line(c, x0, y, x0 + gap * done, y, rgb(D.primary), 4);
    STEPS.forEach((label, i) => {
      const pop = spring(f, q.steps[i], 3.2, .42), x = x0 + i * gap;
      disc(c, x, y, 13 + 7 * pop, rgb(mix(mix(D.surface, D.ink, .22), D.primary, clamp(pop * 2))));
      // The last step shows a drawn tick: the loaded faces have no tick glyph.
      if (pop > 0 && i === 4) { c.lineJoin = 'round'; trace(c, [[x - 7, y], [x - 2, y + 5], [x + 7, y - 5]], 0, 1, rgb(D.surface, clamp(pop * 2)), 3.5); }
      else if (pop > 0) text(c, String(i + 1), x, y + 1, {family: 'Mono', weight: 500, size: 20, align: 'center', baseline: 'middle', color: rgb(D.surface, clamp(pop * 2))});
      text(c, label, x, y + 58, {size: 24, weight: 600, align: 'center', color: rgb(mix(D.inkMuted, D.ink, clamp(pop)))});
      const ping = prog(f, q.steps[i], q.steps[i] + 12);
      if (ping > 0 && ping < 1) ring(c, x, y, 20 + 34 * outExpo(ping), rgb(D.primary, SOFT * (1 - ping)), 3 * (1 - ping));
    });
    c.globalAlpha = 1;
  }

  function checkIn(c: C, f: number) {
    const appear = q.tear + 4, merge = prog(f, q.bookmarks[0] - 9, q.bookmarks[0] + 2);
    if (f < appear || merge >= 1) return;
    let count = 0;
    for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
      const [x, y] = cell(col, row), first = col === 0 && row === 0;
      const pop = first ? prog(f, q.tear + 9, q.tear + 14) : outCubic(prog(f, appear + (col + row) * 1.1, appear + 8 + (col + row) * 1.1));
      const at = checkedAt(col, row), checked = outCubic(prog(f, at, at + 6));
      if (Math.floor(f) >= at) count++;
      if (pop <= 0) continue;
      // Leaving: each badge is drawn into the session row nearest to it.
      const ty = rowY(Math.min(2, Math.floor(row / 1.7))) + 46, k = inCubic(clamp(merge * 1.4 - col * .03));
      const s = lerp(.8, 1, pop) * (1 - k) * CELL / 24;
      c.save(); c.translate(lerp(x, SX - 140, k), lerp(y, ty, k)); c.scale(s, s); c.translate(-12, -12.5);
      face(c, inks, checked, pop * lerp(.55, 1, checked) * (1 - clamp(merge * 4))); c.restore();
      const ping = prog(f, at, at + 10);
      if (ping > 0 && ping < 1) ring(c, x, y, 40 + 26 * outExpo(ping), rgb(D.primary, SOFT * (1 - ping)), 3 * (1 - ping));
    }
    const fade = prog(f, appear + 6, appear + 14) * (1 - merge * 3), total = COLS * ROWS, bar = GY + ROWS * 112 + 16;
    if (fade > 0) {
      fillBox(c, GX, bar, 826, 8, 4, rgb(mix(D.surface, D.ink, .2), fade));
      fillBox(c, GX, bar, 826 * count / total, 8, 4, rgb(D.primary, fade));
      text(c, `${count} of ${total} checked in`, GX, bar + 52, {size: 28, weight: 600, color: rgb(D.inkMuted, fade)});
    }
  }

  function bookmark(c: C, x: number, y: number, filled: number, pop: number) {
    c.save(); c.translate(x, y); c.scale(1 + .35 * (pop - filled), 1 + .35 * (pop - filled));
    c.beginPath(); c.moveTo(-11, -16); c.lineTo(11, -16); c.lineTo(11, 16); c.lineTo(0, 7); c.lineTo(-11, 16); c.closePath();
    c.fillStyle = rgb(D.primary, filled); c.fill(); c.strokeStyle = rgb(mix(D.inkMuted, D.primary, filled)); c.lineWidth = 2.5; c.lineJoin = 'round'; c.stroke(); c.restore();
  }

  function saving(c: C, f: number) {
    const appear = q.bookmarks[0] - 8, away = inCubic(prog(f, q.send - 9, q.send - 1));
    if (f < appear || away >= 1) return;
    const RW = 600, RH = 92, rx = SX - 420;
    c.save(); c.globalAlpha = 1 - clamp(away * 4);
    saved.forEach((s, i) => {
      const grow = outCubic(prog(f, appear + i * 2, appear + 8 + i * 2)), y = rowY(i), x = rx - away * 260;
      const filled = outCubic(prog(f, q.bookmarks[i], q.bookmarks[i] + 5)), pop = spring(f, q.bookmarks[i], 3.2, .4);
      c.save(); c.translate(x + RW / 2, y + RH / 2); c.scale(clamp(grow, 0, 1.2), 1); c.translate(-RW / 2, -RH / 2);
      fillBox(c, 0, 0, RW, RH, 4, rgb(mix(D.surfaceAlt, D.primary, .05 + .12 * filled)));
      const shown = prog(f, appear + 7 + i * 2, appear + 13 + i * 2);
      text(c, s.time, 28, 56, {family: 'Mono', weight: 500, size: 26, color: rgb(D.ink, shown)});
      text(c, s.title, 130, 56, {size: 25, weight: 700, color: rgb(D.ink, shown)});
      bookmark(c, RW - 40, RH / 2, filled, pop); c.restore();
    });
    // The phone, with a place for each saved session.
    const up = outCubic(prog(f, appear + 2, appear + 10)), px = PHONE.x + away * 300, py = PHONE.y + (1 - up) * 60;
    c.globalAlpha *= up;
    shadowed(c, 50, 24, .45, () => fillBox(c, px, py, PHONE.w, PHONE.h, 34, rgb(D.surface)));
    strokeBox(c, px, py, PHONE.w, PHONE.h, 34, rgb(D.ink), 3.5);
    fillBox(c, px + PHONE.w / 2 - 34, py + 16, 68, 8, 4, rgb(D.ink, .5));
    text(c, 'My schedule', px + 24, py + 76, {size: 25, weight: 700, color: rgb(D.ink)});
    saved.forEach((s, i) => {
      const y = slotY(i) + (py - PHONE.y), landed = spring(f, q.arrivals[i], 3, .5);
      strokeBox(c, px + 18, y, PHONE.w - 36, 76, 4, rgb(mix(D.surface, D.ink, .2)), 2);
      if (landed > 0) {
        // The slot is filled the moment the copy arrives; only its type fades up.
        fillBox(c, px + 18, y, PHONE.w - 36, 76, 4, rgb(mix(D.surfaceAlt, D.primary, .28)));
        text(c, s.time, px + 32, y + 30, {family: 'Mono', weight: 500, size: 18, color: rgb(D.ink, clamp(landed))});
        text(c, s.title.length > 19 ? `${s.title.slice(0, 18)}…` : s.title, px + 32, y + 58, {size: 19, weight: 700, color: rgb(D.ink, clamp(landed))});
        const ping = prog(f, q.arrivals[i], q.arrivals[i] + 12);
        if (ping > 0 && ping < 1) strokeBox(c, px + 18 - 14 * ping, y - 14 * ping, PHONE.w - 36 + 28 * ping, 76 + 28 * ping, 4 + 14 * ping, rgb(D.primary, SOFT * (1 - ping)), 3);
      }
      // The copy leaves the session, which stays where it is.
      const t = prog(f, q.bookmarks[i] + 2, q.arrivals[i]);
      if (t > 0 && t < 1) {
        const from: Point = [rx + RW / 2, rowY(i) + RH / 2], to: Point = [px + PHONE.w / 2, y + 38];
        const [x2, y2] = along(quadPoints(from, [lerp(from[0], to[0], .5), Math.min(from[1], to[1]) - 190], to), inOutCubic(t));
        const w = lerp(RW, PHONE.w - 36, inOutCubic(t)), h = lerp(RH, 76, inOutCubic(t));
        shadowed(c, 30, 14, .4, () => fillBox(c, x2 - w / 2, y2 - h / 2, w, h, 4, rgb(mix(D.surfaceAlt, D.primary, .28), .96)));
      }
    });
    c.restore();
  }

  // Recipients sit on two arcs to the right of the message.
  const PEOPLE = Array.from({length: 14}, (_, i) => {
    const [arc, slot, count] = i < 4 ? [0, i, 4] : i < 9 ? [1, i - 4, 5] : [2, i - 9, 5];
    const angle = -.86 + slot / (count - 1) * 1.72, radius = 400 + arc * 132;
    const at = q.delivered[0] + hash(i * 17 + 3) * (q.delivered[1] - q.delivered[0]);
    return {x: SX - 150 + Math.cos(angle) * radius, y: SY + Math.sin(angle) * radius * .8, at, leave: q.send + 1 + hash(i * 5 + 1) * 8};
  });
  function announce(c: C, f: number) {
    const appear = q.send - 8;
    if (f < appear) return;
    const up = outCubic(prog(f, appear + 2, appear + 9)), press = Math.max(0, 1 - Math.abs(f - q.send - 1.5) / 3);
    const cw = 500, ch = 236, cx = SX - 400, cy = SY - 118 + (1 - up) * 14;
    c.save(); c.globalAlpha = up;
    PEOPLE.forEach((person, i) => {
      const pop = outCubic(prog(f, appear + 3 + i * .9, appear + 10 + i * .9)), got = outCubic(prog(f, person.at, person.at + 6));
      const s = lerp(.8, 1, pop) * 64 / 24;
      c.save(); c.translate(person.x, person.y); c.scale(s, s); c.translate(-12, -12.5); face(c, inks, got, pop * lerp(.5, 1, got)); c.restore();
      const ping = prog(f, person.at, person.at + 12);
      if (ping > 0 && ping < 1) ring(c, person.x, person.y, 30 + 30 * outExpo(ping), rgb(D.primary, SOFT * (1 - ping)), 3 * (1 - ping));
      // Paper dart from the send button to this person.
      const t = prog(f, person.leave, person.at);
      if (t > 0 && t < 1) {
        const from: Point = [cx + cw - 80, cy + ch - 52], to: Point = [person.x, person.y];
        const path = quadPoints(from, [lerp(from[0], to[0], .45), Math.min(from[1], to[1]) - 150 - hash(i) * 120], to);
        const k = inOutCubic(t), [x, y] = along(path, k), [nx, ny] = along(path, Math.min(1, k + .02));
        c.lineCap = 'round'; trace(c, path, Math.max(0, k - .22), k, rgb(D.primary, SOFT), 2.5);
        c.save(); c.translate(x, y); c.rotate(Math.atan2(ny - y, nx - x));
        c.beginPath(); c.moveTo(13, 0); c.lineTo(-13, -10); c.lineTo(-6, 0); c.lineTo(-13, 10); c.closePath(); c.fillStyle = rgb(D.ink, .55); c.fill(); c.restore();
      }
    });
    shadowed(c, 50, 24, .45, () => fillBox(c, cx, cy, cw, ch, 6, rgb(D.surfaceAlt)));
    text(c, 'Doors open at 08:30.', cx + 32, cy + 78, {family: 'Bricolage', weight: 800, size: 40, tracking: -.8, color: rgb(D.ink)});
    text(c, 'To: registered attendees', cx + 32, cy + 126, {size: 27, weight: 400, color: rgb(D.inkMuted)});
    const sent = f >= q.send + 3;
    c.save(); c.translate(cx + cw - 80, cy + ch - 52); c.scale(1 - .1 * press, 1 - .1 * press);
    fillBox(c, -56, -24, 112, 48, 4, rgb(mix(D.primary, D.ink, .5 * press)));
    text(c, sent ? 'Sent' : 'Send', 0, 2, {size: 24, weight: 700, align: 'center', baseline: 'middle', color: rgb(D.surface)}); c.restore();
    c.restore();
  }

  return {from: enter, to: end, draw(c: C, f: number) {
    const arrive = outCubic(prog(f, enter, start - 1)), leave = inQuint(prog(f, end - 11, end));
    c.translate(0, H * (1 - arrive) * 1.0);
    ground(c, D);
    c.save(); c.translate(SX, SY); c.scale(1 + leave * .9, 1 + leave * .9); c.translate(-SX, -SY); c.globalAlpha = 1 - leave;
    stepper(c, f); ticket(c, f); checkIn(c, f); saving(c, f); announce(c, f);
    c.restore();
    c.globalAlpha = 1 - leave;
    word(c, 'Gather.', 108, 470, 176, D.ink, f, q.ticket);
    const lines: [string, number, number][] = [['Register in clear steps.', q.ticket + 10, q.tear - 6], ['Check people in.', q.tear, q.bookmarks[0] - 8], ['Attendees save sessions.', q.bookmarks[0] - 2, q.send - 8], ['Announce to everyone registered.', q.send - 2, Infinity]];
    for (const [value, from, out] of lines) phrase(c, value, 120, 568, {size: 40, color: D.inkMuted}, f, from, out);
    sample(c, p.copy.sample, D.inkMuted, arrive);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    streaks(c, D.ink, Math.sin(Math.PI * prog(f, enter - 4, start + 2)) * .5 + leave * .7, 37, f);
  }};
}
