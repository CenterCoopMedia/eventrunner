// The written rules the Updates copy is held to (review round):
// docs/interface-guidelines.md, Writing, "Capitalize the first word after a
// colon, wherever the colon falls", read against the admin guide's Updates
// section, the staff-facing text for these screens.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The body of one `## ` section of a Markdown file. */
function section(file, heading) {
  const text = readFileSync(path.join(REPO, file), 'utf8');
  const start = text.indexOf(`\n## ${heading}\n`);
  expect(start, `${file} has a "## ${heading}" section`).toBeGreaterThanOrEqual(0);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? undefined : next);
}

/** Prose with code spans and bold markers taken out. */
const prose = (text) => text.replace(/`[^`]*`/g, 'CODE').replace(/\*\*/g, '');

describe('the admin guide’s Updates section', () => {
  it('capitalizes the first word after a colon', () => {
    const lower = prose(section('docs/ADMIN_GUIDE.md', 'Updates')).match(/:\s+[a-z][^.]*/g) ?? [];
    expect(lower).toEqual([]);
  });
});

// docs/COPY_STYLE.md, "Use one term for one concept": every control on
// these screens says "update", so the text around them says it too.
describe('one term for an update', () => {
  const POST = /\bposts?\b/i;

  it('says "update", never "post", in the admin guide’s Updates section', () => {
    expect(prose(section('docs/ADMIN_GUIDE.md', 'Updates')).match(new RegExp(POST, 'gi')) ?? []).toEqual([]);
  });

  it('says "update" in the changelog entries and the design reference line for these screens', () => {
    const changelog = readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
    const entries = changelog.split('\n- ').filter((entry) => /\(#19[01]\)/.test(entry));
    expect(entries).toHaveLength(2);
    for (const entry of entries) expect(entry).not.toMatch(POST);
    const reference = readFileSync(path.join(REPO, 'docs/design-reference.md'), 'utf8');
    const feed = reference.split('\n').find((line) => line.startsWith('- **Updates feed**'));
    expect(feed).toBeTruthy();
    expect(feed).not.toMatch(POST);
  });
});
