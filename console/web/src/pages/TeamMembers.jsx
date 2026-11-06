import { useEffect, useRef, useState } from 'react';
import { ActionResult } from '../ActionFeedback.jsx';
import { ROLE_LABELS, formatDate, withArticle } from '../text.js';
import IconControl from '../IconControl.jsx';

/** Keep each result in its row, and keep a removed row's result in its place. */
export default function TeamMembers({ members, myUid, canEdit, onChange, outcome, pending, disabled, onRefresh, refreshing }) {
  const [confirming, setConfirming] = useState(null);
  const [refocus, setRefocus] = useState(null);
  const [removed, setRemoved] = useState(null);
  const removeButtons = useRef(new Map());
  const resultRef = useRef(null);

  useEffect(() => {
    if (refocus) {
      removeButtons.current.get(refocus)?.focus();
      setRefocus(null);
    }
  }, [refocus]);

  useEffect(() => {
    if (outcome?.kind === 'success' && removed?.uid === outcome.key) resultRef.current?.focus();
  }, [outcome, removed]);

  function cancel(uid) {
    setConfirming(null);
    setRefocus(uid);
  }

  async function remove(member, index) {
    setRemoved({ uid: member.uid, index });
    if (await onChange('removeMember', { uid: member.uid }, `${member.email} was removed from the team.`)) setConfirming(null);
  }

  const onlyOwner = members.filter((member) => member.role === 'owner').length === 1;
  const rows = members.map((member, index) => {
    const you = member.uid === myUid;
    const canChange = canEdit && !(onlyOwner && member.role === 'owner');
    const selectId = `role-${member.uid}`;
    const result = outcome?.key === member.uid ? outcome : null;
    return (
      <li key={member.uid} className="card console-feedback-row">
        <span className="card-title">{member.email}{you ? ' (you)' : ''}</span>
        <span className="muted">Joined {formatDate(member.joinedAt)}</span>
        {canChange ? (
          <div className="row-actions">
            <label htmlFor={selectId} className="visually-hidden">Role for {member.email}</label>
            <select id={selectId} value={member.role} disabled={disabled} onChange={(e) => {
              setRemoved(null);
              onChange('changeMemberRole', { uid: member.uid, role: e.target.value }, `${member.email} is now ${withArticle(e.target.value)}.`);
            }}>
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
            </select>
            {confirming === member.uid ? (
              <span className="confirm" role="group" aria-label={`Remove ${member.email}`}>
                <span>Remove {member.email} from the team?</span>
                <button type="button" className="button danger" disabled={disabled} onClick={() => remove(member, index)}>
                  {pending === member.uid ? 'Removing…' : 'Remove'}
                </button>
                <button type="button" className="button" disabled={Boolean(pending)} autoFocus onClick={() => cancel(member.uid)}>Cancel</button>
              </span>
            ) : (
              <IconControl icon="remove" disabled={disabled}
                ref={(node) => { if (node) removeButtons.current.set(member.uid, node); else removeButtons.current.delete(member.uid); }}
                label={`Remove ${member.email}`} onClick={() => setConfirming(member.uid)} />
            )}
            {pending === member.uid && confirming !== member.uid ? <span role="status">Saving role…</span> : null}
          </div>
        ) : <>
          <span className="tag">{ROLE_LABELS[member.role]}</span>
          {canEdit && onlyOwner && member.role === 'owner' ? <span className="hint">Add another owner to change this role or remove this member.</span> : null}
        </>}
        <ActionResult result={result} focusRef={result ? resultRef : undefined} onRefresh={onRefresh} refreshing={refreshing} refreshLabel="Refresh team" />
      </li>
    );
  });

  if (removed && outcome?.key === removed.uid && !members.some((member) => member.uid === removed.uid)) {
    rows.splice(Math.min(removed.index, rows.length), 0,
      <li key={`removed-${removed.uid}`} className="card console-feedback-row">
        <ActionResult result={outcome} focusRef={resultRef} onRefresh={onRefresh} refreshing={refreshing} refreshLabel="Refresh team" />
      </li>);
  }

  return <ul className="cards" aria-labelledby="members-title">{rows}</ul>;
}
