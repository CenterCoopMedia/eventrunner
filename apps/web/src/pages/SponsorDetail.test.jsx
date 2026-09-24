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
  return render(<MemoryRouter initialEntries={['/sponsors/demo-beacon' + search]}><Routes><Route path="/sponsors/:slug" element={<SponsorDetail />} /></Routes></MemoryRouter>);
}
beforeEach(() => {
  enabled = true;
  scheduleEnabled = true;
  scheduleData = [{ id: 'session-closing', visible: true }];
  organizationsData = [{ id: 'demo-beacon', name: 'Beacon', tier: 'presenting', visible: true, description: 'Travel support.', bio: 'First paragraph.\n\nSecond paragraph.', supportDescription: 'Covers the peer clinic.', readMorePath: '/schedule/session-closing', url: 'https://example.org' }];
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

// The page at the organization's slug (issue #193), drawn with the wave 2
// devices: nothing above the name, the description as the standfirst, and
// the tier as a term and its description.
describe('Sponsor detail at its slug', () => {
  const dtNamed = (term) => [...document.querySelectorAll('dt')].find((node) => node.textContent === term) ?? null;

  it('sets nothing above the name, and states the tier after it as a pair', () => {
    show();
    const heading = screen.getByRole('heading', { level: 1, name: 'Beacon' });
    const header = heading.closest('header');
    // No text sits inside the header before the <h1>: the logo is a
    // decorative image, and the tier line that used to stand there is gone.
    const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent.trim() === '') continue;
      expect(heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING, node.textContent).toBeTruthy();
    }
    const term = dtNamed('Tier');
    expect(term).not.toBeNull();
    expect(term.nextElementSibling).toHaveTextContent('presenting');
    expect(heading.compareDocumentPosition(term) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prints the description once, as the standfirst', () => {
    show();
    const lines = screen.getAllByText('Travel support.');
    expect(lines).toHaveLength(1);
    expect(lines[0].className).toContain('standfirst');
  });

  it('draws no tier pair without a tier', () => {
    organizationsData[0].tier = '  ';
    show();
    expect(dtNamed('Tier')).toBeNull();
    organizationsData[0].tier = { level: 1 };
    show();
    expect(dtNamed('Tier')).toBeNull();
  });

  it('draws no About section without a biography, and never repeats the description there', () => {
    organizationsData[0].bio = null;
    show();
    expect(screen.queryByRole('heading', { name: 'About Beacon' })).toBeNull();
    expect(screen.getAllByText('Travel support.')).toHaveLength(1);
    // The logo, the description and the link are what the page renders.
    expect(screen.getByRole('link', { name: /Visit Beacon/ })).toHaveAttribute('href', 'https://example.org');
  });
});
