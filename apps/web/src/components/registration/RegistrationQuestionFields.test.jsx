// The attendee's registration questions on the public controls. Values are
// held in the shape the shared check reads, so what is typed is what saves.
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { checkAnswers } from 'shared/registrationForm';
import RegistrationQuestionFields from './RegistrationQuestionFields.jsx';

const FORM = {
  standard: {
    organization: { enabled: true, required: true },
    phone: { enabled: true, required: false },
    dietary: { enabled: true, required: false },
    photoConsent: { enabled: true, required: true },
    directoryListing: { enabled: true, required: false },
  },
  custom: [
    { id: 'q_track', kind: 'one_choice', label: 'Which track?', help: 'Pick one.', choices: ['Data', 'Design'], required: false },
    { id: 'q_topics', kind: 'many_choices', label: 'Topics', choices: ['AI', 'Maps', 'Audio'], required: false },
    { id: 'q_note', kind: 'long_text', label: 'Anything else?', required: false },
  ],
  revision: 4,
};

function Harness({ errors = {}, initial = {} }) {
  const [values, setValues] = useState(initial);
  return (
    <>
      <RegistrationQuestionFields form={FORM} values={values} errors={errors} onChange={(id, value) => setValues((v) => ({ ...v, [id]: value }))} />
      <output data-testid="values">{JSON.stringify(values)}</output>
    </>
  );
}
const values = () => JSON.parse(screen.getByTestId('values').textContent);

describe('RegistrationQuestionFields', () => {
  it('draws every asked question with its label, help and required mark', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Organization (required)')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Dietary needs' })).toBeInTheDocument();
    expect(screen.getByText('Choose any that apply. Choose Other to describe something else.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'May the organizers photograph you and use the photos? (required)' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Which track?' })).toBeInTheDocument();
    expect(screen.getByText('Pick one.')).toBeInTheDocument();
    expect(screen.getByLabelText('Anything else?')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Job title/)).not.toBeInTheDocument();
  });

  it('holds answers in the shape the shared check accepts', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Organization (required)'), { target: { value: 'Acme' } });
    fireEvent.click(screen.getByLabelText('Vegan'));
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.change(screen.getByLabelText('Other dietary need'), { target: { value: 'No mushrooms' } });
    fireEvent.click(screen.getByLabelText('No'));
    fireEvent.click(screen.getByLabelText('List me only for other attendees'));
    fireEvent.click(screen.getByLabelText('Design'));
    fireEvent.click(screen.getByLabelText('Maps'));
    fireEvent.click(screen.getByLabelText('AI'));
    const held = values();
    expect(held).toMatchObject({
      organization: 'Acme',
      dietary: { choices: ['Vegan', 'Other'], other: 'No mushrooms' },
      photoConsent: false,
      directoryListing: 'attendees_only',
      q_track: 'Design',
      q_topics: ['Maps', 'AI'],
    });
    expect(checkAnswers(held, FORM)).toMatchObject({ ok: true });
  });

  it('shows saved answers and unticks a choice', () => {
    render(<Harness initial={{ photoConsent: true, q_topics: ['Audio'], dietary: { choices: ['Halal'], other: null } }} />);
    expect(screen.getByLabelText('Yes')).toBeChecked();
    expect(screen.getByLabelText('Halal')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Audio'));
    expect(values().q_topics).toEqual([]);
  });

  it('shows each question’s error under it', () => {
    render(<Harness errors={{ organization: 'Answer this question.', photoConsent: 'Choose yes or no.' }} />);
    expect(screen.getByLabelText('Organization (required)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Answer this question.')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: /photograph/ });
    expect(group).toHaveAccessibleDescription('Choose yes or no.');
  });

  it('edits a saved phone answer using a telephone input and names an invalid number', () => {
    render(<Harness initial={{ phone: { entered: '+44 20 7946 0958', normalized: '+442079460958' } }} errors={{ phone: 'Enter a phone number with 7 to 15 digits.' }} />);
    const phone = screen.getByLabelText('Phone number');
    expect(phone).toHaveAttribute('type', 'tel');
    expect(phone).toHaveAttribute('autocomplete', 'tel');
    expect(phone).toHaveValue('+44 20 7946 0958');
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone).toHaveAccessibleDescription(/Private to event staff\..*Enter a phone number/);
    fireEvent.change(phone, { target: { value: '(201) 555-0123' } });
    expect(values().phone).toBe('(201) 555-0123');
  });
});
