import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export function hasHorizontalOverflow(node) {
  return Boolean(node) && node.scrollWidth > node.clientWidth;
}

export default function HorizontalScrollRegion({
  label,
  className = '',
  children,
  ...props
}) {
  const regionRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    const next = hasHorizontalOverflow(regionRef.current);
    setOverflowing((current) => (current === next ? current : next));
  }, []);

  // Content can change without replacing this component. Measure after each
  // render, then keep the answer current as layout and descendants change.
  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    const node = regionRef.current;
    if (!node) return undefined;

    const ResizeObserverType = globalThis.ResizeObserver;
    const resizeObserver =
      typeof ResizeObserverType === 'function' ? new ResizeObserverType(measure) : null;
    const observeContent = () => {
      resizeObserver?.observe(node);
      if (node.firstElementChild) resizeObserver?.observe(node.firstElementChild);
    };
    observeContent();

    const MutationObserverType = globalThis.MutationObserver;
    const mutationObserver =
      typeof MutationObserverType === 'function'
        ? new MutationObserverType(() => {
            observeContent();
            measure();
          })
        : null;
    mutationObserver?.observe(node, {
      characterData: true,
      childList: true,
      subtree: true,
    });

    const view = typeof window === 'undefined' ? null : window;
    view?.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      view?.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <div
      {...props}
      ref={regionRef}
      className={['horizontal-scroll-region', className].filter(Boolean).join(' ')}
      data-scroll-label={label}
      tabIndex={overflowing ? 0 : undefined}
      role={overflowing ? 'region' : undefined}
      aria-label={overflowing ? label : undefined}
    >
      {children}
    </div>
  );
}
