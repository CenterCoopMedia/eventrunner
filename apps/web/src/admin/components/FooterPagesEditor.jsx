import { useEffect, useRef, useState } from 'react';
import { useEventConfig } from '../../contexts/EventConfigContext.jsx';
import { navItemFor } from '../../lib/siteNavigation.js';
import { useAdminApi } from '../adminApi.js';
import { moveItem } from '../reorder.js';
import { ActionFeedback } from './ActionFeedback.jsx';
import { OrderAnnouncement, ReorderControls, bindReorderDrop } from './ReorderControls.jsx';
import {
  CheckboxField, Panel, SelectField, TextField, linkButtonClass, primaryButtonClass,
} from './formControls.jsx';

export default function FooterPagesEditor({ pageRows, ready, disabled, onEditStateChange }) {
  const { eventConfig, features, available } = useEventConfig();
  const call = useAdminApi();
  const stored = eventConfig?.footerPageGroup;
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const saving = useRef(false);
  const current = saved && saved.base === stored ? saved.group : stored;
  const group = draft ?? current ?? { heading: '', pageIds: null };
  const picks = pageRows
    .map(({ id, live }) => ({ id, order: live?.order ?? 0, item: navItemFor(live, features) }))
    .filter(({ item }) => item && !item.custom)
    .sort((a, b) => a.order - b.order || a.item.label.localeCompare(b.item.label));
  const selected = Array.isArray(group.pageIds) ? group.pageIds : null;
  const names = new Map(picks.map(({ id, item }) => [id, item.label]));
  const dirty = draft !== null;
  const locked = !ready || !available?.event || disabled || busy;

  useEffect(() => {
    onEditStateChange({ dirty, busy });
  }, [dirty, busy, onEditStateChange]);
  useEffect(() => () => onEditStateChange({ dirty: false, busy: false }), [onEditStateChange]);

  function change(fields) {
    setFeedback(null);
    setDraft({ ...group, ...fields });
  }

  function move(from, to) {
    if (locked || !selected) return false;
    const next = moveItem(selected, from, to);
    if (next === selected) return false;
    setAnnouncement(`${names.get(next[to]) ?? next[to]} moved to position ${to + 1} of ${next.length}.`);
    change({ pageIds: next });
    return true;
  }

  async function save() {
    if (locked || !dirty || saving.current) return;
    const next = { heading: group.heading?.trim() || null, pageIds: selected };
    saving.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await call('updateEventConfig', { event: { footerPageGroup: next } });
      setSaved({ base: stored, group: next });
      setDraft(null);
      setFeedback({ tone: 'ok', message: 'Footer pages saved.' });
    } catch (error) {
      setFeedback({ tone: 'error', message: error.message });
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <Panel title="Footer pages">
      <div className="flex flex-col gap-sm">
        <TextField label="Group heading" value={group.heading ?? ''} placeholder="Site pages"
          help="Leave blank to use Site pages."
          disabled={locked} onChange={(heading) => change({ heading })} />
        <CheckboxField label="Choose which pages appear" checked={selected !== null} disabled={locked}
          help="With this off, the footer follows the order of your public pages."
          onChange={(checked) => change({ pageIds: checked ? picks.map(({ id }) => id) : null })} />
        {selected ? (
          <>
            <SelectField label="Add a page" value="" disabled={locked}
              help="Choose a published page to add at the end of the list."
              options={[{ value: '', label: 'Select a page' }, ...picks
                .filter(({ id }) => !selected.includes(id))
                .map(({ id, item }) => ({ value: id, label: item.label }))]}
              onChange={(id) => { if (id) change({ pageIds: [...selected, id] }); }} />
            <OrderAnnouncement message={announcement} />
            {selected.length ? (
              <ol className="divide-y divide-admin-rule-hairline">
                {selected.map((id, index) => {
                  const label = names.get(id) ?? id;
                  return (
                    <li key={id} className="flex flex-wrap items-center justify-between gap-xs py-2xs"
                      {...bindReorderDrop('footer-pages:', index, move)}>
                      <span className="break-words">{label}{names.has(id) ? null : ' (unavailable)'}</span>
                      <div className="flex items-center gap-xs">
                        <ReorderControls label={label} index={index} count={selected.length}
                          dragToken={`footer-pages:${index}`} onMove={move} disabled={locked} />
                        <button type="button" className={linkButtonClass} disabled={locked}
                          aria-label={`Remove ${label}`} onClick={() => change({ pageIds: selected.filter((item) => item !== id) })}>
                          Remove
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </>
        ) : null}
        <div className="flex flex-wrap items-center gap-xs">
          <button type="button" className={primaryButtonClass} disabled={locked || !dirty} onClick={save}>
            {busy ? 'Saving…' : 'Save footer pages'}
          </button>
          {dirty ? <button type="button" className={linkButtonClass} disabled={busy}
            onClick={() => { setDraft(null); setAnnouncement(''); setFeedback(null); }}>Cancel</button> : null}
        </div>
        {feedback ? <ActionFeedback {...feedback} /> : null}
      </div>
    </Panel>
  );
}
