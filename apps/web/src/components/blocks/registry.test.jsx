// Registry contract tests (spec §5.2): every BLOCK_TYPES id in the backend
// registry has a frontend renderer — imported from the functions source so
// the two halves of the contract cannot drift — and unknown ids hit the
// UnknownBlock fallback (labeled box in dev, nothing in production).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import * as blockTypesCjs from '../../../../../functions/src/cms/blockTypes.cjs';
import BlockRenderer, { BLOCK_RENDERERS, rendererFor, UnknownBlock } from './registry.jsx';
import ContentContext from '../../contexts/ContentContext.jsx';

const venue = {
  name: 'Test Hall & Annex',
  addressLine1: '100 Main Street',
  city: 'Somerville',
  region: 'NJ',
  postalCode: '08876',
  country: 'US',
  mapUrl: 'https://maps.app.goo.gl/test-hall',
};
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { venue } }),
}));

const { BLOCK_TYPES } = blockTypesCjs.default ?? blockTypesCjs;

// One renderable sample block per backend block type.
const SAMPLE_BLOCKS = {
  text: { blockType: 'text', value: 'Sample text' },
  richtext: { blockType: 'richtext', value: '<p>Sample <strong>rich</strong> text</p>' },
  image: { blockType: 'image', url: 'https://example.org/i.png', alt: 'Sample image', caption: 'Caption' },
  map: {
    blockType: 'map',
    embedUrl: 'https://www.google.com/maps/embed?pb=fixture',
    label: 'Map of Test Hall',
    address: '1 Test Way',
  },
  cta: { blockType: 'cta', label: 'Register now', url: 'https://example.org/register', external: true },
  stat: { blockType: 'stat', value: '450', label: 'Attendees expected' },
  fact: { blockType: 'fact', label: 'Where', value: 'Test Hall', note: '1 Test Way' },
  quote: { blockType: 'quote', text: 'Decide who checks sources first.', attribution: 'A speaker' },
  list_item: { blockType: 'list_item', text: 'Sample list entry' },
  faq_item: { blockType: 'faq_item', question: 'Sample question?', answer: '<p>Sample answer.</p>' },
  link_group: { blockType: 'link_group', group: 'About', label: 'Contact the organizers', url: 'mailto:hi@example.org' },
  gallery: { blockType: 'gallery', layout: 'grid', images: [{ url: 'cms-images/a1/crowd.webp', alt: 'The main hall' }] },
  latest_updates: { blockType: 'latest_updates', updates: [{ id: 'program', title: 'The program is out' }] },
  sponsor_package: { blockType: 'sponsor_package', name: 'Coffee break', price: 'Illustrative', limit: 2, benefits: '<p>Signs</p>' },
  timeline: { blockType: 'timeline' },
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

  it.each(Object.keys(BLOCK_TYPES))('renders content for %s', async (id) => {
    const sample = SAMPLE_BLOCKS[id];
    // A new backend block type must gain a sample here alongside its renderer.
    expect(sample, `missing sample block for '${id}'`).toBeTruthy();
    const content = { timeline: [{ id: 'edition', year: 2024, title: 'First edition' }] };
    const { container } = render(
      <ContentContext.Provider value={content}><BlockRenderer block={sample} /></ContentContext.Provider>,
      { wrapper: MemoryRouter },
    );
    await waitFor(() => {
      expect(container.firstElementChild).toBeInTheDocument();
      expect(container.firstElementChild).not.toHaveAttribute('aria-hidden', 'true');
    });
  });

  it('routes unknown and prototype-name ids to UnknownBlock', () => {
    expect(rendererFor('mystery_widget')).toBe(UnknownBlock);
    expect(rendererFor('toString')).toBe(UnknownBlock);
    expect(rendererFor(undefined)).toBe(UnknownBlock);
    expect(rendererFor('text')).not.toBe(UnknownBlock);
  });

  it('renders the titled sandboxed map and an address search link', async () => {
    const { map } = SAMPLE_BLOCKS;
    render(<BlockRenderer block={map} />);
    const frame = await screen.findByTitle(map.label);
    expect(frame).toHaveAttribute('src', map.embedUrl);
    expect(frame).toHaveAttribute('loading', 'lazy');
    expect(frame).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
    expect(screen.getByText(map.address)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute(
      'href', 'https://www.google.com/maps/search/?api=1&query=1+Test+Way',
    );
  });

  it('links to the published map when its street address is blank', async () => {
    const map = { ...SAMPLE_BLOCKS.map, label: 'Map of the convention center', address: ' ' };
    render(<BlockRenderer block={map} />);
    expect(await screen.findByTitle(map.label)).toHaveAttribute('src', map.embedUrl);
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', map.embedUrl);
  });

  it('renders nothing for an invalid, unlabeled or starter map', async () => {
    const { map } = SAMPLE_BLOCKS;
    const { container, rerender } = render(<BlockRenderer block={map} />);
    await screen.findByTitle(map.label);
    rerender(<BlockRenderer block={{ ...map, embedUrl: 'https://www.google.com/maps/search?q=fixture' }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BlockRenderer block={{ ...map, label: '' }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BlockRenderer block={{ ...map, embedUrl: 'https://www.google.com/maps/embed?pb=[Replace]' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('embeds the venue name and address and links directly to the saved short URL', async () => {
    const label = 'Test event map';
    render(<BlockRenderer block={{ blockType: 'map', useEventVenue: true, label }} />);
    const frame = await screen.findByTitle(label);
    const src = new URL(frame.getAttribute('src'));
    expect(src.origin).toBe('https://www.google.com');
    expect(src.pathname).toBe('/maps');
    expect([...src.searchParams]).toEqual([
      ['q', 'Test Hall & Annex, 100 Main Street, Somerville, NJ 08876 US'],
      ['output', 'embed'],
    ]);
    expect(screen.getByText('100 Main Street, Somerville, NJ 08876 US')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', venue.mapUrl);
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
