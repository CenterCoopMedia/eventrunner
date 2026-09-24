// The collection words the banner and the Unpublished changes page share
// (issue #196).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as blockTypesCjs from '../../../../functions/src/cms/blockTypes.cjs';
import { COLLECTION_CHOICES, countWords, pendingSentence } from './collectionWords.js';

describe('the collection words', () => {
  it('names exactly the collections the server publishes', () => {
    expect(COLLECTION_CHOICES.map((choice) => choice.id).sort()).toEqual(
      [...blockTypesCjs.PUBLISHABLE_COLLECTIONS].sort(),
    );
    expect(COLLECTION_CHOICES.map((choice) => choice.label)).toEqual([
      'Content blocks',
      'Pages',
      'Sessions',
      'Organizations',
      'Updates',
      'Timeline',
    ]);
  });

  it('names each collection as the Overview’s readiness table does', () => {
    const readiness = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'overview', 'ReadinessPanel.jsx'),
      'utf8',
    );
    for (const choice of COLLECTION_CHOICES) {
      expect(readiness, choice.id).toContain(`['${choice.id}', '${choice.label}']`);
    }
  });

  it('imports nothing, so the banner pulls no formatter into the admin entry chunk', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, 'collectionWords.js'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });

  it('counts in the singular at one and the plural otherwise', () => {
    const [content, , , , , timeline] = COLLECTION_CHOICES;
    expect(countWords(content, 1)).toBe('1 content block');
    expect(countWords(content, 2)).toBe('2 content blocks');
    expect(countWords(timeline, 1)).toBe('1 timeline entry');
    expect(countWords(timeline, 3)).toBe('3 timeline entries');
  });
});

describe('pendingSentence', () => {
  it('says nothing when nothing is waiting', () => {
    expect(pendingSentence({})).toBeNull();
    expect(pendingSentence(undefined)).toBeNull();
    expect(pendingSentence({ cmsContent: 0, cmsPages: 0 })).toBeNull();
  });

  it('is singular at one', () => {
    expect(pendingSentence({ cmsContent: 1 })).toBe('1 unpublished change: 1 content block.');
    expect(pendingSentence({ cmsTimeline: 1 })).toBe('1 unpublished change: 1 timeline entry.');
  });

  it('names only the collections with changes, in the admin’s order', () => {
    expect(
      pendingSentence({ cmsSchedule: 2, cmsContent: 2, cmsPages: 1, cmsUpdates: 0 }),
    ).toBe('5 unpublished changes: 2 content blocks, 1 page, 2 sessions.');
    expect(
      pendingSentence({
        cmsTimeline: 2, cmsUpdates: 1, cmsOrganizations: 3, cmsSchedule: 1, cmsPages: 2, cmsContent: 1,
      }),
    ).toBe(
      '10 unpublished changes: 1 content block, 2 pages, 1 session, 3 organizations, 1 update, 2 timeline entries.',
    );
  });
});
