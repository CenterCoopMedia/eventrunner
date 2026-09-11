import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EventConfigContext from '../contexts/EventConfigContext.jsx';
import { recommendedConfiguration } from '../lib/themeRuntime.js';
import {
  DemoBannerContent,
  readDemoDisplay,
  writeDemoDisplaySearch,
} from './DemoBanner.jsx';
import { DEMO_STYLE_OPTIONS } from './demoStyleOptions.js';

function renderControls({
  search = '',
  theme = { preset: 'newsroom', mode: 'light' },
  pageDocument = document,
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
  it('shows every style and applies the URL selection', async () => {
    const { history, setDemoTheme } = renderControls({
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
    const { setDemoTheme } = renderControls();

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

  it('moves to the previous or next style and wraps the list', () => {
    const first = DEMO_STYLE_OPTIONS[0];
    const last = DEMO_STYLE_OPTIONS.at(-1);
    renderControls({
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
    const { history } = renderControls({
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
    expect(exitButton.className).toContain('fixed');
    expect(exitButton.className).toContain('bottom-md');
    expect(exitButton.className).toContain('start-md');

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
    renderControls({ pageDocument });

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
    const first = renderControls({ pageDocument: unsupportedDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Preview full screen' }));
    expect(screen.getByRole('button', { name: 'Exit preview' })).toBeInTheDocument();
    first.view.unmount();

    const deniedDocument = new EventTarget();
    deniedDocument.documentElement = {
      requestFullscreen: vi.fn(() => Promise.reject(new Error('denied'))),
    };
    deniedDocument.fullscreenElement = null;
    renderControls({ pageDocument: deniedDocument });

    fireEvent.click(screen.getByRole('button', { name: 'Preview full screen' }));
    await waitFor(() => {
      expect(deniedDocument.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    });
    expect(screen.getByRole('button', { name: 'Exit preview' })).toBeInTheDocument();
  });
});

describe('the demo band', () => {
  it('names the style in the heading face, with the summary under it', () => {
    const style = DEMO_STYLE_OPTIONS[0];
    renderControls({ search: `?style=${style.id}&mode=light` });

    const name = screen.getByText(style.label, { selector: 'p' });
    expect(name.className).toContain('font-heading');
    // Under it, never above it.
    expect(name.nextElementSibling?.textContent).toBe(style.summary);
    expect(name.previousElementSibling).toBeNull();
  });

  it('keeps the five controls in one row at the shared control height', () => {
    renderControls({ search: '?style=newsroom&mode=light' });

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

  it('runs its content on the same stage as the header, the page and the footer', () => {
    // The band held its own max-w-5xl and px-md, so at 1440px its content
    // box ran 224 to 1216 against the header's 164 to 1276: a 1024px box
    // with a 16px gutter inside a 1160px stage with a 24px one, which put
    // the band 60px inside the frame at each end.
    renderControls({ search: '?style=civic&mode=light' });
    const band = screen.getByRole('note', { name: 'Demo controls' });
    const inner = band.firstElementChild;
    expect(inner.className).toContain('stage');
    expect(inner.className).not.toContain('max-w-');
    expect(inner.className).not.toMatch(/\bpx-/u);
  });

  it('draws no pill, no shadow, and no gradient', () => {
    renderControls({ search: '?style=zine&mode=dark' });
    const band = screen.getByRole('note', { name: 'Demo controls' });
    expect(band.outerHTML).not.toMatch(/rounded-full|shadow|gradient/u);
  });

  it('lets nothing in the row set a width the viewport cannot hold', () => {
    renderControls({ search: '?style=civic&mode=light' });
    const select = screen.getByLabelText('Site style');
    // The select is the one control that can grow. It grows to its
    // container and no further, so a 390px viewport never scrolls sideways.
    expect(select.className).toContain('min-w-0');
    expect(select.parentElement.className).toContain('min-w-0');
  });
});
