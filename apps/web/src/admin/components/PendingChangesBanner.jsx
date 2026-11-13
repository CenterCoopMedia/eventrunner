// The pending-changes banner (issue #196; design record §3.4): one sentence
// and one link on the proof ground, above the stone on every admin screen
// while something is saved but not live.
//
// It reads the shell's server-maintained count (PendingChangesContext),
// never draft rows or publish runs. On the Unpublished changes page it is
// hidden; that page derives its count from the rows it displays.
//
// What it leaves out, on purpose. No live role: the editor that saved
// already says so once, and a second announcement would repeat it. No
// dismiss control: a dismissed count would hide unpublished work. No count
// on the rail: the rail carries words only. Nothing on the page it links to,
// whose own figure sentence states the same count.
//
// It sits ABOVE the stone, never inside it: the title band pulls itself up
// by the stone's top padding, and inside the stone it would slide over this.
import { matchPath, useLocation } from 'react-router';
import PendingChangesNotice, { UNPUBLISHED_PATH } from './PendingChangesNotice.jsx';
import { usePendingChanges } from '../PendingChangesContext.jsx';

// matchPath does not decode percent-encoding. The router still renders this
// page for an encoded spelling, so decode each segment first. A decoded
// slash is put back as %2F: the router does not treat that as a separator,
// and /admin/unpublished%2F is the not-found screen, not this page. A bad
// escape stays unmatched rather than throwing.
function decodePathname(pathname) {
  try {
    return String(pathname ?? '')
      .split('/')
      .map((segment) => {
        if (segment === '') return '';
        return decodeURIComponent(segment).replaceAll('/', '%2F');
      })
      .join('/');
  } catch {
    return pathname;
  }
}

export default function PendingChangesBanner() {
  const { ready, error, total, sentence } = usePendingChanges();
  // The router's own matcher: any case, a trailing slash allowed. (matchPath
  // is already in the first-paint bundle; useMatch would add itself there.)
  const onOwnPage = matchPath(UNPUBLISHED_PATH, decodePathname(useLocation().pathname));
  // A count that failed before it ever arrived says so; a count that
  // arrived keeps showing through a later failure while the read retries.
  const failed = !ready && Boolean(error);
  if (onOwnPage || (!failed && (!ready || total === 0))) return null;
  return <PendingChangesNotice failed={failed} total={total} sentence={sentence} />;
}
