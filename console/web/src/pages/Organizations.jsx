import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { callApi } from '../api.js';
import LoadingState from '../LoadingState.jsx';
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
                {all ? <><span className="directory-mobile-label">Created </span>{formatDate(org.createdAt)}</> : ROLE_LABELS[org.role] || org.role}
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

  useEffect(() => {
    let live = true;
    callApi('listOrganizations', {})
      .then((body) => { if (live) setData(body); })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, []);

  if (error) return <p className="message error console-workspace" role="alert">{error}</p>;
  if (!data) return <LoadingState className="console-workspace">Loading your organizations.</LoadingState>;

  return (
    <section aria-labelledby="orgs-title" className="console-workspace organizations-workspace">
      <header className="workspace-heading">
        <h1 id="orgs-title" tabIndex={-1}>Your organizations</h1>
        {data.organizations.length > 0 ? <p className="lead">Open an organization to view its event sites and team.</p> : null}
      </header>
      {data.organizations.length > 0 ? (
        <OrganizationDirectory organizations={data.organizations} labelledBy="orgs-title" />
      ) : (
        <div className="directory-empty">
          <p>You are not on the team of any organization.</p>
          {data.operator ? null : <p>{SIGNUP_LINK_HELP} To join a team, open the invite email.</p>}
        </div>
      )}

      {data.operator ? (
        <section aria-labelledby="all-orgs-title" className="organization-operator-section">
          <header className="directory-heading">
            <div>
              <h2 id="all-orgs-title">All organizations</h2>
              <p className="muted">You are on the hosting team, so you can see every organization. You cannot change their teams.</p>
            </div>
            <Link className="button" to="/review">Review requests</Link>
          </header>
          {(data.allOrganizations || []).length > 0 ? (
            <OrganizationDirectory organizations={data.allOrganizations} all labelledBy="all-orgs-title" />
          ) : <p className="directory-empty">There are no organizations yet.</p>}
        </section>
      ) : null}
    </section>
  );
}
