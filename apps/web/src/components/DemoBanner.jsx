// Demo-only presentation controls for the static GitHub Pages build.
//
// A normal client build compiles IS_DEMO to false, so it renders no banner
// and exposes no style controls. The demo uses EventConfigProvider's existing
// theme path. It does not write Firestore or create a second resolver.
//
// A short read-only notice and preview action remain visible. The style
// controls are an optional disclosure on the shared stage, so readers can
// reach the event content without first scrolling through a control panel.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import { IS_DEMO } from '../lib/demoMode.js';
import { recommendedConfiguration } from '../lib/themeRuntime.js';
import { loadPresetRemaps } from '../lib/presetRemaps.js';
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
// so the row reads as one row rather than four sizes. The height is the
// shared 44px floor `touch-target` sets, not a number written here: a
// second source for one measurement is a second place for it to drift.
const selectClass =
  'touch-target w-full min-w-0 rounded-brand border-hairline border-control bg-surface ' +
  'px-sm font-data text-caption text-text-primary';

const bandActionClass = `${quietActionClass} justify-center`;

function attemptFullscreenCall(target, method) {
  if (typeof method !== 'function') return null;
  try {
    const result = method.call(target);
    return typeof result?.catch === 'function' ? result.catch(() => {}) : null;
  } catch {
    // In-page preview remains available when the browser refuses fullscreen.
    return null;
  }
}

export function DemoBannerContent({
  location = window.location,
  history = window.history,
  pageDocument = document,
}) {
  const { theme, setDemoTheme } = useEventConfig();
  const initialDisplay = readDemoDisplay(location.search, theme);
  const [styleId, setStyleId] = useState(initialDisplay.style);
  const [mode, setMode] = useState(initialDisplay.mode);
  const [previewing, setPreviewing] = useState(false);
  const selectId = useId();
  const settingsId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsButtonRef = useRef(null);
  const previewButtonRef = useRef(null);
  const exitButtonRef = useRef(null);
  const restoreFocusRef = useRef(false);
  const previewDesiredRef = useRef(false);
  const activeStyle = getDemoStyleOption(styleId);

  const restoreControls = useCallback(() => {
    previewDesiredRef.current = false;
    restoreFocusRef.current = true;
    setPreviewing(false);
  }, []);

  const enterPreview = useCallback(() => {
    previewDesiredRef.current = true;
    setPreviewing(true);
    const root = pageDocument?.documentElement;
    const request = attemptFullscreenCall(root, root?.requestFullscreen);
    if (request) {
      void request.then(() => {
        if (!previewDesiredRef.current && pageDocument?.fullscreenElement) {
          attemptFullscreenCall(pageDocument, pageDocument.exitFullscreen);
        }
      });
    }
  }, [pageDocument]);

  const exitPreview = useCallback(() => {
    restoreControls();
    if (pageDocument?.fullscreenElement) {
      attemptFullscreenCall(pageDocument, pageDocument.exitFullscreen);
    }
  }, [pageDocument, restoreControls]);

  // The style switch resolves each style in full, and what a style moves is
  // a lazy chunk (lib/presetRemaps.js). Fetching it as the band mounts
  // means the first switch lands as fast as the rest; a failed fetch is the
  // provider's to retry when a switch asks for it.
  useEffect(() => {
    loadPresetRemaps().catch(() => {});
  }, []);

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
      previewDesiredRef.current = false;
      if (typeof setDemoTheme === 'function') setDemoTheme(null);
    },
    [setDemoTheme],
  );

  useEffect(() => {
    if (previewing) {
      exitButtonRef.current?.focus();
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      previewButtonRef.current?.focus();
    }
  }, [previewing]);

  useEffect(() => {
    if (!previewing) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') exitPreview();
    };
    const handleFullscreenChange = () => {
      if (!pageDocument.fullscreenElement) restoreControls();
    };
    pageDocument.addEventListener('keydown', handleKeyDown);
    pageDocument.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      pageDocument.removeEventListener('keydown', handleKeyDown);
      pageDocument.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, [exitPreview, pageDocument, previewing, restoreControls]);

  if (previewing) {
    return (
      <section
        aria-label="Preview controls"
        className="no-print border-b-hairline border-b-rule-hairline bg-surface text-text-primary"
      >
        <div className="stage py-xs">
          <button ref={exitButtonRef} type="button" className={quietActionClass} onClick={exitPreview}>
            Exit preview
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      role="note"
      aria-label="Demo controls"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !settingsOpen) return;
        event.stopPropagation();
        setSettingsOpen(false);
        settingsButtonRef.current?.focus();
      }}
      className="no-print border-b-hairline border-b-rule-hairline bg-surface-alt text-text-primary"
    >
      <div className="stage py-xs">
        <div className="demo-toolbar flex flex-wrap items-center gap-xs">
          <p className="min-w-0 flex-1 text-caption text-text-secondary">
            <strong className="text-text-primary">Historical 2026 demo.</strong>{' '}
            Read-only. Registration and email actions are off.
          </p>
          <button
            ref={settingsButtonRef}
            type="button"
            className={bandActionClass}
            aria-expanded={settingsOpen}
            aria-controls={settingsId}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            Demo settings
            <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" className="disclosure-chevron">
              <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </button>
          <button
            ref={previewButtonRef}
            type="button"
            className={bandActionClass}
            onClick={enterPreview}
          >
            Preview full screen
          </button>
        </div>
        <div id={settingsId} hidden={!settingsOpen} className="demo-settings pt-sm">
          <div aria-live="polite" className="mb-sm">
            <p className="font-heading text-h3 font-semibold text-text-primary">{activeStyle.label}</p>
            <p className="mt-3xs max-w-prose text-body text-text-secondary text-pretty">{activeStyle.summary}</p>
          </div>
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
        </div>
      </div>
    </section>
  );
}

export default function DemoBanner() {
  if (!IS_DEMO) return null;
  return <DemoBannerContent />;
}
