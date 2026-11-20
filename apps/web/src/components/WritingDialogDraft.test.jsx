import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeedbackModal from './FeedbackModal.jsx';
import ChangeRequestModal from './ChangeRequestModal.jsx';

const { submitFeedback, submitChangeRequest } = vi.hoisted(() => ({
  submitFeedback: vi.fn(),
  submitChangeRequest: vi.fn(),
}));
vi.mock('../lib/feedbackApi.js', () => ({ submitFeedback }));
vi.mock('../lib/changeRequestApi.js', () => ({ submitChangeRequest }));

const forms = [
  {
    Component: FeedbackModal, title: 'Share feedback', messageLabel: 'Message',
    metadataLabel: 'Email (optional)', initialMetadata: '', changedMetadata: 'reader@example.test',
    sendLabel: 'Send feedback', receiptTitle: 'Thanks for letting us know', send: submitFeedback,
  },
  {
    Component: ChangeRequestModal, title: 'Request a change', messageLabel: 'What should change?',
    metadataLabel: 'Page (optional)', initialMetadata: '/travel', changedMetadata: '/venue',
    sendLabel: 'Send request', receiptTitle: 'Request sent', send: submitChangeRequest,
    props: { initialPage: '/travel', user: { uid: 'draft-test' } },
  },
];

function renderForm({ Component, title, messageLabel, metadataLabel, sendLabel, props }) {
  const onClose = vi.fn();
  render(<MemoryRouter><Component onClose={onClose} {...props} /></MemoryRouter>);
  return {
    onClose,
    dialog: screen.getByRole('dialog', { name: title }),
    message: screen.getByLabelText(messageLabel),
    metadata: screen.getByLabelText(metadataLabel),
    sendButton: screen.getByRole('button', { name: sendLabel }),
    cancel: screen.getByRole('button', { name: 'Cancel' }),
    screenshots: screen.getByLabelText('Screenshots (optional)'),
  };
}

function dispatchEscape(dialog, cancelable = true) {
  return fireEvent(dialog, new Event('cancel', { cancelable }));
}

function nativeClose(dialog) {
  // Deliver the native event after the browser has removed the open attribute.
  dialog.removeAttribute('open');
  fireEvent(dialog, new Event('close'));
}

const exits = [
  ['Cancel', ({ cancel }) => fireEvent.click(cancel)],
  ['Escape', ({ dialog }) => dispatchEscape(dialog)],
  ['native close', ({ dialog }) => nativeClose(dialog)],
];

afterEach(() => {
  vi.restoreAllMocks();
  submitFeedback.mockReset();
  submitChangeRequest.mockReset();
  window.localStorage.removeItem('changeRequests.sent.draft-test');
});

describe.each(forms)('$title draft dismissal', (spec) => {
  it.each(exits)('lets a clean form close via %s', (_name, exit) => {
    const form = renderForm(spec);
    expect(form.metadata).toHaveValue(spec.initialMetadata);
    exit(form);
    expect(form.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Keep writing' })).toBeNull();
  });

  it.each(exits)('keeps edited metadata through %s until explicit discard', (_name, exit) => {
    const form = renderForm(spec);
    fireEvent.change(form.metadata, { target: { value: spec.changedMetadata } });
    exit(form);

    const keep = within(form.dialog).getByRole('button', { name: 'Keep writing' });
    const discard = within(form.dialog).getByRole('button', { name: 'Discard draft' });
    expect(screen.getAllByRole('dialog')).toEqual([form.dialog]);
    expect(keep).toHaveFocus();
    expect(keep).toHaveAccessibleDescription('Discard your draft?');
    expect(fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(discard).toHaveFocus();
    expect(fireEvent.keyDown(discard, { key: 'Tab' })).toBe(false);
    expect(keep).toHaveFocus();

    expect(dispatchEscape(form.dialog)).toBe(false);
    dispatchEscape(form.dialog, false);
    nativeClose(form.dialog);
    expect(form.onClose).not.toHaveBeenCalled();
    expect(keep).toHaveFocus();
    fireEvent.click(keep);
    expect(form.message).toHaveFocus();
    expect(form.metadata).toHaveValue(spec.changedMetadata);

    exit(form);
    fireEvent.click(within(form.dialog).getByRole('button', { name: 'Discard draft' }));
    expect(form.onClose).toHaveBeenCalledTimes(1);
  });

  it('protects whitespace in the message', () => {
    const form = renderForm(spec);
    fireEvent.change(form.message, { target: { value: '  ' } });
    fireEvent.click(form.cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
    expect(form.message).toHaveValue('  ');
    expect(form.onClose).not.toHaveBeenCalled();
  });

  it('keeps a screenshot on its own and becomes clean when it is removed', () => {
    const form = renderForm(spec);
    fireEvent.change(form.screenshots, {
      target: { files: [new File(['image'], 'map.png', { type: 'image/png' })] },
    });
    fireEvent.click(form.cancel);
    expect(form.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
    expect(screen.getByRole('list', { name: 'Selected screenshots' })).toHaveTextContent('map.png');
    fireEvent.click(screen.getByRole('button', { name: 'Remove screenshot 1, map.png' }));
    fireEvent.click(form.cancel);
    expect(form.onClose).toHaveBeenCalledTimes(1);
  });

  it('still closes cleanly when a rejected file left only an error', () => {
    const form = renderForm(spec);
    fireEvent.change(form.screenshots, {
      target: { files: [new File([], 'empty.png', { type: 'image/png' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Empty files cannot be attached.');
    fireEvent.click(form.cancel);
    expect(form.onClose).toHaveBeenCalledTimes(1);
  });

  it('blocks exit during encoding and sending, preserves a failed draft, and retries with the same key', async () => {
    let finishEncoding;
    const encode = vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function () {
      finishEncoding = () => {
        Object.defineProperty(this, 'result', { value: 'data:image/png;base64,aW1hZ2U=' });
        this.onload();
      };
    });
    let finishSend;
    spec.send.mockImplementationOnce(() => new Promise((resolve) => { finishSend = resolve; }));
    spec.send.mockResolvedValueOnce({ ok: true, id: 'saved' });

    const form = renderForm(spec);
    fireEvent.change(form.message, { target: { value: 'Update the map.' } });
    fireEvent.change(form.metadata, { target: { value: spec.changedMetadata } });
    fireEvent.change(form.screenshots, {
      target: { files: [new File(['image'], 'map.png', { type: 'image/png' })] },
    });
    act(() => {
      // Deliberate dismissal and a duplicate submit can arrive before React
      // paints the pending state.
      const fields = form.message.closest('form');
      fields.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      fields.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.cancel.click();
      dispatchEscape(form.dialog);
      nativeClose(form.dialog);
    });
    expect(encode).toHaveBeenCalledTimes(1);
    expect(spec.send).not.toHaveBeenCalled();
    expect(form.dialog).toHaveAttribute('open');
    expect(form.onClose).not.toHaveBeenCalled();

    await act(async () => { finishEncoding(); });
    expect(spec.send).toHaveBeenCalledTimes(1);
    fireEvent.click(form.cancel);
    dispatchEscape(form.dialog);
    nativeClose(form.dialog);
    expect(form.dialog).toHaveAttribute('open');
    expect(form.onClose).not.toHaveBeenCalled();

    // The response can settle before the browser delivers the queued close.
    form.dialog.removeAttribute('open');
    await act(async () => { finishSend({ ok: false, error: 'Try again.' }); });
    fireEvent(form.dialog, new Event('close'));
    expect(form.dialog).toHaveAttribute('open');
    expect(screen.getByRole('alert')).toHaveTextContent('Try again.');
    expect(form.onClose).not.toHaveBeenCalled();
    fireEvent.click(form.cancel);
    fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
    expect(form.message).toHaveValue('Update the map.');
    expect(form.metadata).toHaveValue(spec.changedMetadata);
    expect(screen.getByRole('alert')).toHaveTextContent('Try again.');
    expect(screen.getByRole('list', { name: 'Selected screenshots' })).toHaveTextContent('map.png');

    fireEvent.click(form.sendButton);
    await act(async () => { finishEncoding(); });
    expect(screen.getByRole('heading', { name: spec.receiptTitle })).toBeVisible();
    expect(spec.send).toHaveBeenCalledTimes(2);
    expect(spec.send.mock.calls[1][0]).toEqual(spec.send.mock.calls[0][0]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(form.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Keep writing' })).toBeNull();
  });
});

it('protects a feedback category change even with an empty message', () => {
  const form = renderForm(forms[0]);
  const category = screen.getByRole('combobox', { name: 'What is this about?' });
  fireEvent.change(category, { target: { value: 'bug' } });
  fireEvent.click(form.cancel);
  fireEvent.click(screen.getByRole('button', { name: 'Keep writing' }));
  expect(category).toHaveValue('bug');
  fireEvent.change(category, { target: { value: 'feedback' } });
  fireEvent.click(form.cancel);
  expect(form.onClose).toHaveBeenCalledTimes(1);
});
