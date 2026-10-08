import { useEffect, useId, useState } from 'react';

/** Mounted fields keep their draft values; a server error reveals its section. */
export default function EditorDisclosure({ title, description, children, defaultOpen = false, reveal = false, headingLevel = 'h3', className = '' }) {
  const [open, setOpen] = useState(defaultOpen || reveal);
  const contentId = useId();
  const Heading = headingLevel;
  useEffect(() => {
    if (reveal) setOpen(true);
  }, [reveal]);
  return (
    <div className={`admin-editor-disclosure ${className}`}>
      <Heading>
        <button type="button" className="admin-editor-disclosure__toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((value) => !value)}>
          <span className="admin-editor-disclosure__label"><span>{title}</span>{description ? <span className="admin-editor-disclosure__description">{description}</span> : null}</span>
          <span className="admin-editor-disclosure__indicator" aria-hidden="true">{open ? '−' : '+'}</span>
        </button>
      </Heading>
      <div id={contentId} hidden={!open} className="admin-editor-disclosure__content">{children}</div>
    </div>
  );
}
