import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ContentTranslations from './ContentTranslations.jsx';

function Editor() {
  const [record, setRecord] = useState({ label: 'Visit', title: 'Plan your visit' });
  return <><ContentTranslations kind="page" record={record}
    onChange={(translations) => setRecord((previous) => ({ ...previous, translations }))} />
    <output data-testid="record">{JSON.stringify(record)}</output></>;
}

describe('paired content editing', () => {
  it('keeps partial work through disclosure changes, states fallback, and removes a whole variant', () => {
    render(<Editor />);
    const disclosure = screen.getByRole('button', { name: 'Spanish translation', exact: true });
    fireEvent.click(disclosure);
    fireEvent.change(screen.getByLabelText('Spanish Label'), { target: { value: 'Visita' } });
    expect(screen.getByText(/whole item falls back to English/)).toBeVisible();
    fireEvent.click(disclosure);
    fireEvent.click(disclosure);
    expect(screen.getByLabelText('Spanish Label')).toHaveValue('Visita');
    fireEvent.change(screen.getByLabelText('Spanish Heading'), { target: { value: 'Planifica tu visita' } });
    expect(screen.getByText('This translation is complete.', { exact: false })).toBeVisible();
    expect(JSON.parse(screen.getByTestId('record').textContent)).toEqual({ label: 'Visit', title: 'Plan your visit',
      translations: { es: { label: 'Visita', title: 'Planifica tu visita' } } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Spanish translation' }));
    expect(screen.getByLabelText('Spanish Label')).toHaveValue('');
    expect(JSON.parse(screen.getByTestId('record').textContent).translations).toEqual({});
  });
});
