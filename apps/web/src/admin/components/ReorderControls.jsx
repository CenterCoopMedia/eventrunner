import { useEffect, useId, useRef, useState } from 'react';
import { secondaryButtonClass } from './formControls.jsx';
import { dragIndex } from '../reorder.js';

const quietMoveClass =
  'inline-flex min-h-11 min-w-11 min-h-admin-control items-center justify-center rounded-admin text-admin-ink hover:bg-admin-action-soft disabled:cursor-not-allowed disabled:opacity-60';

function GripMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="pointer-events-none">
      <circle cx="5" cy="3" r="1.3" fill="currentColor" />
      <circle cx="11" cy="3" r="1.3" fill="currentColor" />
      <circle cx="5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="11" cy="8" r="1.3" fill="currentColor" />
      <circle cx="5" cy="13" r="1.3" fill="currentColor" />
      <circle cx="11" cy="13" r="1.3" fill="currentColor" />
    </svg>
  );
}

function Chevron({ direction }) {
  const up = direction === 'up';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="pointer-events-none">
      <path
        d={up ? 'M3 10 L8 5 L13 10' : 'M3 6 L8 11 L13 6'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/** True when this pointer target may start a row drag. */
export function rowDragAllowed(origin) {
  if (!(origin instanceof Element)) return false;
  if (origin.closest('[data-reorder-grip]')) return true;
  if (origin.closest('[data-reorder-block]')) return false;
  return true;
}

/** Drag data for a whole row. The grip remains its own drag source. */
export function useRowDrag(token, disabled) {
  const originRef = useRef(null);
  return {
    draggable: !disabled,
    onPointerDown: (event) => {
      originRef.current = event.target;
    },
    onDragStart: (event) => {
      if (disabled || !rowDragAllowed(originRef.current)) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', token);
    },
  };
}

/**
 * Compact grip plus Up and Down. Up and Down stay available without a drag.
 * Enter on the grip starts a move. Arrows change position. Enter keeps it.
 * Escape returns the row to the position where the move started.
 * The parent announces the new position.
 */
export function ReorderControls({
  label,
  index,
  count,
  dragToken,
  onMove,
  disabled = false,
  upLabel,
  downLabel,
  dragLabel,
}) {
  const hintId = useId();
  const [moving, setMoving] = useState(false);
  const startRef = useRef(null);

  useEffect(() => {
    if (disabled && moving) setMoving(false);
  }, [disabled, moving]);

  function begin(event) {
    event.preventDefault();
    startRef.current = index;
    setMoving(true);
  }

  function commit(event) {
    event.preventDefault();
    startRef.current = null;
    setMoving(false);
  }

  function cancel(event) {
    event.preventDefault();
    const start = startRef.current;
    startRef.current = null;
    setMoving(false);
    if (start !== null && start !== index) onMove(index, start);
  }

  function step(event, to) {
    event.preventDefault();
    if (to < 0 || to >= count || to === index) return;
    onMove(index, to);
  }

  function onGripKeyDown(event) {
    if (disabled) return;
    if (!moving) {
      if (event.key === 'Enter' || event.key === ' ') begin(event);
      return;
    }
    if (event.key === 'ArrowUp') step(event, index - 1);
    else if (event.key === 'ArrowDown') step(event, index + 1);
    else if (event.key === 'Enter') commit(event);
    else if (event.key === 'Escape') cancel(event);
    else if (event.key === ' ') event.preventDefault();
  }

  return (
    <div className="flex flex-wrap items-center gap-2xs" data-reorder-block="">
      <button
        type="button"
        draggable={!disabled}
        data-reorder-grip=""
        className={moving ? `${quietMoveClass} bg-admin-action-soft` : quietMoveClass}
        aria-label={dragLabel ?? `Drag ${label}`}
        aria-pressed={moving}
        aria-describedby={hintId}
        title="Drag"
        disabled={disabled}
        onKeyDown={onGripKeyDown}
        onDragStart={(event) => {
          event.stopPropagation();
          event.dataTransfer.setData('text/plain', dragToken);
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        <GripMark />
      </button>
      <p id={hintId} className="sr-only">
        Enter starts a move. Arrow keys change the position. Enter keeps it. Escape cancels.
      </p>
      <button
        type="button"
        className={quietMoveClass}
        aria-label={upLabel ?? `Move ${label} up`}
        title="Move up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        <Chevron direction="up" />
      </button>
      <button
        type="button"
        className={quietMoveClass}
        aria-label={downLabel ?? `Move ${label} down`}
        title="Move down"
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        <Chevron direction="down" />
      </button>
    </div>
  );
}

/** Drop target for one row. A token from another list is ignored. */
export function bindReorderDrop(prefix, index, onMove) {
  return {
    onDragOver: (event) => {
      event.preventDefault();
    },
    onDrop: (event) => {
      const from = dragIndex(event.dataTransfer?.getData('text/plain'), prefix);
      if (from === null) return;
      event.preventDefault();
      event.stopPropagation();
      onMove(from, index);
    },
  };
}

export function OrderAnnouncement({ message }) {
  return (
    <p className="sr-only" aria-live="polite">
      {message}
    </p>
  );
}

export function OrderDraftButtons({ dirty, saving, onSave, onCancel, saveDisabled = false }) {
  if (!dirty && !saving) return null;
  return (
    <>
      <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      <button type="button" className={secondaryButtonClass} onClick={onSave} disabled={saving || saveDisabled}>
        {saving ? 'Saving…' : 'Save draft'}
      </button>
    </>
  );
}
