import RuledTable from '../../src/admin/components/RuledTable.jsx';
import { fixture } from './data.js';

const columns = [
  { id: 'name', label: 'Attendee' },
  { id: 'organization', label: 'Organization' },
  { id: 'role', label: 'Role' },
];
const rows = fixture.directory.map((profile) => ({
  id: profile.id,
  cells: { name: profile.displayName, organization: profile.organization, role: profile.jobTitle },
}));

export default function AdminTableFixture() {
  return (
    <div className="admin-room">
      <RuledTable
        caption="Synthetic attendee comparison"
        columns={columns}
        rows={rows}
        className="max-h-[20rem]"
        tableClassName="min-w-[28rem]"
      />
    </div>
  );
}
