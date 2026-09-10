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
vi.mock('../../contexts/ToastContext.jsx', () => ({
  useToast: () => ({ showToast: vi.fn(), dismiss: vi.fn() }),
}));

import Specimen from './Specimen.jsx';
import { SPECIMEN_SECTIONS } from './sections/index.js';
import { ROBOTS_SELECTOR } from './useNoIndex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const EDITORIAL_DIR = path.resolve(here, '..', '..', 'components', 'editorial');

/** Every editorial component, by the path a figcaption names. */
function editorialComponents() {
  return fs
    .readdirSync(EDITORIAL_DIR)
    .filter((name) => name.endsWith('.jsx') && !name.includes('.test.'))
    .map((name) => `components/editorial/${name}`);
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

  it('draws every editorial component at least once', () => {
    const { container } = renderBook();
    const drawn = new Set(
      [...container.querySelectorAll('[data-specimen-file]')].map((node) =>
        node.getAttribute('data-specimen-file'),
      ),
    );
    for (const file of editorialComponents()) {
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

  it('marks itself as a page a crawler must not index', () => {
    renderBook();
    expect(document.querySelector(ROBOTS_SELECTOR)).not.toBeNull();
  });
});
