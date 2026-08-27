// Marginalia — the drawn marks (visual stories, Field Guide part 2 and Zine
// moment 3).
//
// Five binds, all of them checked here: the mark is decorative, it is inert
// to the pointer, it inherits ink instead of carrying its own, it is off
// until a client turns marginalia on, and it is STATIC — no draw-on
// animation in any preset, under any motion preference.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Marginalia from './Marginalia.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');
const themeCss = fs.readFileSync(
  path.resolve(here, '..', '..', 'generated', 'theme.css'),
  'utf8',
);

describe('Marginalia', () => {
  it('draws the pencil line as inline SVG that reads currentColor', () => {
    // Brief §2.3 allows two forms; an inline symbol reading currentColor is
    // the second. An <img> could not inherit theme ink at all.
    const { container } = render(<Marginalia mark="pencil" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it('is decorative and inert to the pointer', () => {
    const { container } = render(<Marginalia mark="pencil" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstChild.textContent).toBe('');
    expect(indexCss).toMatch(/\.marginalia \{[^}]*pointer-events: none;/);
  });

  it('inherits ink from the marginalia contract rather than carrying a color', () => {
    expect(indexCss).toMatch(/\.marginalia \{[^}]*color: rgb\(var\(--marginalia-rgb\)\);/);
    expect(themeCss).toContain('--marginalia-rgb: var(--color-ink-motif-rgb);');
  });

  it('is off until a client turns marginalia on', () => {
    expect(indexCss).toMatch(/\.marginalia \{[^}]*display: var\(--marginalia-display\);/);
    expect(themeCss).toContain('--marginalia-display: none;');
  });

  it('is static: no animation, no transition, no draw-on', () => {
    const block = indexCss.match(/\.marginalia \{[^}]*\}|\.marginalia svg \{[^}]*\}/g).join('\n');
    expect(block).not.toMatch(/animation|transition|@keyframes/);
  });

  it('draws the two Zine marks in the hand-drawn register, and only two', () => {
    // Visual story, Zine, part 5: "two drawn marks per page, one callout".
    // The squiggle underlines a line; the ring goes around a whole label.
    for (const mark of ['squiggle', 'circle']) {
      const { container } = render(<Marginalia mark={mark} />);
      const svg = container.querySelector('svg');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('fill')).toBe('none');
      // Drawn with overshoot and uneven pressure rather than as geometry:
      // a hand mark is a path, never a <circle> or a <rect>.
      expect(container.querySelector('circle, rect, ellipse')).toBeNull();
    }
  });

  it('lays the ring over its own wrapper, never over a headline word', () => {
    // Brief §2.4 bans the underlined word inside a headline. The ring is
    // absolutely positioned inside .marginalia-ring, which wraps a WHOLE
    // label — so it cannot land on part of one.
    expect(indexCss).toMatch(/\.marginalia--circle \{\s*position: absolute;/);
    expect(indexCss).toMatch(/\.marginalia-ring \{\s*position: relative;/);
  });

  it('renders nothing for a mark it does not draw', () => {
    const { container } = render(<Marginalia mark="not-a-mark" />);
    expect(container.firstChild).toBeNull();
  });
});
