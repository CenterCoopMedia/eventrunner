import { useLayoutEffect, useRef } from 'react';

/** Keep browser-driven focus and anchor scrolling clear of the title band. */
export default function useAdminHeaderPadding() {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return undefined;
    const root = document.documentElement;
    const property = '--admin-header-scroll-padding';
    const previous = root.style.getPropertyValue(property);
    function measure() {
      const height = header.getBoundingClientRect().height;
      // A tall band must leave at least half the viewport for the work.
      header.toggleAttribute('data-scrolls', height > window.innerHeight / 2);
      const sticky = getComputedStyle(header).position === 'sticky';
      root.style.setProperty(property, sticky ? `calc(${height}px + var(--space-xs))` : '0px');
    }
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(header);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      if (previous) root.style.setProperty(property, previous);
      else root.style.removeProperty(property);
    };
  }, []);
  return ref;
}
