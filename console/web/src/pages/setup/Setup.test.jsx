import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

beforeEach(() => {
  serveApi();
});

describe('Setup', () => {
  it('shows one step per page with a step list, its progress and the current step', async () => {
    serveApi({
      getApplication: { application: application({ progress: { organization: true, event: true } }) },
    });
    renderSetup('event');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 7')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Setup steps' });
    expect(within(nav).getByText('2 of 7 steps done')).toBeInTheDocument();
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent.replace(' (done)', '').replace(/^[✓\d]+/, ''))).toEqual([
      'Your organization', 'Your event', 'Your web address', 'Your team', 'Tickets', 'Email', 'Review',
    ]);
    expect(links[1]).toHaveAttribute('aria-current', 'step');
    expect(links[0]).toHaveTextContent('(done)');
    expect(links[2]).toHaveAttribute('href', '/organizations/o1/applications/a1/web-address');
    expect(callApi).toHaveBeenCalledWith('getApplication', { orgId: 'o1', appId: 'a1' });
  });

  it('Next and Back move between steps at their own addresses', async () => {
    renderSetup('organization');
    await screen.findByRole('heading', { level: 1, name: 'Your organization' });
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
  });

  it('a step-list link moves to that step', async () => {
    renderSetup('organization');
    await screen.findByRole('heading', { level: 1, name: 'Your organization' });
    fireEvent.click(screen.getByRole('link', { name: /Email/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Email' })).toBeInTheDocument();
  });

  it('saves as the reader types, after a pause, and says Saved quietly', async () => {
    serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
    renderSetup('organization');
    const field = await screen.findByLabelText('Mailing address');
    fireEvent.change(field, { target: { value: '1 Main' } });
    fireEvent.change(field, { target: { value: '1 Main Street, Raleigh' } });
    expect(screen.getByText('Saving.')).toBeInTheDocument();
    await waitFor(() => expect(callsTo('saveApplicationStep')).toHaveLength(1), { timeout: 2000 });
    expect(callsTo('saveApplicationStep')[0]).toEqual({
      orgId: 'o1',
      appId: 'a1',
      step: 'organization',
      answers: { name: 'NC Local', website: '', address: '1 Main Street, Raleigh' },
    });
    expect(await screen.findByText('Saved.')).toHaveAttribute('role', 'status');
  });

  it('Next sends a waiting save first', async () => {
    serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'nclocal.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    expect(callsTo('saveApplicationStep')[0].answers.website).toBe('nclocal.org');
  });

  it('shows an error by field once the reader has touched the field', async () => {
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers(), errors: { 'organization.address': 'Enter the mailing address.' } }) },
      saveApplicationStep: (body) => ({
        step: body.step, saved: true, answers: body.answers, errors: { 'organization.address': 'Use at least 10 characters.' },
      }),
    });
    renderSetup('organization');
    const field = await screen.findByLabelText('Mailing address');
    expect(screen.queryByText('Enter the mailing address.')).not.toBeInTheDocument();
    fireEvent.blur(field);
    expect(screen.getByText('Enter the mailing address.')).toBeInTheDocument();
    fireEvent.change(field, { target: { value: '1 Main' } });
    await waitFor(() => expect(callsTo('saveApplicationStep')).toHaveLength(1), { timeout: 2000 });
    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain('f-organization-address-error');
  });

  it('with ?check=1 shows every error and focuses the first field with one', async () => {
    serveApi({
      getApplication: {
        application: application({
          answers: emptyAnswers(),
          errors: { 'organization.address': 'Enter the mailing address.', 'event.name': 'Enter the event name.' },
        }),
      },
    });
    renderSetup('organization', { query: '?check=1' });
    const field = await screen.findByLabelText('Mailing address');
    expect(screen.getByText('Enter the mailing address.')).toBeInTheDocument();
    expect(screen.queryByText('Enter the event name.')).not.toBeInTheDocument();
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('with ?check=1 the focus stays where the reader types after the first focus', async () => {
    serveApi({
      getApplication: {
        application: application({
          answers: emptyAnswers(),
          errors: { 'organization.name': 'Enter the name.', 'organization.address': 'Enter the mailing address.' },
        }),
      },
      saveApplicationStep: (body) => ({
        step: body.step, saved: true, answers: body.answers, errors: { 'organization.name': 'Enter the name.', 'organization.address': 'Use at least 10 characters.' },
      }),
    });
    renderSetup('organization', { query: '?check=1' });
    const name = await screen.findByLabelText('Organization name');
    await waitFor(() => expect(name).toHaveFocus());
    const address = screen.getByLabelText('Mailing address');
    address.focus();
    fireEvent.change(address, { target: { value: '1 Main' } });
    expect(address).toHaveFocus();
    await waitFor(() => expect(callsTo('saveApplicationStep')).toHaveLength(1), { timeout: 2000 });
    await screen.findByText('Saved.');
    expect(address).toHaveFocus();
  });

  it('shows the note when the hosting team asked for changes', async () => {
    serveApi({ getApplication: { application: application({ status: 'changes_requested', note: 'Add the venue address.' }) } });
    renderSetup('event');
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('The hosting team asked for changes');
    expect(note).toHaveTextContent('Add the venue address.');
  });

  it('sends a request the reader cannot change to its status page', async () => {
    serveApi({ getApplication: { application: application({ status: 'submitted', canEdit: false }) } });
    renderSetup('event');
    expect(await screen.findByText('Status page')).toBeInTheDocument();
  });

  it('sends an unknown step to the first step', async () => {
    renderSetup('nowhere');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
  });

  it('shows a load error', async () => {
    serveApi({ getApplication: () => { throw new Error('We could not find that request.'); } });
    renderSetup('event');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that request.');
  });

  it('says when a save fails', async () => {
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers() }) },
      saveApplicationStep: () => { throw new Error('This request is with the hosting team, so you cannot change it now.'); },
    });
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'x.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Not saved. This request is with the hosting team/)).toBeInTheDocument();
  });

  it('stays on the step when a save fails, and Next tries the same answers again', async () => {
    let calls = 0;
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers() }) },
      saveApplicationStep: (body) => {
        calls += 1;
        if (calls === 1) throw new Error('We could not reach the server. Try again.');
        return { step: body.step, saved: true, answers: body.answers, errors: {} };
      },
    });
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'x.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/Not saved. We could not reach the server/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    expect(callsTo('saveApplicationStep').map((b) => b.answers.website)).toEqual(['x.org', 'x.org']);
  });
});
