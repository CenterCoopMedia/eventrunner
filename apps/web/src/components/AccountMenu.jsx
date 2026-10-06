import { useEffect, useRef, useState } from 'react';
import RoleSwitcher from './RoleSwitcher.jsx';
import { quietActionClass } from './controlClasses.js';

const PHONE_VIEWPORT = '(max-width: 767px)';

function closeSheet(sheet) {
  if (typeof sheet?.close === 'function') sheet.close();
  else sheet?.removeAttribute('open');
}

export default function AccountMenu({ account }) {
  const menu = useRef(null);
  const trigger = useRef(null);
  const dialog = useRef(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState(() => window.matchMedia?.(PHONE_VIEWPORT).matches ?? false);

  useEffect(() => {
    const query = window.matchMedia?.(PHONE_VIEWPORT);
    if (!query) return undefined;
    const update = () => setPhone(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const close = () => {
    setOpen(false);
    if (menu.current) menu.current.open = false;
    closeSheet(dialog.current);
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!phone || !open) return undefined;
    const sheet = dialog.current;
    const previousOverflow = document.documentElement.style.overflow;
    // Older WebViews need the focus behavior that showModal normally supplies.
    const containFocus = (event) => {
      if (!sheet.contains(event.target)) sheet.querySelector('button')?.focus();
    };
    const wrapFocus = (event) => {
      if (event.key !== 'Tab') return;
      const controls = sheet.querySelectorAll('button, a[href]');
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else {
      sheet.setAttribute('open', '');
      document.addEventListener('focusin', containFocus);
      sheet.addEventListener('keydown', wrapFocus);
      sheet.querySelector('button')?.focus();
    }
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('focusin', containFocus);
      sheet.removeEventListener('keydown', wrapFocus);
      closeSheet(sheet);
      document.documentElement.style.overflow = previousOverflow;
      trigger.current?.focus();
    };
  }, [phone, open]);

  if (phone) {
    return (
      <>
        <button ref={trigger} type="button" className={quietActionClass} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>Account</button>
        {open && <dialog ref={dialog} aria-label="Account" aria-modal="true" className="public-dialog site-account-sheet" onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); close(); }
        }}>
          <div className="sticky top-0 flex items-center justify-between gap-sm bg-surface pb-sm">
            <h2 className="font-heading text-h3">Your account</h2>
            <button type="button" className={quietActionClass} onClick={close}>Close</button>
          </div>
          <RoleSwitcher account={account} onNavigate={close} />
        </dialog>}
      </>
    );
  }

  return (
    <details ref={menu} open={open} className="site-account-menu" onToggle={(event) => setOpen(event.currentTarget.open)} onKeyDown={(event) => {
      if (event.key === 'Escape') close();
    }}>
      <summary ref={trigger} className={`${quietActionClass} cursor-pointer`}>Account</summary>
      <div className="site-account-menu__content">
        <RoleSwitcher account={account} onNavigate={close} />
      </div>
    </details>
  );
}
