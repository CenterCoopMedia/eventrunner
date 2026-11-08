// Call settings: an operator chooses this site's form or an external form
// (for example, Airtable). A blank external address never saves, because the
// server would read it as "no external form" and reopen native intake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';

let pitchCall;
const call = vi.fn();
vi.mock('../../lib/pitchSource.js', () => ({
  subscribePitchCall: (onNext) => { onNext(pitchCall); return () => {}; },
}));
let collections = {};
const listeners = {};
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => { listeners[name] = onNext; onNext(collections[name] || []); return () => {}; },
}));
// A live snapshot after mount, as Firestore delivers one.
function push(name, docs) { act(() => listeners[name](docs)); }
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: true, user: { uid: 'me' } }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { days: [] } }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

import { PITCH_NOTICE_DEFAULTS } from 'shared/pitch';
import AdminSessionPitches from './AdminSessionPitches.jsx';
import AdminSessionPitch from './AdminSessionPitch.jsx';
import AdminPitchSettings from './AdminPitchSettings.jsx';

/** The pitch pages at their admin addresses (ADR 0008, admin review). */
function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/pitches" element={<AdminSessionPitches />} />
        <Route path="/admin/pitches/settings" element={<AdminPitchSettings />} />
        <Route path="/admin/pitches/:pitchId" element={<AdminSessionPitch />} />
      </Routes>
    </MemoryRouter>,
  );
}

const CLOSES_AT = '2027-01-31T23:59:59-05:00';
const FORM = 'https://airtable.com/appExample/shrExample';

function open() {
  renderAt('/admin/pitches/settings');
}

beforeEach(() => {
  collections = {};
  call.mockReset();
  call.mockResolvedValue({});
});
afterEach(cleanup);

describe('AdminSessionPitches call settings', () => {
  it('saves this site’s form as no external form', async () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    open();
    expect(screen.getByLabelText('Where people pitch')).toHaveValue('native');
    expect(screen.queryByLabelText('External form address')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save call settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null }));
  });

  it('saves an external form address', async () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT };
    open();
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('External form address'), { target: { value: ` ${FORM} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Save call settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('updatePitchCall', { enabled: true, closesAt: CLOSES_AT, externalFormUrl: FORM }));
  });

  it('refuses a blank external address in place and keeps focus on it', () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    open();
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save call settings' }).closest('form'));
    expect(call).not.toHaveBeenCalled();
    const field = screen.getByLabelText('External form address');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(screen.getByText('Enter the form address, or choose this site’s pitch form.')).toBeInTheDocument();
  });

  it('refuses an http address in place before calling the server', () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    open();
    fireEvent.change(screen.getByLabelText('Where people pitch'), { target: { value: 'external' } });
    fireEvent.change(screen.getByLabelText('External form address'), { target: { value: 'http://airtable.com/shrExample' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save call settings' }).closest('form'));
    expect(call).not.toHaveBeenCalled();
    expect(screen.getByLabelText('External form address')).toHaveFocus();
    expect(screen.getByText('Use an address that starts with https://.')).toBeInTheDocument();
  });

  it('shows this site’s form when the stored address is one the site would not use', () => {
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: 'http://airtable.com/shr' };
    open();
    expect(screen.getByLabelText('Where people pitch')).toHaveValue('native');
  });

  it('opens on the saved external form', () => {
    pitchCall = { enabled: false, closesAt: CLOSES_AT, externalFormUrl: FORM };
    open();
    expect(screen.getByLabelText('Where people pitch')).toHaveValue('external');
    expect(screen.getByLabelText('External form address')).toHaveValue(FORM);
  });
});

// Issue #324: pitch emails. Operators set the receipt mode and the wording.
// Staff send a decision email only after a preview and a confirmation.
const PITCH = {
  id: 'pitch-1', title: 'Reporting together', description: 'A workshop.', email: 'presenter@example.test',
  uid: 'submitter-1', status: 'accepted', reviewRevision: 2, privateNotes: 'PRIVATE-NOTE', consent: { version: 'v1' },
};

function openPitch(row) {
  collections.session_pitches = [row];
  pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
  renderAt(`/admin/pitches/${row.id}`);
}

describe('AdminSessionPitches email settings', () => {
  it('saves the receipt mode and edited wording, and restores the shipped wording', async () => {
    collections.session_pitch_settings = [{ id: 'notices', revision: 3, receiptMode: 'automatic', templates: { 'pitch.declined': { subject: 'Custom decline', wording: 'Custom words.' } } }];
    call.mockResolvedValueOnce({ revision: 4 });
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    renderAt('/admin/pitches/settings');
    expect(screen.getByLabelText('Decline email subject')).toHaveValue('Custom decline');
    expect(screen.getByLabelText('Receipt subject')).toHaveValue(PITCH_NOTICE_DEFAULTS['pitch.receipt'].subject);
    fireEvent.change(screen.getByLabelText('Receipts'), { target: { value: 'manual' } });
    fireEvent.change(screen.getByLabelText('Receipt wording'), { target: { value: 'Thanks for “{{pitch_title}}”.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use the shipped decline email wording' }));
    expect(screen.getByLabelText('Decline email wording')).toHaveValue(PITCH_NOTICE_DEFAULTS['pitch.declined'].wording);
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('savePitchNoticeSettings', {
      expectedRevision: 3,
      receiptMode: 'manual',
      templates: {
        'pitch.receipt': { subject: PITCH_NOTICE_DEFAULTS['pitch.receipt'].subject, wording: 'Thanks for “{{pitch_title}}”.' },
        'pitch.accepted': { ...PITCH_NOTICE_DEFAULTS['pitch.accepted'] },
        'pitch.declined': { ...PITCH_NOTICE_DEFAULTS['pitch.declined'] },
      },
    }));
    expect(await screen.findByText('Email settings saved.')).toBeInTheDocument();
  });
});

describe('AdminSessionPitches email settings conflict', () => {
  it('keeps unsaved wording and refuses to save over another operator’s settings', async () => {
    collections.session_pitch_settings = [{ id: 'notices', revision: 1, receiptMode: 'automatic', templates: {} }];
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    renderAt('/admin/pitches/settings');
    fireEvent.change(screen.getByLabelText('Receipt wording'), { target: { value: 'My unsaved words.' } });
    push('session_pitch_settings', [{ id: 'notices', revision: 2, receiptMode: 'manual', templates: {} }]);
    expect(screen.getByLabelText('Receipt wording')).toHaveValue('My unsaved words.');
    expect(screen.getByText(/Another operator saved the email settings/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save email settings' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load current settings' }));
    expect(screen.getByLabelText('Receipts')).toHaveValue('manual');
    expect(screen.getByLabelText('Receipt wording')).toHaveValue(PITCH_NOTICE_DEFAULTS['pitch.receipt'].wording);
    call.mockResolvedValueOnce({ revision: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('savePitchNoticeSettings', expect.objectContaining({ expectedRevision: 2, receiptMode: 'manual' })));
    // Our own save arrives as the next snapshot: no conflict.
    push('session_pitch_settings', [{ id: 'notices', revision: 3, receiptMode: 'manual', templates: {} }]);
    expect(screen.queryByText(/Another operator saved the email settings/)).toBeNull();
  });
});

describe('AdminSessionPitches decision email', () => {
  it('previews, requires a confirmation, then sends the acceptance email once', async () => {
    openPitch(PITCH);
    expect(screen.getByText('No email was sent for this pitch.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Prepare the acceptance email'));
    fireEvent.change(screen.getByLabelText('Note to the submitter (optional)'), { target: { value: 'Plan for 45 minutes.' } });
    call.mockResolvedValueOnce({ preview: { to: PITCH.email, addressVerified: true, templateId: 'pitch.accepted', subject: 'Accepted', text: 'Hello,\n\nA note from the organizers:\nPlan for 45 minutes.', settingsRevision: 5, mayHaveBeenSent: false, otherDecisionSent: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview the acceptance email' }));
    const preview = await screen.findByRole('region', { name: 'Preview of the acceptance email' });
    expect(preview).toHaveTextContent('Plan for 45 minutes.');
    expect(call).toHaveBeenLastCalledWith('sendSessionPitchNotice', {
      id: 'pitch-1', kind: 'decision', expectedStatus: 'accepted', expectedRevision: 2, feedback: 'Plan for 45 minutes.', preview: true,
    });
    const send = screen.getByRole('button', { name: 'Send the acceptance email' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: `I reviewed this email. Send it to ${PITCH.email}.` }));
    expect(send).toBeEnabled();
    call.mockResolvedValueOnce({ state: 'sent', templateId: 'pitch.accepted', attempt: 1 });
    fireEvent.click(send);
    expect(await screen.findByText(`Acceptance email sent to ${PITCH.email}.`)).toBeInTheDocument();
    expect(call).toHaveBeenLastCalledWith('sendSessionPitchNotice', {
      id: 'pitch-1', kind: 'decision', expectedStatus: 'accepted', expectedRevision: 2, feedback: 'Plan for 45 minutes.', expectedSettingsRevision: 5,
    });
    expect(screen.queryByText(/imported CSV/)).toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('clears the preview when the note changes, so staff confirm what is sent', async () => {
    openPitch(PITCH);
    fireEvent.click(screen.getByText('Prepare the acceptance email'));
    call.mockResolvedValueOnce({ preview: { to: PITCH.email, templateId: 'pitch.accepted', subject: 'Accepted', text: 'Hello.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview the acceptance email' }));
    await screen.findByRole('region', { name: 'Preview of the acceptance email' });
    fireEvent.change(screen.getByLabelText('Note to the submitter (optional)'), { target: { value: 'Changed.' } });
    expect(screen.queryByRole('region', { name: 'Preview of the acceptance email' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send the acceptance email' })).toBeNull();
  });

  it('shows each delivery state in words and offers a retry only for an email that was not sent', () => {
    openPitch({ ...PITCH, notices: {
      receipt: { state: 'failed', mode: 'automatic', attempt: 1, error: 'Inactive recipient' },
      accepted: { state: 'sent', mode: 'manual', queuedBy: 'staff@example.test', attempt: 1 },
    } });
    expect(screen.getByText('Not sent')).toBeInTheDocument();
    expect(screen.getByText('The email service refused it. The Email log has the details.')).toBeInTheDocument();
    expect(screen.queryByText(/Inactive recipient/)).toBeNull();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Retry the receipt')).toBeInTheDocument();
    expect(screen.queryByText('Prepare the acceptance email')).toBeNull();
  });

  it('says an imported address is unverified and that the other decision already went', async () => {
    openPitch({ ...PITCH, uid: null, status: 'rejected', notices: { accepted: { state: 'sent', mode: 'manual', attempt: 1 } } });
    fireEvent.click(screen.getByText('Prepare the decline email'));
    call.mockResolvedValueOnce({ preview: { to: PITCH.email, addressVerified: false, templateId: 'pitch.declined', subject: 'About', text: 'Hello.', settingsRevision: 0, mayHaveBeenSent: false, otherDecisionSent: 'accepted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview the decline email' }));
    expect(await screen.findByText('This address came from an imported CSV. Nobody verified it. Check it before you send.')).toBeInTheDocument();
    expect(screen.getByText('An acceptance was already sent to this person.')).toBeInTheDocument();
  });

  it('shows an unknown delivery and requires a log check before the retry', async () => {
    openPitch({ ...PITCH, status: 'new', notices: { receipt: { state: 'unknown', mode: 'automatic', attempt: 1, error: 'socket hang up' } } });
    expect(screen.getByText('May have been sent')).toBeInTheDocument();
    expect(screen.getByText('We do not know if the email went out. Check the Email log before you send it again.')).toBeInTheDocument();
    expect(screen.queryByText(/socket hang up/)).toBeNull();
    fireEvent.click(screen.getByText('Retry the receipt'));
    call.mockResolvedValueOnce({ preview: { to: PITCH.email, addressVerified: true, templateId: 'pitch.receipt', subject: 'Got it', text: 'Hello.', settingsRevision: 0, mayHaveBeenSent: true, otherDecisionSent: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview the receipt' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: `I reviewed this email. Send it to ${PITCH.email}.` }));
    const send = screen.getByRole('button', { name: 'Send the receipt' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I checked the Email log. The earlier email was not delivered.' }));
    expect(send).toBeEnabled();
    call.mockResolvedValueOnce({ state: 'sent', templateId: 'pitch.receipt', attempt: 2 });
    fireEvent.click(send);
    await waitFor(() => expect(call).toHaveBeenLastCalledWith('sendSessionPitchNotice', {
      id: 'pitch-1', kind: 'receipt', expectedStatus: 'new', expectedRevision: 2, expectedSettingsRevision: 0, confirmUnknown: true,
    }));
  });

  it('hides the retry while an email is still being sent', () => {
    openPitch({ ...PITCH, notices: {
      receipt: { state: 'queued', mode: 'automatic', attempt: 1, queuedAt: new Date() },
      accepted: { state: 'queued', mode: 'manual', attempt: 1, queuedAt: new Date() },
    } });
    expect(screen.getAllByText('Sending')).toHaveLength(2);
    expect(screen.queryByText('Retry the receipt')).toBeNull();
    expect(screen.queryByText('Prepare the acceptance email')).toBeNull();
  });

  it('offers no decision email before a decision and no receipt for an imported pitch', () => {
    openPitch({ ...PITCH, uid: null, status: 'in_review' });
    expect(screen.queryByText(/Prepare the/)).toBeNull();
    expect(screen.queryByText('Prepare a receipt')).toBeNull();
  });
});

// ADR 0008, admin review: the queue in the list idiom, and one pitch with
// decision buttons, separate notes, and staff edits.
const QUEUE = [
  { ...PITCH, id: 'p-new', title: 'Newest pitch', status: 'new', format: 'Workshop', lengthMinutes: 60, createdAt: new Date('2026-11-02T10:00:00Z'),
    presenters: [{ name: 'Ada', email: 'presenter@example.test', lead: true }, { name: 'Bo', email: 'bo@example.test', lead: false }] },
  // Stored by an older site as rejected; the queue reads it as declined.
  { ...PITCH, id: 'p-old', title: 'Older pitch', status: 'rejected', createdAt: new Date('2026-11-01T10:00:00Z'), submitted: { title: 'Old' } },
];

describe('AdminSessionPitches queue', () => {
  it('lists every pitch newest first with its decision, detail line and Review link, and counts them in the title band', () => {
    collections.session_pitches = QUEUE;
    renderAt('/admin/pitches');
    expect(screen.getByText('2 pitches')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Session pitches' });
    const items = list.querySelectorAll(':scope > li');
    expect([...items].map((item) => item.querySelector('a').textContent)).toEqual(['Newest pitch', 'Older pitch']);
    expect(items[0]).toHaveTextContent('New');
    expect(items[0]).toHaveTextContent('presenter@example.test · Workshop · 60 min · 2 presenters');
    expect(items[1]).toHaveTextContent('Declined');
    expect(items[1]).toHaveTextContent('Edited by staff');
    expect(screen.getByRole('link', { name: 'Review Newest pitch' })).toHaveAttribute('href', '/admin/pitches/p-new');
    expect(screen.getByRole('link', { name: 'Call settings' })).toHaveAttribute('href', '/admin/pitches/settings');
    expect(screen.getByRole('link', { name: 'Import pitches' })).toHaveAttribute('href', '/admin/pitches/import');
  });

  it('filters by decision and searches presenter names', () => {
    collections.session_pitches = QUEUE;
    renderAt('/admin/pitches');
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'declined' } });
    expect(screen.getByText('Showing 1 of 2.')).toHaveAttribute('role', 'status');
    fireEvent.change(screen.getByLabelText('Decision'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'bo' } });
    expect(screen.getByText('Showing 1 of 2.')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('link', { name: 'Newest pitch' })).toBeInTheDocument();
  });

  it('says so when there are no pitches yet', () => {
    renderAt('/admin/pitches');
    expect(screen.getByText('No pitches yet')).toBeInTheDocument();
  });
});

describe('AdminSessionPitch decisions, notes and edits', () => {
  it('saves a decision with one press, without notes, and offers the other decisions', async () => {
    openPitch({ ...PITCH, status: 'new' });
    expect(screen.getByRole('heading', { level: 1, name: PITCH.title })).toBeInTheDocument();
    const group = screen.getByRole('group', { name: 'Decision' });
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Accept', 'Decline', 'Mark in review']);
    call.mockResolvedValueOnce({ id: PITCH.id, status: 'accepted', revision: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(await screen.findByText('Accepted. No email was sent.')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('reviewSessionPitch', { id: PITCH.id, status: 'accepted', expectedStatus: 'new', expectedRevision: 2 });
  });

  it('offers no other decision once the pitch is a draft session, and says why', () => {
    openPitch({ ...PITCH, status: 'accepted', conversion: { sessionId: 'session-1', speakerIds: ['speaker-1'] } });
    expect(screen.queryByRole('group', { name: 'Decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
    expect(screen.getByText(/already a draft session/)).toBeInTheDocument();
  });

  it('adds a signed note without touching the decision, and edits only your own', async () => {
    openPitch({ ...PITCH, status: 'in_review', reviewNotes: [
      { id: 'aaaaaaaaaaaaaaaa', uid: 'someone', email: 'other@example.test', text: 'Their note.', createdAt: '2026-11-05T15:00:00Z', editedAt: null },
      { id: 'bbbbbbbbbbbbbbbb', uid: 'me', email: 'me@example.test', text: 'My note.', createdAt: '2026-11-05T15:05:00Z', editedAt: null },
    ] });
    expect(screen.getByText('other@example.test')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Add a note'), { target: { value: 'Strong fit.' } });
    call.mockResolvedValueOnce({ note: { id: 'cccccccccccccccc', uid: 'me', email: 'me@example.test', text: 'Strong fit.', createdAt: '2026-11-05T16:00:00Z', editedAt: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Note added.')).toBeInTheDocument();
    expect(screen.getByText('Strong fit.')).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith('saveSessionPitchNote', { id: PITCH.id, action: 'add', text: 'Strong fit.' });
  });

  it('edits the proposal and sends the corrected fields with the revision it read', async () => {
    openPitch({ ...PITCH, status: 'new', presenters: [{ name: 'Ada', email: PITCH.email, organization: null, role: null, lead: true }] });
    fireEvent.click(screen.getByRole('button', { name: 'Edit pitch' }));
    expect(screen.getByText(/Email:/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Reporting together, revised' } });
    call.mockResolvedValueOnce({ id: PITCH.id, revision: 3, changed: ['title'] });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Changes saved. The submitted copy is kept. No email was sent.')).toBeInTheDocument();
    const [name, body] = call.mock.calls.at(-1);
    expect(name).toBe('editSessionPitch');
    expect(body).toMatchObject({ id: PITCH.id, expectedRevision: 2, pitch: { title: 'Reporting together, revised', leadName: 'Ada', description: 'A workshop.', presenters: [] } });
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('keeps the edit open with the server reason when the edit is refused', async () => {
    openPitch({ ...PITCH, status: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit pitch' }));
    call.mockRejectedValueOnce(new Error('leadName: Enter your name.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('leadName: Enter your name.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('stops every control when the live pitch moves on, and offers the current version', () => {
    openPitch({ ...PITCH, status: 'new' });
    push('session_pitches', [{ ...PITCH, status: 'in_review', reviewRevision: 3 }]);
    expect(screen.getByText(/Someone else changed this pitch while you had it open/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Edit pitch' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load the current version' }));
    expect(screen.getByText('Current version loaded.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  it('keeps format as free text in the edit form when the call lists no formats', () => {
    openPitch({ ...PITCH, status: 'new', format: 'Panel' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit pitch' }));
    expect(screen.getByRole('textbox', { name: 'Format' })).toHaveValue('Panel');
    expect(screen.queryByRole('combobox', { name: 'Format' })).toBeNull();
  });

  it('clears the draft-creation confirmation when the current version is loaded', () => {
    openPitch({ ...PITCH, status: 'accepted' });
    fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed the proposal/ }));
    expect(screen.getByRole('checkbox', { name: /I reviewed the proposal/ })).toBeChecked();
    push('session_pitches', [{ ...PITCH, status: 'accepted', reviewRevision: 3, title: 'Changed by someone else' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Load the current version' }));
    expect(screen.getByRole('checkbox', { name: /I reviewed the proposal/ })).not.toBeChecked();
  });

  it('says so for an address with no pitch', () => {
    collections.session_pitches = [];
    renderAt('/admin/pitches/no-such-pitch');
    expect(screen.getByText('No such pitch')).toBeInTheDocument();
  });
});
