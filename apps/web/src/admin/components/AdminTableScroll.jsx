import { useLayoutEffect, useRef } from 'react';

/** A table's own scroll box must leave room for its wrapped sticky head. */
export default function AdminTableScroll({ children, className = '', ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const box = ref.current;
    const head = box?.querySelector('thead');
    if (!head) return undefined;
    function measure() {
      box.style.setProperty('--admin-table-head-height', `${head.getBoundingClientRect().height}px`);
    }
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(head);
    return () => observer?.disconnect();
  }, [children]);
  return <div {...props} ref={ref} className={`admin-table-scroll relative ${className}`}>{children}</div>;
}
