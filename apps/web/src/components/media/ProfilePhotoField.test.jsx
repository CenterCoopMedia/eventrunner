// A cropped photo stays local until the profile save commits it through the
// authenticated upload endpoint. A second commit reuses the returned path;
// rollback deletes the staged object. The client rejects invalid files early.
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { chooseAndApplyCrop, installPhotoCropStubs, uninstallPhotoCropStubs } from '../../test/photoCropStubs.js';
import { BRAND_UTILITY_PREFIX } from '../../test/retiredUtilityNames.js';
import { auth } from '../../firebase.js';

const uploadRequest = vi.fn();
const deleteObject = vi.fn(async () => {});

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  connectStorageEmulator: vi.fn(),
  ref: vi.fn((_storage, path) => ({ path })),
  deleteObject: (...args) => deleteObject(...args),
  getDownloadURL: vi.fn(async ({ path }) => `https://example.test/${path}`),
}));

const { default: ProfilePhotoField } = await import('./ProfilePhotoField.jsx');

beforeEach(() => {
  uploadRequest.mockReset();
  uploadRequest.mockImplementation(async () => ({
    ok: true,
    json: async () => ({ path: `profile-photos/attendee-1/server-${uploadRequest.mock.calls.length}/photo.webp` }),
  }));
  vi.stubGlobal('fetch', uploadRequest);
  vi.stubEnv('VITE_FUNCTIONS_ORIGIN', 'https://functions.example.test');
  auth.currentUser = { uid: 'attendee-1', getIdToken: vi.fn(async () => 'test-id-token') };
  deleteObject.mockClear();
  installPhotoCropStubs();
});

afterEach(() => {
  delete auth.currentUser;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  uninstallPhotoCropStubs();
});

function pick(file) {
  fireEvent.change(screen.getByLabelText(/Upload a photo|Replace photo/), {
    target: { files: [file] },
  });
}

describe('ProfilePhotoField', () => {
  it('renders the placeholder as a square portrait on the brand radius, never a circle', () => {
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={vi.fn()} />);
    // The picker's "None" radio also says None; the placeholder is the bare
    // dashed span.
    const stub = screen.getAllByText('None').find((node) => node.className.includes('rounded-brand'));
    expect(stub).toBeTruthy();
    expect(stub).toHaveClass('rounded-brand');
    expect(stub).not.toHaveClass('rounded-full');
  });

  it('renders an uploaded photo as a square portrait on the brand radius', () => {
    render(
      <ProfilePhotoField
        uid="attendee-1"
        value="profile-photos/attendee-1/photo.png"
        onChange={vi.fn()}
      />,
    );
    const image = screen.getByAltText('Your current profile photo');
    expect(image).toHaveClass('rounded-brand');
    expect(image).not.toHaveClass('rounded-full');
  });

  it('reads the tier 2 role tokens, not the old compatibility names (issue 247)', () => {
    render(
      <ProfilePhotoField
        uid="attendee-1"
        value="profile-photos/attendee-1/photo.png"
        onChange={vi.fn()}
      />,
    );
    const image = screen.getByAltText('Your current profile photo');
    expect(image).toHaveClass('bg-surface-alt');
    expect(image.className).not.toMatch(BRAND_UTILITY_PREFIX);
    const upload = screen.getByText('Replace photo');
    expect(upload).toHaveClass('bg-surface');
    expect(upload).toHaveClass('text-text-primary');
    expect(upload).toHaveClass('border-text-primary/20');
    expect(upload.className).not.toMatch(BRAND_UTILITY_PREFIX);
  });

  it('draws a visible ring on the label when the hidden file input has keyboard focus', () => {
    // The real <input type="file"> stays keyboard-operable but is visually
    // hidden (sr-only); the label immediately after it in the markup is
    // what carries the ring — index.css's
    // `.file-input-label:has(+ input:focus-visible)` rule reads this class.
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={vi.fn()} />);
    const label = screen.getByText('Upload a photo');
    expect(label.tagName).toBe('LABEL');
    expect(label).toHaveClass('file-input-label');
  });

  it('keeps a cropped photo local until the save commits it', async () => {
    const onChange = vi.fn();
    const ref = createRef();
    render(<ProfilePhotoField ref={ref} uid="attendee-1" value="" onChange={onChange} />);
    await chooseAndApplyCrop(new File(['x'], 'me.png', { type: 'image/png' }), /your profile photo/);

    expect(screen.getByAltText('Your new profile photo')).toBeInTheDocument();
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current.hasPending()).toBe(true);

    const first = await ref.current.commit();
    expect(first).toBe('profile-photos/attendee-1/server-1/photo.webp');
    expect(uploadRequest).toHaveBeenCalledWith('https://functions.example.test/profilePhotoUpload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-id-token' },
      body: JSON.stringify({ data: 'Y3JvcA==' }),
    });
    expect(first).not.toBe('profile-photos/attendee-1/photo.png');
    expect(onChange).toHaveBeenCalledWith(first);
    expect(ref.current.hasPending()).toBe(true);

    const second = await ref.current.commit();
    expect(second).toBe(first);
    expect(uploadRequest).toHaveBeenCalledTimes(1);

    ref.current.release();
    expect(ref.current.hasPending()).toBe(false);
  });

  it('refuses an unsupported type, without uploading', async () => {
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.svg', { type: 'image/svg+xml' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/PNG, JPEG, WEBP/);
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('refuses a file over the 2 MiB cap, without uploading', async () => {
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    const big = new File([''], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 });
    pick(big);

    expect(await screen.findByRole('alert')).toHaveTextContent(/limit is under 2\.0 MB/);
    expect(uploadRequest).not.toHaveBeenCalled();
  });

  it('refuses a file of exactly 2 MiB — the endpoint uses a strict less-than', async () => {
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={vi.fn()} />);
    const exact = new File([''], 'exact.png', { type: 'image/png' });
    Object.defineProperty(exact, 'size', { value: 2 * 1024 * 1024 });
    pick(exact);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(uploadRequest).not.toHaveBeenCalled();
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
    uploadRequest.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'forbidden', message: 'permission denied' } }),
    });
    const onChange = vi.fn();
    const ref = createRef();
    render(<ProfilePhotoField ref={ref} uid="attendee-1" value="" onChange={onChange} />);
    await chooseAndApplyCrop(new File(['x'], 'me.png', { type: 'image/png' }), /your profile photo/);

    await expect(ref.current.commit()).rejects.toThrow(/permission denied/);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be uploaded/);
    expect(onChange).not.toHaveBeenCalled();
    expect(ref.current.hasPending()).toBe(true);
  });

  it('opens the crop step between the picker and the upload, and Cancel uploads nothing', async () => {
    const onChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={onChange} />);
    pick(new File(['x'], 'me.png', { type: 'image/png' }));

    // The step is in the document before anything is uploaded.
    expect(
      await screen.findByRole('application', { name: /position the crop/i }),
    ).toBeInTheDocument();
    expect(uploadRequest).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByLabelText(/Upload a photo/)).toBeInTheDocument();
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports pending only while the crop step is open', async () => {
    const onPendingChange = vi.fn();
    render(<ProfilePhotoField uid="attendee-1" value="" onChange={vi.fn()} onPendingChange={onPendingChange} />);

    pick(new File(['x'], 'me.png', { type: 'image/png' }));
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onPendingChange).toHaveBeenLastCalledWith(false);

    await chooseAndApplyCrop(new File(['y'], 'me.png', { type: 'image/png' }), /your profile photo/);
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it('drops an unsaved crop when None or a neutral avatar is chosen', async () => {
    const onChange = vi.fn();
    const ref = createRef();
    const view = render(
      <ProfilePhotoField ref={ref} uid="attendee-1" value="default-avatars/avatar-01.svg" onChange={onChange} />,
    );
    await chooseAndApplyCrop(new File(['x'], 'me.png', { type: 'image/png' }), /your profile photo/);

    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(ref.current.hasPending()).toBe(false);
    expect(uploadRequest).not.toHaveBeenCalled();

    view.rerender(<ProfilePhotoField ref={ref} uid="attendee-1" value="" onChange={onChange} />);
    await chooseAndApplyCrop(new File(['y'], 'me.png', { type: 'image/png' }), /your profile photo/);
    fireEvent.click(screen.getByRole('radio', { name: 'Default avatar 01' }));
    expect(onChange).toHaveBeenCalledWith('default-avatars/avatar-01.svg');
    expect(ref.current.hasPending()).toBe(false);
    expect(uploadRequest).not.toHaveBeenCalled();
  });

  it('retries the same staged object when its delete fails, and uploads again once it is gone', async () => {
    const ref = createRef();
    render(<ProfilePhotoField ref={ref} uid="attendee-1" value="" onChange={vi.fn()} />);
    await chooseAndApplyCrop(new File(['x'], 'me.png', { type: 'image/png' }), /your profile photo/);
    const staged = await ref.current.commit();

    deleteObject.mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'storage/retry-limit-exceeded' }));
    await expect(ref.current.discard()).rejects.toThrow(/network/);
    expect(await ref.current.commit()).toBe(staged);
    expect(uploadRequest).toHaveBeenCalledTimes(1);

    deleteObject.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'storage/object-not-found' }));
    await ref.current.discard();
    expect(ref.current.hasPending()).toBe(true);
    const again = await ref.current.commit();
    expect(again).not.toBe(staged);
    expect(uploadRequest).toHaveBeenCalledTimes(2);
  });

  it('drops an unsaved crop without deleting a stored object', async () => {
    const onChange = vi.fn();
    render(
      <ProfilePhotoField
        uid="attendee-1"
        value="profile-photos/attendee-1/photo.png"
        onChange={onChange}
      />,
    );
    await chooseAndApplyCrop(new File(['x'], 'me.png', { type: 'image/png' }), /your profile photo/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }));
    expect(onChange).toHaveBeenCalledWith('');
    expect(uploadRequest).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('uses the server path when browser randomUUID is missing', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { subtle: real.subtle, getRandomValues: real.getRandomValues?.bind(real) });
    try {
      const ref = createRef();
      render(<ProfilePhotoField ref={ref} uid="attendee-1" value="" onChange={vi.fn()} />);
      await chooseAndApplyCrop(new File(['x'], 'me.png', { type: 'image/png' }), /your profile photo/);
      const path = await ref.current.commit();
      expect(path).toBe('profile-photos/attendee-1/server-1/photo.webp');
      expect(path).not.toBe('profile-photos/attendee-1/photo.png');
    } finally {
      vi.unstubAllGlobals();
      installPhotoCropStubs();
    }
  });
});
