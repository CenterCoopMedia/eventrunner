import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

let authUser;
const listMaterials = vi.fn();
const addLink = vi.fn();
const uploadFile = vi.fn();
const updateMaterial = vi.fn();

vi.mock('../../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ user: authUser }),
}));

vi.mock('../../lib/speakerMaterialsApi.js', () => ({
  listSpeakerSessionMaterials: (...args) => listMaterials(...args),
  addSpeakerMaterialLink: (...args) => addLink(...args),
  uploadSpeakerMaterialFile: (...args) => uploadFile(...args),
  updateSpeakerMaterial: (...args) => updateMaterial(...args),
}));

const { default: SpeakerSessionMaterials } = await import('./SpeakerSessionMaterials.jsx');

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  authUser = { uid: 'account-one', getIdToken: vi.fn(async () => 'token') };
  listMaterials.mockReset().mockResolvedValue([]);
  addLink.mockReset().mockResolvedValue({ id: 'new-link' });
  uploadFile.mockReset().mockResolvedValue({ id: 'new-file' });
  updateMaterial.mockReset().mockResolvedValue({});
});

describe('SpeakerSessionMaterials', () => {
  it('lists review state and locks reviewed and co-speaker items', async () => {
    listMaterials.mockResolvedValueOnce([
      {
        id: 'pending-own', type: 'link', filename: 'Draft deck', url: 'https://example.org/draft',
        reviewStatus: 'pending', submittedBySpeakerId: 'speaker-one',
      },
      {
        id: 'approved-own', type: 'file', filename: 'Handout.pdf',
        reviewStatus: 'approved', submittedBySpeakerId: 'speaker-one',
      },
      {
        id: 'pending-other', type: 'link', filename: 'Session notes', url: 'https://example.org/notes',
        reviewStatus: 'pending', submittedBySpeakerId: null,
      },
    ]);

    render(<SpeakerSessionMaterials sessionId="session-one" speakerId="speaker-one" />);

    expect(await screen.findByText('Draft deck')).toBeInTheDocument();
    expect(screen.getByText('Handout.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('Awaiting review')).toHaveLength(2);
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/organizer has reviewed this item/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getAllByText(/Submitted for this session/i)).toHaveLength(1);
  });

  it('adds a link and uploads a synthetic file to the selected own session', async () => {
    const onMaterialsChanged = vi.fn();
    render(<SpeakerSessionMaterials sessionId="session-one" speakerId="speaker-one" onMaterialsChanged={onMaterialsChanged} />);
    await screen.findByText(/No materials have been sent/i);

    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: 'https://example.org/slides' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Slides' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
    await waitFor(() => expect(addLink).toHaveBeenCalledWith({
      user: authUser,
      sessionId: 'session-one',
      url: 'https://example.org/slides',
      label: 'Slides',
    }));
    expect(await screen.findByText('Link sent for organizer review.')).toBeInTheDocument();

    const file = new File(['synthetic handout'], 'handout.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.submit(screen.getByRole('button', { name: 'Upload file' }).closest('form'));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledWith({
      user: authUser,
      sessionId: 'session-one',
      file,
    }));
    expect(await screen.findByText('File sent for organizer review.')).toBeInTheDocument();
    expect(onMaterialsChanged).toHaveBeenCalledTimes(2);
  });

  it('shows a server refusal for a foreign session', async () => {
    addLink.mockRejectedValueOnce(new Error('You do not have permission to change this material.'));
    const onMaterialsChanged = vi.fn();
    render(<SpeakerSessionMaterials sessionId="foreign-session" speakerId="speaker-one" onMaterialsChanged={onMaterialsChanged} />);
    await screen.findByText(/No materials have been sent/i);

    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: 'https://example.org/slides' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send link' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not have permission/i);
    expect(onMaterialsChanged).not.toHaveBeenCalled();
  });

  it('edits an own pending item and surfaces a reviewed-item race from the server', async () => {
    listMaterials.mockResolvedValueOnce([{
      id: 'pending-own', type: 'link', filename: 'Draft deck', url: 'https://example.org/draft',
      reviewStatus: 'pending', submittedBySpeakerId: 'speaker-one',
    }]);
    updateMaterial.mockRejectedValueOnce(
      new Error('This material has already been reviewed; ask an admin to change it.'),
    );
    render(<SpeakerSessionMaterials sessionId="session-one" speakerId="speaker-one" />);
    await screen.findByText('Draft deck');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('button', { name: 'Save changes' }).closest('form');
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Display name' }), {
      target: { value: 'Updated deck' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already been reviewed/i);
  });

  it('discards a stale material list when the account and session change', async () => {
    const first = deferred();
    const second = deferred();
    listMaterials.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(
      <SpeakerSessionMaterials sessionId="session-one" speakerId="speaker-one" />,
    );

    authUser = { uid: 'account-two', getIdToken: vi.fn(async () => 'other-token') };
    rerender(<SpeakerSessionMaterials sessionId="session-two" speakerId="speaker-two" />);
    second.resolve([{
      id: 'second', type: 'file', filename: 'Current handout', reviewStatus: 'pending',
      submittedBySpeakerId: 'speaker-two',
    }]);
    expect(await screen.findByText('Current handout')).toBeInTheDocument();

    first.resolve([{
      id: 'first', type: 'file', filename: 'Stale handout', reviewStatus: 'pending',
      submittedBySpeakerId: 'speaker-one',
    }]);
    await waitFor(() => expect(screen.queryByText('Stale handout')).toBeNull());
    expect(screen.getByText('Current handout')).toBeInTheDocument();
  });
});
