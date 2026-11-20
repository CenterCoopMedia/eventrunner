// /admin/pitches/import: bring proposals into the private queue from a
// reviewed CSV file (ADR 0008, admin review).
import { Link } from 'react-router';
import { useAdminApi } from '../adminApi.js';
import ImportPitches from '../components/ImportPitches.jsx';
import AdminPageHeader from '../components/adminChrome.jsx';
import { secondaryButtonClass } from '../components/formControls.jsx';

export default function AdminPitchImport() {
  const call = useAdminApi();
  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader help="Add proposals from another form to the private queue. An import keeps every decision and note already saved, and sends no email."
        title="Import pitches"
        description="Add proposals from another form to the private queue. An import keeps every decision and note already saved, and sends no email."
        actions={<Link to="/admin/pitches" className={secondaryButtonClass}>Back to the queue</Link>}
      />
      <ImportPitches call={call} />
    </div>
  );
}
