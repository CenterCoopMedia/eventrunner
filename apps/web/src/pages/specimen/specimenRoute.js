// The specimen book's route, and the one gate that decides whether it exists.
//
// The book renders every device in every state. It is a review surface, not
// a page a visitor of a client site may reach, so it ships in the static
// demo build and in a development server and nowhere else. Both switches
// compile to a constant, so a client production build drops the branch and
// never emits the chunk.
//
// The page's dynamic import lives here, beside the gate, and App.jsx is the
// only caller. The gate is also a pure function so a test can state the
// whole truth table without a build.
import { IS_DEMO } from '../../lib/demoMode.js';

/** The route path, relative to the site root. */
export const SPECIMEN_PATH = 'specimen';

/** The heading the page and the tab both carry. */
export const SPECIMEN_TITLE = 'Specimen book';

/**
 * Whether the specimen route exists in this build.
 *
 * Written as a plain expression over the build constants rather than as a
 * call, because the bundler has to FOLD it. It also reads
 * `import.meta.env` here rather than `IS_DEMO` from lib/demoMode.js, and the
 * import below sits in this same module, for the same reason. Rolldown
 * (Vite 8) folds only a condition it can read in the module that holds the
 * `import()`. With the condition imported from another module, it drops the
 * branch from the code but still writes the chunk into a client production
 * build. That was measured, not assumed. The comparisons match
 * lib/demoMode.js; keep the two in step.
 */
export const SPECIMEN_ENABLED =
  import.meta.env.VITE_DEMO_MODE === '1' ||
  import.meta.env.VITE_DEMO_MODE === 'true' ||
  import.meta.env.DEV;

/** Loads the page, or is null in a build where the route does not exist. */
export const loadSpecimenPage = SPECIMEN_ENABLED ? () => import('./Specimen.jsx') : null;

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
