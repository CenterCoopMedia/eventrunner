import { Link } from 'react-router-dom';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { useAdminSessions } from '../useAdminSessions.js';
import { Notice, Panel, primaryButtonClass } from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  proofRowClass,
} from '../components/adminChrome.jsx';

export default function AdminSessionsList() {
  const { eventConfig } = useEventConfig();
  const { groups, rows, loading, error } = useAdminSessions();
  const placeNames = new Map(
    (eventConfig.venue?.places ?? []).map((place) => [place.id, place.name]),
  );

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Sessions"
        identifiers={`${rows.length} session${rows.length === 1 ? '' : 's'}`}
        description="The programme in event-day order. Child sessions stay directly below their parent."
        actions={
          <Link to="new" className={primaryButtonClass}>
            Create a session
          </Link>
        }
      />

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the session register; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading sessions…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No sessions yet"
          description="Create the first session, then save its draft before publishing it."
          action={
            <Link to="new" className={primaryButtonClass}>
              Create a session
            </Link>
          }
        />
      ) : (
        groups.map((group) => (
          <Panel key={group.dayId} title={group.label} flush>
            <ul>
              {group.rows.map((row) => {
                const session = row.current;
                const place = placeNames.get(session.placeId) || session.location || 'No place';
                return (
                  <li
                    key={row.id}
                    className={`border-admin-rule-hairline border-b-admin-hairline last:border-b-0 ${proofRowClass(row.state.id)}`}
                  >
                    <div className={`flex flex-wrap items-center justify-between gap-sm px-md py-xs ${session.parentId ? 'ms-md' : ''}`}>
                      <div className="min-w-0">
                        <Link
                          to={row.id}
                          className="font-admin-ui text-caption font-semibold text-admin-ink-link underline underline-offset-2"
                        >
                          {session.title || row.id}
                        </Link>
                        <p className="mt-3xs font-admin-data text-folio text-admin-ink-data">
                          {[`${session.startTime || 'Time unset'}${session.endTime ? `–${session.endTime}` : ''}`,
                            session.track ? `Track ${session.track}` : null,
                            place]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      <RecordState state={row.state} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
