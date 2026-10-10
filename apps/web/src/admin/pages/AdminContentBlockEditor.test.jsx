// Content block editor's value-field routing (issue #76). BlockValueFields
// (AdminContentBlockEditor.jsx) renders one control per registry field
// (blockTypes.js), keyed off `field.type` — every `url` field used to fall
// through to a plain TextField. Only the image block's `url` actually names
// a Storage object path (spec §5.2); it now routes through ImagePicker,
// exactly as AdminBranding's logo slots do (AdminBranding.jsx). cta.url and
// link_group.url are real external destinations and must stay plain text —
// pinned here so a future edit to the `url` branch cannot widen the picker
// to them by accident.
import { StrictMode } from 'react';
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
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
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

async function renderAt(path, { strict = false } = {}) {
  const routed = (
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>
  );
  const result = render(strict ? <StrictMode>{routed}</StrictMode> : routed);
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
  await screen.findByRole('heading', { level: 1 });
  return result;
}

async function pasteHtml(editor, html, text) {
  fireEvent.paste(editor, {
    clipboardData: {
      getData(type) {
        return type === 'text/html' ? html : text;
      },
    },
  });
  await waitFor(() => expect(editor).toHaveTextContent(text));
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
    expect(await screen.findByRole('button', { name: /choose or upload/i })).toBeInTheDocument();

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

  // Issue 193: the sponsors page's package section takes the new block, and
  // the editor says what the limit is for under the field itself.
  it('edits a sponsor package, with the limit a number and its hint under it', async () => {
    pagesLive = [{
      id: 'sponsors',
      label: 'Sponsors',
      path: '/sponsors',
      icon: null,
      order: 3,
      visible: true,
      systemPage: true,
      sections: [{
        id: 'sponsor_packages',
        label: 'Sponsorship packages',
        description: 'What a sponsor can support, one package per block.',
        allowedBlocks: ['sponsor_package', 'richtext'],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      }],
    }];
    await renderAt('/admin/content/sponsors/sponsor_packages/_new');

    expect(await screen.findByRole('combobox', { name: /block type/i })).toHaveValue('sponsor_package');
    const limit = screen.getByLabelText('limit (optional)');
    expect(limit).toHaveAttribute('type', 'number');
    expect(limit).toHaveAccessibleDescription('How many sponsors can take this package. Leave it empty for no limit.');
    expect(screen.getByLabelText('price (optional)')).toHaveAccessibleDescription(
      'As it should read, with its currency. Leave it empty to show no price.',
    );

    fireEvent.change(screen.getByLabelText(/^field id/i), { target: { value: 'coffee' } });
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Coffee break' } });
    fireEvent.change(limit, { target: { value: '2' } });
    await pasteHtml(
      await screen.findByRole('textbox', { name: 'benefits' }, { timeout: 5000 }),
      '<p>Signs</p>',
      'Signs',
    );
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = fetch.mock.calls.find(([url]) => String(url).includes('cmsCreateContent'));
    expect(JSON.parse(call[1].body).fields).toMatchObject({
      blockType: 'sponsor_package',
      name: 'Coffee break',
      limit: 2,
      benefits: '<p>Signs</p>',
    });
  });

  it('saves a formatted value from the richtext block editor', async () => {
    pagesLive = [{
      id: 'about',
      label: 'About',
      path: '/about',
      icon: null,
      order: 1,
      visible: true,
      systemPage: false,
      sections: [{
        id: 'intro',
        label: 'Introduction',
        description: 'Opening copy.',
        allowedBlocks: ['richtext'],
        maxBlocks: 2,
        reorderable: true,
        defaultBlocks: [],
      }],
    }];
    await renderAt('/admin/content/about/intro/_new');
    fireEvent.change(screen.getByLabelText(/^field id/i), { target: { value: 'body' } });
    const editor = await screen.findByRole('textbox', { name: 'value' });
    await pasteHtml(editor, '<p><strong>Formatted</strong> body</p>', 'Formatted body');
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = fetch.mock.calls.find(([url]) => String(url).includes('cmsCreateContent'));
    expect(JSON.parse(call[1].body).fields.value).toBe('<p><strong>Formatted</strong> body</p>');
  });

  it('loads and saves the FAQ rich-text answer from the existing draft', async () => {
    pagesLive = [{
      id: 'faq',
      label: 'FAQ',
      path: '/faq',
      icon: null,
      order: 2,
      visible: true,
      systemPage: false,
      sections: [{
        id: 'faq_items',
        label: 'Questions',
        description: 'Frequently asked questions.',
        allowedBlocks: ['faq_item'],
        maxBlocks: 20,
        reorderable: true,
        defaultBlocks: [],
      }],
    }];
    contentLive = [{
      id: 'faq_items__what_is_this',
      section: 'faq_items',
      field: 'what_is_this',
      blockType: 'faq_item',
      question: 'What is this?',
      answer: '<p>Published answer.</p>',
      visible: true,
    }];
    contentDrafts = [{
      id: 'faq_items__what_is_this',
      section: 'faq_items',
      field: 'what_is_this',
      blockType: 'faq_item',
      question: 'What is this?',
      answer: '<p><strong>Saved draft answer.</strong></p>',
      visible: true,
      status: 'dirty',
    }];
    await renderAt('/admin/content/faq/faq_items/what_is_this');
    const editor = await screen.findByRole('textbox', { name: 'answer' });
    expect(editor).toHaveTextContent('Saved draft answer.');
    expect(editor.querySelector('strong')).toHaveTextContent('Saved draft answer.');
    expect(editor).not.toHaveTextContent('Published answer.');

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = fetch.mock.calls.find(([url]) => String(url).includes('cmsUpdateContent'));
    expect(JSON.parse(call[1].body).fields.answer).toBe('<p><strong>Saved draft answer.</strong></p>');
  });

  // Review round (c2, finding 1): "Leave it empty for no limit" has to hold
  // on an existing package too. The update merges onto the stored draft, so
  // the cleared field goes as a deletion.
  it('clears a stored limit when the field is emptied and saved', async () => {
    pagesLive = [{
      id: 'sponsors',
      label: 'Sponsors',
      path: '/sponsors',
      icon: null,
      order: 3,
      visible: true,
      systemPage: true,
      sections: [{
        id: 'sponsor_packages',
        label: 'Sponsorship packages',
        description: 'What a sponsor can support, one package per block.',
        allowedBlocks: ['sponsor_package', 'richtext'],
        maxBlocks: 6,
        reorderable: true,
        defaultBlocks: [],
      }],
    }];
    contentLive = [{
      id: 'sponsor_packages__supporting',
      section: 'sponsor_packages',
      field: 'supporting',
      blockType: 'sponsor_package',
      name: 'Supporting',
      price: 'Illustrative figure: 3,000',
      limit: 3,
      benefits: '<p>Workshop materials.</p>',
      order: 1,
      visible: true,
    }];
    await renderAt('/admin/content/sponsors/sponsor_packages/supporting');
    const limit = await screen.findByLabelText('limit (optional)');
    expect(limit).toHaveValue(3);
    fireEvent.change(limit, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = fetch.mock.calls.find(([url]) => String(url).includes('cmsUpdateContent'));
    expect(call).toBeTruthy();
    expect(JSON.parse(call[1].body).fields.limit).toBe('__cms_delete_field__');
  });
});


describe('content editing workspace', () => {
  beforeEach(() => {
    contentLive = [{
      id: 'hero__register', section: 'hero', field: 'register', blockType: 'cta',
      label: 'Register now', url: 'https://example.org/register', order: 2, visible: true,
    }];
  });

  it('puts the value first and keeps existing technical settings behind a summary', async () => {
    await renderAt('/admin/content/home/hero/register');
    expect(screen.getByLabelText('label')).toBeVisible();
    const valueHeading = screen.getByRole('heading', { name: 'Value' });
    const settingsHeading = screen.getByRole('heading', { name: 'Block settings' });
    expect(valueHeading.compareDocumentPosition(settingsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Call to action · Order 2 · Visible')).toBeVisible();
    const toggle = screen.getByRole('button', { name: 'Edit block settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Block type' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('label'), { target: { value: 'Reserve a place' } });
    fireEvent.click(toggle);
    expect(screen.getByRole('combobox', { name: 'Block type' })).toHaveValue('cta');
    expect(screen.getByLabelText('Field id')).toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hide block settings' }));
    expect(screen.getByText('Call to action · Order 3 · Visible')).toBeVisible();
    expect(screen.getByLabelText('label')).toHaveValue('Reserve a place');

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes('cmsUpdateContent'))).toBe(true));
    const call = fetch.mock.calls.find(([url]) => String(url).includes('cmsUpdateContent'));
    expect(JSON.parse(call[1].body)).toMatchObject({
      section: 'hero', field: 'register', visible: true,
      fields: { blockType: 'cta', label: 'Reserve a place', url: 'https://example.org/register', order: 3 },
    });
  });

  it('keeps creation setup visible before the value and retains it after saving', async () => {
    await renderAt('/admin/content/home/hero/_new');
    const setupHeading = screen.getByRole('heading', { name: 'Set up the block' });
    const valueHeading = screen.getByRole('heading', { name: 'Value' });
    expect(setupHeading.compareDocumentPosition(valueHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Block type' })).toBeVisible();
    expect(screen.getByLabelText('Field id')).not.toHaveAttribute('readonly');
    fireEvent.change(screen.getByLabelText('Field id'), { target: { value: 'banner' } });
    fireEvent.change(screen.getByLabelText('url'), { target: { value: 'cms-images/banner.jpg' } });
    fireEvent.change(screen.getByLabelText('alt'), { target: { value: 'Event banner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Draft saved. It is not public until you publish.');
    expect(screen.getByLabelText('Field id')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Field id')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide block settings' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('opens block settings when a server error names a hidden setting', async () => {
    await renderAt('/admin/content/home/hero/register');
    fetch.mockImplementation((url) => Promise.resolve(String(url).includes('cmsUpdateContent')
      ? { ok: false, status: 400, json: async () => ({ error: { code: 'bad-request', message: 'order: must be a non-negative number' } }) }
      : okResponse({})));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    await waitFor(() => expect(screen.getByLabelText('Order')).toBeVisible());
    expect(screen.getByLabelText('Order')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Hide block settings' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('label')).toHaveValue('Register now');
  });

  it('keeps value validation in view without expanding unrelated settings', async () => {
    await renderAt('/admin/content/home/hero/register');
    fireEvent.change(screen.getByLabelText('label'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('label')).toBeVisible();
    expect(screen.getByLabelText('label')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Edit block settings' })).toHaveAttribute('aria-expanded', 'false');
    expect(fetch.mock.calls.some(([url]) => String(url).includes('cmsUpdateContent'))).toBe(false);
  });

  it('shows unsaved changes until the field returns or a draft save lands', async () => {
    await renderAt('/admin/content/home/hero/register');
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    const label = screen.getByLabelText('label');
    fireEvent.change(label, { target: { value: 'Reserve a place' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getAllByText('Live').length).toBeGreaterThan(0);

    fireEvent.change(label, { target: { value: 'Register now' } });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.change(label, { target: { value: 'Reserve a place' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved. It is not public until you publish.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(label).toHaveValue('Reserve a place');
  });

  it('keeps the text and the unsaved state when save fails', async () => {
    await renderAt('/admin/content/home/hero/register');
    const label = screen.getByLabelText('label');
    fireEvent.change(label, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(label).toHaveValue('');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).includes('cmsUpdateContent'))).toBe(false);

    fireEvent.change(label, { target: { value: 'Reserve a place' } });
    fetch.mockImplementation(() => Promise.resolve({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'The draft service is down.' } }),
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('The draft service is down.')).toBeInTheDocument();
    expect(label).toHaveValue('Reserve a place');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('asks before leaving and can stay, then discard', async () => {
    await renderAt('/admin/content/home/hero/register');
    const label = screen.getByLabelText('label');
    fireEvent.change(label, { target: { value: 'Reserve a place' } });

    const blocked = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('link', { name: 'Back to section' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(label).toHaveValue('Reserve a place');

    fireEvent.click(screen.getByRole('link', { name: 'Back to section' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByLabelText('label')).not.toBeInTheDocument());
  });

  it('marks a new block unsaved only after the operator edits it', async () => {
    await renderAt('/admin/content/home/hero/_new');
    expect(await screen.findByRole('combobox', { name: /block type/i })).toHaveValue('image');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('alt'), { target: { value: 'Banner' } });
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('alt'), { target: { value: '' } });
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('still reports a saved draft after the development remount', async () => {
    await renderAt('/admin/content/home/hero/register', { strict: true });
    fireEvent.change(screen.getByLabelText('label'), { target: { value: 'Reserve a place' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft saved. It is not public until you publish.')).toBeInTheDocument();
  });

  it('does not offer discard while a save is still running', async () => {
    let release;
    fetch.mockImplementation(() => new Promise((resolve) => {
      release = resolve;
    }));
    await renderAt('/admin/content/home/hero/register');
    fireEvent.change(screen.getByLabelText('label'), { target: { value: 'Reserve a place' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Back to section' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Discard changes' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('label')).toHaveValue('Reserve a place');
    // The token read yields before fetch, so the hang is armed on the next turn.
    await waitFor(() => expect(typeof release).toBe('function'));
    await act(async () => {
      release(okResponse({ docId: 'hero__register' }));
    });
  });
});
