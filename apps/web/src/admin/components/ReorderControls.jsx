import { secondaryButtonClass } from './formControls.jsx';
import { dragIndex } from '../reorder.js';

const moveButtonClass = `${secondaryButtonClass} min-h-11 min-w-11`;

/**
 * Drag handle plus Up and Down. Up and Down are the keyboard and touch path.
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
  return (
    <div className="flex flex-wrap gap-2xs">
      <button
        type="button"
        draggable={!disabled}
        className={moveButtonClass}
        aria-label={dragLabel ?? `Drag ${label}`}
        disabled={disabled}
        onDragStart={(event) => {
          event.dataTransfer.setData('text/plain', dragToken);
          event.dataTransfer.effectAllowed = 'move';
        }}
      >
        Drag
      </button>
      <button
        type="button"
        className={moveButtonClass}
        aria-label={upLabel ?? `Move ${label} up`}
        disabled={disabled || index === 0}
        onClick={() => onMove(index, index - 1)}
      >
        Up
      </button>
      <button
        type="button"
        className={moveButtonClass}
        aria-label={downLabel ?? `Move ${label} down`}
        disabled={disabled || index === count - 1}
        onClick={() => onMove(index, index + 1)}
      >
        Down
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
