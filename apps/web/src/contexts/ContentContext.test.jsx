// ContentProvider runtime behavior (spec §2.4 path 3): snapshot-first
// rendering, published-collection overlays via fake snapshot callbacks, the
// draft read source for admin preview, and the block/page accessors.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Capture each collection subscription so tests can fire fake snapshots.
const { subscriptions, subscribeContentCollection } = vi.hoisted(() => {
  const subscriptions = new Map();
  return {
    subscriptions,
    subscribeContentCollection: vi.fn((name, readSource, onNext) => {
      subscriptions.set(name, { readSource, onNext });
      return () => subscriptions.delete(name);
    }),
  };
});

vi.mock('../lib/contentSource.js', () => ({ subscribeContentCollection }));

import { ContentProvider, useContent, usePages } from './ContentContext.jsx';
import snapshotSiteContent from '@generated/siteContent.js';
import snapshotPages from '@generated/pagesData.js';
import snapshotScheduleData from '@generated/scheduleData.js';

function Probe() {
  const { source, getBlock, getSectionBlocks, scheduleData, loading } = useContent();
  const heroTitle = useContent('hero', 'title');
  const { pages, getPage } = usePages();
  return (
    <>
      <span data-testid="source">{source}</span>
      <span data-testid="hero-title">{heroTitle?.value ?? ''}</span>
      <span data-testid="hero-title-via-getblock">{getBlock('hero', 'title')?.value ?? ''}</span>
      <span data-testid="hero-block-count">{getSectionBlocks('hero').length}</span>
      <span data-testid="page-count">{pages.length}</span>
      <span data-testid="faq-page-label">{getPage('faq')?.label ?? ''}</span>
      <span data-testid="schedule-count">{scheduleData.length}</span>
      <span data-testid="schedule-first-title">{scheduleData[0]?.title ?? ''}</span>
      <span data-testid="loading">{String(loading)}</span>
    </>
  );
}

beforeEach(() => {
  subscriptions.clear();
  subscribeContentCollection.mockClear();
});

describe('ContentProvider', () => {
  it('serves the snapshot first and subscribes to the runtime collections', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    expect(screen.getByTestId('source')).toHaveTextContent('snapshot');
    expect(screen.getByTestId('hero-title')).toHaveTextContent(
      snapshotSiteContent.hero__title.value,
    );
    expect(screen.getByTestId('page-count')).toHaveTextContent(
      String(snapshotPages.length),
    );
    expect([...subscriptions.keys()].sort()).toEqual([
      'cmsContent',
      'cmsPages',
      'cmsSchedule',
      'cmsUpdates',
    ]);
    for (const { readSource } of subscriptions.values()) {
      expect(readSource).toBe('published');
    }
    expect(screen.getByTestId('schedule-count')).toHaveTextContent(
      String(snapshotScheduleData.length),
    );
    // Snapshot renders synchronously; loading is never true (fail soft, no
    // spinner-trap while the live cmsSchedule listener is still connecting).
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  it("readSource 'draft' points subscriptions at the draft revision", () => {
    render(
      <ContentProvider readSource="draft">
        <Probe />
      </ContentProvider>,
    );
    for (const { readSource } of subscriptions.values()) {
      expect(readSource).toBe('draft');
    }
  });

  it('overlays a live published cmsContent set wholesale', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsContent').onNext([
        {
          id: 'hero__title',
          section: 'hero',
          field: 'title',
          blockType: 'text',
          value: 'Live headline',
          visible: true,
          order: 0,
        },
      ]);
    });
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('Live headline');
    // Wholesale replace: the snapshot's other hero blocks are gone.
    expect(screen.getByTestId('hero-block-count')).toHaveTextContent('1');
  });

  it('keeps the snapshot when the live result is empty (fail soft)', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsContent').onNext([]);
      subscriptions.get('cmsPages').onNext([]);
      subscriptions.get('cmsSchedule').onNext([]);
    });
    expect(screen.getByTestId('source')).toHaveTextContent('snapshot');
    expect(screen.getByTestId('hero-title')).toHaveTextContent(
      snapshotSiteContent.hero__title.value,
    );
    expect(screen.getByTestId('schedule-count')).toHaveTextContent(
      String(snapshotScheduleData.length),
    );
  });

  it('overlays a live published cmsSchedule set wholesale', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsSchedule').onNext([
        {
          id: 'live-session',
          dayId: 'day-1',
          startTime: '09:00',
          endTime: '09:30',
          title: 'Live-published session',
          visible: true,
          order: 0,
        },
      ]);
    });
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('schedule-count')).toHaveTextContent('1');
    expect(screen.getByTestId('schedule-first-title')).toHaveTextContent(
      'Live-published session',
    );
  });

  it('hides blocks and pages marked visible: false', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsContent').onNext([
        {
          id: 'hero__title',
          section: 'hero',
          field: 'title',
          blockType: 'text',
          value: 'Hidden headline',
          visible: false,
          order: 0,
        },
      ]);
      subscriptions.get('cmsPages').onNext([
        { id: 'faq', label: 'Hidden page', path: '/p/faq', visible: false, systemPage: false, order: 0, sections: [] },
      ]);
    });
    expect(screen.getByTestId('hero-title')).toHaveTextContent('');
    expect(screen.getByTestId('hero-block-count')).toHaveTextContent('0');
    expect(screen.getByTestId('faq-page-label')).toHaveTextContent('');
  });

  it('resolves pages by id or path via getPage', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    const faq = snapshotPages.find((p) => p.id === 'faq');
    expect(screen.getByTestId('faq-page-label')).toHaveTextContent(faq.label);
  });
});
