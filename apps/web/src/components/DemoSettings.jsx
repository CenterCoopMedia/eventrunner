import { useId } from 'react';
import { quietActionClass } from './controlClasses.js';
import {
  DEMO_STYLE_OPTIONS,
  adjacentDemoStyleId,
  getDemoStyleOption,
} from './demoStyleOptions.js';

const selectClass =
  'touch-target w-full min-w-0 rounded-brand border-hairline border-control bg-surface ' +
  'px-sm font-data text-caption text-text-primary';

const bandActionClass = `${quietActionClass} justify-center`;

/** The optional panel owns rendering; its selections remain in the banner. */
export default function DemoSettings({ styleId, setStyleId, mode, setMode }) {
  const selectId = useId();
  const activeStyle = getDemoStyleOption(styleId);

  return (
    <>
      <div aria-live="polite" className="mb-sm">
        <p className="font-heading text-h3 font-semibold text-text-primary">{activeStyle.label}</p>
        <p className="mt-3xs max-w-prose text-body text-text-secondary text-pretty">{activeStyle.summary}</p>
      </div>
      <div className="flex flex-wrap items-center gap-xs" aria-label="Demo display settings">
        <button
          type="button"
          className={bandActionClass}
          aria-label="Previous site style"
          onClick={() => setStyleId(adjacentDemoStyleId(styleId, -1))}
        >
          Previous
        </button>

        <div className="min-w-0 flex-1 basis-40 sm:max-w-xs">
          <label htmlFor={selectId} className="sr-only">Site style</label>
          <select
            id={selectId}
            className={selectClass}
            value={styleId}
            onChange={(event) => setStyleId(event.target.value)}
          >
            {DEMO_STYLE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={bandActionClass}
          aria-label="Next site style"
          onClick={() => setStyleId(adjacentDemoStyleId(styleId, 1))}
        >
          Next
        </button>

        <button
          type="button"
          className={bandActionClass}
          aria-pressed={mode === 'dark'}
          onClick={() => setMode((current) => (current === 'dark' ? 'light' : 'dark'))}
        >
          {mode === 'dark' ? 'Use light mode' : 'Use dark mode'}
        </button>
      </div>
    </>
  );
}
