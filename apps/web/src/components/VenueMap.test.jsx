// VenueMap — the uploaded plan of the building, and the same rooms in words.
//
// The assertions that matter here are about the reader who cannot see the
// picture: the room names are real text in a real list, the image carries the
// operator's alt text, and the numbered dots drawn on the plan never reach
// the accessibility tree, because they say nothing the list does not. The
// rest is about the picture that does not arrive — a public page owes a
// reader silence there, not a note about somebody else's storage bucket.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { assetUrl } = vi.hoisted(() => ({ assetUrl: vi.fn() }));
vi.mock('../lib/mediaSource.js', () => ({ assetUrl }));

import VenueMap, { useVenueMapImage } from './VenueMap.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', 'index.css'), 'utf8');

const MAP = {
  image: 'cms-images/abc/plan.png',
  alt: 'Two floors of the building, with the hall at the front on the ground floor.',
  rooms: [
    { id: 'main-hall', name: 'Main hall', floor: 'Ground floor', number: 1, x: 60, y: 80 },
    { id: 'room-a', name: 'Room A', floor: 'First floor', number: 2, x: 20, y: 30 },
    { id: 'room-b', name: 'Room B', floor: null, number: null, x: null, y: null },
  ],
};

/** What ContentPage does: resolve the image, then hand both to the device. */
function MapHarness({ map }) {
  const image = useVenueMapImage(map);
  return (
    <>
      {image ? <p>The map is here</p> : null}
      <VenueMap map={map} image={image} />
    </>
  );
}

describe('VenueMap', () => {
  it('renders nothing at all when the venue has no map', () => {
    assetUrl.mockReturnValue(null);
    const { container } = render(<MapHarness map={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the image with the operator’s alt text', () => {
    assetUrl.mockReturnValue('https://storage.example/plan.png');
    render(<MapHarness map={MAP} />);
    expect(screen.getByAltText(MAP.alt)).toHaveAttribute(
      'src',
      'https://storage.example/plan.png',
    );
  });

  it('lists every room as text, including one nobody placed on the map', () => {
    assetUrl.mockReturnValue('https://storage.example/plan.png');
    render(<MapHarness map={MAP} />);
    const rooms = screen.getAllByRole('listitem');
    expect(rooms).toHaveLength(3);
    expect(rooms[0]).toHaveTextContent('Main hall');
    expect(rooms[0]).toHaveTextContent('Ground floor');
    // A room the operator has not placed is still a room of this venue, so
    // it is still named. The list is the venue's rooms, not the markers.
    expect(rooms[2]).toHaveTextContent('Room B');
  });

  it('hides the drawn markers from assistive technology and places them by percent', () => {
    assetUrl.mockReturnValue('https://storage.example/plan.png');
    const { container } = render(<MapHarness map={MAP} />);
    const markers = container.querySelectorAll('.venue-map__marker');
    // Only the two rooms with coordinates are drawn.
    expect(markers).toHaveLength(2);
    for (const marker of markers) expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(markers[0].style.left).toBe('60%');
    expect(markers[0].style.top).toBe('80%');
  });

  it('hangs the markers on the picture\u2019s own box, whatever shape the plan is', () => {
    // THE BUG THIS REPLACES: the frame held a fixed 4:3 ratio and the image
    // sat inside it on `object-fit: contain`. A portrait plan was letterboxed
    // \u2014 bars above and below \u2014 and every marker, placed as a percentage of
    // the FRAME, then pointed at a spot the picture was not drawn on. "60%
    // down" landed on grey. So the frame is whatever box the image's own
    // bytes make, and the markers are its children.
    assetUrl.mockReturnValue('https://storage.example/portrait-plan.png');
    const { container } = render(<MapHarness map={MAP} />);
    const image = screen.getByAltText(MAP.alt);
    const frame = container.querySelector('.venue-map__frame');

    expect(image).toHaveClass('venue-map__image');
    expect(image.parentElement).toBe(frame);
    for (const marker of container.querySelectorAll('.venue-map__marker')) {
      expect(marker.parentElement).toBe(frame);
    }

    // Nothing on either element forces a ratio the plan does not have: no
    // aspect utility, no inline ratio, and no `contain` fit to letterbox
    // inside one. jsdom does no layout, so the rule itself is the evidence.
    for (const element of [frame, image]) {
      expect(element.className).not.toMatch(/aspect-/);
      expect(element.style.aspectRatio).toBe('');
    }
    const rule = indexCss.match(/\.venue-map__image \{[^}]*\}/)[0];
    expect(rule).not.toMatch(/aspect-ratio/);
    expect(rule).not.toMatch(/object-fit/);
    // The frame shrinks to the picture instead of stretching past it, which
    // is what makes "60% across the frame" mean "60% across the plan".
    expect(indexCss).toMatch(/\.venue-map__frame \{[^}]*inline-size: fit-content;/);
  });

  it('renders the picture with no markers when nothing has been placed', () => {
    assetUrl.mockReturnValue('https://storage.example/plan.png');
    const bare = { ...MAP, rooms: [] };
    const { container } = render(<MapHarness map={bare} />);
    expect(screen.getByAltText(MAP.alt)).toBeInTheDocument();
    expect(container.querySelectorAll('.venue-map__marker')).toHaveLength(0);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('renders nothing when the path cannot be resolved to a URL', () => {
    // No bucket configured, or a stored value that is not an object path.
    // The public page says nothing rather than reporting a storage problem
    // to a reader who cannot act on it.
    assetUrl.mockReturnValue(null);
    const { container } = render(<MapHarness map={MAP} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('takes the whole device away when the picture fails to load', () => {
    assetUrl.mockReturnValue('https://storage.example/gone.png');
    const { container } = render(<MapHarness map={MAP} />);
    expect(container.querySelectorAll('.venue-map__marker')).toHaveLength(2);

    fireEvent.error(screen.getByAltText(MAP.alt));

    // No picture, so no numbered dots over nothing, no room list, and
    // nothing for the caller to hang a heading on either.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('The map is here')).not.toBeInTheDocument();
  });
});
