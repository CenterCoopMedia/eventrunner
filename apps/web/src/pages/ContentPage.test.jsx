// Pages tests (spec §5.2, issue #52): Home renders its cmsPages sections
// through the block registry, generic pages render at their own root-level
// `path` via the catch-all route, and unknown paths get the same designed
// 404 used everywhere else on the site.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';

// Credential-free (spec §8.1): stub the provider seams so no Firebase env or
// network is needed — same approach as App.test.jsx. contentSource's
// subscription callback is captured so a couple of tests can push a fake
// cmsPages overlay (a stale /p/... doc, a doc under a reserved prefix) that
// could never round-trip through cmsSavePage today, matching data already
// sitting in Firestore from before issue #52.
const { subscriptions, subscribeContentCollection } = vi.hoisted(() => {
  const subscriptions = new Map();
  return {
    subscriptions,
    subscribeContentCollection: vi.fn((name, readSource, onNext) => {
      subscriptions.set(name, onNext);
      return () => subscriptions.delete(name);
    }),
  };
});
vi.mock('../lib/configSource.js', () => ({
  subscribeConfigDoc: () => () => {},
}));
vi.mock('../lib/contentSource.js', () => ({
  subscribeContentCollection,
  subscribeSpeakersPublic: () => () => {},
}));
vi.mock('../firebase.js', () => ({
  app: {}, auth: {}, db: {}, storage: {},
  // The travel page resolves the venue map's Storage path to a URL; the
  // bucket is named so the resolve succeeds, and nothing is fetched. The
  // home page's sponsor strip resolves each organization's mark the same
  // way (lib/mediaSource.js), so its marks build a URL too — a mark is
  // decorative either way, so the wall says nothing about it and the names
  // under the marks are what this test reads.
  storageBucketName: 'demo.appspot.com',
  storageDownloadOrigin: 'https://firebasestorage.example',
  // App Check is unconfigured in a credential-free run, which is also its
  // production default: no site key, no attestation header (issue #45).
  appCheckEnabled: false,
  appCheckHeaders: async () => ({}),
}));

import App from '../App.jsx';
import siteContent from '@generated/siteContent.js';
import { eventConfig } from '@generated/eventConfig.js';
import pagesData from '@generated/pagesData.js';
import organizationsData from '@generated/organizationsData.js';
import { VENUE_MAP_SECTION_ID } from 'shared/venue';

function renderAt(path) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

describe('Home', () => {
  it('renders the home page sections from cmsPages + cmsContent', () => {
    renderAt('/');
    // Hero from the hero section blocks.
    expect(
      screen.getByRole('heading', { level: 1, name: siteContent.hero__title.value }),
    ).toBeInTheDocument();
    // The registration action is configuration, not content (M7 issue 8),
    // and the demo configures none: it is a static build with no ticket
    // provider behind it, so it ships the empty case. Nothing anywhere on
    // the page opens a registration destination — no dead button in the
    // lead, and none in the header it would otherwise repeat on every page.
    expect(eventConfig.registration.externalUrl).toBeNull();
    // The header carries no outbound control at all — the register control
    // is the only one it would hold — and the lead offers nothing to click.
    expect(document.querySelector('header a[target="_blank"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /register/i })).toBeNull();
    // Generic sections render with their labels from the pages snapshot.
    const home = pagesData.find((p) => p.id === 'home');
    // The key facts group (M7 issue 9) is drawn by the core, under its own
    // heading, and exactly once: the slot renderer must not draw the same
    // section a second time further down the page.
    const infoSection = home.sections.find((s) => s.id === 'info');
    expect(screen.getAllByRole('heading', { name: infoSection.label })).toHaveLength(1);
    expect(screen.getByText(siteContent.info__when.takeaway)).toBeInTheDocument();
    expect(screen.getByText(siteContent.info__where_venue.text)).toBeInTheDocument();
    // The sponsor strip (M7 issue 10) draws the demo's own published
    // organizations on the home page, in the section's own place: it comes
    // after the History section, which is where the seed puts it.
    expect(screen.getByText(siteContent.sponsors__lede.value)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: organizationsData[0].name })).toBeInTheDocument();
    const sectionOrder = home.sections
      .filter((s) => screen.queryByRole('heading', { name: s.label }))
      .map((s) => s.id);
    expect(sectionOrder.indexOf('sponsors')).toBeGreaterThan(sectionOrder.indexOf('stats'));
    const statsSection = home.sections.find((s) => s.id === 'stats');
    expect(
      screen.getByRole('heading', { name: statsSection.label }),
    ).toBeInTheDocument();
    // Stat blocks render value + label.
    expect(screen.getByText(siteContent.stats__attendees.label)).toBeInTheDocument();
    // Footer link group renders as a descriptive link.
    expect(
      screen.getByRole('link', { name: siteContent.footer__contact_link.label }),
    ).toHaveAttribute('href', siteContent.footer__contact_link.url);
  });
});

describe('ContentPage (catch-all route)', () => {
  it('renders a non-system page at its own root-level path', async () => {
    renderAt('/faq');
    const faqPage = pagesData.find((p) => p.id === 'faq');
    expect(
      await screen.findByRole('heading', { level: 1, name: faqPage.label }),
    ).toBeInTheDocument();
    // The FAQ item renders as a disclosure with its question.
    expect(screen.getByText(siteContent.faq_items__what_is_this.question)).toBeInTheDocument();
  });

  it('names itself in the document title, in the shape the server already sent', async () => {
    // The server writes "<page> · <event>" into the HTML it serves
    // (functions/src/public/og.cjs). Client-side navigation asks the
    // server nothing, so the app has to keep the tab in step and compose
    // it the same way, or the title changes the moment the app boots.
    renderAt('/faq');
    const faqPage = pagesData.find((p) => p.id === 'faq');
    await screen.findByRole('heading', { level: 1, name: faqPage.label });
    expect(document.title).toBe(`${faqPage.label} · ${eventConfig.name}`);
  });

  it('leaves the event name standing alone on a page that does not resolve', async () => {
    renderAt('/definitely-not-published');
    await screen.findByRole('heading', { name: 'Page not found' });
    expect(document.title).toBe(eventConfig.name);
  });

  it('names a listing route too, which has no record of its own to name', async () => {
    // /schedule renders its own component and never calls useDocumentTitle,
    // so before the central resolver a direct load showed the server's
    // title and then dropped to the bare event name.
    //
    // Waited on the same 5s window as the routing test below, and for the
    // same reason: /schedule arrives through DeferredPage, so this is a
    // dynamic import, and the default one second measures how busy the
    // machine is rather than whether the route resolved.
    renderAt('/schedule');
    const schedulePage = pagesData.find((p) => p.id === 'schedule');
    await screen.findByRole(
      'heading',
      { level: 1, name: schedulePage.label },
      { timeout: 5000 },
    );
    expect(document.title).toBe(`${schedulePage.label} · ${eventConfig.name}`);
  });

  it('names the event alone on the home page, as the server titles it', async () => {
    renderAt('/');
    expect(document.title).toBe(eventConfig.name);
  });

  it('renders the venue map on the travel page, rooms and all', async () => {
    // The map is config/event data, not a block, and the seeded travel page
    // asks for it by stating the venue-map section. So the section renders
    // with no blocks in it at all — and a reader who cannot see the picture
    // still gets every room name as text.
    renderAt('/travel');
    const travel = pagesData.find((p) => p.id === 'travel');
    const mapSection = travel.sections.find((s) => s.id === 'travel_map');
    expect(mapSection.defaultBlocks).toHaveLength(0);
    expect(
      await screen.findByRole('heading', { name: mapSection.label }),
    ).toBeInTheDocument();
    expect(screen.getByAltText(eventConfig.venue.map.alt)).toBeInTheDocument();
    for (const place of eventConfig.venue.places) {
      expect(screen.getByText(place.name)).toBeInTheDocument();
    }
  });

  it('still renders the map on a travel page seeded before the section existed', async () => {
    // The deployment that upgrades into this feature has a travel page with
    // no venue-map section, and re-running init leaves an edited page alone.
    // Uploading a map there has to publish something, or the operator has
    // filled in a form that does nothing and no way to find out why. The
    // section POSITIONS the map; it is not what makes the map exist.
    renderAt('/travel');
    await screen.findByRole('heading', { name: 'Venue map' });
    const travel = pagesData.find((p) => p.id === 'travel');
    act(() => {
      subscriptions.get('cmsPages')([
        ...pagesData.filter((page) => page.id !== 'travel'),
        { ...travel, sections: travel.sections.filter((s) => s.id !== 'travel_map') },
      ]);
    });
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.at(-1)).toHaveTextContent('Venue map');
    expect(screen.getByAltText(eventConfig.venue.map.alt)).toBeInTheDocument();
    expect(screen.getByText(eventConfig.venue.places[0].name)).toBeInTheDocument();
  });

  it('404s cleanly on an unknown path', async () => {
    renderAt('/definitely-not-published');
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Go to the home page' }),
    ).toBeInTheDocument();
  });

  it('the old /p/ prefix 404s — it is retired, not redirected', async () => {
    renderAt('/p/faq');
    expect(
      await screen.findByRole('heading', { name: 'Page not found' }),
    ).toBeInTheDocument();
  });

  it('shows the unreviewed-template notice on the seeded legal pages (spec §5.5)', async () => {
    // config/event.legal.reviewRequired is true on every fresh deployment,
    // and the public notice is one of the two places §5.1.1 puts the
    // enforcement an operator cannot miss.
    expect(eventConfig.legal.reviewRequired).toBe(true);
    renderAt('/privacy');
    expect(await screen.findByRole('note')).toHaveTextContent('unreviewed template');
  });

  it('does not show the notice on a non-legal page', async () => {
    renderAt('/faq');
    await screen.findByRole('heading', { name: 'Frequently asked questions' });
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('a system route wins over the catch-all even though both could match', async () => {
    renderAt('/schedule');
    // Schedule is a dedicated route (spec §2.4), not routed through
    // ContentPage — its own page renders, not a 404 and not the generic
    // content article wrapper.
    //
    // It also arrives through DeferredPage, so this waits on a dynamic
    // import rather than on a render: the default one-second window is a
    // measure of how busy the machine is, not of whether the route resolved.
    expect(
      await screen.findByRole('heading', { name: 'Schedule' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });

  it('404s a live/draft doc still carrying the retired /p/ path, not renders it', async () => {
    renderAt('/p/faq');
    await screen.findByRole('heading', { name: 'Page not found' });
    act(() => {
      subscriptions.get('cmsPages')([
        ...pagesData,
        {
          id: 'legacy-faq',
          label: 'Legacy FAQ',
          path: '/p/faq',
          icon: null,
          order: 99,
          visible: true,
          systemPage: false,
          sections: [],
        },
      ]);
    });
    // validatePageDoc would refuse this path on a save today, but the doc
    // could still be sitting in Firestore from before issue #52 — the
    // router must not trust it just because it matched.
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Legacy FAQ' })).not.toBeInTheDocument();
  });

  it('404s a doc saved under a reserved prefix like /signin/help', async () => {
    renderAt('/signin/help');
    await screen.findByRole('heading', { name: 'Page not found' });
    act(() => {
      subscriptions.get('cmsPages')([
        ...pagesData,
        {
          id: 'signin-help',
          label: 'Sign-in help',
          path: '/signin/help',
          icon: null,
          order: 99,
          visible: true,
          systemPage: false,
          sections: [],
        },
      ]);
    });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sign-in help' })).not.toBeInTheDocument();
  });

  it('leaves a normal root-level page unaffected by the reserved-path check', async () => {
    renderAt('/faq');
    await screen.findByRole('heading', { name: 'Frequently asked questions' });
    act(() => {
      subscriptions.get('cmsPages')(pagesData);
    });
    const faqPage = pagesData.find((p) => p.id === 'faq');
    expect(
      screen.getByRole('heading', { level: 1, name: faqPage.label }),
    ).toBeInTheDocument();
  });
});

// Search and a section index on long content pages (issue #14, spec M7-14).
// Generic behaviour: an FAQ block makes a page a search surface by itself,
// at any size (the seeded FAQ page qualifies at two sections and two
// blocks — see the FAQ-specific test below), which is one of three
// independent ways in. The other two are pure size rules, and the real
// seeded pages other than FAQ (Contact included) sit well under both of
// them, so most scenarios here use a synthetic page pushed the same way the
// reserved-path tests above do — full control over section and block
// counts is the point, to pin the size rule's actual boundary rather than
// whatever the demo fixture currently happens to contain.
describe('ContentPage — search and section index on long pages', () => {
  /** A page section shaped the way cmsPages actually stores one. */
  function pageSection(id, label) {
    return {
      id,
      label,
      description: '',
      allowedBlocks: ['text'],
      maxBlocks: 20,
      reorderable: true,
      defaultBlocks: [],
    };
  }

  /** A cmsContent text block. */
  function textBlock(section, field, value, order = 0) {
    return {
      id: `${section}__${field}`,
      section,
      field,
      blockType: 'text',
      value,
      visible: true,
      order,
    };
  }

  function pushPage(page) {
    act(() => {
      subscriptions.get('cmsPages')([...pagesData, page]);
    });
  }

  function pushContent(blocks) {
    act(() => {
      subscriptions.get('cmsContent')(blocks);
    });
  }

  // Three populated sections — crosses the section-count branch of the
  // threshold (issue review decision #8) on its own, with only three blocks
  // total, so it never crosses the block-count branch too. The first
  // section's block text deliberately shares no word with the others, so a
  // query can isolate any one section cleanly.
  const LONG_SECTIONS_PAGE = {
    id: 'long-sections',
    label: 'Long sections fixture',
    path: '/long-sections',
    icon: null,
    order: 99,
    visible: true,
    systemPage: false,
    sections: [
      pageSection('ls_intro', 'Introduction'),
      pageSection('ls_middle', 'Middle notes'),
      pageSection('ls_end', 'Closing'),
    ],
  };
  const LONG_SECTIONS_BLOCKS = [
    textBlock('ls_intro', 'summary', 'Welcome to the fixture page for these tests.'),
    textBlock('ls_middle', 'note', 'The ramp is at the north door, a fact worth knowing.'),
    textBlock('ls_end', 'note', 'Zzyzx, a word that appears nowhere else on this page.'),
  ];

  function renderLongSectionsPage() {
    renderAt('/long-sections');
    pushPage(LONG_SECTIONS_PAGE);
    pushContent(LONG_SECTIONS_BLOCKS);
  }

  it('shows a filter box and a section index once a page crosses the section-count threshold', async () => {
    renderLongSectionsPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' }),
    ).toBeInTheDocument();

    expect(screen.getByRole('searchbox', { name: 'Filter by keyword' })).toBeInTheDocument();
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    // The first section's heading is screen-reader only (it stands in for
    // the page title) and is left out of the index — see the omission test
    // below — so only the other two sections are listed here.
    expect(within(index).getByRole('link', { name: 'Middle notes' })).toHaveAttribute(
      'href',
      '#section-ls_middle',
    );
    expect(within(index).getByRole('link', { name: 'Closing' })).toHaveAttribute(
      'href',
      '#section-ls_end',
    );
  });

  it('shows the filter and index on a page that crosses the block-count branch instead, at two sections', async () => {
    const page = {
      id: 'long-blocks',
      label: 'Long blocks fixture',
      path: '/long-blocks',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [pageSection('lb_a', 'Overview'), pageSection('lb_b', 'More detail')],
    };
    const blocks = [
      textBlock('lb_a', 'one', 'Point one.', 0),
      textBlock('lb_a', 'two', 'Point two.', 1),
      textBlock('lb_a', 'three', 'Point three.', 2),
      textBlock('lb_a', 'four', 'Point four.', 3),
      textBlock('lb_b', 'one', 'Detail one.', 0),
      textBlock('lb_b', 'two', 'Detail two.', 1),
      textBlock('lb_b', 'three', 'Detail three.', 2),
      textBlock('lb_b', 'four', 'Detail four.', 3),
    ];
    renderAt('/long-blocks');
    pushPage(page);
    pushContent(blocks);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Long blocks fixture' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Filter by keyword' })).toBeInTheDocument();
  });

  it('stays off a page with two sections and only seven blocks — one short of the block-count branch', async () => {
    const page = {
      id: 'short-blocks',
      label: 'Short blocks fixture',
      path: '/short-blocks',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [pageSection('sb_a', 'Overview'), pageSection('sb_b', 'More detail')],
    };
    const blocks = [
      textBlock('sb_a', 'one', 'Point one.', 0),
      textBlock('sb_a', 'two', 'Point two.', 1),
      textBlock('sb_a', 'three', 'Point three.', 2),
      textBlock('sb_a', 'four', 'Point four.', 3),
      textBlock('sb_b', 'one', 'Detail one.', 0),
      textBlock('sb_b', 'two', 'Detail two.', 1),
      textBlock('sb_b', 'three', 'Detail three.', 2),
    ];
    renderAt('/short-blocks');
    pushPage(page);
    pushContent(blocks);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Short blocks fixture' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Sections on this page' }),
    ).not.toBeInTheDocument();
  });

  it('qualifies the seeded FAQ page even though it sits under the size rule, because it carries a faq_item block', async () => {
    // The seeded FAQ page (scripts/lib/seed.cjs) has two sections and two
    // blocks total — under both size branches — but an FAQ is a set of
    // independent questions a reader scans for one of, by nature a search
    // surface regardless of how few questions are seeded so far.
    const faqPage = pagesData.find((p) => p.id === 'faq');
    expect(faqPage.sections.length).toBe(2);

    renderAt('/faq');
    await screen.findByRole('heading', { level: 1, name: faqPage.label });

    expect(screen.getByRole('searchbox', { name: 'Filter by keyword' })).toBeInTheDocument();

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    fireEvent.change(filter, { target: { value: siteContent.faq_items__what_is_this.question } });
    expect(
      screen.getByText(siteContent.faq_items__what_is_this.question),
    ).toBeInTheDocument();
  });

  it('does not qualify the seeded Contact page — two sections, two blocks, no faq_item', async () => {
    const contactPage = pagesData.find((p) => p.id === 'contact');
    expect(contactPage.sections.length).toBe(2);

    renderAt('/contact');
    await screen.findByRole('heading', { level: 1, name: contactPage.label });

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Sections on this page' }),
    ).not.toBeInTheDocument();
  });

  it('qualifies any page carrying a faq_item block, even a single section far under the size rule', async () => {
    const page = {
      id: 'one-faq',
      label: 'One FAQ fixture',
      path: '/one-faq',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [pageSection('of_only', 'Questions')],
    };
    const blocks = [
      {
        id: 'of_only__q1',
        section: 'of_only',
        field: 'q1',
        blockType: 'faq_item',
        question: 'Is this searchable?',
        answer: 'Yes.',
        visible: true,
        order: 0,
      },
    ];
    renderAt('/one-faq');
    pushPage(page);
    pushContent(blocks);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'One FAQ fixture' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Filter by keyword' })).toBeInTheDocument();
  });

  it('renders no filter box or section index on a page with only one section', async () => {
    renderAt('/short-page');
    await screen.findByRole('heading', { name: 'Page not found' });
    pushPage({
      id: 'short-page',
      label: 'Short page',
      path: '/short-page',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [pageSection('short_only', 'Only section')],
    });
    pushContent([textBlock('short_only', 'body', 'The only thing on this page.')]);

    expect(await screen.findByText('The only thing on this page.')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Sections on this page' }),
    ).not.toBeInTheDocument();
  });

  // WHERE THE TWO M7 FEATURES MEET. The venue map is not a block, so a
  // section that states it carries a block count of zero — and the long-page
  // gate, the section index, and the "Nothing here yet" empty state all ask
  // "is this section populated?". A map is content, so all three have to
  // answer yes, or a page that publishes a floor plan reads as a blank page
  // with an index that will not name the one thing on it.
  it('counts a map-only section as populated, for the gate and for the index', async () => {
    renderAt('/map-gate');
    await screen.findByRole('heading', { name: 'Page not found' });
    pushPage({
      id: 'map-gate',
      label: 'Map gate fixture',
      path: '/map-gate',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      // Two sections carrying one block each, plus the map section. On block
      // count alone this page is well under every threshold (two blocks
      // against SECTION_INDEX_MIN_BLOCKS); it is the map section counting as
      // the third populated section that puts it over the line.
      sections: [
        pageSection('mg_intro', 'Introduction'),
        pageSection('mg_notes', 'Notes'),
        pageSection(VENUE_MAP_SECTION_ID, 'Venue map'),
      ],
    });
    pushContent([
      textBlock('mg_intro', 'summary', 'Welcome to the fixture page for these tests.'),
      textBlock('mg_notes', 'note', 'The ramp is at the north door, a fact worth knowing.'),
    ]);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Map gate fixture' }),
    ).toBeInTheDocument();
    // The map itself rendered, with no block of its own to render.
    expect(screen.getByAltText(eventConfig.venue.map.alt)).toBeInTheDocument();
    // The gate opened: without the map section this page has two populated
    // sections and two blocks, which crosses neither size rule.
    expect(screen.getByRole('searchbox', { name: 'Filter by keyword' })).toBeInTheDocument();
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).getByRole('link', { name: 'Venue map' })).toHaveAttribute(
      'href',
      `#section-${VENUE_MAP_SECTION_ID}`,
    );
  });

  it('counts the retained map as a result so the status does not deny what is on screen', async () => {
    renderAt('/map-status');
    await screen.findByRole('heading', { name: 'Page not found' });
    pushPage({
      id: 'map-status',
      label: 'Map status fixture',
      path: '/map-status',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [
        pageSection('ms_intro', 'Introduction'),
        pageSection('ms_notes', 'Notes'),
        pageSection(VENUE_MAP_SECTION_ID, 'Venue map'),
      ],
    });
    pushContent([
      textBlock('ms_intro', 'summary', 'Welcome to the fixture page for these tests.'),
      textBlock('ms_notes', 'note', 'The ramp is at the north door, a fact worth knowing.'),
    ]);
    await screen.findByRole('heading', { level: 1, name: 'Map status fixture' });

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    const status = screen.getByRole('status');

    vi.useFakeTimers();
    try {
      // The map is not a block and carries no block text, so it survives a
      // filter on its section's label alone. The count used to read blocks
      // only, so the live region announced "No items match" over a page
      // that was, right then, showing the plan the reader had asked for.
      fireEvent.change(filter, { target: { value: 'Venue' } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(screen.getByAltText(eventConfig.venue.map.alt)).toBeInTheDocument();
      expect(status).toHaveTextContent('1 of 3 items match');

      // A query nothing answers still says so, map and all.
      fireEvent.change(filter, { target: { value: 'Zzyzx' } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(status).toHaveTextContent('No items match');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no empty state on a page whose only content is the map', async () => {
    renderAt('/map-only');
    await screen.findByRole('heading', { name: 'Page not found' });
    pushPage({
      id: 'map-only',
      label: 'Map only fixture',
      path: '/map-only',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [pageSection(VENUE_MAP_SECTION_ID, 'Venue map')],
    });
    pushContent([]);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Map only fixture' }),
    ).toBeInTheDocument();
    expect(screen.getByAltText(eventConfig.venue.map.alt)).toBeInTheDocument();
    // Neither empty state: there IS something here, and no filter ran.
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing matches that filter')).not.toBeInTheDocument();
  });

  it('narrows blocks by keyword and drops a section with no remaining match', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    fireEvent.change(filter, { target: { value: 'Zzyzx' } });

    expect(screen.getByRole('heading', { name: 'Closing' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Introduction' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Middle notes' })).not.toBeInTheDocument();
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).queryByRole('link', { name: 'Middle notes' })).not.toBeInTheDocument();
    expect(within(index).getByRole('link', { name: 'Closing' })).toBeInTheDocument();
  });

  it('matches a section by its own label, not only by its block text (issue review decision #9)', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    // "Middle" appears in the section's own label, not in its block text
    // ("The ramp is at the north door, a fact worth knowing.").
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by keyword' }), {
      target: { value: 'Middle' },
    });

    expect(screen.getByRole('heading', { name: 'Middle notes' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Closing' })).not.toBeInTheDocument();
  });

  it('gives the page-first section a real, visible heading once filtering puts a different section first', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    // Unfiltered: the page's own first section (Introduction) renders
    // screen-reader only, because it usually repeats the page title.
    expect(screen.getByRole('heading', { name: 'Introduction' }).className).toMatch(/sr-only/);

    // "fact" matches only Middle notes' block text — Introduction and
    // Closing both drop, so Middle notes renders at index 0. It is NOT the
    // page's own first section, so it must still get a real heading rather
    // than inheriting the screen-reader-only treatment from its position.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter by keyword' }), {
      target: { value: 'fact' },
    });
    const middleHeading = screen.getByRole('heading', { name: 'Middle notes' });
    expect(middleHeading.className).not.toMatch(/sr-only/);
    expect(screen.queryByRole('heading', { name: 'Introduction' })).not.toBeInTheDocument();
  });

  it('omits the page-first section from the index — its heading has nothing visible to land on', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).queryByRole('link', { name: 'Introduction' })).not.toBeInTheDocument();
    expect(within(index).getByRole('link', { name: 'Middle notes' })).toBeInTheDocument();
    expect(within(index).getByRole('link', { name: 'Closing' })).toBeInTheDocument();
  });

  // isTitleRepeatingSection (ContentPage.jsx) reads a section's own label
  // and id, not its render position, so these four exercise it directly
  // against the real seeded pages plus one synthetic page shaped to have
  // NO title-repeating section at all — the case the old positional rule
  // got wrong (it hid whichever section rendered first, full stop).
  it('hides the seeded FAQ page\'s intro heading and omits it from the index, by its "_intro" id', async () => {
    renderAt('/faq');
    const faqPage = pagesData.find((p) => p.id === 'faq');
    const introSection = faqPage.sections.find((s) => s.id === 'faq_intro');
    await screen.findByRole('heading', { level: 1, name: faqPage.label });

    expect(screen.getByRole('heading', { name: introSection.label }).className).toMatch(/sr-only/);
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).queryByRole('link', { name: introSection.label })).not.toBeInTheDocument();
  });

  it('hides the seeded travel page\'s header heading, by its "_header" id, and keeps its real sections visible', async () => {
    renderAt('/travel');
    const travelPage = pagesData.find((p) => p.id === 'travel');
    const headerSection = travelPage.sections.find((s) => s.id === 'travel_header');
    const venueSection = travelPage.sections.find((s) => s.id === 'travel_venue');
    await screen.findByRole('heading', { level: 1, name: travelPage.label });

    expect(screen.getByRole('heading', { name: headerSection.label }).className).toMatch(/sr-only/);
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).queryByRole('link', { name: headerSection.label })).not.toBeInTheDocument();
    // Venue is real content, not a title stand-in — visible heading, in the index.
    expect(screen.getByRole('heading', { name: venueSection.label }).className).not.toMatch(/sr-only/);
    expect(within(index).getByRole('link', { name: venueSection.label })).toBeInTheDocument();
  });

  it('hides the seeded city guide page\'s intro heading and shows "Places to eat" as a real, indexed section', async () => {
    // The regression this whole rule exists to fix: the old positional rule
    // hid whichever section rendered first, so a demo with no
    // city_guide_intro content hid "Places to eat" — real content — right
    // along with it. The demo overlay now seeds city_guide_intro (see
    // demo-event.cjs), so this exercises the fixed shape end to end.
    renderAt('/city-guide');
    const cityGuidePage = pagesData.find((p) => p.id === 'city_guide');
    const introSection = cityGuidePage.sections.find((s) => s.id === 'city_guide_intro');
    const eatSection = cityGuidePage.sections.find((s) => s.id === 'city_guide_eat');
    await screen.findByRole('heading', { level: 1, name: cityGuidePage.label });

    expect(screen.getByRole('heading', { name: introSection.label }).className).toMatch(/sr-only/);
    expect(screen.getByRole('heading', { name: eatSection.label }).className).not.toMatch(/sr-only/);
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).queryByRole('link', { name: introSection.label })).not.toBeInTheDocument();
    expect(within(index).getByRole('link', { name: eatSection.label })).toBeInTheDocument();
  });

  it('gives a real, visible heading to a page whose first section is not an intro/header at all', async () => {
    // No section here ends in "_intro" or "_header", and no section's label
    // repeats the page's own label — a page an operator built from scratch
    // whose first section is just its first real content. The old
    // positional rule (`baseSections[0]`) would have hidden this section's
    // heading unconditionally, for no reason but its render position.
    const page = {
      id: 'no-intro-page',
      label: 'No intro fixture',
      path: '/no-intro-page',
      icon: null,
      order: 99,
      visible: true,
      systemPage: false,
      sections: [
        pageSection('ni_first', 'First topic'),
        pageSection('ni_second', 'Second topic'),
        pageSection('ni_third', 'Third topic'),
      ],
    };
    const blocks = [
      textBlock('ni_first', 'body', 'The first real thing on this page.'),
      textBlock('ni_second', 'body', 'The second real thing on this page.'),
      textBlock('ni_third', 'body', 'The third real thing on this page.'),
    ];
    renderAt('/no-intro-page');
    pushPage(page);
    pushContent(blocks);

    await screen.findByRole('heading', { level: 1, name: 'No intro fixture' });
    expect(screen.getByRole('heading', { name: 'First topic' }).className).not.toMatch(/sr-only/);
    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    expect(within(index).getByRole('link', { name: 'First topic' })).toBeInTheDocument();
    expect(within(index).getByRole('link', { name: 'Second topic' })).toBeInTheDocument();
    expect(within(index).getByRole('link', { name: 'Third topic' })).toBeInTheDocument();
  });

  it('moves focus to the target section heading when a section link is activated', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const index = screen.getByRole('navigation', { name: 'Sections on this page' });
    fireEvent.click(within(index).getByRole('link', { name: 'Closing' }));

    expect(document.activeElement).toHaveAttribute('id', 'section-ls_end');
    expect(within(index).getByRole('link', { name: 'Closing' })).toHaveAttribute(
      'aria-current',
      'location',
    );
  });

  it('states the empty result when nothing matches, and clearing restores the page and focus', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    fireEvent.change(filter, { target: { value: 'zzzznotarealword' } });

    expect(
      await screen.findByRole('heading', { name: 'Nothing matches that filter' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Closing' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(screen.getByRole('heading', { name: 'Closing' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Nothing matches that filter' }),
    ).not.toBeInTheDocument();
    // Focus lands back on the filter, not on the body the unmounted button left.
    expect(document.activeElement).toBe(filter);
  });

  it('returns focus to the filter input after the beside-the-box Clear filter action too', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    fireEvent.change(filter, { target: { value: 'Zzyzx' } });
    expect(screen.getByRole('heading', { name: 'Closing' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(filter).toHaveValue('');
    expect(document.activeElement).toBe(filter);
  });

  it('settles the announced status text about 300ms after typing stops, not on every keystroke', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    const status = screen.getByRole('status');
    // Always mounted, empty while idle — never absent from the DOM.
    expect(status).toBeInTheDocument();
    expect(status).toHaveTextContent('');

    vi.useFakeTimers();
    try {
      fireEvent.change(filter, { target: { value: 'fact' } });
      // The visible list narrows immediately...
      expect(screen.getByRole('heading', { name: 'Middle notes' })).toBeInTheDocument();
      // ...but the announced text has not settled yet.
      expect(status).toHaveTextContent('');

      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(status).toHaveTextContent('');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(status).toHaveTextContent('1 of 3 items match');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the announced status text at once on Clear filter, not 300ms later', async () => {
    renderLongSectionsPage();
    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });

    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    const status = screen.getByRole('status');

    vi.useFakeTimers();
    try {
      fireEvent.change(filter, { target: { value: 'Zzyzx' } });
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(status).toHaveTextContent('1 of 3 items match');

      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
      // Cleared immediately — no stale "1 of 3 items match" hanging around
      // for the next 300ms while the debounce catches up.
      expect(status).toHaveTextContent('');

      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(status).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the filter when navigating from one content page to another (App renders one unkeyed catch-all element)', async () => {
    render(
      <MemoryRouter
        initialEntries={['/long-sections']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Link to="/long-blocks">Go to long blocks</Link>
        <App />
      </MemoryRouter>,
    );
    act(() => {
      subscriptions.get('cmsPages')([
        ...pagesData,
        LONG_SECTIONS_PAGE,
        {
          id: 'long-blocks',
          label: 'Long blocks fixture',
          path: '/long-blocks',
          icon: null,
          order: 99,
          visible: true,
          systemPage: false,
          sections: [pageSection('lb_a', 'Overview'), pageSection('lb_b', 'More detail')],
        },
      ]);
      subscriptions.get('cmsContent')([
        ...LONG_SECTIONS_BLOCKS,
        textBlock('lb_a', 'one', 'Point one.', 0),
        textBlock('lb_a', 'two', 'Point two.', 1),
        textBlock('lb_a', 'three', 'Point three.', 2),
        textBlock('lb_a', 'four', 'Point four.', 3),
        textBlock('lb_b', 'one', 'Detail one.', 0),
        textBlock('lb_b', 'two', 'Detail two.', 1),
        textBlock('lb_b', 'three', 'Detail three.', 2),
        textBlock('lb_b', 'four', 'Detail four.', 3),
      ]);
    });

    await screen.findByRole('heading', { level: 1, name: 'Long sections fixture' });
    const filter = screen.getByRole('searchbox', { name: 'Filter by keyword' });
    fireEvent.change(filter, { target: { value: 'Zzyzx' } });
    expect(screen.queryByRole('heading', { name: 'Introduction' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'Go to long blocks' }));
    await screen.findByRole('heading', { level: 1, name: 'Long blocks fixture' });

    expect(screen.getByRole('searchbox', { name: 'Filter by keyword' })).toHaveValue('');
    // Nothing left over from the /long-sections query — every long-blocks
    // section is showing.
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'More detail' })).toBeInTheDocument();
  });
});
