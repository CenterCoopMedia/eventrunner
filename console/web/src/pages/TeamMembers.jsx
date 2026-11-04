import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS, formatDate, withArticle } from '../text.js';

/**
 * The member list. An Owner gets a role menu and a Remove button on each
 * row. Remove asks once, in the row, and Cancel returns the focus to the
 * Remove button.
 */
export default function TeamMembers({ members, myUid, canEdit, onChange }) {
  const [confirming, setConfirming] = useState(null);
  const [refocus, setRefocus] = useState(null);
  const removeButtons = useRef(new Map());

  // After Cancel, the Remove button is back in the row; move the focus to it.
  useEffect(() => {
    if (refocus) {
      removeButtons.current.get(refocus)?.focus();
      setRefocus(null);
    }
  }, [refocus]);

  function cancel(uid) {
    setConfirming(null);
    setRefocus(uid);
  }

  async function remove(member) {
    setConfirming(null);
    await onChange('removeMember', { uid: member.uid }, `${member.email} was removed from the team.`);
  }

  return (
    <ul className="cards" aria-labelledby="members-title">
      {members.map((member) => {
        const you = member.uid === myUid;
        const selectId = `role-${member.uid}`;
        return (
          <li key={member.uid} className="card">
            <span className="card-title">{member.email}{you ? ' (you)' : ''}</span>
            <span className="muted">Joined {formatDate(member.joinedAt)}</span>
            {canEdit ? (
              <div className="row-actions">
                <label htmlFor={selectId} className="visually-hidden">Role for {member.email}</label>
                <select
                  id={selectId}
                  value={member.role}
                  onChange={(e) => onChange(
                    'changeMemberRole',
                    { uid: member.uid, role: e.target.value },
                    `${member.email} is now ${withArticle(e.target.value)}.`,
                  )}
                >
                  <option value="owner">Owner</option>
                  <option value="editor">Editor</option>
                </select>
                {confirming === member.uid ? (
                  <span className="confirm" role="group" aria-label={`Remove ${member.email}`}>
                    <span>Remove {member.email} from the team?</span>
                    <button type="button" className="button danger" onClick={() => remove(member)}>Yes, remove</button>
                    {/* Cancel takes the focus: a second Enter keeps the member. */}
                    <button type="button" className="button" autoFocus onClick={() => cancel(member.uid)}>Cancel</button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="button"
                    ref={(node) => {
                      if (node) removeButtons.current.set(member.uid, node);
                      else removeButtons.current.delete(member.uid);
                    }}
                    aria-label={`Remove ${member.email}`}
                    onClick={() => setConfirming(member.uid)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ) : (
              <span className="tag">{ROLE_LABELS[member.role]}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
