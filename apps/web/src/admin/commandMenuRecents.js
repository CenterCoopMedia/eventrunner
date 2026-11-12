import { createContext, useContext, useEffect, useRef } from 'react';

// Only the six publishable collections' existing editors belong in recents.
// Account records, list pages and unsaved new records never do.
const EDITOR = /^\/admin\/(?:pages\/(?!new(?:\/|$))[^/?#]+|(?:sessions|organizations|updates|timeline)\/[^/?#]+|content\/[^/?#]+\/[^/?#]+\/(?!_new(?:\/|$))[^/?#]+)$/i;
const LIMIT = 10;
const memory = new Map();
export const CommandMenuAccount = createContext(null);

function valid(record) {
  return typeof record?.to === 'string' && EDITOR.test(record.to)
    && typeof record.label === 'string' && record.label.trim().length > 0;
}

const keyFor = (uid) => `eventrunner.adminCommands:${encodeURIComponent(uid)}`;

export function readCommandRecents(uid) {
  if (!uid) return [];
  if (memory.has(uid)) return memory.get(uid);
  try {
    const stored = JSON.parse(window.localStorage.getItem(keyFor(uid)) ?? '[]');
    return Array.isArray(stored) ? stored.filter(valid).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberCommandRecord(uid, record) {
  if (!uid || !valid(record)) return;
  const previous = readCommandRecents(uid);
  if (previous[0]?.to === record.to && previous[0]?.label === record.label) return;
  const next = [{ to: record.to, label: record.label }, ...previous.filter((item) => item.to !== record.to)].slice(0, LIMIT);
  memory.set(uid, next);
  try {
    window.localStorage.setItem(keyFor(uid), JSON.stringify(next));
  } catch {
    // A refusing store still keeps this account's recents for this tab.
  }
}

/** Remember the title adopted on this editor visit, never an unsaved edit. */
export function useCommandRecent(label) {
  const account = useContext(CommandMenuAccount);
  const uid = account?.uid;
  const to = account?.pathname;
  const adoptedLabel = useRef(label);
  useEffect(() => {
    rememberCommandRecord(uid, { to, label: adoptedLabel.current });
  }, [uid, to]);
}
