import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { callApi } from '../../api.js';
import LoadingState from '../../LoadingState.jsx';
import IconControl from '../../IconControl.jsx';
import { STATUS_FILTERS, STATUS_LABELS, formatDateTime } from '../../reviewText.js';
import HostingOnly, { isNotOperator } from './HostingOnly.jsx';

/** The review queue: requests by status, newest change first. Hosting team only. */
export default function ReviewQueue() {
  const [params] = useSearchParams();
  const location = useLocation();
  const requested = params.get('status');
  const status = STATUS_FILTERS.includes(requested) ? requested : STATUS_FILTERS[0];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    callApi('listApplicationsForReview', { status })
      .then((body) => { if (live) setData(body); })
      .catch((err) => { if (live) setError(err); });
    return () => { live = false; };
  }, [status, refreshKey]);

  if (isNotOperator(error)) return <HostingOnly />;
  const notice = location.state?.notice;

  return (
    <section aria-labelledby="queue-title">
      <p className="folio">Hosting team</p>
      <div className="directory-heading">
        <h1 id="queue-title" tabIndex={-1}>Review requests</h1>
        <IconControl icon="refresh" label="Refresh requests" disabled={!data && !error} onClick={() => setRefreshKey((value) => value + 1)} />
      </div>
      {notice ? <p className="message success" role="status">{notice}</p> : null}

      <nav aria-label="Filter by status" className="filters">
        <ul>
          {STATUS_FILTERS.map((value) => (
            <li key={value}>
              <Link
                to={`/review?status=${value}`}
                className="filter"
                aria-current={value === status ? 'page' : undefined}
              >
                {STATUS_LABELS[value]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <h2 id="queue-list-title">{STATUS_LABELS[status]}</h2>
      {error ? <p className="message error" role="alert">{error.message}</p> : null}
      {!data && !error ? <LoadingState>Loading the requests.</LoadingState> : null}
      {data && data.applications.length === 0 ? <div className="directory-empty">
        <p>No requests here. Choose another status or create a signup link.</p>
        <Link className="button" to="/review/links">Create signup link</Link>
      </div> : null}
      {data && data.applications.length > 0 ? (
        <ul className="cards" aria-labelledby="queue-list-title">
          {data.applications.map((app) => (
            <li key={app.id} className="card">
              <Link to={`/review/${app.id}`} className="card-title">{app.eventName || 'Event with no name yet'}</Link>
              <span>{app.organizationName}</span>
              {app.webAddressName ? <span className="muted break">{app.webAddressName}.eventrunner.org</span> : null}
              <span className="muted">Last change {formatDateTime(app.updatedAt)}</span>
              {app.buildStartFailed ? <span className="tag">Site setup needs attention</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="section"><Link to="/review/links">Signup links</Link></p>
      <p><Link to="/review/settings">Console settings</Link></p>
    </section>
  );
}
