import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { subscriptions } = vi.hoisted(() => ({ subscriptions: new Map() }));

vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: vi.fn((docId, onNext) => {
    subscriptions.set(docId, onNext);
    return () => subscriptions.delete(docId);
  }),
}));

import {
  EventConfigProvider,
  useEventConfig,
} from './EventConfigContext.jsx';

function DemoThemeProbe() {
  const { setDemoTheme, source, theme } = useEventConfig();
  return (
    <>
      <span data-testid="theme-preset">{theme.preset}</span>
      <span data-testid="theme-mode">{theme.mode}</span>
      <span data-testid="config-source">{source}</span>
      <button
        type="button"
        onClick={() =>
          setDemoTheme({
            preset: 'field-guide',
            optionPicks: {},
            mode: 'dark',
          })
        }
      >
        Set demo theme
      </button>
      <button type="button" onClick={() => setDemoTheme(null)}>
        Clear demo theme
      </button>
    </>
  );
}

function runtimeStyle() {
  return document.getElementById('event-theme-runtime');
}

beforeEach(() => {
  subscriptions.clear();
  runtimeStyle()?.remove();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.mode;
  delete document.documentElement.dataset.texture;
  delete document.documentElement.dataset.density;
  delete document.documentElement.dataset.motifSet;
});

describe('EventConfigProvider demo theme override', () => {
  it('uses the normal resolver and stays separate from live configuration', () => {
    render(
      <EventConfigProvider demoMode>
        <DemoThemeProbe />
      </EventConfigProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set demo theme' }));

    expect(screen.getByTestId('theme-preset')).toHaveTextContent('field-guide');
    expect(screen.getByTestId('theme-mode')).toHaveTextContent('dark');
    expect(screen.getByTestId('config-source')).toHaveTextContent('snapshot');
    expect(document.documentElement.dataset.theme).toBe('field-guide');
    expect(document.documentElement.dataset.mode).toBe('dark');
    expect(runtimeStyle().textContent).toContain("--font-heading: 'Besley'");
    expect(runtimeStyle().textContent).toContain(
      ":root[data-theme][data-mode='dark']",
    );
    expect(runtimeStyle().textContent).toContain(
      '--brand-surface-rgb: 28 28 27;',
    );

    act(() => {
      subscriptions.get('theme')({
        preset: 'zine',
        optionPicks: {},
        mode: 'light',
      });
    });

    // The visitor's demo selection remains in charge while the comparison
    // control is active. The live document is still retained underneath it.
    expect(screen.getByTestId('theme-preset')).toHaveTextContent('field-guide');
    expect(document.documentElement.dataset.theme).toBe('field-guide');
    expect(screen.getByTestId('config-source')).toHaveTextContent('live');

    fireEvent.click(screen.getByRole('button', { name: 'Clear demo theme' }));
    expect(screen.getByTestId('theme-preset')).toHaveTextContent('zine');
    expect(document.documentElement.dataset.theme).toBe('zine');
  });

  it('does not expose a demo setter in a client build', () => {
    function ClientProbe() {
      const { setDemoTheme } = useEventConfig();
      return <span>{String(setDemoTheme)}</span>;
    }

    render(
      <EventConfigProvider demoMode={false}>
        <ClientProbe />
      </EventConfigProvider>,
    );

    expect(screen.getByText('null')).toBeInTheDocument();
  });
});
