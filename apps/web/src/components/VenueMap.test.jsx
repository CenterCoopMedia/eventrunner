// VenueMap — the uploaded plan of the building, and the same rooms in words.
//
// The assertions that matter here are about the reader who cannot see the
// picture: the room names are real text in a real list, the image carries the
// operator's alt text, and the numbered dots drawn on the plan never reach
// the accessibility tree, because they say nothing the list does not.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// assetUrl builds a Storage URL from the app's Firebase config; the component
// only cares that it got one, so the seam is stubbed rather than configured.
vi.mock('./media/AssetImage.jsx', () => ({
  default: ({ path, alt, className }) => <img src={path} alt={alt} className={className} />,
}));

import VenueMap from './VenueMap.jsx';

const MAP = {
  image: 'cms-images/abc/plan.png',
  alt: 'Two floors of the building, with the hall at the front on the ground floor.',
  rooms: [
    { id: 'main-hall', name: 'Main hall', floor: 'Ground floor', number: 2, x: 60, y: 80 },
    { id: 'room-a', name: 'Room A', floor: 'First floor', number: 1, x: 20, y: 30 },
    { id: 'room-b', name: 'Room B', floor: null, number: null, x: null, y: null },
  ],
};

describe('VenueMap', () => {
  it('renders nothing at all when the venue has no map', () => {
    const { container } = render(<VenueMap map={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the image with the operator’s alt text', () => {
    render(<VenueMap map={MAP} />);
    const image = screen.getByAltText(MAP.alt);
    expect(image).toHaveAttribute('src', 'cms-images/abc/plan.png');
  });

  it('lists every room as text, including one nobody placed on the map', () => {
    render(<VenueMap map={MAP} />);
    const rooms = screen.getAllByRole('listitem');
    expect(rooms).toHaveLength(3);
    expect(rooms[0]).toHaveTextContent('Main hall');
    expect(rooms[0]).toHaveTextContent('Ground floor');
    // A room the operator has not placed is still a room of this venue, so
    // it is still named. The list is the venue's rooms, not the markers.
    expect(rooms[2]).toHaveTextContent('Room B');
  });

  it('hides the drawn markers from assistive technology and places them by percent', () => {
    const { container } = render(<VenueMap map={MAP} />);
    const markers = container.querySelectorAll('.venue-map__marker');
    // Only the two rooms with coordinates are drawn.
    expect(markers).toHaveLength(2);
    for (const marker of markers) expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(markers[0].style.left).toBe('60%');
    expect(markers[0].style.top).toBe('80%');
  });

  it('renders the picture with no markers when nothing has been placed', () => {
    const bare = { ...MAP, rooms: [] };
    const { container } = render(<VenueMap map={bare} />);
    expect(screen.getByAltText(MAP.alt)).toBeInTheDocument();
    expect(container.querySelectorAll('.venue-map__marker')).toHaveLength(0);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});
