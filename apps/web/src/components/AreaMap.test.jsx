import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import AreaMap, { openStreetMapCoordinates } from './AreaMap.jsx';

const leaflet = vi.hoisted(() => {
  const map = { setView: vi.fn(), remove: vi.fn() };
  map.setView.mockReturnValue(map);
  const marker = { addTo: vi.fn(), bindTooltip: vi.fn() };
  marker.addTo.mockReturnValue(marker);
  const tiles = { addTo: vi.fn(), on: vi.fn(), off: vi.fn() };
  tiles.on.mockReturnValue(tiles);
  tiles.addTo.mockReturnValue(tiles);
  return {
    tiles,
    map: vi.fn(() => map), instance: map,
    tileLayer: vi.fn(() => tiles),
    circleMarker: vi.fn(() => marker),
  };
});
vi.mock('leaflet', () => leaflet);
vi.mock('leaflet/dist/leaflet.css', () => ({}));

const url = 'https://www.openstreetmap.org/?mlat=40.7426&mlon=-74.1712#map=17/40.7426/-74.1712';
let enterViewport;
let disconnect;
beforeEach(() => {
  vi.clearAllMocks();
  disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { enterViewport = () => callback([{ isIntersecting: true }]); }
    observe() {}
    disconnect() { disconnect(); }
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('OpenStreetMap area map', () => {
  it('loads raster tiles only when visible and removes the map on unmount', async () => {
    const { unmount } = render(<AreaMap url={url} />);
    expect(leaflet.map).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'OpenStreetMap of the area around the venue' })).toBeInTheDocument();
    act(() => enterViewport());
    await waitFor(() => expect(leaflet.circleMarker).toHaveBeenCalled());
    expect(leaflet.map).toHaveBeenCalledWith(expect.any(HTMLElement), { scrollWheelZoom: false });
    expect(leaflet.instance.setView).toHaveBeenCalledWith([40.7426, -74.1712], 16);
    expect(leaflet.tileLayer).toHaveBeenCalledWith('https://tile.openstreetmap.org/{z}/{x}/{y}.png', expect.objectContaining({ keepBuffer: 0, updateWhenIdle: true }));
    expect(screen.getByRole('link', { name: /OpenStreetMap contributors/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    unmount();
    expect(leaflet.instance.remove).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });

  it('does not initialize a map when unmounted before the import resolves', async () => {
    const { unmount } = render(<AreaMap url={url} />);
    act(() => { enterViewport(); unmount(); });
    await act(async () => { await import('leaflet'); });
    expect(leaflet.map).not.toHaveBeenCalled();
  });

  it('removes the old map when coordinates change', async () => {
    const { rerender } = render(<AreaMap url={url} />);
    act(() => enterViewport());
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(1));
    rerender(<AreaMap url="https://www.openstreetmap.org/?mlat=40.74&mlon=-74.17" />);
    expect(leaflet.instance.remove).toHaveBeenCalledTimes(1);
    act(() => enterViewport());
    await waitFor(() => expect(leaflet.map).toHaveBeenCalledTimes(2));
  });

  it.each([
    null, '', 'https://google.com/maps', 'javascript:alert(1)',
    'https://openstreetmap.org.attacker.test/?mlat=40&mlon=-74',
    'http://www.openstreetmap.org/?mlat=40&mlon=-74',
    'https://user@www.openstreetmap.org/?mlat=40&mlon=-74',
    'https://www.openstreetmap.org:8443/?mlat=40&mlon=-74',
    'https://www.openstreetmap.org/?mlat=91&mlon=-74',
    'https://www.openstreetmap.org/?mlat=40&mlon=181',
    'https://www.openstreetmap.org/?mlat=&mlon=-74',
    'https://www.openstreetmap.org/?mlat=NaN&mlon=-74',
  ])('does not load invalid or untrusted locations: %s', (value) => {
    expect(openStreetMapCoordinates(value)).toBeNull();
    const { container } = render(<AreaMap url={value} />);
    expect(container).toBeEmptyDOMElement();
    expect(leaflet.map).not.toHaveBeenCalled();
  });
});


it('reports asynchronous tile errors and clears the status after a successful batch', async () => {
  const { unmount } = render(<AreaMap url={url} />);
  act(() => enterViewport());
  await waitFor(() => expect(leaflet.tiles.on).toHaveBeenCalled());
  const events = leaflet.tiles.on.mock.calls[0][0];
  act(() => { events.loading(); events.tileerror(); events.load(); });
  expect(screen.getByRole('status')).toHaveTextContent('could not fully load');
  act(() => { events.loading(); events.load(); });
  expect(screen.queryByRole('status')).toBeNull();
  unmount();
  expect(leaflet.tiles.off).toHaveBeenCalledWith(events);
});
it('reports stalled tile requests and cancels their timeout on unmount', async () => {
  const { unmount } = render(<AreaMap url={url} />);
  act(() => enterViewport());
  await waitFor(() => expect(leaflet.tiles.on).toHaveBeenCalled());
  const events = leaflet.tiles.on.mock.calls[0][0];
  vi.useFakeTimers();
  act(() => { events.loading(); vi.advanceTimersByTime(15000); });
  expect(screen.getByRole('status')).toHaveTextContent('could not fully load');
  act(() => events.loading());
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
