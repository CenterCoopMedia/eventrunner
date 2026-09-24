// ChangeRequestModal — the public change request dialog (issue #188). No
// Firebase, no network: lib/changeRequestApi.js is mocked and its answer
// driven here, the same convention as FeedbackModal.test.jsx.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const submitMock = vi.fn();
vi.mock('../lib/changeRequestApi.js', () => ({
  submitChangeRequest: (...args) => submitMock(...args),
}));

import ChangeRequestModal from './ChangeRequestModal.jsx';

const USER = { uid: 'uid-ada', getIdToken: async () => 'id-token' };

function renderModal(props = {}) {
  return render(<ChangeRequestModal onClose={() => {}} user={USER} initialPage="/travel" {...props} />);
}

beforeEach(() => {
  submitMock.mockReset();
});

describe('ChangeRequestModal', () => {
  it('sends the message, the page, and a key with the signed-in user, and states the receipt', async () => {
    submitMock.mockResolvedValueOnce({ ok: true, id: 'k1' });
    renderModal();

    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: '  The hotel is wrong.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('We got your request. The event team will read it.');
    expect(submitMock).toHaveBeenCalledTimes(1);
    const [payload, deps] = submitMock.mock.calls[0];
    expect(payload.message).toBe('The hotel is wrong.');
    expect(payload.page).toBe('/travel');
    expect(payload.submissionKey).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(deps).toEqual({ user: USER });
    // The one control left takes focus, so the keyboard is not dropped.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('prefills the page with the path the reader was on, and sends a blank page as null', async () => {
    submitMock.mockResolvedValueOnce({ ok: true, id: 'k1' });
    renderModal();
    const page = screen.getByLabelText('Page (optional)');
    expect(page).toHaveValue('/travel');
    fireEvent.change(page, { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Add a room.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('status');
    expect(submitMock.mock.calls[0][0].page).toBeNull();
  });

  it('caps the fields at the server’s limits', () => {
    renderModal();
    expect(screen.getByLabelText('What should change?')).toHaveAttribute('maxLength', '2000');
    expect(screen.getByLabelText('Page (optional)')).toHaveAttribute('maxLength', '200');
  });

  it('marks an empty message on the field, moves focus there, and sends nothing', () => {
    vi.useFakeTimers();
    try {
      renderModal();
      const submit = screen.getByRole('button', { name: 'Send request' });
      fireEvent.click(submit);
      act(() => {
        vi.runOnlyPendingTimers();
      });

      const field = screen.getByLabelText('What should change?');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      const ids = field.getAttribute('aria-describedby').split(' ');
      expect(ids.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain('Say what should change.');
      expect(field).toHaveFocus();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(submitMock).not.toHaveBeenCalled();
      // The submit control stays enabled: a dead control announces nothing.
      expect(submit).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('states a refusal from the server as one alert at the head of the form', async () => {
    submitMock.mockResolvedValueOnce({ ok: false, error: 'Too many change requests. Try again later.' });
    renderModal();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many change requests. Try again later.');
    expect(screen.getByLabelText('What should change?')).not.toHaveAttribute('aria-invalid');
  });

  it('shows Sending… with aria-busy while the request is in flight, and disables only then', async () => {
    let settle;
    submitMock.mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }));
    renderModal();
    const submit = screen.getByRole('button', { name: 'Send request' });
    expect(submit).toBeEnabled();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Hello' } });
    fireEvent.click(submit);

    const busy = screen.getByRole('button', { name: 'Sending…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toBeDisabled();
    await act(async () => {
      settle({ ok: true, id: 'k1' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('We got your request.');
  });

  it('reuses the same key on a retry after a failure', async () => {
    submitMock.mockResolvedValueOnce({ ok: false, error: 'We could not reach the server.' });
    submitMock.mockResolvedValueOnce({ ok: true, id: 'k1' });
    renderModal();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('status');

    expect(submitMock).toHaveBeenCalledTimes(2);
    expect(submitMock.mock.calls[1][0].submissionKey).toBe(submitMock.mock.calls[0][0].submissionKey);
  });

  it('a new dialog makes a new key', async () => {
    submitMock.mockResolvedValue({ ok: true, id: 'k' });
    const first = renderModal();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'One' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('status');
    first.unmount();
    renderModal();
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await screen.findByRole('status');
    expect(submitMock.mock.calls[1][0].submissionKey).not.toBe(submitMock.mock.calls[0][0].submissionKey);
  });

  it('closes on Cancel, on Close after a send, and on Escape', async () => {
    const onClose = vi.fn();
    const { container, unmount } = renderModal({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent(container.querySelector('dialog'), new Event('cancel', { bubbles: false, cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
    unmount();

    submitMock.mockResolvedValueOnce({ ok: true, id: 'k1' });
    renderModal({ onClose });
    fireEvent.change(screen.getByLabelText('What should change?'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('opens as a modal dialog labelled by its heading, with focus in the message', () => {
    const opened = [];
    const proto = Object.getPrototypeOf(document.createElement('dialog'));
    const real = proto.showModal;
    proto.showModal = function record() {
      opened.push(this);
      return real.call(this);
    };
    try {
      renderModal();
      expect(opened).toHaveLength(1);
      expect(opened[0].tagName).toBe('DIALOG');
      expect(screen.getByRole('dialog', { name: 'Request a change' })).toBe(opened[0]);
      expect(screen.getByLabelText('What should change?')).toHaveFocus();
    } finally {
      proto.showModal = real;
    }
  });

  it('returns focus to the control that opened it', () => {
    const opener = document.createElement('button');
    opener.textContent = 'Request a change';
    document.body.append(opener);
    opener.focus();
    const view = renderModal();
    expect(opener).not.toHaveFocus();
    view.unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('is set in the public tier, never in the admin identity', () => {
    const { container } = renderModal();
    expect(container.innerHTML).not.toMatch(/admin-/);
    expect(screen.getByLabelText('What should change?')).toHaveClass('border-control');
  });
});
