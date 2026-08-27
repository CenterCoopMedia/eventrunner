// The Atlas sign register: the route mark, the wayfinding icons, and the
// map grid (design brief §4.6; visual story, Atlas).
//
// One rule runs through all three and is checked in every block below: a
// mark that carries meaning carries a word. "A route mark or wayfinding
// icon without a text label is a puzzle, not a sign", and colour is never
// the only signal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteMark from './RouteMark.jsx';
import WayfindingIcon, { WAYFINDING_ICONS } from './WayfindingIcon.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..', '..');
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(
  path.resolve(here, '..', '..', 'generated', 'theme.css'),
  'utf8',
);

describe('RouteMark', () => {
  it('sets the letter in the sign face with the line name beside it', () => {
    const { container } = render(<RouteMark letter="B" name="Riverside line" />);
    const mark = container.querySelector('.route-mark');
    expect(mark.textContent).toBe('B');
    expect(mark).toHaveClass('font-heading');
    expect(screen.getByText('Riverside line')).toBeInTheDocument();
  });

  it('never renders a bare mark: with no name it still says the line', () => {
    render(<RouteMark letter="A" />);
    expect(screen.getByText('Line A')).toBeInTheDocument();
  });

  it('says the line once: the drawn shape is hidden, the label speaks', () => {
    const { container } = render(<RouteMark letter="C" name="Harbour line" />);
    expect(container.querySelector('.route-mark')).toHaveAttribute('aria-hidden', 'true');
    expect(container.textContent).toBe('CHarbour line');
  });

  it('is never a pill: the radius follows the theme scale, sharp in Atlas', () => {
    expect(indexCss).toMatch(/\.route-mark \{[^}]*border-radius: var\(--route-mark-radius\);/);
    expect(indexCss).not.toMatch(/\.route-mark \{[^}]*border-radius: 9999px/);
    const atlas = themeCss.match(/\[data-theme='atlas'\]\[data-mode='light'\] \{[^}]*\}/)[0];
    expect(atlas).toContain('--route-mark-rgb:');
    expect(atlas).toContain('--route-mark-ink-rgb:');
  });

  it('renders nothing without a letter', () => {
    expect(render(<RouteMark letter="" />).container.firstChild).toBeNull();
    expect(render(<RouteMark letter={null} />).container.firstChild).toBeNull();
  });
});

describe('WayfindingIcon', () => {
  it('draws each of the six signs, and nothing it does not have', () => {
    for (const name of WAYFINDING_ICONS) {
      const { container } = render(<WayfindingIcon name={name} />);
      expect(container.firstChild).toHaveClass('wayfinding-icon', `wayfinding-icon--${name}`);
      expect(
        fs.existsSync(
          path.join(REPO_ROOT, 'apps', 'web', 'public', 'icons', 'wayfinding', `${name}.svg`),
        ),
        `${name}.svg exists`,
      ).toBe(true);
      expect(indexCss).toContain(`mask-image: url('/icons/wayfinding/${name}.svg');`);
    }
    expect(render(<WayfindingIcon name="rocket" />).container.firstChild).toBeNull();
  });

  it('inherits the ink of the line it sits in, in both modes', () => {
    // Masked over currentColor: one file serves both modes, and the icon
    // never carries a colour of its own.
    expect(indexCss).toMatch(/\.wayfinding-icon \{[^}]*background-color: currentColor;/);
  });

  it('is hidden from the accessibility tree, because the label says the word', () => {
    const { container } = render(<WayfindingIcon name="room" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('does not render through the motif layer', () => {
    // Brief §3.8: an icon carries meaning, so --motif-* and data-motif-set
    // never reach it and the motif density rule does not apply to it.
    const { container } = render(<WayfindingIcon name="line" />);
    expect(container.firstChild.className).not.toContain('motif');
    expect(indexCss).not.toMatch(/\.wayfinding-icon[^{]*\{[^}]*--motif-/);
  });
});

describe('map grid', () => {
  it('is faint, inert, and painted behind the sections', () => {
    const block = indexCss.match(/\.map-grid::before \{[^}]*\}/)[0];
    expect(block).toContain('pointer-events: none;');
    expect(block).toMatch(/rgb\(var\(--map-grid-rgb\) \/ 0\.45\)/);
    expect(block).toContain('background-size: var(--map-grid-size) var(--map-grid-size);');
    expect(indexCss).toMatch(/\.map-grid > \* \{\s*position: relative;\s*\}/);
  });

  it('is off wherever the sheet is not part of the story', () => {
    // A background with a zero size paints nothing, so the size token turns
    // the device off with no second token and no theme test.
    expect(themeCss).toContain('--map-grid-size: 0;');
    // The generated stylesheet names each block by style ID, not by label:
    // the runtime catalog carries no labels since the copy split.
    const atlas = themeCss.match(/atlas — light[\s\S]*?\}/)[0];
    expect(atlas).toContain('--map-grid-rgb:');
  });

  it('never animates: the sheet is what the network is drawn on', () => {
    const block = indexCss.match(/\.map-grid::before \{[^}]*\}/)[0];
    expect(block).not.toMatch(/animation|transition/);
  });

  it('is drawn on the schedule surface, never on the shell', () => {
    // Owner review 2026-08-27: a coordinate grid is a device for reading a
    // timetable. Behind an about page or a speaker bio it is texture for
    // its own sake, so the class sits on the surface that holds the
    // programme and nowhere else.
    const layout = fs.readFileSync(path.resolve(here, '..', 'Layout.jsx'), 'utf8');
    expect(layout).not.toMatch(/className="[^"]*\bmap-grid\b/);
    for (const page of ['Schedule', 'MySchedule']) {
      const source = fs.readFileSync(
        path.resolve(here, '..', '..', 'pages', `${page}.jsx`),
        'utf8',
      );
      expect(source).toMatch(/className="[^"]*\bmap-grid\b/);
    }
  });
});

describe('the paper overlay', () => {
  it('paints only where a theme opts in, so a flat surface cannot leak', () => {
    // Owner review 2026-08-27: flat surfaces are the shared default
    // everywhere. The overlay used to paint by default and be suppressed
    // under [data-texture='flat'], so any surface reaching a reader before
    // the attribute was written — or with no attribute at all — got the dot
    // pattern nobody asked for. An opt-in gate cannot leak.
    expect(indexCss).toContain(":root[data-texture='paper'] .bg-paper::before");
    expect(indexCss).not.toMatch(/^\s*\.bg-paper::before \{/m);
    expect(indexCss).not.toContain(":root[data-texture='flat'] .bg-paper::before");
  });
});
