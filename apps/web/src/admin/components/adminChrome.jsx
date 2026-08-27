// The room's shared chrome: the job line and the state vocabulary
// (docs/plans/2026-08-27-admin-identity-story.md, moments 1 and 2).
//
// THE JOB LINE. A page header is the section name in the UI face sitting on
// `--admin-rule-header` — the heaviest rule in the room — with the client
// mark at the rule's leading end. The record's state and identifiers sit
// BESIDE the name or UNDER it, never above it: a label stacked over a title
// is an eyebrow, and the eyebrow ban is absolute (brief §2.4).
//
// THE STATE VOCABULARY. Every record in the admin is one of exactly three
// things, said in exactly these words wherever a state renders: `Draft`,
// `Live`, and `Live with unpublished changes`. One term per flow (§8.5). The
// state is always a word in the data face — never a coloured pill, never a
// dot, and never colour alone (§8.1).
import { RECORD_STATE_IDS, RECORD_STATE_WORDS } from '../recordState.js';

export { RECORD_STATE_IDS, RECORD_STATE_WORDS };

/** State id → the ink that carries it. The word is always present too. */
const STATE_INK = Object.freeze({
  live: 'text-admin-state-live',
  dirty: 'text-admin-state-draft',
  draft: 'text-admin-state-draft',
  dead: 'text-admin-ink-disabled',
  unknown: 'text-admin-ink-secondary',
});

/**
 * One record's state, as a word in the data face.
 *
 * @param {{ state: { id: string, label: string } }} props
 */
export function RecordState({ state }) {
  if (!state) return null;
  return (
    <span
      data-record-state={state.id}
      className={`font-admin-data text-folio ${STATE_INK[state.id] ?? STATE_INK.unknown}`}
    >
      {state.label}
    </span>
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
 * The room's own empty state. Same device as the public EmptyState — a rule,
 * one plain sentence, and exactly one next action — set in admin ink on the
 * admin ground, because a client's preset never reaches this surface.
 *
 * @param {{ title: string, description?: string, action?: React.ReactNode }} props
 */
export function AdminEmptyState({ title, description, action = null }) {
  return (
    <div className="py-lg">
      <div className="border-admin-rule-hairline border-t-admin-hairline" />
      <h2 className="mt-md font-admin-ui text-lead font-semibold text-admin-ink">{title}</h2>
      {description ? (
        <p className="mt-2xs max-w-[65ch] text-caption text-admin-ink-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-sm">{action}</div> : null}
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
    <p role="status" aria-label={label} className="py-md font-admin-data text-caption text-admin-ink-secondary">
      {label}
    </p>
  );
}

/**
 * The job line.
 *
 * @param {object} props
 * @param {string} props.title the section or record name, in the UI face
 * @param {React.ReactNode} [props.state] the record's state word
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
    <header className="flex flex-col gap-2xs">
      <div className="relative flex flex-wrap items-end justify-between gap-sm border-admin-rule-header border-b-admin-header pb-2xs">
        <Heading className="font-admin-ui text-h3 font-semibold text-admin-ink">{title}</Heading>
        {actions ? <div className="flex flex-wrap items-center gap-xs">{actions}</div> : null}
        {/* The ink dot a compositor puts on the chase: a small solid mark
            sitting ON the header rule at its leading end, beside the name.
            One of exactly two places the client accent appears. */}
        <span
          aria-hidden="true"
          className="absolute bottom-0 start-0 h-2 w-2 translate-y-1/2 bg-admin-page-header-mark"
        />
      </div>
      {state || identifiers ? (
        <div className="flex flex-wrap items-center gap-x-sm gap-y-3xs">
          {state}
          {identifiers ? (
            <span className="font-admin-data text-folio text-admin-ink-data">{identifiers}</span>
          ) : null}
        </div>
      ) : null}
      {description ? (
        <p className="max-w-[65ch] text-caption text-admin-ink-secondary">{description}</p>
      ) : null}
    </header>
  );
}
