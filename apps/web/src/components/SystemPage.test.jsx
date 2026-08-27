// The hybrid page shell: slot order, the default slot, and stated density
// (design brief §6.1, §6.2).
//
// The order down the page is the contract — nameplate, `above`, core,
// `main`, `below` — so these tests read the rendered document in order
// rather than asserting that each piece exists somewhere on the page.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

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
