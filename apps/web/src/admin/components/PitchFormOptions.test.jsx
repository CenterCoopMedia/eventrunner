// The pitch form's option lists in the admin (ADR 0008 §2).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PitchFormOptions from './PitchFormOptions.jsx';
import PitchDetails from './PitchDetails.jsx';

const SETTINGS = { enabled: true, closesAt: null, formOptions: { formats: ['Panel'], lengths: [60], tracks: [], maxCoPresenters: 4 } };

function addItem(label, value) {
  const box = screen.getByLabelText(label);
  fireEvent.change(box, { target: { value } });
  fireEvent.keyDown(box, { key: 'Enter' });
}

describe('PitchFormOptions', () => {
  it('adds text left in the box when the box loses focus, and removes an item', () => {
    render(<PitchFormOptions settings={SETTINGS} call={vi.fn()} />);
    const box = screen.getByLabelText('Tracks');
    fireEvent.change(box, { target: { value: 'Audience' } });
    fireEvent.blur(box);
    expect(box).toHaveValue('');
    expect(screen.getByText('Audience')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Audience' }));
    expect(screen.queryByText('Audience')).toBeNull();
  });

  it('replaces selected text when lines are pasted, and leaves a composing Enter alone', () => {
    render(<PitchFormOptions settings={SETTINGS} call={vi.fn()} />);
    const box = screen.getByLabelText('Tracks');
    fireEvent.change(box, { target: { value: 'Wrong' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(box).toHaveValue('Wrong');
    box.setSelectionRange(0, 5);
    fireEvent.paste(box, { clipboardData: { getData: () => 'One\nTwo' } });
    expect(screen.queryByText('Wrong')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Tracks list' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('turns pasted lines into one item each', () => {
    render(<PitchFormOptions settings={SETTINGS} call={vi.fn()} />);
    fireEvent.paste(screen.getByLabelText('Tracks'), { clipboardData: { getData: () => 'One\r\n Two \n\nOne' } });
    expect(within(screen.getByRole('list', { name: 'Tracks list' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the saved lists and saves the checked lists', async () => {
    const call = vi.fn().mockResolvedValue({});
    render(<PitchFormOptions settings={SETTINGS} call={call} />);
    expect(within(screen.getByRole('list', { name: 'Formats list' })).getByText('Panel')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Lengths in minutes list' })).getByText('60')).toBeInTheDocument();
    addItem('Formats', ' Workshop ');
    addItem('Lengths in minutes', '30');
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
    addItem('Lengths in minutes', 'an hour');
    addItem('Formats', 'panel');
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
