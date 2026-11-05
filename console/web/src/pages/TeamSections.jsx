import { ROLE_LABELS, formatDate } from '../text.js';
import TeamInviteForm from './TeamInviteForm.jsx';
import TeamMembers from './TeamMembers.jsx';

/** A recommendation, not a condition: a second Owner keeps one lost inbox from locking the team out. */
function SecondOwner({ ownersNeeded }) {
  const covered = ownersNeeded === 0;
  let detail = 'One lost inbox can\'t lock you out of your event site.';
  if (ownersNeeded === 1) detail = 'With two, one lost inbox can\'t lock you out of your event site. You can add 1 more Owner at any time.';
  if (ownersNeeded > 1) detail = `With two, one lost inbox can't lock you out of your event site. You can add ${ownersNeeded} more Owners at any time.`;
  return (
    <aside className="note" role="note" aria-labelledby="second-owner-title">
      <p id="second-owner-title" className="note-title">{covered ? 'Your team has two Owners.' : 'We recommend two Owners.'}</p>
      <p>{detail}</p>
    </aside>
  );
}

/**
 * Everything on the Team page under its heading: the second Owner note, the
 * members, the open invites and the invite form. `team` is useTeam().
 */
export default function TeamSections({ team, myUid }) {
  const { data, outcome, pending, stale, refreshing, change, refresh } = team;
  const isOwner = data.myRole === 'owner';
  return (
    <>
      <SecondOwner ownersNeeded={data.ownersNeeded} />

      {!isOwner && data.myRole ? <p className="muted">Only an Owner can invite people or change roles.</p> : null}
      {!data.myRole && data.operator ? (
        <p className="muted">You are on the hosting team. You can see this team, but you cannot change it.</p>
      ) : null}

      <h2 id="members-title">Members</h2>
      <TeamMembers members={data.members} myUid={myUid} canEdit={isOwner} onChange={change}
        outcome={outcome?.key !== 'invite' ? outcome : null} pending={pending} disabled={Boolean(pending) || stale}
        onRefresh={refresh} refreshing={refreshing} />

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

      {isOwner ? <TeamInviteForm onInvite={change} outcome={outcome?.key === 'invite' ? outcome : null}
        disabled={Boolean(pending) || stale} onRefresh={refresh} refreshing={refreshing} /> : null}
    </>
  );
}
