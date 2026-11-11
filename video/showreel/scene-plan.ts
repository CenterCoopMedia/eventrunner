// Plan. The rules fill with sessions, speakers dock on a session, one start time
// changes and the list makes room, and the draft is published.
import {type C, type Format, type Project, type RGB, W, H, camera, spring, prog, outCubic, inOutCubic, inOutQuint, outExpo, clamp, lerp, rgb, mix, line, text, kinetic, fillBox, strokeBox, ring, shadowed, quadPoints, along} from './kit.ts';
import {type Scene, ground, LAYOUT as SHARED, rule, word, phrase, sample, initials, SOFT} from './shared.ts';

type Text = {x: number; y: number; size: number};
/**
 * Frame-dependent positions. Cards sit between the shared rules: `inset` below
 * a rule, `cardH` high, and they rise from `rise` below their place. Card type
 * is in card space. `push` is the camera at the push cue: centre x, a drop
 * below the second card's centre, and zoom. `fly` is where each speaker's
 * name card enters, as a y on the right edge.
 */
export const LAYOUT: Record<Format, {
  publish: {x: number; y: number; w: number; h: number}; day: {y: number}; word: Text; captions: [Text, Text];
  cardH: number; inset: number; rise: number; time: {x: number; y: number}; title: Text; room: Text;
  push: {x: number; drop: number; zoom: number}; fly: [number, number];
  speaker: {r: number; right: number; pitch: number}; badge: {w: number; h: number; k: number; name: number; role: number}; type: {day: number; state: number; publish: number};
}> = {
  landscape: {
    publish: {x: SHARED.landscape.railX1 - 190, y: 66, w: 190, h: 58}, day: {y: 108},
    word: {x: 108, y: 470, size: 250}, captions: [{x: 120, y: 568, size: 44}, {x: 120, y: 626, size: 44}],
    cardH: 150, inset: 14, rise: 170, time: {x: 36, y: 88}, title: {x: 196, y: 70, size: 38}, room: {x: 196, y: 112, size: 27},
    push: {x: 1290, drop: 10, zoom: 1.4}, fly: [60, 760],
    speaker: {r: 27, right: 62, pitch: 60}, badge: {w: 330, h: 76, k: 1, name: 26, role: 22}, type: {day: 30, state: 28, publish: 26},
  },
  // A stacked page: the word and captions on top, a header row, then four
  // cards the width of the safe area. The word and the cards already span the
  // safe width, so the camera holds still at the push: any zoom would move them
  // out of it. The focus outline on the second card marks the beat.
  vertical: {
    publish: {x: SHARED.vertical.railX1 - 210, y: 620, w: 210, h: 64}, day: {y: 666},
    word: {x: 60, y: 440, size: 250}, captions: [{x: 60, y: 530, size: 44}, {x: 60, y: 590, size: 44}],
    cardH: 172, inset: 14, rise: 192, time: {x: 36, y: 98}, title: {x: 196, y: 72, size: 36}, room: {x: 196, y: 124, size: 32},
    push: {x: 540, drop: -40, zoom: 1}, fly: [640, 1340],
    // On a phone no secondary type is under 32 px; the speaker badges grow to match.
    speaker: {r: 38, right: 66, pitch: 84}, badge: {w: 440, h: 100, k: 1.3, name: 34, role: 32}, type: {day: 32, state: 32, publish: 32},
  },
};
// Corners follow the product's own radius token, not a soft card look.
const RADIUS = 4;

export function plan(p: Project): Scene {
  const q = p.clock.cues.plan, D = p.brand.dark, [start, end] = [p.clock.scenes[1].start, p.clock.scenes[1].end];
  const L = LAYOUT[p.format], SP = L.speaker, S = SHARED[p.format], RAIL_Y = S.railY, RAIL_X0 = S.railX0, RAIL_X1 = S.railX1, PUBLISH = L.publish;
  const sessions = p.experience.sessions.slice(0, 4), speakers = p.experience.speakers;
  const CARD_W = RAIL_X1 - RAIL_X0, CARD_H = L.cardH;
  const slot = (k: number) => RAIL_Y[k] + L.inset;
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
    if (rise < 1) { c.beginPath(); c.rect(0, RAIL_Y[index], W, RAIL_Y[index + 1] - RAIL_Y[index]); c.clip(); y += (1 - rise) * L.rise; }
    c.translate(x + CARD_W / 2, y + CARD_H / 2); c.rotate(tilt); c.scale(scale, scale); c.translate(-CARD_W / 2, -CARD_H / 2);
    shadowed(c, 12 + 50 * lift, 6 + 26 * lift, .28 + .3 * lift, () => fillBox(c, 0, 0, CARD_W, CARD_H, RADIUS, rgb(tint(.05 + .1 * focus + .08 * lift))));
    c.globalAlpha = lit;
    if (focus > 0) strokeBox(c, 0, 0, CARD_W, CARD_H, RADIUS, rgb(D.primary, focus), 3);
    const changed = moved && f >= q.lift + 5;
    digits(c, changed ? NEW_TIME : s.time, changed ? s.time : null, L.time.x, L.time.y, f, changed ? q.lift + 5 : enter + 8);
    const reveal = outCubic(prog(f, enter + 8, enter + 17));
    text(c, s.title, L.title.x + (1 - reveal) * 24, L.title.y, {size: L.title.size, weight: 700, color: rgb(D.ink, reveal)});
    text(c, s.room, L.room.x + (1 - reveal) * 36, L.room.y, {size: L.room.size, weight: 400, color: rgb(D.inkMuted, reveal)});
    // Speakers: the focused session receives its two on cue, the rest follow.
    s.speakerIds.forEach((id, k) => {
      const person = speakers.find(sp => sp.id === id)!;
      const at = index === 1 ? q.speakers[k] + 9 : q.speakers[1] + 16 + index * 3;
      // A docked speaker takes over from the flying card at full size; the rest pop in.
      const pop = index === 1 ? (f >= at ? 1 : 0) : spring(f, at, 3, .45);
      const cx = CARD_W - SP.right - k * SP.pitch, cy = CARD_H / 2;
      initials(c, person.name, cx, cy, SP.r * pop, tint(.42), D.ink);
      const ping = prog(f, at, at + 14);
      if (ping > 0 && ping < 1) ring(c, cx, cy, SP.r + 40 * outExpo(ping), rgb(D.primary, SOFT * (1 - ping)), 3 * (1 - ping));
    });
    c.restore();
  }

  function flyingSpeaker(c: C, k: number, f: number) {
    // A name card arcs in from off screen and shrinks onto its place on the session.
    const from = q.speakers[k] - 6, to = q.speakers[k] + 9;
    if (f < from || f >= to) return;
    const person = speakers.find(sp => sp.id === sessions[1].speakerIds[k])!;
    const target: [number, number] = [RAIL_X0 + CARD_W - SP.right - k * SP.pitch, slot(1) + CARD_H / 2];
    const path = quadPoints([W + 260, L.fly[k]], [target[0] + 220, target[1] + (k ? 240 : -260)], target);
    const t = inOutCubic(prog(f, from, to)), [x, y] = along(path, t), shrink = prog(f, to - 6, to);
    const B = L.badge, docked = 2 * SP.r, w = B.w * (1 - shrink) + docked * shrink, h = B.h * (1 - shrink) + docked * shrink;
    c.save(); c.translate(x, y); c.rotate((1 - t) * (k ? -.25 : .25));
    shadowed(c, 30, 14, .4, () => fillBox(c, -h / 2, -h / 2, w, h, lerp(RADIUS, h / 2, shrink), rgb(tint(.3))));
    initials(c, person.name, 0, 0, SP.r, tint(.3), D.ink, SOFT + .2);
    text(c, person.name, 42 * B.k, -4 * B.k, {size: B.name, weight: 700, color: rgb(D.ink, (SOFT + .2) * (1 - shrink * 2))});
    text(c, person.role, 42 * B.k, 24 * B.k, {size: B.role, weight: 400, color: rgb(D.inkMuted, (SOFT + .2) * (1 - shrink * 2))});
    c.restore();
  }

  return {from: start, to: end, draw(c: C, f: number) {
    c.translate(-W * inOutQuint(prog(f, q.wipe + 10, end)), 0);
    const push = spring(f, q.push, 2.8, .92) - spring(f, q.lift - 4, 2.8, .92);
    const cx = lerp(W / 2, L.push.x, push), cy = lerp(H / 2, slot(1) + CARD_H / 2 + L.push.drop, push);
    const zoom = lerp(1, L.push.zoom, push);
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
    text(c, p.copy.day, RAIL_X0, L.day.y, {size: L.type.day, weight: 600, color: rgb(D.inkMuted, prog(f, start + 8, start + 16))});
    // Record state and the publish control.
    const state = outCubic(prog(f, q.lift + 8, q.lift + 18));
    if (state > 0) {
      const {x, y, w, h} = PUBLISH, down = Math.max(0, 1 - Math.abs(f - q.publish - 1.5) / 3);
      // Record state in words, as the admin shows it: no chip and no dot.
      const isLive = f >= q.publish + 3, shown = isLive ? prog(f, q.publish + 3, q.publish + 9) : 1;
      text(c, isLive ? 'Live' : 'Draft, 1 change', x - 28, y + h / 2 + 2, {size: L.type.state, weight: 600, align: 'right', baseline: 'middle', color: rgb(isLive ? D.primary : D.inkMuted, state * shown)});
      c.save(); c.translate(x + w / 2, y + h / 2); c.scale(1 - .08 * down, 1 - .08 * down); c.globalAlpha = state;
      fillBox(c, -w / 2, -h / 2, w, h, RADIUS, rgb(mix(D.primary, D.ink, .5 * down)));
      text(c, 'Publish', 0, 2, {size: L.type.publish, weight: 700, align: 'center', baseline: 'middle', color: rgb(D.surface)});
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

    const [one, two] = L.captions;
    word(c, 'Plan.', L.word.x, L.word.y, L.word.size, D.ink, f, q.word);
    // Two captions, each on screen for about three seconds.
    phrase(c, 'Build the schedule.', one.x, one.y, {size: one.size, color: D.inkMuted}, f, q.word + 12, q.lift - 6);
    phrase(c, 'Change a time.', one.x, one.y, {size: one.size, color: D.inkMuted}, f, q.lift, Infinity);
    phrase(c, 'The list makes room.', two.x, two.y, {size: two.size, color: D.ink}, f, move + 2, Infinity);
    c.restore();
    sample(c, p.copy.sample, D.inkMuted, prog(f, start + 20, start + 34) * (1 - clamp(push * 3)));
  }};
}
