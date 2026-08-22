// The attendee photo field: the one client-side upload in the product.
//
// Pinned here: it uploads to the owner's own prefix through the Storage SDK
// (not the admin endpoints), it refuses a file storage.rules would refuse
// before spending the upload — including one of EXACTLY the cap, since the
// rule is a strict `<` — it reports the PATH upward so the profile save
// writes `photoPath`, and it never deletes an object itself (Profile.jsx
// does that after the save commits, so an abandoned edit cannot leave the
// directory pointing at a deleted object).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const uploadBytes = vi.fn(async () => ({}));
const deleteObject = vi.fn(async () => {});

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_storage, path) => ({ path })),
  uploadBytes: (...args) => uploadBytes(...args),
  deleteObject: (...args) => deleteObject(...args),
  getDownloadURL: vi.fn(async ({ path }) => `https://example.test/${path}`),
}));

const { default: ProfilePhotoField } = await import('./ProfilePhotoField.jsx');

beforeEach(() => {
  uploadBytes.mockClear();
  deleteObject.mockClear();
});

function pick(file) {
  fireEvent.change(screen.getByLabelText(/Upload a photo|Replace photo/), {
    target: { files: [file] },
  });
}

describe('ProfilePhotoField', () => {
  it('uploads to the signed-in user’s own prefix and reports the path', async () => {
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.png', { type: 'image/png' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(uploadBytes.mock.calls[0][0]).toEqual({ path: 'profile-photos/attendee-1/photo.png' });
    expect(onChange).toHaveBeenCalledWith('profile-photos/attendee-1/photo.png');
  });

  it('refuses a type the rules refuse, without uploading', async () => {
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.svg', { type: 'image/svg+xml' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/PNG, JPEG, WEBP/);
    expect(uploadBytes).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a file over the 2 MiB cap, without uploading', async () => {
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    const big = new File([''], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    pick(big);

    expect(await screen.findByRole('alert')).toHaveTextContent(/limit is under 2\.0 MB/);
    expect(uploadBytes).not.toHaveBeenCalled();
  });

  it('refuses a file of exactly 2 MiB — the rule is a strict less-than', async () => {
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={vi.fn()} />);
    const exact = new File([''], 'exact.png', { type: 'image/png' });
    Object.defineProperty(exact, 'size', { value: 2 * 1024 * 1024 });
    pick(exact);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(uploadBytes).not.toHaveBeenCalled();
  });

  it('clears the path on remove but deletes nothing before the save', async () => {
    const onChange = vi.fn();
    render(
      <ProfilePhotoField
        uid="attendee-1"
        value="profile-photos/attendee-1/photo.png"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(onChange).toHaveBeenCalledWith('');
    // Deleting here would strand the stored profile and its users_public
    // projection on a deleted object whenever the edit is abandoned.
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('reports a failed upload rather than pretending it worked', async () => {
    uploadBytes.mockRejectedValueOnce(new Error('permission denied'));
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be uploaded/);
    expect(onChange).not.toHaveBeenCalled();
  });
});
