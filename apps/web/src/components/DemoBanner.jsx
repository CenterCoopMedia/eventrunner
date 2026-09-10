// Demo-only presentation controls for the static GitHub Pages build.
//
// A normal client build compiles IS_DEMO to false, so it renders no banner
// and exposes no style controls. The demo uses EventConfigProvider's existing
// theme path. It does not write Firestore or create a second resolver.
//
// The band is the showcase's own device, and it is built from the same
// vocabulary as the site under it: the alternate ground, a hairline, the
// heading face for the style's name, the body face for the line that
// describes it, and four controls in one row at the control height. No
// pill, no shadow, no gradient, and nothing that can push the page sideways
// at 390px.
import { useEffect, useId, useState } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { recommendedConfiguration } from '../lib/themeRuntime.js';
import Rule from './editorial/Rule.jsx';
import { quietActionClass } from './controlClasses.js';
import {
  DEMO_STYLE_OPTIONS,
  adjacentDemoStyleId,
  getDemoStyleOption,
  isDemoStyleId,
} from './demoStyleOptions.js';

const DISPLAY_MODES = Object.freeze(['light', 'dark']);

function isDisplayMode(value) {
  return DISPLAY_MODES.includes(value);
}

export function readDemoDisplay(search, fallbackTheme = {}) {
  const params = new URLSearchParams(search);
  const style = params.get('style');
  const mode = params.get('mode');
  return {
    style: isDemoStyleId(style)
      ? style
      : isDemoStyleId(fallbackTheme.preset)
        ? fallbackTheme.preset
        : DEMO_STYLE_OPTIONS[0].id,
    mode: isDisplayMode(mode)
      ? mode
      : isDisplayMode(fallbackTheme.mode)
        ? fallbackTheme.mode
        : 'light',
  };
}

export function writeDemoDisplaySearch(search, style, mode) {
  const params = new URLSearchParams(search);
  params.set('style', style);
  params.set('mode', mode);
  return `?${params.toString()}`;
}

// The select carries the control height like the three buttons beside it,
// so the row reads as one row rather than four sizes.
const selectClass =
  'touch-target h-11 w-full min-w-0 rounded-brand border-hairline border-control bg-surface ' +
  'px-sm font-data text-caption text-text-primary';

const bandActionClass = `${quietActionClass} h-11 justify-center`;

export function DemoBannerContent({
  location = window.location,
  history = window.history,
}) {
  const { theme, setDemoTheme } = useEventConfig();
  const initialDisplay = readDemoDisplay(location.search, theme);
  const [styleId, setStyleId] = useState(initialDisplay.style);
  const [mode, setMode] = useState(initialDisplay.mode);
  const selectId = useId();
  const activeStyle = getDemoStyleOption(styleId);

  useEffect(() => {
    if (typeof setDemoTheme !== 'function') return;
    const recommended = recommendedConfiguration(styleId);
    if (!recommended) return;

    setDemoTheme({ ...recommended, mode });

    const search = writeDemoDisplaySearch(location.search, styleId, mode);
    const url = `${location.pathname}${search}${location.hash}`;
    history.replaceState(history.state, '', url);
  }, [history, location, mode, setDemoTheme, styleId]);

  useEffect(
    () => () => {
      if (typeof setDemoTheme === 'function') setDemoTheme(null);
    },
    [setDemoTheme],
  );

  return (
    <section
      role="note"
      aria-label="Demo controls"
      className="no-print border-b-hairline border-b-rule-hairline bg-surface-alt text-text-primary"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-sm px-md py-sm">
        {/* The style's own name, then the line that says what it does. The
            name is set in the heading face and is not a heading element:
            the page under this band owns its h1. */}
        <div aria-live="polite">
          <p className="font-heading text-h3 font-semibold text-text-primary">
            {activeStyle.label}
          </p>
          <p className="mt-3xs max-w-prose text-body text-text-secondary text-pretty">
            {activeStyle.summary}
          </p>
        </div>

        <Rule weight="hairline" />

        <div
          className="flex flex-wrap items-center gap-xs"
          aria-label="Demo display settings"
        >
          <button
            type="button"
            className={bandActionClass}
            aria-label="Previous site style"
            onClick={() => setStyleId(adjacentDemoStyleId(styleId, -1))}
          >
            Previous
          </button>

          <div className="min-w-0 flex-1 basis-40 sm:max-w-xs">
            <label htmlFor={selectId} className="sr-only">
              Site style
            </label>
            <select
              id={selectId}
              className={selectClass}
              value={styleId}
              onChange={(event) => setStyleId(event.target.value)}
            >
              {DEMO_STYLE_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
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
            onClick={() =>
              setMode((current) => (current === 'dark' ? 'light' : 'dark'))
            }
          >
            {mode === 'dark' ? 'Use light mode' : 'Use dark mode'}
          </button>
        </div>

        <p className="max-w-prose text-caption text-text-secondary">
          <strong className="text-text-primary">Demo site.</strong>{' '}
          This event is fictional and read-only. Account features are off.
        </p>
      </div>
    </section>
  );
}

export default function DemoBanner() {
  if (!IS_DEMO) return null;
  return <DemoBannerContent />;
}
