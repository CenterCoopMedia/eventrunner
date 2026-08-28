(function attachScrollRegions(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.installScrollRegions(window);
})(function buildScrollRegions() {
  function text(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function contextualLabel(node) {
    const caption = node.querySelector?.('caption');
    if (text(caption?.textContent)) return text(caption.textContent);

    let sibling = node.previousElementSibling;
    while (sibling) {
      if (/^H[2-6]$/.test(sibling.tagName) && text(sibling.textContent)) {
        return text(sibling.textContent);
      }
      sibling = sibling.previousElementSibling;
    }
    return text(node.getAttribute('data-scroll-label')) || 'Scrollable content';
  }

  function updateScrollRegion(node) {
    const overflowing = Number(node.scrollWidth) > Number(node.clientWidth);
    if (overflowing) {
      node.setAttribute('tabindex', '0');
      node.setAttribute('role', 'region');
      if (!node.hasAttribute('aria-label') && !node.hasAttribute('aria-labelledby')) {
        node.setAttribute('aria-label', contextualLabel(node));
        node.setAttribute('data-scroll-generated-label', 'true');
      }
    } else {
      node.removeAttribute('tabindex');
      node.removeAttribute('role');
      if (node.getAttribute('data-scroll-generated-label') === 'true') {
        node.removeAttribute('aria-label');
        node.removeAttribute('data-scroll-generated-label');
      }
    }
    return overflowing;
  }

  function observeScrollRegion(node, view) {
    const refresh = () => updateScrollRegion(node);
    const ResizeObserverType = view.ResizeObserver;
    const resizeObserver =
      typeof ResizeObserverType === 'function' ? new ResizeObserverType(refresh) : null;
    const observeContent = () => {
      resizeObserver?.observe(node);
      if (node.firstElementChild) resizeObserver?.observe(node.firstElementChild);
    };
    observeContent();

    const MutationObserverType = view.MutationObserver;
    const mutationObserver =
      typeof MutationObserverType === 'function'
        ? new MutationObserverType(() => {
            observeContent();
            refresh();
          })
        : null;
    mutationObserver?.observe(node, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    view.addEventListener?.('resize', refresh);
    refresh();

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      view.removeEventListener?.('resize', refresh);
    };
  }

  function installScrollRegions(view) {
    const document = view.document;
    let disposers = [];
    const start = () => {
      disposers = [...document.querySelectorAll('[data-scroll-region]')].map((node) =>
        observeScrollRegion(node, view),
      );
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
    return () => {
      document.removeEventListener?.('DOMContentLoaded', start);
      for (const dispose of disposers) dispose();
      disposers = [];
    };
  }

  return { contextualLabel, installScrollRegions, observeScrollRegion, updateScrollRegion };
});
