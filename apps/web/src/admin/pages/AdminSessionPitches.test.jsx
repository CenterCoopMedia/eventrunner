// Call settings: an operator chooses this site's form or an external form
// (for example, Airtable). A blank external address never saves, because the
// server would read it as "no external form" and reopen native intake.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

let pitchCall;
const call = vi.fn();
vi.mock('../../lib/pitchSource.js', () => ({
  subscribePitchCall: (onNext) => { onNext(pitchCall); return () => {}; },
}));
let collections = {};
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => { onNext(collections[name] || []); return () => {}; },
}));
vi.mock('../../contexts/AuthContext.jsx', () => ({ useAuth: () => ({ isOperator: true }) }));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ eventConfig: { days: [] } }) }));
vi.mock('../adminApi.js', () => ({ useAdminApi: () => call }));

import { PITCH_NOTICE_DEFAULTS } from 'shared/pitch';
import AdminSessionPitches from './AdminSessionPitches.jsx';

const CLOSES_AT = '2027-01-31T23:59:59-05:00';
const FORM = 'https://airtable.com/appExample/shrExample';

function open() {
  render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
  fireEvent.click(screen.getByText('Manage the call for sessions'));
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
  render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: row.title }));
}

describe('AdminSessionPitches email settings', () => {
  it('saves the receipt mode and edited wording, and restores the shipped wording', async () => {
    collections.session_pitch_settings = [{ id: 'notices', receiptMode: 'automatic', templates: { 'pitch.declined': { subject: 'Custom decline', wording: 'Custom words.' } } }];
    pitchCall = { enabled: true, closesAt: CLOSES_AT, externalFormUrl: null };
    render(<MemoryRouter><AdminSessionPitches /></MemoryRouter>);
    fireEvent.click(screen.getByText('Manage pitch emails'));
    expect(screen.getByLabelText('Decline email subject')).toHaveValue('Custom decline');
    expect(screen.getByLabelText('Receipt subject')).toHaveValue(PITCH_NOTICE_DEFAULTS['pitch.receipt'].subject);
    fireEvent.change(screen.getByLabelText('Receipts'), { target: { value: 'manual' } });
    fireEvent.change(screen.getByLabelText('Receipt wording'), { target: { value: 'Thanks for “{{pitch_title}}”.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use the shipped decline email wording' }));
    expect(screen.getByLabelText('Decline email wording')).toHaveValue(PITCH_NOTICE_DEFAULTS['pitch.declined'].wording);
    fireEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('savePitchNoticeSettings', {
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

describe('AdminSessionPitches decision email', () => {
  it('previews, requires a confirmation, then sends the acceptance email once', async () => {
    openPitch(PITCH);
    expect(screen.getByText('No email was sent for this pitch.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Prepare the acceptance email'));
    fireEvent.change(screen.getByLabelText('Note to the submitter (optional)'), { target: { value: 'Plan for 45 minutes.' } });
    call.mockResolvedValueOnce({ preview: { to: PITCH.email, templateId: 'pitch.accepted', subject: 'Accepted', text: 'Hello,\n\nA note from the organizers:\nPlan for 45 minutes.' } });
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
      id: 'pitch-1', kind: 'decision', expectedStatus: 'accepted', expectedRevision: 2, feedback: 'Plan for 45 minutes.',
    });
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
    expect(screen.getByText('Reason: Inactive recipient')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('Retry the receipt')).toBeInTheDocument();
    expect(screen.queryByText('Prepare the acceptance email')).toBeNull();
  });

  it('offers no decision email before a decision and no receipt for an imported pitch', () => {
    openPitch({ ...PITCH, uid: null, status: 'in_review' });
    expect(screen.queryByText(/Prepare the/)).toBeNull();
    expect(screen.queryByText('Prepare a receipt')).toBeNull();
  });
});
