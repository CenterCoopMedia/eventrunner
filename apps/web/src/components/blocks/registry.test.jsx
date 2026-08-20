// Registry contract tests (spec §5.2): every BLOCK_TYPES id in the backend
// registry has a frontend renderer — imported from the functions source so
// the two halves of the contract cannot drift — and unknown ids hit the
// UnknownBlock fallback (labeled box in dev, nothing in production).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as blockTypesCjs from '../../../../../functions/src/cms/blockTypes.cjs';
import BlockRenderer, { BLOCK_RENDERERS, rendererFor, UnknownBlock } from './registry.jsx';

const { BLOCK_TYPES } = blockTypesCjs.default ?? blockTypesCjs;

// One renderable sample block per backend block type.
const SAMPLE_BLOCKS = {
  text: { blockType: 'text', value: 'Sample text' },
  richtext: { blockType: 'richtext', value: '<p>Sample <strong>rich</strong> text</p>' },
  image: { blockType: 'image', url: 'https://example.org/i.png', alt: 'Sample image', caption: 'Caption' },
  cta: { blockType: 'cta', label: 'Register now', url: 'https://example.org/register', external: true },
  stat: { blockType: 'stat', value: '450', label: 'Attendees expected' },
  list_item: { blockType: 'list_item', text: 'Sample list entry' },
  faq_item: { blockType: 'faq_item', question: 'Sample question?', answer: '<p>Sample answer.</p>' },
  link_group: { blockType: 'link_group', group: 'About', label: 'Contact the organizers', url: 'mailto:hi@example.org' },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('block renderer registry', () => {
  it('covers every backend BLOCK_TYPES id, with no extras', () => {
    expect(Object.keys(BLOCK_RENDERERS).sort()).toEqual(
      Object.keys(BLOCK_TYPES).sort(),
    );
  });

  it('renders visible output for every registered block type', () => {
    for (const id of Object.keys(BLOCK_TYPES)) {
      const sample = SAMPLE_BLOCKS[id];
      // A new backend block type must gain a sample here alongside its renderer.
      expect(sample, `missing sample block for '${id}'`).toBeTruthy();
      const { container, unmount } = render(<BlockRenderer block={sample} />);
      expect(container.innerHTML, `renderer for '${id}' produced nothing`).not.toBe('');
      unmount();
    }
  });

  it('routes unknown and prototype-name ids to UnknownBlock', () => {
    expect(rendererFor('mystery_widget')).toBe(UnknownBlock);
    expect(rendererFor('toString')).toBe(UnknownBlock);
    expect(rendererFor(undefined)).toBe(UnknownBlock);
    expect(rendererFor('text')).not.toBe(UnknownBlock);
  });

  it('renders a labeled box for unknown blocks in dev', () => {
    render(<BlockRenderer block={{ blockType: 'mystery_widget' }} />);
    expect(screen.getByRole('note')).toHaveTextContent('mystery_widget');
  });

  it('renders nothing for unknown blocks in production', () => {
    vi.stubEnv('DEV', false);
    const { container } = render(
      <BlockRenderer block={{ blockType: 'mystery_widget' }} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
