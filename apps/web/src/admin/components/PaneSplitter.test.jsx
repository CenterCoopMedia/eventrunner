import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import PaneSplitter, {
  SPLIT_LARGE_STEP,
  SPLIT_STEP,
  splitForKey,
  splitForPointer,
} from './PaneSplitter.jsx';

const LIMITS = { min: 30, max: 70, defaultValue: 50 };

// jsdom has no PointerEvent, so a fired pointer event would carry no button
// or position. A MouseEvent carries both, which is all the bar reads.
if (typeof window.PointerEvent !== 'function') {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  };
}

function Harness({ initial = 50, onChange = () => {} }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <div id="leading-pane" />
      <PaneSplitter
        label="Resize the panes"
        valueText={`Leading ${value}%`}
        value={value}
        {...LIMITS}
        controls="leading-pane"
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    </div>
  );
}

describe('splitForKey', () => {
  it('moves by a step on the arrows and a larger step with Shift', () => {
    expect(splitForKey({ key: 'ArrowLeft' }, 50, LIMITS)).toBe(50 - SPLIT_STEP);
    expect(splitForKey({ key: 'ArrowRight' }, 50, LIMITS)).toBe(50 + SPLIT_STEP);
    expect(splitForKey({ key: 'ArrowRight', shiftKey: true }, 50, LIMITS)).toBe(50 + SPLIT_LARGE_STEP);
  });

  it('stops at the limits, jumps there on Home and End, and resets on Enter', () => {
    expect(splitForKey({ key: 'ArrowLeft' }, 32, LIMITS)).toBe(30);
    expect(splitForKey({ key: 'ArrowRight', shiftKey: true }, 66, LIMITS)).toBe(70);
    expect(splitForKey({ key: 'Home' }, 50, LIMITS)).toBe(30);
    expect(splitForKey({ key: 'End' }, 50, LIMITS)).toBe(70);
    expect(splitForKey({ key: 'Enter' }, 65, LIMITS)).toBe(50);
    expect(splitForKey({ key: 'a' }, 50, LIMITS)).toBeNull();
    expect(splitForKey({ key: 'ArrowUp' }, 50, LIMITS)).toBeNull();
  });

  it('follows the bar on screen in a right-to-left row', () => {
    const rtl = { ...LIMITS, rtl: true };
    expect(splitForKey({ key: 'ArrowLeft' }, 50, rtl)).toBe(50 + SPLIT_STEP);
    expect(splitForKey({ key: 'ArrowRight' }, 50, rtl)).toBe(50 - SPLIT_STEP);
  });
});

describe('splitForPointer', () => {
  const box = { left: 100, right: 1100, width: 1000 };

  it('reads the leading pane share from the pointer and keeps it inside the limits', () => {
    expect(splitForPointer(500, box, LIMITS)).toBe(40);
    expect(splitForPointer(120, box, LIMITS)).toBe(30);
    expect(splitForPointer(1090, box, LIMITS)).toBe(70);
    expect(splitForPointer(500, box, { ...LIMITS, rtl: true })).toBe(60);
  });
});

describe('PaneSplitter', () => {
  it('is a focusable vertical separator that states its value and limits', () => {
    render(<Harness />);
    const bar = screen.getByRole('separator', { name: 'Resize the panes' });
    expect(bar).toHaveAttribute('tabindex', '0');
    expect(bar).toHaveAttribute('aria-orientation', 'vertical');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveAttribute('aria-valuemin', '30');
    expect(bar).toHaveAttribute('aria-valuemax', '70');
    expect(bar).toHaveAttribute('aria-valuetext', 'Leading 50%');
    expect(bar).toHaveAttribute('aria-controls', 'leading-pane');
    expect(bar).toHaveAccessibleDescription(/arrow keys/);
  });

  it('moves with the keyboard, holds the limits, and resets on Enter', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const bar = screen.getByRole('separator');
    bar.focus();
    fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(bar).toHaveAttribute('aria-valuenow', '55');
    fireEvent.keyDown(bar, { key: 'ArrowLeft', shiftKey: true });
    expect(bar).toHaveAttribute('aria-valuenow', '45');
    fireEvent.keyDown(bar, { key: 'Home' });
    expect(bar).toHaveAttribute('aria-valuenow', '30');
    onChange.mockClear();
    // At the limit a further step changes nothing and reports nothing.
    fireEvent.keyDown(bar, { key: 'ArrowLeft' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(bar, { key: 'End' });
    expect(bar).toHaveAttribute('aria-valuenow', '70');
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    expect(bar).toHaveFocus();
  });

  it('leaves other keys to the page', () => {
    render(<Harness />);
    const bar = screen.getByRole('separator');
    const tab = fireEvent.keyDown(bar, { key: 'Tab' });
    expect(tab).toBe(true);
    const arrow = fireEvent.keyDown(bar, { key: 'ArrowRight' });
    expect(arrow).toBe(false);
  });

  it('follows a drag and resets on double-click', () => {
    render(<Harness />);
    const bar = screen.getByRole('separator');
    bar.parentElement.getBoundingClientRect = () => ({ left: 0, right: 1000, width: 1000, top: 0, bottom: 10, height: 10 });
    fireEvent.pointerDown(bar, { button: 0, pointerId: 1, clientX: 500 });
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 620 });
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    fireEvent.pointerUp(bar, { pointerId: 1, clientX: 620 });
    // After the release, a move is not a drag.
    fireEvent.pointerMove(bar, { pointerId: 1, clientX: 400 });
    expect(bar).toHaveAttribute('aria-valuenow', '62');
    expect(bar).toHaveFocus();
    fireEvent.doubleClick(bar);
    expect(bar).toHaveAttribute('aria-valuenow', '50');
  });
});
