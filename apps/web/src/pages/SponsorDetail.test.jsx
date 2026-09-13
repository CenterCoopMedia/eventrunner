import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
let organizationsData;
let enabled = true;
let scheduleEnabled;
let scheduleData;
vi.mock('../contexts/ContentContext.jsx', () => ({ useContent: () => ({ organizationsData, scheduleData }) }));
vi.mock('../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ features: { sponsors: enabled, schedule: scheduleEnabled } }) }));
vi.mock('../components/media/AssetImage.jsx', () => ({ default: () => null }));
import SponsorDetail from './SponsorDetail.jsx';
function show(search = '') {
  return render(<MemoryRouter initialEntries={['/sponsors/demo-beacon' + search]}><Routes><Route path="/sponsors/:id" element={<SponsorDetail />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  enabled = true;
  scheduleEnabled = true;
  scheduleData = [{ id: 'session-closing', visible: true }];
  organizationsData = [{ id: 'demo-beacon', name: 'Beacon', visible: true, description: 'Travel support.', bio: 'First paragraph.\n\nSecond paragraph.', supportDescription: 'Covers the peer clinic.', readMorePath: '/schedule/session-closing', url: 'https://example.org' }];
});
describe('Sponsor detail', () => {
  it('renders the full biography and supported session', () => {
    show();
    expect(screen.getByRole('heading', { name: 'Beacon', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Second paragraph.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /supported session/ })).toHaveAttribute('href', '/schedule/session-closing');
    expect(screen.getByRole('link', { name: /Visit Beacon/ })).toHaveAttribute('rel', 'noreferrer');
  });
  it('preserves draft preview in its return and session links', () => {
    show('?preview=1');
    expect(screen.getByRole('link', { name: /Back to sponsors/ })).toHaveAttribute('href', '/sponsors?preview=1');
    expect(screen.getByRole('link', { name: /supported session/ })).toHaveAttribute('href', '/schedule/session-closing?preview=1');
  });
  it.each(['hidden', 'disabled', 'missing'])('does not expose a %s sponsor', (state) => {
    if (state === 'hidden') organizationsData[0].visible = false;
    if (state === 'disabled') enabled = false;
    if (state === 'missing') organizationsData = [];
    show();
    expect(screen.getByText('This sponsor is not available')).toBeInTheDocument();
    expect(screen.queryByText('Second paragraph.')).not.toBeInTheDocument();
  });
  it('rejects unsafe links and ignores malformed biographies', () => {
    Object.assign(organizationsData[0], { url: 'javascript:alert(1)', readMorePath: '//evil.test', bio: {}, supportDescription: {} });
    show();
    expect(screen.queryByRole('link', { name: /Visit Beacon/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore the program' })).toHaveAttribute('href', '/schedule');
  });
});


it('hides program actions when the schedule feature is disabled', () => {
  scheduleEnabled = false;
  show();
  expect(screen.queryByRole('link', { name: /supported session|Explore the program/ })).toBeNull();
});
it.each(['missing', 'hidden'])('does not link to a %s supported session', (state) => {
  scheduleData = state === 'missing' ? [] : [{ id: 'session-closing', visible: false }];
  show();
  expect(screen.queryByRole('link', { name: /supported session/ })).toBeNull();
  expect(screen.getByRole('link', { name: 'Explore the program' })).toHaveAttribute('href', '/schedule');
});
