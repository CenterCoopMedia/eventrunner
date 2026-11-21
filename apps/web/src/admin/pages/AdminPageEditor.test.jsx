// Page editor flows (issue #13). The callable layer is the mocked HTTP seam
// (adminApi posts to the deployed onRequest endpoints), so these assert the
// exact request bodies the backend contract expects:
//
//   • Save draft   → cmsSavePage only. Never a live write (spec §8.4).
//   • Publish      → cmsSavePage then cmsPublish { collection: 'cmsPages' }.
//   • Server 400   → shows how to fix each field in plain words.
//   • System page  → delete refused in the UI, matching cmsDeletePage.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

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
// Collections listed here never report — the window in which one revision is
// known and the other is not.
let silentCollections = [];
const adminSubscriptions = new Map();
const adminErrors = new Map();
const readAdminPage = vi.fn();
vi.mock('../adminSource.js', () => ({
  readAdminPage: (...args) => readAdminPage(...args),
  subscribeAdminCollection: (name, onNext, onError) => {
    adminSubscriptions.set(name, onNext);
    adminErrors.set(name, onError);
    if (!silentCollections.includes(name)) {
      onNext(name === 'cmsPages' ? liveDocs : draftDocs);
    }
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
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [], metadata: { fromCache: false } })),
}));

import App from '../../App.jsx';
import { markTourDone } from '../tourState.js';
import { NAV_PLACEMENT_LABELS } from '../../lib/themeRuntime.js';
// Load the route modules with the fixture so the first case measures the editor.
import '../AdminApp.jsx';
import './AdminPageEditor.jsx';

const SCHOLARSHIPS_DRAFT = {
  id: 'scholarships',
  label: 'Scholarships',
  path: '/scholarships',
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

async function renderAt(path, { waitForHeading = true } = {}) {
  const result = render(
    <MemoryRouter
      initialEntries={[path]}
    >
      <App />
    </MemoryRouter>,
  );
  // Two waits, not one: the lazy admin chunk, and then the admin probe the
  // gate holds on (AdminGate renders "Checking your access…" until it
  // answers). Waiting only for the chunk lets an assertion run while the
  // gate is still checking, which is a flake under load, not a bug.
  await waitFor(
    () => {
      expect(screen.queryByText('Loading admin…', { selector: '.loading-status__label' })).not.toBeInTheDocument();
      expect(screen.queryByText('Checking your access…', { selector: '.loading-status__label' })).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 5000 },
  );
  if (waitForHeading) await screen.findByRole('heading', { level: 1 });
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
  // The editor tour (issue #198) opens on a first visit; this file tests
  // the page, so the account has already ended it.
  markTourDone('admin-1');
  liveDocs = [];
  draftDocs = [];
  listenerError = null;
  silentCollections = [];
  adminSubscriptions.clear();
  adminErrors.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('page editor server adoption', () => {
  it('saves and removes a paired translation through the existing draft action without changing English', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    const page = within(screen.getByRole('heading', { name: 'Page', level: 2 }).closest('section'));
    const saveDraft = screen.getByRole('button', { name: 'Save draft', exact: true });
    fireEvent.click(page.getByRole('button', { name: 'Spanish translation', exact: true }));
    fireEvent.change(page.getByLabelText('Spanish navigation label'), { target: { value: 'Becas' } });
    fetch.mockResolvedValueOnce(okResponse({ status: 'dirty' }));
    await act(async () => { fireEvent.click(saveDraft); });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0).page.label).toBe('Scholarships');
    expect(bodyOf(0).page.translations).toEqual({ es: { label: 'Becas' } });
    fireEvent.click(page.getByRole('button', { name: 'Remove Spanish translation' }));
    fetch.mockResolvedValueOnce(okResponse({ status: 'dirty' }));
    await act(async () => { fireEvent.click(saveDraft); });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(bodyOf(1).page).not.toHaveProperty('translations');
    expect(bodyOf(1).page.sections[0].id).toBe('intro');
  });
  it.each(['live', 'drafts'])('ignores cached revisions until both server answers arrive (%s first)', async (first) => {
    silentCollections = ['cmsPages', 'cmsPages_drafts'];
    await renderAt('/admin/pages/scholarships', { waitForHeading: false });
    await waitFor(() => expect(adminSubscriptions.has('cmsPages_drafts')).toBe(true));
    const live = { ...SCHOLARSHIPS_DRAFT, label: 'Published label', status: undefined };
    const draft = { ...SCHOLARSHIPS_DRAFT, label: 'Saved draft label' };
    const nextLive = adminSubscriptions.get('cmsPages');
    const nextDrafts = adminSubscriptions.get('cmsPages_drafts');
    act(() => {
      nextLive([live], { fromCache: true });
      nextDrafts([], { fromCache: true });
    });
    expect(screen.queryByLabelText('Navigation label')).toBeNull();
    act(() => {
      if (first === 'live') nextLive([live], { fromCache: false });
      else nextDrafts([draft], { fromCache: false });
    });
    expect(screen.queryByLabelText('Navigation label')).toBeNull();
    act(() => {
      if (first === 'live') nextDrafts([draft], { fromCache: false });
      else nextLive([live], { fromCache: false });
    });
    expect(await screen.findByLabelText('Navigation label')).toHaveValue('Saved draft label');
    act(() => nextDrafts([], { fromCache: true }));
    expect(screen.getByLabelText('Navigation label')).toHaveValue('Saved draft label');

    fetch.mockResolvedValueOnce(okResponse({ status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetch.mock.calls[0][1].body).page.label).toBe('Saved draft label');
  });
});

describe('page list', () => {
  it('shows each page’s publish state across both revisions', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'faq', label: 'FAQ', path: '/faq', status: undefined }];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages');

    await waitFor(() => {
      expect(screen.getByText('Live')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();
    });
  });

  // Launch rehearsal (admin-03-pages.png): every row read "Live" and none
  // said whether a reader could open the page. A word says it, in each row.
  it('states in words whether each page is visible or hidden on the public site', async () => {
    liveDocs = [
      { id: 'faq', label: 'FAQ', path: '/faq', order: 0, visible: true, sections: [] },
      { id: 'recap', label: 'Recap', path: '/recap', order: 1, visible: false, sections: [] },
      // The build snapshot's flags have the attendee directory off.
      { id: 'attendees', label: 'Attendees', path: '/attendees', order: 2, visible: true, systemPage: true, sections: [] },
    ];
    await renderAt('/admin/pages');
    const row = async (name) => (await within(screen.getByRole('main')).findByRole('link', { name })).closest('li');
    expect(within(await row('FAQ')).getByText('Visible')).toBeInTheDocument();
    expect(within(await row('FAQ')).queryByText('Hidden')).toBeNull();
    expect(within(await row('Recap')).getByText('Hidden')).toBeInTheDocument();
    expect(within(await row('Recap')).queryByText('Visible')).toBeNull();
    const attendees = await row('Attendees');
    expect(within(attendees).getByText('Hidden')).toBeInTheDocument();
    expect(within(attendees).getByText(/Attendee directory is off/)).toBeInTheDocument();
  });

  // The word is about the public site, so it reads the published revision.
  // A page never published is not on the site whatever its draft says, and
  // an unpublished visibility change has not reached the site yet.
  it('states visibility from the published revision and names an unpublished change', async () => {
    liveDocs = [
      { id: 'faq', label: 'FAQ', path: '/faq', order: 0, visible: true, sections: [] },
      { id: 'recap', label: 'Recap', path: '/recap', order: 1, visible: false, sections: [] },
    ];
    draftDocs = [
      { id: 'faq', label: 'FAQ', path: '/faq', order: 0, visible: false, sections: [], status: 'dirty' },
      { id: 'recap', label: 'Recap', path: '/recap', order: 1, visible: true, sections: [], status: 'dirty' },
      { id: 'press', label: 'Press', path: '/press', order: 2, visible: true, sections: [], status: 'dirty' },
    ];
    await renderAt('/admin/pages');
    const row = async (name) => (await within(screen.getByRole('main')).findByRole('link', { name })).closest('li');
    const faq = await row('FAQ');
    expect(within(faq).getByText('Visible')).toBeInTheDocument();
    expect(within(faq).getByText('Your unpublished changes hide this page. Publish to hide it.')).toBeInTheDocument();
    const recap = await row('Recap');
    expect(within(recap).getByText('Hidden')).toBeInTheDocument();
    expect(within(recap).getByText('Your unpublished changes show this page. Publish to show it.')).toBeInTheDocument();
    const press = await row('Press');
    expect(within(press).getByText('Hidden')).toBeInTheDocument();
    expect(within(press).queryByText('Visible')).toBeNull();
  });

  it('publishes a moved menu order in one request', async () => {
    liveDocs = [
      { id: 'faq', label: 'FAQ', path: '/faq', order: 0, visible: true, sections: [] },
      { id: 'scholarships', label: 'Scholarships', path: '/scholarships', order: 1, visible: true, sections: [] },
    ];
    fetch.mockResolvedValue(okResponse({ status: 'done' }));
    await renderAt('/admin/pages');
    const up = await screen.findByRole('button', { name: 'Move FAQ up' });
    expect(up).toBeDisabled();
    expect(up.className).toContain('min-h-11');
    expect(up.className).toContain('min-w-11');
    expect(within(up.parentElement).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Drag FAQ', 'Move FAQ up', 'Move FAQ down']);
    expect(screen.getByRole('button', { name: 'Drag Scholarships' })).toHaveAttribute('draggable', 'true');
    const row = screen.getByRole('link', { name: 'Scholarships' }).closest('li');
    expect(row).toHaveAttribute('draggable', 'true');
    expect(screen.getByRole('link', { name: 'Scholarships' })).toHaveAttribute('data-reorder-block');
    fireEvent.dragOver(row);
    expect(row.className).toContain('border-admin-action');
    expect(row.className).toContain('bg-admin-action-soft');
    fireEvent.click(screen.getByRole('button', { name: 'Move Scholarships up' }));
    expect(screen.getByText('Scholarships moved to position 1 of 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish menu order' }));
    expect(await screen.findByText('Menu order published. Page drafts stay unpublished.')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toMatch(/\/cmsPublish$/);
    expect(bodyOf(0)).toEqual({ menuOrder: ['scholarships', 'faq'], requestId: expect.any(String) });
  });

  it('marks the top menu after five published visible entries and moves the line with the order', async () => {
    const page = (id, label, order, visible = true) => ({ id, label, path: `/${id}`, order, visible, sections: [] });
    liveDocs = [
      page('faq', 'FAQ', 0), page('hidden', 'Hidden page', 2, false), page('parking', 'Parking', 3),
      page('visit', 'Visit', 4), page('food', 'Food', 5), page('zzz-help', 'Help', 6),
      { id: 'venue-link', label: 'Venue link', url: 'https://example.org/venue', order: 6, visible: true, systemPage: false },
    ];
    draftDocs = [{ ...page('printed-map', 'Printed map', 1), status: 'dirty' }];
    await renderAt('/admin/pages');
    const line = (await screen.findByText(/appear under More/)).closest('li');
    expect(line.previousElementSibling).toHaveTextContent('Help');
    fireEvent.click(screen.getByRole('button', { name: 'Move Venue link up' }));
    expect(screen.getByText(/appear under More/).closest('li').previousElementSibling).toHaveTextContent('Venue link');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks before leaving a page list with an unsaved move, and cancel restores the order', async () => {
    liveDocs = [
      { id: 'faq', label: 'FAQ', path: '/faq', order: 0, visible: true, sections: [] },
      { id: 'scholarships', label: 'Scholarships', path: '/scholarships', order: 1, visible: true, sections: [] },
    ];
    await renderAt('/admin/pages');
    fireEvent.click(await screen.findByRole('button', { name: 'Move Scholarships up' }));
    fireEvent.click(screen.getByRole('link', { name: 'Edit Scholarships' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      screen.getAllByRole('link').map((link) => link.textContent).filter((text) => text === 'FAQ' || text === 'Scholarships'),
    ).toEqual(['FAQ', 'Scholarships']);
  });

  it('fails soft when a listener errors: rows stay, with a non-blocking notice', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    listenerError = new Error('permission denied');
    await renderAt('/admin/pages');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/could not refresh/i);
    });
  });

  it('marks a live page with a dirty draft as having unpublished changes', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined, revision: 2 }];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages');
    expect(await screen.findByText('Live with unpublished changes')).toBeInTheDocument();
  });

  it('publishes only the pages that have something to publish', async () => {
    liveDocs = [
      { ...SCHOLARSHIPS_DRAFT, id: 'faq', label: 'FAQ', status: undefined },
      { ...SCHOLARSHIPS_DRAFT, status: undefined, revision: 2 },
    ];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ queueId: 'q1', status: 'done' }));
    await renderAt('/admin/pages');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish all (1)' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsPublish$/);
    // 'faq' is already published with no dirty draft — republishing it would
    // bump its revision for nothing.
    expect(bodyOf(0)).toEqual({ collection: 'cmsPages', docIds: ['scholarships'], requestId: expect.any(String) });
  });

  it('disables page moves while publish is running', async () => {
    liveDocs = [
      { id: 'faq', label: 'FAQ', path: '/faq', order: 0, visible: true, sections: [], status: undefined },
      { ...SCHOLARSHIPS_DRAFT, status: undefined, revision: 2 },
    ];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    let release;
    fetch.mockReturnValueOnce(new Promise((resolve) => {
      release = () => resolve(okResponse({ queueId: 'q1', status: 'done' }));
    }));
    await renderAt('/admin/pages');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish all (1)' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Drag Scholarships' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Drag FAQ' })).toBeDisabled();
    });
    release();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  });
});

describe('page editor', () => {
  it('waits for both revisions before it fills the form and saves the draft values', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, label: 'Old live label', status: undefined, revision: 2 }];
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, label: 'Unpublished label' }];
    silentCollections = ['cmsPages_drafts'];
    await renderAt('/admin/pages/scholarships', { waitForHeading: false });
    await waitFor(() => expect(adminSubscriptions.has('cmsPages_drafts')).toBe(true));

    expect(screen.getByText('Loading page…', { selector: '.loading-status__label' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Navigation label')).toBeNull();

    act(() => adminSubscriptions.get('cmsPages_drafts')(draftDocs));
    expect(await screen.findByLabelText('Navigation label')).toHaveValue('Unpublished label');

    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.label).toBe('Unpublished label');
  });

  it('keeps the form closed when the drafts listener fails before it reports', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    silentCollections = ['cmsPages_drafts'];
    await renderAt('/admin/pages/scholarships', { waitForHeading: false });
    await waitFor(() => expect(adminErrors.has('cmsPages_drafts')).toBe(true));

    act(() => adminErrors.get('cmsPages_drafts')(new Error('permission denied')));

    expect(await screen.findByText(/could not load this page and its saved draft/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Navigation label')).toBeNull();
  });

  it('closes an adopted editor when another admin deletes the live page', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    await renderAt('/admin/pages/scholarships');
    expect(await screen.findByLabelText('Navigation label')).toHaveValue('Scholarships');

    act(() => adminSubscriptions.get('cmsPages')([]));

    expect(await screen.findByRole('heading', { name: 'No such page' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Navigation label')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('creates a page and saves it as a draft only (issue #13 done-when)', async () => {
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/new');

    expect(screen.queryByLabelText('Page id')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'Scholarships' } });
    expect(screen.getByLabelText('Path')).toHaveValue('/scholarships');

    // One section. Its content is written under Content once the page exists.
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByLabelText('Section 1 label'), { target: { value: 'Intro' } });
    expect(screen.queryByLabelText('Section 1 id')).not.toBeInTheDocument();
    expect(screen.getByText('Save the page, then add its content.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add or edit the content in/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsSavePage$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    expect(bodyOf(0).create).toBe(true);
    expect(bodyOf(0).page).toMatchObject({
      id: 'scholarships',
      label: 'Scholarships',
      path: '/scholarships',
      visible: true,
      systemPage: false,
      sections: [
        expect.objectContaining({
          id: 'intro',
          label: 'Intro',
          defaultBlocks: [],
        }),
      ],
    });
    // Saving is explicitly NOT publishing.
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/cmsPublish'))).toBe(false);
    expect(await screen.findByText(/not public until you publish/i)).toBeInTheDocument();
  });

  it('does not give a new page the id new', async () => {
    fetch.mockResolvedValueOnce(okResponse({ id: 'new-2', status: 'dirty' }));
    await renderAt('/admin/pages/new');
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'New' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/welcome' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.id).toBe('new-2');
    expect(bodyOf(0).page.path).toBe('/welcome');
  });

  it('allocates a new page after existing navigation links without reusing their ids', async () => {
    liveDocs = [{ id: 'visit', label: 'Visit', url: 'https://example.org/visit', order: 8, visible: true, systemPage: false }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'visit-2', status: 'dirty' }));
    await renderAt('/admin/pages/new');
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'Visit' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page).toMatchObject({ id: 'visit-2', order: 9 });
  });

  it('does not reuse a section id that content still holds', async () => {
    draftDocs = [{ id: 'old-faq', section: 'questions' }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'faq', status: 'dirty' }));
    await renderAt('/admin/pages/new');
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'FAQ' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/faq' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }));
    fireEvent.change(screen.getByLabelText('Section 1 label'), { target: { value: 'Questions' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.sections[0].id).toBe('questions-2');
  });

  it('waits to save a new page until content has loaded', async () => {
    silentCollections = ['cmsContent'];
    await renderAt('/admin/pages/new', { waitForHeading: false });
    expect(await screen.findByText('Loading page…')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks before leaving a page with unsaved edits', async () => {
    await renderAt('/admin/pages/new');
    const label = await screen.findByLabelText('Navigation label');
    fireEvent.change(label, { target: { value: 'Scholarships' } });
    fireEvent.click(screen.getByRole('link', { name: 'Back to pages' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(label).toHaveValue('Scholarships');
  });

  it('publishes with cmsSavePage followed by cmsPublish for that one page', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }))
      .mockResolvedValueOnce(okResponse({ queueId: 'q1', status: 'done' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(await screen.findByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(0)).toMatch(/\/cmsSavePage$/);
    expect(bodyOf(0).create).toBeUndefined();
    expect(urlOf(1)).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1)).toEqual({ collection: 'cmsPages', docIds: ['scholarships'] });
  });

  it('keeps typed text after a revision conflict and loads the newer version on request', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, draftRevision: 'loaded-revision' }];
    const newerDraft = { ...SCHOLARSHIPS_DRAFT, label: 'Teammate’s page', draftRevision: 'newer-revision' };
    readAdminPage.mockResolvedValueOnce({ id: newerDraft.id, draft: newerDraft, live: null });
    fetch
      .mockResolvedValueOnce(errorResponse(409, 'page-revision-conflict', 'Load the latest version.'))
      .mockResolvedValueOnce(okResponse({ revision: 'my-save' }))
      .mockResolvedValueOnce(okResponse({ revision: 'my-next-save' }));
    await renderAt('/admin/pages/scholarships');

    const label = await screen.findByLabelText('Navigation label');
    fireEvent.change(label, { target: { value: 'My unsaved label' } });
    act(() => adminSubscriptions.get('cmsPages_drafts')([newerDraft]));
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    expect(await screen.findByText(/A teammate saved a newer version of this page/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodyOf(0)).toMatchObject({ expectedRevision: 'loaded-revision', page: { label: 'My unsaved label' } });
    expect(label).toHaveValue('My unsaved label');
    expect(readAdminPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Load newer version' }));
    await waitFor(() => expect(label).toHaveValue('Teammate’s page'));
    expect(readAdminPage).toHaveBeenCalledWith('scholarships');

    fireEvent.change(label, { target: { value: 'My next edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved. It is not public until you publish.');
    expect(bodyOf(1).expectedRevision).toBe('newer-revision');

    fireEvent.change(label, { target: { value: 'One more edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(bodyOf(2).expectedRevision).toBe('my-save');
  });

  it('sends only the fields the server accepts, dropping stored bookkeeping', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const { page } = bodyOf(0);
    expect(page.order).toBe(7);
    expect(Object.keys(page).sort()).toEqual(
      [
        'icon',
        'id',
        'label',
        'layout',
        'order',
        'path',
        'sections',
        'systemPage',
        'template',
        'title',
        'visible',
      ].sort(),
    );
    expect(page).not.toHaveProperty('seeded');
    expect(page).not.toHaveProperty('status');
    expect(page).not.toHaveProperty('revision');
  });

  it('sends no page heading for a page that states none, and the written one once an operator writes it', async () => {
    // Two names, and the second is optional: `label` is what the header nav
    // and the footer print, `title` the heading at the top of the page. A
    // page that leaves the heading blank is headed by its label, so a blank
    // field has to reach the server as null rather than as '' — otherwise
    // every page saved through this form would claim an empty heading.
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    const heading = await screen.findByLabelText('Page heading');
    expect(heading).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.title).toBe(null);

    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Page heading'), {
      target: { value: 'Scholarships and bursaries' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1).page).toMatchObject({
      label: 'Scholarships',
      title: 'Scholarships and bursaries',
    });
  });

  it('explains address conflicts and marks the fields the server rejected', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        "Invalid page: path: '/parking' is already used by page 'parking-id'; sections[0].label: must be a non-empty string",
      ),
    );
    await renderAt('/admin/pages/scholarships');

    fireEvent.change(await screen.findByLabelText('Path'), { target: { value: '/parking' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Another page already uses /parking. Choose a different web address.');
    expect(alert).toHaveTextContent('Check label and try again.');
    expect(screen.getByLabelText('Path')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Path')).toHaveAccessibleDescription(
      /Another page already uses \/parking/,
    );
    expect(screen.getByLabelText('Section 1 label')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a real address conflict response at the web address field', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(errorResponse(400, 'bad-request', "path: '/parking' is already used by page 'parking-id'"));
    await renderAt('/admin/pages/scholarships');
    const path = screen.getByLabelText('Path');
    fireEvent.change(path, { target: { value: '/parking' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Another page already uses /parking. Choose a different web address.');
    expect(path.closest('.admin-field')).toContainElement(alert);
    expect(path).toHaveAccessibleDescription(/Another page already uses \/parking/);
    expect(path).toHaveFocus();
    expect(path).toHaveValue('/parking');
    expect(screen.queryByText(/The action failed/)).not.toBeInTheDocument();
  });

  it('describes the public path in plain words', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    expect(screen.getByLabelText('Path')).toHaveAccessibleDescription('The page’s web address, such as /scholarships.');
  });

  it('follows the label until the address is edited and explains invalid addresses before saving', async () => {
    await renderAt('/admin/pages/new');
    const label = screen.getByLabelText('Navigation label');
    const path = screen.getByLabelText('Path');
    fireEvent.change(label, { target: { value: 'Café & Parking' } });
    expect(path).toHaveValue('/cafe-parking');
    fireEvent.change(label, { target: { value: 'Pitch' } });
    expect(path).toHaveValue('/pitch-page');

    fireEvent.change(path, { target: { value: '' } });
    fireEvent.change(label, { target: { value: 'Pitch a session' } });
    expect(path).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a web address that starts with /, such as /parking.');
    expect(path.closest('.admin-field')).toContainElement(screen.getByRole('alert'));
    expect(path).toHaveFocus();

    fireEvent.change(path, { target: { value: '/pitch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert')).toHaveTextContent('/pitch is used by the system. Choose another address, such as /pitch-a-session.');
    expect(path.closest('.admin-field')).toContainElement(screen.getByRole('alert'));
    expect(path).toHaveAttribute('aria-invalid', 'true');
    expect(path).toHaveValue('/pitch');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('states a system page’s address without offering to change it', async () => {
    draftDocs = [{
      ...SCHOLARSHIPS_DRAFT,
      id: 'schedule',
      label: 'Schedule',
      path: '/schedule',
      systemPage: true,
    }];
    await renderAt('/admin/pages/schedule');

    // The route this page renders through is declared in the app's code, so
    // editing the field here would strand the document rather than move the
    // page. The server refuses the change; the room does not offer it.
    const path = await screen.findByLabelText('Path');
    expect(path).toHaveAttribute('readonly');
    expect(path).toHaveValue('/schedule');
    expect(screen.getByText(/This built-in page has a fixed web address/i))
      .toBeInTheDocument();

    // Everything else about the page is still the operator's to change.
    expect(screen.getByLabelText('Navigation label')).not.toHaveAttribute('readonly');
  });

  it('offers no page heading for a system page, and says why', async () => {
    // A system page writes its own <h1> in its route's code — Schedule.jsx
    // writes "Schedule" — so a heading typed here would rename the browser
    // tab and the link card and leave the page's own heading alone. The
    // room does not offer a control that cannot do what it says.
    draftDocs = [{
      ...SCHOLARSHIPS_DRAFT,
      id: 'schedule',
      label: 'Schedule',
      path: '/schedule',
      systemPage: true,
    }];
    await renderAt('/admin/pages/schedule');

    await screen.findByLabelText('Navigation label');
    expect(screen.queryByLabelText('Page heading')).toBeNull();
    expect(screen.getByText('This built-in page sets its own heading.')).toBeInTheDocument();
  });

  it('offers the page heading on a content page, whose heading it sets', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');

    expect(await screen.findByLabelText('Page heading')).toBeInTheDocument();
    expect(screen.queryByText('This built-in page sets its own heading.')).toBeNull();
  });

  it('leaves a regular page’s address editable', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');

    const path = await screen.findByLabelText('Path');
    expect(path).not.toHaveAttribute('readonly');
    fireEvent.change(path, { target: { value: '/bursaries' } });
    expect(screen.getByLabelText('Path')).toHaveValue('/bursaries');
  });

  it('reflects the systemPage delete guard instead of letting the operator hit it', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'home', label: 'Home page', systemPage: true }];
    await renderAt('/admin/pages/home');

    // The server refuses this delete, so the room states the refusal in
    // words instead of offering a control that will be rejected.
    expect(await screen.findByText(/you cannot delete it/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this page' })).toBeNull();
  });

  it('deletes a regular page through cmsDeletePage, after stating what is lost', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ entries: [{ revision: 1 }], nextCursor: null }));
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', deleted: true }));
    await renderAt('/admin/pages/scholarships');

    // Moment 3: the first press opens a still surface that names the cost;
    // the confirm button repeats the consequence rather than saying
    // "Confirm". Opening reads recovery history but does not delete.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this page' }));
    expect(screen.getByText(/The live page and its draft both go/)).toBeInTheDocument();
    expect(await screen.findByText(/Published versions can be restored as a draft/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toMatch(/\/cmsGetVersionHistory$/);
    expect(bodyOf(0)).toEqual({ docPath: 'cmsPages/scholarships', limit: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Delete this page' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(1)).toMatch(/\/cmsDeletePage$/);
    expect(bodyOf(1)).toEqual({ id: 'scholarships' });
  });

  it('starts existing sections collapsed and keeps changes through reopening', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    const section = await screen.findByRole('button', { name: 'Intro 0 blocks' });
    expect(section).toHaveAttribute('aria-expanded', 'false');
    // Hidden number constraints must not stop the server validation path.
    expect(section.closest('form')).toHaveAttribute('novalidate');
    expect(screen.getByLabelText('Section 1 label')).not.toBeVisible();
    fireEvent.click(section);
    fireEvent.change(screen.getByLabelText('Section 1 label'), { target: { value: 'Introduction' } });
    fireEvent.click(section);
    fireEvent.click(section);
    expect(screen.getByLabelText('Section 1 label')).toHaveValue('Introduction');
    expect(screen.queryByRole('button', { name: /Allowed block types/ })).toBeNull();
  });

  it('keeps the open section and focused move control with their record after reordering', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, sections: ['Intro', 'Details', 'Closing'].map((label, index) => ({ ...SCHOLARSHIPS_DRAFT.sections[0], id: `section-${index}`, label })) }];
    await renderAt('/admin/pages/scholarships');
    const intro = await screen.findByRole('button', { name: 'Intro 0 blocks' });
    fireEvent.click(intro);
    expect(screen.getByRole('button', { name: 'Drag section 1' })).toBeInTheDocument();
    const move = screen.getByRole('button', { name: 'Move section 1 down' });
    move.focus();
    fireEvent.click(move);
    expect(intro).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Details 0 blocks' })).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(move);
    expect(move).toHaveAccessibleName('Move section 2 down');
    fireEvent.click(move);
    expect(screen.getByLabelText('Section 3 label')).toHaveValue('Intro');
    expect(intro).toHaveAttribute('aria-expanded', 'true');
  });

  it('reveals a collapsed section when its validation fails', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    fetch.mockResolvedValueOnce(errorResponse(400, 'bad-request', 'Invalid page: sections[0].maxBlocks: must be an integer >= 1'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Intro 0 blocks' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Section 1 max blocks')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Allowed block types/ })).not.toBeInTheDocument();
  });

  it('reveals a rejected individual layout setting', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    fetch.mockResolvedValueOnce(errorResponse(400, 'bad-request', 'Invalid page: layout.navPlacement: choose a supported position'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByRole('alert');
    expect(await screen.findByRole('combobox', { name: 'Navigation on this page' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide the individual settings' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('qualifies a completed save when a newer edit was typed while it ran', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    let answer;
    fetch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'Newer label' } });
    await act(async () => { answer(okResponse({ id: 'scholarships', status: 'dirty' })); });
    expect(screen.getByLabelText('Navigation label')).toHaveValue('Newer label');
    expect(screen.getByText(/Newer edits are still unsaved/)).toHaveAttribute('role', 'status');
  });

  it('keeps repeated save and publish results in the action band without stacking notifications', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    const actions = screen.getByRole('button', { name: 'Save draft' }).closest('header');
    for (const label of ['First revision', 'Second revision', 'Third revision']) {
      fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
      fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: label } });
      fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
      const result = await within(actions).findByRole('status');
      expect(result).toHaveTextContent('Draft saved. It is not public until you publish.');
      expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
    }
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }))
      .mockResolvedValueOnce(okResponse({ results: { cmsPages: { published: ['scholarships'], skipped: [] } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await within(actions).findByRole('status')).toHaveTextContent('Published. The public site picks it up live.');
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(screen.queryByRole('button', { name: 'Dismiss notification' })).not.toBeInTheDocument();
  });

  it('takes focus to an added section, and restores it after its removal', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    const add = await screen.findByRole('button', { name: 'Add section' });
    fireEvent.click(add);
    expect(screen.getByLabelText('Section 2 label')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Remove section 2' }));
    const intro = screen.getByRole('button', { name: 'Intro 0 blocks' });
    expect(intro).toHaveFocus();
  });

  // The starter list is not edited here (issue #1153), but a save must not
  // drop or rewrite it: a new site is still seeded from it.
  it('passes stored starter blocks through a save unchanged', async () => {
    const defaultBlocks = [
      { field: 'body', blockType: 'richtext', description: 'The programme in a paragraph.' },
      { field: 'closing', blockType: 'text', description: 'A closing line.' },
    ];
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, sections: [{ ...SCHOLARSHIPS_DRAFT.sections[0], defaultBlocks }] }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    fireEvent.click(await screen.findByRole('button', { name: 'Intro 0 blocks' }));
    fireEvent.change(screen.getByLabelText('Section 1 label'), { target: { value: 'Introduction' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.sections[0].label).toBe('Introduction');
    expect(bodyOf(0).page.sections[0].defaultBlocks).toEqual(defaultBlocks);
  });

  // Section layout (issue #1153): chosen by picture on the section, stored
  // only when it differs from reading width.
  it('saves a section layout chosen by picture, and reading width as no value', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, sections: [{ ...SCHOLARSHIPS_DRAFT.sections[0], layout: 'wide' }] }];
    fetch.mockResolvedValue(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    fireEvent.click(await screen.findByRole('button', { name: 'Intro 0 blocks' }));
    const layout = screen.getByRole('group', { name: 'Layout' });
    expect(within(layout).getByRole('radio', { name: 'Wide' })).toBeChecked();

    fireEvent.click(within(layout).getByRole('radio', { name: 'Two columns' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.sections[0].layout).toBe('columns');

    fireEvent.click(within(layout).getByRole('radio', { name: 'Reading width' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(bodyOf(1).page.sections[0]).not.toHaveProperty('layout');
  });

  // Layout variants and section slots (design brief §6.1, §6.2).
  // THE OPERATOR PICKS A TASK. The individual variants are still reachable,
  // behind a disclosure, for the page that genuinely needs to differ.
  async function openIndividualSettings() {
    fireEvent.click(await screen.findByRole('button', { name: 'Change the individual settings' }));
  }

  it('names six tasks and no design-system parts in the main editor', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');

    const template = await screen.findByLabelText('Template');
    expect(within(template).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Standard page',
      'Feature first',
      'Directory with introduction',
      'Long read',
      'Schedule',
      'Landing page',
      'Custom — set by hand below',
    ]);
    // The parts are not in the main editor: they are inside a collapsed
    // disclosure, which is not in the accessibility tree until it opens.
    expect(screen.queryByRole('combobox', { name: 'Header' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Arrangement' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Density' })).toBeNull();
  });

  it('sets the whole bundle from one template pick', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.change(await screen.findByLabelText('Template'), { target: { value: 'long-read' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const { page } = bodyOf(0);
    expect(page.template).toBe('long-read');
    expect(page.layout).toEqual({
      header: 'nameplate-compact',
      arrangement: 'list',
      density: 'loose',
    });
  });

  it('stops claiming a template once a part is set by hand', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, template: 'standard', layout: { density: 'comfortable' } }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    expect(await screen.findByLabelText('Template')).toHaveValue('standard');

    await openIndividualSettings();
    fireEvent.change(screen.getByLabelText('Arrangement'), { target: { value: 'grid' } });
    expect(screen.getByLabelText('Template')).toHaveValue('custom');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const { page } = bodyOf(0);
    expect(page.template).toBeNull();
    expect(page.layout).toEqual({ density: 'comfortable', arrangement: 'grid' });
  });

  it('claims no template for a page that never named one', async () => {
    // Two of "Long read"'s three values, by coincidence. A page whose
    // values happen to match a template has not chosen that template.
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, layout: { density: 'loose', arrangement: 'list' } }];
    await renderAt('/admin/pages/scholarships');
    expect(await screen.findByLabelText('Template')).toHaveValue('custom');
  });

  it('sends the individual settings the operator picked, and offers no headerless option', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    await openIndividualSettings();

    // Every public page keeps a nameplate: compact is the smallest header.
    const header = screen.getByLabelText('Header');
    expect(within(header).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Full nameplate',
      'Compact nameplate',
    ]);

    fireEvent.change(screen.getByLabelText('Arrangement'), { target: { value: 'grid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // The one control the operator moved, and nothing else: a page that
    // never chose a density or a header keeps choosing neither, so it goes
    // on following the theme instead of being pinned by a save.
    expect(bodyOf(0).page.layout).toEqual({ arrangement: 'grid' });
  });

  // NAVIGATION: THE SITE'S ANSWER, WITH A PAGE-LEVEL EXCEPTION (this
  // review). It is not one of the three values a template bundles, so it
  // sits in Advanced and picking a template neither sets it nor clears it.
  it('offers the site setting by name, and a page-level exception beside it', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    await openIndividualSettings();

    const nav = screen.getByLabelText('Navigation on this page');
    // A page that states nothing follows the site, and the option says what
    // following it means rather than sending the operator to another tab.
    expect(nav).toHaveValue('');
    expect(within(nav).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Follow the site setting — Across the top',
      'Only this page: Across the top',
      'Only this page: Down the side',
    ]);
    // The words are the Branding tab's words. The setting is offered in two
    // places and an operator has to recognize their own choice in both, so
    // both read one list — lib/themeRuntime.js NAV_PLACEMENT_LABELS.
    expect(NAV_PLACEMENT_LABELS).toEqual({ top: 'Across the top', side: 'Down the side' });
  });

  it('stores a page-level navigation exception without disturbing the template', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, template: 'long-read', layout: { density: 'loose' } }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    await openIndividualSettings();

    fireEvent.change(screen.getByLabelText('Navigation on this page'), {
      target: { value: 'side' },
    });
    // Nav is not one of the three values a template bundles, so a Long read
    // with a rail beside it is still a Long read.
    expect(screen.getByLabelText('Template')).toHaveValue('long-read');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const { page } = bodyOf(0);
    expect(page.template).toBe('long-read');
    expect(page.layout).toEqual({ density: 'loose', navPlacement: 'side' });
  });

  it('clears the exception back to absence, not to a word meaning nothing', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, layout: { navPlacement: 'side' } }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    await openIndividualSettings();
    expect(screen.getByLabelText('Navigation on this page')).toHaveValue('side');

    fireEvent.change(screen.getByLabelText('Navigation on this page'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // The key is GONE, not set to 'top'. A page that says nothing follows
    // the site setting wherever it goes next; a page pinned to 'top' would
    // silently stop following it.
    expect(bodyOf(0).page.layout).toEqual({});
  });

  it('opens a stored layout on what the page says, not on the defaults', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, layout: { density: 'tight' } }];
    await renderAt('/admin/pages/scholarships');
    await openIndividualSettings();
    expect(screen.getByLabelText('Density')).toHaveValue('tight');
    expect(screen.getByLabelText('Arrangement')).toHaveValue('list');
  });

  it('names the two insertion points in terms of the page, on a system page only', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'home', label: 'Home page', systemPage: true }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'home', status: 'dirty' }));
    await renderAt('/admin/pages/home');
    fireEvent.click(await screen.findByRole('button', { name: 'Intro 0 blocks' }));

    // A section stored before this schema landed carries no slot; it reads
    // as main, which is where it has always rendered — and "after the main
    // feature" is what that position IS, in the operator's words.
    const position = await screen.findByLabelText('Section 1 position');
    expect(within(position).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Before the main feature',
      'After the main feature',
    ]);
    expect(position).toHaveValue('main');

    fireEvent.change(position, { target: { value: 'above' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // The storage key is unchanged: only the words the operator reads are.
    expect(bodyOf(0).page.sections[0].slot).toBe('above');
  });

  it('leaves a section already stored below the feature exactly where it is', async () => {
    // `below` is a third stored position with no third name — it renders
    // after the feature, which is what the control says about it. Touching
    // nothing must not move it.
    draftDocs = [
      {
        ...SCHOLARSHIPS_DRAFT,
        id: 'home',
        label: 'Home page',
        systemPage: true,
        sections: [{ ...SCHOLARSHIPS_DRAFT.sections[0], slot: 'below' }],
      },
    ];
    fetch.mockResolvedValueOnce(okResponse({ id: 'home', status: 'dirty' }));
    await renderAt('/admin/pages/home');

    expect(await screen.findByLabelText('Section 1 position')).toHaveValue('main');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.sections[0].slot).toBe('below');
  });

  it('hides the section position on a custom page, which has no core content', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    await screen.findByLabelText('Template');
    expect(screen.queryByLabelText('Section 1 position')).toBeNull();
  });

  // A section's content is written under Content. The section counts the
  // blocks it holds there, not its starter list, and links to them.
  it('counts a section’s content blocks and links to them, without a palette disclosure', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT, { id: 'intro__body', section: 'intro', field: 'body', blockType: 'richtext', value: '<p>Body</p>' }];
    await renderAt('/admin/pages/scholarships');
    fireEvent.click(await screen.findByRole('button', { name: 'Intro 1 block' }));
    expect(screen.getByRole('link', { name: 'Add or edit the content in Intro' })).toHaveAttribute('href', '/admin/content/scholarships/intro');
    expect(screen.queryByText('Save the page, then add its content.')).toBeNull();
    expect(screen.queryByRole('button', { name: /Allowed block types/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add block to section/ })).toBeNull();
  });

  // The picker that shows this restriction is the block editor's
  // (AdminContentBlockEditor.test.jsx); the page keeps it in saved data.
  it('keeps the Home hero restriction in saved data', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'home', path: '/', systemPage: true, sections: [{ ...SCHOLARSHIPS_DRAFT.sections[0], id: 'hero', label: 'Hero', allowedBlocks: ['text', 'cta', 'image'], defaultBlocks: [] }] }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'home', status: 'dirty' }));
    await renderAt('/admin/pages/home');
    fireEvent.click(await screen.findByRole('button', { name: 'Hero 0 blocks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page.sections[0].allowedBlocks).toEqual(['text', 'cta', 'image']);
  });

  it('hides internal ids and the icon name while preserving them on save', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, icon: 'book-open' }];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');
    fireEvent.click(await screen.findByRole('button', { name: 'Intro 0 blocks' }));
    expect(screen.queryByLabelText('Page id')).toBeNull();
    expect(screen.queryByLabelText('Section 1 id')).toBeNull();
    expect(screen.queryByLabelText('Icon')).toBeNull();
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: '' } });
    expect(screen.getByRole('heading', { level: 1, name: 'Page' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'Support' } });
    fireEvent.change(screen.getByLabelText('Section 1 label'), { target: { value: 'Apply' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).page).toMatchObject({ id: 'scholarships', icon: 'book-open', sections: [{ id: 'intro', allowedBlocks: [] }] });
  });

  it('associates labels, help, descriptions and controls for page and section fields', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');
    fireEvent.click(await screen.findByRole('button', { name: 'Intro 0 blocks' }));
    for (const label of ['Navigation label', 'Page heading', 'Path', 'Section 1 label', 'Section 1 max blocks']) {
      const input = screen.getByLabelText(label);
      const field = input.closest('.admin-field');
      expect(field.querySelector('.admin-field__label')).toHaveTextContent(label);
      expect(input).toHaveClass('admin-field__control');
      const descriptionIds = input.getAttribute('aria-describedby').split(' ');
      for (const id of descriptionIds) expect(document.getElementById(id).textContent.trim()).not.toBe('');
      expect(field.querySelector('.admin-help-trigger')).toHaveAccessibleName(`Help with ${label}`);
    }
    expect(screen.getByLabelText('Section 1 is reorderable').closest('.admin-field-toggle')).toBeInTheDocument();
  });

});

describe('publish results and recovery', () => {
  it('reports a resumed list publish against the ids the failed run asked for', async () => {
    const latePage = {
      ...SCHOLARSHIPS_DRAFT,
      id: 'late-page',
      label: 'Late page',
      path: '/late-page',
      status: undefined,
    };
    liveDocs = [latePage];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: { code: 'publish-failed', message: 'Publish failed part-way.' },
        queueId: 'queue-list',
      }),
    });
    await renderAt('/admin/pages');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish all (1)' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });

    // A page outside the failed run gains a draft before the operator
    // resumes. It remains pending, but it was not one of the attempted ids.
    act(() => adminSubscriptions.get('cmsPages_drafts')([
      SCHOLARSHIPS_DRAFT,
      { ...latePage, label: 'Late unpublished edit', status: 'dirty' },
    ]));
    expect(screen.getByRole('button', { name: 'Publish all (2)' })).toBeInTheDocument();

    fetch.mockResolvedValueOnce(okResponse({
      results: { cmsPages: { published: ['scholarships'], skipped: [] } },
    }));
    fireEvent.click(resume);

    expect(await screen.findByText(
      'Published.',
      { selector: 'p[role="status"]' },
    )).toBeInTheDocument();
    expect(bodyOf(1)).toEqual({ queueId: 'queue-list' });
    expect(screen.queryByText(/late-page was skipped/)).toBeNull();
  });

  it('waits for BOTH revisions before judging publish state', async () => {
    // With only the live listener in, a draft-only page reads as "no such
    // page" and a clean draft reads as never published — which Publish all
    // would then republish, bumping revisions for nothing.
    liveDocs = [];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    silentCollections = ['cmsPages_drafts'];
    await renderAt('/admin/pages');

    expect(screen.getByText('Loading pages…', { selector: '.loading-status__label' })).toBeInTheDocument();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.queryByRole('button', { name: /Publish all/ })).toBeNull();
  });

  it('still resolves the wait when a listener errors, rather than spinning', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    silentCollections = ['cmsPages_drafts'];
    listenerError = new Error('permission denied');
    await renderAt('/admin/pages');

    await waitFor(() => {
      expect(screen.queryByText('Loading pages…', { selector: '.loading-status__label' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();
    });
  });

  it('does not claim success when cmsPublish skipped the page', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }))
      .mockResolvedValueOnce(
        okResponse({
          queueId: 'q1',
          status: 'done',
          results: {
            cmsPages: {
              published: [],
              skipped: [{ docId: 'scholarships', reason: 'conflict' }],
            },
          },
        }),
      );
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(await screen.findByRole('button', { name: 'Save and publish' }));

    // The error summary carries the refused-publish verdict.
    expect(
      (await screen.findAllByText(/One item was edited while publishing/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/picks it up live/i)).toBeNull();
  });

  it('resumes a part-way publish with its queueId instead of republishing', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: 'publish-failed', message: 'Publish failed part-way. Re-run with { queueId } to resume.' },
          queueId: 'queue-42',
        }),
      })
      .mockResolvedValueOnce(
        okResponse({
          queueId: 'queue-42',
          status: 'done',
          results: { cmsPages: { published: ['scholarships'], skipped: [] } },
        }),
      );
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(await screen.findByRole('button', { name: 'Save and publish' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });

    fireEvent.click(resume);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    // { queueId } — NOT a fresh { collection, docIds }, which would publish
    // the chunks that already committed a second time.
    expect(bodyOf(2)).toEqual({ queueId: 'queue-42' });
    expect(await screen.findByText(/picks it up live/i, { selector: 'p[role="status"]' })).toBeInTheDocument();
  });

  it('keeps a created page’s id fixed when the publish half fails', async () => {
    fetch
      .mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: 'publish-failed', message: 'Publish failed part-way.' },
          queueId: 'queue-42',
        }),
      });
    await renderAt('/admin/pages/new');

    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'Scholarships' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/scholarships' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await screen.findByRole('alert');
    // The draft landed, so the id must stop being editable: retrying under a
    // different id would create a second document and orphan this draft.
    expect(screen.queryByLabelText('Page id')).toBeNull();
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    fireEvent.change(screen.getByLabelText('Navigation label'), { target: { value: 'Support' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(bodyOf(2).page.id).toBe('scholarships');
    expect(screen.getByRole('button', { name: 'Delete this page' })).toBeInTheDocument();
  });

  it('publish all reports skipped pages instead of a blanket success', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined, revision: 2 }];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(
      okResponse({
        queueId: 'q1',
        status: 'done',
        results: {
          cmsPages: { published: [], skipped: [{ docId: 'scholarships', reason: 'no-draft' }] },
        },
      }),
    );
    await renderAt('/admin/pages');

    fireEvent.click(await screen.findByRole('button', { name: 'Publish all (1)' }));
    const alerts = await screen.findAllByRole('alert');
    expect(
      alerts.some((el) => /One item had nothing new to publish/i.test(el.textContent)),
    ).toBe(true);
  });
});
