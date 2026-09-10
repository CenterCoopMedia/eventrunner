// The filter group: the fieldset, the active count, and one way back.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import FilterGroup from './FilterGroup.jsx';

const OPTIONS = [
  { value: 'talk', label: 'Talk', count: 12 },
  { value: 'workshop', label: 'Workshop', count: 4 },
  { value: 'panel', label: 'Panel' },
];

function renderGroup(selected = []) {
  const onChange = vi.fn();
  render(
    <FilterGroup legend="Format" options={OPTIONS} selected={selected} onChange={onChange} />,
  );
  return onChange;
}

describe('FilterGroup', () => {
  it('is a fieldset named by its legend', () => {
    renderGroup();
    expect(screen.getByRole('group', { name: /Format/ })).toBeInTheDocument();
  });

  it('offers one real checkbox per facet, with its count', () => {
    renderGroup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Talk (12)' })).toBeInTheDocument();
    // A facet with no count states no count, rather than a zero.
    expect(screen.getByRole('checkbox', { name: 'Panel' })).toBeInTheDocument();
  });

  it('states how many facets are on', () => {
    renderGroup(['talk', 'panel']);
    expect(screen.getByRole('group', { name: /2 on/ })).toBeInTheDocument();
  });

  it('adds and removes one facet at a time', () => {
    const onChange = renderGroup(['talk']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Workshop (4)' }));
    expect(onChange).toHaveBeenLastCalledWith(['talk', 'workshop']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Talk (12)' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('offers one clear control, and only when something is on', () => {
    renderGroup();
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });

  it('clears every facet from the keyboard', () => {
    const onChange = renderGroup(['talk', 'panel']);
    const clear = screen.getByRole('button', { name: 'Clear filter' });
    clear.focus();
    expect(clear).toHaveFocus();
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
