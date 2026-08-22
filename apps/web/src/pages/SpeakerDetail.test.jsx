// Public speaker page (issue #22): rendered from the SAME live
// speakers_public projection Speakers.jsx reads, plus the sessions cross-
// link (a query over scheduleData, not a stored list — spec §4.3).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

let speakers;
let scheduleData;
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({ speakers, scheduleData }),
}));
let features = { speakers: true };
const eventConfig = { timezone: 'America/Chicago', days: [{ id: 'day-1', date: '2026-10-15' }] };
vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ features, eventConfig }),
}));

import SpeakerDetail from './SpeakerDetail.jsx';

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/speakers/:slug" element={<SpeakerDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

const PROJECTED = {
  id: 'rae-okonkwo',
  firstName: 'Rae',
  lastName: 'Okonkwo',
  displayName: 'Rae Okonkwo',
  slug: 'rae-okonkwo',
  bio: 'Community reporter.',
  headshotPath: 'speaker-photos/rae-okonkwo/photo.jpg',
  organization: '[Demo] Cooperative',
  jobTitle: 'Editor',
  socialHandles: { twitter: '@rae' },
};

describe('SpeakerDetail', () => {
  it('renders the speaker by slug, including bio, affiliation, and socials', () => {
    speakers = [PROJECTED];
    scheduleData = [];
    renderAt('/speakers/rae-okonkwo');
    expect(screen.getByRole('heading', { level: 1, name: 'Rae Okonkwo' })).toBeInTheDocument();
    expect(screen.getByText('Editor, [Demo] Cooperative')).toBeInTheDocument();
    expect(screen.getByText('Community reporter.')).toBeInTheDocument();
    expect(screen.getByText('@rae')).toBeInTheDocument();
  });

  it('404s for an unknown slug', () => {
    speakers = [PROJECTED];
    scheduleData = [];
    renderAt('/speakers/nobody-here');
    expect(screen.getByText('This speaker isn’t available')).toBeInTheDocument();
  });

  it('404s for a speaker with no public projection — same state as an unknown slug', () => {
    // An unapproved/removed speaker simply has no document in `speakers`
    // (useContent().speakers), so this is indistinguishable from an unknown
    // slug on purpose — the same non-oracle rule AttendeeProfile follows.
    speakers = [];
    scheduleData = [];
    renderAt('/speakers/rae-okonkwo');
    expect(screen.getByText('This speaker isn’t available')).toBeInTheDocument();
  });

  it('lists the speaker’s sessions resolved from cmsSchedule.speakerIds, linked to the session detail page', () => {
    speakers = [PROJECTED];
    scheduleData = [
      {
        id: 'sess-1',
        title: 'Reporting on Deadline',
        dayId: 'day-1',
        startTime: '10:00 AM',
        speakerIds: ['rae-okonkwo'],
        visible: true,
      },
      {
        id: 'sess-2',
        title: 'Not this speaker',
        dayId: 'day-1',
        startTime: '11:00 AM',
        speakerIds: ['someone-else'],
        visible: true,
      },
    ];
    renderAt('/speakers/rae-okonkwo');
    expect(screen.getByRole('link', { name: 'Reporting on Deadline' })).toHaveAttribute(
      'href',
      '/schedule/sess-1',
    );
    expect(screen.queryByText('Not this speaker')).toBeNull();
  });

  it('gates on the speakers feature flag', () => {
    speakers = [PROJECTED];
    scheduleData = [];
    features = { speakers: false };
    renderAt('/speakers/rae-okonkwo');
    expect(screen.getByText('This event doesn’t have a public speaker directory')).toBeInTheDocument();
    features = { speakers: true };
  });
});
