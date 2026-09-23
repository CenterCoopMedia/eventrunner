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
  publishAt: new Date('2026-10-01T12:00:00Z'),
  visible: true,
};
const HIDDEN_UPDATE = {
  id: 'update-2',
  title: '[Fixture] Draft, never published',
  body: 'should never render',
  publishAt: null,
  visible: false,
};

function renderDetail(
  id,
  { features = { updates: true }, updates = [VISIBLE_UPDATE], eventConfig = {} } = {},
) {
  return render(
    <MemoryRouter initialEntries={[`/updates/${id}`]}>
      <EventConfigContext.Provider
        value={{ eventConfig, features, theme: {}, badges: null, source: 'snapshot' }}
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

  it('dates the update on the event’s clock, not the reader’s', () => {
    // The dateline device carries the event's clock (design record §3.1).
    // Half past two in the morning UTC on 1 October is the evening of 30
    // September at a west-coast venue; the test runner's own zone is UTC,
    // so a dateline in the reader's zone would say 1 October.
    renderDetail('late-night', {
      eventConfig: { timezone: 'America/Los_Angeles' },
      updates: [{ ...VISIBLE_UPDATE, id: 'late-night', publishAt: new Date('2026-10-01T02:30:00Z') }],
    });
    const time = screen.getByText('September 30, 2026');
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', '2026-10-01T02:30:00.000Z');
    expect(time.closest('p')).toHaveClass('byline');
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
