import { describe, expect, it } from 'vitest';
import { BLOCK_TYPE_IDS } from './blockTypes.js';
import { valueFieldsOf } from './contentDoc.js';
import { contentFieldHelp } from './contentFieldHelp.js';

describe('content field tooltip coverage', () => {
  it('gives every editable field of every block type nonempty help', () => {
    for (const type of BLOCK_TYPE_IDS) {
      for (const field of valueFieldsOf(type)) {
        const help = contentFieldHelp(type, field.id);
        expect(help?.text ?? help, `${type}.${field.id}`).toEqual(expect.stringMatching(/\S/));
      }
    }
  });
});
