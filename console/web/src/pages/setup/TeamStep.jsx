import { useEffect } from 'react';
import { useAuth } from '../../auth.jsx';
import TeamSections from '../TeamSections.jsx';
import { useTeam } from '../useTeam.js';

/** Step 4: the same team tools as the Team page. Invites go out at once. */
export default function TeamStep({ orgId, onOwnersNeeded }) {
  const { user } = useAuth();
  const team = useTeam(orgId);
  const ownersNeeded = team.data?.ownersNeeded;

  useEffect(() => {
    if (typeof ownersNeeded === 'number') onOwnersNeeded(ownersNeeded);
  }, [ownersNeeded, onOwnersNeeded]);

  if (!team.data) {
    return team.error ? <p className="message error" role="alert">{team.error}</p> : <p role="status">Loading the team.</p>;
  }
  return (
    <div>
      <p className="lead">Invite the people who run the event with you. An invite is an email with a link.</p>
      <TeamSections team={team} myUid={user?.uid} />
    </div>
  );
}
