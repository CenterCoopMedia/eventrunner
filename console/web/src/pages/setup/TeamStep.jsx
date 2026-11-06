import { useEffect } from 'react';
import { useAuth } from '../../auth.jsx';
import TeamSections from '../TeamSections.jsx';
import { useTeam } from '../useTeam.js';
import LoadingState from '../../LoadingState.jsx';
import ActionFeedback from '../../ActionFeedback.jsx';
import IconControl from '../../IconControl.jsx';

/** Step 4: the same team tools as the Team page. Invites go out at once. */
export default function TeamStep({ orgId, onOwnersNeeded }) {
  const { user } = useAuth();
  const team = useTeam(orgId);
  const ownersNeeded = team.data?.ownersNeeded;

  useEffect(() => {
    if (typeof ownersNeeded === 'number') onOwnersNeeded(ownersNeeded);
  }, [ownersNeeded, onOwnersNeeded]);

  if (!team.data) {
    return team.error ? (
      <ActionFeedback kind="error"><p>{team.error}</p><IconControl icon="refresh" label="Reload team" onClick={team.refresh} disabled={team.refreshing} /></ActionFeedback>
    ) : <LoadingState>Loading the team.</LoadingState>;
  }
  return (
    <div>
      <p className="lead">Invite the people who run the event with you.</p>
      <TeamSections team={team} myUid={user?.uid} />
    </div>
  );
}
