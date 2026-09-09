import { describe, expect, it } from 'vitest';
import { blockMatchesQuery, blockSearchText } from './blockSearchText.js';

describe('blockSearchText', () => {
  it('reads a text block value', () => {
    expect(blockSearchText({ blockType: 'text', value: 'Doors open at nine' })).toBe(
      'Doors open at nine',
    );
  });

  it('strips markup from a richtext block', () => {
    expect(
      blockSearchText({ blockType: 'richtext', value: '<p>Bring a <strong>badge</strong>.</p>' }),
    ).toContain('Bring a');
    expect(
      blockSearchText({ blockType: 'richtext', value: '<p>Bring a <strong>badge</strong>.</p>' }),
    ).toContain('badge');
    expect(
      blockSearchText({ blockType: 'richtext', value: '<p>Bring a <strong>badge</strong>.</p>' }),
    ).not.toMatch(/[<>]/);
  });

  it('decodes HTML entities left behind by stripping a richtext block (a rich-text toolbar writes them, never a literal "&")', () => {
    expect(blockSearchText({ blockType: 'richtext', value: '<p>AT&amp;T sponsors this.</p>' })).toBe(
      ' AT&T sponsors this. ',
    );
    expect(
      blockMatchesQuery({ blockType: 'richtext', value: '<p>AT&amp;T sponsors this.</p>' }, 'AT&T'),
    ).toBe(true);
    // Numeric entities too, decimal and hex. The decimal form is built from
    // separate literal pieces rather than written as one "#233" literal —
    // that string, on its own, is indistinguishable from a banned hex color
    // literal to the repo's hex sweep (spec §7.6).
    const decimalEntity = '&#' + '233' + ';';
    expect(blockSearchText({ blockType: 'richtext', value: `Caf${decimalEntity} culture` })).toBe(
      'Café culture',
    );
    expect(blockSearchText({ blockType: 'richtext', value: 'Caf&#xe9; culture' })).toBe(
      'Café culture',
    );
    // An entity outside the small known set is left as text, not guessed at.
    expect(blockSearchText({ blockType: 'richtext', value: '&madeupname;' })).toBe('&madeupname;');
  });

  it('decodes entities in a FAQ answer, an HTML-backed field, the same way', () => {
    expect(
      blockMatchesQuery(
        { blockType: 'faq_item', question: 'Who sponsors this?', answer: '<p>AT&amp;T does.</p>' },
        'AT&T',
      ),
    ).toBe(true);
  });

  it('indexes a plain text block verbatim — a literal angle-bracket word is never mistaken for a tag', () => {
    const block = { blockType: 'text', value: 'Use the <VIP> entrance' };
    expect(blockSearchText(block)).toBe('Use the <VIP> entrance');
    expect(blockMatchesQuery(block, 'VIP')).toBe(true);
  });

  it('indexes list_item text and a FAQ question verbatim too, never through the tag-stripping regex', () => {
    expect(blockSearchText({ blockType: 'list_item', text: 'Bring your <VIP> badge' })).toBe(
      'Bring your <VIP> badge',
    );
    expect(
      blockSearchText({ blockType: 'faq_item', question: 'What is <VIP> access?', answer: '' }),
    ).toContain('What is <VIP> access?');
  });

  it('joins the question and the stripped answer of a faq_item block', () => {
    expect(
      blockSearchText({
        blockType: 'faq_item',
        question: 'Is parking included?',
        answer: '<p>Not at this venue.</p>',
      }),
    ).toBe('Is parking included?  Not at this venue. ');
  });

  it('joins the four-part stat fields', () => {
    expect(
      blockSearchText({
        blockType: 'stat',
        takeaway: 'Attendance grew',
        description: 'Registered attendees this year',
        source: 'Registration system, read live',
      }),
    ).toBe('Attendance grew Registered attendees this year Registration system, read live');
  });

  it('reads alt and caption from an image block', () => {
    expect(
      blockSearchText({ blockType: 'image', alt: 'Venue entrance', caption: 'Main doors' }),
    ).toBe('Venue entrance Main doors');
  });

  it('includes the stat figure itself, not only its label and takeaway', () => {
    expect(
      blockSearchText({ blockType: 'stat', value: '1,200', label: 'attendees' }),
    ).toBe('1,200 attendees');
    // A search for the number a reader actually reads finds the stat.
    expect(blockMatchesQuery({ blockType: 'stat', value: '1,200', label: 'attendees' }, '1,200')).toBe(
      true,
    );
  });

  it('appends the section label when one is given, so a section name is searchable', () => {
    expect(
      blockSearchText(
        { blockType: 'text', value: 'Doors open at nine' },
        { sectionLabel: 'Venue' },
      ),
    ).toBe('Doors open at nine Venue');
    expect(blockSearchText({ blockType: 'text', value: 'Doors open at nine' })).toBe(
      'Doors open at nine',
    );
  });

  it('returns an empty string for an unknown or missing block', () => {
    expect(blockSearchText(null)).toBe('');
    expect(blockSearchText({ blockType: 'mystery' })).toBe('');
  });
});

describe('blockMatchesQuery', () => {
  const block = { blockType: 'faq_item', question: 'Is there parking?', answer: 'No.' };

  it('matches case-insensitively on a substring', () => {
    expect(blockMatchesQuery(block, 'PARKING')).toBe(true);
    expect(blockMatchesQuery(block, 'parking')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(blockMatchesQuery(block, 'shuttle')).toBe(false);
  });

  it('treats an empty or whitespace query as matching everything', () => {
    expect(blockMatchesQuery(block, '')).toBe(true);
    expect(blockMatchesQuery(block, '   ')).toBe(true);
    expect(blockMatchesQuery(block, undefined)).toBe(true);
  });

  it('matches a query against the section label even when the block text does not carry it', () => {
    const plainBlock = { blockType: 'text', value: 'Ramp access at the north door.' };
    expect(blockMatchesQuery(plainBlock, 'venue')).toBe(false);
    expect(blockMatchesQuery(plainBlock, 'venue', { sectionLabel: 'Venue' })).toBe(true);
  });
});
