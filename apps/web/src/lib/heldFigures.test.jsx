import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import LoadingStatus from '../components/LoadingStatus.jsx';
import { installBusyControlFigures } from './busyControlFigures.js';

const flush = () => act(() => Promise.resolve());
const tick = (ms) => act(() => { vi.advanceTimersByTime(ms); });

describe('held-up figures', () => {
  let uninstall;
  let button;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button type="button" class="public-action">Apply code</button>';
    button = document.querySelector('button');
    uninstall = installBusyControlFigures(document.body);
  });

  afterEach(async () => {
    cleanup();
    document.querySelectorAll('[aria-busy]').forEach((element) => element.removeAttribute('aria-busy'));
    await flush();
    uninstall();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('marks a busy control at one, ten and sixty seconds', async () => {
    button.setAttribute('aria-busy', 'true');
    await flush();
    await tick(999);
    expect(button.hasAttribute('data-held-stage')).toBe(false);
    await tick(1);
    expect(button.getAttribute('data-held-stage')).toBe('active');
    await tick(9000);
    expect(button.getAttribute('data-held-stage')).toBe('slow');
    await tick(50000);
    expect(button.getAttribute('data-held-stage')).toBe('prolonged');
  });

  it('clears the figure when the control settles', async () => {
    button.setAttribute('aria-busy', 'true');
    await flush();
    await tick(1500);
    button.setAttribute('aria-busy', 'false');
    await flush();
    expect(button.hasAttribute('data-held-stage')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows nothing for a control that settles within one second', async () => {
    button.setAttribute('aria-busy', 'true');
    await flush();
    await tick(900);
    button.removeAttribute('aria-busy');
    await flush();
    await tick(60000);
    expect(button.hasAttribute('data-held-stage')).toBe(false);
  });

  it('times a control that arrives already busy, and ignores other busy elements', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<section aria-busy="true"></section><div><button type="button" class="public-text-control" aria-busy="true">Saving</button></div>',
    );
    await flush();
    await tick(1000);
    expect(document.querySelector('.public-text-control').getAttribute('data-held-stage')).toBe('active');
    expect(document.querySelector('section').hasAttribute('data-held-stage')).toBe(false);
  });

  it('gives the page one figure and hands it on when the owner ends', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button type="button" class="public-action">Load more</button>');
    const other = document.querySelectorAll('button')[1];
    await flush();
    button.setAttribute('aria-busy', 'true');
    other.setAttribute('aria-busy', 'true');
    await flush();
    await tick(1000);
    expect(button.getAttribute('data-held-stage')).toBe('active');
    expect(other.hasAttribute('data-held-stage')).toBe(false);
    button.removeAttribute('aria-busy');
    await flush();
    expect(other.getAttribute('data-held-stage')).toBe('active');
  });

  it('gives the figure to a route fallback when Suspense hides a busy control', async () => {
    button.setAttribute('aria-busy', 'true');
    await flush();
    await tick(1000);
    expect(button.getAttribute('data-held-stage')).toBe('active');
    // Suspense hides the old page but keeps its nodes connected.
    button.style.display = 'none';
    const fallback = render(<LoadingStatus label="Loading schedule…" stage="active" />);
    expect(fallback.container.querySelector('.held-figure__glyph')).not.toBeNull();
    expect(button.hasAttribute('data-held-stage')).toBe(false);
  });

  it('lets a waiting status and a busy control share one figure', async () => {
    const view = render(<LoadingStatus label="Loading tickets…" stage="active" />);
    button.setAttribute('aria-busy', 'true');
    await flush();
    await tick(1000);
    expect(view.container.querySelector('.held-figure__glyph')).not.toBeNull();
    expect(button.hasAttribute('data-held-stage')).toBe(false);
    view.unmount();
    expect(button.getAttribute('data-held-stage')).toBe('active');
  });

  it('draws one figure for two waiting statuses, and every still figure', async () => {
    const first = render(<LoadingStatus label="Loading the feed…" stage="active" />);
    const second = render(<LoadingStatus label="Loading the directory…" stage="active" />);
    const stills = render(<><LoadingStatus label="A" stage="slow" still /><LoadingStatus label="B" stage="prolonged" still /></>);
    expect(first.container.querySelectorAll('.held-figure__glyph')).toHaveLength(1);
    expect(second.container.querySelectorAll('.held-figure__glyph')).toHaveLength(0);
    expect(stills.container.querySelectorAll('.held-figure__glyph')).toHaveLength(2);
    first.unmount();
    expect(second.container.querySelectorAll('.held-figure__glyph')).toHaveLength(1);
  });

  it('gives the figure to a wait inside an open dialog', async () => {
    const page = render(<LoadingStatus label="Loading the schedule…" stage="active" />);
    document.body.insertAdjacentHTML('beforeend', '<dialog open><button type="button" class="public-action">Send</button></dialog>');
    const send = document.querySelector('dialog button');
    send.setAttribute('aria-busy', 'true');
    await flush();
    await tick(1000);
    expect(send.getAttribute('data-held-stage')).toBe('active');
    expect(page.container.querySelector('.held-figure__glyph')).toBeNull();
  });

  it('releases the figure when a busy control leaves the page', async () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="row"><button type="button" class="public-action" aria-busy="true">Saving</button></div>');
    await flush();
    await tick(1000);
    document.getElementById('row').remove();
    button.setAttribute('aria-busy', 'true');
    await flush();
    await tick(1000);
    expect(button.getAttribute('data-held-stage')).toBe('active');
  });
});
