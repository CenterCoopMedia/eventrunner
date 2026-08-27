import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  render(
    <EventConfigContext.Provider value={{ theme, setDemoTheme }}>
      <DemoBannerContent location={location} history={history} />
    </EventConfigContext.Provider>,
  );

  return { history, location, setDemoTheme };
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

    fireEvent.click(screen.getByRole('button', { name: 'Previous style' }));
    expect(screen.getByLabelText('Site style')).toHaveValue(last.id);

    fireEvent.click(screen.getByRole('button', { name: 'Next style' }));
    expect(screen.getByLabelText('Site style')).toHaveValue(first.id);
  });
});
