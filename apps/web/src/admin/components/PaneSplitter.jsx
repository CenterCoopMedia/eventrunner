// A bar between two side-by-side panes that changes their widths (issue
// #477). It follows the WAI-ARIA window splitter pattern: a focusable
// `separator` with a vertical orientation and a value, the leading pane's
// whole percent of the row.
//
// THE KEYBOARD PATH. Tab reaches the bar. The Left and Right arrow keys move
// it by a step (Shift for a larger step), Home and End go to the limits, and
// Enter puts it back at its default. In a right-to-left page the arrows
// follow the bar on screen, so Left always moves it left.
//
// THE POINTER PATH. Drag the bar, or double-click it to put it back. The bar
// is a 24px target, the WCAG minimum, and its grip shows on hover and on
// focus, never by colour alone: the grip also widens.
//
// It only ever changes how wide the panes are. It never changes what they
// hold, so a draft, a scroll position or a frame's own CSS width stays as it
// was. The limits keep each pane usable; the caller stacks the panes on a
// screen too narrow for both.
import { useId, useRef } from 'react';

/** The arrow-key step and the Shift step, in percent of the row. */
export const SPLIT_STEP = 5;
export const SPLIT_LARGE_STEP = 10;

/** The bar's width in pixels: the 24px minimum target (WCAG 2.5.8). */
export const SPLITTER_WIDTH = 24;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The value a key press moves the bar to, or null for a key the bar does not
 * answer.
 *
 * @param {{ key: string, shiftKey?: boolean }} event
 * @param {number} value the leading pane's percent now
 * @param {{ min: number, max: number, defaultValue: number, rtl?: boolean }} limits
 * @returns {number|null}
 */
export function splitForKey(event, value, { min, max, defaultValue, rtl = false }) {
  const step = event.shiftKey ? SPLIT_LARGE_STEP : SPLIT_STEP;
  // In a right-to-left row the leading pane is on the right, so moving the
  // bar left makes it wider.
  const towardLeft = rtl ? step : -step;
  switch (event.key) {
    case 'ArrowLeft':
      return clamp(value + towardLeft, min, max);
    case 'ArrowRight':
      return clamp(value - towardLeft, min, max);
    case 'Home':
      return min;
    case 'End':
      return max;
    case 'Enter':
      return defaultValue;
    default:
      return null;
  }
}

/**
 * The value a pointer at `clientX` sets, from the row's box.
 *
 * @param {number} clientX
 * @param {{ left: number, right: number, width: number }} box the row
 * @param {{ min: number, max: number, rtl?: boolean }} limits
 * @returns {number}
 */
export function splitForPointer(clientX, box, { min, max, rtl = false }) {
  if (!box.width) return min;
  const leading = rtl ? box.right - clientX : clientX - box.left;
  return clamp(Math.round((leading / box.width) * 100), min, max);
}

function isRtl(element) {
  if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return false;
  }
  return window.getComputedStyle(element).direction === 'rtl';
}

/**
 * @param {{
 *   id?: string,
 *   label: string,         // what the bar resizes, e.g. "Resize the editor and the preview"
 *   valueText: string,     // the split in words, e.g. "Editor 50%, preview 50%"
 *   value: number,
 *   min: number,
 *   max: number,
 *   defaultValue: number,
 *   onChange: (value: number) => void,
 *   controls?: string,     // the id of the leading pane
 *   className?: string,
 * }} props
 */
export default function PaneSplitter({
  id,
  label,
  valueText,
  value,
  min,
  max,
  defaultValue,
  onChange,
  controls,
  className = '',
}) {
  const hintId = useId();
  const barRef = useRef(null);
  const dragging = useRef(false);

  const row = () => barRef.current?.parentElement ?? null;

  const moveTo = (clientX) => {
    const element = row();
    if (!element) return;
    const next = splitForPointer(clientX, element.getBoundingClientRect(), {
      min,
      max,
      rtl: isRtl(element),
    });
    if (next !== value) onChange(next);
  };

  return (
    <div
      ref={barRef}
      id={id}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={valueText}
      aria-controls={controls}
      aria-describedby={hintId}
      title="Drag to resize. Double-click to reset."
      className={`admin-splitter ${className}`.trim()}
      onKeyDown={(event) => {
        const next = splitForKey(event, value, { min, max, defaultValue, rtl: isRtl(row()) });
        if (next === null) return;
        event.preventDefault();
        if (next !== value) onChange(next);
      }}
      onDoubleClick={() => {
        if (value !== defaultValue) onChange(defaultValue);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.focus();
      }}
      onPointerMove={(event) => {
        if (dragging.current) moveTo(event.clientX);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    >
      <span className="admin-splitter__grip" aria-hidden="true" />
      <span id={hintId} className="sr-only">
        Use the Left and Right arrow keys to resize. Home and End go to the limits. Enter resets.
      </span>
    </div>
  );
}
