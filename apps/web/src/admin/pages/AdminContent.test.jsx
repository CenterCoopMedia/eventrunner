// Content-block editor flows (issue #61). AdminPageEditor already lets staff
// shape a page's structure; this suite covers the screens that let them fill
// in what a block actually says — browse page → section → block, edit its
// registry-driven VALUE, save as draft or publish, create, and delete —
// following the same mocked-HTTP-seam pattern as AdminPageEditor.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import Quill from 'quill/core.js';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

// The admin CMS reads all four revisions (cmsPages/_drafts, cmsContent/_drafts);
// each test seeds what the listeners report per collection. Collections
// listed in `silentCollections` never report — the window in which one
// revision is known and the other is not (e.g. live arrives before drafts).
let sources = {};
let listenerError = null;
let silentCollections = [];
const adminSubscriptions = new Map();
const adminErrors = new Map();
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    adminSubscriptions.set(name, onNext);
    adminErrors.set(name, onError);
    if (!silentCollections.includes(name)) onNext(sources[name] ?? []);
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
  getDocs: vi.fn(() => Promise.resolve({ docs: [] })),
}));

import App from '../../App.jsx';
import { BLOCK_TYPE_IDS } from '../blockTypes.js';
import { sectionEditPath } from '../../components/SectionEditLink.jsx';

const SCHOLARSHIPS_PAGE = {
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
      allowedBlocks: ['richtext', 'stat'],
      maxBlocks: 2,
      reorderable: true,
      defaultBlocks: [
        { field: 'body', blockType: 'richtext', description: 'The programme in a paragraph.' },
      ],
    },
  ],
};

const BODY_BLOCK_DRAFT = {
  id: 'intro__body',
  section: 'intro',
  field: 'body',
  blockType: 'richtext',
  value: '<p>Scholarships open in spring.</p>',
  order: 1,
  visible: true,
  // Publish-model bookkeeping a stored doc carries; the generic content
  // endpoints reject reserved keys by name, so these must not travel back.
  status: 'dirty',
  revision: 2,
  updatedAt: 'ignored',
};

// A block type NOT in the 'intro' section's allowedBlocks, loaded as an
// existing doc — the block-type picker's "widen to show a mismatched
// existing type" path, and the fixture for switching types (label/url/
// external are stale once switched to e.g. 'stat').
const CTA_BLOCK_DRAFT = {
  id: 'intro__cta1',
  section: 'intro',
  field: 'cta1',
  blockType: 'cta',
  label: 'Apply now',
  url: 'https://example.org/apply',
  external: false,
  order: 2,
  visible: true,
  status: 'clean',
  revision: 1,
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
      expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
    },
    // The admin chunk now pulls the whole public app in with it (the theme
    // editor's frame renders real pages), so the first mount in a file can
    // outrun the default budget on a loaded machine.
    { timeout: 5000 },
  );
  return result;
}

function bodyOf(callIndex) {
  return JSON.parse(fetch.mock.calls[callIndex][1].body);
}
function urlOf(callIndex) {
  return String(fetch.mock.calls[callIndex][0]);
}

async function findRichText(name = 'Text') {
  return screen.findByRole('textbox', { name });
}

async function replaceRichText(editor, html, text) {
  const quill = Quill.find(editor.parentElement);
  quill.setSelection(0, Math.max(0, quill.getLength() - 1), 'silent');
  fireEvent.paste(editor, {
    clipboardData: {
      getData(type) {
        return type === 'text/html' ? html : text;
      },
    },
  });
  await waitFor(() => expect(editor.innerHTML).toBe(html));
}

beforeEach(() => {
  sources = { cmsPages: [], cmsPages_drafts: [], cmsContent: [], cmsContent_drafts: [] };
  listenerError = null;
  silentCollections = [];
  adminSubscriptions.clear();
  adminErrors.clear();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const HOME_PAGE = {
  id: 'home', label: 'Home', path: '/',
  sections: [{ id: 'hero', label: 'Hero', allowedBlocks: ['text', 'cta', 'image'], maxBlocks: 4 }],
};
const HERO_TEXT = ['title', 'subtitle'].map((field, order) => ({
  id: `hero__${field}`, section: 'hero', field, blockType: 'text', value: field, order,
}));

function heroUnloadBlocked() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe('the Home hero image slot', () => {
  beforeEach(() => {
    sources.cmsPages = [HOME_PAGE];
    sources.cmsContent = HERO_TEXT;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('creates a draft without a block type choice and can replace it after deletion', async () => {
    fetch.mockResolvedValue(okResponse({ docId: 'hero__image', status: 'dirty' }));
    await renderAt('/admin/content/home/hero');
    const hero = within((await screen.findByRole('heading', { name: 'Hero image' })).closest('section'));
    expect(hero.getByLabelText('Hero image')).toHaveAttribute('placeholder', 'Choose an image');
    expect(hero.getByLabelText('Alt text')).toHaveAttribute('aria-required', 'true');
    fireEvent.change(hero.getByLabelText('Hero image'), { target: { value: 'cms-images/hero.jpg' } });
    fireEvent.change(hero.getByLabelText('Alt text'), { target: { value: 'People at the event' } });
    fireEvent.click(hero.getByRole('button', { name: 'Save draft' }));
    await hero.findByText('Draft saved. Publish to show it on your site.');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toMatch(/\/cmsCreateContent$/);
    expect(bodyOf(0)).toEqual({
      pageId: 'home', section: 'hero', field: 'image', visible: true,
      fields: { blockType: 'image', url: 'cms-images/hero.jpg', alt: 'People at the event', order: 2 },
    });
    // Keep this session's editor/result as the listener adds the normal row.
    act(() => adminSubscriptions.get('cmsContent_drafts')([
      { id: 'hero__image', section: 'hero', field: 'image', blockType: 'image', url: 'cms-images/hero.jpg', alt: 'People at the event' },
    ]));
    expect(hero.getByLabelText('Hero image')).toHaveValue('cms-images/hero.jpg');
    expect(hero.getByText('Draft saved. Publish to show it on your site.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People at the event' })).toHaveAttribute('href', '/admin/content/home/hero/image');
    const imageRow = screen.getByRole('link', { name: 'People at the event' }).closest('li');
    fetch.mockResolvedValueOnce(okResponse({ entries: [], nextCursor: null }));
    fireEvent.click(within(imageRow).getByRole('button', { name: 'Delete', exact: true }));
    await within(imageRow).findByText(/has no published version and cannot be restored after deletion/);
    fireEvent.click(within(imageRow).getByRole('button', { name: 'Delete this block' }));
    await within(imageRow).findByText(/deleted. The live block and its draft were removed/);
    act(() => adminSubscriptions.get('cmsContent_drafts')([]));
    expect(hero.getByLabelText('Hero image')).toHaveValue('');
    expect(hero.getByLabelText('Alt text')).toHaveValue('');
    expect(heroUnloadBlocked()).toBe(false);
    fireEvent.change(hero.getByLabelText('Hero image'), { target: { value: 'cms-images/replacement.jpg' } });
    fireEvent.change(hero.getByLabelText('Alt text'), { target: { value: 'A replacement picture' } });
    fireEvent.click(hero.getByRole('button', { name: 'Save draft' }));
    await hero.findByText('Draft saved. Publish to show it on your site.');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(urlOf(1)).toMatch(/\/cmsGetVersionHistory$/);
    expect(urlOf(2)).toMatch(/\/cmsDeleteContent$/);
    expect(urlOf(3)).toMatch(/\/cmsCreateContent$/);
    expect(bodyOf(3).fields).toMatchObject({ url: 'cms-images/replacement.jpg', alt: 'A replacement picture' });
  });

  it.each(['success', 'failure'])('keeps a delayed publish %s after the draft listener adds the image', async (outcome) => {
    let finishPublish;
    const publication = new Promise((resolve) => { finishPublish = resolve; });
    fetch.mockResolvedValueOnce(okResponse({ docId: 'hero__image' }))
      .mockImplementationOnce(() => publication);
    await renderAt('/admin/content/home/hero');
    fireEvent.change(screen.getByLabelText('Hero image'), { target: { value: 'cms-images/hero.jpg' } });
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'People at the event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    act(() => adminSubscriptions.get('cmsContent_drafts')([
      { id: 'hero__image', section: 'hero', field: 'image', blockType: 'image', url: 'cms-images/hero.jpg', alt: 'People at the event', visible: true, order: 2 },
    ]));
    const stayedMounted = screen.queryByLabelText('Hero image') !== null;
    const reloadWhilePublishing = heroUnloadBlocked();
    await act(async () => finishPublish(okResponse({ results: { cmsContent: outcome === 'success'
      ? { published: ['hero__image'], skipped: [] }
      : { published: [], skipped: [{ docId: 'hero__image', reason: 'conflict' }] } } })));
    expect(stayedMounted).toBe(true);
    expect(reloadWhilePublishing).toBe(true);
    if (outcome === 'success') expect(await screen.findByText('Published. The public site picks it up live.')).toBeInTheDocument();
    else expect(await screen.findByText(/The image draft is saved, but it was not published\./)).toBeInTheDocument();
    expect(screen.getByLabelText('Hero image')).toHaveValue('cms-images/hero.jpg');
  });

  it.each([['Hero image', 'cms-images/unsaved.jpg'], ['Alt text', 'Unsaved description']])('guards route navigation and reload for local %s edits', async (label, value) => {
    await renderAt('/admin/content/home/hero');
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    expect(heroUnloadBlocked()).toBe(true);
    const editTitle = screen.getAllByRole('link').find((link) => link.getAttribute('href') === '/admin/content/home/hero/title');
    fireEvent.click(editTitle);
    const dialog = screen.getByRole('alertdialog', { name: 'Unsaved changes' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stay' }));
    expect(screen.getByLabelText(label)).toHaveValue(value);
    fireEvent.click(editTitle);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByLabelText('Hero image')).not.toBeInTheDocument());
    expect(heroUnloadBlocked()).toBe(false);
  });

  it('keeps edits dirty through listener readback and a failed save, clearing only after confirmation', async () => {
    let finishSave;
    fetch.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; }));
    await renderAt('/admin/content/home/hero');
    fireEvent.change(screen.getByLabelText('Hero image'), { target: { value: 'cms-images/hero.jpg' } });
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'People at the event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    act(() => adminSubscriptions.get('cmsContent_drafts')([
      { id: 'hero__image', section: 'hero', field: 'image', blockType: 'image', url: 'cms-images/hero.jpg', alt: 'People at the event', visible: true, order: 2 },
    ]));
    const dirtyDuringSave = heroUnloadBlocked();
    await act(async () => finishSave({ ok: false, json: async () => ({ error: { message: 'Save could not be confirmed.' } }) }));
    expect(dirtyDuringSave).toBe(true);
    expect(await screen.findByText(/Save could not be confirmed/)).toBeInTheDocument();
    expect(heroUnloadBlocked()).toBe(true);
    fetch.mockResolvedValueOnce(okResponse({ docId: 'hero__image' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved. Publish to show it on your site.');
    await waitFor(() => expect(heroUnloadBlocked()).toBe(false));
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'A newer local edit' } });
    expect(heroUnloadBlocked()).toBe(true);
  });

  it('requires non-empty alt text before it creates an image', async () => {
    await renderAt('/admin/content/home/hero');
    fireEvent.change(screen.getByLabelText('Hero image'), { target: { value: 'cms-images/hero.jpg' } });
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByLabelText('Alt text')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Hero image'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'People at the event' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByLabelText('Hero image')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the slot with a plain message when all four places are used', async () => {
    sources.cmsContent = [...HERO_TEXT, ...['extra', 'another'].map((field) => ({
      id: `hero__${field}`, section: 'hero', field, blockType: 'text', value: field,
    }))];
    await renderAt('/admin/content/home/hero');
    expect(screen.getByLabelText('Hero image')).toBeDisabled();
    expect(screen.getByText('The top of your home page is full (4 items). Remove one to add a picture.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });

  it('waits for draft content before it permits creation', async () => {
    silentCollections = ['cmsContent_drafts'];
    await renderAt('/admin/content/home/hero');
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('keeps an existing image in the normal editor and updates the same field', async () => {
    sources.cmsContent_drafts = [{
      id: 'hero__photo', section: 'hero', field: 'photo', blockType: 'image',
      url: 'cms-images/old.jpg', alt: 'The old picture', order: 2,
    }];
    fetch.mockResolvedValue(okResponse({ docId: 'hero__photo', status: 'dirty' }));
    await renderAt('/admin/content/home/hero');
    expect(screen.queryByLabelText('Hero image')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'The old picture' }));
    fireEvent.change(await screen.findByLabelText('Image'), { target: { value: 'cms-images/new.jpg' } });
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'The new picture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsUpdateContent$/);
    expect(bodyOf(0)).toMatchObject({ section: 'hero', field: 'photo', fields: { url: 'cms-images/new.jpg', alt: 'The new picture' } });
  });
});

describe('content browsing', () => {
  it('lists pages, then the sections of the one chosen, then its blocks', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];

    await renderAt('/admin/content');
    expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Scholarships' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Scholarships', exact: true }));
    expect(await screen.findByRole('link', { name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByText(/1 block/)).toBeInTheDocument();
    expect(screen.getByText('Who the scholarships are for.')).toBeInTheDocument();
    expect(screen.getByText('Any content', { exact: false })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit content in Intro' })).toHaveAttribute('href', '/admin/content/scholarships/intro');

    fireEvent.click(screen.getByRole('link', { name: 'Intro', exact: true }));
    expect(await screen.findByRole('link', { name: 'Scholarships open in spring.' })).toBeInTheDocument();
    expect(screen.getByText('Rich text')).toBeInTheDocument();
    // The title band names the section and its identifiers (the editor a
    // public "Edit section" link opens, issue #198).
    expect(screen.getByRole('heading', { level: 1, name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByText('Scholarships · Intro · 1 block')).toBeInTheDocument();
  });

  it('searches page names, paths, and section names without changing page order, and clears back to the field', async () => {
    sources.cmsPages = [
      SCHOLARSHIPS_PAGE,
      { ...SCHOLARSHIPS_PAGE, id: 'about', label: 'About the event', path: '/about', order: 1, sections: [] },
      { ...SCHOLARSHIPS_PAGE, id: 'travel', label: 'Travel', path: '/getting-here', order: 5, sections: [{ id: 'travel_intro', label: 'Intro and directions' }] },
    ];
    await renderAt('/admin/content');
    const search = screen.getByRole('searchbox', { name: 'Search pages and sections' });
    const names = () => within(screen.getByRole('table')).getAllByRole('rowheader')
      .map((cell) => within(cell).getByRole('link').textContent);
    expect(names()).toEqual(['About the event', 'Travel', 'Scholarships']);
    expect(search).toHaveAccessibleDescription('3 pages');

    fireEvent.change(search, { target: { value: '  INTRO  ' } });
    expect(names()).toEqual(['Travel', 'Scholarships']);
    expect(search).toHaveAccessibleDescription('2 of 3 pages');
    fireEvent.change(search, { target: { value: 'travel directions' } });
    expect(names()).toEqual(['Travel']);
    fireEvent.change(search, { target: { value: '/getting-here' } });
    expect(names()).toEqual(['Travel']);
    fireEvent.change(search, { target: { value: 'SCHOLARSHIPS' } });
    expect(names()).toEqual(['Scholarships']);

    fireEvent.change(search, { target: { value: 'nothing matches this' } });
    expect(screen.getByRole('heading', { name: 'No matching pages' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(search).toHaveAccessibleDescription('0 of 3 pages');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0]);
    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(search).toHaveAccessibleDescription('3 pages');
    expect(names()).toEqual(['About the event', 'Travel', 'Scholarships']);
    expect(screen.getByRole('link', { name: 'Manage page structure' })).toHaveAttribute('href', '/admin/pages');
  });

  it('opens an encoded section directly from the page index', async () => {
    const odd = { ...SCHOLARSHIPS_PAGE.sections[0], id: 'a b/c', label: 'Odd section' };
    sources.cmsPages_drafts = [{ ...SCHOLARSHIPS_PAGE, sections: [odd] }];
    await renderAt('/admin/content');

    const directLink = screen.getByRole('link', { name: 'Odd section' });
    expect(directLink).toHaveAttribute('href', '/admin/content/scholarships/a%20b%2Fc');
    fireEvent.click(directLink);
    expect(await screen.findByRole('heading', { level: 1, name: 'Odd section' })).toBeInTheDocument();
    expect(screen.getByText('Scholarships · Odd section · 0 blocks')).toBeInTheDocument();
  });

  it('keeps the page publication state separate from its content drafts', async () => {
    sources.cmsPages = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, status: undefined, value: '<p>The published introduction.</p>' }];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    await renderAt('/admin/content');

    const row = within(screen.getByRole('table')).getByRole('link', { name: 'Scholarships', exact: true }).closest('tr');
    expect(within(row).getByText('Live', { exact: true })).toBeInTheDocument();
    expect(within(row).queryByText('Live with unpublished changes')).not.toBeInTheDocument();
    expect(screen.queryByText('Page state is for the page’s structure. Open a section to review its content drafts.')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByRole('link', { name: 'Intro' }));
    const block = (await screen.findByRole('link', { name: 'Scholarships open in spring.' })).closest('li');
    expect(within(block).getByText('Live with unpublished changes')).toBeInTheDocument();
  });

  it('offers verified destinations for sectionless system pages without guessing from editable labels or paths', async () => {
    const targets = [
      ['schedule', 'Program', '/admin/sessions', 'Manage sessions'],
      ['speakers', 'Presenters', '/admin/speakers', 'Manage speakers'],
      ['sponsors', 'Partners', '/admin/organizations', 'Manage organizations'],
      ['attendees', 'People', '/admin/attendees', 'Manage attendees'],
      ['updates', 'News', '/admin/updates', 'Manage updates'],
    ];
    sources.cmsPages = [
      ...targets.map(([id, label], order) => ({ ...SCHOLARSHIPS_PAGE, id, label, path: `/old-${id}`, systemPage: true, sections: [], order })),
      { ...SCHOLARSHIPS_PAGE, id: 'custom', label: 'Speakers', path: '/speakers', sections: [], order: 10 },
      { ...SCHOLARSHIPS_PAGE, id: 'unknown', label: 'Unknown system page', systemPage: true, sections: [], order: 11 },
    ];
    await renderAt('/admin/content');
    const index = within(screen.getByRole('table'));

    for (const [, label, to, action] of targets) {
      const row = index.getByRole('link', { name: label, exact: true }).closest('tr');
      expect(within(row).getByRole('link', { name: action })).toHaveAttribute('href', to);
    }
    for (const [id, label] of [['custom', 'Speakers'], ['unknown', 'Unknown system page']]) {
      const row = index.getByRole('link', { name: label, exact: true }).closest('tr');
      expect(within(row).getByText('No sections yet.')).toBeInTheDocument();
      expect(within(row).getByRole('link', { name: 'Edit page structure' })).toHaveAttribute('href', `/admin/pages/${id}`);
    }
    fireEvent.click(index.getByRole('link', { name: 'Program', exact: true }));
    expect(await screen.findByText('This page’s main content is managed in Sessions.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage sessions' })).toHaveAttribute('href', '/admin/sessions');
  });

  it('withholds section counts until both content revisions arrive and counts a live block plus its draft once', async () => {
    sources.cmsPages = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, status: undefined }];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    silentCollections = ['cmsContent_drafts'];
    await renderAt('/admin/content/scholarships');

    expect(screen.getByText('Loading blocks…')).toBeInTheDocument();
    expect(screen.queryByText('0 blocks', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('1 block', { exact: true })).not.toBeInTheDocument();
    act(() => adminErrors.get('cmsContent_drafts')(new Error('draft listener failed')));
    expect(screen.getByText('Block count unavailable')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Intro', exact: true })).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsContent_drafts')(sources.cmsContent_drafts));
    expect(await screen.findByText('1 block', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Limit: 2 blocks')).toBeInTheDocument();
    expect(screen.queryByText('Block count unavailable')).not.toBeInTheDocument();
  });

  it('does not call a draft-only page missing when its listener has not recovered', async () => {
    silentCollections = ['cmsPages_drafts'];
    await renderAt('/admin/content/scholarships');
    expect(screen.getByRole('status', { name: 'Loading page…' })).toBeInTheDocument();
    act(() => adminErrors.get('cmsPages_drafts')(new Error('draft listener failed')));
    expect(screen.getByRole('heading', { name: 'The page is not available yet' })).toBeInTheDocument();
    expect(screen.queryByText('No such page')).not.toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsPages_drafts')([SCHOLARSHIPS_PAGE]));
    expect(await screen.findByRole('link', { name: 'Intro', exact: true })).toBeInTheDocument();
  });

  it('opens the right section from the path a public edit link builds, even for an id that needs encoding', async () => {
    const odd = { ...SCHOLARSHIPS_PAGE.sections[0], id: 'a b/c', label: 'Odd section' };
    sources.cmsPages_drafts = [
      { ...SCHOLARSHIPS_PAGE, sections: [...SCHOLARSHIPS_PAGE.sections, odd] },
    ];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];

    await renderAt(sectionEditPath('scholarships', 'a b/c'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Odd section' })).toBeInTheDocument();
    expect(screen.getByText('Scholarships · Odd section · 0 blocks')).toBeInTheDocument();
    expect(screen.queryByText('No such section')).toBeNull();
  });

  it('fails soft when a listener errors: rows stay, with a non-blocking notice', async () => {
    sources.cmsPages = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, status: undefined }];
    listenerError = new Error('permission denied');

    await renderAt('/admin/content/scholarships/intro');
    expect(await screen.findByRole('link', { name: 'Scholarships open in spring.' })).toBeInTheDocument();
    expect(screen.getAllByRole('status').some((el) => /lost the connection/i.test(el.textContent))).toBe(true);
  });

  it.each(['cmsContent_drafts', 'cmsPages_drafts'])('blocks creation until the failed %s listener recovers', async (collection) => {
    sources.cmsPages = [SCHOLARSHIPS_PAGE];
    silentCollections = [collection];
    await renderAt('/admin/content/scholarships/intro');

    act(() => adminErrors.get(collection)(new Error('draft listener failed')));
    for (const button of screen.getAllByRole('button', { name: 'Add a block' })) {
      expect(button).toBeDisabled();
    }

    act(() => adminSubscriptions.get(collection)([]));
    await waitFor(() => {
      expect(screen.getAllByRole('link', { name: 'Add a block' }).length).toBeGreaterThan(0);
    });
  });

  it('reports no such page/section cleanly instead of crashing', async () => {
    await renderAt('/admin/content/nope');
    expect(await screen.findByText('No such page')).toBeInTheDocument();

    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    await renderAt('/admin/content/scholarships/nope');
    expect(await screen.findByText('No such section')).toBeInTheDocument();
  });

  it('waits for both revisions before it fills the form and saves the draft values', async () => {
    // If the live listener reports before cmsContent_drafts, `existingRow`
    // is already truthy (live-only) while the real dirty draft is still in
    // flight. Adopting from the stale live content here — and never
    // revisiting it once the draft lands, since adoption is a one-shot —
    // would make a later "Save draft" overwrite the operator's unpublished
    // changes with it.
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, value: '<p>STALE live content</p>', status: undefined }];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    silentCollections = ['cmsContent_drafts'];

    await renderAt('/admin/content/scholarships/intro/body');

    expect(await screen.findByRole('status', { name: 'Loading block…' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull();

    act(() => adminSubscriptions.get('cmsContent_drafts')(sources.cmsContent_drafts));
    expect((await findRichText()).innerHTML).toBe('<p>Scholarships open in spring.</p>');

    fetch.mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(bodyOf(0).fields.value).toBe('<p>Scholarships open in spring.</p>');
  });

  it('keeps the form closed when the content drafts listener fails before it reports', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, value: '<p>STALE live content</p>', status: undefined }];
    silentCollections = ['cmsContent_drafts'];

    await renderAt('/admin/content/scholarships/intro/body');
    await waitFor(() => expect(adminErrors.has('cmsContent_drafts')).toBe(true));
    act(() => adminErrors.get('cmsContent_drafts')(new Error('permission denied')));

    expect(await screen.findByText(/This block could not load/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Text' })).toBeNull();
  });

  it('keeps a field literally named "new" editable — the create route uses a different segment', async () => {
    // A cmsContent field id may legitimately be 'new' (SECTION_FIELD_RE
    // only requires an alnum first character); the creation route must not
    // collide with it or this URL would always render a blank create form
    // instead of this real field's editor.
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [{ ...BODY_BLOCK_DRAFT, id: 'intro__new', field: 'new' }];

    await renderAt('/admin/content/scholarships/intro/new');

    expect((await findRichText()).innerHTML).toBe('<p>Scholarships open in spring.</p>');
    expect(screen.queryByLabelText('Field id')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this block' })).toBeInTheDocument();
  });
});

describe('content block order', () => {
  it('saves a moved block order as drafts and does not publish', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT, CTA_BLOCK_DRAFT];
    fetch.mockResolvedValue(okResponse({ status: 'dirty' }));
    await renderAt('/admin/content/scholarships/intro');
    fireEvent.click(await screen.findByRole('button', { name: 'Move Apply now up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // Apply now was order 2 and is now first. The other block already sits at index 1.
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      section: 'intro', field: 'cta1', visible: true, fields: { order: 0 },
    });
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('cmsPublish'))).toBe(false);
  });

  it('does not move blocks until both content revisions have loaded', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT, CTA_BLOCK_DRAFT];
    silentCollections = ['cmsContent'];
    await renderAt('/admin/content/scholarships/intro');
    const up = await screen.findByRole('button', { name: 'Move Apply now up' });
    expect(up).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });
});

describe('creating and editing a block', () => {
  it('creates a block and saves it as a draft only', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    fetch.mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }));

    await renderAt('/admin/content/scholarships/intro/_new');

    expect(screen.queryByLabelText('Field id')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Block type'), { target: { value: 'richtext' } });
    await replaceRichText(await findRichText(), '<p>Hello</p>', 'Hello');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsCreateContent$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    expect(bodyOf(0)).toEqual({
      pageId: 'scholarships',
      section: 'intro',
      field: 'hello',
      fields: { blockType: 'richtext', value: '<p>Hello</p>', order: 0 },
      visible: true,
    });
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/cmsPublish'))).toBe(false);
    expect(await screen.findByText(/not public until you publish/i)).toBeInTheDocument();
  });

  it('waits for both content revisions before a new block can take an order', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, status: undefined }];
    silentCollections = ['cmsContent_drafts'];
    await renderAt('/admin/content/scholarships/intro/_new');
    expect(await screen.findByRole('status', { name: 'Loading block…' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save', exact: true })).toBeNull();
  });

  it('offers every block type for a custom section, driven by the registry', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    await renderAt('/admin/content/scholarships/intro/_new');

    const picker = screen.getByLabelText('Block type');
    await waitFor(() => {
      expect(within(picker).getAllByRole('option').map((option) => option.value)).toEqual(BLOCK_TYPE_IDS);
    });

    // Switching the block type swaps the value fields the registry declares.
    fireEvent.change(picker, { target: { value: 'richtext' } });
    expect(await findRichText()).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'stat' } });
    expect(screen.getByLabelText(/^Caption/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Figure' })).toBeInTheDocument();
    // stat declares its own registry 'order' field. The section list sets
    // order, so the value form renders neither that field nor an Order input.
    expect(screen.queryByLabelText('Order')).toBeNull();
    expect(screen.queryByLabelText(/^order \(optional\)/)).toBeNull();
  });

  it('loads an existing draft’s value and updates it via cmsUpdateContent', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }));

    await renderAt('/admin/content/scholarships/intro/body');

    const editor = await findRichText();
    expect(editor.innerHTML).toBe('<p>Scholarships open in spring.</p>');
    await replaceRichText(editor, '<p>Updated copy.</p>', 'Updated copy.');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsUpdateContent$/);
    expect(bodyOf(0)).toMatchObject({
      section: 'intro',
      field: 'body',
      fields: { blockType: 'richtext', value: '<p>Updated copy.</p>', order: 1 },
    });
    // Stored bookkeeping never travels back.
    expect(bodyOf(0).fields).not.toHaveProperty('status');
    expect(bodyOf(0).fields).not.toHaveProperty('revision');
  });

  it('publishes with the content call followed by cmsPublish for that one block', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }))
      .mockResolvedValueOnce(
        okResponse({
          queueId: 'q1',
          status: 'done',
          results: { cmsContent: { published: ['intro__body'], skipped: [] } },
        }),
      );

    await renderAt('/admin/content/scholarships/intro/body');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish', exact: true }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(0)).toMatch(/\/cmsUpdateContent$/);
    expect(urlOf(1)).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1)).toEqual({ collection: 'cmsContent', docIds: ['intro__body'] });
    expect(await screen.findByText('Published.', { selector: 'p[role="status"]' })).toBeInTheDocument();
  });

  it('blocks the save when a required registry field is left blank', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    await renderAt('/admin/content/scholarships/intro/_new');

    fireEvent.change(screen.getByLabelText('Block type'), { target: { value: 'stat' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Figure: is required.');
    expect(alert).toHaveTextContent('Caption: is required.');
    expect(screen.getByLabelText(/^Figure/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/^Caption/)).toHaveAttribute('aria-invalid', 'true');
    // The server never even sees an incomplete block — this is caught
    // client-side, since the generic content endpoints validate only
    // reserved keys, never block shape.
    expect(fetch).not.toHaveBeenCalled();
  });

  // The stat contract (design brief §2.1.1) is enforced from PR3 on: the
  // editor asks for all four parts and refuses to save without them, and
  // the server rejects a write that misses one.
  it('requires all four parts of the stat contract, and says what each is for', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    await renderAt('/admin/content/scholarships/intro/_new');

    fireEvent.change(screen.getByLabelText('Block type'), { target: { value: 'stat' } });
    fireEvent.change(screen.getByLabelText(/^Figure/), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText(/^Caption/), { target: { value: 'scholarships awarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    const alert = await screen.findByRole('alert');
    for (const label of ['Finding', 'What it counts', 'Source', 'Screen reader text']) {
      expect(alert).toHaveTextContent(`${label}: is required.`);
      expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    }
    // Each field says what belongs in it, so "required" is actionable.
    expect(screen.getByLabelText('Finding')).toHaveAccessibleDescription(
      /State the finding in words/,
    );
    expect(screen.getByLabelText('Source')).toHaveAccessibleDescription(/the date you read it/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the old block type’s stale fields when switching types', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [CTA_BLOCK_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ docId: 'intro__cta1', status: 'dirty' }));

    await renderAt('/admin/content/scholarships/intro/cta1');
    fireEvent.change(await screen.findByLabelText('Block type'), { target: { value: 'stat' } });
    fireEvent.change(screen.getByLabelText(/^Figure/), { target: { value: '42' } });
    fireEvent.change(screen.getByLabelText(/^Caption/), { target: { value: 'scholarships awarded' } });
    // A stat carries its four-part contract (design brief §2.1.1), and the
    // editor will not save one without it.
    fireEvent.change(screen.getByLabelText('Finding'), {
      target: { value: 'The fund placed every applicant it could' },
    });
    fireEvent.change(screen.getByLabelText('What it counts'), {
      target: { value: 'Awards made from the 2026 fund, across both rounds.' },
    });
    fireEvent.change(screen.getByLabelText('Source'), {
      target: { value: 'Scholarship committee minutes, read 1 September 2026.' },
    });
    fireEvent.change(screen.getByLabelText('Screen reader text'), {
      target: { value: 'The fund awarded 42 scholarships in 2026.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // cta's `url`/`external` are not part of stat's fields — cmsUpdateContent
    // merges submitted fields onto the prior draft, so without an explicit
    // clear they would otherwise survive under the new block type forever.
    expect(bodyOf(0).fields).toEqual({
      blockType: 'stat',
      order: 2, // unaffected — the shared Order control, not a per-type field
      value: '42',
      label: 'scholarships awarded',
      takeaway: 'The fund placed every applicant it could',
      description: 'Awards made from the 2026 fund, across both rounds.',
      source: 'Scholarship committee minutes, read 1 September 2026.',
      alt: 'The fund awarded 42 scholarships in 2026.',
      url: '__cms_delete_field__',
      external: '__cms_delete_field__',
    });
  });

  it('deletes a block through cmsDeleteContent', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ entries: [], nextCursor: null }));
    fetch.mockResolvedValueOnce(okResponse({ deleted: ['cmsContent/intro__body', 'cmsContent_drafts/intro__body'] }));

    await renderAt('/admin/content/scholarships/intro/body');
    // Moment 3: the first press states the cost, the second does the work.
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this block' }));
    await screen.findByText(/has no published version and cannot be restored after deletion/);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(urlOf(0)).toMatch(/\/cmsGetVersionHistory$/);
    expect(bodyOf(0)).toEqual({ docPath: 'cmsContent/intro__body', limit: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Delete this block' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(1)).toMatch(/\/cmsDeleteContent$/);
    expect(bodyOf(1)).toEqual({ section: 'intro', field: 'body' });
  });
});

describe('server errors and publish skips', () => {
  it('replaces server diagnostics with a recovery message', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    fetch.mockResolvedValueOnce(
      errorResponse(400, 'bad-request', 'fields may not set reserved keys: revision, status.'),
    );

    await renderAt('/admin/content/scholarships/intro/_new');
    // Fill the required value field so this reaches the network call at
    // all — an empty one is caught by client-side validation first, which
    // has its own test.
    fireEvent.change(screen.getByLabelText('Block type'), { target: { value: 'richtext' } });
    await replaceRichText(await findRichText(), '<p>Hi</p>', 'Hi');
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The change could not be saved. Try again.');
  });

  it('does not claim success when cmsPublish skipped the block', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }))
      .mockResolvedValueOnce(
        okResponse({
          queueId: 'q1',
          status: 'done',
          results: {
            cmsContent: {
              published: [],
              skipped: [{ docId: 'intro__body', reason: 'conflict' }],
            },
          },
        }),
      );

    await renderAt('/admin/content/scholarships/intro/body');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish', exact: true }));

    expect(
      (await screen.findAllByText(/One item was edited while publishing/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('Published.', { exact: true })).toBeNull();
  });

  it('resumes a part-way publish with its queueId instead of republishing', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch
      .mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }))
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: 'publish-failed', message: 'Publish failed part-way.' },
          queueId: 'queue-9',
        }),
      })
      .mockResolvedValueOnce(
        okResponse({
          queueId: 'queue-9',
          status: 'done',
          results: { cmsContent: { published: ['intro__body'], skipped: [] } },
        }),
      );

    await renderAt('/admin/content/scholarships/intro/body');
    fireEvent.click(await screen.findByRole('button', { name: 'Publish', exact: true }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });

    fireEvent.click(resume);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(bodyOf(2)).toEqual({ queueId: 'queue-9' });
    expect(await screen.findByText('Published.', { selector: 'p[role="status"]' })).toBeInTheDocument();
  });
});


describe('contextual block actions', () => {
  it('keeps inline Undo and its result as the draft returns, preserving the unsaved reorder guard', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [BODY_BLOCK_DRAFT, CTA_BLOCK_DRAFT];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT, CTA_BLOCK_DRAFT];
    await renderAt('/admin/content/scholarships/intro');
    fireEvent.click(await screen.findByRole('button', { name: 'Move Apply now up' }));
    const row = screen.getByRole('link', { name: 'Scholarships open in spring.', exact: true }).closest('li');
    const fields = { section: 'intro', field: 'body', blockType: 'richtext', value: '<p>Published introduction.</p>', order: 1 };
    const entry = { revision: 2, fields, visible: true };
    fetch.mockResolvedValueOnce(okResponse({ entries: [entry], nextCursor: null }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete', exact: true }));
    await within(row).findByText(/Published versions can be restored as a draft/);
    fetch.mockResolvedValueOnce(okResponse({ publishedRevision: 2 }));
    fireEvent.click(within(row).getByRole('button', { name: 'Delete this block' }));
    const undo = await within(row).findByRole('button', { name: 'Undo' });
    expect(undo).toHaveFocus();
    expect(screen.queryByRole('alertdialog', { name: 'Unsaved changes' })).toBeNull();
    act(() => {
      adminSubscriptions.get('cmsContent')([CTA_BLOCK_DRAFT]);
      adminSubscriptions.get('cmsContent_drafts')([CTA_BLOCK_DRAFT]);
    });
    let finish;
    fetch.mockResolvedValueOnce(okResponse({ entries: [entry] }));
    fetch.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(undo);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
    expect(bodyOf(3)).toEqual({ collection: 'cmsContent', pageId: 'scholarships', section: 'intro', field: 'body', fields, visible: true });
    act(() => adminSubscriptions.get('cmsContent_drafts')([CTA_BLOCK_DRAFT, { ...fields, id: 'intro__body', status: 'dirty' }]));
    expect(within(row).getByRole('button', { name: 'Restoring…' })).toBeDisabled();
    await act(async () => finish(okResponse({ status: 'dirty' })));
    const link = await within(row).findByRole('link', { name: 'Open draft' });
    expect(link).toHaveFocus();
    expect(within(row).getAllByRole('status')).toHaveLength(1);
    expect(within(row).getByRole('link', { name: 'Edit Published introduction.' })).toBeInTheDocument();
    fireEvent.click(link);
    const guard = await screen.findByRole('alertdialog', { name: 'Unsaved changes' });
    fireEvent.click(within(guard).getByRole('button', { name: 'Stay' }));
    expect(link).toBeInTheDocument();
  });

  it('keeps publishing feedback on its row and restores focus when the publish control leaves', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    await renderAt('/admin/content/scholarships/intro');
    const row = (await screen.findByRole('link', { name: 'Scholarships open in spring.', exact: true })).closest('li');
    let answer;
    fetch.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const publish = within(row).getByRole('button', { name: 'Publish' });
    publish.focus();
    fireEvent.click(publish);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(publish).toHaveAttribute('aria-busy', 'true');
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeDisabled();
    act(() => {
      adminSubscriptions.get('cmsContent')([{ ...BODY_BLOCK_DRAFT, status: undefined }]);
      adminSubscriptions.get('cmsContent_drafts')([{ ...BODY_BLOCK_DRAFT, status: 'clean' }]);
    });
    expect(publish.isConnected).toBe(false);
    await act(async () => { answer(okResponse({ results: { cmsContent: { published: ['intro__body'], skipped: [] } } })); });
    const result = within(row).getByRole('status');
    expect(result).toHaveTextContent('Published. The public site picks it up live.');
    expect(result.parentElement).toHaveFocus();
  });

  it('retains a deletion receipt where the removed block was', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    await renderAt('/admin/content/scholarships/intro');
    fetch.mockResolvedValueOnce(okResponse({ entries: [], nextCursor: null }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }));
    await screen.findByText(/has no published version and cannot be restored after deletion/);
    const confirm = screen.getByRole('button', { name: 'Delete this block' });
    confirm.focus();
    fetch.mockResolvedValueOnce(okResponse({}));
    fireEvent.click(confirm);
    const result = await screen.findByText(/deleted. The live block and its draft were removed/);
    act(() => adminSubscriptions.get('cmsContent_drafts')([]));
    expect(result).toBeInTheDocument();
    expect(result.parentElement).toHaveFocus();
    expect(screen.getByText('Deleted', { exact: true })).toBeInTheDocument();
    act(() => adminSubscriptions.get('cmsContent_drafts')([{ ...BODY_BLOCK_DRAFT, value: '<p>Recreated introduction.</p>' }]));
    const restored = await screen.findByRole('link', { name: 'Recreated introduction.', exact: true });
    const row = restored.closest('li');
    expect(within(row).getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Edit Recreated introduction.' })).toBeInTheDocument();
    expect(screen.queryByText('Deleted', { exact: true })).not.toBeInTheDocument();
    expect(within(row).getByRole('status')).toHaveTextContent('This block is available again.');
  });
});
