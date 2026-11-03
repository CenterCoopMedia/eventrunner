// The pitch form's option lists in the admin (ADR 0008 §2).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import PitchFormOptions from './PitchFormOptions.jsx';
import PitchDetails from './PitchDetails.jsx';

const SETTINGS = { enabled: true, closesAt: null, formOptions: { formats: ['Panel'], lengths: [60], tracks: [], maxCoPresenters: 4 } };

describe('PitchFormOptions', () => {
  it('shows the saved lists one per line and saves the checked lists', async () => {
    const call = vi.fn().mockResolvedValue({});
    render(<PitchFormOptions settings={SETTINGS} call={call} />);
    expect(screen.getByLabelText('Formats')).toHaveValue('Panel');
    expect(screen.getByLabelText('Lengths in minutes')).toHaveValue('60');
    fireEvent.change(screen.getByLabelText('Formats'), { target: { value: 'Panel\n Workshop \n\n' } });
    fireEvent.change(screen.getByLabelText('Lengths in minutes'), { target: { value: '60\n30' } });
    fireEvent.change(screen.getByLabelText('Co-presenters per pitch'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pitch form options' }));
    await screen.findByText('Pitch form options saved.');
    expect(call).toHaveBeenCalledWith('updatePitchFormOptions', {
      formOptions: { formats: ['Panel', 'Workshop'], lengths: [30, 60], tracks: [], maxCoPresenters: 2 },
    });
  });

  it('names a wrong list before the save and sends nothing', async () => {
    const call = vi.fn();
    render(<PitchFormOptions settings={SETTINGS} call={call} />);
    fireEvent.change(screen.getByLabelText('Lengths in minutes'), { target: { value: 'an hour' } });
    fireEvent.change(screen.getByLabelText('Formats'), { target: { value: 'Panel\npanel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save pitch form options' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/lengths: each length is a whole number/));
    expect(screen.getByRole('alert')).toHaveTextContent(/"panel" is listed twice/);
    expect(call).not.toHaveBeenCalled();
  });
});

describe('PitchDetails', () => {
  it('shows every step of a stepper pitch with the lead presenter first', () => {
    render(<PitchDetails pitch={{
      title: 'T', summary: 'One line.', description: 'D', format: 'Panel', lengthMinutes: 60, track: 'Audience',
      audienceLevel: 'beginner', organization: 'Org', accessNeeds: 'Captions.', notes: null,
      presenters: [
        { name: 'Ada', email: 'ada@example.org', role: 'Editor', organization: 'Org', lead: true },
        { name: 'Bo', email: 'bo@example.org', role: null, organization: null, lead: false },
      ],
    }} />);
    expect(screen.getByText('One line.')).toBeInTheDocument();
    expect(screen.getByText('60 minutes')).toBeInTheDocument();
    expect(screen.getByText('New to the topic')).toBeInTheDocument();
    expect(screen.getByText('Presenters (2)')).toBeInTheDocument();
    expect(screen.getByText('Ada · ada@example.org · Editor · Org (lead)')).toBeInTheDocument();
    expect(screen.getByText('Bo · bo@example.org')).toBeInTheDocument();
    expect(screen.getByText('Captions.')).toBeInTheDocument();
  });

  it('reads a pitch from before the stepper as one lead presenter', () => {
    render(<PitchDetails pitch={{ title: 'T', description: 'D', email: 'old@example.org', organization: 'Org' }} />);
    expect(screen.getByText('Presenter')).toBeInTheDocument();
    expect(screen.getByText('The person who pitched · old@example.org · Org (lead)')).toBeInTheDocument();
    expect(screen.getAllByText('Not given').length).toBeGreaterThan(3);
  });
});
