// The speaker headshot field (issue #22) — the wizard's counterpart to
// ProfilePhotoField, uploading through speakerPhotoUpload (server-authorized;
// speaker-photos/ is `write: if false` in storage.rules) instead of a direct
// Storage SDK PUT.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const uploadSpeakerPhotoMock = vi.fn(async ({ speakerId }) => ({
  path: `speaker-photos/${speakerId}/photo.png`,
}));
vi.mock('../../lib/speakerProfileApi.js', async () => {
  const actual = await vi.importActual('../../lib/speakerProfileApi.js');
  return {
    ...actual,
    uploadSpeakerPhoto: (...args) => uploadSpeakerPhotoMock(...args),
  };
});

const { default: SpeakerPhotoField } = await import('./SpeakerPhotoField.jsx');

const user = { getIdToken: async () => 't' };

beforeEach(() => {
  uploadSpeakerPhotoMock.mockClear();
});

function pick(file) {
  fireEvent.change(screen.getByLabelText(/Upload a photo|Replace photo/), {
    target: { files: [file] },
  });
}

describe('SpeakerPhotoField', () => {
  it('renders the placeholder as a square portrait on the brand radius, never a circle', () => {
    render(<SpeakerPhotoField user={user} speakerId="rae" value="" onChange={vi.fn()} />);
    const stub = screen.getByText('None');
    expect(stub).toHaveClass('rounded-brand');
    expect(stub).not.toHaveClass('rounded-full');
  });

  it('renders an uploaded photo as a square portrait on the brand radius', () => {
    render(
      <SpeakerPhotoField
        user={user}
        speakerId="rae"
        value="speaker-photos/rae/photo.png"
        onChange={vi.fn()}
      />,
    );
    const image = screen.getByAltText('Your current speaker photo');
    expect(image).toHaveClass('rounded-brand');
    expect(image).not.toHaveClass('rounded-full');
  });

  it('uploads to the speaker’s own folder through speakerPhotoUpload and reports the path', async () => {
    const onChange = vi.fn();
    render(<SpeakerPhotoField user={user} speakerId="rae" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.png', { type: 'image/png' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(uploadSpeakerPhotoMock.mock.calls[0][0]).toMatchObject({ user, speakerId: 'rae' });
    expect(onChange).toHaveBeenCalledWith('speaker-photos/rae/photo.png');
  });

  it('refuses a type the endpoint refuses, without calling the upload', async () => {
    const onChange = vi.fn();
    render(<SpeakerPhotoField user={user} speakerId="rae" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.svg', { type: 'image/svg+xml' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/PNG, JPEG, WEBP/);
    expect(uploadSpeakerPhotoMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the path on remove without calling the upload endpoint', () => {
    const onChange = vi.fn();
    render(
      <SpeakerPhotoField user={user} speakerId="rae" value="speaker-photos/rae/photo.png" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('reports a failed upload rather than pretending it worked', async () => {
    uploadSpeakerPhotoMock.mockRejectedValueOnce(new Error('You may only upload a photo for your own speaker profile.'));
    const onChange = vi.fn();
    render(<SpeakerPhotoField user={user} speakerId="rae" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/own speaker profile/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
