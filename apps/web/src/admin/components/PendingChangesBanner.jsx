// The pending-changes banner (issue #196; design record §3.4): one sentence
// and one link on the proof ground, above the stone on every admin screen
// while something is saved but not live.
//
// It reads the shell's one count (PendingChangesContext) and counts nothing
// of its own, so it cannot disagree with the Unpublished changes page. It
// reads the dirty drafts, never the publish run rows: a run is progress, not
// unpublished work.
//
// What it leaves out, on purpose. No live role: the editor that saved
// already says so once, and a second announcement would repeat it. No
// dismiss control: a dismissed count would hide unpublished work. No count
// on the rail: the rail carries words only. Nothing on the page it links to,
// whose own figure sentence states the same count.
//
// It sits ABOVE the stone, never inside it: the title band pulls itself up
// by the stone's top padding, and inside the stone it would slide over this.
import { Link, matchPath, useLocation } from 'react-router-dom';
import { usePendingChanges } from '../PendingChangesContext.jsx';

export const UNPUBLISHED_PATH = '/admin/unpublished';

export default function PendingChangesBanner() {
  const { ready, error, total, sentence } = usePendingChanges();
  // The router's own matcher: any case, a trailing slash allowed. (matchPath
  // is already in the first-paint bundle; useMatch would add itself there.)
  const onOwnPage = matchPath(UNPUBLISHED_PATH, useLocation().pathname);
  // A count that failed before it ever arrived says so; a count that
  // arrived keeps showing through a later failure while the read retries.
  const failed = !ready && Boolean(error);
  if (onOwnPage || (!failed && (!ready || total === 0))) return null;
  return (
    <div className="mx-auto w-full max-w-admin-canvas">
      <aside
        aria-label="Unpublished changes"
        data-pending-total={failed ? undefined : total}
        className="border-admin-rule-hairline border-b-admin-hairline bg-admin-ground-proof px-md py-xs text-admin-sm text-admin-ink lg:px-lg"
      >
        {failed ? (
          <p>We could not count the unpublished changes. We will try again.</p>
        ) : (
          <p>
            {sentence}{' '}
            {/* The ink, not the link ink: the ink on the proof ground is a
                measured pair, and the underline and weight say "link". It
                stays in the sentence and still takes the hit-area floor
                (admin-target: 24px on a pointer, 44px on touch); the
                room's ring draws its focus. */}
            <Link
              to={UNPUBLISHED_PATH}
              className="admin-target inline-flex items-center rounded-admin-small font-semibold text-admin-ink underline underline-offset-2"
            >
              Review unpublished changes
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}
