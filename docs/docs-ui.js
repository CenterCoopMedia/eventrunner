(function attachGuideTools(factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && window.document) api.installGuideTools(window);
})(function buildGuideTools() {
  function normalizeSearch(value) {
    return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-–—]/g, ' ').trim();
  }

  function matchesGuide(text, query) {
    const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
    const searchable = normalizeSearch(text);
    return words.every((word) => searchable.includes(word));
  }

  function installGuideSearch(document) {
    const form = document.querySelector('[data-guide-search-form]');
    if (!form) return;
    const input = form.querySelector('input[type="search"]');
    const clear = form.querySelector('button[type="reset"]');
    const status = form.querySelector('[data-guide-search-status]');
    const starts = document.querySelector('[data-guide-starts]');
    const entries = [...document.querySelectorAll('[data-guide-entry]')];
    const sections = [...document.querySelectorAll('[data-guide-section]')];
    if (!input || !clear || !status || !entries.length) return;

    function filterGuides() {
      const query = input.value.trim();
      let count = 0;
      for (const entry of entries) {
        const match = matchesGuide(entry.getAttribute('data-guide-search'), query);
        entry.hidden = !match;
        if (match) count += 1;
      }
      for (const section of sections) {
        section.hidden = ![...section.querySelectorAll('[data-guide-entry]')].some((entry) => !entry.hidden);
      }
      clear.hidden = !query;
      if (starts) starts.hidden = Boolean(query);
      if (!query) {
        status.textContent = `Browse all ${entries.length} guides below.`;
      } else if (count) {
        status.textContent = `${count} ${count === 1 ? 'guide' : 'guides'} found.`;
      } else {
        status.textContent = 'No guides match. Try a shorter search or clear it.';
      }
    }

    input.addEventListener('input', filterGuides);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      filterGuides();
    });
    form.addEventListener('reset', () => {
      input.value = '';
      filterGuides();
      input.focus();
    });
    form.hidden = false;
    filterGuides();
  }

  function installGuideNavigation(view) {
    const disclosure = view.document.querySelector('[data-docs-navigation]');
    if (!disclosure || typeof view.matchMedia !== 'function') return;
    const narrow = view.matchMedia('(max-width: 56rem)');
    const update = () => {
      if (narrow.matches && disclosure.contains(view.document.activeElement)) {
        disclosure.querySelector('summary')?.focus();
      }
      disclosure.open = !narrow.matches;
    };
    update();
    narrow.addEventListener?.('change', update);
  }

  function installGuideTools(view) {
    const start = () => {
      installGuideSearch(view.document);
      installGuideNavigation(view);
    };
    if (view.document.readyState === 'loading') {
      view.document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  return { installGuideTools, matchesGuide, normalizeSearch };
});
