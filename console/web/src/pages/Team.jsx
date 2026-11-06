import { Link, useParams } from 'react-router';
import { useAuth } from '../auth.jsx';
import TeamSections from './TeamSections.jsx';
import { useTeam } from './useTeam.js';
import LoadingState from '../LoadingState.jsx';
import IconControl from '../IconControl.jsx';

export default function Team() {
  const { orgId } = useParams();
  const { user } = useAuth();
  const team = useTeam(orgId);
  const { data, error } = team;

  if (!data) {
    return error ? (
      <section className="stack">
        <h1 tabIndex={-1}>Team</h1>
        <p className="message error" role="alert">{error}</p>
        <IconControl icon="refresh" label="Refresh team" disabled={team.refreshing} onClick={team.refresh} />
      </section>
    ) : <LoadingState>Loading the team.</LoadingState>;
  }

  return (
    <section aria-labelledby="team-title">
      <p className="folio">{data.organization.name}</p>
      <h1 id="team-title" tabIndex={-1}>Team</h1>
      <p><Link to={`/organizations/${orgId}`}>Back to event sites</Link></p>
      <TeamSections team={team} myUid={user?.uid} />
    </section>
  );
}
