// Demo-only presentation controls for the static GitHub Pages build.
//
// A normal client build compiles IS_DEMO to false, so it renders no banner
// and exposes no style controls. The demo uses EventConfigProvider's existing
// theme path. It does not write Firestore or create a second resolver.
import { useEffect, useId, useState } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { recommendedConfiguration } from '../lib/themeRuntime.js';
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

const selectClass =
  'touch-target w-full rounded-brand border-hairline border-control bg-surface ' +
  'px-sm py-xs font-data text-caption text-text-primary';

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
        <p className="max-w-prose text-caption text-text-secondary">
          <strong className="text-text-primary">Demo site.</strong>{' '}
          This event is fictional and read-only. Account features are off.
        </p>

        <div
          className="flex flex-wrap items-end gap-xs"
          aria-label="Demo display settings"
        >
          <button
            type="button"
            className={quietActionClass}
            onClick={() => setStyleId(adjacentDemoStyleId(styleId, -1))}
          >
            Previous style
          </button>

          <div className="min-w-48 flex-1 sm:max-w-xs">
            <label
              htmlFor={selectId}
              className="mb-2xs block font-data text-caption font-semibold"
            >
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
            className={quietActionClass}
            onClick={() => setStyleId(adjacentDemoStyleId(styleId, 1))}
          >
            Next style
          </button>

          <button
            type="button"
            className={quietActionClass}
            aria-pressed={mode === 'dark'}
            onClick={() =>
              setMode((current) => (current === 'dark' ? 'light' : 'dark'))
            }
          >
            {mode === 'dark' ? 'Use light mode' : 'Use dark mode'}
          </button>
        </div>

        <p
          className="max-w-prose text-caption text-text-secondary"
          aria-live="polite"
        >
          <strong className="text-text-primary">{activeStyle.label}.</strong>{' '}
          {activeStyle.summary}
        </p>
      </div>
    </section>
  );
}

export default function DemoBanner() {
  if (!IS_DEMO) return null;
  return <DemoBannerContent />;
}
