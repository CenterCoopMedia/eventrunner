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

/**
 * Everything on the Team page under its heading: the launch note, the
 * members, the open invites and the invite form. `team` is useTeam().
 */
export default function TeamSections({ team, myUid }) {
  const { data, error, notice, change } = team;
  const isOwner = data.myRole === 'owner';
  return (
    <>
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
      <TeamMembers members={data.members} myUid={myUid} canEdit={isOwner} onChange={change} />

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
    </>
  );
}
