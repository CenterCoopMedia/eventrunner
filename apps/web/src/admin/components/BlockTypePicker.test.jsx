// Every block type the registry offers must show staff a picture and a line
// about it (issue #1153). A new block type without them fails here.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BlockTypePicker from './BlockTypePicker.jsx';
import { BLOCK_TYPE_IDS, blockTypeLabel } from '../blockTypes.js';

vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ publicTheme: null }) }));

describe('BlockTypePicker', () => {
  it('draws a picture and a one-line description for every registered block type', async () => {
    // Value 'text' lists every type, Short text included.
    render(<MemoryRouter><BlockTypePicker value="text" onChange={() => {}} /></MemoryRouter>);
    for (const id of BLOCK_TYPE_IDS) {
      const radio = screen.getByRole('radio', { name: blockTypeLabel(id) });
      const option = radio.closest('label');
      const example = option.querySelector('.admin-block-picker__example');
      expect(example, `${id} has a picture`).not.toBeNull();
      // Some renderers load on demand (blocks/registry.jsx), so wait for them.
      await waitFor(() => expect(example.textContent.trim() || example.querySelector('img, svg'), `${id} picture draws something`).toBeTruthy());
      expect(radio, `${id} has a description`).toHaveAccessibleDescription(/\S/);
    }
  });

  it('keeps a saved Short text block able to switch back until it is saved', () => {
    render(<MemoryRouter><BlockTypePicker value="richtext" savedType="text" onChange={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('radio', { name: 'Short text' })).toBeEnabled();
  });

  it('offers Text, not Short text, for a new block where Text is allowed', () => {
    render(<MemoryRouter><BlockTypePicker value="richtext" onChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('radio', { name: 'Short text' })).toBeNull();
  });
});
