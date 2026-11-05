import { Link, useParams } from 'react-router';
import { useAuth } from '../auth.jsx';
import TeamSections from './TeamSections.jsx';
import { useTeam } from './useTeam.js';
import LoadingState from '../LoadingState.jsx';

export default function Team() {
  const { orgId } = useParams();
  const { user } = useAuth();
  const team = useTeam(orgId);
  const { data, error } = team;

  if (!data) {
    return error ? <p className="message error" role="alert">{error}</p> : <LoadingState>Loading the team.</LoadingState>;
  }

  return (
    <section aria-labelledby="team-title">
      <p className="folio">{data.organization.name}</p>
      <h1 id="team-title" tabIndex={-1}>Team</h1>
      <p><Link to={`/organizations/${orgId}`}>Go to the event sites of {data.organization.name}</Link></p>
      <TeamSections team={team} myUid={user?.uid} />
    </section>
  );
}
