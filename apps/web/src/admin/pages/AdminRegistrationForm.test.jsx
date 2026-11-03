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

describe('AdminRegistrationForm', () => {
  it('loads the saved form into the editor and the preview', async () => {
    await renderPage();
    expect(screen.getByText('Revision 2')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ask: Organization' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Required: Organization' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Required: Job title' })).toBeDisabled();
    expect(preview().getByLabelText('Organization (required)')).toBeInTheDocument();
    expect(preview().getByRole('group', { name: 'T-shirt size' })).toBeInTheDocument();
    expect(preview().queryByLabelText(/Job title/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save registration form' })).toBeDisabled();
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
    fireEvent.change(screen.getByLabelText('Choices'), { target: { value: 'Only one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save registration form' }));
    // In the summary, and on the field it names.
    expect((await screen.findAllByText(/custom\.0\.label: required/)).length).toBe(2);
    expect(screen.getAllByText(/custom\.0\.choices: add at least two choices/).length).toBe(2);
    expect(callMock).not.toHaveBeenCalled();
  });

  it('saves the form with the revision it loaded, with choices one per line', async () => {
    callMock.mockResolvedValue({ revision: 3 });
    await renderPage();
    fireEvent.change(screen.getByLabelText('Choices'), { target: { value: 'S\n M \n\nL' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save registration form' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledTimes(1));
    const [name, body] = callMock.mock.calls[0];
    expect(name).toBe('updateRegistrationForm');
    expect(body.expectedRevision).toBe(2);
    expect(body.form.custom[0]).toEqual({ id: 'q_shirt', kind: 'one_choice', label: 'T-shirt size', help: '', choices: ['S', 'M', 'L'], required: false });
    expect(body.form.standard.organization).toEqual({ enabled: true, required: true });
    expect(await screen.findByText('Registration form saved. New registrations use it now.')).toBeInTheDocument();
  });

  it('stops a save when someone else saved first, and keeps the edits until the current version is loaded', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ask: Job title' }));
    await act(async () => { pushForm({ ...SAVED, revision: 3 }); });
    expect(screen.getByText(/Someone saved the registration form after you opened it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save registration form' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Ask: Job title' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Load the current version' }));
    expect(screen.getByText('Revision 3')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Ask: Job title' })).not.toBeChecked();
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
