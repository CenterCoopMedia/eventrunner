// The speaker email wording page (functions/src/speakers/mailTemplates.cjs).
// Mocks adminApi directly, as AdminSpeakerReminders.test.jsx does: the
// endpoint is the only data source, and every preview renders on the server.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AdminApiError } from '../adminApi.js';

const callMock = vi.fn();
vi.mock('../adminApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useAdminApi: () => callMock,
}));
vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig: { timezone: 'UTC' } }),
}));

import AdminSpeakerMail from './AdminSpeakerMail.jsx';

const INVITE = {
  id: 'speaker.invite',
  shipped: { subject: 'You are invited to speak at {{event_name}}', html: '<p>{{invite_url}}</p>', text: '{{invite_url}}' },
  saved: null,
  savedErrors: [],
  tokens: ['speaker_name', 'invite_url', 'invite_type', 'admin_contact_email'],
  globalTokens: ['event_name'],
  requiredTokens: ['invite_url'],
};
const ACCEPTED = {
  id: 'speaker.accepted',
  shipped: { subject: 'You are confirmed for {{event_name}}', html: '<p>{{profile_wizard_url}}</p>', text: '{{profile_wizard_url}}' },
  saved: null,
  savedErrors: [],
  tokens: ['speaker_name', 'profile_wizard_url', 'deadline'],
  globalTokens: ['event_name'],
  requiredTokens: ['profile_wizard_url'],
};

function saved(entry, wording) {
  return {
    ...entry,
    saved: { ...entry.shipped, ...wording, updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: 'staff@example.test' },
  };
}

function serve(handlers = {}) {
  callMock.mockImplementation((name, body) => {
    expect(name).toBe('speakerMailTemplates');
    const answer = handlers[body.action];
    if (typeof answer === 'function') return Promise.resolve().then(() => answer(body));
    if (answer instanceof Error) return Promise.reject(answer);
    if (answer) return Promise.resolve(answer);
    if (body.action === 'templates') return Promise.resolve({ templates: [INVITE, ACCEPTED] });
    return Promise.reject(new Error(`unexpected ${body.action}`));
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminSpeakerMail />
    </MemoryRouter>,
  );
}

async function invitationForm() {
  return within(await screen.findByRole('form', { name: 'Invitation wording' }));
}

beforeEach(() => {
  callMock.mockReset();
});

describe('speaker email wording', () => {
  it('shows both messages with labelled fields, their tokens, and the shipped state', async () => {
    serve();
    renderPage();
    const invite = await invitationForm();
    expect(invite.getByLabelText('Subject')).toHaveValue(INVITE.shipped.subject);
    expect(invite.getByLabelText('HTML body')).toHaveValue(INVITE.shipped.html);
    expect(invite.getByLabelText('Plain text body')).toHaveValue(INVITE.shipped.text);
    expect(invite.getByText('The shipped wording is in use.')).toBeInTheDocument();
    expect(invite.getByText('{{speaker_name}} {{invite_url}} {{invite_type}} {{admin_contact_email}}')).toBeInTheDocument();
    expect(invite.queryByRole('button', { name: 'Use the shipped wording' })).toBeNull();
    const accepted = within(screen.getByRole('form', { name: 'Acceptance confirmation wording' }));
    expect(accepted.getByLabelText('Subject')).toHaveValue(ACCEPTED.shipped.subject);
  });

  it('marks the field the server refused for an unknown token, moves focus there, and stores nothing', async () => {
    serve({
      saveTemplate: new AdminApiError({ code: 'bad-request', status: 400, message: 'text: unknown token {{nope}}' }),
    });
    renderPage();
    const invite = await invitationForm();
    fireEvent.change(invite.getByLabelText('Plain text body'), { target: { value: '{{invite_url}} {{nope}}' } });
    fireEvent.click(invite.getByRole('button', { name: 'Save wording' }));
    const alert = await invite.findByRole('alert');
    expect(alert).toHaveTextContent('text: unknown token {{nope}}');
    const field = invite.getByLabelText('Plain text body');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(field).toHaveFocus());
    expect(callMock).toHaveBeenCalledWith('speakerMailTemplates', {
      action: 'saveTemplate', templateId: 'speaker.invite', subject: INVITE.shipped.subject, html: INVITE.shipped.html, text: '{{invite_url}} {{nope}}',
    });
  });

  it('saves the wording, says the next email uses it, and offers the shipped wording back', async () => {
    serve({
      saveTemplate: (body) => ({ template: saved(INVITE, { subject: body.subject }) }),
      resetTemplate: { template: INVITE },
    });
    renderPage();
    const invite = await invitationForm();
    fireEvent.change(invite.getByLabelText('Subject'), { target: { value: 'Join us at {{event_name}}' } });
    expect(invite.getByText(/The form has changes that are not saved\./)).toBeInTheDocument();
    fireEvent.click(invite.getByRole('button', { name: 'Save wording' }));
    expect(await invite.findByRole('status')).toHaveTextContent('Invitation wording saved. The next email uses it.');
    expect(invite.getByText(/Saved wording is in use, last changed Oct 20, 2026, 12:00 PM \(UTC\) by staff@example\.test\./)).toBeInTheDocument();
    expect(invite.getByLabelText('Subject')).toHaveValue('Join us at {{event_name}}');

    fireEvent.click(invite.getByRole('button', { name: 'Use the shipped wording' }));
    const confirm = invite.getByRole('region', { name: 'Use the shipped invitation wording' });
    expect(confirm).toHaveTextContent('The saved wording is deleted and every later invitation email uses the shipped wording.');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Delete the saved wording' }));
    expect(await invite.findByText('Invitation uses the shipped wording again.')).toBeInTheDocument();
    expect(invite.getByLabelText('Subject')).toHaveValue(INVITE.shipped.subject);
    expect(callMock).toHaveBeenCalledWith('speakerMailTemplates', { action: 'resetTemplate', templateId: 'speaker.invite' });
  });

  it('previews the form wording with the exact subject, html and text the server rendered', async () => {
    serve({
      preview: (body) => ({
        preview: {
          id: body.templateId,
          source: 'draft',
          usedFallback: false,
          problems: [],
          warnings: [],
          subject: 'Join us at Example Event',
          html: '<p>Dear Sample Speaker</p>',
          text: 'Dear Sample Speaker\n\n--\nExample Org',
        },
      }),
    });
    renderPage();
    const invite = await invitationForm();
    fireEvent.change(invite.getByLabelText('Subject'), { target: { value: 'Join us at {{event_name}}' } });
    fireEvent.click(invite.getByRole('button', { name: 'Preview' }));
    const region = await screen.findByRole('region', { name: 'Invitation preview' });
    expect(within(region).getByTestId('mail-preview-subject')).toHaveTextContent('Join us at Example Event');
    expect(within(region).getByText('The wording in the form, not saved')).toBeInTheDocument();
    expect(within(region).getByTestId('mail-preview-text').textContent).toBe('Dear Sample Speaker\n\n--\nExample Org');
    expect(within(region).getByTitle('Invitation preview, HTML version')).toHaveAttribute('sandbox', '');
    expect(invite.getByRole('status')).toHaveTextContent('Preview ready. It shows the wording in the form, not saved.');
    expect(callMock).toHaveBeenCalledWith('speakerMailTemplates', expect.objectContaining({
      action: 'preview', templateId: 'speaker.invite', subject: 'Join us at {{event_name}}',
    }));

    // A change to the words clears a preview of other words.
    fireEvent.change(invite.getByLabelText('Subject'), { target: { value: 'Other' } });
    expect(screen.queryByRole('region', { name: 'Invitation preview' })).toBeNull();
  });

  it('says when saved wording fails its check and speakers get the shipped wording', async () => {
    serve({
      templates: {
        templates: [{ ...saved(INVITE, { text: 'No link.' }), savedErrors: ['text: missing required token {{invite_url}}'] }, ACCEPTED],
      },
    });
    renderPage();
    const invite = await invitationForm();
    expect(invite.getByText(/The saved wording fails its check, so speakers get the shipped wording: text: missing required token/)).toBeInTheDocument();
  });

  it('copies the shipped wording into the form without saving', async () => {
    serve({ templates: { templates: [saved(INVITE, { subject: 'Saved {{event_name}}' }), ACCEPTED] } });
    renderPage();
    const invite = await invitationForm();
    expect(invite.getByLabelText('Subject')).toHaveValue('Saved {{event_name}}');
    fireEvent.click(invite.getByText('Shipped wording'));
    fireEvent.click(invite.getByRole('button', { name: 'Copy the shipped wording into the form' }));
    expect(invite.getByLabelText('Subject')).toHaveValue(INVITE.shipped.subject);
    expect(callMock).toHaveBeenCalledTimes(1);
  });

  it('shows a load failure', async () => {
    serve({ templates: new Error('Admin access required.') });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required.');
  });
});
