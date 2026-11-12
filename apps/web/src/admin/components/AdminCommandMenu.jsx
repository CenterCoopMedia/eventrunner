import HelpTooltip from './HelpTooltip.jsx';
import { useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CommandMenuAccount, readCommandRecents } from '../commandMenuRecents.js';
import { fieldLabelClass, inputClass, secondaryButtonClass } from './formControls.jsx';
import useModalDialog, { wrapModalTab } from './useModalDialog.js';

export function commandShortcut(event, platform = navigator.platform) {
  if (event.key.toLowerCase() !== 'k' || event.altKey || event.shiftKey || event.isComposing) return false;
  return /Mac|iPhone|iPad|iPod/.test(platform)
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

/** An eager, native dialog over the existing docket, never an action runner. */
export default function AdminCommandMenu({ docket, onClose, returnFocusRef }) {
  const account = useContext(CommandMenuAccount);
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const id = useId();
  const listId = `${id}-options`;
  const labelId = `${id}-label`;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  useModalDialog(dialogRef, { initialFocusRef: inputRef, returnFocusRef });

  const options = useMemo(() => {
    const sections = docket.flatMap((group) => group.items.map((item) => ({
      to: `/admin/${item.to}`, label: item.label, detail: group.label ?? 'Sections',
    })));
    const allowed = new Set(docket.flatMap((group) => group.items.map((item) => item.to)));
    const recent = readCommandRecents(account?.uid)
      .filter((item) => allowed.has(item.to.split('/')[2].toLowerCase()))
      .map((item) => ({ ...item, detail: 'Recent record' }));
    const needle = query.trim().toLocaleLowerCase();
    return [...recent, ...sections].filter((item) => `${item.label} ${item.detail}`.toLocaleLowerCase().includes(needle));
  }, [account?.uid, docket, query]);
  const activeId = active >= 0 && active < options.length ? `${id}-option-${active}` : undefined;

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  useEffect(() => {
    // Window capture runs before the document-capture dirty-form guard.
    // The real anchor keeps its normal event; the guard is never bypassed.
    const closeBeforeLink = (event) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[role="option"]') : null;
      if (!anchor || !dialogRef.current?.contains(anchor)) return;
      dialogRef.current.close();
      onClose();
    };
    window.addEventListener('click', closeBeforeLink, true);
    return () => window.removeEventListener('click', closeBeforeLink, true);
  }, [onClose]);

  function onKeyDown(event) {
    const last = options.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive(Math.min(active + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive(active < 0 ? last : Math.max(active - 1, 0));
        break;
      case 'PageDown':
        event.preventDefault();
        setActive(Math.min(active + 10, last));
        break;
      case 'PageUp':
        event.preventDefault();
        setActive(Math.max(active - 10, 0));
        break;
      case 'Enter':
        event.preventDefault();
        if (activeId) {
          const anchor = document.getElementById(activeId);
          dialogRef.current.close();
          anchor.click();
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      default:
        break;
    }
  }

  return (
    <dialog ref={dialogRef} data-admin-command-menu className="admin-modal w-full max-w-xl rounded-admin-panel border-admin-strong border-admin-rule-strong bg-admin-ground-raised p-md font-admin-ui text-admin-base text-admin-ink"
      aria-labelledby={`${id}-title`} onKeyDown={wrapModalTab}
      style={{ animation: 'none', transition: 'none' }}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
      <div className="flex items-center justify-between gap-sm">
        <div className="flex items-center gap-2xs"><h2 id={`${id}-title`} className="text-admin-xl font-bold">Find work</h2><HelpTooltip label="Find work">Search for an admin page or a record and open it from these results.</HelpTooltip></div>
        <button type="button" className={secondaryButtonClass} onClick={onClose}>Close</button>
      </div>
      <label id={labelId} htmlFor={`${id}-search`} className={`${fieldLabelClass} mt-sm`}>Search sections and recent records</label>
      <input data-help-skip="Search field; its visible prompt names the search action." ref={inputRef} id={`${id}-search`} role="combobox" type="text" className={inputClass}
        value={query} autoComplete="off" spellCheck={false} aria-autocomplete="list"
        aria-expanded={options.length > 0} aria-controls={listId} aria-activedescendant={activeId}
        onKeyDown={onKeyDown} onChange={(event) => { setQuery(event.target.value); setActive(0); }} />
      <ul id={listId} role="listbox" aria-labelledby={labelId} className="mt-xs max-h-72 overflow-y-auto border-y-admin-hairline border-admin-rule-hairline">
        {options.map((item, index) => (
          <li key={item.to} role="presentation" className="border-b-admin-hairline border-admin-rule-hairline last:border-b-0">
            <Link id={`${id}-option-${index}`} to={item.to} role="option" tabIndex={-1} aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              className="flex min-h-admin-control flex-col justify-center gap-3xs px-sm py-xs text-admin-ink hover:bg-admin-ground-soft aria-selected:bg-admin-action-soft aria-selected:outline aria-selected:outline-2 aria-selected:-outline-offset-2 aria-selected:outline-admin-action">
              <span className="break-words font-semibold">{item.label}</span>
              <span className="text-admin-xs text-admin-ink-secondary">{item.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-xs text-admin-sm text-admin-ink-secondary">
        {options.length === 0 ? 'No matches. Try a section name or a recent record.' : `${options.length} ${options.length === 1 ? 'destination' : 'destinations'}.`}
      </p>
    </dialog>
  );
}
