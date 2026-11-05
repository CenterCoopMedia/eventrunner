import { fireEvent, screen } from '@testing-library/react';
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

  it('accepts the version on the page and opens the status page', async () => {
    serveApi({
      getAgreement: { agreement: AGREEMENT, accepted: null },
      acceptAgreement: { status: 'approved', acceptanceId: 'r1', copySent: true, buildStarted: true },
    });
    renderSetup('agreement');
    fireEvent.change(await screen.findByLabelText('Your full name'), { target: { value: 'Ana Owner' } });
    fireEvent.change(screen.getByLabelText("Your organization's legal name"), { target: { value: 'NC Local Inc.' } });
    fireEvent.change(screen.getByLabelText('Your job title'), { target: { value: 'Director' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(await screen.findByText('Status page')).toBeInTheDocument();
    expect(callsTo('acceptAgreement')).toEqual([{
      orgId: 'o1', appId: 'a1', accept: true, name: 'Ana Owner', legalName: 'NC Local Inc.', title: 'Director', version: 3,
    }]);
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

  it('shows a refused legal name at its own field', async () => {
    serveApi({
      getAgreement: { agreement: AGREEMENT, accepted: null },
      acceptAgreement: () => { throw new ApiError(400, 'legalName-required', "Type your organization's legal name to accept the agreement.", {}, 'legalName'); },
    });
    renderSetup('agreement');
    await screen.findByLabelText("Your organization's legal name");
    fireEvent.click(screen.getByRole('button', { name: 'Accept the agreement' }));
    expect(await screen.findByText("Type your organization's legal name to accept the agreement.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your organization's legal name")).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Your full name')).not.toHaveAttribute('aria-invalid', 'true');
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
});
