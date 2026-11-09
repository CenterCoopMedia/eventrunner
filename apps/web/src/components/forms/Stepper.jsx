// The stepper (ADR 0008 §1): one step per page, at its own address, with a
// list of every step and Back and Next. The admin setup page, the pitch
// form, checkout and the speaker profile all use these parts, so every
// multi-step flow has the same keyboard path, the same words for state, and
// the same focus rule.
//
// The parts do not own the flow. The caller owns its steps, its answers and
// its checks, and passes each step's state in: 'done', 'todo', or 'locked'
// (a later step that cannot open before the steps above it pass). A locked
// step is text, not a link, and its state is a word as well as a mark.
//
// THE STEP LIST is beside the step on a wide screen and folds into one line
// on a narrow one, so the step in hand is at the top of a phone screen. The
// caller says which (lib/viewport.js useMediaQuery), and exactly one list is
// in the document, so a screen reader meets it once.
//
// A step link is a BOXED control: it composes the shared hover, press and
// unavailable states (components/controlClasses.js), like every other.
//
// THE TIER. The public site and the admin panel draw these parts with their
// own tokens: `tier="admin"` adds `stepper--admin`, and adminWorkspace.css
// maps the stepper's custom properties onto the admin set. The public
// default maps them onto the tier-2 theme roles in stepper.css.
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { controlStateClass } from '../controlClasses.js';
import './stepper.css';

const STEP_STATE_WORDS = Object.freeze({
  done: 'Done',
  todo: 'To do',
  locked: 'Not started',
});

/**
 * Which step an address names. An unknown address falls back to `fallback`
 * and says so, so the caller can redirect.
 *
 * @param {Array<{ slug: string }>} steps
 * @param {string|undefined} slug the step part of the address
 * @param {number} fallback the index to show when the address names none
 * @returns {{ index: number, unknown: boolean }}
 */
export function resolveStep(steps, slug, fallback) {
  if (!slug) return { index: fallback, unknown: false };
  const index = steps.findIndex((step) => step.slug === slug);
  return index === -1 ? { index: fallback, unknown: true } : { index, unknown: false };
}

/**
 * A ref for the step heading. A move to another step puts the focus on it,
 * so a keyboard or screen-reader reader starts at the new step. The first
 * render does not move the focus.
 *
 * @param {string|undefined} slug
 */
export function useStepHeadingFocus(slug) {
  const headingRef = useRef(null);
  const seenRef = useRef(slug);
  useEffect(() => {
    if (seenRef.current === slug) return;
    seenRef.current = slug;
    headingRef.current?.focus();
  }, [slug]);
  return headingRef;
}

function tierClass(tier) {
  return tier === 'admin' ? ' stepper--admin' : '';
}

function StepItems({ steps, current, hrefFor, label, tier, words }) {
  return (
    <ol className={`stepper-list${tierClass(tier)}`} aria-label={label}>
      {steps.map((step, index) => {
        const state = step.state ?? 'todo';
        const body = (
          <>
            <span className="stepper-marker" aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
            <span className="stepper-text">
              <span className="stepper-title">{step.title}</span>
              <span className="stepper-state">{step.stateLabel ?? words[state] ?? words.todo}</span>
            </span>
          </>
        );
        return (
          <li key={step.slug}>
            {state === 'locked' ? (
              <span className="stepper-item" data-state={state}>{body}</span>
            ) : (
              <Link
                to={hrefFor(step)}
                className={`stepper-item ${controlStateClass}`}
                data-state={state}
                aria-current={index === current ? 'step' : undefined}
              >
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Every step, its number or a tick, its title, and its state in words.
 *
 * @param {object} props
 * @param {Array<{ slug: string, title: string, state?: 'done'|'todo'|'locked', stateLabel?: string }>} props.steps
 * @param {number} props.current the index of the open step
 * @param {(step: object) => string} props.hrefFor the address of a step
 * @param {boolean} props.wide beside the step (true) or folded above it
 * @param {string} [props.label] the list's accessible name
 * @param {'public'|'admin'} [props.tier]
 * @param {Record<string, string>} [props.words] state words
 */
export function StepList({ steps, current, hrefFor, wide, label = 'Steps', tier = 'public', words = STEP_STATE_WORDS }) {
  const list = <StepItems steps={steps} current={current} hrefFor={hrefFor} label={label} tier={tier} words={words} />;
  if (wide) return list;
  return (
    <details className={`stepper-fold${tierClass(tier)}`}>
      <summary className="stepper-fold-summary">
        Show all {steps.length} steps
      </summary>
      {list}
    </details>
  );
}

/**
 * The open step's place and title. The heading takes the focus on a move.
 *
 * @param {{ index: number, total: number, title: string, headingRef: object, headingId?: string, tier?: string }} props
 */
export function StepHeading({ index, total, title, headingRef, headingId = 'stepper-step-heading', tier = 'public' }) {
  return (
    <div className={`stepper-heading${tierClass(tier)}`}>
      <p className="stepper-place">Step {index + 1} of {total}</p>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="stepper-heading-title">{title}</h2>
    </div>
  );
}

/**
 * Back and Next under a step. Next names the step it opens. A form whose
 * Next must check the step first passes `onNext`, and the Next control is
 * then a button that calls it; otherwise Next is a link.
 *
 * @param {object} props
 * @param {object} [props.previous] the step before, or nothing on the first
 * @param {object} [props.next] the step after, or nothing on the last
 * @param {(step: object) => string} props.hrefFor
 * @param {string} props.backClass the tier's outlined action
 * @param {string} props.nextClass the tier's filled action
 * @param {() => void} [props.onNext] check-then-move, for a form step
 * @param {React.ReactNode} [props.last] what the last step shows in Next's place (a submit)
 * @param {'public'|'admin'} [props.tier]
 */
export function StepPager({ previous, next, hrefFor, backClass, nextClass, onNext, last = null, tier = 'public' }) {
  let forward = last;
  if (next) {
    forward = onNext ? (
      <button type="button" className={nextClass} onClick={onNext}>Next: {next.title}</button>
    ) : (
      <Link to={hrefFor(next)} className={nextClass}>Next: {next.title}</Link>
    );
  }
  return (
    <nav className={`stepper-pager${tierClass(tier)}`} aria-label="Step navigation">
      {previous ? <Link to={hrefFor(previous)} className={backClass}>Back</Link> : <span />}
      {forward}
    </nav>
  );
}
