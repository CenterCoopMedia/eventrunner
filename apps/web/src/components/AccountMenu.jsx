import { useEffect, useRef, useState } from 'react';
import RoleSwitcher from './RoleSwitcher.jsx';
import { quietActionClass } from './controlClasses.js';

const PHONE_VIEWPORT = '(max-width: 767px)';

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
    if (dialog.current?.open) dialog.current.close();
    trigger.current?.focus();
  };

  useEffect(() => {
    if (!phone || !open) return undefined;
    const sheet = dialog.current;
    const previousOverflow = document.documentElement.style.overflow;
    sheet.showModal();
    document.documentElement.style.overflow = 'hidden';
    return () => {
      if (sheet.open) sheet.close();
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [phone, open]);

  if (phone) {
    return (
      <>
        <button ref={trigger} type="button" className={quietActionClass} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>Account</button>
        <dialog ref={dialog} aria-label="Account" className="public-dialog site-account-sheet" onCancel={(event) => { event.preventDefault(); close(); }}>
          <div className="sticky top-0 flex items-center justify-between gap-sm bg-surface pb-sm">
            <h2 className="font-heading text-h3">Your account</h2>
            <button type="button" className={quietActionClass} onClick={close}>Close</button>
          </div>
          <RoleSwitcher account={account} onNavigate={close} />
        </dialog>
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
