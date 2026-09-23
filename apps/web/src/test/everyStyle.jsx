// Render a device in every site style and both display modes.
//
// The expansion record §3 asks every device for "a test that renders it in
// every style and both modes". jsdom computes no cascade from the generated
// stylesheet, so what a test here can hold is the half that is the
// component's own: the markup a style's tokens act on is present in all
// twelve renderings, nothing throws, and whatever the caller asserts about
// the device holds under every `data-theme` and `data-mode` pair.
//
// The style ids come from the shared resolver rather than a list here, so a
// seventh style reaches this helper the day it joins the catalog.
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { THEME_MODES, THEME_PRESET_IDS } from 'shared/theme';

export const STYLE_IDS = Object.freeze([...THEME_PRESET_IDS]);
export const MODES = Object.freeze([...THEME_MODES]);

/**
 * Every (style, mode) pair.
 *
 * @returns {Array<{ style: string, mode: string }>}
 */
export function everyStyleAndMode() {
  const pairs = [];
  for (const style of STYLE_IDS) {
    for (const mode of MODES) pairs.push({ style, mode });
  }
  return pairs;
}

/**
 * Render `node` once per (style, mode) pair under the attributes a page
 * carries, run `check` on each rendering, and unmount it.
 *
 * `check` receives the container and the pair, so an assertion can name the
 * rendering that failed. A device that reads the router (a link inside a
 * timeline entry, say) renders inside a memory router, which costs nothing
 * for one that does not.
 *
 * @param {import('react').ReactNode} node
 * @param {(container: HTMLElement, pair: { style: string, mode: string }) => void} check
 */
export function renderInEveryStyle(node, check) {
  for (const pair of everyStyleAndMode()) {
    const { container, unmount } = render(
      <MemoryRouter>
        <div data-theme={pair.style} data-mode={pair.mode}>
          {node}
        </div>
      </MemoryRouter>,
    );
    try {
      check(container, pair);
    } finally {
      unmount();
    }
  }
}
