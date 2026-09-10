// What the specimen book measures: the tier 2 scales, by name.
//
// The lists here are the page's contents, and a test pins each one to
// design/tokens/semantic.json. A token added to the system and left out of
// this file fails that test, so the book cannot fall behind the scales it
// claims to show.
//
// Every value is read from the live document at render time. That is the
// only way a measurement can be true in six site styles and two display
// modes at once: the token names are fixed, the resolved values are not.
import { contrastRatio } from 'shared/theme';

/** The eight steps of the fluid type scale, largest first. */
export const TYPE_STEPS = Object.freeze([
  Object.freeze({ step: 'nameplate', label: 'Nameplate' }),
  Object.freeze({ step: 'h1', label: 'Heading 1' }),
  Object.freeze({ step: 'h2', label: 'Heading 2' }),
  Object.freeze({ step: 'h3', label: 'Heading 3' }),
  Object.freeze({ step: 'lead', label: 'Lead' }),
  Object.freeze({ step: 'body', label: 'Body' }),
  Object.freeze({ step: 'caption', label: 'Caption' }),
  Object.freeze({ step: 'folio', label: 'Folio' }),
]);

/** The four type roles. A component asks for a role, never for a family. */
export const TYPE_ROLES = Object.freeze([
  Object.freeze({ role: 'heading', label: 'Heading', job: 'Every heading, and the masthead.' }),
  Object.freeze({ role: 'body', label: 'Body', job: 'Everything a person reads as language.' }),
  Object.freeze({ role: 'data', label: 'Data', job: 'Labels, folios, captions, and figures.' }),
  Object.freeze({ role: 'mono', label: 'Mono', job: 'Anything a person compares character by character.' }),
]);

/** The nine spacing steps, tightest first. */
export const SPACING_STEPS = Object.freeze([
  '3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl',
]);

/**
 * The two widths a page is built on (2026-09-10 vocabulary expansion).
 *
 * `token` is the tier 3 name a component reads, because that is what a
 * style retunes in its own preset file. `base` is the tier 2 family under
 * it, and the test pins the list to that family.
 */
export const STAGE_WIDTHS = Object.freeze([
  Object.freeze({
    token: '--stage-max',
    base: '--stage-frame',
    label: 'Stage',
    job: 'The frame of the page: the header, the navigation, the schedule grid, the four directories, the logo wall, the footer, and every section head.',
  }),
  Object.freeze({
    token: '--measure-text',
    base: '--stage-measure',
    label: 'Measure',
    job: 'Running text: a paragraph, a list, a rich text block, a stat description, an answer. It never exceeds the stage.',
  }),
]);

/**
 * The interaction-state tints (expansion record §2.1).
 *
 * A share, not a colour: the shared rule mixes the control's own ink into
 * the ground it already sits on, so one number covers the page ground, the
 * alternate ground and a filled action. The share is mode-scoped, and dark
 * carries the higher one, because the same ink reads as a smaller step on a
 * dark ground.
 */
export const STATE_SHARES = Object.freeze([
  Object.freeze({ token: '--state-hover-share', label: 'Hover', job: 'Under the pointer, inside the hover query.' }),
  Object.freeze({ token: '--state-pressed-share', label: 'Pressed', job: 'Held down. It is what carries the press for a reader who asked for less motion.' }),
  Object.freeze({ token: '--state-selected-share', label: 'Selected', job: 'A toggle that is on, beside the bold weight.' }),
]);

/**
 * The focus ring (expansion record §2.1).
 *
 * Its own family rather than a rule weight: a rule is structure a reader
 * passes over, and a ring is the answer to "where am I". Sharing the scale
 * would let a retune of the hairline thin the ring.
 */
export const FOCUS_TOKENS = Object.freeze([
  Object.freeze({ token: '--focus-ring-width', label: 'Ring width', job: 'Drawn outside the element, never removed.' }),
  Object.freeze({ token: '--focus-ring-offset', label: 'Ring offset', job: 'The gap between the element and its ring.' }),
]);

/** The three rule weights. */
export const RULE_WEIGHTS = Object.freeze([
  Object.freeze({ weight: 'hairline', label: 'Hairline', job: 'Structure between rows.' }),
  Object.freeze({ weight: 'strong', label: 'Strong', job: 'A section boundary.' }),
  Object.freeze({ weight: 'nameplate', label: 'Nameplate', job: 'The rule that bounds the identity.' }),
]);

/**
 * Every tier 2 colour token, in four groups.
 *
 * The groups are how a reader uses the list, not a second contract: the
 * test checks the flattened set against the token source, so a group is
 * free to change without weakening the check.
 */
export const COLOUR_GROUPS = Object.freeze([
  Object.freeze({
    id: 'roles',
    title: 'Role inks, grounds, and accents',
    note: 'The names every component reads. A text pair holds 4.5:1 against the ground.',
    tokens: Object.freeze([
      '--color-surface-rgb',
      '--color-surface-alt-rgb',
      '--color-text-primary-rgb',
      '--color-text-secondary-rgb',
      '--color-accent-rgb',
      '--color-accent-strong-rgb',
      '--color-accent-soft-rgb',
      '--color-accent-secondary-rgb',
      '--color-ink-motif-rgb',
    ]),
  }),
  Object.freeze({
    id: 'rules',
    title: 'Rules and the control boundary',
    note: 'A rule is structure, so it carries its own tokens instead of borrowing an ink step. A control boundary holds 3:1.',
    tokens: Object.freeze([
      '--rule-hairline-rgb',
      '--rule-strong-rgb',
      '--rule-nameplate-rgb',
      '--color-border-control-rgb',
    ]),
  }),
  Object.freeze({
    id: 'semantic',
    title: 'State colours',
    note: 'A state colour never states a fact on its own. A word always sits beside it.',
    tokens: Object.freeze([
      '--semantic-success-rgb',
      '--semantic-warning-rgb',
      '--semantic-danger-rgb',
      '--semantic-highlight-rgb',
      '--semantic-keynote-rgb',
    ]),
  }),
  Object.freeze({
    id: 'brand',
    title: 'The client palette the role names read',
    note: 'What a client sets. The role names above resolve to these, which is why a component never reads one of them.',
    tokens: Object.freeze([
      '--brand-primary-rgb',
      '--brand-primary-dark-rgb',
      '--brand-primary-light-rgb',
      '--brand-accent-rgb',
      '--brand-surface-rgb',
      '--brand-surface-alt-rgb',
      '--brand-ink-rgb',
      '--brand-ink-muted-rgb',
    ]),
  }),
]);

/** The flattened colour list, in the order the page draws it. */
export const COLOUR_TOKENS = Object.freeze(
  COLOUR_GROUPS.flatMap((group) => group.tokens),
);

/** The ground every measurement below is taken against. */
export const SURFACE_TOKEN = '--color-surface-rgb';

/**
 * One custom property's resolved value, trimmed.
 *
 * @param {string} name
 * @param {Element | null} [element] defaults to the document element
 * @returns {string} the value, or an empty string where it cannot be read
 */
export function readToken(name, element = null) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  const target = element ?? document.documentElement;
  if (!target) return '';
  const value = window.getComputedStyle(target).getPropertyValue(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A stored colour token as three channels.
 *
 * Colours are stored as space-separated RGB triples so the utility layer
 * keeps its opacity modifiers, so this parses that form and nothing else.
 *
 * @param {string} value
 * @returns {number[] | null}
 */
export function parseRgbTriple(value) {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split(/[\s,]+/u).filter(Boolean);
  if (parts.length !== 3) return null;
  const channels = parts.map((part) => Number.parseFloat(part));
  if (channels.some((channel) => !Number.isFinite(channel))) return null;
  return channels;
}

/**
 * The measured contrast between one colour token and the page ground, in
 * the mode the document is in right now.
 *
 * @param {string} name
 * @param {Element | null} [element]
 * @returns {number | null} the ratio, or null where either value is unreadable
 */
export function measureContrast(name, element = null) {
  const colour = parseRgbTriple(readToken(name, element));
  const ground = parseRgbTriple(readToken(SURFACE_TOKEN, element));
  if (!colour || !ground) return null;
  return contrastRatio(colour, ground);
}

/**
 * A token value as the book prints it.
 *
 * A share is authored as `0.06`, and the browser hands the substituted
 * custom property back the way it serialises a number: `.06`. A value that
 * opens on a decimal point is a value a reader has to read twice, and the
 * table beside it is what a reviewer checks a hover cell against, so the
 * leading zero goes back on. Nothing else is touched: a width, a length and
 * a family name are printed as they were read.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function formatTokenValue(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^-?\.\d+$/u.test(trimmed) ? trimmed.replace('.', '0.') : trimmed;
}

/**
 * A ratio as the page states it: one decimal, against one.
 *
 * @param {number | null} ratio
 * @returns {string}
 */
export function formatContrast(ratio) {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return 'Not measured here';
  return `${ratio.toFixed(2)}:1`;
}
