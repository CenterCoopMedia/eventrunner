// FeedbackModal — the public feedback form (issue #28). No Firebase, no
// network: mocks lib/feedbackApi.js directly and drives its resolution, the
// same convention as the other public-endpoint modules in this app.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const submitFeedbackMock = vi.fn();
vi.mock('../lib/feedbackApi.js', () => ({
  submitFeedback: (...args) => submitFeedbackMock(...args),
}));

import FeedbackModal, { MAX_MESSAGE_LENGTH } from './FeedbackModal.jsx';

beforeEach(() => {
  submitFeedbackMock.mockReset();
});

describe('FeedbackModal', () => {
  it('submits the message, honeypot, and startedAt, and shows a thank-you on success', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'The link is broken.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await screen.findByText('Thanks for letting us know');
    expect(submitFeedbackMock).toHaveBeenCalledTimes(1);
    const payload = submitFeedbackMock.mock.calls[0][0];
    expect(payload.message).toBe('The link is broken.');
    expect(payload.honeypot).toBe('');
    expect(typeof payload.startedAt).toBe('number');
  });

  it('shows the server error inline instead of throwing', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: false, error: 'Too many submissions. Try again later.' });
    render(<FeedbackModal onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many submissions. Try again later.');
  });

  it('refuses to submit an empty message without calling the server', () => {
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(submitFeedbackMock).not.toHaveBeenCalled();
  });

  // ISSUE 219. A refused submit used to state one sentence at the head of
  // the form and stop there: the field that refused carried no
  // `aria-invalid`, nothing named the message, and focus stayed on the
  // submit control. A reader using a screen reader heard nothing move.
  it('marks the field that refused, names its message, and moves focus to it', () => {
    vi.useFakeTimers();
    try {
      render(<FeedbackModal onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
      vi.runOnlyPendingTimers();

      const field = screen.getByLabelText('Message');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      const describedBy = field.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const description = describedBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(' ');
      expect(description).toContain('Please enter a message.');
      expect(field).toHaveFocus();
      // And nothing states it a second time at the head of the form. One
      // result is announced once, and the focus move is the announcement.
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('takes the mark off the field once there is a message to send', () => {
    // The field kept `aria-invalid` and "Please enter a message." while the
    // reader typed the answer to it, so a screen reader announced the field
    // as invalid on every re-read of a field that was no longer empty.
    vi.useFakeTimers();
    try {
      render(<FeedbackModal onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
      vi.runOnlyPendingTimers();

      const field = screen.getByLabelText('Message');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      fireEvent.change(field, { target: { value: 'The link is broken.' } });
      expect(field).not.toHaveAttribute('aria-invalid');
      expect(screen.queryByText('Please enter a message.')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the mark on while the field is still empty', () => {
    // Only a value clears it. A reader who types a space and stops has not
    // answered the refusal, so the field still says so.
    vi.useFakeTimers();
    try {
      render(<FeedbackModal onClose={() => {}} />);
      fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
      vi.runOnlyPendingTimers();

      const field = screen.getByLabelText('Message');
      fireEvent.change(field, { target: { value: '   ' } });
      expect(field).toHaveAttribute('aria-invalid', 'true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the submit control enabled while the form is invalid', () => {
    // A disabled control announces nothing, so a reader who presses it
    // learns nothing (interface guidelines, Interaction states).
    render(<FeedbackModal onClose={() => {}} />);
    const submit = screen.getByRole('button', { name: 'Send feedback' });
    fireEvent.click(submit);
    expect(submit).toBeEnabled();
  });

  it('states a rejection from the server at the head of the form, where no field owns it', async () => {
    // A server refusal belongs to the request, not to one field, so it
    // stays the one urgent line the form announces.
    submitFeedbackMock.mockResolvedValueOnce({ ok: false, error: 'Too many submissions. Try again later.' });
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many submissions. Try again later.');
    expect(screen.getByLabelText('Message')).not.toHaveAttribute('aria-invalid');
  });

  it('closes on Cancel', () => {
    const onClose = vi.fn();
    render(<FeedbackModal onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guards duplicate submits and every dismissal path before pending state renders', async () => {
    let resolve;
    submitFeedbackMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const onClose = vi.fn();
    const { container } = render(<FeedbackModal onClose={onClose} />);
    const message = screen.getByLabelText('Message');
    fireEvent.change(message, { target: { value: 'Please check the schedule link.' } });
    const submit = screen.getByRole('button', { name: 'Send feedback' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const dialog = container.querySelector('dialog');
    const form = message.closest('form');
    const escape = new Event('cancel', { bubbles: false, cancelable: true });
    submit.focus();

    // Native dispatches inside one batch exercise the synchronous guard;
    // a state-only guard still sees the previous render for these events.
    act(() => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      cancel.click();
      dialog.dispatchEvent(escape);
    });

    expect(submitFeedbackMock).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog).toHaveAttribute('open');
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).toHaveAttribute('aria-busy', 'true');
    expect(submit).toHaveAccessibleName('Sending feedback…');
    expect(submit.querySelector('.public-action-label')).toHaveTextContent('Send feedbackSending feedback…');
    expect(submit).toBeEnabled();
    expect(submit).toHaveFocus();
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Sending your feedback.');

    // Native close requests can become noncancelable after an earlier
    // Escape. Model the resulting close, rather than another canceled event.
    dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''));
    act(() => {
      dialog.dispatchEvent(new Event('cancel', { cancelable: false }));
      dialog.removeAttribute('open');
      dialog.dispatchEvent(new Event('close'));
    });
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute('open');
    expect(message).toHaveFocus();
    expect(message).toHaveValue('Please check the schedule link.');
    expect(document.body.style.overflow).toBe('hidden');
    expect(onClose).not.toHaveBeenCalled();
    expect(submitFeedbackMock).toHaveBeenCalledTimes(1);

    await act(async () => { resolve({ ok: true, id: 'f1' }); });
    const receipt = screen.getByRole('heading', { name: 'Thanks for letting us know' });
    expect(receipt).toHaveFocus();
    expect(receipt).toHaveAccessibleDescription('We got your feedback.');
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('freezes the submitted fields, preserves the draft after a failure, and permits an unchanged retry', async () => {
    let resolve;
    submitFeedbackMock
      .mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);
    const message = screen.getByLabelText('Message');
    const email = screen.getByLabelText('Email (optional)');
    const category = screen.getByLabelText('What is this about?');
    fireEvent.change(message, { target: { value: ' Keep this message. ' } });
    fireEvent.change(email, { target: { value: 'reader@example.org' } });
    fireEvent.change(category, { target: { value: 'bug' } });
    const submit = screen.getByRole('button', { name: 'Send feedback' });
    submit.focus();
    fireEvent.click(submit);

    expect(message).toHaveAttribute('readonly');
    expect(email).toHaveAttribute('readonly');
    expect(category).toBeDisabled();
    // Programmatic changes cannot get ahead of the pending payload either.
    fireEvent.change(message, { target: { value: 'Replace the message.' } });
    fireEvent.change(email, { target: { value: '' } });
    fireEvent.change(category, { target: { value: 'other' } });
    await act(async () => { resolve({ ok: false, error: 'Please try again.' }); });

    expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
    expect(message).toHaveValue(' Keep this message. ');
    expect(email).toHaveValue('reader@example.org');
    expect(category).toHaveValue('bug');
    expect(message).not.toHaveAttribute('readonly');
    expect(email).not.toHaveAttribute('readonly');
    expect(category).toBeEnabled();
    expect(submit).not.toHaveAttribute('aria-busy');
    expect(submit).not.toHaveAttribute('aria-disabled');
    expect(submit).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('status').textContent).toBe('');

    fireEvent.click(submit);
    await screen.findByRole('heading', { name: 'Thanks for letting us know' });
    expect(submitFeedbackMock).toHaveBeenCalledTimes(2);
    expect(submitFeedbackMock.mock.calls[1][0].submissionKey).toBe(submitFeedbackMock.mock.calls[0][0].submissionKey);
    expect(screen.getByText(/We got your feedback/)).toHaveTextContent('we’ll try to send a confirmation');
  });

  it('recovers from an unexpected rejected request without losing the draft', async () => {
    submitFeedbackMock.mockRejectedValueOnce(new Error('Unexpected client error'));
    render(<FeedbackModal onClose={() => {}} />);
    const message = screen.getByLabelText('Message');
    fireEvent.change(message, { target: { value: 'Keep this draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not confirm your feedback was received. Please try again.');
    expect(message).toHaveValue('Keep this draft.');
    expect(message).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: 'Send feedback' })).not.toHaveAttribute('aria-disabled');
  });

  it('aborts the outstanding transport when the dialog is unmounted externally', async () => {
    let resolve;
    submitFeedbackMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const view = render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Keep this draft.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    const signal = submitFeedbackMock.mock.calls[0][1].signal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve({ ok: true, id: 'late-receipt' }); });
    expect(screen.queryByText('Thanks for letting us know')).toBeNull();
  });

  // THE DIALOG ITSELF. The modal used to be a <div> over the page, so Tab
  // walked out of it and into the page behind (issue 233). It is now a
  // native <dialog>, whose showModal() owns the inert page and top
  // layer. Explicit Tab boundaries keep keyboard focus in the document.
  // jsdom can observe these explicit focus moves but cannot prove native
  // traversal or modality; hosted browser tests cover those behaviors.
  it('opens as a modal dialog rather than as an overlay', () => {
    const opened = [];
    const proto = Object.getPrototypeOf(document.createElement('dialog'));
    const real = proto.showModal;
    proto.showModal = function record() {
      opened.push(this);
      return real.call(this);
    };
    try {
      render(<FeedbackModal onClose={() => {}} />);
      expect(opened).toHaveLength(1);
      expect(opened[0].tagName).toBe('DIALOG');
      expect(opened[0]).toHaveAttribute('open');
    } finally {
      proto.showModal = real;
    }
  });

  it('closes on Escape, which reaches a dialog as cancel', () => {
    const onClose = vi.fn();
    const { container } = render(<FeedbackModal onClose={onClose} />);
    const dialog = container.querySelector('dialog');
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the message after the native dialog chooses its initial control', () => {
    render(<FeedbackModal onClose={() => {}} />);
    expect(screen.getByLabelText('Message')).toHaveFocus();
    expect(screen.getByLabelText('What is this about?')).not.toHaveFocus();
  });

  it('wraps Tab from Send to the category and Shift+Tab back to Send', () => {
    render(<FeedbackModal onClose={() => {}} />);
    const category = screen.getByLabelText('What is this about?');
    const submit = screen.getByRole('button', { name: 'Send feedback' });
    submit.focus();
    expect(fireEvent.keyDown(submit, { key: 'Tab' })).toBe(false);
    expect(category).toHaveFocus();
    expect(fireEvent.keyDown(category, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(submit).toHaveFocus();
  });

  it('skips the disabled category while retaining pending actions in the keyboard loop', async () => {
    let resolve;
    submitFeedbackMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    render(<FeedbackModal onClose={() => {}} />);
    const message = screen.getByLabelText('Message');
    fireEvent.change(message, { target: { value: 'Please check the schedule link.' } });
    const submit = screen.getByRole('button', { name: 'Send feedback' });
    submit.focus();
    fireEvent.click(submit);

    expect(screen.getByLabelText('What is this about?')).toBeDisabled();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(fireEvent.keyDown(submit, { key: 'Tab' })).toBe(false);
    expect(message).toHaveFocus();
    expect(message).toHaveAttribute('readonly');
    expect(fireEvent.keyDown(message, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(submit).toHaveFocus();

    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeEnabled();
    expect(cancel).toHaveAttribute('aria-disabled', 'true');
    cancel.focus();
    // Cancel sits between the email field and Send: native traversal still
    // owns this step, even while its activation is guarded.
    expect(fireEvent.keyDown(cancel, { key: 'Tab' })).toBe(true);
    await act(async () => { resolve({ ok: false, error: 'Please try again.' }); });
  });

  it('keeps both receipt boundaries on Close after announcing the heading', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    const heading = await screen.findByRole('heading', { name: 'Thanks for letting us know' });
    const close = screen.getByRole('button', { name: 'Close' });
    expect(heading).toHaveFocus();
    expect(fireEvent.keyDown(heading, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(close).toHaveFocus();
    for (const shiftKey of [false, true]) {
      expect(fireEvent.keyDown(close, { key: 'Tab', shiftKey })).toBe(false);
      expect(close).toHaveFocus();
    }
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('locks page scrolling while open and restores the previous overflow on unmount', () => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'scroll';
    let view;
    try {
      view = render(<FeedbackModal onClose={() => {}} />);
      const dialog = view.container.querySelector('dialog');
      expect(document.body.style.overflow).toBe('hidden');
      view.unmount();
      expect(document.body.style.overflow).toBe('scroll');
      expect(dialog).not.toHaveAttribute('open');
    } finally {
      view?.unmount();
      document.body.style.overflow = previousOverflow;
    }
  });

  it('returns focus to the control that opened it', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Share feedback';
    document.body.append(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const view = render(<FeedbackModal onClose={() => {}} />);
    // React removes the dialog on close, and an element removed while it
    // holds focus drops focus to the body. The opener has to be put back.
    expect(opener).not.toHaveFocus();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('carries the honeypot field out of the tab order and off-screen', () => {
    render(<FeedbackModal onClose={() => {}} />);
    const honeypot = screen.getByLabelText('Leave this field blank');
    expect(honeypot).toHaveAttribute('tabIndex', '-1');
  });

  it('draws its field borders on the accessible control token, not the hairline rule', () => {
    // WCAG 1.4.11: a form control's boundary needs 3:1 against its ground.
    // --rule-hairline is deliberately below that bar (design brief §3.7), so
    // these fields (components/forms/publicForm.jsx) use
    // --color-border-control instead.
    render(<FeedbackModal onClose={() => {}} />);
    expect(screen.getByLabelText('Message')).toHaveClass('border-control');
    expect(screen.getByLabelText('Message')).not.toHaveClass('border-rule-hairline');
  });

  it('is set in the public tier, never in the admin identity', () => {
    // This is a visitor-facing form. The admin identity is fixed operator
    // tooling (brief §5.2), so an admin-* token on this surface is a tier
    // mismatch — the one PR1 flagged, and the reason publicForm.jsx exists.
    const { container } = render(<FeedbackModal onClose={() => {}} />);
    expect(container.innerHTML).not.toMatch(/admin-/);
    expect(screen.getByLabelText('Message')).toHaveClass('bg-surface');
  });

  it('never asserts the confirmation email was delivered (Codex P2: the send is best-effort and can fail silently)', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'attendee@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await screen.findByRole('heading', { name: 'Thanks for letting us know' });
    const receipt = screen.getByText(/We got your feedback/);
    expect(receipt).toHaveTextContent('We got your feedback.');
    // Receipt-only: it hedges ("try to send"), never claims delivery.
    expect(receipt.textContent).not.toMatch(/sent a confirmation/i);
    expect(receipt).toHaveTextContent('we’ll try to send a confirmation');
  });

  it('sends a submissionKey and reuses the SAME one across a retry (Codex P2 idempotency)', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: false, error: 'network blip' });
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('We got your feedback.');

    expect(submitFeedbackMock).toHaveBeenCalledTimes(2);
    const firstKey = submitFeedbackMock.mock.calls[0][0].submissionKey;
    const secondKey = submitFeedbackMock.mock.calls[1][0].submissionKey;
    expect(typeof firstKey).toBe('string');
    expect(firstKey.length).toBeGreaterThanOrEqual(8);
    expect(secondKey).toBe(firstKey);
  });

  it('refuses an over-limit edit after a failed send, then reuses the key for the original boundary payload', async () => {
    submitFeedbackMock
      .mockResolvedValueOnce({ ok: false, error: 'network blip' })
      .mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);

    const field = screen.getByLabelText('Message');
    const boundaryMessage = 'm'.repeat(MAX_MESSAGE_LENGTH);
    expect(field).toHaveAttribute('maxLength', String(MAX_MESSAGE_LENGTH));
    expect(screen.getByText(`Up to ${MAX_MESSAGE_LENGTH.toLocaleString('en-US')} characters.`)).toBeVisible();

    fireEvent.change(field, { target: { value: boundaryMessage } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('alert');
    const firstKey = submitFeedbackMock.mock.calls[0][0].submissionKey;

    // Browser input enforces maxLength. This direct state event covers a
    // programmatic fill and ensures the modal still never sends text that
    // the server would silently truncate under a different retry key.
    fireEvent.change(field, { target: { value: `${boundaryMessage}x` } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(submitFeedbackMock).toHaveBeenCalledTimes(1);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Please keep your message to 4,000 characters.')).toBeVisible();

    fireEvent.change(field, { target: { value: boundaryMessage } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('heading', { name: 'Thanks for letting us know' });

    expect(submitFeedbackMock).toHaveBeenCalledTimes(2);
    expect(submitFeedbackMock.mock.calls[1][0].message).toBe(boundaryMessage);
    expect(submitFeedbackMock.mock.calls[1][0].submissionKey).toBe(firstKey);
  });

  it('takes a new submissionKey when a normalized feedback field changes after a failure', async () => {
    submitFeedbackMock
      .mockResolvedValueOnce({ ok: false, error: 'network blip' })
      .mockResolvedValueOnce({ ok: false, error: 'network blip' })
      .mockResolvedValueOnce({ ok: false, error: 'network blip' })
      .mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText('Email (optional)'), { target: { value: 'reader@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText('What is this about?'), { target: { value: 'bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('alert');

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('heading', { name: 'Thanks for letting us know' });

    const keys = submitFeedbackMock.mock.calls.map(([payload]) => payload.submissionKey);
    expect(new Set(keys).size).toBe(4);
  });

  it('omits the confirmation mention entirely when no email was given', async () => {
    submitFeedbackMock.mockResolvedValueOnce({ ok: true, id: 'f1' });
    render(<FeedbackModal onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));

    await screen.findByRole('heading', { name: 'Thanks for letting us know' });
    const receipt = screen.getByText(/We got your feedback/);
    expect(receipt.textContent.trim()).toBe('We got your feedback.');
  });
});
