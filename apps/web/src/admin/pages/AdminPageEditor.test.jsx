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
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
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
  query: vi.fn(() => ({})),
  limit: vi.fn(() => ({})),
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';
import { RESERVED_PATH_SEGMENTS } from 'shared/routing';
import { NAV_PLACEMENT_LABELS } from '../../lib/themeRuntime.js';

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
  await waitFor(
    () => {
      expect(screen.queryByLabelText('Loading admin')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 5000 },
  );
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
  silentCollections = [];
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
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

  it('fails soft when a listener errors: rows stay, with a non-blocking notice', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    listenerError = new Error('permission denied');
    await renderAt('/admin/pages');

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent(/lost the connection/i);
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
    expect(bodyOf(0)).toEqual({ collection: 'cmsPages', docIds: ['scholarships'] });
  });
});

describe('page editor', () => {
  it('creates a page and saves it as a draft only (issue #13 done-when)', async () => {
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/new');

    fireEvent.change(screen.getByLabelText('Page id'), { target: { value: 'scholarships' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Scholarships' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/scholarships' } });

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
      path: '/scholarships',
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

    fireEvent.click(await screen.findByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(0)).toMatch(/\/cmsSavePage$/);
    expect(urlOf(1)).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1)).toEqual({ collection: 'cmsPages', docIds: ['scholarships'] });
  });

  it('sends only the fields the server accepts, dropping stored bookkeeping', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    const { page } = bodyOf(0);
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
        'visible',
      ].sort(),
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

    fireEvent.change(await screen.findByLabelText('Path'), { target: { value: 'scholarships' } });
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

  it('names the reserved route segments from the shared registry', async () => {
    // Root-level paths are canonical (issue #52), so an operator needs to
    // know which first segments the built-in routes already own. The list is
    // read from shared/routing — the same registry cmsSavePage validates
    // against — rather than restated here.
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');

    const hint = (await screen.findByLabelText('Path')).getAttribute('aria-describedby');
    const hintText = document.getElementById(hint.split(' ')[0]).textContent;
    for (const segment of RESERVED_PATH_SEGMENTS) {
      expect(hintText).toContain(segment);
    }
    expect(hintText).not.toMatch(/\/p\//);
  });

  it('surfaces the server’s reserved-path and collision rejections verbatim', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        "path: 'schedule' is a reserved route and cannot be used by a page",
      ),
    );
    await renderAt('/admin/pages/scholarships');

    fireEvent.change(await screen.findByLabelText('Path'), { target: { value: '/schedule' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "path: 'schedule' is a reserved route and cannot be used by a page",
    );
    expect(screen.getByLabelText('Path')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reflects the systemPage delete guard instead of letting the operator hit it', async () => {
    draftDocs = [{ ...SCHOLARSHIPS_DRAFT, id: 'home', label: 'Home page', systemPage: true }];
    await renderAt('/admin/pages/home');

    // The server refuses this delete, so the room states the refusal in
    // words instead of offering a control that will be rejected.
    expect(await screen.findByText(/cannot be deleted/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this page' })).toBeNull();
  });

  it('deletes a regular page through cmsDeletePage, after stating what is lost', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', deleted: true }));
    await renderAt('/admin/pages/scholarships');

    // Moment 3: the first press opens a still surface that names the cost;
    // the confirm button repeats the consequence rather than saying
    // "Confirm", and nothing is sent until it is pressed.
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this page' }));
    expect(screen.getByText(/The live page and its draft both go/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete this page' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsDeletePage$/);
    expect(bodyOf(0)).toEqual({ id: 'scholarships' });
  });

  it('adds, reorders, and removes blocks within a section', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ id: 'scholarships', status: 'dirty' }));
    await renderAt('/admin/pages/scholarships');

    fireEvent.click(await screen.findByRole('button', { name: 'Add block to section 1' }));
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

  it('offers only the section’s allowed block types in the block picker', async () => {
    draftDocs = [SCHOLARSHIPS_DRAFT];
    await renderAt('/admin/pages/scholarships');

    const picker = await screen.findByLabelText('Block 1 type — section 1');
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

describe('publish results and recovery', () => {
  it('waits for BOTH revisions before judging publish state', async () => {
    // With only the live listener in, a draft-only page reads as "no such
    // page" and a clean draft reads as never published — which Publish all
    // would then republish, bumping revisions for nothing.
    liveDocs = [];
    draftDocs = [SCHOLARSHIPS_DRAFT];
    silentCollections = ['cmsPages_drafts'];
    await renderAt('/admin/pages');

    expect(screen.getByRole('status', { name: 'Loading pages…' })).toBeInTheDocument();
    expect(screen.queryByText('Draft')).toBeNull();
    expect(screen.queryByRole('button', { name: /Publish all/ })).toBeNull();
  });

  it('still resolves the wait when a listener errors, rather than spinning', async () => {
    liveDocs = [{ ...SCHOLARSHIPS_DRAFT, status: undefined }];
    silentCollections = ['cmsPages_drafts'];
    listenerError = new Error('permission denied');
    await renderAt('/admin/pages');

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Loading pages…' })).toBeNull();
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

    // Both the inline status and the toast carry the verdict.
    expect(
      (await screen.findAllByText(/scholarships was edited while publishing/i)).length,
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
    expect((await screen.findAllByText(/picks it up live/i)).length).toBeGreaterThan(0);
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

    fireEvent.change(screen.getByLabelText('Page id'), { target: { value: 'scholarships' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Scholarships' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/scholarships' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await screen.findByRole('alert');
    // The draft landed, so the id must stop being editable: retrying under a
    // different id would create a second document and orphan this draft.
    expect(screen.getByLabelText('Page id')).toHaveAttribute('readonly');
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
      alerts.some((el) => /scholarships has no draft to publish/i.test(el.textContent)),
    ).toBe(true);
  });
});
