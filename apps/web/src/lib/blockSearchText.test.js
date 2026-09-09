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
});
