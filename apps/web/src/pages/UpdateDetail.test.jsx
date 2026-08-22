// UpdateDetail — one published update at /updates/:id (issue #27 follow-up).
// No Firebase, no network; context providers only, same pattern as
// SessionDetail.test.jsx.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import ContentContext from '../contexts/ContentContext.jsx';
import UpdateDetail from './UpdateDetail.jsx';

const VISIBLE_UPDATE = {
  id: 'update-1',
  title: '[Fixture] Parking has moved',
  body: 'Please use lot B starting Thursday.',
  publishAt: new Date('2026-10-01T00:00:00Z'),
  visible: true,
};
const HIDDEN_UPDATE = {
  id: 'update-2',
  title: '[Fixture] Draft, never published',
  body: 'should never render',
  publishAt: null,
  visible: false,
};

function renderDetail(id, { features = { updates: true }, updates = [VISIBLE_UPDATE] } = {}) {
  return render(
    <MemoryRouter initialEntries={[`/updates/${id}`]}>
      <EventConfigContext.Provider
        value={{ eventConfig: {}, features, theme: {}, badges: null, source: 'snapshot' }}
      >
        <ContentContext.Provider value={{ updates, getBlock: () => null }}>
          <Routes>
            <Route path="/updates/:id" element={<UpdateDetail />} />
          </Routes>
        </ContentContext.Provider>
      </EventConfigContext.Provider>
    </MemoryRouter>,
  );
}

describe('UpdateDetail', () => {
  it('is gated behind config/features.updates', () => {
    renderDetail('update-1', { features: { updates: false } });
    expect(
      screen.getByRole('heading', { name: 'This event doesn’t have public updates' }),
    ).toBeInTheDocument();
  });

  it('renders the title, date, and body of a visible update', () => {
    renderDetail('update-1');
    expect(
      screen.getByRole('heading', { level: 1, name: VISIBLE_UPDATE.title }),
    ).toBeInTheDocument();
    expect(screen.getByText('Please use lot B starting Thursday.')).toBeInTheDocument();
    expect(screen.getByText('October 1, 2026')).toBeInTheDocument();
  });

  it('404s (designed empty state) for an unknown update id', () => {
    renderDetail('no-such-update');
    expect(
      screen.getByRole('heading', { name: 'This update is not available' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to updates' })).toHaveAttribute(
      'href',
      '/updates',
    );
  });

  it('404s for a hidden (unpublished draft) update rather than leaking it', () => {
    renderDetail('update-2', { updates: [HIDDEN_UPDATE] });
    expect(
      screen.getByRole('heading', { name: 'This update is not available' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(HIDDEN_UPDATE.body)).toBeNull();
  });
});
