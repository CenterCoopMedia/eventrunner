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
    let pointerDown = false;
    function pointerStarted() { pointerDown = true; }
    function pointerEnded() { pointerDown = false; }
    function keepFocusVisible() {
      cancelAnimationFrame(focusFrame);
      if (pointerDown) return;
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
    document.addEventListener('pointerdown', pointerStarted, true);
    document.addEventListener('pointerup', pointerEnded, true);
    document.addEventListener('pointercancel', pointerEnded, true);
    document.addEventListener('keydown', pointerEnded, true);
    document.addEventListener('focusin', keepFocusVisible);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(focusFrame);
      window.removeEventListener('resize', measure);
      document.removeEventListener('pointerdown', pointerStarted, true);
      document.removeEventListener('pointerup', pointerEnded, true);
      document.removeEventListener('pointercancel', pointerEnded, true);
      document.removeEventListener('keydown', pointerEnded, true);
      document.removeEventListener('focusin', keepFocusVisible);
      if (previous) root.style.setProperty(property, previous);
      else root.style.removeProperty(property);
    };
  }, []);
  return ref;
}
