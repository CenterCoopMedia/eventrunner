// Sponsors page — the public directory of supporting organizations.
// Feature-gated by config/features.sponsors — the nav link already hides
// when the feature is off, but the route itself must gate too, since direct
// navigation bypasses the nav (matches the Schedule.jsx pattern).
//
// The wall itself is components/SponsorWall.jsx. It lived here until the
// home page started showing the same acknowledgement (M7 issue 10); the
// composition, the tier rules, and why the operator's own order sets the
// mark size are all documented there. This page is now what it always was
// around it: the route, the feature gate, the heading, and the empty state.
import { Link } from 'react-router-dom';
import { useContent } from '../contexts/ContentContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import SystemPage from '../components/SystemPage.jsx';
import SponsorWall, { visibleOrganizations } from '../components/SponsorWall.jsx';
import { primaryActionClass } from '../components/controlClasses.js';

export default function Sponsors() {
  const { features } = useEventConfig();
  const { organizationsData } = useContent();
  const visible = visibleOrganizations(organizationsData);

  if (!features.sponsors) {
    return (
      <EmptyState
        title="This event doesn’t have public sponsors"
        description="Everything else about the event is on the home page."
        action={
          <Link to="/" className={primaryActionClass}>
            Go to the home page
          </Link>
        }
      />
    );
  }

  return (
    <SystemPage pageId="sponsors">
      {({ arrangement }) => (
        <>
          <h1 className="font-heading text-h1 font-semibold text-text-primary">Sponsors</h1>
          {visible.length === 0 ? (
            <div className="mt-lg">
              <EmptyState
                title="Sponsors have not been announced yet"
                description="Supporting organizations appear here once they are published."
              />
            </div>
          ) : (
            <SponsorWall organizations={visible} arrangement={arrangement} />
          )}
        </>
      )}
    </SystemPage>
  );
}
