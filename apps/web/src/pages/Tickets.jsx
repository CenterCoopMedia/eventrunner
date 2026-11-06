// Get tickets (ADR 0008 §5) — /tickets.
//
// A stepper: Tickets → Attendees → Questions → Review, and Review's Pay
// button opens Stripe. The Questions step is in the list only when the
// registration form asks something. The step is in the query
// (`/tickets?step=attendees`), not the path, because /tickets/status and
// /tickets/mine are pages of their own.
//
// Each Next checks its own step, with the same error keys the one-page form
// used. A later step stays locked while an earlier one fails, and an address
// that names a locked step sends the buyer to the first step that needs
// work, as the pitch stepper does. Pay checks every step again.
//
// THE QUESTIONS are pinned when the page loads, so they do not shift while
// someone types. When anyone answered something, every attendee's answers
// go with the checkout, with the form revision they answered. When the server says the form changed, the
// page takes the newer live form, keeps every answer whose question is still
// asked, and returns the buyer to the Questions step.
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { resolveRegistrationAction } from 'shared/registration';
import { DEFAULT_REGISTRATION_LABEL } from '../lib/useRegistrationLink.js';
import { activeQuestions, answerText, checkAnswers, readRegistrationForm } from 'shared/registrationForm';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useEventConfig } from '../contexts/EventConfigContext.jsx';
import SignInPanel from '../components/SignInPanel.jsx';
import SectionHead from '../components/editorial/SectionHead.jsx';
import { Checkbox } from '../components/forms/Choice.jsx';
import { TextField, SelectField, focusFirstError } from '../components/forms/publicForm.jsx';
import { StepHeading, StepList, StepPager, resolveStep, useStepHeadingFocus } from '../components/forms/Stepper.jsx';
import PromoCodeField from '../components/tickets/PromoCodeField.jsx';
import RegistrationQuestionFields from '../components/registration/RegistrationQuestionFields.jsx';
import { primaryActionClass, secondaryActionClass } from '../components/controlClasses.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { isReadOnlyDemo } from '../lib/readOnlyDemo.js';
import { subscribeRegistrationForm } from '../lib/registrationFormSource.js';
import { useMediaQuery, WIDE_VIEWPORT } from '../lib/viewport.js';
import {
  forgetCheckoutAttempt, formatTicketMoney, formatTicketTime, newTicketingRequestId, readCheckoutAttempt,
  rememberCheckoutAttempt, safeCheckoutUrl, ticketingRequest,
} from '../lib/ticketingCommerce.js';
import { EMAIL_ADDRESS_RE as EMAIL_RE } from 'shared/email';

const EMPTY_CART = 'Choose at least one ticket.';
const FORM_CHANGED_NOTE = 'The registration questions changed while you were buying. Check the questions below, then continue. Answers to questions that are still asked are kept.';
const noteClass = 'border-hairline border-rule-hairline bg-surface-alt px-sm py-xs text-caption text-text-primary';

const STEPS = Object.freeze([
  { slug: 'tickets', title: 'Tickets', heading: 'Choose your tickets' },
  { slug: 'attendees', title: 'Attendees', heading: 'Name each attendee' },
  { slug: 'questions', title: 'Questions', heading: 'Answer the registration questions' },
  { slug: 'review', title: 'Review', heading: 'Review your total' },
]);
const QUESTIONS_STEP = STEPS[2];
const REVIEW_STEP = STEPS[3];
const hrefFor = (step) => `/tickets?step=${step.slug}`;
const hasErrors = (found) => Object.keys(found).length > 0;
// Definite refusals: no order was created, so the saved attempt goes.
// A refused promo code is refused before any order exists (ADR 0004 amendment 2026-11-04).
const PROMO_CODES_REFUSED = ['promo-invalid', 'promo-not-applicable', 'promo-order-limit', 'promo-exhausted'];
const NO_ORDER_CODES = ['invalid-checkout', 'quantity-out-of-range', 'amount-out-of-range', 'amount-too-small', 'sales-closed', 'sold-out', 'ticket-unavailable', 'rate-limited', ...PROMO_CODES_REFUSED];
// Refusals about the chosen tickets send the buyer back to choose again.
const BACK_TO_SELECTION_CODES = ['quantity-out-of-range', 'sold-out', 'ticket-unavailable'];

/** Only the answers the form still asks, so a removed question is never sent. */
function pickAsked(values, form) {
  const ids = new Set(activeQuestions(form).map((question) => question.id));
  return Object.fromEntries(Object.entries(values ?? {}).filter(([id]) => ids.has(id)));
}

/**
 * `lines.N.attendees.M.answers.<id>: reason; ...` from the server, as the
 * field errors of the attendees the request named. Only questions the form
 * asks count, so every error lands on a field the buyer can see.
 */
function answerErrorsOf(message, lines, form) {
  const asked = new Set(activeQuestions(form).map((question) => question.id));
  // The server numbers lines after sorting them by ticket type id.
  const sorted = Array.isArray(lines) ? [...lines].sort((left, right) => (left.ticketTypeId < right.ticketTypeId ? -1 : left.ticketTypeId > right.ticketTypeId ? 1 : 0)) : null;
  const errors = {};
  for (const part of String(message ?? '').split(/;\s*/)) {
    const match = /^lines\.(\d+)\.attendees\.(\d+)\.answers\.([^:\s]+):\s*(.+)$/.exec(part.trim());
    const line = match && sorted ? sorted[Number(match[1])] : null;
    if (!line || Number(match[2]) >= (line.attendees?.length ?? 0) || !asked.has(match[3])) continue;
    errors[`${line.ticketTypeId}.${match[2]}.answers.${match[3]}`] = match[4];
  }
  return hasErrors(errors) ? errors : null;
}

const fullName = (attendee) => [attendee.firstName, attendee.lastName].map((part) => (part || '').trim()).filter(Boolean).join(' ');

export default function Tickets() {
  useDocumentTitle('Get tickets');
  const { user, loading: authLoading, signOut } = useAuth();
  const { eventConfig } = useEventConfig();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const stepSlug = searchParams.get('step') || undefined;
  const wide = useMediaQuery(WIDE_VIEWPORT);
  // Before the error focus below: a refused step move puts focus on the
  // error, not on the heading of the step it lands on.
  const headingRef = useStepHeadingFocus(stepSlug);
  const demo = isReadOnlyDemo(eventConfig);
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [loadVersion, setLoadVersion] = useState(0);
  const [quantities, setQuantities] = useState({});
  const [attendees, setAttendees] = useState({});
  const [acceptedCatalogRevision, setAcceptedCatalogRevision] = useState(null);
  const [acceptedByUid, setAcceptedByUid] = useState(null);
  const [errors, setErrors] = useState({});
  const [requestError, setRequestError] = useState('');
  // An applied code holds the preview for the cart it priced.
  const [promo, setPromo] = useState(null);
  const [promoRefusal, setPromoRefusal] = useState('');
  // Pay waits for a running code check, so a discount shown later is the one sent.
  const [promoPending, setPromoPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(null);
  const [passed, setPassed] = useState([]);
  // undefined until the first read; null when no form is stored.
  const [liveForm, setLiveForm] = useState(undefined);
  const [pinnedForm, setPinnedForm] = useState(undefined);
  const [formStale, setFormStale] = useState(false);
  const [formNotice, setFormNotice] = useState('');
  const requestRef = useRef(null);
  const formRef = useRef(null);
  const errorRef = useRef(null);
  const submittingRef = useRef(false);
  const activeUid = useRef(user?.uid);
  activeUid.current = user?.uid;
  // A new account session invalidates callbacks even after A → B → A.
  const promoOwnerRef = useRef({ uid: user?.uid, generation: 0 });
  if (promoOwnerRef.current.uid !== user?.uid) {
    promoOwnerRef.current = { uid: user?.uid, generation: promoOwnerRef.current.generation + 1 };
  }
  const promoOwner = promoOwnerRef.current;
  // A refusal that moves the buyer to another step focuses its error there,
  // not the step heading. The move can commit after the error does.
  const currentSlug = useRef(stepSlug);
  currentSlug.current = stepSlug;
  const seenSlug = useRef(stepSlug);
  const focusErrorAfterMove = useRef(false);
  const form = pinnedForm === undefined ? liveForm : pinnedForm;
  const asksQuestions = Boolean(form) && activeQuestions(form).length > 0;

  useEffect(() => {
    if (demo) return undefined;
    const controller = new AbortController();
    setLoadError('');
    ticketingRequest('ticketingCatalog', { signal: controller.signal }).then(setCatalog).catch((err) => {
      if (err?.name !== 'AbortError') setLoadError(err.message);
    });
    return () => controller.abort();
  }, [demo, loadVersion]);

  // A form that cannot be read asks nothing, so it never blocks a purchase.
  useEffect(() => (demo ? undefined : subscribeRegistrationForm(setLiveForm, () => setLiveForm((current) => (current === undefined ? null : current)))), [demo]);

  useEffect(() => {
    if (pinnedForm === undefined && liveForm !== undefined) setPinnedForm(liveForm);
  }, [pinnedForm, liveForm]);

  // After a form-changed refusal, take the live form once it is newer.
  useEffect(() => {
    if (!formStale || !liveForm) return;
    if (readRegistrationForm(liveForm).revision !== readRegistrationForm(pinnedForm).revision) {
      setPinnedForm(liveForm);
      setFormStale(false);
      setErrors((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.includes('.answers.'))));
    }
  }, [formStale, liveForm, pinnedForm]);

  useEffect(() => {
    setSaved(user?.uid ? { uid: user.uid, attempt: readCheckoutAttempt(user.uid) } : null);
    requestRef.current = null;
    submittingRef.current = false;
    setBusy(false);
    setQuantities({});
    setAttendees({});
    setAcceptedCatalogRevision(null);
    setAcceptedByUid(null);
    setErrors({});
    setRequestError('');
    setPassed([]);
    setFormNotice('');
    setPromo(null);
    setPromoRefusal('');
    setPromoPending(false);
  }, [user?.uid]);

  useEffect(() => {
    const moved = seenSlug.current !== stepSlug;
    seenSlug.current = stepSlug;
    if (moved) {
      if (!focusErrorAfterMove.current) return;
      focusErrorAfterMove.current = false;
    }
    if (Object.keys(errors).length) {
      if (formRef.current?.querySelector('[aria-invalid="true"]')) focusFirstError(formRef.current);
      else errorRef.current?.focus();
    } else if (requestError) errorRef.current?.focus();
  }, [errors, requestError, catalog, stepSlug]);

  // Consent belongs to the displayed offer and purchaser in this render.
  // A passive reset would briefly commit new terms with the old box checked.
  const validCatalogRevision = Number.isSafeInteger(catalog?.catalogRevision) && catalog.catalogRevision >= 0;
  const termsAccepted = validCatalogRevision && acceptedCatalogRevision === catalog.catalogRevision && acceptedByUid === user?.uid;

  const types = catalog?.ticketTypes || [];
  const lines = types.filter((type) => Number(quantities[type.id]) > 0).map((type) => ({
    ticketTypeId: type.id, quantity: Number(quantities[type.id]),
    attendees: Array.from({ length: Number(quantities[type.id]) }, (_, index) => attendees[type.id]?.[index] || {}),
  }));
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.quantity * types.find((type) => type.id === line.ticketTypeId).unitAmount, 0);
  // A code priced one cart. Another cart or catalog drops it without an effect.
  const cart = lines.map(({ ticketTypeId, quantity }) => ({ ticketTypeId, quantity }));
  const cartKey = JSON.stringify([catalog?.catalogRevision, cart]);
  const applied = promo?.owner === promoOwner && promo?.cartKey === cartKey ? promo.preview : null;
  const payable = applied ? applied.totalAmount : total;
  const attempt = saved && user && saved.uid === user.uid ? saved.attempt : null;
  // Every attendee in order, numbered across ticket types.
  const seats = lines.flatMap((line) => line.attendees.map((attendee, index) => ({
    type: types.find((candidate) => candidate.id === line.ticketTypeId), index, attendee,
  }))).map((seat, position) => {
    const name = fullName(seat.attendee);
    return { ...seat, key: `${seat.type.id}.${seat.index}`, label: `Ticket ${position + 1}: ${seat.type.name}${name ? ` for ${name}` : ''}` };
  });

  function moveWithError(step) {
    if (currentSlug.current !== step.slug) focusErrorAfterMove.current = true;
    navigate(hrefFor(step));
  }

  function updateAttendee(typeId, index, key, value) {
    setAttendees((previous) => {
      const next = [...(previous[typeId] || [])];
      next[index] = { ...next[index], [key]: value };
      return { ...previous, [typeId]: next };
    });
  }

  function updateAnswer(typeId, index, id, value) {
    setAttendees((previous) => {
      const next = [...(previous[typeId] || [])];
      const current = next[index] || {};
      next[index] = { ...current, answers: { ...current.answers, [id]: value } };
      return { ...previous, [typeId]: next };
    });
    const errorKey = `${typeId}.${index}.answers.${id}`;
    setErrors((previous) => {
      if (!(errorKey in previous)) return previous;
      const next = { ...previous };
      delete next[errorKey];
      return next;
    });
  }

  /** One step's problems, with the keys its fields show them under. */
  function stepErrors(slug) {
    const found = {};
    if (slug === 'tickets') {
      // An empty cart has one thing to fix. Its message takes focus alone.
      if (!count) return { cart: EMPTY_CART };
      const maximum = Math.min(catalog.maxPerOrder || 20, 20);
      if (count > maximum) found.cart = `Choose no more than ${maximum} tickets per order.`;
      for (const line of lines) {
        const type = types.find((candidate) => candidate.id === line.ticketTypeId);
        if (!type.available || line.quantity < (type.minPerOrder || 1) || line.quantity > type.maxPerOrder || (Number.isInteger(type.remaining) && line.quantity > type.remaining)) {
          found[`${type.id}.quantity`] = 'Choose an available quantity for this ticket type.';
        }
      }
    } else if (slug === 'attendees') {
      for (const { key, attendee } of seats) {
        if (!attendee.firstName?.trim()) found[`${key}.firstName`] = 'Enter the attendee’s first name.';
        if (!EMAIL_RE.test(attendee.email?.trim() || '')) found[`${key}.email`] = 'Enter the attendee’s email address.';
      }
    } else if (slug === 'questions' && asksQuestions) {
      for (const { key, attendee } of seats) {
        const checked = checkAnswers(pickAsked(attendee.answers, form), form);
        if (!checked.ok) for (const [id, reason] of Object.entries(checked.errors)) found[`${key}.answers.${id}`] = reason;
      }
    }
    return found;
  }

  async function sendCheckout(body) {
    if (submittingRef.current || !user) return;
    const uid = user.uid;
    const startingNewCheckout = !attempt && body.resume !== true;
    // The form this request was answered against, for reading a refusal.
    const sentForm = form;
    submittingRef.current = true;
    setBusy(true);
    setRequestError('');
    rememberCheckoutAttempt(uid, { requestId: body.requestId, orderId: body.orderId });
    setSaved({ uid, attempt: { requestId: body.requestId, orderId: body.orderId } });
    try {
      const result = await ticketingRequest('ticketingCheckout', { user, body });
      rememberCheckoutAttempt(uid, { requestId: body.requestId, orderId: result.orderId });
      if (activeUid.current !== uid) return;
      setSaved({ uid, attempt: { requestId: body.requestId, orderId: result.orderId } });
      if (result.checkoutUrl) {
        const url = safeCheckoutUrl(result.checkoutUrl);
        if (!url) throw new Error('The payment link could not be verified. View your order status or contact the organizers.');
        window.location.assign(url);
      } else {
        navigate(`/tickets/status?orderId=${encodeURIComponent(result.orderId)}`);
      }
    } catch (err) {
      if (activeUid.current === uid) {
        if (err.code === 'purchase-in-progress' && err.existingOrderId) {
          rememberCheckoutAttempt(uid, { orderId: err.existingOrderId });
          requestRef.current = null;
          setSaved({ uid, attempt: { orderId: err.existingOrderId } });
          navigate(`/tickets/status?orderId=${encodeURIComponent(err.existingOrderId)}`);
          return;
        }
        const missingSavedCheckout = body.resume === true && err.status === 404 && err.code === 'not-found';
        // A missing profile rejects a first submission before reservation. A
        // retry can already hold seats from an earlier uncertain response.
        const profileRejectedBeforeCreation = startingNewCheckout && err.code === 'account-not-ready';
        const catalogChanged = err.code === 'catalog-changed';
        // Both refuse the answers before any order exists.
        const formChanged = err.code === 'form-changed';
        // stripeCheckout refuses bad answers as invalid-checkout.
        const answerErrors = err.code === 'invalid-checkout' && body.resume !== true ? answerErrorsOf(err.message, body.lines, sentForm) : null;
        if (missingSavedCheckout || profileRejectedBeforeCreation || catalogChanged || formChanged || answerErrors || NO_ORDER_CODES.includes(err.code)) {
          forgetCheckoutAttempt(uid);
          requestRef.current = null;
          setSaved({ uid, attempt: null });
          if (catalogChanged) {
            setAcceptedCatalogRevision(null);
            setAcceptedByUid(null);
            setErrors({});
            setCatalog(null);
          }
          setLoadVersion((value) => value + 1);
        }
        if (formChanged) {
          setFormNotice(FORM_CHANGED_NOTE);
          setFormStale(true);
          navigate(hrefFor(QUESTIONS_STEP));
          return;
        }
        if (answerErrors) {
          setErrors(answerErrors);
          moveWithError(QUESTIONS_STEP);
          return;
        }
        if (PROMO_CODES_REFUSED.includes(err.code)) {
          setPromo(null);
          setPromoRefusal(err.message);
        }
        if (missingSavedCheckout || BACK_TO_SELECTION_CODES.includes(err.code)) moveWithError(STEPS[0]);
        setRequestError(missingSavedCheckout
          ? 'The saved checkout is not available to this account. Choose your tickets again.'
          : err.message || 'Checkout could not be opened. Retry the saved request.');
      }
    } finally {
      if (activeUid.current === uid) {
        submittingRef.current = false;
        setBusy(false);
      }
    }
  }

  const heading = <h1 className="font-heading text-h1 font-semibold text-text-primary">Get tickets</h1>;
  if (demo) return (
    <article className="space-y-md">
      {heading}
      <p>This is an event demo. Ticket sales and payments are unavailable.</p>
      <Link to="/schedule" className={secondaryActionClass}>Read the schedule</Link>
    </article>
  );
  if (loadError) return (
    <article className="space-y-md">
      {heading}<p role="alert" className="text-danger">{loadError}</p>
      <button type="button" className={secondaryActionClass} onClick={() => setLoadVersion((value) => value + 1)}>Retry ticket information</button>
    </article>
  );
  if (!catalog) return <article className="space-y-md">{heading}<p role="status">Loading ticket information…</p></article>;
  if (catalog.provider !== 'stripe') {
    const registrationAction = resolveRegistrationAction(eventConfig);
    return (
      <article className="space-y-md">
        {heading}
        {/* No tickets are sold here. The register-interest link is the
            way in where the organizers set one; otherwise the page says
            so plainly rather than offering a claim for a ticket nobody
            could have bought. */}
        <p>
          {registrationAction
            ? 'Registration for this event is handled on another site.'
            : 'Tickets are not sold on this site. Check this page again for registration details.'}
        </p>
        {registrationAction ? <a href={registrationAction.url} className={primaryActionClass}>{registrationAction.label || DEFAULT_REGISTRATION_LABEL}</a> : null}
        {catalog.provider && catalog.provider !== 'none' ? (
          <p><Link to="/ticket/claim" className="underline">Claim a ticket you already have</Link></p>
        ) : null}
      </article>
    );
  }

  function renderPurchase() {
    if (form === undefined) return <p role="status">Loading ticket information…</p>;
    const visible = STEPS.filter((step) => step.slug !== 'questions' || asksQuestions);
    const formSteps = visible.filter((step) => step.slug !== 'review');
    const firstOpen = formSteps.findIndex((step) => hasErrors(stepErrors(step.slug)));
    const steps = visible.map((step, index) => {
      if (firstOpen !== -1 && index > firstOpen) return { ...step, state: 'locked' };
      const done = step.slug !== 'review' && passed.includes(step.slug) && !hasErrors(stepErrors(step.slug));
      return { ...step, state: done ? 'done' : 'todo' };
    });
    const { index: current, unknown } = resolveStep(steps, stepSlug, 0);
    if (unknown) {
      // The Questions step can be named before the newer form arrives.
      if (formStale) return <p role="status">Loading the updated questions…</p>;
      return <Navigate to={stepSlug === 'questions' ? hrefFor(REVIEW_STEP) : '/tickets'} replace />;
    }
    const step = steps[current];
    if (step.state === 'locked') return <Navigate to={hrefFor(steps[firstOpen])} replace />;
    const review = step.slug === 'review';

    function goNext() {
      if (review) return;
      const found = stepErrors(step.slug);
      setErrors(found);
      if (hasErrors(found)) return;
      setRequestError('');
      if (step.slug === 'questions') setFormNotice('');
      setPassed((previous) => (previous.includes(step.slug) ? previous : [...previous, step.slug]));
      navigate(hrefFor(steps[current + 1]));
    }

    function pay() {
      if (submittingRef.current || promoPending) return;
      for (const formStep of formSteps) {
        const found = stepErrors(formStep.slug);
        if (hasErrors(found)) {
          setErrors(found);
          if (formStep.slug !== step.slug) moveWithError(formStep);
          return;
        }
      }
      if (!termsAccepted) { setErrors({ terms: 'Read and accept the refund policy before continuing.' }); return; }
      setErrors({});
      const answersOf = (attendee) => {
        const checked = asksQuestions ? checkAnswers(pickAsked(attendee.answers, form), form) : null;
        return checked?.ok ? checked.answers : {};
      };
      // Answers (and the form revision they answer) go only when someone
      // answered something; then every attendee carries an answers object.
      const answered = lines.some((line) => line.attendees.some((attendee) => Object.keys(answersOf(attendee)).length > 0));
      const body = {
        requestId: newTicketingRequestId(),
        catalogRevision: acceptedCatalogRevision,
        ...(answered ? { formRevision: readRegistrationForm(form).revision } : {}),
        ...(applied ? { promoCode: applied.code } : {}),
        lines: lines.map((line) => ({ ...line, attendees: line.attendees.map((attendee) => {
          const sent = { firstName: attendee.firstName.trim(), lastName: (attendee.lastName || '').trim(), email: attendee.email.trim() };
          return answered ? { ...sent, answers: answersOf(attendee) } : sent;
        }) })),
      };
      requestRef.current = body;
      sendCheckout(body);
    }

    const questions = asksQuestions ? activeQuestions(form) : [];
    const payControl = (
      <button type="submit" className={primaryActionClass} aria-busy={busy} aria-disabled={busy || promoPending}>{busy ? 'Preparing your order…' : !count ? 'Continue' : payable > 0 ? `Continue to Stripe — ${formatTicketMoney(payable, catalog.currency)}` : 'Reserve tickets'}</button>
    );

    return (
      <div className="space-y-md">
        <p>You are buying as <span className="wrap-anywhere font-semibold">{user.email}</span>.</p>
        <div className="grid items-start gap-lg lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
          <StepList steps={steps} current={current} hrefFor={hrefFor} wide={wide} label="Ticket purchase steps" />
          <section className="min-w-0 space-y-md" aria-labelledby="ticket-step-heading">
            <StepHeading index={current} total={steps.length} title={step.heading} headingRef={headingRef} headingId="ticket-step-heading" />
            {formNotice ? <p role="status" className={noteClass}>{formNotice}</p> : null}
            <form ref={formRef} className="space-y-lg" noValidate onSubmit={(event) => { event.preventDefault(); if (review) pay(); else goNext(); }}>
              {step.slug === 'tickets' ? (
                <div className="space-y-md">
                  <p>All ticket types include full-event admission.</p>
                  {types.length === 0 ? <p>No ticket types are currently available.</p> : null}
                  {types.map((type) => {
                    const maximum = Math.max(0, Math.min(type.maxPerOrder || 20, catalog.maxPerOrder || 20, 20, Number.isInteger(type.remaining) ? type.remaining : 20));
                    const salesStartAt = [catalog.salesStartAt, type.salesStartAt].filter(Boolean).sort((left, right) => Date.parse(right) - Date.parse(left))[0];
                    const salesEndAt = [catalog.salesEndAt, type.salesEndAt].filter(Boolean).sort((left, right) => Date.parse(left) - Date.parse(right))[0];
                    return (
                      <fieldset key={type.id} className="min-w-0 space-y-sm border-b-hairline border-rule-hairline pb-md">
                        <legend className="font-heading text-h3 font-semibold">{type.name}</legend>
                        <div className="grid min-w-0 gap-md sm:grid-cols-2">
                          <div className="min-w-0 space-y-xs">
                            <p className="font-data tabular-nums">{formatTicketMoney(type.unitAmount, catalog.currency)} per ticket</p>
                            {type.description ? <p className="wrap-anywhere text-text-secondary">{type.description}</p> : null}
                            {!type.available ? <p>Unavailable</p> : Number.isInteger(type.remaining) ? <p>{type.remaining} seats available</p> : null}
                            {salesStartAt ? <p className="text-caption">Sales open {formatTicketTime(salesStartAt, eventConfig.timezone)}.</p> : null}
                            {salesEndAt ? <p className="text-caption">Sales close {formatTicketTime(salesEndAt, eventConfig.timezone)}.</p> : null}
                          </div>
                          <SelectField label={`Quantity — ${type.name}`} value={quantities[type.id] || '0'} error={errors[`${type.id}.quantity`]}
                            onChange={(value) => {
                              setQuantities((previous) => ({ ...previous, [type.id]: value }));
                              // A chosen ticket answers the empty-cart error at once.
                              if (Number(value) > 0) setErrors((previous) => (previous.cart === EMPTY_CART ? {} : previous));
                            }}
                            options={[{ value: '0', label: 'No tickets' }, ...(type.available ? Array.from({ length: maximum }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })).filter((option) => Number(option.value) >= (type.minPerOrder || 1)) : [])]} />
                        </div>
                      </fieldset>
                    );
                  })}
                  {errors.cart ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger">{errors.cart}</p> : null}
                  {count
                    ? <p className="font-data tabular-nums">Total for {count} {count === 1 ? 'ticket' : 'tickets'}: {formatTicketMoney(total, catalog.currency)}</p>
                    : <p>Choose at least one ticket to continue.</p>}
                </div>
              ) : null}

              {step.slug === 'attendees' ? (
                <div className="space-y-md">
                  <p>Each attendee receives one ticket. They must sign in with their verified email to claim admission. Buying for someone does not give you their event access.</p>
                  {seats.map(({ type, index, attendee, key }) => (
                    <fieldset key={key} className="min-w-0 space-y-sm border-hairline border-rule-hairline p-md">
                      <legend className="px-xs font-semibold">{type.name} — attendee {index + 1}</legend>
                      <div className="grid gap-md sm:grid-cols-2">
                        <TextField label="First name" value={attendee.firstName || ''} autoComplete="given-name" maxLength={100} required error={errors[`${key}.firstName`]} onChange={(value) => updateAttendee(type.id, index, 'firstName', value)} />
                        <TextField label="Last name" hint="Optional for attendees who use one name." value={attendee.lastName || ''} autoComplete="family-name" maxLength={100} error={errors[`${key}.lastName`]} onChange={(value) => updateAttendee(type.id, index, 'lastName', value)} />
                      </div>
                      <TextField label="Attendee email" type="email" inputMode="email" autoComplete="email" maxLength={254} required value={attendee.email || ''} error={errors[`${key}.email`]} onChange={(value) => updateAttendee(type.id, index, 'email', value)} />
                    </fieldset>
                  ))}
                </div>
              ) : null}

              {step.slug === 'questions' ? (
                <div className="space-y-md">
                  <p>The organizers ask each attendee these questions. Answer them for the person who will use each ticket.</p>
                  {seats.map(({ type, index, attendee, key, label }) => {
                    const prefix = `${key}.answers.`;
                    const fieldErrors = Object.fromEntries(Object.entries(errors).filter(([errorKey]) => errorKey.startsWith(prefix)).map(([errorKey, reason]) => [errorKey.slice(prefix.length), reason]));
                    return (
                      <fieldset key={key} className="min-w-0 space-y-sm border-hairline border-rule-hairline p-md">
                        <legend className="px-xs font-semibold">{label}</legend>
                        <RegistrationQuestionFields form={form} values={attendee.answers} errors={fieldErrors} onChange={(id, value) => updateAnswer(type.id, index, id, value)} />
                      </fieldset>
                    );
                  })}
                </div>
              ) : null}

              {review ? (
                <div className="space-y-md">
                  <dl className="space-y-xs">
                    {lines.map((line) => <div key={line.ticketTypeId} className="flex flex-wrap justify-between gap-sm">
                      <dt>{types.find((type) => type.id === line.ticketTypeId).name} × {line.quantity}</dt>
                      <dd className="font-data tabular-nums">{formatTicketMoney(types.find((type) => type.id === line.ticketTypeId).unitAmount * line.quantity, catalog.currency)}</dd>
                    </div>)}
                    {applied ? <div className="flex flex-wrap justify-between gap-sm">
                      <dt>Promo code {applied.code}</dt><dd className="font-data tabular-nums">−{formatTicketMoney(applied.discountAmount, catalog.currency)}</dd>
                    </div> : null}
                    <div className="flex flex-wrap justify-between gap-sm border-t-hairline border-rule-hairline pt-sm font-semibold">
                      <dt>Total for {count} {count === 1 ? 'ticket' : 'tickets'}</dt><dd className="font-data tabular-nums">{formatTicketMoney(payable, catalog.currency)}</dd>
                    </div>
                  </dl>
                  {count ? <PromoCodeField
                    key={`${promoOwner.generation}:${cartKey}`} user={user} cart={cart} catalogRevision={catalog.catalogRevision} applied={applied} refusal={promoRefusal} onPendingChange={(pending) => { if (promoOwnerRef.current === promoOwner) setPromoPending(pending); }}
                    onApplied={(preview) => { if (promoOwnerRef.current !== promoOwner) return; setPromoRefusal(''); setPromo(preview ? { owner: promoOwner, cartKey, preview } : null); }}
                  /> : null}
                  <p className="text-caption text-text-secondary">{catalog.taxTreatment === 'inclusive' ? 'Any applicable tax is included in these prices.' : 'The organizer has configured this event not to collect tax.'} The organizer pays processing fees; no additional fees are added to your total.</p>
                  <h3 className="font-heading text-h3 font-semibold">Attendees</h3>
                  <ul className="space-y-sm">
                    {seats.map(({ key, label, attendee }) => (
                      <li key={key} className="min-w-0 space-y-2xs border-hairline border-rule-hairline p-sm">
                        <p className="font-medium">{label}</p>
                        <p className="wrap-anywhere text-caption text-text-secondary">{(attendee.email || '').trim()}</p>
                        {questions.length ? (
                          <dl className="space-y-2xs">
                            {questions.map((question) => (
                              <div key={question.id}>
                                <dt className="text-caption font-semibold text-text-secondary">{question.label}</dt>
                                <dd className="wrap-anywhere">{answerText(question, attendee.answers?.[question.id]).trim() || 'Not answered'}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <h3 className="font-heading text-h3 font-semibold">Refund policy</h3>
                  <p className="whitespace-pre-wrap wrap-anywhere">{catalog.refundPolicy}</p>
                  <Checkbox label="I have read and accept the refund policy" checked={termsAccepted} onChange={(event) => {
                    setAcceptedCatalogRevision(event.target.checked && validCatalogRevision ? catalog.catalogRevision : null);
                    setAcceptedByUid(event.target.checked ? user.uid : null);
                  }} error={errors.terms} />
                  {!count ? <p>Choose at least one ticket to continue.</p> : payable > 0 ? <p>Stripe securely collects your payment on the next page. Your tickets are issued only after payment is confirmed. Returning to this site does not confirm a purchase.</p> : <p>No payment is required. The server will confirm available seats before issuing your tickets.</p>}
                </div>
              ) : null}

              <StepPager
                previous={steps[current - 1]}
                next={review ? null : steps[current + 1]}
                hrefFor={hrefFor}
                backClass={secondaryActionClass}
                nextClass={primaryActionClass}
                onNext={goNext}
                last={review ? payControl : null}
              />
            </form>
          </section>
        </div>
      </div>
    );
  }

  return (
    <article className="min-w-0 space-y-lg text-body text-text-primary">
      <div className="space-y-xs">
        {heading}
        <p className="text-lead">{catalog.eventName || eventConfig.name}</p>
        {catalog.mode === 'test' ? <p className="border-hairline border-rule-hairline bg-surface-alt p-sm">Test mode. These tickets do not represent a live purchase.</p> : null}
      </div>
      {!attempt && requestError ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger">{requestError}</p> : null}

      {attempt ? (
        <section className="space-y-sm border-hairline border-rule-hairline bg-surface-alt p-md" aria-labelledby="saved-checkout-heading">
          <h2 id="saved-checkout-heading" className="font-heading text-h2">Continue your existing order</h2>
          <p>A checkout request is already saved for this account. Check or resume that order before starting another purchase. Going back from Stripe does not cancel a payment or release its seats.</p>
          {requestError ? <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger">{requestError}</p> : null}
          <div className="flex flex-wrap gap-sm">
            <button type="button" className={primaryActionClass} aria-busy={busy} aria-disabled={busy} onClick={() => sendCheckout(requestRef.current || (attempt.orderId ? { orderId: attempt.orderId, resume: true } : { requestId: attempt.requestId, resume: true }))}>
              {busy ? 'Opening your order…' : 'Resume existing checkout'}
            </button>
            <Link to={`/tickets/status?${attempt.orderId ? `orderId=${encodeURIComponent(attempt.orderId)}` : `requestId=${encodeURIComponent(attempt.requestId)}`}`} className={secondaryActionClass}>View order status</Link>
          </div>
        </section>
      ) : null}

      {!catalog.salesEnabled ? (
        <section className="space-y-xs">
          <SectionHead title="Ticket sales are closed" />
          <p>{catalog.closedReason || 'The organizers are not accepting new ticket orders right now.'}</p>
          <Link to="/tickets/mine" className={secondaryActionClass}>View your tickets</Link>
        </section>
      ) : authLoading ? <p role="status">Checking your sign-in…</p> : !user ? (
        <section aria-labelledby="ticket-signin-heading" className="space-y-sm">
          <SectionHead title="Sign in to buy tickets" id="ticket-signin-heading" />
          <p>Your verified account keeps your order private. You can assign each ticket to a different attendee after signing in.</p>
          <SignInPanel />
        </section>
      ) : !user.emailVerified ? (
        <section className="space-y-sm">
          <SectionHead title="Verify your email before buying tickets" />
          <p>Sign in with Google or an emailed code for the address that will own this order.</p>
          <button type="button" className={secondaryActionClass} onClick={() => signOut()}>Sign out to verify your email</button>
        </section>
      ) : !attempt ? renderPurchase() : null}
      <p className="no-print"><Link to="/tickets/mine" className="underline">View tickets assigned to you</Link> · <Link to="/ticket/claim" className="underline">Claim an existing ticket</Link></p>
    </article>
  );
}
