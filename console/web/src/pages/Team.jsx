import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { callApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ROLE_LABELS, formatDate } from '../text.js';
import TeamInviteForm from './TeamInviteForm.jsx';
import TeamMembers from './TeamMembers.jsx';

/** ADR 0007 §2: launch readiness needs two operators, so the console asks for two Owners. */
function LaunchOwners({ ownersNeeded }) {
  let detail = 'This team has the two Owners that launch needs.';
  if (ownersNeeded === 1) detail = 'Add 1 more Owner before launch.';
  if (ownersNeeded > 1) detail = `Add ${ownersNeeded} more Owners before launch.`;
  return (
    <aside className="note" role="note" aria-labelledby="launch-owners-title">
      <p id="launch-owners-title" className="note-title">Two Owners are needed before launch.</p>
      <p>Two people must be able to run the event site, so that one person is never the only way in. {detail}</p>
    </aside>
  );
}

export default function Team() {
  const { orgId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await callApi('getTeam', { orgId }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Run one change, then show what happened and reload the team. */
  const change = useCallback(async (name, body, done) => {
    setNotice('');
    setError('');
    try {
      await callApi(name, { orgId, ...body });
      setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, [orgId, load]);

  if (!data) {
    return error ? <p className="message error" role="alert">{error}</p> : <p role="status">Loading the team.</p>;
  }

  const isOwner = data.myRole === 'owner';
  return (
    <section aria-labelledby="team-title">
      <p className="folio">{data.organization.name}</p>
      <h1 id="team-title" tabIndex={-1}>Team</h1>

      <LaunchOwners ownersNeeded={data.ownersNeeded} />

      <div aria-live="polite" className="live">
        {notice ? <p className="message success">{notice}</p> : null}
      </div>
      {error ? <p className="message error" role="alert">{error}</p> : null}

      {!isOwner && data.myRole ? <p className="muted">Only an Owner can invite people or change roles.</p> : null}
      {!data.myRole && data.operator ? (
        <p className="muted">You are on the hosting team. You can see this team, but you cannot change it.</p>
      ) : null}

      <h2 id="members-title">Members</h2>
      <TeamMembers members={data.members} myUid={user?.uid} canEdit={isOwner} onChange={change} />

      {data.invites.length > 0 ? (
        <>
          <h2 id="invites-title">Invites waiting for an answer</h2>
          <ul className="cards" aria-labelledby="invites-title">
            {data.invites.map((invite) => (
              <li key={invite.id} className="card">
                <span className="card-title">{invite.email}</span>
                <span className="tag">{ROLE_LABELS[invite.role]}</span>
                <span className="muted">Link expires {formatDate(invite.expiresAt)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {isOwner ? <TeamInviteForm onInvite={change} /> : null}
    </section>
  );
}
