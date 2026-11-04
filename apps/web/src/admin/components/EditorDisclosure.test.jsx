import { useLayoutEffect, useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EditorDisclosure from './EditorDisclosure.jsx';

describe('editor disclosure', () => {
  it('retains the mounted input and its unsaved value through repeated open and close', () => {
    render(<EditorDisclosure title="Hero" description="2 blocks"><label>Title<input defaultValue="Draft title" /></label></EditorDisclosure>);
    const button = screen.getByRole('button', { name: 'Hero 2 blocks' });
    const input = screen.getByLabelText('Title');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(input).not.toBeVisible();
    fireEvent.click(button);
    fireEvent.change(input, { target: { value: 'Unsaved edit' } });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(input).toBeVisible();
    expect(input).toHaveValue('Unsaved edit');
    expect(document.getElementById(button.getAttribute('aria-controls'))).toContainElement(input);
  });
  it('reveals a server error without replacing edited fields', () => {
    const children = <label>Title<input defaultValue="Draft title" /></label>;
    const { rerender } = render(<EditorDisclosure title="Hero">{children}</EditorDisclosure>);
    rerender(<EditorDisclosure title="Hero" reveal>{children}</EditorDisclosure>);
    expect(screen.getByRole('button', { name: 'Hero' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Title')).toBeVisible();
  });
  it('opens in the same commit that reveals it, with no frame where the error shows and the section is shut', () => {
    const seen = [];
    function Probe({ reveal }) {
      const ref = useRef(null);
      useLayoutEffect(() => {
        seen.push({ reveal, open: ref.current.closest('.admin-editor-disclosure').dataset.open });
      });
      return <span ref={ref} />;
    }
    const { rerender } = render(<EditorDisclosure title="Hero"><Probe reveal={false} /></EditorDisclosure>);
    rerender(<EditorDisclosure title="Hero" reveal><Probe reveal /></EditorDisclosure>);
    expect(seen.find((commit) => commit.reveal)).toEqual({ reveal: true, open: 'true' });
  });
  it('can still be closed by hand while the error stands', () => {
    render(<EditorDisclosure title="Hero" reveal><span>Body</span></EditorDisclosure>);
    const button = screen.getByRole('button', { name: 'Hero' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});
