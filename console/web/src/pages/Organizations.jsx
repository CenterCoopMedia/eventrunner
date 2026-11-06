import PageHeading from '../PageHeading.jsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../api.js';
import LoadingState from '../LoadingState.jsx';
import IconControl from '../IconControl.jsx';
import { ROLE_LABELS, SIGNUP_LINK_HELP, formatDate } from '../text.js';

function OrganizationDirectory({ organizations, all = false, labelledBy }) {
  const prefix = all ? 'all-organization' : 'my-organization';
  return (
    <div className="organization-directory">
      <div className="directory-columns" aria-hidden="true">
        <span>Organization</span><span>{all ? 'Created' : 'Your role'}</span>
      </div>
      <ul className="directory-list" aria-labelledby={labelledBy}>
        {organizations.map((org) => (
          <li key={org.id}>
            <Link to={`/organizations/${org.id}`} className="directory-link"
              aria-labelledby={`${prefix}-${org.id}-name`} aria-describedby={`${prefix}-${org.id}-detail`}>
              <span className="directory-name" id={`${prefix}-${org.id}-name`}>{org.name}</span>
              <span className="directory-detail" id={`${prefix}-${org.id}-detail`}>
                {all ? <><span className="directory-mobile-label">Created </span>{formatDate(org.createdAt)}</> : ROLE_LABELS[org.role] || 'Team member'}
              </span>
              <span className="directory-arrow" aria-hidden="true">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The home page: my organizations, and every organization for the hosting team. */
export default function Organizations() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setError('');
    setLoading(true);
    callApi('listOrganizations', {})
      .then((body) => { if (live) setData(body); })
      .catch((err) => { if (live) setError(err.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refreshKey]);

  const refresh = <IconControl icon="refresh" label="Refresh organizations" disabled={loading} onClick={() => setRefreshKey((value) => value + 1)} />;
  if (error && !data) return <div className="console-workspace"><p className="message error" role="alert">{error}</p>{refresh}</div>;
  if (!data) return <LoadingState className="console-workspace">Loading your organizations.</LoadingState>;

  return (
    <section aria-labelledby="orgs-title" className="console-workspace organizations-workspace">
      <header className="workspace-heading directory-heading">
        <PageHeading id="orgs-title" tabIndex={-1}>Your organizations</PageHeading>
        {refresh}
      </header>
      {error ? <p className="message error" role="alert">{error}</p> : null}
      {data.organizations.length > 0 ? (
        <OrganizationDirectory organizations={data.organizations} labelledBy="orgs-title" />
      ) : (
        <div className="directory-empty">
          <p>{data.operator ? 'Your organizations will appear here when you join a team.' : 'Open an invite email to join your team, or use a signup link to start an event site.'}</p>
          {!data.operator && import.meta.env.VITE_CONSOLE_HELP_EMAIL ? <a className="button" href={`mailto:${import.meta.env.VITE_CONSOLE_HELP_EMAIL}`} title={SIGNUP_LINK_HELP}>Get a signup link</a> : null}
        </div>
      )}

      {data.operator ? (
        <section aria-labelledby="all-orgs-title" className="organization-operator-section">
          <header className="directory-heading">
            <div>
              <h2 id="all-orgs-title">All organizations</h2>
            </div>
            <Link className="button" to="/review">Review requests</Link>
          </header>
          {(data.allOrganizations || []).length > 0 ? (
            <OrganizationDirectory organizations={data.allOrganizations} all labelledBy="all-orgs-title" />
          ) : <div className="directory-empty"><p>Create a signup link for your first organization.</p><Link className="button primary" to="/review/links">Create signup link</Link></div>}
        </section>
      ) : null}
    </section>
  );
}
