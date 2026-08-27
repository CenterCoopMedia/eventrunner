// Branding tab (issue #15 done-when: "changing colors/logo in the Branding
// tab restyles the public site with no deploy").
//
// Two things are pinned here: the LIVE PREVIEW — candidate values run through
// lib/themeRuntime.js and land on the page before any save, in a style
// element that does not fight EventConfigProvider for its own — and the
// updateTheme payload, which is a whole-doc replace and therefore always
// carries colors, fonts, texture, radius, and the logo slots together.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
}));

import App from '../../App.jsx';
import { PREVIEW_STYLE_ID } from '../themePreview.js';

// Hex values are DATA here, never literals in source (spec §7.6 forbids hex
// literals outside the allowlist — including in tests).
const hex = (digits) => `#${digits}`;
const TEAL = hex('2a9d8f');
const RUST = hex('c84b31');

const LIVE_THEME = {
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

function okResponse(body = {}) {
  return { ok: true, status: 200, json: async () => body };
}
function errorResponse(status, code, message) {
  return { ok: false, status, json: async () => ({ error: { code, message } }) };
}
const previewCss = () => document.getElementById(PREVIEW_STYLE_ID)?.textContent ?? '';

async function renderBranding() {
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
  await waitFor(() => {
    expect(screen.queryByLabelText('Loading admin')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Checking your access…')).not.toBeInTheDocument();
  });
  await act(async () => {
    configSubscriptions.get('theme')(LIVE_THEME);
    await Promise.resolve();
  });
  return result;
}

beforeEach(() => {
  configSubscriptions.clear();
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
  globalThis.fetch = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('branding live preview', () => {
  it('applies a candidate color to the page before anything is saved', async () => {
    await renderBranding();
    expect(previewCss()).toContain('--brand-primary-rgb: 42 157 143;');

    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: RUST } });

    // 0xC8 0x4B 0x31 → 200 75 49, applied through the same builder the
    // runtime override uses.
    await waitFor(() => expect(previewCss()).toContain('--brand-primary-rgb: 200 75 49;'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('previews font, texture, and radius changes too, and owns its own style element', async () => {
    await renderBranding();

    fireEvent.change(screen.getByLabelText('Heading font'), {
      target: { value: 'script-casual' },
    });
    fireEvent.change(screen.getByLabelText('Texture'), { target: { value: 'flat' } });
    fireEvent.change(screen.getByLabelText('Corner radius'), { target: { value: 'round' } });

    await waitFor(() => expect(previewCss()).toContain('Caveat'));
    expect(previewCss()).toContain('--texture: flat;');
    expect(previewCss()).toContain('--radius-base: 16px;');
    // The texture treatment is gated on this attribute (index.css).
    expect(document.documentElement.dataset.texture).toBe('flat');
    // EventConfigProvider's own runtime element is left alone.
    expect(document.getElementById('event-theme-runtime')).not.toBeNull();
    expect(document.getElementById(PREVIEW_STYLE_ID)).not.toBe(
      document.getElementById('event-theme-runtime'),
    );
  });

  it('discards the preview when the tab is left', async () => {
    const { unmount } = await renderBranding();
    expect(document.getElementById(PREVIEW_STYLE_ID)).not.toBeNull();
    unmount();
    expect(document.getElementById(PREVIEW_STYLE_ID)).toBeNull();
  });

  it('reverts to the saved theme on request', async () => {
    await renderBranding();
    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: RUST } });
    await waitFor(() => expect(previewCss()).toContain('200 75 49'));

    fireEvent.click(screen.getByRole('button', { name: 'Revert to saved' }));
    await waitFor(() => expect(previewCss()).toContain('42 157 143'));
    expect(screen.getByLabelText('Primary')).toHaveValue(TEAL);
  });

  it('reverting a color the saved theme does not set does not resurrect the candidate', async () => {
    // Colors absent from config/theme are seeded by reading them back off
    // :root — so reverting while the preview stylesheet is still applied
    // would read the UNSAVED candidate as if it were the saved value.
    // jsdom does not resolve custom properties, so getComputedStyle is stood
    // in for with a reader over whatever stylesheet is currently applied,
    // which is exactly the behaviour being guarded against.
    await renderBranding();
    // `accent` is not in LIVE_THEME.colors.
    fireEvent.change(screen.getByLabelText('Accent'), { target: { value: RUST } });
    await waitFor(() => expect(previewCss()).toContain('--brand-accent-rgb: 200 75 49;'));

    const readFromAppliedCss = vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      getPropertyValue: (prop) => {
        const css = document.getElementById(PREVIEW_STYLE_ID)?.textContent ?? '';
        const match = css.match(new RegExp(`${prop}:\\s*([^;]+);`));
        return match ? match[1] : '';
      },
    }));
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Revert to saved' }));
    } finally {
      readFromAppliedCss.mockRestore();
    }

    expect(screen.getByLabelText('Accent')).toHaveValue('');
    await waitFor(() => expect(previewCss()).not.toContain('--brand-accent-rgb'));
  });
});

describe('color picker input', () => {
  it('expands #RGB shorthand for the native picker, keeping the typed value', async () => {
    // <input type="color"> only understands #rrggbb: handed #fff it
    // sanitizes the value to black, and the next interaction would write
    // that black over a perfectly valid stored color.
    configSubscriptions.clear();
    render(
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
    await waitFor(() => {
      expect(screen.queryByLabelText('Loading admin')).not.toBeInTheDocument();
    });
    await act(async () => {
      configSubscriptions.get('theme')({ ...LIVE_THEME, colors: { primary: hex('fff') } });
      await Promise.resolve();
    });

    expect(screen.getByLabelText('Primary')).toHaveValue(hex('fff'));
    expect(screen.getByLabelText('Primary color picker')).toHaveValue(hex('ffffff'));
  });

  it('hides the picker for a value it cannot represent, rather than showing black', async () => {
    await renderBranding();
    fireEvent.change(screen.getByLabelText('Ink'), { target: { value: 'not-a-color' } });
    await waitFor(() => expect(screen.queryByLabelText('Ink color picker')).toBeNull());
    expect(screen.getByLabelText('Ink')).toHaveValue('not-a-color');
  });
});

describe('branding save', () => {
  it('posts the whole theme document, carrying the logo slots through', async () => {
    await renderBranding();
    fetch.mockResolvedValueOnce(okResponse({ docPath: 'config/theme' }));

    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: RUST } });
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/updateTheme$/);
    const { theme } = JSON.parse(fetch.mock.calls[0][1].body);
    expect(theme.colors.primary).toBe(RUST);
    expect(theme.fonts).toEqual(LIVE_THEME.fonts);
    expect(theme.texture).toBe('paper');
    expect(theme.radius).toBe('soft');
    // The mode policy rides along too — a whole-doc replace that dropped it
    // would silently move a dark deployment back to light.
    expect(theme.mode).toBe('system');
    // Untouched slots ride along rather than being dropped by the whole-doc
    // replace.
    expect(theme.logos).toEqual(LIVE_THEME.logos);
    expect(await screen.findByText(/no deploy needed/i)).toBeInTheDocument();
  });

  it('surfaces the server’s hex-color rejection against the offending swatch', async () => {
    await renderBranding();
    fetch.mockResolvedValueOnce(
      errorResponse(
        400,
        'bad-request',
        'theme.colors.primary: must be a hex color (#RGB or #RRGGBB), got "teal"',
      ),
    );

    fireEvent.change(screen.getByLabelText('Primary'), { target: { value: 'teal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save branding' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('theme.colors.primary: must be a hex color');
    expect(screen.getByLabelText('Primary')).toHaveAttribute('aria-invalid', 'true');
  });

  // Issue #24 closed the "no upload backend" TODO: each slot is now an
  // ImagePicker over the branding/ namespace. The path stays editable by
  // hand, because the four placeholders init seeds have no library row.
  it('edits each logo slot through the media picker, path still typeable', async () => {
    await renderBranding();
    expect(screen.queryByText(/asset upload has no backend yet/i)).toBeNull();
    expect(screen.getByLabelText('Primary logo')).toHaveValue('branding/logo.svg');
    expect(
      screen.getAllByRole('button', { name: 'Choose or upload…' }).length,
    ).toBe(5);
  });
});
