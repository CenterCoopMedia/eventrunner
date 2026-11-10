// Plan. The rules fill with sessions, speakers dock on a session, one start time
// changes and the list makes room, and the draft is published.
import {type C, type Project, type RGB, W, H, camera, spring, prog, outCubic, inOutCubic, inOutQuint, outExpo, clamp, lerp, rgb, mix, line, text, kinetic, fillBox, strokeBox, ring, shadowed, quadPoints, along} from './kit.ts';
import {type Scene, ground, RAIL_Y, RAIL_X0, RAIL_X1, rule, word, phrase, sample, initials, SOFT} from './shared.ts';

const PUBLISH = {x: RAIL_X1 - 190, y: 66, w: 190, h: 58};
// Corners follow the product's own radius token, not a soft card look.
const RADIUS = 4;

export function plan(p: Project): Scene {
  const q = p.clock.cues.plan, D = p.brand.dark, [start, end] = [p.clock.scenes[1].start, p.clock.scenes[1].end];
  const sessions = p.experience.sessions.slice(0, 4), speakers = p.experience.speakers;
  const CARD_W = RAIL_X1 - RAIL_X0, CARD_H = 150;
  const slot = (k: number) => RAIL_Y[k] + 14;
  // A staff edit: the third session moves to 09:30. The list sorts by start
  // time and title, as the admin schedule does, and the slots follow.
  const MOVED = 2, NEW_TIME = '09:30';
  const sorted = sessions.map((s, index) => ({index, key: `${index === MOVED ? NEW_TIME : s.time} ${s.title}`})).sort((a, b) => (a.key < b.key ? -1 : 1));
  const after = sessions.map((_, index) => sorted.findIndex(entry => entry.index === index));
  const move = q.lift + 12;
  const tint = (amount: number): RGB => mix(D.surfaceAlt, D.primary, amount);

  function digits(c: C, value: string, old: string | null, x: number, y: number, f: number, at: number) {
    // Each character rolls up into place; the old value rolls out above it.
    c.save(); c.beginPath(); c.rect(x - 4, y - 34, 140, 44); c.clip();
    for (const [string, direction] of [[old, -1], [value, 1]] as const) {
      if (!string) continue;
      kinetic(c, string, x, y, {family: 'Mono', weight: 500, size: 32, color: rgb(D.ink)}, i => {
        const s = outCubic(prog(f, at + i * 1.5, at + i * 1.5 + 8));
        c.translate(0, direction > 0 ? (1 - s) * 44 : -s * 44);
      });
    }
    c.restore();
  }

  function card(c: C, index: number, f: number) {
    const s = sessions[index], enter = q.cards[index];
    if (f < enter) return;
    const rise = outCubic(prog(f, enter, enter + 10));
    const moved = index === MOVED;
    const shift = moved ? inOutCubic(prog(f, move, q.drop)) : spring(f, move + 4 + index * 3, 2.2, .6);
    let y = lerp(slot(index), slot(after[index]), shift), x = RAIL_X0, scale = 1, tilt = 0, lift = 0;
    if (moved) {
      lift = clamp(spring(f, q.lift, 2.4, .5)) * (1 - spring(f, q.drop, 3, .45));
      scale = 1 + .035 * lift; tilt = -.014 * lift; x -= 46 * Math.sin(Math.PI * shift);
    }
    // Type dims while its card travels and is bright again at rest.
    const lit = lerp(1, SOFT, clamp(Math.sin(Math.PI * clamp(shift)) * 4));
    const focus = index === 1 ? outCubic(prog(f, q.push, q.push + 10)) * (1 - prog(f, q.lift - 6, q.lift)) : 0;
    c.save();
    // New cards rise out of the rule below them.
    if (rise < 1) { c.beginPath(); c.rect(0, RAIL_Y[index], W, RAIL_Y[index + 1] - RAIL_Y[index]); c.clip(); y += (1 - rise) * 170; }
    c.translate(x + CARD_W / 2, y + CARD_H / 2); c.rotate(tilt); c.scale(scale, scale); c.translate(-CARD_W / 2, -CARD_H / 2);
    shadowed(c, 12 + 50 * lift, 6 + 26 * lift, .28 + .3 * lift, () => fillBox(c, 0, 0, CARD_W, CARD_H, RADIUS, rgb(tint(.05 + .1 * focus + .08 * lift))));
    c.globalAlpha = lit;
    if (focus > 0) strokeBox(c, 0, 0, CARD_W, CARD_H, RADIUS, rgb(D.primary, focus), 3);
    const changed = moved && f >= q.lift + 5;
    digits(c, changed ? NEW_TIME : s.time, changed ? s.time : null, 36, 88, f, changed ? q.lift + 5 : enter + 8);
    const reveal = outCubic(prog(f, enter + 8, enter + 17));
    text(c, s.title, 196 + (1 - reveal) * 24, 70, {size: 38, weight: 700, color: rgb(D.ink, reveal)});
    text(c, s.room, 196 + (1 - reveal) * 36, 112, {size: 27, weight: 400, color: rgb(D.inkMuted, reveal)});
    // Speakers: the focused session receives its two on cue, the rest follow.
    s.speakerIds.forEach((id, k) => {
      const person = speakers.find(sp => sp.id === id)!;
      const at = index === 1 ? q.speakers[k] + 9 : q.speakers[1] + 16 + index * 3;
      // A docked speaker takes over from the flying card at full size; the rest pop in.
      const pop = index === 1 ? (f >= at ? 1 : 0) : spring(f, at, 3, .45);
      const cx = CARD_W - 62 - k * 60, cy = CARD_H / 2;
      initials(c, person.name, cx, cy, 27 * pop, tint(.42), D.ink);
      const ping = prog(f, at, at + 14);
      if (ping > 0 && ping < 1) ring(c, cx, cy, 27 + 40 * outExpo(ping), rgb(D.primary, SOFT * (1 - ping)), 3 * (1 - ping));
    });
    c.restore();
  }

  function flyingSpeaker(c: C, k: number, f: number) {
    // A name card arcs in from off screen and shrinks onto its place on the session.
    const from = q.speakers[k] - 6, to = q.speakers[k] + 9;
    if (f < from || f >= to) return;
    const person = speakers.find(sp => sp.id === sessions[1].speakerIds[k])!;
    const target: [number, number] = [RAIL_X0 + CARD_W - 62 - k * 60, slot(1) + CARD_H / 2];
    const path = quadPoints([W + 260, k ? 760 : 60], [target[0] + 220, target[1] + (k ? 240 : -260)], target);
    const t = inOutCubic(prog(f, from, to)), [x, y] = along(path, t), shrink = prog(f, to - 6, to);
    const w = 330 * (1 - shrink) + 54 * shrink, h = 76 * (1 - shrink) + 54 * shrink;
    c.save(); c.translate(x, y); c.rotate((1 - t) * (k ? -.25 : .25));
    shadowed(c, 30, 14, .4, () => fillBox(c, -h / 2, -h / 2, w, h, lerp(RADIUS, h / 2, shrink), rgb(tint(.3))));
    initials(c, person.name, 0, 0, 27, tint(.3), D.ink, SOFT + .2);
    text(c, person.name, 42, -4, {size: 26, weight: 700, color: rgb(D.ink, (SOFT + .2) * (1 - shrink * 2))});
    text(c, person.role, 42, 24, {size: 22, weight: 400, color: rgb(D.inkMuted, (SOFT + .2) * (1 - shrink * 2))});
    c.restore();
  }

  return {from: start, to: end, draw(c: C, f: number) {
    c.translate(-W * inOutQuint(prog(f, q.wipe + 10, end)), 0);
    const push = spring(f, q.push, 2.8, .92) - spring(f, q.lift - 4, 2.8, .92);
    const cx = lerp(W / 2, 1290, push), cy = lerp(H / 2, slot(1) + CARD_H / 2 + 10, push);
    const zoom = lerp(1, 1.4, push);
    ground(c, D);
    c.save(); camera(c, cx, cy, zoom);

    // Rules arrive spanning the frame and draw back to the list.
    const retract = outExpo(prog(f, start, start + 16));
    const live = prog(f, q.publish, q.publish + 22);
    RAIL_Y.forEach((y, i) => {
      line(c, lerp(-200, RAIL_X0, retract), y, lerp(W + 200, RAIL_X1, retract), y, rgb(rule(D)), 2);
      // On publish a pulse runs along every rule.
      const head = lerp(RAIL_X0, RAIL_X1, outCubic(prog(f, q.publish + i * 2, q.publish + 16 + i * 2)));
      if (live > 0 && live < 1) line(c, Math.max(RAIL_X0, head - 260), y, head, y, rgb(D.primary, 1 - live), 3);
    });

    // The day heading of the list, as plain text.
    text(c, p.copy.day, RAIL_X0, 108, {size: 30, weight: 600, color: rgb(D.inkMuted, prog(f, start + 8, start + 16))});
    // Record state and the publish control.
    const state = outCubic(prog(f, q.lift + 8, q.lift + 18));
    if (state > 0) {
      const {x, y, w, h} = PUBLISH, down = Math.max(0, 1 - Math.abs(f - q.publish - 1.5) / 3);
      // Record state in words, as the admin shows it: no chip and no dot.
      const isLive = f >= q.publish + 3, shown = isLive ? prog(f, q.publish + 3, q.publish + 9) : 1;
      text(c, isLive ? 'Live' : 'Draft, 1 change', x - 28, y + h / 2 + 2, {size: 28, weight: 600, align: 'right', baseline: 'middle', color: rgb(isLive ? D.primary : D.inkMuted, state * shown)});
      c.save(); c.translate(x + w / 2, y + h / 2); c.scale(1 - .08 * down, 1 - .08 * down); c.globalAlpha = state;
      fillBox(c, -w / 2, -h / 2, w, h, RADIUS, rgb(mix(D.primary, D.ink, .5 * down)));
      text(c, 'Publish', 0, 2, {size: 26, weight: 700, align: 'center', baseline: 'middle', color: rgb(D.surface)});
      c.restore();
      for (const delay of [0, 7]) {
        const wave = prog(f, q.publish + delay, q.publish + delay + 26);
        if (wave > 0 && wave < 1) ring(c, x + w / 2, y + h / 2, 40 + 520 * outCubic(wave), rgb(D.primary, SOFT * (1 - wave)), 5 * (1 - wave));
      }
    }
    // The moved card is drawn last so it passes over the others.
    for (const index of [0, 1, 2, 3]) if (index !== MOVED) card(c, index, f);
    card(c, MOVED, f);
    flyingSpeaker(c, 0, f); flyingSpeaker(c, 1, f);

    word(c, 'Plan.', 108, 470, 250, D.ink, f, q.word);
    // Two captions, each on screen for about three seconds.
    phrase(c, 'Build the schedule.', 120, 568, {size: 44, color: D.inkMuted}, f, q.word + 12, q.lift - 6);
    phrase(c, 'Change a time.', 120, 568, {size: 44, color: D.inkMuted}, f, q.lift, Infinity);
    phrase(c, 'The list makes room.', 120, 626, {size: 44, color: D.ink}, f, move + 2, Infinity);
    c.restore();
    sample(c, p.copy.sample, D.inkMuted, prog(f, start + 20, start + 34) * (1 - clamp(push * 3)));
  }};
}
