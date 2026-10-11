import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { moveItem } from '../reorder.js';
import { ReorderControls, rowDragAllowed, useRowDrag } from './ReorderControls.jsx';

function names() {
  return screen.getAllByRole('button')
    .filter((button) => button.getAttribute('aria-label').startsWith('Drag '))
    .map((button) => button.getAttribute('aria-label'));
}

function List() {
  const [items, setItems] = useState(['Home', 'FAQ']);
  return (
    <ul>
      {items.map((label, index) => (
        <li key={label}>
          <ReorderControls
            label={label}
            index={index}
            count={items.length}
            dragToken={`page:${index}`}
            onMove={(from, to) => setItems((list) => moveItem(list, from, to))}
          />
        </li>
      ))}
    </ul>
  );
}

function Row() {
  const drag = useRowDrag('page:1', false);
  return (
    <div {...drag} data-testid="row">
      <a href="/faq" data-reorder-block="">FAQ</a>
    </div>
  );
}

describe('ReorderControls', () => {
  it('keeps a compact grip and the up and down names', () => {
    render(<List />);
    const grip = screen.getByRole('button', { name: 'Drag Home' });
    expect(grip).toHaveAttribute('draggable', 'true');
    expect(grip.className).toContain('min-h-admin-control');
    expect(grip.className).not.toContain('border-admin-rule-strong');
    expect(grip).not.toHaveTextContent('Drag');
    expect(screen.getByRole('button', { name: 'Move FAQ up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move Home up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move FAQ down' })).toBeDisabled();
  });

  it('moves with the arrows and Escape puts the row back', () => {
    render(<List />);
    const faq = screen.getByRole('button', { name: 'Drag FAQ' });
    fireEvent.keyDown(faq, { key: 'Enter' });
    expect(faq).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(faq, { key: 'ArrowUp' });
    expect(names()).toEqual(['Drag FAQ', 'Drag Home']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag FAQ' }), { key: 'Escape' });
    expect(names()).toEqual(['Drag Home', 'Drag FAQ']);
    expect(screen.getByRole('button', { name: 'Drag FAQ' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps the new position after Enter', () => {
    render(<List />);
    const faq = screen.getByRole('button', { name: 'Drag FAQ' });
    fireEvent.keyDown(faq, { key: 'Enter' });
    fireEvent.keyDown(faq, { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag FAQ' }), { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Drag FAQ' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Drag FAQ' }), { key: 'Escape' });
    expect(names()).toEqual(['Drag FAQ', 'Drag Home']);
  });

  it('does not move the first row up', () => {
    render(<List />);
    const home = screen.getByRole('button', { name: 'Drag Home' });
    fireEvent.keyDown(home, { key: 'Enter' });
    fireEvent.keyDown(home, { key: 'ArrowUp' });
    expect(names()).toEqual(['Drag Home', 'Drag FAQ']);
  });
});

describe('row drag', () => {
  it('blocks a link and allows the row surface', () => {
    const link = document.createElement('a');
    link.setAttribute('data-reorder-block', '');
    const wrap = document.createElement('div');
    wrap.setAttribute('data-reorder-block', '');
    const grip = document.createElement('button');
    grip.setAttribute('data-reorder-grip', '');
    wrap.appendChild(grip);
    expect(rowDragAllowed(link)).toBe(false);
    expect(rowDragAllowed(grip)).toBe(true);
    expect(rowDragAllowed(document.createElement('li'))).toBe(true);
    expect(rowDragAllowed(document.createTextNode('Home'))).toBe(false);
  });

  it('does not start a drag from a link', () => {
    render(<Row />);
    const setData = vi.fn();
    const transfer = { setData, effectAllowed: 'move' };
    fireEvent.pointerDown(screen.getByRole('link', { name: 'FAQ' }));
    fireEvent.dragStart(screen.getByTestId('row'), { dataTransfer: transfer });
    expect(setData).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByTestId('row'));
    fireEvent.dragStart(screen.getByTestId('row'), { dataTransfer: transfer });
    expect(setData).toHaveBeenCalledWith('text/plain', 'page:1');
  });
});
