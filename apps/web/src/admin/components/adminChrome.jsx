// The room's shared chrome: the title band, the state vocabulary, and the
// two stated states (docs/plans/2026-08-27-admin-identity-story.md, moments
// 1 and 2, as amended by docs/plans/2026-09-10-admin-editorial-desk.md).
//
// THE TITLE BAND. A page header is the section name at title size on the
// raised ground, running to the edges of the stone and holding the top of
// the viewport while the page scrolls, with the page's own actions at its
// trailing end. The record's state and identifiers sit BESIDE the name or
// UNDER it, never above it: a label stacked over a title is an eyebrow, and
// the eyebrow ban is absolute (brief §2.4). The description is a paragraph
// under the band, not inside it, so the band stays one line tall.
//
// THE STATE VOCABULARY. Every record in the admin is one of exactly three
// things, said in exactly these words wherever a state renders: `Draft`,
// `Live`, and `Live with unpublished changes`. One term per flow (§8.5). The
// state is always a word — set in a badge whose tinted ground and ink agree
// with the word, and never colour alone (§8.1).
import { RECORD_STATE_IDS, RECORD_STATE_WORDS } from '../recordState.js';

export { RECORD_STATE_IDS, RECORD_STATE_WORDS };

/**
 * A badge's ink and ground per tone. Each tone always carries its own
 * words: a badge with no word is a dot, and dots are banned.
 */
export const BADGE_TONES = Object.freeze({
  ok: 'bg-admin-ground-ok text-admin-state-ok',
  draft: 'bg-admin-ground-proof text-admin-state-draft',
  caution: 'bg-admin-ground-proof text-admin-state-caution',
  error: 'bg-admin-ground-alarm text-admin-state-error',
  info: 'bg-admin-ground-info text-admin-state-info',
  neutral: 'bg-admin-ground-soft text-admin-ink-secondary',
  dead: 'bg-admin-ground-soft text-admin-ink-disabled',
});

/** State id → the tone that carries it. The word is always present too. */
const STATE_TONE = Object.freeze({
  live: 'ok',
  dirty: 'draft',
  draft: 'draft',
  dead: 'dead',
  unknown: 'neutral',
});

/**
 * A word on a tinted ground: a state, a verdict, a standing fact. The
 * smallest radius in the room and never a pill.
 *
 * @param {{ tone?: keyof typeof BADGE_TONES, children: React.ReactNode }} props
 */
export function StatusBadge({ tone = 'neutral', className = '', children, ...rest }) {
  return (
    <span
      className={`inline-flex items-center rounded-admin-small px-xs py-3xs text-admin-xs font-semibold leading-tight ${
        BADGE_TONES[tone] ?? BADGE_TONES.neutral
      } ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
}

/**
 * One record's state, as a word in a badge.
 *
 * @param {{ state: { id: string, label: string } }} props
 */
export function RecordState({ state }) {
  if (!state) return null;
  return (
    <StatusBadge tone={STATE_TONE[state.id] ?? 'neutral'} data-record-state={state.id}>
      {state.label}
    </StatusBadge>
  );
}

/**
 * The row classes moment 1 asks for: a record with unpublished changes sits
 * on the proof ground, and on a successful publish that tint resolves to the
 * base ground over 160ms on `opacity` alone (instantly under reduced
 * motion, which index.css states rather than shortens).
 *
 * The tint is the SECOND signal. `RecordState`'s word is the first, and it
 * is always rendered.
 *
 * @param {string} stateId
 * @param {boolean} [resolved] true once this row published in this session
 * @returns {string}
 */
export function proofRowClass(stateId, resolved = false) {
  if (stateId !== 'draft' && stateId !== 'dirty') return '';
  return resolved ? 'admin-proof-row admin-proof-row--resolved' : 'admin-proof-row';
}

/**
 * The room's own empty state: a dashed frame on the raised ground, one
 * plain sentence, and exactly one next action — set in admin ink, because a
 * client's preset never reaches this surface.
 *
 * @param {{ title: string, description?: string, action?: React.ReactNode }} props
 */
export function AdminEmptyState({ title, description, action = null }) {
  return (
    <div className="grid place-items-center gap-xs rounded-admin-panel border-admin-hairline border-dashed border-admin-rule-strong bg-admin-ground-raised px-md py-xl text-center">
      <h2 className="font-admin-ui text-admin-lg font-bold text-admin-ink">{title}</h2>
      {description ? (
        <p className="max-w-[60ch] text-admin-sm text-admin-ink-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-2xs">{action}</div> : null}
    </div>
  );
}

/**
 * Loading is a stated line, not a loop (brief §2.2): no spinner, no
 * skeleton, no shimmer. Ambient animation is banned outright, and the room
 * does not perform.
 *
 * @param {{ label: string }} props
 */
export function AdminLoadingState({ label }) {
  return (
    <p role="status" aria-label={label} className="py-md text-admin-sm text-admin-ink-secondary">
      {label}
    </p>
  );
}

/**
 * The title band.
 *
 * @param {object} props
 * @param {string} props.title the section or record name
 * @param {React.ReactNode} [props.state] the record's state badge
 * @param {React.ReactNode} [props.identifiers] ids, paths, counts — data face
 * @param {React.ReactNode} [props.description] what this surface does
 * @param {React.ReactNode} [props.actions] the page's own controls
 * @param {'h1'|'h2'} [props.as] heading level, so heading order stays true
 */
export default function AdminPageHeader({
  title,
  state,
  identifiers,
  description,
  actions,
  as: Heading = 'h1',
}) {
  return (
    <>
      <header className="admin-job-line flex flex-col gap-2xs border-admin-rule-header border-b-admin-header bg-admin-ground-raised">
        <div className="flex flex-wrap items-center justify-between gap-x-md gap-y-sm">
          <div className="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-2xs">
            {/* The ink dot a compositor puts on the chase: a small solid mark
                beside the name. The one place the client accent appears. */}
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-admin-small bg-admin-page-header-mark"
            />
            <Heading className="min-w-0 font-admin-ui text-admin-title font-bold text-admin-ink">
              {title}
            </Heading>
            {state}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-xs">{actions}</div> : null}
        </div>
        {identifiers ? (
          <p className="font-admin-data text-admin-xs text-admin-ink-data">{identifiers}</p>
        ) : null}
      </header>
      {description ? (
        <p className="max-w-[70ch] text-admin-sm text-admin-ink-secondary">{description}</p>
      ) : null}
    </>
  );
}
