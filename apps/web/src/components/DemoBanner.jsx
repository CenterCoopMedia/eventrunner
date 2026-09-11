// Demo-only presentation controls for the static GitHub Pages build.
//
// A normal client build compiles IS_DEMO to false, so it renders no banner
// and exposes no style controls. The demo uses EventConfigProvider's existing
// theme path. It does not write Firestore or create a second resolver.
//
// The band is the showcase's own device, and it is built from the same
// vocabulary as the site under it: the STAGE it shares with the header, the
// page and the footer, the alternate ground, a hairline, the heading face
// for the style's name, the body face for the line that describes it, and
// five controls in one row at the shared control height. No pill, no
// shadow, no gradient, and nothing that can push the page sideways at
// 390px.
//
// The band held its own `max-w-5xl` and `px-md` after the stage landed, so
// at 1440px its content box ran 224 to 1216 against the header's 164 to
// 1276: 60px inside the frame at each end. A band that does not line up
// with the page under it is the one thing a demo band must not be.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
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
// so the row reads as one row rather than four sizes. The height is the
// shared 44px floor `touch-target` sets, not a number written here: a
// second source for one measurement is a second place for it to drift.
const selectClass =
  'touch-target w-full min-w-0 rounded-brand border-hairline border-control bg-surface ' +
  'px-sm font-data text-caption text-text-primary';

const bandActionClass = `${quietActionClass} justify-center`;
const exitPreviewClass =
  `${quietActionClass} no-print fixed bottom-md start-md z-40 bg-surface`;

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
      <button
        ref={exitButtonRef}
        type="button"
        className={exitPreviewClass}
        onClick={exitPreview}
      >
        Exit preview
      </button>
    );
  }

  return (
    <section
      role="note"
      aria-label="Demo controls"
      className="no-print border-b-hairline border-b-rule-hairline bg-surface-alt text-text-primary"
    >
      <div className="stage flex flex-col gap-sm py-sm">
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

          <button
            ref={previewButtonRef}
            type="button"
            className={bandActionClass}
            onClick={enterPreview}
          >
            Preview full screen
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
