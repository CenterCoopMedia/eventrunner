// MaterialsLink — "Materials (2)", and it goes to the materials.
//
// Was MaterialsPill: a bordered rectangle reading "2 materials" that did
// nothing when clicked. A control-shaped thing that is not a control is the
// worst of both — it costs a target's worth of space, invites a click, and
// answers it with nothing.
//
// The count is real information, so it stays. It is now a link, and it
// lands on the list it counts: the session's own detail page, at the
// materials section. The query string rides along so an admin previewing
// drafts (?preview=1) does not fall out of the preview by following it.
import { Link, useLocation } from 'react-router-dom';
import { useSessionMaterialsCount } from '../../hooks/useSessionMaterials.js';
import { rowActionClass } from './sessionActionClass.js';

/**
 * @param {{ session: { id: string } }} props
 */
export default function MaterialsLink({ session }) {
  const count = useSessionMaterialsCount(session);
  const { search } = useLocation();
  if (!count) return null;
  return (
    <Link
      to={{ pathname: `/schedule/${session.id}`, search, hash: '#session-materials' }}
      className={rowActionClass}
    >
      Materials ({count})
    </Link>
  );
}
