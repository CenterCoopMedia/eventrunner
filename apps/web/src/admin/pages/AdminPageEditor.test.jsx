// Page editor flows (issue #13). The callable layer is the mocked HTTP seam
// (adminApi posts to the deployed onRequest endpoints), so these assert the
// exact request bodies the backend contract expects:
//
//   • Save draft   → cmsSavePage only. Never a live write (spec §8.4).
//   • Publish      → cmsSavePage then cmsPublish { collection: 'cmsPages' }.
//   • Server 400   → surfaced VERBATIM, including each `field: reason`.
//   • System page  → delete refused in the UI, matching cmsDeletePage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({ subscribeContentCollection: () => () => {} }));

// The admin CMS reads both revisions; each test seeds what the listeners
// report. `seeded: true` is deliberately present on the draft: a stored doc
// carries keys the server would reject on the way back, and the editor must
// strip them.
let liveDocs = [];
let draftDocs = [];
// When set, the listener reports an error after delivering its rows — the
// fail-soft path (rows keep rendering, the UI says so, retry happens
// underneath).
let listenerError = null;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    onNext(name === 'cmsPages' ? liveDocs : draftDocs);
    if (listenerError) onError?.(listenerError);
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

const SCHOLARSHIPS_DRAFT = {
  id: 'scholarships',
  label: 'Scholarships',
  path: '/p/scholarships',
  icon: null,
  order: 7,
  visible: true,
  systemPage: false,
  sections: [
    {
      id: 'intro',
      label: 'Intro',
      description: 'Who the scholarships are for.',
      allowedBlocks: ['richtext'],
      maxBlocks: 3,
      reorderable: true,
      defaultBlocks: [
        { field: 'body', blockType: 'richtext', description: 'The programme in a paragraph.' },
      ],
    },
  ],
  // Publish-model and seed bookkeeping a stored doc carries; cmsSavePage
  // rejects unknown fields by name, so these must not travel back.
  status: 'dirty',
  revision: 3,
  updatedAt: 'ignored',
  seeded: true,
};

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
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
  return result;
}

/** The JSON body of the nth fetch call. */
function bodyOf(callIndex) {
  return JSON.parse(fetch.mock.calls[callIndex][1].body);
}
function urlOf(callIndex) {
  return String(fetch.mock.calls[callIndex][0]);
}

beforeEach(() => {
  liveDocs = [];
  draftDocs = [];
  listenerError = null;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('page list', () => {
  it('shows each page’s publish state across both revisions', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'faq', label: 'FAQ', path: '/p/faq', status: undefined }];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages');

    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Never published')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();
  });

  it('fails soft when a listener errors: rows stay, with a non-blocking notice', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    listenerError = new Error('permission denied');
    await renderAt('/admin/pages');

    expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/lost the connection/i);
  });

  it('marks a live page with a dirty draft as having unpublished changes', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined, revision: 2 }];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages');
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  });

  it('publishes only the pages that have something to publish', async () => {
    liveDocs = [
      { ...SCHOLARSHIPS_DRAFT, id: 'faq', label: 'FAQ', status: undefined },
      { ...SCHOLARSHIPS_DRAFT, status: undefined, revision: 2 },
    ];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ queueId: 'q1', status: 'done' }));
    await renderAt('/admin/pages');

    fireEvent.click(screen.getByRole('button', { name: 'Publish all (1)' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsPublish$/);
    // 'faq' is already published with no dirty draft — republishing it would
    // bump its revision for nothing.
    expect(bodyOf(0)).toEqual({ collection: 'cmsPages', docIds: ['scholarships'] });
  });
});

describe('page editor', () => {
  it('creates a page and saves it as a draft only (issue #13 done-when)', async () => {
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/new');

    fireEvent.change(screen.getByLabelText('Page id'), { target: { value: 'scholarships' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Scholarships' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/p/scholarships' } });

    // One section, one block, driven by the registry palette.
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByLabelText('Section 1 id'), { target: { value: 'intro' } });
    fireEvent.change(screen.getByLabelText('Section 1 label'), { target: { value: 'Intro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add block to section 1' }));
    fireEvent.change(screen.getByLabelText('Block 1 field — section 1'), {
      target: { value: 'body' },
    });
    fireEvent.change(screen.getByLabelText('Block 1 type — section 1'), {
      target: { value: 'richtext' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsSavePage$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    expect(bodyOf(0).page).toMatchObject({
      id: 'scholarships',
      label: 'Scholarships',
      path: '/p/scholarships',
      visible: true,
      systemPage: false,
      sections: [
        expect.objectContaining({
          id: 'intro',
          label: 'Intro',
          defaultBlocks: [
            { field: 'body', blockType: 'richtext', description: '' },
          ],
        }),
      ],
    });
    // Saving is explicitly NOT publishing.
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/cmsPublish'))).toBe(false);
    expect(await screen.findByText(/not public until you publish/i)).toBeInTheDocument();
  });

  it('publishes with cmsSavePage followed by cmsPublish for that one page', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }))
      .mockResolvedValueOnce(okResponse({ queueId: 'q1', status: 'done' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(0)).toMatch(/\/cmsSavePage$/);
    expect(urlOf(1)).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1)).toEqual({ collection: 'cmsPages', docIds: ['scholarships'] });
  });

  it('sends only the fields the server accepts, dropping stored bookkeeping', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const { page } = bodyOf(0);
    expect(Object.keys(page).sort()).toEqual(
      ['icon', 'id', 'label', 'order', 'path', 'sections', 'systemPage', 'visible'].sort(),
    );
    expect(page).not.toHaveProperty('seeded');
    expect(page).not.toHaveProperty('status');
    expect(page).not.toHaveProperty('revision');
  });

  it('surfaces the server’s validation message verbatim, per field', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        "Invalid page: path: must be a string starting with '/'; sections[0].label: must be a non-empty string",
      ),
    );
    await renderAt('/admin/pages/scholarships');

    fireEvent.change(screen.getByLabelText('Path'), { target: { value: 'scholarships' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("path: must be a string starting with '/'");
    expect(alert).toHaveTextContent('sections[0].label: must be a non-empty string');
    // The offending inputs are marked, described by the server's own words.
    expect(screen.getByLabelText('Path')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Path')).toHaveAccessibleDescription(
      /must be a string starting with/,
    );
    expect(screen.getByLabelText('Section 1 label')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reflects the systemPage delete guard instead of letting the operator hit it', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'home', label: 'Home page', systemPage: true }];
    await renderAt('/admin/pages/home');

    expect(screen.getByRole('button', { name: 'Delete page' })).toBeDisabled();
    expect(screen.getByText(/cannot be deleted/i)).toBeInTheDocument();
  });

  it('deletes a regular page through cmsDeletePage', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', deleted: true }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(screen.getByRole('button', { name: 'Delete page' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsDeletePage$/);
    expect(bodyOf(0)).toEqual({ id: 'scholarships' });
  });

  it('adds, reorders, and removes blocks within a section', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(screen.getByRole('button', { name: 'Add block to section 1' }));
    fireEvent.change(screen.getByLabelText('Block 2 field — section 1'), {
      target: { value: 'closing' },
    });
    // Move the new block above the first one.
    fireEvent.click(
      screen.getByRole('button', { name: 'Move block 2 up in section 1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.sections[0].defaultBlocks.map((b) => b.field)).toEqual([
      'closing',
      'body',
    ]);
  });

  it('offers only the section’s allowed block types in the block picker', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');

    const picker = screen.getByLabelText('Block 1 type — section 1');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Rich text']);

    // Widening the palette widens the picker — the registry drives both.
    fireEvent.click(screen.getByLabelText('Statistic — section 1'));
    expect(
      within(screen.getByLabelText('Block 1 type — section 1'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Rich text', 'Statistic']);
  });
});
