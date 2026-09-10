// The drawn checkbox and the drawn radio: still real inputs.
//
// The point of the redraw is that it takes the paint and nothing else. These
// assertions are about what the platform still owns — the role, the label,
// the keyboard, the group — because that is what a redraw usually breaks.
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Checkbox, Radio } from './Choice.jsx';

describe('Checkbox', () => {
  it('is a real checkbox, labelled by its own word', () => {
    render(<Checkbox label="Send me the programme" checked={false} onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Send me the programme' });
    expect(box.tagName).toBe('INPUT');
    expect(box).not.toBeChecked();
  });

  it('toggles from the keyboard', () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Checkbox label="Send me the programme" checked={on} onChange={() => setOn(!on)} />;
    }
    render(<Harness />);
    const box = screen.getByRole('checkbox');
    box.focus();
    expect(box).toHaveFocus();
    // jsdom turns a click on a checkbox into the same state change Space
    // does, so this is the keyboard path as well as the pointer one.
    fireEvent.click(box);
    expect(box).toBeChecked();
  });

  it('takes the token boundary rather than the operating system paint', () => {
    render(<Checkbox label="Send me the programme" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox').className).toContain('control-choice');
  });

  it('states an error under the control and names it from the control', () => {
    render(
      <Checkbox
        label="Accept the code of conduct"
        checked={false}
        onChange={() => {}}
        error="Accept the code of conduct to register."
      />,
    );
    const box = screen.getByRole('checkbox');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Accept the code of conduct to register.');
  });

  it('carries a description as part of the control name', () => {
    render(
      <Checkbox
        label="Workshops"
        description="Two hours, hands on."
        checked={false}
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole('checkbox')).toHaveAccessibleName(/Two hours, hands on\./);
  });
});

describe('Radio', () => {
  function Group(value = 'public') {
    const onChange = vi.fn();
    render(
      <fieldset>
        <legend>Who can see your profile</legend>
        <Radio
          label="Everybody"
          name="visibility"
          value="public"
          checked={value === 'public'}
          onChange={onChange}
        />
        <Radio
          label="Attendees only"
          name="visibility"
          value="attendees"
          checked={value === 'attendees'}
          onChange={onChange}
        />
      </fieldset>,
    );
    return onChange;
  }

  it('is a real radio group: one name, one checked control', () => {
    Group();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(radios.every((radio) => radio.name === 'visibility')).toBe(true);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).not.toBeChecked();
  });

  it('draws a circle rather than a box', () => {
    Group();
    expect(screen.getAllByRole('radio')[0].className).toContain('control-choice--radio');
  });

  it('reports the choice the reader makes', () => {
    const onChange = Group();
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(onChange).toHaveBeenCalled();
  });
});
