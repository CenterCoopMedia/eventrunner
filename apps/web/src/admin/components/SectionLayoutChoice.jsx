// How one section sets its blocks, chosen by picture (issue #1153), with the
// section drawn beside the choice exactly as the public page draws it: the
// public SectionHead and SectionBlocks, the site's theme, the section's own
// current blocks, at a computer width and a phone width.
//
// The choices are fixed (lib/pageLayout.js SECTION_LAYOUTS). "Reading
// width" is what an absent value means, so a section that never chose keeps
// its look and stores nothing new.
import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PullQuoteBudget } from '../../components/blocks/pullQuoteBudget.jsx';
import SectionBlocks from '../../components/blocks/SectionBlocks.jsx';
import SectionHead from '../../components/editorial/SectionHead.jsx';
import LongReadOpening from '../../components/editorial/LongReadOpening.jsx';
import { DEFAULT_SECTION_LAYOUT, SECTION_LAYOUTS } from '../../lib/pageLayout.js';
import { ViewportProvider } from '../../lib/viewport.js';
import { PREVIEW_DOCUMENT, syncProofStyles } from '../previewDocument.js';
import { usePublicThemeScope } from '../usePublicThemeScope.js';
import './sectionLayoutChoice.css';

const CHOICES = Object.freeze({
  reading: { name: 'Reading width', summary: 'One narrow column, easiest to read.' },
  wide: { name: 'Wide', summary: 'One column that uses more of the page.' },
  columns: { name: 'Two columns', summary: 'First half of the blocks on the left, the rest on the right. One column on phones.' },
});

/** A wireframe of each layout: grey bars are text, the box is a block. */
function Picture({ layout }) {
  const line = (x, y, w) => <rect key={`${x}-${y}`} x={x} y={y} width={w} height="3" rx="1.5" />;
  return (
    <svg viewBox="0 0 64 40" className="admin-section-layout__picture" aria-hidden="true" focusable="false">
      <rect x="0.5" y="0.5" width="63" height="39" rx="2" className="admin-section-layout__page" />
      <g className="admin-section-layout__ink">
        {layout === 'reading' ? [line(6, 8, 30), line(6, 14, 28), line(6, 20, 30), line(6, 26, 22)] : null}
        {layout === 'wide' ? [line(6, 8, 46), line(6, 14, 44), line(6, 20, 46), line(6, 26, 34)] : null}
        {layout === 'columns' ? [line(6, 8, 23), line(6, 14, 21), line(6, 20, 23), line(35, 8, 23), line(35, 14, 21), line(35, 20, 18)] : null}
      </g>
    </svg>
  );
}

/**
 * The section drawn in its own document at a real CSS width, then scaled to
 * fit its column. The page's media queries, viewport units and fluid type
 * read the frame's width, so the phone frame is the phone page (the Branding
 * preview, ThemeProof, draws whole pages the same way).
 */
function PreviewFrame({ width, label, scopeId, children }) {
  const outerRef = useRef(null);
  const iframeRef = useRef(null);
  const [host, setHost] = useState(null);
  const [content, setContent] = useState(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });
  usePublicThemeScope(host?.root ?? null, scopeId);

  const prepare = useCallback(() => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.head || !doc.body || !iframe.contentWindow) return;
    doc.body.className = 'theme-preview-document';
    doc.body.style.margin = '0';
    setHost((previous) => (previous?.root === doc.documentElement
      ? previous
      : { root: doc.documentElement, body: doc.body, view: iframe.contentWindow }));
  }, []);
  useLayoutEffect(() => { prepare(); }, [prepare]);
  const frameHead = host?.body.ownerDocument.head;
  useLayoutEffect(() => {
    if (frameHead) return syncProofStyles(document.head, frameHead);
  }, [frameHead]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    if (!outer || !content || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setBox({ scale: Math.min(1, outer.clientWidth / width), height: content.offsetHeight });
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [width, content]);

  return (
    <figure className="admin-section-layout__frame">
      <div
        ref={outerRef}
        className="admin-section-layout__window"
        style={{ height: box.height ? box.height * box.scale : undefined }}
        aria-hidden="true"
      >
        <iframe
          ref={iframeRef}
          srcDoc={PREVIEW_DOCUMENT}
          title={label}
          tabIndex={-1}
          inert=""
          sandbox="allow-same-origin"
          onLoad={prepare}
          className="admin-section-layout__stage"
          style={{ width: `${width}px`, height: `${box.height}px`, transform: `scale(${box.scale})` }}
        />
      </div>
      {host ? createPortal(
        <ViewportProvider view={host.view}>
          <div ref={setContent} className="admin-section-layout__page">{children}</div>
        </ViewportProvider>,
        host.body,
      ) : null}
      <figcaption className="admin-section-layout__caption">{label}</figcaption>
    </figure>
  );
}

/**
 * @param {{
 *   value: string|null,
 *   onChange: (layout: string|null) => void,
 *   label: string,
 *   blocks: object[],
 *   blocksReady: boolean,
 *   previewId: string,
 *   budget?: { sections: object[], getSectionBlocks: (id: string) => object[] },
 *   readingMeasure?: boolean,
 *   longReadOpening?: boolean,
 * }} props
 *   `readingMeasure` is true where the public page holds a Reading width
 *   section to the text measure (a system page in the list arrangement,
 *   SystemPage), so the preview holds it there too.
 *   `budget` is the page's sections in reading order and their blocks, so
 *   a quote is drawn as the page's one pull quote only where the page draws
 *   it so.
 *   `longReadOpening` is true for the section that opens a Long read page,
 *   so the preview draws the style's drop cap or standfirst there too.
 */
export default function SectionLayoutChoice({ value, onChange, label, blocks, blocksReady, previewId, budget = null, readingMeasure = false, longReadOpening = false }) {
  const name = useId();
  // A closed section keeps its fields mounted; its preview documents are
  // made only once the preview is first shown.
  const previewRef = useRef(null);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    const element = previewRef.current;
    if (shown || !element) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      setShown(true);
      return undefined;
    }
    const observer = new ResizeObserver(() => {
      if (element.clientWidth > 0) setShown(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);
  const current = SECTION_LAYOUTS.includes(value) ? value : DEFAULT_SECTION_LAYOUT;
  const section = (frame) => {
    const drawn = (
      <>
        <SectionHead level={2} id={`${previewId}-${frame}-head`} title={label || 'Untitled section'} />
        <div className={readingMeasure && current === DEFAULT_SECTION_LAYOUT ? 'measure mt-md' : 'mt-md'}>
          <LongReadOpening active={longReadOpening}>
            <SectionBlocks blocks={blocks} layout={current} />
          </LongReadOpening>
        </div>
      </>
    );
    return budget ? <PullQuoteBudget {...budget}>{drawn}</PullQuoteBudget> : drawn;
  };
  return (
    <div className="admin-section-layout">
      <fieldset className="admin-section-layout__choices">
        <legend className="admin-section-layout__legend">Layout</legend>
        {SECTION_LAYOUTS.map((layout) => {
          const inputId = `${name}-${layout}`;
          return (
            <label key={layout} htmlFor={inputId} className="admin-section-layout__option" data-selected={layout === current || undefined}>
              <Picture layout={layout} />
              <span className="admin-section-layout__head">
                <input
                  data-help-skip="Each option shows a picture of the layout and a one-line description."
                  id={inputId}
                  type="radio"
                  name={name}
                  value={layout}
                  checked={layout === current}
                  aria-labelledby={`${inputId}-name`}
                  aria-describedby={`${inputId}-summary`}
                  // Reading width is stored as no value, which is what it
                  // has always meant.
                  onChange={() => onChange(layout === DEFAULT_SECTION_LAYOUT ? null : layout)}
                />
                <span id={`${inputId}-name`} className="admin-section-layout__name">{CHOICES[layout].name}</span>
              </span>
              <span id={`${inputId}-summary`} className="admin-section-layout__summary">{CHOICES[layout].summary}</span>
            </label>
          );
        })}
      </fieldset>
      <div ref={previewRef} className="admin-section-layout__preview" aria-label={`Preview of ${label || 'this section'}`} role="group">
        {!blocksReady ? (
          <p className="admin-section-layout__empty">Loading this section’s content…</p>
        ) : blocks.length === 0 ? (
          <p className="admin-section-layout__empty">This section has no content yet. Add content to see the layout.</p>
        ) : !shown ? null : (
          <div className="admin-section-layout__frames">
            <PreviewFrame width={1152} label="On a computer" scopeId={`${previewId}-computer`}>{section('computer')}</PreviewFrame>
            <PreviewFrame width={390} label="On a phone" scopeId={`${previewId}-phone`}>{section('phone')}</PreviewFrame>
          </div>
        )}
      </div>
    </div>
  );
}
