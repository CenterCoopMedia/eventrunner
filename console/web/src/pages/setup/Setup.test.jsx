import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { callApi } from '../../api.js';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';
import { keepAnswer, readKeptAnswer } from '../../setup/keptAnswers.js';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

beforeEach(() => {
  serveApi();
});

function setupViewport(wide) {
  const query = new EventTarget();
  query.matches = wide;
  vi.stubGlobal('matchMedia', () => query);
  return (next) => {
    query.matches = next;
    query.dispatchEvent(new Event('change'));
  };
}

describe('Setup', () => {
  it.each(['use', 'discard'])('offers a failed answer after reload and lets the reader %s it explicitly', async (choice) => {
    const scope = { userId: 'ana', orgId: 'o1', appId: 'a1' };
    serveApi({ saveApplicationStep: () => { throw new Error('Offline'); } });
    const first = renderSetup('organization');
    const field = await screen.findByLabelText('Organization name');
    fireEvent.change(field, { target: { value: 'Unsaved organization' } });
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    await screen.findByText(/Not saved/);
    await act(async () => first.unmount());
    serveApi();
    callApi.mockClear();
    renderSetup('organization');
    const use = await screen.findByRole('button', { name: 'Use kept answer' });
    expect(screen.getByLabelText('Organization name')).toHaveValue('NC Local');
    expect(callsTo('saveApplicationStep')).toHaveLength(0);
    fireEvent.click(choice === 'use' ? use : screen.getByRole('button', { name: 'Discard kept answer' }));
    expect(screen.queryByRole('button', { name: 'Use kept answer' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveFocus();
    if (choice === 'use') {
      expect(screen.getByLabelText('Organization name')).toHaveValue('Unsaved organization');
      fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
      await screen.findByRole('heading', { name: 'Your event' });
      expect(callsTo('saveApplicationStep')[0].answers.name).toBe('Unsaved organization');
    }
    expect(readKeptAnswer(scope, 'organization')).toBeNull();
  });

  it('offers no answer from another user in this tab', async () => {
    keepAnswer({ userId: 'someone-else', orgId: 'o1', appId: 'a1' }, { step: 'organization', answers: { name: 'Private answer' } });
    renderSetup('organization');
    await screen.findByLabelText('Organization name');
    expect(screen.queryByRole('button', { name: 'Use kept answer' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Organization name')).toHaveValue('NC Local');
  });

  it('shows one step per page with a step list, its progress and the current step', async () => {
    serveApi({
      getApplication: { application: application({ progress: { organization: true, event: true, team: true } }) },
    });
    renderSetup('event');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Setup steps' });
    expect(within(nav).getByText('3 of 8 steps done')).toBeInTheDocument();
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent.replace(/^[✓\d]+/, ''))).toEqual([
      'Your organizationDone', 'Your eventDone', 'Your web addressTo do', 'Your teamDone', 'TicketsTo do', 'EmailTo do', 'ReviewTo do', 'AgreementTo do',
    ]);
    expect(links[1]).toHaveAttribute('aria-current', 'step');
    expect(links[0]).toHaveAccessibleName('Your organization Done');
    expect(within(links[0]).getByText('Done')).not.toHaveClass('visually-hidden');
    expect(links[2]).toHaveAttribute('href', '/organizations/o1/applications/a1/web-address');
    expect(callApi).toHaveBeenCalledWith('getApplication', { orgId: 'o1', appId: 'a1' });
  });

  it('shows the optional team step as To do until there are two Owners without locking setup', async () => {
    serveApi({ getApplication: { application: application({ ownersNeeded: 1 }) } });
    renderSetup('review');
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    const nav = screen.getByRole('navigation', { name: 'Setup steps' });
    const team = within(nav).getByRole('link', { name: 'Your team To do' });
    expect(within(team).getByText('To do')).not.toHaveClass('visually-hidden');
    expect(within(nav).getByText('6 of 8 steps done')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Agreement To do' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next: Agreement' })).toBeInTheDocument();
    fireEvent.click(team);
    expect(await screen.findByRole('heading', { level: 1, name: 'Your team' })).toBeInTheDocument();
  });

  it.each([
    [{ errors: { 'event.name': 'Enter the event name.' } }, 'Finish the answers that need attention first.'],
    [{ signups: { open: false } }, 'This site is not taking sign-ups right now. Try again later.'],
  ])('explains a locked Agreement in visible words', async (overrides, reason) => {
    serveApi({ getApplication: { application: application(overrides) } });
    renderSetup('organization');
    await screen.findByRole('heading', { level: 1, name: 'Your organization' });
    const nav = screen.getByRole('navigation', { name: 'Setup steps' });
    const row = within(nav).getByText('Agreement').closest('li');
    expect(within(row).getByText('Not started')).not.toHaveClass('visually-hidden');
    expect(within(row).getByText(reason)).toBeInTheDocument();
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });

  it('folds the single step list behind a native disclosure on a narrow screen', async () => {
    setupViewport(false);
    renderSetup('event');
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Setup steps' });
    const summary = within(nav).getByText('Show all 8 steps');
    expect(summary.tagName).toBe('SUMMARY');
    expect(summary.parentElement).not.toHaveAttribute('open');
    expect(within(nav).getAllByRole('list', { hidden: true })).toHaveLength(1);
    fireEvent.click(summary);
    const links = within(nav).getAllByRole('link');
    expect(links).toHaveLength(8);
    expect(links[1]).toHaveAttribute('aria-current', 'step');
  });

  it('keeps the current step and draft when the layout changes across the breakpoint', async () => {
    const resize = setupViewport(false);
    renderSetup('organization');
    const name = await screen.findByLabelText('Organization name');
    fireEvent.change(name, { target: { value: 'Edited organization' } });
    act(() => resize(true));
    expect(screen.queryByText('Show all 8 steps')).not.toBeInTheDocument();
    expect(screen.getAllByRole('navigation', { name: 'Setup steps' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Your organization/ })).toHaveAttribute('aria-current', 'step');
    expect(name).toHaveValue('Edited organization');
    act(() => resize(false));
    expect(screen.getByText('Show all 8 steps').parentElement).not.toHaveAttribute('open');
    expect(screen.getByText('Step 1 of 8')).toBeInTheDocument();
    expect(name).toHaveValue('Edited organization');
  });

  it('saves a draft through a folded step link and closes the list on the next step', async () => {
    setupViewport(false);
    renderSetup('organization');
    const name = await screen.findByLabelText('Organization name');
    fireEvent.change(name, { target: { value: 'Edited organization' } });
    fireEvent.click(screen.getByText('Show all 8 steps'));
    fireEvent.click(screen.getByRole('link', { name: /Your event/ }));
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    expect(callsTo('saveApplicationStep')[0].answers.name).toBe('Edited organization');
    expect(screen.getByText('Show all 8 steps').parentElement).not.toHaveAttribute('open');
    expect(screen.getByText('Step 2 of 8')).toBeInTheDocument();
  });

  it('Next and Back move between steps at their own addresses', async () => {
    renderSetup('organization');
    await screen.findByRole('heading', { level: 1, name: 'Your organization' });
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
  });

  it.each(['your organization', 'your event', 'your web address', 'your team', 'tickets', 'email'])('returns from editing %s without saving when nothing changed', async (title) => {
    renderSetup('review');
    fireEvent.click(await screen.findByRole('link', { name: `Edit ${title}` }));
    const back = await screen.findByRole('button', { name: 'Back to Review' });
    expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument();
    fireEvent.click(back);
    expect(await screen.findByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
    expect(callsTo('saveApplicationStep')).toHaveLength(0);
  });

  it('waits for the changed answer to save, then returns to Review with its remaining problems', async () => {
    let finish;
    serveApi({ saveApplicationStep: (body) => new Promise((resolve) => {
      finish = () => resolve({ step: body.step, saved: true, errors: { 'organization.website': 'Use a complete website address.' } });
    }) });
    renderSetup('review');
    fireEvent.click(await screen.findByRole('link', { name: 'Edit your organization' }));
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'nclocal.org' } });
    const back = screen.getByRole('button', { name: 'Back to Review' });
    fireEvent.click(back);
    await waitFor(() => expect(callsTo('saveApplicationStep')).toHaveLength(1));
    expect(back).toBeDisabled();
    expect(screen.getByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
    finish();
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(screen.getByText('nclocal.org')).toBeInTheDocument();
    expect(callsTo('saveApplicationStep')[0].answers.website).toBe('nclocal.org');
    const problems = screen.getByRole('region', { name: 'Answers that need attention' });
    expect(problems).toHaveTextContent('Use a complete website address.');
    fireEvent.click(within(problems).getByRole('link', { name: 'Your organization' }));
    await screen.findByLabelText('Website (optional)');
    const stepProblems = screen.getByRole('region', { name: 'Answers that need attention' });
    expect(within(stepProblems).getByRole('link', { name: 'Your organization' }))
      .toHaveAttribute('href', '/organizations/o1/applications/a1/organization?check=1&from=review');
    expect(screen.getByRole('button', { name: 'Back to Review' })).toBeInTheDocument();
  });

  it.each(['transport failure', 'refused answer'])('stays on a Review edit after a %s, then returns after a successful save', async (outcome) => {
    let fail = true;
    const SHORT = 'Use 3 to 27 lowercase letters, numbers and hyphens.';
    serveApi({ saveApplicationStep: (body) => {
      if (fail && outcome === 'transport failure') throw new Error('We could not reach the server. Try again.');
      return { step: body.step, saved: !fail, errors: fail ? { 'webAddress.name': SHORT } : {} };
    } });
    renderSetup('web-address', { query: '?from=review' });
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: outcome === 'refused answer' ? 'ab' : 'nclocal2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }));
    expect(await screen.findByText(/Not saved\./)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your web address' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument();
    if (outcome === 'refused answer') {
      await waitFor(() => expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(new RegExp(SHORT.replaceAll('.', '\\.'))));
      expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByRole('region', { name: 'Answers that need attention' })).toHaveTextContent(SHORT);
      expect(screen.getByRole('button', { name: 'Back to Review' })).toBeInTheDocument();
    }
    fail = false;
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'nclocal3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(screen.getByText('nclocal3.eventrunner.org')).toBeInTheDocument();
    expect(callsTo('saveApplicationStep')).toHaveLength(2);
  });

  it('Back, the step list and Close move without checking field errors', async () => {
    serveApi({ getApplication: { application: application({ errors: {
      'organization.address': 'Enter the mailing address.', 'event.name': 'Enter the event name.', 'email.replyTo': 'Enter a reply address.',
    } }) } });
    renderSetup('event', { query: '?check=1' });
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'Your organization' });
    fireEvent.click(screen.getByRole('link', { name: /Email/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Email' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Close setup' }));
    expect(await screen.findByText('Status page')).toBeInTheDocument();
    expect(callsTo('saveApplicationStep')).toHaveLength(0);
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

  it.each(['valid', 'invalid'])('Next checks the %s result of a waiting save', async (outcome) => {
    const message = 'Use a complete website address.';
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers() }) },
      saveApplicationStep: (body) => ({ step: body.step, saved: true, answers: body.answers,
        errors: outcome === 'invalid' ? { 'organization.website': message } : {} }),
    });
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'nclocal.org' } });
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    if (outcome === 'valid') await screen.findByRole('heading', { level: 1, name: 'Your event' });
    else {
      const problems = await screen.findByRole('region', { name: 'Answers that need attention' });
      expect(within(problems).getByRole('listitem')).toHaveTextContent(message);
      expect(screen.getByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
      await waitFor(() => expect(screen.getByLabelText('Website (optional)')).toHaveFocus());
    }
    expect(callsTo('saveApplicationStep')[0].answers.website).toBe('nclocal.org');
  });

  it('closing setup saves waiting changes before opening the status page', async () => {
    serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'nclocal.org' } });
    fireEvent.click(screen.getByRole('link', { name: 'Close setup' }));
    await screen.findByText('Status page');
    expect(callsTo('saveApplicationStep')[0].answers.website).toBe('nclocal.org');
  });

  it('waits for Next to show errors and keeps them until a save confirms validity', async () => {
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers(), errors: { 'organization.address': 'Enter the mailing address.' } }) },
      saveApplicationStep: (body) => ({
        step: body.step, saved: true, answers: body.answers,
        errors: body.answers.address === '1 Main Street, Raleigh' ? {} : { 'organization.address': 'Use at least 10 characters.' },
      }),
    });
    renderSetup('organization');
    const field = await screen.findByLabelText('Mailing address');
    expect(screen.queryByText('Enter the mailing address.')).not.toBeInTheDocument();
    fireEvent.blur(field);
    expect(screen.queryByText('Enter the mailing address.')).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: '1 Main' } });
    expect(screen.queryByText('Enter the mailing address.')).not.toBeInTheDocument();
    await waitFor(() => expect(callsTo('saveApplicationStep')).toHaveLength(1), { timeout: 2000 });
    await screen.findByText('Saved.');
    expect(screen.queryByText('Use at least 10 characters.')).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    const problems = await screen.findByRole('region', { name: 'Answers that need attention' });
    expect(within(problems).getByRole('listitem')).toHaveTextContent('Use at least 10 characters.');
    expect(within(problems).getByRole('link', { name: 'Your organization' }))
      .toHaveAttribute('href', '/organizations/o1/applications/a1/organization?check=1');
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain('f-organization-address-error');
    fireEvent.change(field, { target: { value: '1 Main Street, Raleigh' } });
    expect(field).toHaveAccessibleDescription(/Use at least 10 characters/);
    await waitFor(() => expect(field).not.toHaveAttribute('aria-invalid'), { timeout: 2000 });
    expect(screen.queryByRole('region', { name: 'Answers that need attention' })).not.toBeInTheDocument();
    expect(callsTo('saveApplicationStep')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    expect(callsTo('saveApplicationStep')).toHaveLength(2);
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
    expect(field).toHaveAccessibleDescription(/Enter the mailing address/);
    expect(screen.queryByText('Enter the event name.')).not.toBeInTheDocument();
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('Next focuses a group error when no individual field has an error', async () => {
    serveApi({ getApplication: { application: application({ answers: emptyAnswers(), errors: { 'event.days': 'Add at least one day.' } }) } });
    renderSetup('event');
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    await waitFor(() => expect(screen.getByText('Add at least one day.')).toHaveFocus());
    expect(callsTo('saveApplicationStep')).toHaveLength(0);
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

  it('sends a request the reader cannot change to its status page', async () => {
    serveApi({ getApplication: { application: application({ status: 'approved', canEdit: false }) } });
    renderSetup('event');
    expect(await screen.findByText('Status page')).toBeInTheDocument();
  });

  it('sends an unknown step to the first step', async () => {
    renderSetup('nowhere');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
  });

  it('updates load errors and recovers when setup can be reloaded', async () => {
    let failure = 'We could not load setup. Try again.';
    serveApi({ getApplication: () => {
      if (failure) throw new Error(failure);
      return { application: application() };
    } });
    renderSetup('event');
    expect(await screen.findByRole('alert')).toHaveTextContent(failure);
    failure = 'The event is still unavailable. Try again later.';
    fireEvent.click(screen.getByRole('button', { name: 'Reload setup' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(failure));
    failure = '';
    fireEvent.click(screen.getByRole('button', { name: 'Reload setup' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says when a save fails', async () => {
    serveApi({
      getApplication: { application: application({ answers: emptyAnswers() }) },
      saveApplicationStep: () => { throw new Error('Your site is being built, so you cannot change this now.'); },
    });
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Website (optional)'), { target: { value: 'x.org' } });
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    expect(await screen.findByText(/Not saved. Your site is being built/)).toBeInTheDocument();
  });

  it('holds the request while the server kept an older web address, until a name saves', async () => {
    const TAKEN = 'Another event already uses this name. Choose another name.';
    serveApi({
      checkWebAddress: (body) => ({ name: body.name, address: `${body.name}.eventrunner.org`, available: body.name !== 'taken' }),
      saveApplicationStep: (body) => (body.answers.name === 'taken'
        ? { step: body.step, saved: false, answers: body.answers, errors: { 'webAddress.name': TAKEN } }
        : { step: body.step, saved: true, answers: body.answers, errors: {} }),
    });
    renderSetup('web-address');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'taken' } });
    fireEvent.click(screen.getByRole('link', { name: /Review/ }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument();
    const held = screen.getByText(/is not saved/);
    expect(held).toHaveTextContent('Your web address is not saved. Fix it before you continue.');
    expect(within(screen.getByRole('navigation', { name: 'Setup steps' })).getByText('Save the answers that have not been saved first.')).toBeInTheDocument();
    expect(within(held).getByRole('link', { name: 'Your web address' }))
      .toHaveAttribute('href', '/organizations/o1/applications/a1/web-address?check=1&from=review');
    fireEvent.click(within(held).getByRole('link', { name: 'Your web address' }));
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
    expect(screen.getByRole('heading', { level: 1, name: 'Your web address' })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'nclocal2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back to Review' }));
    await screen.findByRole('heading', { level: 1, name: 'Review' });
    expect(screen.getByRole('button', { name: /^Next:/ })).toBeInTheDocument();
    expect(screen.queryByText(/is not saved/)).not.toBeInTheDocument();
  });

  it('Next stays on the web address step when the server refuses the name', async () => {
    const SHORT = 'Use 3 to 27 lowercase letters, numbers and hyphens.';
    serveApi({
      checkWebAddress: (body) => ({ name: body.name, address: `${body.name}.eventrunner.org`, available: false, message: SHORT }),
      saveApplicationStep: (body) => ({ step: body.step, saved: false, answers: body.answers, errors: { 'webAddress.name': SHORT } }),
    });
    renderSetup('web-address');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    expect(await screen.findByText('Not saved. Check the answer.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your web address' })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    expect(await screen.findByText(/Not saved. We could not reach the server/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your organization' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Next:/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your event' })).toBeInTheDocument();
    expect(callsTo('saveApplicationStep').map((b) => b.answers.website)).toEqual(['x.org', 'x.org']);
  });

  describe('the agreement', () => {
    const NAV = { name: 'Setup steps' };

    it('Next on Review opens the agreement', async () => {
      serveApi({ getAgreement: { agreement: { version: 1, title: 'Test agreement', body: 'Test text.' }, accepted: null } });
      renderSetup('review');
      fireEvent.click(await screen.findByRole('button', { name: /^Next:/ }));
      expect(await screen.findByRole('heading', { level: 1, name: 'Agreement' })).toBeInTheDocument();
      expect(screen.getByText('Step 8 of 8')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument();
    });

    it('with an answer that needs attention, the agreement stays closed and its address goes to Review', async () => {
      serveApi({ getApplication: { application: application({ errors: { 'event.name': 'Enter the event name.' } }) } });
      renderSetup('agreement');
      expect(await screen.findByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument();
      expect(within(screen.getByRole('navigation', NAV)).queryByRole('link', { name: /Agreement/ })).not.toBeInTheDocument();
    });

    it('when sign-ups are closed, the request stays at Review and the page says why', async () => {
      serveApi({ getApplication: { application: application({ signups: { open: false } }) } });
      renderSetup('agreement');
      expect(await screen.findByRole('heading', { level: 1, name: 'Review' })).toBeInTheDocument();
      expect(screen.getByText('This site is not taking sign-ups right now. We saved your answers. Try again later.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Next:/ })).not.toBeInTheDocument();
    });

    it('after acceptance every step goes to the status page, for a member too', async () => {
      serveApi({ getApplication: { application: application({ status: 'approved', canEdit: false, canAccept: false, canWithdraw: false }) } });
      renderSetup('agreement');
      expect(await screen.findByText('Status page')).toBeInTheDocument();
    });

    it('an operator who is not on the team goes to the status page', async () => {
      serveApi({ getApplication: { application: application({ myRole: null, canEdit: false, canAccept: false, operator: true }) } });
      renderSetup('agreement');
      expect(await screen.findByText('Status page')).toBeInTheDocument();
    });
  });
});
