// The Sessions panel on the speaker editor (owner decision, 2026-11-08):
// published sessions that name the speaker, their confirmation state, and
// Preview then Send. The HTTP seam and the admin subscriptions are mocked,
// so these pin the request bodies the server contract expects.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let collections = {};
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => { onNext(collections[name] || []); return () => {}; },
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { days: [{ id: 'day-1', label: 'Thursday' }] } }),
}));

import SpeakerSessionConfirmations, { speakerSessions } from './SpeakerSessionConfirmations.jsx';

const call = vi.fn();
const LIVE = {
  id: 'sess-1', title: 'Reporting on Deadline', dayId: 'day-1', startTime: '10:00 AM', endTime: '10:45 AM',
  location: 'Room B', speakerIds: ['rae'], visible: true,
};
const NAMED = { title: 'Reporting on Deadline', time: '2027-05-13 · 10:00 AM–10:45 AM', room: 'Room B' };
const PREVIEW = {
  to: 'rae@example.org',
  subject: 'Your session at Example Summit is confirmed: Reporting on Deadline',
  text: 'Hi Rae Okonkwo,\n\nReporting on Deadline\nRoom B',
  named: NAMED,
  contentHash: 'a'.repeat(64),
  changedSinceLastSend: false,
  mayHaveBeenSent: false,
  blocked: null,
  previous: null,
};

function open() {
  render(<SpeakerSessionConfirmations speakerId="rae" call={call} />);
}

beforeEach(() => {
  call.mockReset();
  collections = {
    cmsSchedule: [
      LIVE,
      { ...LIVE, id: 'sess-hidden', title: 'Hidden session', visible: false },
      { ...LIVE, id: 'sess-other', title: 'Someone else', speakerIds: ['pat'] },
    ],
    // A draft that adds the speaker has not happened yet.
    cmsSchedule_drafts: [{ ...LIVE, id: 'sess-draft', title: 'Draft only' }],
    session_confirmations: [],
  };
});
afterEach(cleanup);

describe('speakerSessions', () => {
  it('lists only published live sessions that name the speaker, with day, time and room', () => {
    const rows = [
      { id: 'a', live: LIVE },
      { id: 'b', live: null, draft: LIVE },
      { id: 'c', live: { ...LIVE, visible: false } },
      { id: 'd', live: { ...LIVE, location: '', speakerIds: ['rae'], dayId: null, startTime: '' } },
    ];
    expect(speakerSessions(rows, 'rae', [{ id: 'day-1', label: 'Thursday' }])).toEqual([
      { id: 'a', title: 'Reporting on Deadline', when: 'Thursday · 10:00 AM–10:45 AM', room: 'Room B' },
      { id: 'd', title: 'Reporting on Deadline', when: 'Unscheduled', room: 'No room' },
    ]);
  });
});

describe('SpeakerSessionConfirmations', () => {
  it('shows the speaker’s published sessions and their state', () => {
    open();
    expect(screen.getByRole('heading', { name: 'Reporting on Deadline' })).toBeInTheDocument();
    expect(screen.getByText('Thursday · 10:00 AM–10:45 AM · Room B')).toBeInTheDocument();
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    expect(screen.queryByText('Hidden session')).toBeNull();
    expect(screen.queryByText('Someone else')).toBeNull();
    expect(screen.queryByText('Draft only')).toBeNull();
  });

  it('says so when the speaker is on no published session', () => {
    collections.cmsSchedule = [];
    open();
    expect(screen.getByText('This speaker is not on a published session yet.')).toBeInTheDocument();
  });

  it('previews, then sends with the previewed slot', async () => {
    call.mockResolvedValueOnce({ preview: PREVIEW }).mockResolvedValueOnce({ state: 'sent', attempt: 1 });
    open();
    const preview = screen.getByRole('button', { name: 'Preview confirmation: Reporting on Deadline' });
    expect(preview).toHaveAttribute('type', 'button');
    fireEvent.click(preview);
    await waitFor(() => expect(call).toHaveBeenCalledWith('sendSessionConfirmation', { sessionId: 'sess-1', speakerId: 'rae', preview: true }));
    const region = await screen.findByRole('region', { name: 'Preview of the confirmation for Reporting on Deadline' });
    expect(region).toHaveFocus();
    expect(within(region).getByText(`Subject: ${PREVIEW.subject}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation' }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('sendSessionConfirmation', { sessionId: 'sess-1', speakerId: 'rae', expectedNamed: NAMED, expectedContent: 'a'.repeat(64) }));
    expect(await screen.findByText('Confirmation sent to rae@example.org.')).toBeInTheDocument();
  });

  it('disables the send when the confirmation was sent and nothing changed', async () => {
    collections.session_confirmations = [{ id: 'sess-1__rae', sessionId: 'sess-1', speakerId: 'rae', state: 'sent', attempt: 1, named: NAMED }];
    call.mockResolvedValueOnce({ preview: { ...PREVIEW, blocked: { code: 'already-sent', message: 'Already sent.' } } });
    open();
    expect(screen.getAllByText('Confirmation sent').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Preview confirmation: Reporting on Deadline' }));
    const button = await screen.findByRole('button', { name: 'Confirmation sent' });
    expect(button).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send confirmation' })).toBeNull();
  });

  it('says when the slot changed since the last confirmation, and sends the new one', async () => {
    const moved = { ...NAMED, room: 'Room C' };
    call.mockResolvedValueOnce({ preview: { ...PREVIEW, named: moved, changedSinceLastSend: true } }).mockResolvedValueOnce({ state: 'sent', attempt: 2 });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Preview confirmation: Reporting on Deadline' }));
    expect(await screen.findByText(/The title, time or room changed since the last confirmation/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation' }));
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('sendSessionConfirmation', { sessionId: 'sess-1', speakerId: 'rae', expectedNamed: moved, expectedContent: 'a'.repeat(64) }));
  });

  it('explains an uncertain send and sends again only with confirmUnknown', async () => {
    collections.session_confirmations = [{ id: 'sess-1__rae', sessionId: 'sess-1', speakerId: 'rae', state: 'unknown', attempt: 1, named: NAMED }];
    call.mockResolvedValueOnce({ preview: { ...PREVIEW, mayHaveBeenSent: true } }).mockResolvedValueOnce({ state: 'sent', attempt: 2 });
    open();
    expect(screen.getByText('May have been sent')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Preview confirmation: Reporting on Deadline' }));
    const again = await screen.findByRole('button', { name: 'I checked the Email log, send again' });
    expect(screen.queryByRole('button', { name: 'Send confirmation' })).toBeNull();
    fireEvent.click(again);
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('sendSessionConfirmation', {
      sessionId: 'sess-1', speakerId: 'rae', expectedNamed: NAMED, expectedContent: 'a'.repeat(64), confirmUnknown: true,
    }));
  });

  it('shows a refused send and asks for a fresh preview when the slot changed', async () => {
    const refusal = Object.assign(new Error('The session’s title, time or room changed. Preview the confirmation again.'), { code: 'slot-changed', fieldErrors: [] });
    call.mockResolvedValueOnce({ preview: PREVIEW }).mockRejectedValueOnce(refusal);
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Preview confirmation: Reporting on Deadline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Send confirmation' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Preview the confirmation again.');
    expect(alert).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Send confirmation' })).toBeNull();
  });
});
