import { useId, useState } from 'react';
import HelpTooltip from './HelpTooltip.jsx';

/** Mounted fields keep their draft values; a server error reveals its section. */
export default function EditorDisclosure({ title, description, help, children, defaultOpen = false, reveal = false, headingLevel = 'h3', className = '' }) {
  const [open, setOpen] = useState(defaultOpen || reveal);
  const [revealed, setRevealed] = useState(reveal);
  const contentId = useId();
  const Heading = headingLevel;
  // Open in the same render that brings the error, not one commit later in
  // an effect: no frame shows the error with its section shut. The reader
  // can still close it by hand while the error stands.
  if (reveal !== revealed) {
    setRevealed(reveal);
    if (reveal) setOpen(true);
  }
  return (
    <div className={`admin-editor-disclosure ${className}`} data-open={open}>
      <div className="flex items-center gap-2xs"><Heading className="min-w-0">
        <button type="button" className="admin-editor-disclosure__toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}>
          <span className="admin-editor-disclosure__label"><span>{title}</span>{description ? <span className="admin-editor-disclosure__description">{description}</span> : null}</span>
          <span className="admin-editor-disclosure__indicator" aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </Heading><HelpTooltip label={title}>{help}</HelpTooltip></div>
      <div id={contentId} hidden={!open} className="admin-editor-disclosure__content">{children}</div>
    </div>
  );
}
