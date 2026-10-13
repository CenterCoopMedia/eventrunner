import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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

beforeEach(() => {
  state.pages = [schedule, speakers];
  state.features = { schedule: true, speakers: true };
  state.name = 'Example conference';
});

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
    const button = screen.getByRole('button', { name: 'Swing the decorative ticket' });
    button.focus();
    const previous = button.firstElementChild;
    fireEvent.click(button, { detail: 0 });
    expect(button.firstElementChild).not.toBe(previous);
    expect(document.activeElement).toBe(button);
  });
});
