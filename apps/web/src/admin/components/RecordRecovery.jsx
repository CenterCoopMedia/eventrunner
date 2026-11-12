import { useEffect, useState } from 'react';
import { useAdminApi } from '../adminApi.js';

export function restoreLimitFor(collection) {
  if (collection === 'cmsSchedule') return 'Restoring the session does not restore its materials.';
  if (collection === 'cmsOrganizations') return 'Restoring the organization does not restore representative access or an edit that was waiting for review.';
  if (collection === 'cmsContent') return 'A content block can be restored only while its section is on a page.';
  return '';
}

// Mounted only inside an open delete confirmation. A draft with no live
// document can still have versions from an earlier delete and restore.
export default function RecordRecovery({ collection, docId }) {
  const call = useAdminApi();
  const path = `${collection}/${docId}`;
  const [result, setResult] = useState(null);
  useEffect(() => {
    if (!docId) return undefined;
    let active = true;
    call('cmsGetVersionHistory', { docPath: path, limit: 1 }).then(
      (answer) => { if (active) setResult({ path, published: Array.isArray(answer?.entries) ? answer.entries.length > 0 : null }); },
      () => { if (active) setResult({ path, published: null }); },
    );
    return () => { active = false; };
  }, [call, docId, path]);
  const published = result?.path === path ? result.published : null;
  let recovery = 'If this record has a published version, it can be restored as a draft from Version history. Without one, it cannot be restored.';
  if (published === false) recovery = 'This record has no published version and cannot be restored after deletion.';
  else if (published === true) recovery = 'Published versions can be restored as a draft from Version history.';
  return <span aria-live="polite" aria-atomic="true">{recovery} Unpublished edits are lost. {restoreLimitFor(collection)}</span>;
}
