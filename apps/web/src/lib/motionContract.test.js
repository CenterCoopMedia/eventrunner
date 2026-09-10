// THE MOTION CONTRACT, as a test rather than as a paragraph.
//
// The design brief settles what may move and what may not (§2.2, §2.4), and
// the expansion record settles the choreography (§2.2). Every one of those
// rules was a sentence somebody had to remember. A sentence does not fail a
// build, and the refusals that matter here are the ones a single hurried
// class string undoes: one `transition-all`, one `animate-pulse`, one hover
// tint that a phone holds lit for the rest of the session.
//
// So the rules are read off the SOURCE. This file parses `index.css` with
// PostCSS, walks every rule with its at-rule ancestry intact, and scans
// every shipped `.js` and `.jsx` under `apps/web/src`. It knows nothing
// about components; it knows what the stylesheet and the class strings are
// allowed to contain.
//
// TEST FILES ARE NOT SCANNED, for the same reason Tailwind does not scan
// them (see tailwind.config.js): a test names the thing it is testing, so a
// scan that reads tests finds every banned string in the assertions that ban
// it, and the check can never fail.
//
// WHEN THIS FAILS, FIX THE SOURCE. The allowlists below are the contract. A
// new exception is a change to the design system, and it belongs in the
// binding brief before it belongs here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');
const INDEX_CSS = path.join(SRC, 'index.css');

const css = fs.readFileSync(INDEX_CSS, 'utf8');
const root = postcss.parse(css, { from: INDEX_CSS });

/** Every shipped source file. Tests are excluded — see the note above. */
function sourceFiles(dir = SRC) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'test') continue;
      found.push(...sourceFiles(full));
      continue;
    }
    if (!/\.jsx?$/.test(entry.name)) continue;
    if (/\.test\.jsx?$/.test(entry.name)) continue;
    found.push(full);
  }
  return found;
}

const SOURCES = sourceFiles().map((file) => ({
  file: path.relative(SRC, file),
  text: fs.readFileSync(file, 'utf8'),
}));

/** The at-rule ancestry of a node, innermost last. */
function ancestry(node) {
  const chain = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule') chain.unshift(`@${parent.name} ${parent.params}`);
  }
  return chain;
}

const inQuery = (node, needle) => ancestry(node).some((at) => at.includes(needle));
const motionAllowed = (node) => inQuery(node, 'prefers-reduced-motion: no-preference');
const motionReduced = (node) => inQuery(node, 'prefers-reduced-motion: reduce');
const hoverGuarded = (node) => inQuery(node, 'hover: hover');

/** Where a failing declaration is, in words a reader can act on. */
function place(node) {
  const rule = node.parent?.selector ?? node.parent?.name ?? 'unknown';
  return `${rule} { ${node.prop}: ${node.value} }`;
}

/** Every declaration in the stylesheet, with its node. */
const DECLARATIONS = [];
root.walkDecls((decl) => DECLARATIONS.push(decl));

/** Every rule selector, with its node. */
const RULES = [];
root.walkRules((rule) => RULES.push(rule));

const MOTION_PROPS = /^(transition|animation)(-|$)/;
/** The only properties that may animate. Both run off the main thread. */
const ANIMATABLE = new Set(['transform', 'opacity']);
/** The only durations the system owns. */
const DURATION_TOKENS = ['--motion-fast', '--motion-base', '--motion-slow', '--motion-signature'];

describe('the stylesheet', () => {
  it('never animates every property at once', () => {
    const offenders = DECLARATIONS.filter(
      (decl) =>
        (decl.prop === 'transition' && /(^|\s)all(\s|,|$)/.test(decl.value))
        || (decl.prop === 'transition-property' && decl.value.includes('all')),
    ).map(place);
    expect(offenders, '`transition: all` animates properties nobody chose').toEqual([]);
  });

  it('animates transform and opacity, and nothing else', () => {
    const offenders = [];
    for (const decl of DECLARATIONS) {
      if (decl.prop !== 'transition' && decl.prop !== 'transition-property') continue;
      // `transition: transform 160ms ease, opacity 160ms ease` — the property
      // is the first word of each comma-separated part.
      for (const part of decl.value.split(',')) {
        const property = part.trim().split(/\s+/)[0];
        if (!property || property === 'none') continue;
        if (!ANIMATABLE.has(property)) offenders.push(`${place(decl)} → ${property}`);
      }
    }
    expect(offenders, 'colour and layout repaint on every frame').toEqual([]);
  });

  it('keeps every move inside the no-preference query', () => {
    const offenders = DECLARATIONS.filter(
      (decl) =>
        MOTION_PROPS.test(decl.prop) && !motionAllowed(decl) && !motionReduced(decl),
    ).map(place);
    // The global reduce block is the one exception, and it is the block that
    // takes motion AWAY. Everything else has to be opted into.
    expect(offenders, 'a reader who asked for less motion would still get this').toEqual([]);
  });

  it('spends no duration the token file does not own', () => {
    const offenders = [];
    for (const decl of DECLARATIONS) {
      if (motionReduced(decl)) continue;
      for (const match of decl.value.matchAll(/(?<![\w-])(\d+(?:\.\d+)?)(ms|s)(?![\w-])/g)) {
        offenders.push(`${place(decl)} → ${match[0]}`);
      }
    }
    expect(offenders, 'a raw duration is a step the scale does not have').toEqual([]);
  });

  it('names a motion token wherever it spends time', () => {
    const offenders = [];
    for (const decl of DECLARATIONS) {
      if (!MOTION_PROPS.test(decl.prop) || motionReduced(decl)) continue;
      if (decl.prop === 'transition-property' || decl.prop === 'animation-name') continue;
      if (!DURATION_TOKENS.some((token) => decl.value.includes(token))) {
        offenders.push(place(decl));
      }
    }
    expect(offenders, 'every move runs at one of the four duration steps').toEqual([]);
  });

  it('never lets a touch screen hold a hover state', () => {
    const offenders = RULES.filter(
      (rule) => rule.selector.includes(':hover') && !hoverGuarded(rule),
    ).map((rule) => rule.selector);
    // A tap registers as a hover and stays until the reader taps elsewhere,
    // so an unguarded hover tint reads as a selection nobody made.
    expect(offenders, 'wrap it in @media (hover: hover) and (pointer: fine)').toEqual([]);
  });

  it('runs nothing on its own, and nothing for ever', () => {
    const looping = DECLARATIONS.filter(
      (decl) =>
        (decl.prop === 'animation' || decl.prop === 'animation-iteration-count')
        && decl.value.includes('infinite'),
    ).map(place);
    expect(looping, 'ambient animation is banned outright').toEqual([]);
  });

  it('draws no shadow and no blurred panel', () => {
    const offenders = DECLARATIONS.filter(
      (decl) =>
        decl.prop === 'box-shadow'
        || decl.prop === 'backdrop-filter'
        || decl.prop === '-webkit-backdrop-filter',
    ).map(place);
    // Shadow decorates nothing (§2.1) and a frosted panel is glassmorphism
    // (§2.4). Elevation is the rule and the ground, everywhere.
    expect(offenders, 'use a rule and a ground instead').toEqual([]);
  });

  it('shades nothing, while still letting flat paint draw a rule', () => {
    // The ban is on a gradient that SHADES: two colours blending across a
    // distance. A one-colour gradient, or two colours meeting at one exact
    // position, paints a flat rule, a frame, a grid, or a dot pattern — that
    // is the technique the nameplate rule and the session face already use,
    // and it shades nothing.
    const offenders = [];
    for (const decl of DECLARATIONS) {
      for (const gradient of gradients(decl.value)) {
        if (shades(gradient)) offenders.push(`${place(decl)} → ${gradient}`);
      }
    }
    expect(offenders, 'no gradient blob, no gradient as a background event').toEqual([]);
  });
});

/** Every gradient function in a value, as its argument text. */
function gradients(value) {
  const found = [];
  const pattern = /(repeating-)?(linear|radial|conic)-gradient\(/g;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    let depth = 1;
    let index = match.index + match[0].length;
    for (; index < value.length && depth > 0; index += 1) {
      if (value[index] === '(') depth += 1;
      else if (value[index] === ')') depth -= 1;
    }
    found.push(value.slice(match.index + match[0].length, index - 1));
  }
  return found;
}

/** Split on commas that are not inside a function call. */
function topLevelParts(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

/**
 * A stop's position, if it states one. A position may be a length, a
 * percentage, a calc(), or a token — the map grid rules at
 * `var(--rule-hairline-width)`, which is a position like any other.
 */
const LENGTH = '(?:-?[\\d.]+(?:px|%|r?em|vh|vw)|calc\\([^)]*\\)|var\\([^)]*\\))';
const POSITION = new RegExp(`\\s(${LENGTH}(?:\\s+${LENGTH})*)$`);

/** Whether a gradient blends one colour into another across a distance. */
function shades(argumentText) {
  const parts = topLevelParts(argumentText);
  // A leading direction, shape, or size argument is not a colour stop.
  const stops = parts.filter(
    (part) => !/^(to\b|-?[\d.]+deg|circle\b|ellipse\b|at\b|closest|farthest|in\s)/.test(part),
  );
  const colours = new Set();
  const positions = new Set();
  for (const stop of stops) {
    const found = stop.match(POSITION);
    positions.add(found ? found[1].trim() : '');
    colours.add((found ? stop.slice(0, found.index) : stop).trim());
  }
  if (colours.size <= 1) return false;
  // Two colours at one position is a hard stop: a pattern, never a blend.
  return positions.size > 1 || positions.has('');
}

describe('every class string the app ships', () => {
  /** @param {RegExp} pattern @returns {string[]} `file:line` for each hit */
  const hits = (pattern) => {
    const found = [];
    for (const { file, text } of SOURCES) {
      text.split('\n').forEach((line, index) => {
        // A comment explains a rule; it does not render one.
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (pattern.test(line)) found.push(`${file}:${index + 1}`);
      });
    }
    return found;
  };

  it('never reaches for transition-all', () => {
    expect(hits(/\btransition-all\b/)).toEqual([]);
  });

  it('spends no duration the token file does not own', () => {
    // `duration-fast` is a token. `duration-150` and `duration-[130ms]` are
    // steps the scale does not have.
    expect(hits(/\b(duration|delay)-(\d|\[)/), 'name a motion token').toEqual([]);
  });

  it('runs no spinner, no pulse, no bounce, no ping', () => {
    expect(
      hits(/\banimate-(pulse|spin|bounce|ping)\b/),
      'loading is a stated line, not a loop',
    ).toEqual([]);
  });

  it('opts every move into the no-preference query', () => {
    // `motion-safe:` IS that query. A bare transition utility runs for a
    // reader who asked for less motion.
    const found = [];
    for (const { file, text } of SOURCES) {
      text.split('\n').forEach((line, index) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        for (const match of line.matchAll(/(?<![\w:-])(transition|duration|delay|ease|animate)-[\w[\]./-]+/g)) {
          const before = line.slice(0, match.index);
          if (/motion-safe:$/.test(before)) continue;
          found.push(`${file}:${index + 1} → ${match[0]}`);
        }
      });
    }
    expect(found, 'prefix it with motion-safe:').toEqual([]);
  });

  it('rounds nothing to a pill but a focus ring', () => {
    // Pill-shaped everything is rejected outright (§2.4), and a circular
    // crop is a generic-template tell.
    expect(hits(/\brounded-full\b/)).toEqual([]);
  });

  it('draws no shadow and no blurred panel', () => {
    expect(hits(/\b(shadow-(sm|md|lg|xl|2xl|inner)|backdrop-blur[\w-]*)\b/)).toEqual([]);
  });

  it('paints no gradient', () => {
    expect(hits(/\bbg-gradient-to-[a-z]+\b/)).toEqual([]);
  });
});
