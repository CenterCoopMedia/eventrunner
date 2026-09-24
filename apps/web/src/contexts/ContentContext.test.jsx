// ContentProvider runtime behavior (spec §2.4 path 3): snapshot-first
// rendering, published-collection overlays via fake snapshot callbacks, the
// draft read source for admin preview, and the block/page accessors.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Capture each collection subscription so tests can fire fake snapshots.
const { subscriptions, subscribeContentCollection, subscribeSpeakersPublic } = vi.hoisted(() => {
  const subscriptions = new Map();
  return {
    subscriptions,
    subscribeContentCollection: vi.fn((name, readSource, onNext) => {
      subscriptions.set(name, { readSource, onNext });
      return () => subscriptions.delete(name);
    }),
    // speakers_public is not under the publish model: no _drafts sibling,
    // no visibility clause, so its subscription takes no readSource.
    subscribeSpeakersPublic: vi.fn((onNext) => {
      subscriptions.set('speakers_public', { readSource: 'published', onNext });
      return () => subscriptions.delete('speakers_public');
    }),
  };
});

vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection,
  subscribeSpeakersPublic,
}));

import { ContentProvider, useContent, usePages } from './ContentContext.jsx';
import snapshotSiteContent from '@generated/siteContent.js';
import snapshotPages from '@generated/pagesData.js';
import snapshotScheduleData, { speakers as snapshotScheduleSpeakers } from '@generated/scheduleData.js';
import snapshotOrganizationsData from '@generated/organizationsData.js';

function Probe() {
  const { source, getBlock, getSectionBlocks, scheduleData, organizationsData, speakers, loading } =
    useContent();
  const heroTitle = useContent('hero', 'title');
  const { pages, getPage, getPublicPage } = usePages();
  return (
    <>
      <span data-testid="source">{source}</span>
      <span data-testid="hero-title">{heroTitle?.value ?? ''}</span>
      <span data-testid="hero-title-via-getblock">{getBlock('hero', 'title')?.value ?? ''}</span>
      <span data-testid="hero-title-seeded">{String(getBlock('hero', 'title')?.seeded ?? 'absent')}</span>
      <span data-testid="hero-title-publisher">{String(getBlock('hero', 'title')?.publishedBy ?? 'absent')}</span>
      <span data-testid="hero-block-count">{getSectionBlocks('hero').length}</span>
      <span data-testid="page-count">{pages.length}</span>
      <span data-testid="faq-page-label">{getPage('faq')?.label ?? ''}</span>
      <span data-testid="faq-public-label">{getPublicPage('/faq', {})?.label ?? ''}</span>
      <span data-testid="schedule-count">{scheduleData.length}</span>
      <span data-testid="schedule-first-title">{scheduleData[0]?.title ?? ''}</span>
      <span data-testid="organizations-count">{organizationsData.length}</span>
      <span data-testid="organizations-first-name">{organizationsData[0]?.name ?? ''}</span>
      <span data-testid="speakers-count">{speakers.length}</span>
      <span data-testid="speakers-names">{speakers.map((s) => s.displayName).join('|')}</span>
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
      'cmsOrganizations',
      'cmsPages',
      'cmsSchedule',
      'cmsTimeline',
      'cmsUpdates',
      'speakers_public',
    ]);
    for (const { readSource } of subscriptions.values()) {
      expect(readSource).toBe('published');
    }
    expect(screen.getByTestId('schedule-count')).toHaveTextContent(
      String(snapshotScheduleData.length),
    );
    expect(screen.getByTestId('organizations-count')).toHaveTextContent(
      String(snapshotOrganizationsData.length),
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
    for (const [name, { readSource }] of subscriptions.entries()) {
      // speakers_public has no draft revision to preview — the canonical
      // speaker record is not under the publish model (spec §4.3) — so its
      // subscription is the same in either mode.
      expect(readSource).toBe(name === 'speakers_public' ? 'published' : 'draft');
    }
  });

  // Without a runtime subscription the directory sat on the deploy-time
  // snapshot forever: a speaker added, edited, or removed after the last
  // build would never appear or disappear.
  it('overlays a live speakers_public set wholesale, sorted by display name', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    expect(screen.getByTestId('speakers-count')).toHaveTextContent(
      String(snapshotScheduleSpeakers.length),
    );

    act(() => {
      subscriptions.get('speakers_public').onNext([
        { id: 'b', displayName: 'Zoe Last', jobTitle: '', organization: '', bio: '' },
        { id: 'a', displayName: 'Ada First', jobTitle: '', organization: '', bio: '' },
      ]);
    });

    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('speakers-count')).toHaveTextContent('2');
    expect(screen.getByTestId('speakers-names')).toHaveTextContent('Ada First|Zoe Last');
  });

  it('empties the directory when the live speaker set is empty', () => {
    // An empty live result is a real answer — every speaker removed or
    // unapproved — and must not fall back to stale snapshot speakers.
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('speakers_public').onNext([]);
    });
    expect(screen.getByTestId('speakers-count')).toHaveTextContent('0');
  });

  it('keeps the snapshot speakers while no live result has arrived', () => {
    // Fail soft: a rules-denied or still-connecting listener never reports,
    // so the committed snapshot keeps rendering.
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    expect(screen.getByTestId('speakers-count')).toHaveTextContent(
      String(snapshotScheduleSpeakers.length),
    );
    expect(screen.getByTestId('source')).toHaveTextContent('snapshot');
  });

  it('drops a speaker whose rendered fields are not renderable', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('speakers_public').onNext([
        { id: 'ok', displayName: 'Fine Person', jobTitle: '', organization: '', bio: '' },
        { id: 'bad', displayName: { unexpected: true }, jobTitle: '', organization: '', bio: '' },
      ]);
    });
    expect(screen.getByTestId('speakers-count')).toHaveTextContent('1');
    expect(screen.getByTestId('speakers-names')).toHaveTextContent('Fine Person');
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

  it('reads a live block’s seeded flag by who published it, and drops the publisher', () => {
    // The live listener hands the page raw documents. A deployment from
    // before the CMS cleared the flag on edit holds edited blocks that still
    // say seeded: true; the operator's publish decides (shared/seed).
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    const block = {
      id: 'hero__title', section: 'hero', field: 'title', blockType: 'text',
      value: 'Our real headline', visible: true, order: 0, seeded: true,
    };
    act(() => {
      subscriptions.get('cmsContent').onNext([{ ...block, publishedBy: 'admin-uid' }]);
    });
    expect(screen.getByTestId('hero-title-seeded')).toHaveTextContent('absent');
    expect(screen.getByTestId('hero-title-publisher')).toHaveTextContent('absent');
    act(() => {
      subscriptions.get('cmsContent').onNext([{ ...block, publishedBy: 'init-event-script' }]);
    });
    expect(screen.getByTestId('hero-title-seeded')).toHaveTextContent('true');
  });

  it('keeps the snapshot before any live result has arrived (pre-connection null)', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    // No onNext fired yet for any collection — overlay slots are still null,
    // so the snapshot stands (fail soft: nothing has connected yet).
    expect(screen.getByTestId('source')).toHaveTextContent('snapshot');
    expect(screen.getByTestId('hero-title')).toHaveTextContent(
      snapshotSiteContent.hero__title.value,
    );
    expect(screen.getByTestId('schedule-count')).toHaveTextContent(
      String(snapshotScheduleData.length),
    );
    expect(screen.getByTestId('organizations-count')).toHaveTextContent(
      String(snapshotOrganizationsData.length),
    );
  });

  it('empties out when a live result reports zero docs — an empty publish replaces the snapshot, it does not fall back to it', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsContent').onNext([]);
      subscriptions.get('cmsPages').onNext([]);
      subscriptions.get('cmsSchedule').onNext([]);
      subscriptions.get('cmsOrganizations').onNext([]);
    });
    // A live result arrived (even though it's empty) — that's authoritative,
    // not a signal to keep showing stale snapshot content.
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('hero-title')).toHaveTextContent('');
    expect(screen.getByTestId('page-count')).toHaveTextContent('0');
    expect(screen.getByTestId('schedule-count')).toHaveTextContent('0');
    expect(screen.getByTestId('organizations-count')).toHaveTextContent('0');
  });

  it('a listener error leaves last-known values in charge, not the snapshot, once live data was already showing', () => {
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
    // subscribeContentCollection never calls onNext on error (contentSource.js
    // fails soft internally) — simulate that by simply not firing onNext
    // again. The overlay slot keeps its last value, so nothing resets.
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('schedule-count')).toHaveTextContent('1');
    expect(screen.getByTestId('schedule-first-title')).toHaveTextContent(
      'Live-published session',
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

  it('overlays a live published cmsOrganizations set wholesale', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsOrganizations').onNext([
        {
          id: 'live-org',
          name: 'Live-published organization',
          tier: 'presenting',
          visible: true,
          order: 0,
        },
      ]);
    });
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('organizations-count')).toHaveTextContent('1');
    expect(screen.getByTestId('organizations-first-name')).toHaveTextContent(
      'Live-published organization',
    );
  });

  it('drops a live cmsOrganizations doc with a non-primitive renderable field, keeping the rest wholesale', () => {
    // Regression test: the generic content writer (functions/src/cms/
    // content.cjs) now refuses a non-text name at the save (issue #192),
    // but a script or the console can still store e.g.
    // name: { unexpected: true }, so this drop is kept as the second layer.
    // Sponsors.jsx renders name/tier/description directly as JSX children —
    // an object there would make React throw and blank the whole route the
    // moment this listener fires. The malformed doc must be dropped, not
    // rendered, while a same-batch valid doc still comes through.
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsOrganizations').onNext([
        {
          id: 'malformed-org',
          name: { unexpected: true },
          tier: 'presenting',
          visible: true,
          order: 0,
        },
        {
          id: 'valid-org',
          name: 'Valid organization',
          tier: 'supporting',
          visible: true,
          order: 1,
        },
      ]);
    });
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('organizations-count')).toHaveTextContent('1');
    expect(screen.getByTestId('organizations-first-name')).toHaveTextContent(
      'Valid organization',
    );
  });

  it('drops a live cmsOrganizations doc whose tier or description is a non-primitive value', () => {
    // The save refuses these too (issue #192); this guards what reaches the
    // collection without passing through it.
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsOrganizations').onNext([
        { id: 'bad-tier', name: 'Bad tier org', tier: ['not', 'a', 'string'], visible: true },
        {
          id: 'bad-description',
          name: 'Bad description org',
          description: { unexpected: true },
          visible: true,
        },
      ]);
    });
    expect(screen.getByTestId('organizations-count')).toHaveTextContent('0');
  });

  it('a cmsOrganizations listener error leaves last-known values in charge, not the snapshot, once live data was already showing', () => {
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    act(() => {
      subscriptions.get('cmsOrganizations').onNext([
        {
          id: 'live-org',
          name: 'Live-published organization',
          tier: 'presenting',
          visible: true,
          order: 0,
        },
      ]);
    });
    // subscribeContentCollection never calls onNext on error (contentSource.js
    // fails soft internally) — simulate that by simply not firing onNext
    // again. The overlay slot keeps its last value, so nothing resets.
    expect(screen.getByTestId('source')).toHaveTextContent('live');
    expect(screen.getByTestId('organizations-count')).toHaveTextContent('1');
    expect(screen.getByTestId('organizations-first-name')).toHaveTextContent(
      'Live-published organization',
    );
  });

  // cmsTimeline (issue #194): the provider subscribes and hands the raw
  // result on; lib/timelineEntries.js, beside the renderer that loads on
  // demand, applies the snapshot and the drop.
  describe('cmsTimeline', () => {
    function TimelineProbe() {
      const { timelineDocs, source } = useContent();
      return (
        <>
          <span data-testid="timeline-source">{source}</span>
          <span data-testid="timeline-docs">
            {timelineDocs === null ? 'none yet' : timelineDocs.map((doc) => doc.id).join('|') || 'empty'}
          </span>
        </>
      );
    }

    it('reports no timeline result before the listener has, so the snapshot stands', () => {
      render(
        <ContentProvider>
          <TimelineProbe />
        </ContentProvider>,
      );
      expect(subscriptions.get('cmsTimeline').readSource).toBe('published');
      expect(screen.getByTestId('timeline-docs')).toHaveTextContent('none yet');
      expect(screen.getByTestId('timeline-source')).toHaveTextContent('snapshot');
    });

    it('hands a live set on as it arrived, and turns the source live', () => {
      render(
        <ContentProvider>
          <TimelineProbe />
        </ContentProvider>,
      );
      act(() => {
        subscriptions.get('cmsTimeline').onNext([
          { id: 'b', year: 2025, title: 'Second', visible: true },
          { id: 'a', year: 2019, title: 'First', visible: true },
        ]);
      });
      expect(screen.getByTestId('timeline-source')).toHaveTextContent('live');
      expect(screen.getByTestId('timeline-docs')).toHaveTextContent('b|a');
    });

    it('hands an empty live set on as empty, not as no result', () => {
      render(
        <ContentProvider>
          <TimelineProbe />
        </ContentProvider>,
      );
      act(() => {
        subscriptions.get('cmsTimeline').onNext([]);
      });
      expect(screen.getByTestId('timeline-docs')).toHaveTextContent('empty');
    });

    it('a listener error leaves the last live set in charge', () => {
      render(
        <ContentProvider>
          <TimelineProbe />
        </ContentProvider>,
      );
      act(() => {
        subscriptions.get('cmsTimeline').onNext([{ id: 'a', year: 2019, title: 'First', visible: true }]);
      });
      // subscribeContentCollection never calls onNext on error (it fails soft
      // and retries), so the slot keeps its value.
      expect(screen.getByTestId('timeline-docs')).toHaveTextContent('a');
    });

    it('points the timeline listener at the drafts in preview', () => {
      render(
        <ContentProvider readSource="draft">
          <TimelineProbe />
        </ContentProvider>,
      );
      expect(subscriptions.get('cmsTimeline').readSource).toBe('draft');
    });
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
        { id: 'faq', label: 'Hidden page', path: '/faq', visible: false, systemPage: false, order: 0, sections: [] },
      ]);
    });
    expect(screen.getByTestId('hero-title')).toHaveTextContent('');
    expect(screen.getByTestId('hero-block-count')).toHaveTextContent('0');
    expect(screen.getByTestId('faq-page-label')).toHaveTextContent('');
  });

  it('serves a page to a reader only when it says it is visible', () => {
    // The route lookup and the navigation now answer the same question the
    // same way (shared/page isPublicPage): a page that is not linked
    // anywhere must not still open when its address is typed. `visible`
    // absent is the case that used to slip through — the old read was
    // `visible !== false`, so a document mid-write, hand-written straight
    // into Firestore, or older than the field, was unlinked and reachable.
    render(
      <ContentProvider>
        <Probe />
      </ContentProvider>,
    );
    const faq = snapshotPages.find((p) => p.id === 'faq');
    expect(screen.getByTestId('faq-public-label')).toHaveTextContent(faq.label);

    const { visible, ...noVisibleField } = faq;
    expect(visible).toBe(true);
    act(() => {
      subscriptions.get('cmsPages').onNext([noVisibleField]);
    });
    expect(screen.getByTestId('faq-public-label')).toHaveTextContent('');

    act(() => {
      subscriptions.get('cmsPages').onNext([{ ...faq, visible: false }]);
    });
    expect(screen.getByTestId('faq-public-label')).toHaveTextContent('');

    act(() => {
      subscriptions.get('cmsPages').onNext([{ ...faq, visible: true }]);
    });
    expect(screen.getByTestId('faq-public-label')).toHaveTextContent(faq.label);
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
