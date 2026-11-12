// The speaker email wording page (functions/src/speakers/mailTemplates.cjs).
// Mocks adminApi directly, as AdminSpeakerReminders.test.jsx does: the
// endpoint is the only data source, and every preview renders on the server.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  editor: {
    kind: 'plain',
    fields: {
      subject: 'You are invited to speak at {{event_name}}',
      greeting: 'Hi {{speaker_name}},',
      invitation: 'You are invited to take part in {{event_name}}.',
      signInInstructions: 'Sign in to connect this invitation to your account.',
      buttonLabel: 'Accept your invitation',
      backupLinkInstructions: 'If the button does not work, paste this address into your browser:',
      contactInstructions: 'Questions? Write to',
    },
  },
  tokens: ['speaker_name', 'invite_url', 'invite_type', 'admin_contact_email'],
  globalTokens: ['event_name'],
  requiredTokens: ['invite_url'],
};
const ACCEPTED = {
  id: 'speaker.accepted',
  shipped: { subject: 'You are confirmed for {{event_name}}', html: '<p>{{profile_wizard_url}}</p>', text: '{{profile_wizard_url}}' },
  saved: null,
  savedErrors: [],
  editor: {
    kind: 'plain',
    fields: {
      subject: 'You are confirmed for {{event_name}}',
      greeting: 'Hi {{speaker_name}},',
      confirmation: 'Your place is confirmed.',
      profileInstructions: 'Write your speaker profile:',
      buttonLabel: 'Write your speaker profile',
      reviewNote: 'An organizer reviews it before publication.',
    },
  },
  tokens: ['speaker_name', 'profile_wizard_url', 'deadline'],
  globalTokens: ['event_name'],
  requiredTokens: ['profile_wizard_url'],
};

function saved(entry, fields) {
  return {
    ...entry,
    saved: { ...entry.shipped, subject: fields.subject, updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: 'staff@example.test' },
    editor: { kind: 'plain', fields: { ...entry.editor.fields, ...fields } },
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
    expect(invite.getByLabelText('Greeting')).toHaveValue(INVITE.editor.fields.greeting);
    expect(invite.getByLabelText('Button label')).toHaveValue(INVITE.editor.fields.buttonLabel);
    expect(invite.queryByLabelText('HTML body')).toBeNull();
    expect(invite.queryByLabelText('Plain text body')).toBeNull();
    expect(invite.getByText('The shipped wording is in use.')).toBeInTheDocument();
    expect(invite.getByText('{{speaker_name}} {{invite_url}} {{invite_type}} {{admin_contact_email}}')).toBeInTheDocument();
    expect(invite.queryByRole('button', { name: 'Use the shipped wording' })).toBeNull();
    const accepted = within(screen.getByRole('form', { name: 'Acceptance confirmation wording' }));
    expect(accepted.getByLabelText('Subject')).toHaveValue(ACCEPTED.shipped.subject);
  });

  it('marks the field the server refused for an unknown token, moves focus there, and stores nothing', async () => {
    serve({
      saveTemplate: new AdminApiError({ code: 'bad-request', status: 400, message: 'invitation: unknown token {{nope}}' }),
    });
    renderPage();
    const invite = await invitationForm();
    fireEvent.change(invite.getByLabelText('Invitation'), { target: { value: 'Join us at {{event_name}} {{nope}}' } });
    fireEvent.click(invite.getByRole('button', { name: 'Save wording' }));
    const alert = await invite.findByRole('alert');
    expect(alert).toHaveTextContent('invitation: unknown token {{nope}}');
    const field = invite.getByLabelText('Invitation');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(field).toHaveFocus());
    expect(callMock).toHaveBeenCalledWith('speakerMailTemplates', {
      action: 'saveTemplate',
      templateId: 'speaker.invite',
      fields: { ...INVITE.editor.fields, invitation: 'Join us at {{event_name}} {{nope}}' },
    });
  });

  it('saves the wording, says the next email uses it, and offers the shipped wording back', async () => {
    serve({
      saveTemplate: (body) => ({ template: saved(INVITE, body.fields) }),
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

  it('keeps the submitted fields fixed while a save is in flight', async () => {
    let finish;
    serve({ saveTemplate: () => new Promise((resolve) => { finish = resolve; }) });
    renderPage();
    const invite = await invitationForm();
    const subject = invite.getByLabelText('Subject');
    fireEvent.change(subject, { target: { value: 'Join {{event_name}}' } });
    fireEvent.click(invite.getByRole('button', { name: 'Save wording' }));
    await waitFor(() => expect(subject).toBeDisabled());
    await act(async () => finish({ template: saved(INVITE, { subject: 'Join {{event_name}}' }) }));
    expect(subject).not.toBeDisabled();
    expect(subject).toHaveValue('Join {{event_name}}');
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
    expect(callMock).toHaveBeenCalledWith('speakerMailTemplates', {
      action: 'preview',
      templateId: 'speaker.invite',
      fields: { ...INVITE.editor.fields, subject: 'Join us at {{event_name}}' },
    });

    // A change to the words clears a preview of other words.
    fireEvent.change(invite.getByLabelText('Subject'), { target: { value: 'Other' } });
    expect(screen.queryByRole('region', { name: 'Invitation preview' })).toBeNull();
  });

  it('previews unchanged words as the wording in use, without sending them', async () => {
    serve({
      templates: { templates: [saved(INVITE, { subject: 'Saved {{event_name}}' }), ACCEPTED] },
      preview: {
        preview: {
          id: 'speaker.invite', source: 'saved', usedFallback: false, problems: [], warnings: [],
          subject: 'Saved Example Event', html: '<p>x</p>', text: 'x',
        },
      },
    });
    renderPage();
    const invite = await invitationForm();
    fireEvent.click(invite.getByRole('button', { name: 'Preview' }));
    const region = await screen.findByRole('region', { name: 'Invitation preview' });
    expect(within(region).getByText('The saved wording')).toBeInTheDocument();
    expect(callMock).toHaveBeenLastCalledWith('speakerMailTemplates', { action: 'preview', templateId: 'speaker.invite' });
  });

  it('says when saved wording fails its check and speakers get the shipped wording', async () => {
    serve({
      templates: {
        templates: [{
          ...INVITE,
          saved: { ...INVITE.shipped, text: 'No link.', updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: 'staff@example.test' },
          savedErrors: ['text: missing required token {{invite_url}}'],
          editor: { kind: 'unsupported', reason: 'The saved wording changes the email structure. Use the shipped wording before you edit these fields.' },
        }, ACCEPTED],
      },
    });
    renderPage();
    const invite = await invitationForm();
    expect(invite.getByText(/The saved wording fails its check, so speakers get the shipped wording: text: missing required token/)).toBeInTheDocument();
    expect(invite.getByText(/changes the email structure/)).toBeInTheDocument();
    expect(invite.queryByRole('button', { name: 'Save wording' })).toBeNull();
    expect(invite.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(invite.getByRole('button', { name: 'Use the shipped wording' })).toBeInTheDocument();
  });

  it('keeps a valid custom structure read-only until staff reset it', async () => {
    const custom = {
      ...INVITE,
      saved: { ...INVITE.shipped, updatedAt: '2026-10-20T12:00:00.000Z', updatedBy: 'staff@example.test' },
      editor: { kind: 'unsupported', reason: 'The saved wording changes the email structure. Use the shipped wording before you edit these fields.' },
    };
    serve({
      templates: { templates: [custom, ACCEPTED] },
      preview: {
        preview: {
          id: 'speaker.invite', source: 'saved', usedFallback: false, problems: [], warnings: [],
          subject: 'Custom invitation', html: '<p>Custom</p>', text: 'Custom',
        },
      },
      resetTemplate: { template: INVITE },
    });
    renderPage();
    const invite = await invitationForm();
    expect(invite.queryByLabelText('Subject')).toBeNull();
    fireEvent.click(invite.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByRole('region', { name: 'Invitation preview' })).toHaveTextContent('Custom invitation');
    fireEvent.click(invite.getByRole('button', { name: 'Use the shipped wording' }));
    fireEvent.click(within(invite.getByRole('region', { name: 'Use the shipped invitation wording' })).getByRole('button', { name: 'Delete the saved wording' }));
    expect(await invite.findByLabelText('Subject')).toHaveValue(INVITE.editor.fields.subject);
  });

  it('shows a load failure', async () => {
    serve({ templates: new Error('Admin access required.') });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required.');
  });
});
