// The media library and its picker (issue #24).
//
// What is pinned here: the library lists what media_assets holds; upload
// goes through the mediaUpload ENDPOINT (never a client Storage write, which
// storage.rules deny for cms-images/ and branding/); the delete flow shows
// the usage list before it destroys anything and only force-deletes after a
// second, explicit press; and ImagePicker hands its caller the object PATH.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const call = vi.fn();
let assets;

vi.mock('../../adminApi.js', async () => {
  const actual = await vi.importActual('../../adminApi.js');
  return { ...actual, useAdminApi: () => call };
});
vi.mock('../../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    onNext(assets);
    return () => {};
  },
}));
vi.mock('../../../lib/mediaSource.js', async () => {
  const actual = await vi.importActual('../../../lib/mediaSource.js');
  return {
    ...actual,
    // Only the file read is faked; assetUrl is a pure builder and runs for
    // real (lib/mediaSource.test.js covers it).
    fileToBase64: vi.fn(async () => 'ZmFrZQ=='),
  };
});

const { default: MediaLibrary } = await import('./MediaLibrary.jsx');
const { default: ImagePicker } = await import('./ImagePicker.jsx');
const { AdminApiError } = await import('../../adminApi.js');

const HERO = {
  id: 'asset-1',
  path: 'cms-images/asset-1/hero.png',
  folder: 'cms-images',
  filename: 'hero.png',
  title: 'Hero',
  alt: 'The venue',
  contentType: 'image/png',
  size: 2048,
  uploadedBy: 'admin@example.org',
  createdAt: new Date('2026-08-01T00:00:00Z'),
};

const LOGO = {
  ...HERO,
  id: 'asset-2',
  path: 'branding/asset-2/logo.png',
  folder: 'branding',
  filename: 'logo.png',
  title: 'Logo',
  alt: '',
  createdAt: new Date('2026-08-02T00:00:00Z'),
};

beforeEach(() => {
  assets = [HERO, LOGO];
  call.mockReset();
  call.mockImplementation(async (name) => {
    if (name === 'scanMediaUsage') return { usage: { [HERO.path]: [] } };
    return {};
  });
});

describe('MediaLibrary', () => {
  it('lists only the assets in the requested folder', async () => {
    render(<MediaLibrary folder="cms-images" />);
    expect(await screen.findByText('Hero')).toBeInTheDocument();
    expect(screen.queryByText('Logo')).not.toBeInTheDocument();
  });

  it('flags an asset with no alt text', async () => {
    render(<MediaLibrary folder="branding" />);
    expect(await screen.findByText(/no alt text/)).toBeInTheDocument();
  });

  it('filters on search', async () => {
    render(<MediaLibrary folder="cms-images" />);
    await screen.findByText('Hero');
    fireEvent.change(screen.getByLabelText('Search the library'), {
      target: { value: 'nothing-matches' },
    });
    expect(screen.getByText('Nothing matches that search')).toBeInTheDocument();
  });

  it('uploads through the mediaUpload endpoint, never a client storage write', async () => {
    call.mockImplementation(async (name) => {
      if (name === 'mediaUpload') return { asset: { ...HERO, filename: 'new.png' } };
      return { usage: {} };
    });
    render(<MediaLibrary folder="cms-images" />);
    fireEvent.click(screen.getByRole('button', { name: 'Upload a file' }));

    const file = new File(['x'], 'new.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText('Alt text'), {
      target: { value: 'A new picture' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(call).toHaveBeenCalledWith('mediaUpload', expect.any(Object)));
    const [, body] = call.mock.calls.find(([name]) => name === 'mediaUpload');
    expect(body).toMatchObject({
      folder: 'cms-images',
      filename: 'new.png',
      contentType: 'image/png',
      alt: 'A new picture',
      data: 'ZmFrZQ==',
    });
  });

  it('refuses a file the rules would refuse, before uploading it', async () => {
    render(<MediaLibrary folder="cms-images" />);
    fireEvent.click(screen.getByRole('button', { name: 'Upload a file' }));
    const file = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/application\/pdf/);
    expect(call).not.toHaveBeenCalledWith('mediaUpload', expect.anything());
  });
});

describe('the delete-with-usage-warning flow', () => {
  it('shows where an asset is used and needs a second press to delete it', async () => {
    call.mockImplementation(async (name) => {
      if (name === 'scanMediaUsage') {
        return { usage: { [HERO.path]: [{ docPath: 'cmsPages/home', field: 'sections.0.image' }] } };
      }
      if (name === 'mediaDelete') return { assetId: HERO.id };
      return {};
    });
    render(<MediaLibrary folder="cms-images" />);
    fireEvent.click(await screen.findByRole('button', { name: /Hero/ }));

    expect(await screen.findByText('cmsPages/home')).toBeInTheDocument();
    expect(screen.getByText(/Used by 1 document/)).toBeInTheDocument();

    // The plain "Delete this file" button is not offered for an asset in use.
    expect(screen.queryByRole('button', { name: 'Delete this file' })).not.toBeInTheDocument();
    // Moment 3: the first press states the cost — how many live documents
    // lose their file — and sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file anyway' }));
    expect(screen.getByText(/render a missing file/)).toBeInTheDocument();
    expect(call).not.toHaveBeenCalledWith('mediaDelete', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file anyway' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('mediaDelete', {
        assetId: HERO.id,
        force: true,
      }),
    );
  });

  it('deletes an unused asset without force', async () => {
    call.mockImplementation(async (name) => {
      if (name === 'scanMediaUsage') return { usage: { [HERO.path]: [] } };
      return {};
    });
    render(<MediaLibrary folder="cms-images" />);
    fireEvent.click(await screen.findByRole('button', { name: /Hero/ }));
    expect(await screen.findByText(/Deleting it is safe/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('mediaDelete', { assetId: HERO.id, force: false }),
    );
  });

  it("surfaces the server's own 409 reference list when the scan missed a use", async () => {
    call.mockImplementation(async (name) => {
      if (name === 'scanMediaUsage') return { usage: { [HERO.path]: [] } };
      throw new AdminApiError({
        code: 'asset-in-use',
        status: 409,
        message: 'That asset is used by 1 document.',
        usage: [{ docPath: 'cmsContent/home-hero', field: 'image' }],
      });
    });
    render(<MediaLibrary folder="cms-images" />);
    fireEvent.click(await screen.findByRole('button', { name: /Hero/ }));
    await screen.findByText(/Deleting it is safe/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this file' }));

    expect(await screen.findByText('cmsContent/home-hero')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete this file anyway' }),
    ).toBeInTheDocument();
  });

  it('saves alt text through mediaUpdateMetadata', async () => {
    render(<MediaLibrary folder="cms-images" />);
    fireEvent.click(await screen.findByRole('button', { name: /Hero/ }));
    fireEvent.change(await screen.findByLabelText('Alt text'), {
      target: { value: 'A wide shot' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith('mediaUpdateMetadata', {
        assetId: HERO.id,
        alt: 'A wide shot',
        title: 'Hero',
      }),
    );
  });
});

describe('nested dialogs', () => {
  it('closes only the topmost dialog on Escape', async () => {
    // ImagePicker opens the library, and a tile inside it opens the asset
    // detail dialog. One Escape must step back one level, not discard the
    // picker the person was only stepping out of.
    render(<ImagePicker label="Primary logo" folder="branding" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose or upload…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Details and delete' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    // The one still open is the picker's library, not the detail modal.
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Choose an image/);

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('restores page scrolling only when the last dialog closes', async () => {
    render(<ImagePicker label="Primary logo" folder="branding" value="" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose or upload…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Details and delete' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});

describe('ImagePicker', () => {
  it('hands its caller the object path, not a download URL', async () => {
    const onChange = vi.fn();
    render(<ImagePicker label="Primary logo" folder="branding" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose or upload…' }));
    fireEvent.click(await screen.findByRole('button', { name: /Logo/ }));
    expect(onChange).toHaveBeenCalledWith(LOGO.path);
  });

  it('keeps the path editable by hand for assets with no library row', () => {
    const onChange = vi.fn();
    render(<ImagePicker label="Favicon" folder="branding" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Favicon'), {
      target: { value: 'branding/favicon.svg' },
    });
    expect(onChange).toHaveBeenCalledWith('branding/favicon.svg');
  });

  it('clears the slot', () => {
    const onChange = vi.fn();
    render(
      <ImagePicker label="Mark" folder="branding" value="branding/mark.svg" onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
