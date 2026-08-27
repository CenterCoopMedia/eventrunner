// Motif — the rendered form of one motif slot (design brief §2.3, §3.8).
//
// Four things are load-bearing and all four are checked here: a motif is
// decorative to a screen reader, it never intercepts a pointer, it paints
// through a mask so it inherits theme ink, and the slot names it knows are
// the slot names the token source declares.
//
// The fifth rule — "renders nothing when the active set is `none`" — is CSS,
// not JavaScript: `data-motif-set` is the switch (§3.8), so the gate has to
// live where the attribute does or a preview frame and the page would
// disagree. It is asserted against index.css below rather than described.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Motif, { MOTIF_SLOTS } from './Motif.jsx';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..', '..');
const motifs = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'design', 'tokens', 'motifs.json'), 'utf8'),
);
const indexCss = fs.readFileSync(path.resolve(here, '..', '..', 'index.css'), 'utf8');

describe('Motif', () => {
  it('renders every declared slot and nothing else', () => {
    expect([...MOTIF_SLOTS]).toEqual(motifs.slots);
    for (const slot of MOTIF_SLOTS) {
      const { container } = render(<Motif slot={slot} />);
      expect(container.firstChild).toHaveClass('motif', `motif--${slot}`);
    }
    const { container } = render(<Motif slot="not-a-slot" />);
    expect(container.firstChild).toBeNull();
  });

  it('is decorative: hidden from the accessibility tree and inert to the pointer', () => {
    const { container } = render(<Motif slot="divider" />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstChild.textContent).toBe('');
    expect(indexCss).toMatch(/\.motif \{[^}]*pointer-events: none;/);
  });

  it('paints through a mask, so a drawing inherits theme ink in both modes', () => {
    // Brief §3.8 allows two forms and this is one of them. An <img> or a
    // url() fill cannot inherit --color-ink-motif, so neither may appear.
    expect(indexCss).toMatch(/\.motif \{[^}]*background-color: rgb\(var\(--color-ink-motif-rgb\)\);/);
    for (const slot of MOTIF_SLOTS) {
      expect(indexCss).toContain(`mask-image: var(--motif-${slot});`);
    }
    const { container } = render(<Motif slot="empty-state" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('is taken out of the layout entirely under the `none` set', () => {
    // The gate is attribute-scoped, not :root-only, so the admin's
    // live-preview frame resolves it the same way a whole page does.
    expect(indexCss).toMatch(/\[data-motif-set='none'\] \.motif \{\s*display: none;\s*\}/);
  });

  it('has an asset for every slot of every set it can switch to', () => {
    // The `none` gate above covers the set being off. A set that declared an
    // EMPTY slot would need its own gate, because an unmasked box paints as
    // a solid rectangle of ink — so no set declares one, and this is where
    // that invariant is held.
    for (const [id, set] of Object.entries(motifs.sets)) {
      if (id === 'none') continue;
      for (const slot of motifs.slots) {
        expect(set.slots[slot], `${id} declares the ${slot} slot`).toBeTruthy();
        expect(
          fs.existsSync(
            path.join(REPO_ROOT, 'apps', 'web', 'public', 'motifs', set.assetDir, set.slots[slot]),
          ),
          `${id}/${set.slots[slot]} exists`,
        ).toBe(true);
      }
    }
  });
});
