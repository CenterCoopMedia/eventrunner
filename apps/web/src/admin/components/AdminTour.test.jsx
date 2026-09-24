// The editor tour (issue #198): steps from the docket the tier can reach, a
// keyboard path from the first step to the last, and an escape at every step.
//
// jsdom moves no focus on Tab and turns no Enter into a click, so `tab()`
// below moves the focus to the next control in document order, as a browser
// does, and `enter()` presses Enter on the focused control and then does what
// a browser does for a native button. The tour is walked with nothing else.
// The same walk runs in a real browser in e2e/cms-publish.spec.js.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DOCKET, docketForTier, listWords } from '../AdminLayout.jsx';
import AdminTour, { TOUR_GROUP_COPY, tourSteps } from './AdminTour.jsx';

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex="0"]';

function tab() {
  const current = document.activeElement;
  const next = [...document.querySelectorAll(TABBABLE)].find(
    (element) =>
      element !== current &&
      Boolean(current.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  if (!next) throw new Error('Tab reached the end of the document');
  next.focus();
  return next;
}

function enter() {
  const target = document.activeElement;
  const proceed = fireEvent.keyDown(target, { key: 'Enter' });
  if (proceed && target.tagName === 'BUTTON' && !target.disabled) fireEvent.click(target);
  fireEvent.keyUp(target, { key: 'Enter' });
}

/** Tab forward until the focused control is Next or Finish tour. */
function tabToForward() {
  for (let presses = 0; presses < 10; presses += 1) {
    const focused = tab();
    if (focused.textContent === 'Next' || focused.textContent === 'Finish tour') return focused;
  }
  throw new Error('No Next or Finish tour control within ten presses of Tab');
}

function renderTour({ tier = 'operator', takeFocus = true } = {}) {
  const onEnd = vi.fn();
  const view = render(<AdminTour docket={docketForTier(tier)} takeFocus={takeFocus} onEnd={onEnd} />);
  return { ...view, onEnd };
}

describe('tourSteps', () => {
  it('opens with a welcome, takes one step per group an operator reaches, and ends on the site', () => {
    const steps = tourSteps(docketForTier('operator'));
    expect(steps.map((step) => step.heading)).toEqual([
      'Welcome to the admin panel',
      // The lead group has no label, so it takes its first item's.
      'Overview',
      'Content',
      'People',
      'Operations',
      'System',
      'Edit from the site',
    ]);
    expect(steps.find((step) => step.id === 'system').items).toEqual(
      DOCKET.find((group) => group.id === 'system').items.map((item) => item.label),
    );
  });

  it('names no operator section to a staff admin', () => {
    const steps = tourSteps(docketForTier('staff'));
    const named = steps.flatMap((step) => step.items ?? []);
    for (const operatorOnly of ['Features', 'Branding', 'Access', 'System errors']) {
      expect(named).not.toContain(operatorOnly);
    }
    expect(steps.find((step) => step.id === 'system').items).toEqual(['Event']);
  });

  it('has one copy line for every docket group, and none of them names a page', () => {
    const pageLabels = DOCKET.flatMap((group) => group.items.map((item) => item.label));
    for (const group of DOCKET) {
      const copy = TOUR_GROUP_COPY[group.id];
      expect(copy, `${group.id} has a copy line`).toMatch(/\.$/);
      for (const label of pageLabels) expect(copy).not.toContain(label);
    }
  });
});

describe('AdminTour', () => {
  it('can be walked from the first step to Finish tour with Tab and Enter alone', () => {
    const { onEnd } = renderTour();
    const headings = tourSteps(docketForTier('operator')).map((step) => step.heading);

    for (const [index, heading] of headings.entries()) {
      // Each step's heading takes the focus, and the step line under it
      // describes it.
      const focused = document.activeElement;
      expect(focused).toBe(screen.getByRole('heading', { level: 2, name: heading }));
      expect(focused).toHaveAccessibleDescription(`Step ${index + 1} of ${headings.length}`);
      const forward = tabToForward();
      expect(forward).toHaveTextContent(index === headings.length - 1 ? 'Finish tour' : 'Next');
      enter();
    }
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('goes back a step with Back, and Back is off on the first step', () => {
    renderTour();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(document.activeElement).toHaveTextContent('Overview');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(document.activeElement).toHaveTextContent('Welcome to the admin panel');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });

  it('ends on Escape at every step, from wherever the focus is inside it', () => {
    const count = tourSteps(docketForTier('operator')).length;
    for (let step = 0; step < count; step += 1) {
      const { onEnd, unmount } = renderTour();
      for (let moved = 0; moved < step; moved += 1) {
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));
      }
      expect(screen.getByText(`Step ${step + 1} of ${count}`)).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole('button', { name: 'End tour' }), { key: 'Escape' });
      expect(onEnd).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  it('ends with End tour on any step (Finish tour is the walk above)', () => {
    const { onEnd } = renderTour();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'End tour' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('sets the step line under the heading, never above it', () => {
    renderTour();
    const heading = screen.getByRole('heading', { level: 2, name: 'Welcome to the admin panel' });
    const stepLine = screen.getByText('Step 1 of 7');
    expect(heading.getAttribute('aria-describedby')).toBe(stepLine.id);
    expect(heading.compareDocumentPosition(stepLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names the three record states in words on the first step', () => {
    renderTour();
    for (const word of ['Draft', 'Live', 'Live with unpublished changes']) {
      expect(screen.getByText(word, { selector: '[data-record-state]' })).toBeInTheDocument();
    }
  });

  it('lists the sections a group step holds, in the rail’s words', () => {
    renderTour({ tier: 'staff' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Content' })).toBeInTheDocument();
    // Read from the docket, so a page a later branch adds to the group joins
    // the sentence. The rail's first two Content pages open it.
    const content = docketForTier('staff').find((group) => group.label === 'Content');
    const labels = content.items.map((item) => item.label);
    expect(labels.slice(0, 2)).toEqual(['Pages', 'Sessions']);
    expect(screen.getByText(`In this group: ${listWords(labels)}.`)).toBeInTheDocument();
  });

  it('takes no focus when it opens on its own on a first visit', () => {
    renderTour({ takeFocus: false });
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to the admin panel' })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
  });
});
