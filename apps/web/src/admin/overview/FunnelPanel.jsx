// The overview's Registration funnel (issue #181): the path from signing up
// to approved, from the funnel getEventStats sums on the server.
//
// Three stages, and they nest: every account, then the accounts that are
// ticketed or approved, then the approved ones. "Ticketed or approved" is
// the middle stage rather than "ticketed", because an admin can approve a
// pending account directly, and an approved account that never held a
// ticket would otherwise drop out of the middle and reappear at the end.
//
// Each stage is a stated fraction of all accounts beside a native
// <progress> that the fraction labels (design vocabulary §3.2, Progress):
// never a ring, never a bar without its words. Revoked accounts count as
// accounts and in no later stage, and the panel says so. With no accounts
// at all it says that instead and draws no bar.
import { useId } from 'react';
import { Panel } from '../components/formControls.jsx';
import { Figure, plural } from './figures.jsx';

const STAGE_WORDS = Object.freeze({
  accounts: 'Accounts',
  'ticketed-or-approved': 'Ticketed or approved',
  approved: 'Approved',
});

function Stage({ stage, total }) {
  const lineId = useId();
  return (
    <li className="flex flex-col gap-2xs">
      <p id={lineId} className="text-admin-base text-admin-ink">
        <span className="font-semibold">{STAGE_WORDS[stage.id] ?? stage.id}:</span>{' '}
        <Figure value={stage.count} /> of <Figure value={total} />
      </p>
      <progress
        aria-labelledby={lineId}
        value={Math.min(stage.count, total)}
        max={total}
        className="h-2 w-full max-w-xl accent-admin-action"
      />
    </li>
  );
}

/**
 * @param {{ funnel: Array<{ id: string, count: number }>|undefined, revoked: number|undefined }} props
 */
export default function FunnelPanel({ funnel, revoked = 0 }) {
  const stages = Array.isArray(funnel) ? funnel : [];
  const total = stages[0]?.count ?? 0;
  return (
    <Panel
      title="Registration funnel"
      description="Every account, then the ones that hold a ticket or were approved, then the approved ones."
    >
      {total === 0 ? (
        <p className="text-admin-base text-admin-ink">No one has signed up yet.</p>
      ) : (
        <div className="flex flex-col gap-sm">
          <ol className="flex flex-col gap-sm">
            {stages.map((stage) => (
              <Stage key={stage.id} stage={stage} total={total} />
            ))}
          </ol>
          {revoked > 0 ? (
            <p className="text-admin-sm text-admin-ink-secondary">
              <Figure value={revoked} /> revoked.{' '}
              {plural(revoked, 'It counts as an account but not in the later stages.', 'They count as accounts but not in the later stages.')}
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
