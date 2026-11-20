// Every block type the registry offers must show staff a picture and a line
// about it (issue #1153). A new block type without them fails here.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import BlockTypePicker from './BlockTypePicker.jsx';
import { BLOCK_TYPE_IDS, blockTypeLabel } from '../blockTypes.js';

vi.mock('../../contexts/EventConfigContext.jsx', () => ({ useEventConfig: () => ({ publicTheme: null }) }));

describe('BlockTypePicker', () => {
  it('draws a picture and a one-line description for every registered block type', () => {
    // Value 'text' lists every type, Short text included.
    render(<MemoryRouter><BlockTypePicker value="text" onChange={() => {}} /></MemoryRouter>);
    for (const id of BLOCK_TYPE_IDS) {
      const radio = screen.getByRole('radio', { name: blockTypeLabel(id) });
      const option = radio.closest('label');
      const example = option.querySelector('.admin-block-picker__example');
      expect(example, `${id} has a picture`).not.toBeNull();
      expect(example.textContent.trim() || example.querySelector('img, svg'), `${id} picture draws something`).toBeTruthy();
      expect(radio, `${id} has a description`).toHaveAccessibleDescription(/\S/);
    }
  });
});
