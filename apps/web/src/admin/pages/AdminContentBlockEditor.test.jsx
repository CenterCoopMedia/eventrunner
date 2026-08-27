// Content block editor's value-field routing (issue #76). BlockValueFields
// (AdminContentBlockEditor.jsx) renders one control per registry field
// (blockTypes.js), keyed off `field.type` — every `url` field used to fall
// through to a plain TextField. Only the image block's `url` actually names
// a Storage object path (spec §5.2); it now routes through ImagePicker,
// exactly as AdminBranding's logo slots do (AdminBranding.jsx). cta.url and
// link_group.url are real external destinations and must stay plain text —
// pinned here so a future edit to the `url` branch cannot widen the picker
// to them by accident.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

// cmsPages/cmsContent each have a live + drafts sibling; both listeners must
// report (useAdminPages.js, useAdminContent.js) before the editor treats the
// section/block as known.
let pagesLive = [];
let pagesDrafts = [];
let contentLive = [];
let contentDrafts = [];
const COLLECTIONS = {
  cmsPages: () => pagesLive,
  cmsPages_drafts: () => pagesDrafts,
  cmsContent: () => contentLive,
  cmsContent_drafts: () => contentDrafts,
};
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext) => {
    onNext(COLLECTIONS[name]?.() ?? []);
    return () => {};
  },
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {},
  onAuthStateChanged: (_auth, next) => {
    next({ uid: 'admin-1', email: 'admin@example.org', getIdToken: async () => 'id-token' });
    return () => {};
  },
  signInWithCustomToken: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';

const HOME_PAGE = {
  id: 'home',
  label: 'Home',
  path: '/',
  icon: null,
  order: 0,
  visible: true,
  systemPage: true,
  sections: [
    {
      id: 'hero',
      label: 'Hero',
      description: 'Top of the home page.',
      allowedBlocks: ['image', 'cta', 'link_group'],
      maxBlocks: 5,
      reorderable: true,
      defaultBlocks: [],
    },
  ],
};

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}

async function renderAt(path) {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Two waits, not one: the lazy admin chunk, and then the admin probe the
  // gate holds on (AdminGate renders "Checking your access…" until it
  // answers). Waiting only for the chunk lets an assertion run while the
  // gate is still checking, which is a flake under load, not a bug.
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  });
  return result;
}

beforeEach(() => {
  pagesLive = [HOME_PAGE];
  pagesDrafts = [];
  contentLive = [];
  contentDrafts = [];
  globalThis.fetch = vi.fn(() => Promise.resolve(okResponse({ docId: 'hero__banner' })));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('AdminContentBlockEditor value fields', () => {
  it('routes the image block’s url field through ImagePicker, not a plain text field', async () => {
    await renderAt('/admin/content/home/hero/_new');

    // The section allows image first, so a fresh block defaults to it.
    expect(await screen.findByRole('combobox', { name: /block type/i })).toHaveValue('image');

    // ImagePicker's own affordance — a bare TextField never renders this.
    expect(screen.getByRole('button', { name: /choose or upload/i })).toBeInTheDocument();

    const urlInput = screen.getByLabelText('url');
    expect(urlInput).not.toHaveAttribute('type', 'url');
    fireEvent.change(urlInput, { target: { value: 'cms-images/banner.jpg' } });
    expect(urlInput).toHaveValue('cms-images/banner.jpg');

    fireEvent.change(screen.getByLabelText('alt'), { target: { value: 'Banner' } });

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = fetch.mock.calls.find(([url]) => String(url).includes('cmsCreateContent'));
    expect(call).toBeTruthy();
    const body = JSON.parse(call[1].body);
    expect(body.fields.url).toBe('cms-images/banner.jpg');
  });

  it('keeps cta.url as a plain text field, never the image picker', async () => {
    await renderAt('/admin/content/home/hero/_new');

    fireEvent.change(await screen.findByRole('combobox', { name: /block type/i }), {
      target: { value: 'cta' },
    });

    expect(screen.queryByRole('button', { name: /choose or upload/i })).not.toBeInTheDocument();
    const urlInput = screen.getByLabelText('url');
    expect(urlInput).toHaveAttribute('type', 'url');
    fireEvent.change(urlInput, { target: { value: 'https://example.org/register' } });
    expect(urlInput).toHaveValue('https://example.org/register');
  });

  it('keeps link_group.url as a plain text field, never the image picker', async () => {
    await renderAt('/admin/content/home/hero/_new');

    fireEvent.change(await screen.findByRole('combobox', { name: /block type/i }), {
      target: { value: 'link_group' },
    });

    expect(screen.queryByRole('button', { name: /choose or upload/i })).not.toBeInTheDocument();
    const urlInput = screen.getByLabelText('url');
    expect(urlInput).toHaveAttribute('type', 'url');
    fireEvent.change(urlInput, { target: { value: 'https://example.org/resources' } });
    expect(urlInput).toHaveValue('https://example.org/resources');
  });
});
