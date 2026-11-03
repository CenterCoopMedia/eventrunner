// The shared stepper parts (ADR 0008 §1).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { StepHeading, StepList, StepPager, resolveStep, useStepHeadingFocus } from './Stepper.jsx';

const STEPS = [
  { slug: 'session', title: 'Your session', state: 'done' },
  { slug: 'format', title: 'Format', state: 'todo' },
  { slug: 'presenters', title: 'Presenters', state: 'locked' },
];
const hrefFor = (step) => `/flow/${step.slug}`;

function renderList(props) {
  return render(
    <MemoryRouter>
      <StepList steps={STEPS} current={1} hrefFor={hrefFor} label="Pitch steps" {...props} />
    </MemoryRouter>,
  );
}

describe('resolveStep', () => {
  it('finds the named step, falls back without a name, and flags an unknown one', () => {
    expect(resolveStep(STEPS, 'presenters', 0)).toEqual({ index: 2, unknown: false });
    expect(resolveStep(STEPS, undefined, 1)).toEqual({ index: 1, unknown: false });
    expect(resolveStep(STEPS, 'nope', 1)).toEqual({ index: 1, unknown: true });
  });
});

describe('StepList', () => {
  it('lists every step with its number or a tick and its state in words', () => {
    renderList({ wide: true });
    const list = screen.getByRole('list', { name: 'Pitch steps' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['✓Your sessionDone', '2FormatTo do', '3PresentersNot started']);
    expect(within(list).getByRole('link', { name: /Format/ })).toHaveAttribute('aria-current', 'step');
    expect(within(list).getByRole('link', { name: /Your session/ })).toHaveAttribute('href', '/flow/session');
    expect(within(list).getByRole('link', { name: /Format/ })).toHaveAttribute('href', '/flow/format');
  });

  it('draws a locked step as text, not a link', () => {
    renderList({ wide: true });
    expect(screen.queryByRole('link', { name: /Presenters/ })).toBeNull();
    expect(screen.getByText('Presenters').closest('[data-state]')).toHaveAttribute('data-state', 'locked');
  });

  it('folds into one line on a narrow screen, with one list in the document', () => {
    renderList({ wide: false });
    expect(screen.getByText('Show all 3 steps').tagName).toBe('SUMMARY');
    expect(screen.getAllByRole('list')).toHaveLength(1);
  });

  it('takes the admin tier class when asked', () => {
    renderList({ wide: true, tier: 'admin' });
    expect(screen.getByRole('list', { name: 'Pitch steps' })).toHaveClass('stepper-list', 'stepper--admin');
  });
});

describe('StepPager', () => {
  it('has no Back on the first step, and names the next step', () => {
    render(
      <MemoryRouter>
        <StepPager next={STEPS[1]} hrefFor={hrefFor} backClass="b" nextClass="n" />
      </MemoryRouter>,
    );
    const nav = screen.getByRole('navigation', { name: 'Step navigation' });
    expect(within(nav).queryByRole('link', { name: 'Back' })).toBeNull();
    expect(within(nav).getByRole('link', { name: 'Next: Format' })).toHaveAttribute('href', '/flow/format');
  });

  it('makes Next a button that runs the step check when the caller asks', () => {
    const onNext = vi.fn();
    render(
      <MemoryRouter>
        <StepPager previous={STEPS[0]} next={STEPS[2]} hrefFor={hrefFor} backClass="b" nextClass="n" onNext={onNext} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next: Presenters' }));
    expect(onNext).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/flow/session');
  });

  it('shows the caller control in Next place on the last step', () => {
    render(
      <MemoryRouter>
        <StepPager previous={STEPS[1]} hrefFor={hrefFor} backClass="b" nextClass="n" last={<button type="submit">Submit pitch</button>} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Submit pitch' })).toBeInTheDocument();
  });
});

describe('useStepHeadingFocus', () => {
  function Flow() {
    const { slug } = useParams();
    const headingRef = useStepHeadingFocus(slug);
    const index = STEPS.findIndex((step) => step.slug === slug);
    const step = STEPS[index];
    return (
      <>
        <StepHeading index={index} total={STEPS.length} title={step.title} headingRef={headingRef} />
        <StepPager previous={STEPS[index - 1]} next={STEPS[index + 1]} hrefFor={hrefFor} backClass="b" nextClass="n" />
      </>
    );
  }

  it('leaves the focus alone on the first render and moves it to the heading on a step change', () => {
    render(
      <MemoryRouter initialEntries={['/flow/session']}>
        <Routes><Route path="/flow/:slug" element={<Flow />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(screen.getByRole('link', { name: 'Next: Format' }));
    const heading = screen.getByRole('heading', { level: 2, name: 'Format' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });
});
