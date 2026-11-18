import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import EventRouter from './EventRouter.jsx';
import CtaBlock from './components/blocks/CtaBlock.jsx';

const sessionLink = Object.freeze({ url: '/schedule/one', label: 'Session' });

afterEach(() => {
  history.replaceState(null, '', '/');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function renderRoutes() {
  return render(
    <EventRouter>
      <Link to="/">Home</Link>
      <CtaBlock block={sessionLink} />
      <Routes>
        <Route path="/" element={<h1>Event home</h1>} />
        <Route path="/schedule/:id" element={<h1>Session details</h1>} />
      </Routes>
    </EventRouter>,
  );
}

it.each(['/', '/conference/', '/events/conference-2027/'])('loads a deep link and navigates within %s', async (base) => {
  vi.stubEnv('BASE_URL', base);
  history.replaceState(null, '', `${base}schedule/one?day=two#details`);
  renderRoutes();
  expect(screen.getByRole('heading', { name: 'Session details' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', base);
  expect(screen.getByRole('link', { name: 'Session' })).toHaveAttribute('href', `${base}schedule/one`);
  fireEvent.click(screen.getByRole('link', { name: 'Home' }));
  expect(await screen.findByRole('heading', { name: 'Event home' })).toBeInTheDocument();
  expect(location.pathname).toBe(base);
});

it('gives a bare mount its trailing slash without discarding query or fragment', () => {
  vi.stubEnv('BASE_URL', '/conference/');
  history.replaceState({ marker: 'kept' }, '', '/conference?lang=es#arrival');
  renderRoutes();
  expect(screen.getByRole('heading', { name: 'Event home' })).toBeInTheDocument();
  expect(`${location.pathname}${location.search}${location.hash}`).toBe('/conference/?lang=es#arrival');
  expect(history.state.marker).toBe('kept');
});

it.each(['/conference-old/schedule/one', '/conference%2fschedule/one', '/Conference/schedule/one'])('does not render event routes at %s', (path) => {
  vi.stubEnv('BASE_URL', '/conference/');
  // React Router warns when its basename does not match the address.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  history.replaceState(null, '', path);
  expect(renderRoutes().container).toBeEmptyDOMElement();
});
