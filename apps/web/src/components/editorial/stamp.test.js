// The Zine stamp, against the six tests that permit it (design brief §2.4,
// "Exception two"), and the handwritten callout beside it (§4.3).
//
// The stamp is the ONE piece of box-behind-box layering this system allows,
// and the exception is written as six tests rather than as a description.
// They are properties of the STYLESHEET — an offset, a duration, a media
// query — so they are asserted against the stylesheet here rather than
// described in a comment nobody can fail. jsdom applies no CSS, which is
// exactly why a render test could not stand in for this one.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getPreset, THEME_PRESET_IDS } from 'shared/theme';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(
  path.resolve(here, '..', '..', 'generated', 'theme.css'),
  'utf8',
);

/**
 * The stylesheet with every `prefers-reduced-motion: no-preference` block
 * cut out of it — brace-aware, so a rule after one is not swallowed. What
 * is left is what a reader who asked for less motion actually gets, which
 * is the only way to check test 5 rather than assert it.
 */
function withoutMotionBlocks(source) {
  const marker = '@media (prefers-reduced-motion: no-preference)';
  let out = '';
  let rest = source;
  for (let at = rest.indexOf(marker); at !== -1; at = rest.indexOf(marker)) {
    out += rest.slice(0, at);
    let depth = 0;
    let index = rest.indexOf('{', at);
    for (; index < rest.length; index += 1) {
      if (rest[index] === '{') depth += 1;
      if (rest[index] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    rest = rest.slice(index + 1);
  }
  return out + rest;
}

const staticCss = withoutMotionBlocks(indexCss);
/** The stamp's own rules, with the reduced-motion wrapper kept out. */
const stampRules = staticCss.match(/\.session-block(?:__face)?(?:::before)? \{[^}]*\}/g).join('\n');
const noPreference = indexCss.match(
  /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n {2}\}/g,
);

describe('the Zine stamp', () => {
  it('1. is flat: no blur, no gradient, no grey', () => {
    // The offset LAYER is the thing this test binds: one flat token colour,
    // nothing else. (The face beside it paints its own ground with a
    // two-stop same-colour gradient, which is a solid fill written as an
    // image so it can be sized from the offset — see the last test here.)
    const layer = staticCss.match(/\.session-block::before \{[^}]*\}/)[0];
    expect(layer).toContain('background-color: rgb(var(--session-card-stamp-rgb));');
    expect(layer).not.toMatch(/blur|gradient|box-shadow|filter|grey|gray/);
  });

  it('2. is offset a fixed small distance, and never follows the pointer', () => {
    expect(stampRules).toContain(
      'transform: translate(var(--session-card-stamp-offset), var(--session-card-stamp-offset));',
    );
    // Nothing reads a pointer position: no custom property is written from
    // JavaScript for this device, and the offset is a token.
    expect(indexCss).not.toMatch(/--pointer-x|--mouse-/);
  });

  it('3. ships in Zine only, and no other preset can turn it on', () => {
    for (const id of THEME_PRESET_IDS) {
      const preset = getPreset(id);
      const offsets = [
        preset.tokens?.['--session-card-stamp-offset'],
        ...Object.values(preset.options || {}).flatMap((group) =>
          group.choices.map((choice) => choice.tokens?.['--session-card-stamp-offset']),
        ),
      ].filter((value) => value !== undefined);
      for (const offset of offsets) {
        if (id === 'zine') continue;
        expect(offset, `${id} keeps the stamp off`).toBe('0');
      }
    }
    // Zine's stamped-block variant is the only place a non-zero offset is
    // set, and its flat-block variant turns it back off with no exception.
    const zine = getPreset('zine').options.component.choices;
    expect(zine.find((c) => c.id === 'stamped-block').tokens['--session-card-stamp-offset']).toBe(
      '4px',
    );
    expect(zine.find((c) => c.id === 'flat-block').tokens['--session-card-stamp-offset']).toBe('0');
    // Every other preset holds the contract default, which is zero.
    expect(themeCss).toContain('--session-card-stamp-offset: 0;');
  });

  it('4. peeks on transform only, from a user action, at a token duration', () => {
    const block = noPreference.find((rule) => rule.includes('.session-block'));
    expect(block).toBeTruthy();
    expect(block).toContain('transition: transform var(--motion-base) var(--motion-ease);');
    // --motion-base is 160ms: the token step nearest the story's 150ms, and
    // inside §2.2's 120-200ms functional band. A device may not mint a raw
    // duration, and the scale has no 150ms step.
    expect(themeCss).toContain('--er-duration-base: 160ms;');
    expect(block).not.toMatch(/transition: all|transition-property: all/);
    // Started by a user action, and :focus-visible gets what hover gets.
    expect(block).toContain('.session-block:hover::before');
    expect(block).toContain('.session-block:has(:focus-visible)::before');
    expect(block).toContain('.session-block:hover .session-block__face');
    expect(block).toContain('.session-block:has(:focus-visible) .session-block__face');
    // No scroll trigger, no loop, no ambient movement anywhere near it.
    expect(indexCss).not.toMatch(/@keyframes|animation-iteration-count: infinite/);
  });

  it('5. is truly static under prefers-reduced-motion, and still renders', () => {
    // Both the transition AND the peek live inside the no-preference query,
    // so a reader who asked for less motion gets a stamp that does not move
    // — not a shortened animation. The stamp itself is outside the query,
    // so it still prints.
    expect(staticCss).toContain('.session-block::before');
    expect(staticCss).toContain('background-color: rgb(var(--session-card-stamp-rgb));');
    expect(staticCss).not.toMatch(/\.session-block[^{]*\{[^}]*transition/);
    expect(staticCss).not.toContain(':has(:focus-visible)');
    expect(staticCss).not.toMatch(/\.session-block:hover/);
  });

  it('6. is never the only signal that a block is interactive', () => {
    // The block's title is a link (SessionCard.jsx), and the stamp adds
    // nothing to the affordance. Nothing in these rules paints a state that
    // only the stamp carries.
    const card = fs.readFileSync(path.resolve(here, '..', 'SessionCard.jsx'), 'utf8');
    expect(card).toContain('session-block__face');
    expect(card).toMatch(/<Link\s+to=\{\{ pathname: `\/schedule\/\$\{session\.id\}`/);
    expect(stampRules).not.toMatch(/cursor: pointer/);
  });

  it('leaves the block unchanged wherever the offset is zero', () => {
    // Turning the device off needs no second rule. The face prints its own
    // ground as a background sized FROM the offset, so a zero offset gives
    // that ground a zero size: the face stays transparent, the second pass
    // sits exactly under the first with nothing to reveal it, and the row
    // is the plain ruled row it always was — paper texture and map grid
    // still showing through it.
    const face = indexCss.match(/\.session-block__face \{[^}]*\}/)[0];
    expect(face).toContain(
      'linear-gradient(\n      rgb(var(--session-card-surface-rgb)),',
    );
    expect(face).toContain('calc(var(--session-card-stamp-offset) * 1000)');
    expect(face).not.toContain('background-color');
    // Two stops, one colour: a solid fill, never a real gradient.
    const stops = face.match(/rgb\(var\(--session-card-surface-rgb\)\)/g);
    expect(stops).toHaveLength(2);
    expect(themeCss).toContain('--session-card-surface-rgb: var(--color-surface-rgb);');
  });
});

describe('the handwritten callout', () => {
  it('runs on the component token, not a fifth font role', () => {
    expect(indexCss).toMatch(/\.callout \{[^}]*font-family: var\(--callout-font\);/);
    expect(indexCss).toMatch(/\.callout \{[^}]*transform: rotate\(var\(--callout-angle\)\);/);
    expect(themeCss).toContain('--callout-font: var(--font-heading);');
    expect(themeCss).toContain('--callout-angle: 0deg;');
  });

  it('tilts in Zine only, at one fixed angle', () => {
    expect(getPreset('zine').tokens['--callout-angle']).toBe('-2.5deg');
    for (const id of THEME_PRESET_IDS) {
      if (id === 'zine') continue;
      expect(getPreset(id).tokens?.['--callout-angle'] ?? '0deg').toBe('0deg');
    }
  });

  it('sets the script face where Zine asks for it, and nowhere else', () => {
    // The face is bundled and declared, so pointing the token at it renders
    // the script rather than a fallback.
    expect(getPreset('zine').componentFonts?.['--callout-font']).toBe('script-casual');
    expect(themeCss).toMatch(/font-family: 'Caveat';/);
  });
});
