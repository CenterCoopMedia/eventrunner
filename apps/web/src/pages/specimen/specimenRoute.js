// The specimen book's route, and the one gate that decides whether it exists.
//
// The book renders every device in every state. It is a review surface, not
// a page a visitor of a client site may reach, so it ships in the static
// demo build and in a development server and nowhere else. Both switches
// compile to a constant, so a client production build drops the branch and
// never emits the chunk.
//
// The gate is a pure function so a test can state the whole truth table
// without a build. App.jsx is the only caller.
import { IS_DEMO } from '../../lib/demoMode.js';

/** The route path, relative to the site root. */
export const SPECIMEN_PATH = 'specimen';

/** The heading the page and the tab both carry. */
export const SPECIMEN_TITLE = 'Specimen book';

/**
 * Whether the specimen route exists in this build.
 *
 * Written as a plain expression over two constants rather than as a call,
 * because the bundler has to FOLD it. A call across a module boundary is
 * not folded, so the ternary in App.jsx would survive and Rollup would emit
 * the chunk for a client production build even though no route points at
 * it. That was measured, not assumed.
 */
export const SPECIMEN_ENABLED = IS_DEMO || import.meta.env.DEV;

/**
 * The same rule as a pure function, so a test can state its whole truth
 * table without a build.
 *
 * @param {{ demo?: boolean, dev?: boolean }} [switches]
 * @returns {boolean}
 */
export function specimenRouteEnabled({ demo = IS_DEMO, dev = import.meta.env.DEV } = {}) {
  return demo === true || dev === true;
}

export default SPECIMEN_ENABLED;
