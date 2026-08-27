// The generated copy is complete for the generated catalog.
//
// The style catalog is split in three (owner review, 2026-08-27): the
// rendering values ship to Cloud Functions, the words ship with the admin,
// and the design prose is documentation. A split can fail in exactly one
// way that neither half notices — a style or a choice that renders but has
// no words, so the picker offers a blank line. This is the test that pairs
// the halves back up.
import { describe, expect, it } from 'vitest';
import { PRESETS, THEME_PRESET_IDS } from 'shared/theme';
import { PRESET_COPY, choiceCopy, presetCopy } from './presetCopy.js';

describe('preset copy', () => {
  it('covers exactly the styles the runtime catalog offers', () => {
    expect(Object.keys(PRESET_COPY)).toEqual([...THEME_PRESET_IDS]);
    expect(presetCopy('not-a-style')).toBeNull();
  });

  it('names every style and says who it suits, in plain words', () => {
    for (const id of THEME_PRESET_IDS) {
      const copy = presetCopy(id);
      expect(copy.label, `${id} label`).toBeTruthy();
      // A style name is a name, not a sentence.
      expect(copy.label.length).toBeLessThan(24);
      expect(copy.summary.length, `${id} summary`).toBeGreaterThan(20);
      expect(copy.bestFor.length, `${id} bestFor`).toBeGreaterThan(20);
    }
  });

  it('gives every option group and every choice a label and a reason', () => {
    // "The visual-story specs define the options and state, one sentence
    // each, why an option still belongs" (brief §4). The sentence is copy,
    // so this is where it is now enforced.
    for (const [id, preset] of Object.entries(PRESETS)) {
      const copy = presetCopy(id);
      expect(Object.keys(copy.options).sort()).toEqual(Object.keys(preset.options).sort());
      for (const [group, spec] of Object.entries(preset.options)) {
        expect(copy.options[group].label, `${id}.${group} label`).toBeTruthy();
        expect(copy.options[group].prompt, `${id}.${group} prompt`).toBeTruthy();
        for (const choice of spec.choices) {
          const words = choiceCopy(id, group, choice.id);
          expect(words, `${id}.${group}/${choice.id}`).not.toBeNull();
          expect(words.label).toBeTruthy();
          expect(words.why.length, `${id}.${group}/${choice.id} says why`).toBeGreaterThan(20);
        }
      }
      // And no words for a choice the catalog no longer offers.
      const offered = new Set(
        Object.entries(preset.options).flatMap(([group, spec]) =>
          spec.choices.map((choice) => `${group}/${choice.id}`)),
      );
      for (const [group, groupCopy] of Object.entries(copy.options)) {
        for (const choiceId of Object.keys(groupCopy.choices)) {
          expect(offered.has(`${group}/${choiceId}`), `${id}.${group}/${choiceId}`).toBe(true);
        }
      }
    }
  });

  it('returns null rather than a blank for a choice nobody offers', () => {
    expect(choiceCopy('civic', 'nameplate', 'not-a-choice')).toBeNull();
    expect(choiceCopy('civic', 'not-a-group', 'anything')).toBeNull();
  });
});
