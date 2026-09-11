// DefaultAvatarPicker (issue #175): one radio group, keyboard-driven by
// construction, offering the bundled neutrals plus None.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import DefaultAvatarPicker from './DefaultAvatarPicker.jsx';

describe('DefaultAvatarPicker', () => {
  it('offers six neutral defaults and None, with None chosen while a real photo is set', () => {
    render(<DefaultAvatarPicker value="profile-photos/u1/photo.png" onChange={vi.fn()} namePrefix="profile" />);
    expect(screen.getAllByRole('radio')).toHaveLength(7);
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Default avatar 03' })).not.toBeChecked();
  });

  it('marks the chosen default and hands its reserved path upward', () => {
    const onChange = vi.fn();
    render(<DefaultAvatarPicker value="default-avatars/avatar-02.svg" onChange={onChange} namePrefix="profile" />);
    expect(screen.getByRole('radio', { name: 'Default avatar 02' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: 'Default avatar 05' }));
    expect(onChange).toHaveBeenCalledWith('default-avatars/avatar-05.svg');
  });

  it('None clears the photo', () => {
    const onChange = vi.fn();
    render(
      <DefaultAvatarPicker value="default-avatars/avatar-01.svg" onChange={onChange} namePrefix="speaker" />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});
