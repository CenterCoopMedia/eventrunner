import { useId, useState } from 'react';
import HelpTooltip from './HelpTooltip.jsx';

/** Keep disclosure help beside its label as a separate keyboard control. */
export default function HelpDisclosure({ title, help, children, defaultOpen = false, className = '', titleClassName = '' }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="flex items-center gap-2xs">
        <button type="button" className={`inline-flex min-w-0 items-center gap-2xs text-left ${titleClassName}`} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span>{title}</span>
        </button>
        <HelpTooltip label={title}>{help}</HelpTooltip>
      </div>
      <div id={contentId} hidden={!open}>{children}</div>
    </div>
  );
}
