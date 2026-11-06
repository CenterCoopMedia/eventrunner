/** Familiar utility actions use the same 20px stroke and a full control target. */
export default function AdminIcon({ name, className = '' }) {
  const paths = {
    close: <path d="m6 6 12 12M18 6 6 18" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    collapse: <path d="m14 6-6 6 6 6" />,
    expand: <path d="m10 6 6 6-6 6" />,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6" /></>,
    edit: <><path d="m15 4 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14v6Z" /></>,
    remove: <path d="M5 12h14" />,
    delete: <><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    content: <path d="M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h7M9 16h7" />,
    program: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 17h3" /></>,
    registration: <><path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4V5ZM15 5v3m0 3v2m0 3v3" /></>,
    communications: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></>,
    operations: <><path d="m4 7 2 2 4-4M12 7h8M4 16l2 2 4-4M12 16h8" /></>,
    settings: <><path d="M3 6h5m6 0h7M3 12h11m6 0h1M3 18h5m6 0h7" /><circle cx="11" cy="6" r="3" /><circle cx="17" cy="12" r="3" /><circle cx="11" cy="18" r="3" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.2 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18" /></>,
    report: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
    signOut: <><path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M10 12h10m-4-4 4 4-4 4" /></>,
  };
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
