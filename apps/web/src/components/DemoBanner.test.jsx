import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import { recommendedConfiguration } from '../lib/themeRuntime.js';
import {
  DemoBannerContent,
  readDemoDisplay,
  writeDemoDisplaySearch,
} from './DemoBanner.jsx';
import { DEMO_STYLE_OPTIONS } from './demoStyleOptions.js';
import DemoSettings from './DemoSettings.jsx';
import { loadDemoSettings } from './demoSettingsLoader.js';

vi.mock('./demoSettingsLoader.js', () => ({ loadDemoSettings: vi.fn() }));

beforeEach(() => {
  vi.mocked(loadDemoSettings).mockReset().mockResolvedValue({ default: DemoSettings });
});

async function renderControls({
  search = '',
  theme = { preset: 'newsroom', mode: 'light' },
  pageDocument = document,
  settingsOpen = true,
} = {}) {
  const setDemoTheme = vi.fn();
  const location = {
    pathname: '/eventrunner/demo/',
    search,
    hash: '#/schedule',
  };
  const history = {
    state: null,
    replaceState: vi.fn(),
  };

  const view = render(
    <EventConfigContext.Provider value={{ theme, setDemoTheme }}>
      <DemoBannerContent
        location={location}
        history={history}
        pageDocument={pageDocument}
      />
    </EventConfigContext.Provider>,
  );

  if (settingsOpen) {
    fireEvent.click(screen.getByRole('button', { name: 'Demo settings' }));
    await screen.findByRole('combobox', { name: 'Site style' });
  }
  return { history, location, setDemoTheme, view };
}

describe('demo display query', () => {
  it('uses valid URL values and falls back to the saved theme', () => {
    expect(
      readDemoDisplay('?style=atlas&mode=dark', {
        preset: 'newsroom',
        mode: 'light',
      }),
    ).toEqual({ style: 'atlas', mode: 'dark' });

    expect(
      readDemoDisplay('?style=unknown&mode=system', {
        preset: 'newsroom',
        mode: 'light',
      }),
    ).toEqual({ style: 'newsroom', mode: 'light' });
  });

  it('preserves unrelated query parameters', () => {
    expect(
      writeDemoDisplaySearch('?ref=proposal', 'zine', 'dark'),
    ).toBe('?ref=proposal&style=zine&mode=dark');
  });
});

describe('DemoBannerContent', () => {
  it('starts compact, keeps the notice and preview visible, and restores settings focus on Escape', async () => {
    await renderControls({ settingsOpen: false });
    const toggle = screen.getByRole('button', { name: 'Demo settings' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox', { name: 'Site style' })).toBeNull();
    expect(screen.getByText(/Read-only/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview full screen' })).toBeVisible();
    expect(loadDemoSettings).not.toHaveBeenCalled();
    for (let i = 0; i < 2; i += 1) {
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const style = await screen.findByRole('combobox', { name: 'Site style' });
      style.focus();
      fireEvent.keyDown(style, { key: 'Escape' });
      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    }
    expect(loadDemoSettings).toHaveBeenCalledTimes(1);
  });

  it('applies a deep-linked style and mode before the settings panel is requested', async () => {
    const { history, setDemoTheme } = await renderControls({
      search: '?style=atlas&mode=dark&ref=proposal',
      settingsOpen: false,
    });
    expect(setDemoTheme).toHaveBeenLastCalledWith({ ...recommendedConfiguration('atlas'), mode: 'dark' });
    expect(history.replaceState).toHaveBeenLastCalledWith(
      null, '', '/eventrunner/demo/?style=atlas&mode=dark&ref=proposal#/schedule',
    );
    expect(loadDemoSettings).not.toHaveBeenCalled();
  });

  it('explains a pending panel load and ignores its late result after closing', async () => {
    let finish;
    vi.mocked(loadDemoSettings).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await renderControls({ settingsOpen: false });
    const toggle = screen.getByRole('button', { name: 'Demo settings' });
    fireEvent.click(toggle);
    expect(screen.getByRole('status', { name: 'Loading demo settings…' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview full screen' })).toBeVisible();
    fireEvent.keyDown(toggle, { key: 'Escape' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await act(async () => finish({ default: DemoSettings }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(await screen.findByRole('combobox', { name: 'Site style' })).toBeVisible();
    expect(loadDemoSettings).toHaveBeenCalledTimes(2);
  });

  it('keeps the banner usable after a failed panel load and retries the request', async () => {
    vi.mocked(loadDemoSettings).mockRejectedValueOnce(new Error('offline'));
    await renderControls({ settingsOpen: false });
    fireEvent.click(screen.getByRole('button', { name: 'Demo settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection and try again.');
    expect(screen.getByRole('button', { name: 'Preview full screen' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try loading settings again' }));
    expect(await screen.findByRole('combobox', { name: 'Site style' })).toHaveValue('newsroom');
    expect(screen.getByRole('button', { name: 'Demo settings' })).toHaveFocus();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(loadDemoSettings).toHaveBeenCalledTimes(2);
  });
  it('shows every style and applies the URL selection', async () => {
    const { history, setDemoTheme } = await renderControls({
      search: '?style=atlas&mode=dark&ref=proposal',
    });

    const select = screen.getByLabelText('Site style');
    expect(select).toHaveValue('atlas');
    expect(screen.getAllByRole('option')).toHaveLength(
      DEMO_STYLE_OPTIONS.length,
    );
    expect(screen.getByText(/Navigation-focused layout/)).toBeInTheDocument();

    await waitFor(() => {
      expect(setDemoTheme).toHaveBeenLastCalledWith({
        ...recommendedConfiguration('atlas'),
        mode: 'dark',
      });
    });
    expect(history.replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/eventrunner/demo/?style=atlas&mode=dark&ref=proposal#/schedule',
    );
  });

  it('selects a style by name and changes the display mode', async () => {
    const { setDemoTheme } = await renderControls();

    fireEvent.change(screen.getByLabelText('Site style'), {
      target: { value: 'field-guide' },
    });
    await waitFor(() => {
      expect(setDemoTheme).toHaveBeenLastCalledWith({
        ...recommendedConfiguration('field-guide'),
        mode: 'light',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use dark mode' }));
    await waitFor(() => {
      expect(setDemoTheme).toHaveBeenLastCalledWith({
        ...recommendedConfiguration('field-guide'),
        mode: 'dark',
      });
    });
    expect(
      screen.getByRole('button', { name: 'Use light mode' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('moves to the previous or next style and wraps the list', async () => {
    const first = DEMO_STYLE_OPTIONS[0];
    const last = DEMO_STYLE_OPTIONS.at(-1);
    await renderControls({
      search: `?style=${first.id}&mode=light`,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Previous site style' }));
    expect(screen.getByLabelText('Site style')).toHaveValue(last.id);

    fireEvent.click(screen.getByRole('button', { name: 'Next site style' }));
    expect(screen.getByLabelText('Site style')).toHaveValue(first.id);
  });

  it('enters fullscreen preview and restores controls and focus on browser exit or Escape', async () => {
    const pageDocument = new EventTarget();
    pageDocument.documentElement = {};
    pageDocument.fullscreenElement = null;
    pageDocument.documentElement.requestFullscreen = vi.fn(async () => {
      pageDocument.fullscreenElement = pageDocument.documentElement;
    });
    pageDocument.exitFullscreen = vi.fn(async () => {
      pageDocument.fullscreenElement = null;
    });
    const { history } = await renderControls({
      search: '?style=zine&mode=dark',
      pageDocument,
    });

    const previewButton = screen.getByRole('button', { name: 'Preview full screen' });
    previewButton.focus();
    fireEvent.click(previewButton);
    expect(pageDocument.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('note', { name: 'Demo controls' })).toBeNull();
    const exitButton = screen.getByRole('button', { name: 'Exit preview' });
    expect(exitButton).toHaveFocus();
    const previewControls = screen.getByRole('region', { name: 'Preview controls' });
    expect(previewControls).toContainElement(exitButton);
    expect(previewControls).toHaveClass('no-print');
    expect(exitButton).toHaveClass('touch-target');
    for (const element of [exitButton, exitButton.parentElement, previewControls]) {
      expect(element.className).not.toMatch(/\b(fixed|absolute|sticky|bottom-md|start-md)\b/);
    }

    pageDocument.fullscreenElement = null;
    act(() => pageDocument.dispatchEvent(new Event('fullscreenchange')));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview full screen' })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Preview full screen' }));
    act(() => pageDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview full screen' })).toHaveFocus();
    });
    expect(pageDocument.exitFullscreen).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Site style')).toHaveValue('zine');
    expect(screen.getByRole('button', { name: 'Use light mode' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(history.replaceState).toHaveBeenLastCalledWith(
      null,
      '',
      '/eventrunner/demo/?style=zine&mode=dark#/schedule',
    );
  });

  it('exits fullscreen when a delayed request resolves after preview was cancelled', async () => {
    let resolveRequest;
    const request = new Promise((resolve) => {
      resolveRequest = resolve;
    });
    const pageDocument = new EventTarget();
    pageDocument.documentElement = {
      requestFullscreen: vi.fn(() => request),
    };
    pageDocument.fullscreenElement = null;
    pageDocument.exitFullscreen = vi.fn(async () => {
      pageDocument.fullscreenElement = null;
    });
    await renderControls({ pageDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Preview full screen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(pageDocument.exitFullscreen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Preview full screen' })).toBeInTheDocument();

    await act(async () => {
      pageDocument.fullscreenElement = pageDocument.documentElement;
      resolveRequest();
      await request;
    });
    await waitFor(() => expect(pageDocument.exitFullscreen).toHaveBeenCalledOnce());
    expect(pageDocument.fullscreenElement).toBeNull();
  });

  it('keeps the in-page preview when fullscreen is unavailable or denied', async () => {
    const unsupportedDocument = new EventTarget();
    unsupportedDocument.documentElement = {};
    unsupportedDocument.fullscreenElement = null;
    const first = await renderControls({ pageDocument: unsupportedDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Preview full screen' }));
    expect(screen.getByRole('button', { name: 'Exit preview' })).toBeInTheDocument();
    first.view.unmount();

    const deniedDocument = new EventTarget();
    deniedDocument.documentElement = {
      requestFullscreen: vi.fn(() => Promise.reject(new Error('denied'))),
    };
    deniedDocument.fullscreenElement = null;
    await renderControls({ pageDocument: deniedDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Preview full screen' }));
    await waitFor(() => {
      expect(deniedDocument.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole('button', { name: 'Exit preview' })).toBeInTheDocument();
  });
});

describe('the demo band', () => {
  it('names the style in the heading face, with the summary under it', async () => {
    const style = DEMO_STYLE_OPTIONS[0];
    await renderControls({ search: `?style=${style.id}&mode=light` });

    const name = screen.getByText(style.label, { selector: 'p' });
    expect(name.className).toContain('font-heading');
    // Under it, never above it.
    expect(name.nextElementSibling?.textContent).toBe(style.summary);
    expect(name.previousElementSibling).toBeNull();
  });

  it('keeps the five controls in one row at the shared control height', async () => {
    await renderControls({ search: '?style=newsroom&mode=light' });

    const controls = [
      screen.getByRole('button', { name: 'Previous site style' }),
      screen.getByLabelText('Site style'),
      screen.getByRole('button', { name: 'Next site style' }),
      screen.getByRole('button', { name: 'Use dark mode' }),
      screen.getByRole('button', { name: 'Preview full screen' }),
    ];
    for (const control of controls) {
      // `touch-target` is the 44px floor every control on the site takes.
      // A number written on this row as well would be a second source for
      // one measurement, and the row would drift off the rest of the site
      // the first time the floor moved.
      expect(control.className).toContain('touch-target');
      expect(control.className).not.toMatch(/\bh-\d/u);
    }
  });

  it('runs its content on the same stage as the header, the page and the footer', async () => {
    // The band held its own max-w-5xl and px-md, so at 1440px its content
    // box ran 224 to 1216 against the header's 164 to 1276: a 1024px box
    // with a 16px gutter inside a 1160px stage with a 24px one, which put
    // the band 60px inside the frame at each end.
    await renderControls({ search: '?style=civic&mode=light' });
    const band = screen.getByRole('note', { name: 'Demo controls' });
    const inner = band.firstElementChild;
    expect(inner.className).toContain('stage');
    expect(inner.className).not.toContain('max-w-');
    expect(inner.className).not.toMatch(/\bpx-/u);
  });

  it('draws no pill, no shadow, and no gradient', async () => {
    await renderControls({ search: '?style=zine&mode=dark' });
    const band = screen.getByRole('note', { name: 'Demo controls' });
    expect(band.outerHTML).not.toMatch(/rounded-full|shadow|gradient/u);
  });

  it('lets nothing in the row set a width the viewport cannot hold', async () => {
    await renderControls({ search: '?style=civic&mode=light' });
    const select = screen.getByLabelText('Site style');
    // The select is the one control that can grow. It grows to its
    // container and no further, so a 390px viewport never scrolls sideways.
    expect(select.className).toContain('min-w-0');
    expect(select.parentElement.className).toContain('min-w-0');
  });
});
