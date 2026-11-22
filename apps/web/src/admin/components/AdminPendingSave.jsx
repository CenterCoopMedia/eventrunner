import { Link, useLocation } from 'react-router';
import { useRef, useState } from 'react';
import { useBusyLate } from '../../components/BusyLabel.jsx';
import { Notice, linkButtonClass } from './formControls.jsx';

/** Keep a write locked while awaiting its reply or after losing its reply. */
export function useAdminSaveState(idle, recordId) {
  const [saves, setSaves] = useState(() => new Map());
  const current = useRef(saves);
  const { action = idle, unconfirmed = false, offline = false } = saves.get(recordId) ?? {};

  function update(changes) {
    const saves = new Map(current.current);
    const next = { action: idle, ...saves.get(recordId), ...changes };
    if (next.action === idle && !next.unconfirmed && !next.offline) saves.delete(recordId);
    else saves.set(recordId, next);
    current.current = saves;
    setSaves(saves);
  }

  function set(next) {
    update({ action: next });
  }

  function begin(next) {
    const save = current.current.get(recordId);
    if (save && (save.action !== idle || save.unconfirmed)) return false;
    if (navigator.onLine === false) {
      update({ offline: true });
      return false;
    }
    update({ action: next, offline: false });
    return true;
  }

  function capture(error) {
    if (error?.queueId || !(error?.code === 'network' || error?.status === 408
      || error?.status === 502 || error?.status === 504)) return false;
    update({ unconfirmed: true });
    return true;
  }

  return { action, set, begin, capture, unconfirmed, offline };
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

export default function AdminPendingSave({ busy, to, unconfirmed = false, offline = false }) {
  const late = useBusyLate(busy);
  if (offline) return <Notice tone="caution" message="The save was held while you were offline. Reconnect and submit your changes again." />;
  if (!late && !unconfirmed) return null;
  return (
    <Notice tone="caution" message={unconfirmed
      ? 'The save result is unknown. This editor is holding the draft so you can compare it with the saved version. '
      : 'The save result is unknown. Keep this tab open for the original response. '}>
      <SavedChangesLink to={to} />
    </Notice>
  );
}
