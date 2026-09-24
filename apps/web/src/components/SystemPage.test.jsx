// The hybrid page shell: slot order, the default slot, and stated density
// (design brief §6.1, §6.2).
//
// The order down the page is the contract — nameplate, `above`, core,
// `main`, `below` — so these tests read the rendered document in order
// rather than asserting that each piece exists somewhere on the page.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthContext from '../contexts/AuthContext.jsx';

let page;
let blocksBySection;
vi.mock('../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    getPage: (key) => (page && (page.id === key || page.path === key) ? page : null),
    getSectionBlocks: (id) => blocksBySection[id] ?? [],
  }),
}));

const { default: SystemPage } = await import('./SystemPage.jsx');

/** A section that carries one text block, so it renders. */
function section(id, slot) {
  return { id, label: `${id} label`, ...(slot ? { slot } : null) };
}

function textBlock(id) {
  return { section: id, field: 'body', blockType: 'text', value: `${id} body`, order: 0 };
}

function quoteBlock(id, text) {
  return { id: `${id}__quote`, section: id, field: 'quote', blockType: 'quote', text, order: 0 };
}

function renderPage(props = {}) {
  return render(
    <MemoryRouter>
      <SystemPage pageId="schedule" {...props}>
        <h1>Core</h1>
      </SystemPage>
    </MemoryRouter>,
  );
}

/** The page's visible headings and block copy, in document order. */
function readingOrder(container) {
  return [...container.querySelectorAll('h1, h2, p')]
    .map((el) => el.textContent.trim())
    .filter(Boolean);
}

describe('SystemPage', () => {
  it('renders nameplate → above → core → main → below', () => {
    page = {
      id: 'schedule',
      sections: [
        section('below-one', 'below'),
        section('main-one', 'main'),
        section('above-one', 'above'),
      ],
    };
    blocksBySection = {
      'below-one': [textBlock('below-one')],
      'main-one': [textBlock('main-one')],
      'above-one': [textBlock('above-one')],
    };
    const { container } = renderPage();
    expect(readingOrder(container)).toEqual([
      'above-one label',
      'above-one body',
      'Core',
      'main-one label',
      'main-one body',
      'below-one label',
      'below-one body',
    ]);
  });

  it('reads a section with no slot as `main`, so stored data keeps its place', () => {
    page = { id: 'schedule', sections: [section('legacy'), section('below-one', 'below')] };
    blocksBySection = { legacy: [textBlock('legacy')], 'below-one': [textBlock('below-one')] };
    const { container } = renderPage();
    expect(readingOrder(container)).toEqual([
      'Core',
      'legacy label',
      'legacy body',
      'below-one label',
      'below-one body',
    ]);
  });

  it('keeps each slot in the page’s own section order', () => {
    page = {
      id: 'schedule',
      sections: [section('second', 'above'), section('first', 'above')],
    };
    blocksBySection = { second: [textBlock('second')], first: [textBlock('first')] };
    const { container } = renderPage();
    expect(readingOrder(container)).toEqual([
      'second label',
      'second body',
      'first label',
      'first body',
      'Core',
    ]);
  });

  it('renders nothing for a section with no visible blocks', () => {
    page = { id: 'schedule', sections: [section('empty', 'above')] };
    blocksBySection = {};
    renderPage();
    expect(screen.queryByText('empty label')).not.toBeInTheDocument();
  });

  it('leaves out a section the core renders itself', () => {
    page = { id: 'schedule', sections: [section('hero', 'above'), section('rest', 'main')] };
    blocksBySection = { hero: [textBlock('hero')], rest: [textBlock('rest')] };
    renderPage({ exclude: ['hero'] });
    expect(screen.queryByText('hero label')).not.toBeInTheDocument();
    expect(screen.getByText('rest label')).toBeInTheDocument();
  });

  it('renders the core and no sections where the page has no document', () => {
    page = null;
    blocksBySection = {};
    const { container } = renderPage();
    expect(readingOrder(container)).toEqual(['Core']);
  });

  it('marks the subtree with the density the page states, and only then', () => {
    // A page that never chose a density must not override the preset's own
    // (brief §4, §6.1) — so the attribute is absent, not `comfortable`.
    page = { id: 'schedule', sections: [] };
    blocksBySection = {};
    const { container, unmount } = renderPage();
    expect(container.querySelector('article').dataset.density).toBeUndefined();
    unmount();

    page = { id: 'schedule', layout: { density: 'tight' }, sections: [] };
    const second = renderPage();
    expect(second.container.querySelector('article').dataset.density).toBe('tight');
  });

  it('hands the core the layout it renders under', () => {
    page = { id: 'schedule', layout: { arrangement: 'grid' }, sections: [] };
    blocksBySection = {};
    render(
      <MemoryRouter>
        <SystemPage pageId="schedule">
          {(layout) => <p>{`arrangement: ${layout.arrangement}`}</p>}
        </SystemPage>
      </MemoryRouter>,
    );
    expect(screen.getByText('arrangement: grid')).toBeInTheDocument();
  });

  it('sets a list section on the measure and a grid section on the stage', () => {
    // The arrangement mapped onto the stage (2026-09-10 vocabulary
    // expansion). The head runs to the stage either way — a section
    // boundary is the width of the page it opens — and only the body moves.
    for (const [arrangement, measured] of [
      ['list', true],
      ['grid', false],
    ]) {
      page = { id: 'schedule', layout: { arrangement }, sections: [section('one')] };
      blocksBySection = { one: [textBlock('one')] };
      const { container, unmount } = renderPage();
      // The head is the first child of the section; the body is the last.
      const body = container.querySelector(
        'section[aria-labelledby="section-one"] > div:last-child',
      );
      expect(body.classList.contains('measure'), arrangement).toBe(measured);
      unmount();
    }
  });

  it('finds the page by path where the id is not the key', () => {
    page = { id: 'landing', path: '/', sections: [section('one', 'above')] };
    blocksBySection = { one: [textBlock('one')] };
    render(
      <MemoryRouter>
        <SystemPage pageId={['home', '/']}>
          <h1>Core</h1>
        </SystemPage>
      </MemoryRouter>,
    );
    expect(screen.getByText('one label')).toBeInTheDocument();
  });
});

// A page may draw one of its own sections itself (M7 issue 10: the home
// page's sponsor strip reads a different collection entirely). The point of
// `renderSection` over excluding the section and rendering it in the core
// is that the section STAYS IN THE ORDER — an operator who drags it in the
// admin, or moves it to another slot, moves it on the page.
describe('SystemPage renderSection', () => {
  const custom = (section) =>
    section.id === 'custom' ? <p>{`custom: ${section.label}`}</p> : undefined;

  it('draws the section in its own place in the order, not at a fixed point', () => {
    page = { id: 'schedule', sections: [section('one'), section('custom'), section('two')] };
    blocksBySection = { one: [textBlock('one')], two: [textBlock('two')] };
    const first = renderPage({ renderSection: custom });
    expect(readingOrder(first.container)).toEqual([
      'Core',
      'one label',
      'one body',
      'custom: custom label',
      'two label',
      'two body',
    ]);
    first.unmount();

    // The same page with the section moved: the page moves with it.
    page = { id: 'schedule', sections: [section('custom'), section('one'), section('two')] };
    const moved = renderPage({ renderSection: custom });
    expect(readingOrder(moved.container)).toEqual([
      'Core',
      'custom: custom label',
      'one label',
      'one body',
      'two label',
      'two body',
    ]);
  });

  it('honours the slot the section states', () => {
    page = { id: 'schedule', sections: [section('custom', 'above'), section('one')] };
    blocksBySection = { one: [textBlock('one')] };
    const { container } = renderPage({ renderSection: custom });
    expect(readingOrder(container)).toEqual([
      'custom: custom label',
      'Core',
      'one label',
      'one body',
    ]);
  });

  it('draws a custom section that stores no blocks at all', () => {
    // Its content does not come from the section's blocks, so the
    // empty-section skip must not reach it.
    page = { id: 'schedule', sections: [section('custom')] };
    blocksBySection = {};
    const { container } = renderPage({ renderSection: custom });
    expect(readingOrder(container)).toEqual(['Core', 'custom: custom label']);
  });

  it('draws nothing for every falsy answer, not only null', () => {
    // React renders all of them as nothing anyway, and a renderer that
    // ends a `&&` chain on a falsy left side means "nothing here" — so
    // only `undefined` is special, and it is the one that means "not mine".
    for (const answer of [null, false, '', 0]) {
      page = { id: 'schedule', sections: [section('custom'), section('one')] };
      blocksBySection = { custom: [textBlock('custom')], one: [textBlock('one')] };
      const { container, unmount } = renderPage({ renderSection: () => answer });
      expect(readingOrder(container)).toEqual(['Core']);
      unmount();
    }
  });

  it('leaves every other section exactly as it was', () => {
    page = { id: 'schedule', sections: [section('one'), section('empty')] };
    blocksBySection = { one: [textBlock('one')] };
    const { container } = renderPage({ renderSection: custom });
    // The generic section still renders, and the empty one still does not.
    expect(readingOrder(container)).toEqual(['Core', 'one label', 'one body']);
  });

  // One pull quote per page at most (expansion record §3.1), and the page is
  // what enforces it: the first quote in READING order takes the device,
  // whatever the operator's section order says.
  it('sets the first quote in reading order as the page’s pull quote and the rest plain', () => {
    page = {
      id: 'schedule',
      sections: [section('main-one', 'main'), section('above-one', 'above')],
    };
    blocksBySection = {
      'main-one': [quoteBlock('main-one', 'The second quote, further down the page.')],
      'above-one': [quoteBlock('above-one', 'The first quote a reader meets.')],
    };
    const { container } = renderPage();
    const pulled = container.querySelectorAll('figure.pull-quote');
    expect(pulled).toHaveLength(1);
    expect(pulled[0].textContent).toContain('The first quote a reader meets.');
    const plain = container.querySelectorAll('figure.quote-plain');
    expect(plain).toHaveLength(1);
    expect(plain[0].textContent).toContain('The second quote, further down the page.');
  });
});

// One edit link per drawn section, for a signed-in admin only (issue #198).
// The link opens the section's blocks, so it is per section and never per
// block, and a section the page does not draw has none.
describe('SystemPage section edit links', () => {
  function renderAs(auth, props = {}) {
    return render(
      <MemoryRouter>
        <AuthContext.Provider value={auth}>
          <SystemPage pageId="schedule" {...props}>
            <h1>Core</h1>
          </SystemPage>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
  }

  const editLinks = (container) =>
    [...container.querySelectorAll('a')].filter((link) => link.textContent.startsWith('Edit section'));

  it('gives each drawn section in every slot exactly one link to its own editor, and an empty one none', () => {
    page = {
      id: 'schedule',
      sections: [
        section('above-one', 'above'),
        section('main-one'),
        section('empty-one'),
        section('below-one', 'below'),
      ],
    };
    blocksBySection = {
      'above-one': [textBlock('above-one'), { ...textBlock('above-one'), field: 'more' }],
      'main-one': [textBlock('main-one')],
      'below-one': [textBlock('below-one')],
    };
    const { container } = renderAs({ adminStatus: 'admin' });
    // Three drawn sections, four blocks: one link per section, not per block.
    expect(editLinks(container).map((link) => link.getAttribute('href'))).toEqual([
      '/admin/content/schedule/above-one',
      '/admin/content/schedule/main-one',
      '/admin/content/schedule/below-one',
    ]);
    for (const id of ['above-one', 'main-one', 'below-one']) {
      const head = screen.getByRole('heading', { name: `${id} label` }).parentElement;
      expect(within(head).getByRole('link', { name: `Edit section: ${id} label` })).toBeInTheDocument();
    }
  });

  it('hands a custom draw the link as its third argument', () => {
    page = { id: 'schedule', sections: [section('custom'), section('one')] };
    blocksBySection = { one: [textBlock('one')] };
    const renderSection = vi.fn((sectionDoc, _blocks, editLink) =>
      sectionDoc.id === 'custom' ? <div><p>custom</p>{editLink}</div> : undefined,
    );
    const { container } = renderAs({ adminStatus: 'admin' }, { renderSection });
    expect(renderSection).toHaveBeenCalledWith(page.sections[0], [], expect.anything());
    expect(editLinks(container).map((link) => link.getAttribute('href'))).toEqual([
      '/admin/content/schedule/custom',
      '/admin/content/schedule/one',
    ]);
  });

  it('draws no link for a signed-out reader or a non-admin, and leaves the reading order as it was', () => {
    page = { id: 'schedule', sections: [section('above-one', 'above'), section('main-one')] };
    blocksBySection = { 'above-one': [textBlock('above-one')], 'main-one': [textBlock('main-one')] };
    const plain = renderPage();
    const expected = readingOrder(plain.container);
    plain.unmount();
    for (const auth of [null, { adminStatus: 'unknown' }, { adminStatus: 'denied' }]) {
      const { container, unmount } = renderAs(auth);
      expect(editLinks(container)).toHaveLength(0);
      expect(readingOrder(container)).toEqual(expected);
      unmount();
    }
    // An admin's links add no heading or paragraph to the order either.
    const admin = renderAs({ adminStatus: 'admin' });
    expect(readingOrder(admin.container)).toEqual(expected);
  });
});
