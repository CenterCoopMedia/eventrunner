import { Link, useLocation } from 'react-router';
import { useRef, useState } from 'react';
import { useBusyLate } from '../../components/BusyLabel.jsx';
import { Notice, linkButtonClass } from './formControls.jsx';

/** Keep a write locked while awaiting its reply or after losing its reply. */
export function useAdminSaveState(idle) {
  const [action, setAction] = useState(idle);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const current = useRef(idle);
  const lostReply = useRef(false);

  function set(next) {
    current.current = next;
    setAction(next);
  }

  function begin(next) {
    if (current.current !== idle || lostReply.current || navigator.onLine === false) return false;
    set(next);
    return true;
  }

  function capture(error) {
    if (error?.queueId || !(error?.code === 'network' || error?.status === 408
      || error?.status === 502 || error?.status === 504)) return false;
    lostReply.current = true;
    setUnconfirmed(true);
    return true;
  }

  return { action, set, begin, capture, unconfirmed };
}

/** Check the server in a fresh view while the submitting editor stays intact. */
function SavedChangesLink({ to }) {
  const { pathname, search } = useLocation();
  return (
    <Link to={to && to !== '.' ? to : pathname + search} target="_blank" rel="noopener noreferrer" className={linkButtonClass}>
      Check saved changes (opens in a new tab)
    </Link>
  );
}

export default function AdminPendingSave({ busy, to, unconfirmed = false }) {
  const late = useBusyLate(busy);
  if (!late && !unconfirmed) return null;
  return (
    <Notice tone="caution" message={unconfirmed
      ? 'The save result is unknown. This editor is holding the draft so you can compare it with the saved version. '
      : 'The save result is unknown. Keep this tab open for the original response. '}>
      <SavedChangesLink to={to} />
    </Notice>
  );
}
