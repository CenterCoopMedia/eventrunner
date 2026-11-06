// The registration form editor (ADR 0008 §4): the standard set, custom
// questions, the shared check before a save, the revision guard, and the
// attendee preview of the unsaved form.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const callMock = vi.fn();
vi.mock('../adminApi.js', async (importOriginal) => ({
  ...(await importOriginal()),
  useAdminApi: () => callMock,
}));
let pushForm;
vi.mock('../../lib/registrationFormSource.js', () => ({
  subscribeRegistrationForm: (onNext) => { pushForm = onNext; return () => {}; },
}));

import AdminRegistrationForm from './AdminRegistrationForm.jsx';

const SAVED = {
  revision: 2,
  standard: { organization: { enabled: true, required: true }, dietary: { enabled: true, required: false } },
  custom: [{ id: 'q_shirt', kind: 'one_choice', label: 'T-shirt size', help: '', choices: ['S', 'M'], required: false }],
};

async function renderPage(stored = SAVED) {
  render(<AdminRegistrationForm />);
  await act(async () => { pushForm(stored); });
}
const preview = () => within(screen.getByRole('region', { name: "Preview of the attendee's questions" }));

beforeEach(() => {
  callMock.mockReset();
});

function addChoice(value) {
  const box = screen.getByLabelText('Choices');
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

describe('AdminRegistrationForm', () => {
  it('loads the saved form into the editor and the preview', async () => {
    await renderPage();
    expect(screen.queryByText(/Revision/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ask: Organization' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Required: Organization' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Required: Job title' })).toBeDisabled();
    expect(preview().getByLabelText('Organization (required)')).toBeInTheDocument();
    expect(preview().getByRole('group', { name: 'T-shirt size' })).toBeInTheDocument();
    expect(preview().queryByLabelText(/Job title/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a change in the preview at once, before it is saved', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask: Job title' }));
    expect(preview().getByLabelText('Job title')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    const added = screen.getAllByRole('textbox', { name: /^Question/ }).at(-1);
    fireEvent.change(added, { target: { value: 'Badge name' } });
    expect(preview().getByLabelText('Badge name')).toBeInTheDocument();
  });

  it('names a mistake on its field without calling the server', async () => {
    await renderPage({ ...SAVED, custom: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Add a question' }));
    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'one_choice' } });
    addChoice('Only one');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // In the summary, and on the field it names.
    expect((await screen.findAllByText(/Question 1: Enter a question\./)).length).toBe(2);
    expect(screen.getAllByText(/Question 1: Add at least two choices/).length).toBe(2);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('saves the form with the revision it loaded, with choices one per line', async () => {
    callMock.mockResolvedValue({ revision: 3 });
    await renderPage();
    addChoice('S');
    addChoice(' M ');
    addChoice('L');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    const [name, body] = callMock.mock.calls[0];
    expect(name).toBe('updateRegistrationForm');
    expect(body.expectedRevision).toBe(2);
    expect(body.form.custom[0]).toEqual({ id: 'q_shirt', kind: 'one_choice', label: 'T-shirt size', help: '', choices: ['S', 'M', 'L'], required: false });
    expect(body.form.standard.organization).toEqual({ enabled: true, required: true });
    expect(await screen.findByText('Registration form saved.')).toBeInTheDocument();
  });

  it('stops a save when someone else saved first, and keeps the edits until the current version is loaded', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask: Job title' }));
    await act(async () => { pushForm({ ...SAVED, revision: 3 }); });
    expect(screen.getByText(/Someone saved the registration form after you opened it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Ask: Job title' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Load the current version' }));
    expect(screen.queryByText(/Someone saved the registration form after you opened it/)).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Ask: Job title' })).not.toBeChecked();
  });

  it('never saves the form when Enter is pressed in a preview answer', async () => {
    callMock.mockResolvedValue({ revision: 3 });
    await renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask: Job title' }));
    const answer = preview().getByLabelText('Organization (required)');
    expect(answer.closest('form')).toBeNull();
    fireEvent.submit(answer);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('gives a saved question a new id when its answer type changes, so old answers keep their meaning', async () => {
    callMock.mockResolvedValue({ revision: 3 });
    await renderPage();
    fireEvent.change(screen.getByLabelText('Answer type'), { target: { value: 'short_text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    const [question] = callMock.mock.calls[0][1].form.custom;
    expect(question.kind).toBe('short_text');
    expect(question.id).not.toBe('q_shirt');
    expect(question.id).toMatch(/^q_[a-z0-9]{8}$/);
  });

  it('runs the shared answer check in the preview', async () => {
    await renderPage();
    fireEvent.click(preview().getByRole('button', { name: 'Check answers' }));
    expect(preview().getByText('Answer this question.')).toBeInTheDocument();
    fireEvent.change(preview().getByLabelText('Organization (required)'), { target: { value: 'Example News' } });
    fireEvent.click(preview().getByRole('button', { name: 'Check answers' }));
    expect(preview().getByText('These answers pass. An attendee could continue.')).toBeInTheDocument();
  });
});
