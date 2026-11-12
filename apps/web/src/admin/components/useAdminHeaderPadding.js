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
    let focusFrame;
    function keepFocusVisible() {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!header.parentElement?.contains(active) || header.contains(active) || active.closest('dialog[open]')
            || getComputedStyle(header).position !== 'sticky') return;
        const box = active.getBoundingClientRect();
        const boundary = header.getBoundingClientRect().bottom;
        // Native textarea focus can reveal its caret behind the sticky band.
        // Align the control after the browser finishes its own focus scroll.
        if (box.height > 0 && box.height <= window.innerHeight - boundary && box.top < boundary) {
          active.scrollIntoView?.({ block: 'start', behavior: 'instant' });
        }
      });
    }
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
    document.addEventListener('focusin', keepFocusVisible);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('resize', measure);
      document.removeEventListener('focusin', keepFocusVisible);
      if (previous) root.style.setProperty(property, previous);
      else root.style.removeProperty(property);
    };
  }, []);
  return ref;
}
