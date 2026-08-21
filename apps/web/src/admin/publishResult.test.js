// cmsPublish answers 200 even when it published nothing you asked for, so
// the reader that decides "did that work" is worth pinning on its own.
import { describe, expect, it } from 'vitest';
import { summarizePublish } from './publishResult.js';

const requested = ['scholarships', 'faq'];

describe('summarizePublish', () => {
  it('is ok only when every requested id was published', () => {
    const verdict = summarizePublish(
      { results: { cmsPages: { published: requested, skipped: [] } } },
      'cmsPages',
      requested,
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.message).toMatch(/picks it up live/);
  });

  it('reports a conflict skip in the operator’s terms, not the server’s code', () => {
    const verdict = summarizePublish(
      {
        results: {
          cmsPages: {
            published: ['faq'],
            skipped: [{ docId: 'scholarships', reason: 'conflict' }],
          },
        },
      },
      'cmsPages',
      requested,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.published).toEqual(['faq']);
    expect(verdict.skipped).toEqual([{ docId: 'scholarships', reason: 'conflict' }]);
    expect(verdict.message).toContain('Published 1 of 2 pages');
    expect(verdict.message).toContain('scholarships was edited while publishing');
  });

  it('reports a no-draft skip', () => {
    const verdict = summarizePublish(
      { results: { cmsPages: { published: [], skipped: [{ docId: 'faq', reason: 'no-draft' }] } } },
      'cmsPages',
      ['faq'],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('Nothing was published');
    expect(verdict.message).toContain('faq has no draft to publish');
  });

  it('treats an id the response never mentions as not published', () => {
    // The no-op answer ({ queueId: null, status: 'done', results: {} }) must
    // not read as success for a page the caller asked to publish.
    const verdict = summarizePublish({ results: {} }, 'cmsPages', ['scholarships']);
    expect(verdict.ok).toBe(false);
    expect(verdict.skipped).toEqual([{ docId: 'scholarships', reason: 'not-published' }]);
  });

  it('ignores extra published ids from a resumed queue row', () => {
    // A resume answers with the row's recorded progress, which can list docs
    // committed by the earlier run.
    const verdict = summarizePublish(
      { results: { cmsPages: { published: ['scholarships', 'faq', 'travel'] } } },
      'cmsPages',
      ['scholarships'],
    );
    expect(verdict.ok).toBe(true);
  });
});
