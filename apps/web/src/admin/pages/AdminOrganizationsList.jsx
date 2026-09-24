// The organizations list (issue #192): every organization the sponsors page
// can draw, live and draft, in the order it draws them.
//
// A ruled table, not a galley of rows: an operator compares organizations
// by tier and order, which is what columns are for (design vocabulary §3.4).
// b1's admin RuledTable takes no row class, and a row with unpublished
// changes has to sit on the proof ground, so the table is drawn here with
// the galley head the ticketing tables draw.
//
// Each row states its record state as a word, and a record the page will
// not draw says "Hidden" beside it, so no state is left to the tint.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';
import { useAdminApi } from '../adminApi.js';
import { summarizePublish } from '../publishResult.js';
import { useAdminOrganizations } from '../useAdminOrganizations.js';
import {
  Notice,
  primaryButtonClass,
  rowMetaClass,
  rowTitleLinkClass,
  secondaryButtonClass,
} from '../components/formControls.jsx';
import AdminPageHeader, {
  AdminEmptyState,
  AdminLoadingState,
  RecordState,
  StatusBadge,
  proofRowClass,
} from '../components/adminChrome.jsx';

const HEAD_CLASS =
  'sticky top-0 z-10 border-b-admin-strong border-admin-rule-strong bg-admin-ground-soft px-sm py-xs ' +
  'text-admin-xs font-semibold text-admin-ink-secondary';

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export default function AdminOrganizationsList() {
  const { rows, loading, error } = useAdminOrganizations();
  const call = useAdminApi();
  const { showToast } = useToast();
  const [publishing, setPublishing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [resumeQueueId, setResumeQueueId] = useState(null);
  // A saved draft is dirty until it is published, new or not: the same
  // count the overview's readiness table and the pending changes page read.
  const dirtyIds = rows.filter((row) => row.draft?.status === 'dirty').map((row) => row.id);

  function reportPublish(response, ids) {
    const verdict = summarizePublish(response, 'cmsOrganizations', ids, 'organizations');
    setNotice({ tone: verdict.ok ? 'ok' : 'error', message: verdict.message });
    // The notice is the record and the announcement; the toast repeats it
    // silently, so one result is announced once.
    showToast(verdict.message, verdict.ok ? { announce: false } : { tone: 'error', announce: false });
  }

  function reportFailure(err) {
    setNotice({ tone: 'error', message: err.message });
    showToast(err.message, { tone: 'error', announce: false });
    if (err?.queueId) setResumeQueueId(err.queueId);
  }

  async function publishAll() {
    const ids = dirtyIds;
    setPublishing('all');
    setNotice(null);
    setResumeQueueId(null);
    try {
      reportPublish(await call('cmsPublish', { collection: 'cmsOrganizations', docIds: ids }), ids);
    } catch (err) {
      reportFailure(err);
    } finally {
      setPublishing(null);
    }
  }

  async function resumePublish() {
    setPublishing('resume');
    try {
      const response = await call('cmsPublish', { queueId: resumeQueueId });
      setResumeQueueId(null);
      reportPublish(response, dirtyIds);
    } catch (err) {
      reportFailure(err);
    } finally {
      setPublishing(null);
    }
  }

  const addLink = (
    <Link to="_new" className={primaryButtonClass}>
      Add an organization
    </Link>
  );

  return (
    <div className="flex flex-col gap-md">
      <AdminPageHeader
        title="Organizations"
        identifiers={`${rows.length} organization${rows.length === 1 ? '' : 's'}`}
        description="The sponsors page draws these in this order. Organizations with the same tier form one group."
        actions={
          <>
            {resumeQueueId ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={resumePublish}
                disabled={publishing !== null}
                aria-busy={publishing === 'resume' || undefined}
              >
                {publishing === 'resume' ? 'Resuming…' : 'Resume publish'}
              </button>
            ) : null}
            {dirtyIds.length > 0 ? (
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={publishAll}
                disabled={publishing !== null}
                aria-busy={publishing === 'all' || undefined}
              >
                {publishing === 'all' ? 'Publishing…' : `Publish all (${dirtyIds.length})`}
              </button>
            ) : null}
            {addLink}
          </>
        }
      />

      {notice ? <Notice tone={notice.tone} message={notice.message} /> : null}

      {error ? (
        <Notice
          tone="caution"
          message="We lost the connection to the organization list; showing the last values we received and retrying."
        />
      ) : null}

      {loading ? (
        <AdminLoadingState label="Loading organizations…" />
      ) : rows.length === 0 ? (
        <AdminEmptyState
          title="No organizations yet"
          description="Add the first organization, then publish it to show it on the sponsors page."
          action={addLink}
        />
      ) : (
        // A scrolling region has to be reachable by keyboard to be scrolled
        // by one, so it takes a tab stop and a name.
        <div
          role="region"
          aria-label="Organizations"
          tabIndex={0}
          className="overflow-auto rounded-admin border-admin-hairline border-admin-rule-hairline bg-admin-ground-raised"
        >
          <table className="w-full min-w-[36rem] border-collapse text-admin-sm">
            <caption className="sr-only">Organizations in the order the sponsors page draws them.</caption>
            <thead>
              <tr>
                <th scope="col" className={`${HEAD_CLASS} text-start`}>Organization</th>
                <th scope="col" className={`${HEAD_CLASS} text-start`}>Tier</th>
                <th scope="col" aria-sort="ascending" className={`${HEAD_CLASS} text-end`}>Order</th>
                <th scope="col" className={`${HEAD_CLASS} text-start`}>State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const organization = row.current ?? {};
                const tier = text(organization.tier);
                return (
                  <tr
                    key={row.id}
                    className={`border-b-admin-hairline border-admin-rule-hairline last:border-b-0 ${proofRowClass(row.state.id)}`}
                  >
                    <td className="px-sm py-xs align-top">
                      <Link to={encodeURIComponent(row.id)} className={rowTitleLinkClass}>
                        {text(organization.name) ?? row.id}
                      </Link>
                      <p className={`mt-3xs ${rowMetaClass}`}>/sponsors/{row.id}</p>
                    </td>
                    <td className={`px-sm py-xs align-top ${tier ? 'text-admin-ink' : 'text-admin-ink-secondary'}`}>
                      {tier ?? 'None'}
                    </td>
                    <td className="px-sm py-xs text-end align-top font-admin-data tabular-nums text-admin-ink">
                      {Number.isFinite(organization.order) ? organization.order : 'None'}
                    </td>
                    <td className="px-sm py-xs align-top">
                      <span className="flex flex-wrap items-center gap-2xs">
                        <RecordState state={row.state} />
                        {organization.visible === false ? <StatusBadge tone="neutral">Hidden</StatusBadge> : null}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
