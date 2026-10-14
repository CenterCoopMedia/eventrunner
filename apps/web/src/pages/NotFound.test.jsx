import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotFound from './NotFound.jsx';

const state = vi.hoisted(() => ({ pages: [], features: {}, name: 'Example conference' }));
vi.mock('../contexts/ContentContext.jsx', () => ({ useContent: () => ({ pages: state.pages }) }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { name: state.name }, features: state.features }),
}));
const schedule = { id: 'schedule', label: 'Program', path: '/schedule', order: 1, visible: true, systemPage: true };
const speakers = { id: 'speakers', label: 'Speakers', path: '/speakers', order: 2, visible: true, systemPage: true };
const view = () => render(<MemoryRouter><NotFound /></MemoryRouter>);
let media;
let listeners;
const ticketButton = () => screen.getByRole('button', { name: 'Swing the decorative ticket' });
function pointer(target, type, props = {}) {
  const event = new Event(type, { bubbles: true });
  Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: 100 }, props);
  fireEvent(target, event);
}
function preferReducedMotion(matches) {
  act(() => {
    media.matches = matches;
    listeners.forEach((listener) => listener({ matches }));
  });
}

beforeEach(() => {
  state.pages = [schedule, speakers];
  state.features = { schedule: true, speakers: true };
  state.name = 'Example conference';
  listeners = new Set();
  media = {
    matches: false,
    addEventListener: vi.fn((type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((type, listener) => listeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});
afterEach(() => vi.unstubAllGlobals());

describe('the missing-ticket recovery page', () => {
  it('offers the home page and the event’s published program and speakers', () => {
    view();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Page not found');
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: /Program/ }).getAttribute('href')).toBe('/schedule');
    expect(screen.getByRole('link', { name: /Speakers/ }).getAttribute('href')).toBe('/speakers');
    expect(screen.getByText('Example conference')).toBeTruthy();
    expect(screen.getByText('Not an admission ticket')).toBeTruthy();
  });
  it('does not advertise hidden pages or disabled features', () => {
    state.pages = [{ ...schedule, visible: false }, speakers];
    state.features.speakers = false;
    view();
    expect(screen.queryByRole('navigation', { name: 'Find your next stop' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
  it('uses the system route and the editor’s label, not a stale stored path', () => {
    state.pages = [{ ...schedule, label: 'Agenda', path: '/old-program' }];
    view();
    expect(screen.getByRole('link', { name: /Agenda/ }).getAttribute('href')).toBe('/schedule');
  });
  it('keeps recovery available with no published navigation', () => {
    state.pages = [];
    view();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
  it('replays through a keyboard-capable button without navigating or replacing focus', () => {
    view();
    const button = ticketButton();
    button.focus();
    const previous = button.firstElementChild;
    fireEvent.click(button, { detail: 0 });
    expect(button.firstElementChild).not.toBe(previous);
    expect(document.activeElement).toBe(button);
  });
  it('keeps animation paused from pointer-down through a return to the zero angle', () => {
    view();
    const button = ticketButton();
    const artwork = button.firstElementChild;
    pointer(button, 'pointerdown');
    expect(artwork.dataset.dragging).toBe('true');
    expect(artwork.style.getPropertyValue('--ticket-angle')).toBe('0deg');
    pointer(button, 'pointermove', { clientX: 180 });
    expect(artwork.style.getPropertyValue('--ticket-angle')).toBe('8deg');
    pointer(button, 'pointermove');
    expect(artwork.style.getPropertyValue('--ticket-angle')).toBe('0deg');
    expect(artwork.dataset.dragging).toBe('true');
    expect(button.firstElementChild).toBe(artwork);
    pointer(button, 'pointerup');
    expect(button.firstElementChild.dataset.dragging).toBe('false');
    const released = button.firstElementChild;
    expect(released).not.toBe(artwork);
    fireEvent.click(button, { detail: 1 });
    expect(button.firstElementChild).toBe(released);
  });
  it.each(['pointercancel', 'lostpointercapture'])('clears the complete gesture on %s', (type) => {
    view();
    const button = ticketButton();
    pointer(button, 'pointerdown');
    pointer(button, 'pointermove', { clientX: 180 });
    pointer(button, type);
    expect(button.firstElementChild.dataset.dragging).toBe('false');
    pointer(button, 'pointermove', { clientX: 240 });
    expect(button.firstElementChild.style.getPropertyValue('--ticket-angle')).toBe('0deg');
    pointer(button, 'pointerdown');
    expect(button.firstElementChild.dataset.dragging).toBe('true');
  });
  it('ignores secondary gestures and releases only the captured pointer', () => {
    view();
    const button = ticketButton();
    pointer(button, 'pointerdown', { isPrimary: false });
    expect(button.firstElementChild.dataset.dragging).toBe('false');
    pointer(button, 'pointerdown');
    pointer(button, 'pointerup', { pointerId: 2 });
    expect(button.firstElementChild.dataset.dragging).toBe('true');
    pointer(button, 'pointerup');
    expect(button.firstElementChild.dataset.dragging).toBe('false');
  });
  it('renders non-interactive decoration instead of a dead button with reduced motion', () => {
    media.matches = true;
    view();
    expect(screen.queryByRole('button', { name: 'Swing the decorative ticket' })).toBeNull();
    expect(document.querySelector('[data-static="true"]').getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-static="true"]').hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByText('Drag the ticket, or select it to give it a swing.')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });
  it('responds to preference changes during a drag and cleans up its subscription', () => {
    const { unmount } = view();
    pointer(ticketButton(), 'pointerdown');
    pointer(ticketButton(), 'pointermove', { clientX: 180 });
    preferReducedMotion(true);
    expect(screen.queryByRole('button', { name: 'Swing the decorative ticket' })).toBeNull();
    preferReducedMotion(false);
    expect(ticketButton().firstElementChild.dataset.dragging).toBe('false');
    pointer(ticketButton(), 'pointermove', { clientX: 240 });
    expect(ticketButton().firstElementChild.style.getPropertyValue('--ticket-angle')).toBe('0deg');
    unmount();
    expect(listeners.size).toBe(0);
  });
  it.each([false, true])('subscribes and cleans up with the legacy media-query API, initially reduced=%s', (matches) => {
    media = {
      matches,
      addListener: vi.fn((listener) => listeners.add(listener)),
      removeListener: vi.fn((listener) => listeners.delete(listener)),
    };
    const { unmount } = view();
    expect(media.addListener).toHaveBeenCalledTimes(1);
    expect(Boolean(screen.queryByRole('button', { name: 'Swing the decorative ticket' }))).toBe(!matches);
    preferReducedMotion(false);
    pointer(ticketButton(), 'pointerdown');
    pointer(ticketButton(), 'pointermove', { clientX: 180 });
    preferReducedMotion(true);
    expect(screen.queryByRole('button', { name: 'Swing the decorative ticket' })).toBeNull();
    expect(document.querySelector('[data-static="true"]').getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-static="true"]').hasAttribute('tabindex')).toBe(false);
    expect(screen.queryByText('Drag the ticket, or select it to give it a swing.')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
    preferReducedMotion(false);
    expect(ticketButton().firstElementChild.dataset.dragging).toBe('false');
    expect(ticketButton().firstElementChild.style.getPropertyValue('--ticket-angle')).toBe('0deg');
    const listener = media.addListener.mock.calls[0][0];
    unmount();
    expect(media.removeListener).toHaveBeenCalledWith(listener);
    expect(listeners.size).toBe(0);
  });
  it('prefers the modern subscription when both listener APIs exist', () => {
    media.addListener = vi.fn();
    media.removeListener = vi.fn();
    const { unmount } = view();
    preferReducedMotion(true);
    expect(screen.queryByRole('button', { name: 'Swing the decorative ticket' })).toBeNull();
    expect(media.addEventListener).toHaveBeenCalledTimes(1);
    expect(media.addListener).not.toHaveBeenCalled();
    const listener = media.addEventListener.mock.calls[0][1];
    unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
    expect(media.removeListener).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });
  it('keeps recovery available when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { unmount } = view();
    expect(screen.getByRole('link', { name: 'Go to the home page' }).getAttribute('href')).toBe('/');
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(() => unmount()).not.toThrow();
  });
});
