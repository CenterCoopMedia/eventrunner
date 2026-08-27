// The theme editor — the proof (design brief §5.2; admin story moment 2).
//
// What is pinned here:
//
//   • The preview is FRAMED. The candidate lands on the frame element, the
//     frame carries data-theme/data-mode/data-motif-set for the draft, and
//     the room around it never adopts any of them.
//   • The frame renders the client's REAL page, not swatches.
//   • The workflow is six decisions in order: site style, logo and icon,
//     main brand colour, header style, schedule style, light or dark. Every
//     other control is behind the Advanced disclosure.
//   • The whole-document replace really is whole — a save carries preset,
//     optionPicks, brandColor, tokens, motifSet, mode, fonts, and logos
//     together. Dropping one would silently delete it.
//   • A contrast failure is stated inline with the pair, the mode, and the
//     ratio, and the frame keeps rendering.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const configSubscriptions = new Map();
vi.mock('../../lib/configSource.js', () => ({
  subscribeConfigDoc: (docId, onNext) => {
    configSubscriptions.set(docId, onNext);
    return () => configSubscriptions.delete(docId);
  },
}));
vi.mock('../../lib/contentSource.js', () => ({
  subscribeContentCollection: () => () => {},
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../../lib/profileSource.js', () => ({ subscribeOwnProfile: () => () => {} }));
vi.mock('../adminSource.js', () => ({
  subscribeAdminCollection: (_name, onNext) => {
    onNext([]);
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
  // The stress fixture puts real session rows on the schedule, and a session
  // row subscribes to its own reaction counts. Without this the frame's
  // Schedule page throws inside the preview rather than rendering.
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn(() => () => {}),
}));

import App from '../../App.jsx';
import { PREVIEW_COMPARE_SCOPE_ID, PREVIEW_SCOPE_ID, PREVIEW_STYLE_ID } from '../themePreview.js';

// Hex values are DATA here, never literals in source (spec §7.6 forbids hex
// literals outside the allowlist — including in tests).
const hex = (digits) => `#${digits}`;
const TEAL = hex('2a9d8f');
const RUST = hex('c84b31');

/**
 * A deployment made before presets existed: its stored palette IS the theme.
 *
 * `preset: null` is load-bearing. EventConfigProvider overlays config/theme
 * onto the committed snapshot shallowly (spec §2.4), and the snapshot runs a
 * preset, so a document that simply omits the field would inherit that one.
 * Saying null is how a stored document says "no preset".
 */
const LEGACY_THEME = {
  preset: null,
  colors: { primary: TEAL, ink: hex('2c3e50') },
  fonts: {
    heading: 'serif-editorial',
    body: 'sans-humanist',
    data: 'serif-editorial',
    mono: 'script-casual',
  },
  texture: 'paper',
  radius: 'soft',
  mode: 'system',
  logos: { primary: 'branding/logo.svg', mark: 'branding/mark.svg' },
};

/** A deployment on the preset pipeline — what PR2-A ships. */
const PRESET_THEME = {
  preset: 'broadsheet',
  optionPicks: { headingFace: 'libre-baskerville', nameplate: 'full-measure' },
  tokens: { light: { surface: hex('f7f4ee') } },
  motifSet: 'none',
  brandColor: hex('1a3a6e'),
  colors: {},
  fonts: {},
  texture: 'flat',
  radius: 'sharp',
  mode: 'light',
  logos: { primary: 'branding/logo.svg' },
};

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}
const previewCss = () => document.getElementById(PREVIEW_STYLE_ID)?.textContent ?? '';
const frame = () => document.getElementById(PREVIEW_SCOPE_ID);

async function renderBranding(themeDoc = LEGACY_THEME) {
  const result = render(
    <MemoryRouter
      initialEntries={['/admin/branding']}
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
      expect(screen.queryByLabelText('Loading admin…')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
    },
    // The frame renders the whole public app, so the first mount in this
    // file is slower than the default budget allows for.
    { timeout: 5000 },
  );
  await act(async () => {
    configSubscriptions.get('theme')(themeDoc);
    await Promise.resolve();
  });
  return result;
}

/** Open Advanced. Nothing behind it is needed for a finished site. */
function openAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: 'Show the advanced settings' }));
}

/** The panel titles the bench shows, in the order a staff member meets them. */
function panelTitles() {
  // The frame renders a whole public page, headings and all, so the bench's
  // own panels are the level-2 headings OUTSIDE it.
  const preview = document.getElementById(PREVIEW_SCOPE_ID);
  return screen
    .getAllByRole('heading', { level: 2 })
    .filter((heading) => !preview?.contains(heading))
    .map((heading) => heading.textContent);
}

beforeEach(() => {
  configSubscriptions.clear();
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
  for (const attribute of ['theme', 'mode', 'motifSet', 'texture']) {
    delete document.documentElement.dataset[attribute];
  }
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the proof', () => {
  it('renders the client’s real page inside the frame, not swatches', async () => {
    await renderBranding();
    // The public shell, rendered by the app's own routes and components.
    expect(within(frame()).getByRole('banner')).toBeInTheDocument();
    expect(within(frame()).getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  });

  it('applies the candidate to the FRAME, and the room never adopts it', async () => {
    await renderBranding();
    expect(previewCss()).toContain(`#${PREVIEW_SCOPE_ID}`);
    expect(previewCss()).not.toContain(':root');
    expect(previewCss()).toContain('--brand-primary-rgb: 42 157 143;');

    // The frame states its own mode and motif set…
    expect(frame().dataset.mode).toBe('light');
    expect(frame().dataset.motifSet).toBe('none');
    // …and the room keeps the attributes the SAVED theme gave it. (The
    // provider writes those; the draft must not move them.)
    const room = { ...document.documentElement.dataset };
    fireEvent.change(screen.getByLabelText('Site style'), { target: { value: 'zine' } });
    await waitFor(() => expect(frame().dataset.theme).toBe('zine'));
    expect({ ...document.documentElement.dataset }).toEqual(room);
  });

  it('states the page, the mode, the width, and the draft below the frame', async () => {
    await renderBranding();
    expect(screen.getByText('Home · light · 1440px · published theme')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(screen.getByText('Schedule · light · 1440px · published theme')).toBeInTheDocument();
    // And the FRAME really moved. `initialEntries` is read once, so the
    // router has to remount or the line and the picture disagree.
    expect(within(frame()).getByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
  });

  it('switches light and dark instantly, as two proofs of one forme', async () => {
    await renderBranding();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(frame().dataset.mode).toBe('dark');
    expect(screen.getByText('Home · dark · 1440px · published theme')).toBeInTheDocument();
    // The room is not dragged into dark mode with it: the admin obeys the
    // mode the OPERATOR is working in, never the one being previewed.
    expect(document.documentElement.dataset.mode).not.toBe('dark');
  });

  it('renders a phone at a phone’s real width, so its own breakpoints fire', async () => {
    await renderBranding();
    fireEvent.click(screen.getByRole('button', { name: 'Phone (390px)' }));
    expect(frame().style.width).toBe('390px');
    // Twice on purpose: the visible identification line and the screen-reader
    // description of the frame carry the same facts.
    expect(screen.getAllByText(/Home · light · 390px/).length).toBeGreaterThan(0);
  });

  it('shows light and dark side by side, on one candidate', async () => {
    // Dark mode is its own palette, and it is where a brand colour usually
    // fails. Flipping a toggle and remembering is not the same as looking.
    await renderBranding(PRESET_THEME);
    fireEvent.click(screen.getByRole('button', { name: 'Compare light and dark' }));

    const compared = document.getElementById(PREVIEW_COMPARE_SCOPE_ID);
    expect(frame().dataset.mode).toBe('light');
    expect(compared.dataset.mode).toBe('dark');
    // One candidate, two frames: both carry the same style.
    expect(compared.dataset.theme).toBe(frame().dataset.theme);
    expect(previewCss()).toContain(`#${PREVIEW_COMPARE_SCOPE_ID}`);
    expect(screen.getAllByText(/Home · dark · 1440px/).length).toBeGreaterThan(0);
  });

  it('swaps in a long title and a dense day on request, and says it is doing it', async () => {
    await renderBranding(PRESET_THEME);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stress test' }));

    expect(screen.getByText(/Nothing here is saved or published/)).toBeInTheDocument();
    expect(screen.getAllByText(/Schedule · light · 1440px · stress test/).length)
      .toBeGreaterThan(0);
    // The frame is rendering the fixture, not the real programme.
    expect(frame().textContent).toContain('Roundtable: Sustaining multi-newsroom');
  });

  it('previews the session page a shared link lands on', async () => {
    // PROOF_PAGES covers the four routes a visitor navigates to. Session
    // detail is the fifth, and it is the one page most visitors reach
    // first — the page where a theme meets one session's own type, room,
    // and speakers.
    await renderBranding(PRESET_THEME);
    fireEvent.click(screen.getByRole('button', { name: 'Session' }));
    await waitFor(() =>
      expect(
        within(frame()).getByRole('heading', { level: 1, name: 'Welcome and orientation' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText(/Session · light · 1440px/).length).toBeGreaterThan(0);
  });

  it('names a colour it cannot read and says what is showing instead', async () => {
    await renderBranding({ ...PRESET_THEME, brandColor: 'brand blue' });
    expect(screen.getByText(/Main brand colour is not a colour this system can read/))
      .toBeInTheDocument();
    expect(screen.getByText(/style’s own colour is showing instead/)).toBeInTheDocument();
  });

  it('discards the preview when the tab is left', async () => {
    const { unmount } = await renderBranding();
    expect(document.getElementById(PREVIEW_STYLE_ID)).not.toBeNull();
    unmount();
    expect(document.getElementById(PREVIEW_STYLE_ID)).toBeNull();
  });
});

describe('the staff workflow', () => {
  it('asks six questions, in order, and shows the page preview beside them', async () => {
    // Owner calibration, 2026-08-27: "staff complete the normal workflow
    // with a small set of clear decisions". This is that list, and the order
    // is the workflow.
    await renderBranding(PRESET_THEME);
    expect(panelTitles()).toEqual([
      'Site style',
      'Logo and icon',
      'Main brand colour',
      'Header and schedule',
      'Light or dark',
      'Advanced',
      'Page preview',
    ]);
  });

  it('offers all six styles with no second tier, and says who each suits', async () => {
    await renderBranding(PRESET_THEME);
    const picker = screen.getByLabelText('Site style');
    expect(picker).toHaveValue('broadsheet');
    const offered = [...picker.options].map((option) => option.textContent);
    expect(offered).toEqual([
      'None — this deployment’s stored palette',
      'Institutional',
      'Newsroom',
      'Broadsheet',
      'Atlas',
      'Field Guide',
      'Zine',
    ]);
    // Nothing carries a warning label.
    expect(offered.join(' ')).not.toMatch(/experimental|beta|unstable/i);
    expect(screen.getByText(/Best for: Use this style for formal programmes/)).toBeInTheDocument();
  });

  it('asks for the header and the schedule, with the reason for each choice', async () => {
    await renderBranding(PRESET_THEME);
    expect(screen.getByLabelText('Header style')).toHaveValue('full-measure');
    expect(screen.getByLabelText('Schedule style')).toHaveValue('ruled-programme');
    // The catalog's `why` is the hint, so a choice is never a bare name.
    expect(screen.getByText(/Uses hairline rows and a separate time column/)).toBeInTheDocument();
  });

  it('re-renders the frame on the picked style, with that style’s own choices', async () => {
    await renderBranding(PRESET_THEME);
    expect(frame().dataset.theme).toBe('broadsheet');

    fireEvent.change(screen.getByLabelText('Site style'), { target: { value: 'zine' } });
    await waitFor(() => expect(frame().dataset.theme).toBe('zine'));
    // The picks follow the style that offers them, rather than carrying a
    // stale group id the server would reject by name.
    expect(screen.getByLabelText('Schedule style')).toHaveValue('flat-block');
    openAdvanced();
    expect(screen.getByLabelText('Heading face')).toHaveValue('karrik');
  });

  it('states the style’s recommended type pairing in the faces’ own names', async () => {
    // The library is 23 families. These are the four a reader of THIS site
    // gets, so the editor says them rather than leaving an operator to read
    // them off four select boxes.
    await renderBranding(PRESET_THEME);
    openAdvanced();
    const pairing = document.querySelector('#admin-theme-advanced dl');
    expect(pairing.textContent).toContain('Libre Baskerville');
    expect(pairing.textContent).toContain('Libre Caslon Text');
    expect(pairing.textContent).toContain('Source Serif 4');
  });

  it('keeps typography, illustrations, shape, and raw colours behind Advanced', async () => {
    await renderBranding(PRESET_THEME);
    expect(screen.getByRole('button', { name: 'Show the advanced settings' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    for (const label of ['Heading face', 'Illustration set', 'Surface', 'Corners', 'Spacing']) {
      expect(screen.getByLabelText(label).closest('[hidden]'), label).not.toBeNull();
    }
    expect(screen.getByLabelText('Surface — light').closest('[hidden]')).not.toBeNull();

    openAdvanced();
    expect(screen.getByRole('button', { name: 'Hide the advanced settings' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    for (const label of ['Heading face', 'Illustration set', 'Surface', 'Corners', 'Spacing']) {
      expect(screen.getByLabelText(label).closest('[hidden]'), label).toBeNull();
    }
    expect(screen.getByLabelText('Surface — light').closest('[hidden]')).toBeNull();
  });

  it('leaves a shape field blank so a save cannot pin a style to a shape', async () => {
    // Zine names the copier grain; the stored document names no texture. A
    // form that seeded a concrete value here would write it on the next
    // publish and quietly flatten the style.
    await renderBranding({
      preset: 'zine',
      optionPicks: {},
      colors: {},
      mode: 'light',
      // Explicit nulls: the provider overlays config/theme onto the
      // committed snapshot shallowly, and the snapshot predates this rule.
      texture: null,
      radius: null,
      density: null,
    });
    openAdvanced();
    expect(screen.getByLabelText('Surface')).toHaveValue('');
    expect(screen.getByLabelText('Corners')).toHaveValue('');
    expect(screen.getByLabelText('Spacing')).toHaveValue('');

    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/theme' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish the theme' }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const { theme } = JSON.parse(fetch.mock.calls[0][1].body);
    expect(theme.texture).toBeUndefined();
    expect(theme.radius).toBeUndefined();
    expect(theme.density).toBeUndefined();
  });

  it('asks for one brand colour and derives the supporting shades from it', async () => {
    // The operator picks the client's colour. The emphasis and soft steps
    // are worked out for both modes, so there is nothing else to get wrong.
    await renderBranding({ ...PRESET_THEME, brandColor: hex('7a1f3d') });
    expect(screen.getByLabelText('Main brand colour')).toHaveValue(hex('7a1f3d'));
    await waitFor(() => expect(previewCss()).toContain('--brand-primary-rgb: 122 31 61;'));
    // The supporting steps are present and are not the style's own.
    expect(previewCss()).toMatch(/--brand-primary-dark-rgb: \d+ \d+ \d+;/);
    expect(previewCss()).toMatch(/--brand-primary-light-rgb: \d+ \d+ \d+;/);
  });

  it('states the admin marker’s legibility floor plainly when it falls back', async () => {
    // The marker takes the site's own brand colour, so the only question is
    // whether it can be seen on the admin ground. Nothing is clamped: the
    // editor says what the marker fell back to, and the site is unaffected.
    await renderBranding({
      preset: null,
      colors: { primary: hex('ebe8e3'), surface: hex('111111'), ink: hex('ffffff') },
    });
    expect(screen.getByText(/below the 3:1 floor a position marker needs/)).toBeInTheDocument();
    expect(screen.getByText(/falls back to the admin’s own ink/)).toBeInTheDocument();
  });
});

describe('advanced colour settings', () => {
  it('edits per-mode overrides on a light tab and a dark tab', async () => {
    await renderBranding(PRESET_THEME);
    openAdvanced();
    expect(screen.getByLabelText('Surface — light')).toHaveValue(hex('f7f4ee'));

    fireEvent.click(screen.getByRole('button', { name: 'Dark mode' }));
    expect(screen.getByLabelText('Surface — dark')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Surface — dark'), { target: { value: RUST } });
    await waitFor(() => expect(previewCss()).toContain('--brand-surface-rgb: 200 75 49;'));
  });

  it('names the pair, the mode, and the ratio inline, and keeps rendering', async () => {
    await renderBranding(PRESET_THEME);
    openAdvanced();
    // Ink at the surface's own value: nothing can read on it.
    fireEvent.change(screen.getByLabelText('Ink — light'), { target: { value: hex('f7f4ee') } });

    await waitFor(() =>
      // Twice, and on purpose: under the control that caused it, and in the
      // stated line at the top of the bench.
      expect(
        screen.getAllByText(/ink on surface in light mode is 1\.\d+:1, below the 4.5:1 bar/),
      ).toHaveLength(2),
    );
    // A draft may hold a failing value, and the frame keeps rendering it.
    expect(frame()).not.toBeNull();
    expect(previewCss()).toContain('--brand-ink-rgb: 247 244 238;');
  });

  it('clears a mode’s overrides only after stating what goes', async () => {
    await renderBranding(PRESET_THEME);
    openAdvanced();
    expect(screen.getByLabelText('Surface — light')).toHaveValue(hex('f7f4ee'));

    fireEvent.click(screen.getByRole('button', { name: 'Reset the light colours' }));
    expect(screen.getByText(/falls back to the shades worked out from the main brand colour/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset these colours' }));

    expect(screen.getByLabelText('Surface — light')).toHaveValue('');
  });
});

describe('publishing the theme', () => {
  it('posts the WHOLE document: preset, picks, brand colour, tokens, motif set, mode', async () => {
    // config/theme is a whole-doc replace, so a field this form forgets to
    // send is a field the save deletes. That is how the preset pipeline
    // would quietly disappear on the first logo edit.
    await renderBranding(PRESET_THEME);
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/theme' }));

    fireEvent.change(screen.getByLabelText('Primary logo'), {
      target: { value: 'branding/new.svg' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish the theme' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/updateTheme$/);
    const { theme } = JSON.parse(fetch.mock.calls[0][1].body);
    expect(theme.preset).toBe('broadsheet');
    expect(theme.optionPicks).toMatchObject({ headingFace: 'libre-baskerville' });
    expect(theme.tokens).toEqual({ light: { surface: hex('f7f4ee') } });
    expect(theme.motifSet).toBe('none');
    expect(theme.brandColor).toBe(hex('1a3a6e'));
    expect(theme.mode).toBe('light');
    expect(theme.texture).toBe('flat');
    expect(theme.radius).toBe('sharp');
    expect(theme.logos).toEqual({ primary: 'branding/new.svg' });
    expect(await screen.findByText(/no deploy needed/i)).toBeInTheDocument();
  });

  it('carries a pre-preset deployment’s stored palette through untouched', async () => {
    await renderBranding();
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/theme' }));
    openAdvanced();
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: RUST } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish the theme' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const { theme } = JSON.parse(fetch.mock.calls[0][1].body);
    expect(theme.colors.primary).toBe(RUST);
    expect(theme.colors.ink).toBe(hex('2c3e50'));
    expect(theme.fonts).toEqual(LEGACY_THEME.fonts);
    expect(theme.preset).toBeUndefined();
    expect(theme.logos).toEqual(LEGACY_THEME.logos);
  });

  it('surfaces the server’s rejection verbatim, against the offending control', async () => {
    await renderBranding();
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'theme.colors.primary: must be a hex color (#RGB or #RRGGBB), got "teal"',
      ),
    );
    openAdvanced();
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: 'teal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish the theme' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('theme.colors.primary: must be a hex color');
    expect(screen.getByLabelText('Primary')).toHaveAttribute('aria-invalid', 'true');
  });

  it('reverts to the saved theme on request', async () => {
    await renderBranding();
    openAdvanced();
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: RUST } });
    await waitFor(() => expect(previewCss()).toContain('200 75 49'));

    fireEvent.click(screen.getByRole('button', { name: 'Revert to the saved theme' }));
    await waitFor(() => expect(previewCss()).toContain('42 157 143'));
    expect(screen.getByLabelText('Primary')).toHaveValue(TEAL);
  });

  it('says whether the draft is published or not, in the job line', async () => {
    await renderBranding(PRESET_THEME);
    expect(screen.getByText('Live')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Site style'), { target: { value: 'zine' } });
    expect(await screen.findByText('Live with unpublished changes')).toBeInTheDocument();
  });

  // Issue #24: each slot is an ImagePicker over the branding/ namespace. The
  // path stays editable by hand, because the four placeholders init seeds
  // have no library row.
  it('keeps every logo slot and the media picker, two of them in the workflow', async () => {
    await renderBranding();
    expect(screen.getByLabelText('Primary logo')).toHaveValue('branding/logo.svg');
    expect(screen.getByLabelText('Square icon')).toHaveValue('branding/mark.svg');
    // The other three are still here, one disclosure away.
    expect(screen.getByLabelText('Favicon').closest('[hidden]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More image slots' }));
    expect(screen.getByLabelText('Favicon').closest('[hidden]')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Choose or upload…' }).length).toBe(5);
  });
});

describe('color picker input', () => {
  it('expands #RGB shorthand for the native picker, keeping the typed value', async () => {
    // <input type="color"> only understands #rrggbb: handed #fff it
    // sanitizes the value to black, and the next interaction would write
    // that black over a perfectly valid stored color.
    await renderBranding({ ...LEGACY_THEME, colors: { primary: hex('fff') } });
    openAdvanced();
    expect(screen.getByLabelText('Primary')).toHaveValue(hex('fff'));
    expect(screen.getByLabelText('Primary color picker')).toHaveValue(hex('ffffff'));
  });

  it('hides the picker for a value it cannot represent, rather than showing black', async () => {
    await renderBranding();
    openAdvanced();
    fireEvent.change(screen.getByLabelText('Ink'), { target: { value: 'not-a-color' } });
    await waitFor(() => expect(screen.queryByLabelText('Ink color picker')).toBeNull());
    expect(screen.getByLabelText('Ink')).toHaveValue('not-a-color');
  });
});
