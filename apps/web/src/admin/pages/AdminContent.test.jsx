// Content-block editor flows (issue #61). AdminPageEditor already lets staff
// shape a page's structure; this suite covers the screens that let them fill
// in what a block actually says — browse page → section → block, edit its
// registry-driven VALUE, save as draft or publish, create, and delete —
// following the same mocked-HTTP-seam pattern as AdminPageEditor.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/configSource.js', () => ({ subscribeConfigDoc: () => () => {} }));
vi.mock('../../lib/contentSource.js', () => ({ subscribeContentCollection: () => () => {} }));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));

// The admin CMS reads all four revisions (cmsPages/_drafts, cmsContent/_drafts);
// each test seeds what the listeners report per collection.
let sources = {};
let listenerError = null;
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (name, onNext, onError) => {
    onNext(sources[name] ?? []);
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

function bodyOf(callIndex) {
  return JSON.parse(fetch.mock.calls[callIndex][1].body);
}
function urlOf(callIndex) {
  return String(fetch.mock.calls[callIndex][0]);
}

beforeEach(() => {
  sources = { cmsPages: [], cmsPages_drafts: [], cmsContent: [], cmsContent_drafts: [] };
  listenerError = null;
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('content browsing', () => {
  it('lists pages, then the sections of the one chosen, then its blocks', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];

    await renderAt('/admin/content');
    expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Scholarships' })).toBeInTheDocument();

    await renderAt('/admin/content/scholarships');
    expect(screen.getByRole('link', { name: 'Intro' })).toBeInTheDocument();
    expect(screen.getByText(/1 block/)).toBeInTheDocument();

    await renderAt('/admin/content/scholarships/intro');
    expect(screen.getByRole('link', { name: 'body' })).toBeInTheDocument();
    expect(screen.getByText('Rich text')).toBeInTheDocument();
  });

  it('fails soft when a listener errors: rows stay, with a non-blocking notice', async () => {
    sources.cmsPages = [SCHOLARSHIPS_PAGE];
    sources.cmsContent = [{ ...BODY_BLOCK_DRAFT, status: undefined }];
    listenerError = new Error('permission denied');

    await renderAt('/admin/content/scholarships/intro');
    expect(screen.getByRole('link', { name: 'body' })).toBeInTheDocument();
    expect(screen.getAllByRole('status').some((el) => /lost the connection/i.test(el.textContent))).toBe(true);
  });

  it('reports no such page/section cleanly instead of crashing', async () => {
    await renderAt('/admin/content/nope');
    expect(screen.getByText('No such page')).toBeInTheDocument();

    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    await renderAt('/admin/content/scholarships/nope');
    expect(screen.getByText('No such section')).toBeInTheDocument();
  });
});

describe('creating and editing a block', () => {
  it('creates a block and saves it as a draft only', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    fetch.mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }));

    await renderAt('/admin/content/scholarships/intro/new');

    fireEvent.change(screen.getByLabelText('Field id'), { target: { value: 'body' } });
    fireEvent.change(screen.getByLabelText(/^value/), {
      target: { value: '<p>Hello</p>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsCreateContent$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer id-token');
    expect(bodyOf(0)).toEqual({
      section: 'intro',
      field: 'body',
      fields: { blockType: 'richtext', value: '<p>Hello</p>' },
      visible: true,
    });
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/cmsPublish'))).toBe(false);
    expect(await screen.findByText(/not public until you publish/i)).toBeInTheDocument();
  });

  it('offers only the section’s allowed block types, driven by the registry', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    await renderAt('/admin/content/scholarships/intro/new');

    const picker = screen.getByLabelText('Block type');
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Rich text',
      'Statistic',
    ]);

    // Switching the block type swaps the value fields the registry declares.
    expect(screen.getByLabelText(/^value/)).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'stat' } });
    expect(screen.getByLabelText(/^label/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^value/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^order \(optional\)/)).toBeInTheDocument();
  });

  it('loads an existing draft’s value and updates it via cmsUpdateContent', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ docId: 'intro__body', status: 'dirty' }));

    await renderAt('/admin/content/scholarships/intro/body');

    expect(screen.getByLabelText(/^value/)).toHaveValue('<p>Scholarships open in spring.</p>');
    fireEvent.change(screen.getByLabelText(/^value/), {
      target: { value: '<p>Updated copy.</p>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

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
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(urlOf(0)).toMatch(/\/cmsUpdateContent$/);
    expect(urlOf(1)).toMatch(/\/cmsPublish$/);
    expect(bodyOf(1)).toEqual({ collection: 'cmsContent', docIds: ['intro__body'] });
    expect((await screen.findAllByText(/picks it up live/i)).length).toBeGreaterThan(0);
  });

  it('deletes a block through cmsDeleteContent', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    sources.cmsContent_drafts = [BODY_BLOCK_DRAFT];
    fetch.mockResolvedValueOnce(okResponse({ deleted: ['cmsContent/intro__body', 'cmsContent_drafts/intro__body'] }));

    await renderAt('/admin/content/scholarships/intro/body');
    fireEvent.click(screen.getByRole('button', { name: 'Delete block' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(urlOf(0)).toMatch(/\/cmsDeleteContent$/);
    expect(bodyOf(0)).toEqual({ section: 'intro', field: 'body' });
  });
});

describe('server errors and publish skips', () => {
  it('surfaces the server’s rejection verbatim', async () => {
    sources.cmsPages_drafts = [SCHOLARSHIPS_PAGE];
    fetch.mockResolvedValueOnce(
      errorResponse(400, 'bad-request', 'fields may not set reserved keys: revision, status.'),
    );

    await renderAt('/admin/content/scholarships/intro/new');
    fireEvent.change(screen.getByLabelText('Field id'), { target: { value: 'body' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('fields may not set reserved keys: revision, status.');
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
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));

    expect(
      (await screen.findAllByText(/intro__body was edited while publishing/i)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/picks it up live/i)).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    const resume = await screen.findByRole('button', { name: 'Resume publish' });

    fireEvent.click(resume);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(bodyOf(2)).toEqual({ queueId: 'queue-9' });
    expect((await screen.findAllByText(/picks it up live/i)).length).toBeGreaterThan(0);
  });
});
