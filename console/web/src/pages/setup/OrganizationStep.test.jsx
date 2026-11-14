import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { application, callsTo, emptyAnswers, serveApi } from '../../test/application.js';
import { renderSetup } from '../../test/setupPage.jsx';

vi.mock('../../api.js', () => ({ callApi: vi.fn() }));

beforeEach(() => {
  serveApi({ getApplication: { application: application({ answers: emptyAnswers() }) } });
});

describe('Your organization step', () => {
  it('asks for the name, the website and the mailing address, with the name preset', async () => {
    renderSetup('organization');
    expect(await screen.findByLabelText('Organization name')).toHaveValue('NC Local');
    expect(screen.getByLabelText('Organization name')).toHaveAttribute('enterkeyhint', 'next');
    expect(screen.getByLabelText('Website (optional)')).toHaveAttribute('type', 'url');
    expect(screen.getByLabelText('Website (optional)')).toHaveAttribute('autocapitalize', 'none');
    expect(screen.getByLabelText('Website (optional)')).toHaveAttribute('spellcheck', 'false');
    const address = screen.getByLabelText('Mailing address');
    expect(address.tagName).toBe('TEXTAREA');
    expect(address).not.toHaveAttribute('enterkeyhint');
    expect(address).toHaveAccessibleDescription(/This address appears at the bottom of your event emails/);
  });

  it('saves the whole step', async () => {
    renderSetup('organization');
    fireEvent.change(await screen.findByLabelText('Organization name'), { target: { value: 'NC Local News' } });
    fireEvent.change(screen.getByLabelText('Mailing address'), { target: { value: '1 Main Street' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next: Your event' }));
    await screen.findByRole('heading', { level: 1, name: 'Your event' });
    expect(callsTo('saveApplicationStep').at(-1).answers).toEqual({ name: 'NC Local News', website: '', address: '1 Main Street' });
  });
});
