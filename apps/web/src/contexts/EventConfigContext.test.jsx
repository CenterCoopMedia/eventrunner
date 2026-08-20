// EventConfigProvider runtime behavior (spec §2.4 path 2 + §7.2):
// snapshot-first rendering, config doc overlays via fake onSnapshot
// callbacks, the runtime theme style element, and feature-driven nav.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Capture each config doc subscription so tests can fire fake snapshots.
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
  useFeatures,
} from './EventConfigContext.jsx';
import Layout from '../components/Layout.jsx';
import { eventConfig as snapshotEventConfig } from '@generated/eventConfig.js';

// Compose hex test data at runtime — no hex color literals in source (§7.6).
const hex = (digits) => `#${digits}`;

function Probe() {
  const { eventConfig, source } = useEventConfig();
  const features = useFeatures();
  return (
    <>
      <span data-testid="name">{eventConfig.name}</span>
      <span data-testid="source">{source}</span>
      <span data-testid="schedule-feature">{String(features.schedule)}</span>
    </>
  );
}

function runtimeStyle() {
  return document.getElementById('event-theme-runtime');
}

beforeEach(() => {
  subscriptions.clear();
  runtimeStyle()?.remove();
});

describe('EventConfigProvider', () => {
  it('serves the snapshot first and subscribes to the four config docs', () => {
    render(
      <EventConfigProvider>
        <Probe />
      </EventConfigProvider>,
    );
    expect(screen.getByTestId('name')).toHaveTextContent(snapshotEventConfig.name);
    expect(screen.getByTestId('source')).toHaveTextContent('snapshot');
    expect([...subscriptions.keys()].sort()).toEqual([
      'badges',
      'event',
      'features',
      'theme',
    ]);
    // The provider owns the runtime style element from mount; it is empty
    // until config/theme arrives, so build-time theme.css stays in charge.
    expect(runtimeStyle()).not.toBeNull();
    expect(runtimeStyle().textContent).toBe('');
  });

  it('updates the runtime style element when config/theme changes', () => {
    render(
      <EventConfigProvider>
        <Probe />
      </EventConfigProvider>,
    );

    act(() => {
      subscriptions.get('theme')({
        colors: { primary: hex('336699') },
        radius: 'round',
      });
    });
    expect(runtimeStyle().textContent).toContain(
      '--brand-primary-rgb: 51 102 153;',
    );
    expect(runtimeStyle().textContent).toContain('--radius-base: 16px;');
    expect(screen.getByTestId('source')).toHaveTextContent('live');

    // A second theme write replaces the previous override wholesale.
    act(() => {
      subscriptions.get('theme')({ colors: { primary: hex('112233') } });
    });
    expect(runtimeStyle().textContent).toContain(
      '--brand-primary-rgb: 17 34 51;',
    );
    expect(runtimeStyle().textContent).not.toContain('51 102 153');
    expect(runtimeStyle().textContent).not.toContain('--radius-base');
  });

  it('overlays config/event and config/features on the snapshot', () => {
    render(
      <EventConfigProvider>
        <Probe />
      </EventConfigProvider>,
    );

    act(() => {
      subscriptions.get('event')({ name: '[Demo] Renamed Gathering' });
      subscriptions.get('features')({ schedule: false });
    });
    expect(screen.getByTestId('name')).toHaveTextContent(
      '[Demo] Renamed Gathering',
    );
    expect(document.title).toBe('[Demo] Renamed Gathering');
    expect(screen.getByTestId('schedule-feature')).toHaveTextContent('false');
  });
});

describe('Layout nav', () => {
  function renderShell() {
    return render(
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <EventConfigProvider>
          <Layout />
        </EventConfigProvider>
      </MemoryRouter>,
    );
  }

  it('hides nav items whose feature is disabled at runtime', () => {
    renderShell();
    // Snapshot features enable all three sections.
    expect(screen.getByRole('link', { name: 'Speakers' })).toBeInTheDocument();

    act(() => {
      subscriptions.get('features')({ speakers: false, sponsors: false });
    });
    expect(screen.queryByRole('link', { name: 'Speakers' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sponsors' })).toBeNull();
    // Untouched features fall back to the snapshot and stay visible.
    expect(screen.getByRole('link', { name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toBeInTheDocument();
  });
});
