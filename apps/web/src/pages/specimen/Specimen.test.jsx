// The book holds every editorial device, and it draws its own contents.
//
// The coverage check reads the RENDERED page rather than a list beside it.
// A list of devices next to the page is a second thing to keep in step, and
// the whole point of the book is that a device the page does not draw is a
// device nobody reviews. So every figure carries the file it draws as a
// data attribute, the page is rendered here, and the attributes are read
// back and checked against the components directory itself.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { eventConfig, features } from '@generated/eventConfig.js';
import { organizationsData } from '@generated/organizationsData.js';
import { speakers } from '@generated/scheduleData.js';

vi.mock('../../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig, features, theme: { preset: 'newsroom', mode: 'light' } }),
  useFeatures: () => features,
}));
vi.mock('../../contexts/ContentContext.jsx', () => ({
  useContent: () => ({
    speakers,
    organizationsData,
    getPage: () => null,
    getSectionBlocks: () => [],
  }),
}));
// Only the hook is replaced. The tone table and the bar's own class are
// what the book draws, so they have to be the real ones — a mocked tone
// table would let the book fall behind the provider and still pass.
vi.mock('../../contexts/ToastContext.jsx', async (importOriginal) => ({
  ...(await importOriginal()),
  useToast: () => ({ showToast: vi.fn(), dismiss: vi.fn() }),
}));

import Specimen from './Specimen.jsx';
import { SPECIMEN_SECTIONS } from './sections/index.js';
import { ROBOTS_SELECTOR } from './useNoIndex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPONENTS_DIR = path.resolve(here, '..', '..', 'components');

/** Every component in one directory, by the path a figcaption names. */
function componentsIn(directory) {
  return fs
    .readdirSync(path.join(COMPONENTS_DIR, directory))
    .filter((name) => name.endsWith('.jsx') && !name.includes('.test.'))
    .map((name) => `components/${directory}/${name}`);
}

// The setup file unmounts after every test, so each one renders its own
// copy of the book.
function renderBook() {
  return render(
    <MemoryRouter>
      <Specimen />
    </MemoryRouter>,
  );
}

describe('the specimen book', () => {
  it('opens with its own h1 and a standfirst under it', () => {
    renderBook();
    const heading = screen.getByRole('heading', { level: 1, name: 'Specimen book' });
    expect(heading).toBeInTheDocument();
    // Never above: the element before the heading is nothing at all.
    expect(heading.previousElementSibling).toBeNull();
    expect(heading.nextElementSibling?.textContent).toMatch(/Every device in the system/u);
  });

  it('lists every section it draws, and draws every section it lists', () => {
    renderBook();
    for (const section of SPECIMEN_SECTIONS) {
      expect(screen.getByRole('link', { name: section.label })).toBeInTheDocument();
      expect(document.getElementById(section.id)).not.toBeNull();
    }
  });

  it('draws every editorial component and every shared control at least once', () => {
    const { container } = renderBook();
    const drawn = new Set(
      [...container.querySelectorAll('[data-specimen-file]')].map((node) =>
        node.getAttribute('data-specimen-file'),
      ),
    );
    // Both directories, because a device that ships and never reaches the
    // book is a device nobody reviews in six styles — and the shared
    // controls are the half of the vocabulary a reader operates.
    for (const file of [...componentsIn('editorial'), ...componentsIn('forms')]) {
      expect(drawn.has(file), `${file} has no specimen`).toBe(true);
    }
  });

  it('names a file and a contract in every caption', () => {
    const { container } = renderBook();
    const figures = [...container.querySelectorAll('figure[data-specimen-file]')];
    expect(figures.length).toBeGreaterThan(20);
    for (const figure of figures) {
      // `:scope >` because a device may bring a figure of its own, and the
      // caption that must name the file is the book's, not the device's.
      const caption = figure.querySelector(':scope > figcaption');
      expect(caption, `${figure.getAttribute('data-specimen-file')} has no caption`).not.toBeNull();
      expect(caption.textContent).toContain(figure.getAttribute('data-specimen-file'));
    }
  });

  it('builds every list in the book out of the elements a dl allows', () => {
    // A <dl> takes a <dt>, a <dd>, and a <div> only as the wrapper around
    // one term and its descriptions. The width bands held a heading, a span
    // and a paragraph directly, and the rule figure wrapped a drawn rule
    // and a second <div> in its wrapper — both neither a pair nor valid.
    // The scan runs across the whole book, so the next section that
    // reaches for a bare <div> inside a <dl> fails here rather than
    // shipping.
    const { container } = renderBook();
    const lists = [...container.querySelectorAll('dl')];
    expect(lists.length).toBeGreaterThan(1);
    for (const list of lists) {
      for (const child of list.children) {
        const tag = child.tagName.toLowerCase();
        expect(['dt', 'dd', 'div'], `<${tag}> is a child of a <dl>`).toContain(tag);
        if (tag !== 'div') continue;
        for (const inner of child.children) {
          const innerTag = inner.tagName.toLowerCase();
          expect(['dt', 'dd'], `<${innerTag}> is inside a <dl>’s <div>`).toContain(innerTag);
        }
      }
    }
  });

  it('marks itself as a page a crawler must not index', () => {
    renderBook();
    expect(document.querySelector(ROBOTS_SELECTOR)).not.toBeNull();
  });
});
