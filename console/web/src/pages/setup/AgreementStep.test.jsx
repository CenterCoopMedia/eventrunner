import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api.js';
import { application, callsTo, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', async (importOriginal) => ({ ...(await importOriginal()), callApi: vi.fn() }));

const AGREEMENT = { version: 3, title: 'Test agreement', body: 'First test paragraph.\n\nSecond test paragraph.', sha256: 'h' };

beforeEach(() => {
  serveApi({ getAgreement: { agreement: AGREEMENT, accepted: null } });
});

describe('Agreement step', () => {
  it('shows the full agreement in paragraphs, with its version', async () => {
    renderSetup('agreement');
    expect(await screen.findByRole('heading', { level: 2, name: 'Test agreement' })).toBeInTheDocument();
    expect(screen.getByText('Version 3')).toBeInTheDocument();
    expect(screen.getByText('First test paragraph.')).toBeInTheDocument();
    expect(screen.getByText('Second test paragraph.')).toBeInTheDocument();
  });

  it('renders the text as text, never as HTML', async () => {
    const body = '<img src=x onerror="alert(1)"> <b>bold</b>';
    serveApi({ getAgreement: { agreement: { ...AGREEMENT, body }, accepted: null } });
    renderSetup('agreement');
    const article = (await screen.findByRole('heading', { level: 2, name: 'Test agreement' })).closest('article');
    expect(article).toHaveTextContent(body);
    expect(article.querySelector('img')).toBeNull();
    expect(article.querySelector('b')).toBeNull();
  });

  it('accepts the version on the page and moves to the fee', async () => {
    let status = 'draft';
    serveApi({
      getAgreement: { agreement: AGREEMENT, accepted: null },
      getApplication: () => ({ application: application(status === 'draft' ? {} : { status, canEdit: false, canAccept: false, canPay: true }) }),
      acceptAgreement: () => { status = 'awaiting_payment'; return { status, copySent: true }; },
    });
    renderSetup('agreement');
    fireEvent.change(await screen.findByLabelText('Your full name'), { target: { value: 'Ana Owner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Event fee' })).toBeInTheDocument();
    expect(callsTo('acceptAgreement')).toEqual([{ orgId: 'o1', appId: 'a1', accept: true, name: 'Ana Owner', version: 3 }]);
    expect(screen.queryByText(/could not email your copy/)).not.toBeInTheDocument();
  });

  it('says so on the next step when the copy could not be emailed', async () => {
    let status = 'draft';
    serveApi({
      getAgreement: { agreement: AGREEMENT, accepted: null },
      getApplication: () => ({ application: application(status === 'draft' ? {} : { status, canEdit: false, canAccept: false, canPay: true }) }),
      acceptAgreement: () => { status = 'awaiting_payment'; return { status, copySent: false }; },
    });
    renderSetup('agreement');
    fireEvent.change(await screen.findByLabelText('Your full name'), { target: { value: 'Ana Owner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(await screen.findByText(/could not email your copy of the agreement/)).toBeInTheDocument();
  });

  it('shows a refused name at the field', async () => {
    serveApi({
      getAgreement: { agreement: AGREEMENT, accepted: null },
      acceptAgreement: () => { throw new ApiError(400, 'name-required', 'Type your full name to accept the agreement.', {}, 'name'); },
    });
    renderSetup('agreement');
    await screen.findByLabelText('Your full name');
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(await screen.findByText('Type your full name to accept the agreement.')).toBeInTheDocument();
    expect(screen.getByLabelText('Your full name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the new text when the agreement changed, and keeps the typed name', async () => {
    let current = AGREEMENT;
    serveApi({
      getAgreement: () => ({ agreement: current, accepted: null }),
      acceptAgreement: () => {
        current = { ...AGREEMENT, version: 4, body: 'A changed test paragraph.' };
        throw new ApiError(409, 'agreement-changed', 'The agreement changed. Read the new version, then accept it.');
      },
    });
    renderSetup('agreement');
    fireEvent.change(await screen.findByLabelText('Your full name'), { target: { value: 'Ana Owner' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(await screen.findByText('A changed test paragraph.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The agreement changed.');
    expect(screen.getByText('Version 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Your full name')).toHaveValue('Ana Owner');
  });

  it('tells an Editor that only an Owner can accept', async () => {
    serveApi({
      getAgreement: { agreement: AGREEMENT, accepted: null },
      getApplication: { application: application({ myRole: 'editor', canAccept: false }) },
    });
    renderSetup('agreement');
    expect(await screen.findByText(/Only an Owner can accept the agreement/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your full name')).not.toBeInTheDocument();
  });

  it('shows who accepted, with no form, once the request waits for payment', async () => {
    serveApi({
      getApplication: { application: application({ status: 'awaiting_payment', canEdit: false, canAccept: false, canPay: true }) },
      getAgreement: {
        agreement: AGREEMENT,
        accepted: { version: 3, name: 'Ana Owner', email: 'ana@example.org', at: '2026-11-04T15:00:00.000Z' },
      },
    });
    renderSetup('agreement');
    expect(await screen.findByText(/Ana Owner \(ana@example.org\) accepted this agreement on 4 November 2026/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Your full name')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});
