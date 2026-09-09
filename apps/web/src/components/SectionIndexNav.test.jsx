// SectionIndexNav (issue #14 spec M7-14): a section list that marks the
// section in view and moves focus correctly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import SectionIndexNav from './SectionIndexNav.jsx';

/** A target heading a link can jump to — real pages give these a
 * tabIndex={-1} so focus can land on them (SectionHead.jsx / ContentPage.jsx). */
function Target({ id }) {
  return (
    <h2 id={id} tabIndex={-1}>
      {id}
    </h2>
  );
}

afterEach(() => {
  cleanup();
});

describe('SectionIndexNav', () => {
  it('renders nothing for an empty section list', () => {
    const { container } = render(<SectionIndexNav sections={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one link per section, labelled by the section', () => {
    render(
      <>
        <Target id="s1" />
        <Target id="s2" />
        <SectionIndexNav
          sections={[
            { id: 's1', label: 'Venue' },
            { id: 's2', label: 'Travel' },
          ]}
        />
      </>,
    );
    expect(screen.getByRole('link', { name: 'Venue' })).toHaveAttribute('href', '#s1');
    expect(screen.getByRole('link', { name: 'Travel' })).toHaveAttribute('href', '#s2');
  });

  it('marks nothing current when there is no IntersectionObserver in this environment', () => {
    // jsdom (this test run) carries no IntersectionObserver by default, so
    // this is also the ordinary unit-test environment's behavior: the list
    // never pins a first entry as a stand-in for real scroll position.
    render(
      <>
        <Target id="s1" />
        <Target id="s2" />
        <SectionIndexNav
          sections={[
            { id: 's1', label: 'Venue' },
            { id: 's2', label: 'Travel' },
          ]}
        />
      </>,
    );
    expect(screen.getByRole('link', { name: 'Venue' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Travel' })).not.toHaveAttribute('aria-current');
  });

  it('marks the section current only once the weight and rule signal it, without color alone', () => {
    // The non-color signal (weight) travels with aria-current once a
    // section actually IS current — exercised through the same
    // IntersectionObserver path the later test below sets up directly.
    const instances = [];
    class FakeIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        instances.push(this);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    render(
      <>
        <Target id="s1" />
        <Target id="s2" />
        <SectionIndexNav
          sections={[
            { id: 's1', label: 'Venue' },
            { id: 's2', label: 'Travel' },
          ]}
        />
      </>,
    );
    const s1 = document.getElementById('s1');
    act(() => {
      instances[0].callback([{ isIntersecting: true, boundingClientRect: { top: 10 }, target: s1 }]);
    });

    const first = screen.getByRole('link', { name: 'Venue' });
    const second = screen.getByRole('link', { name: 'Travel' });
    expect(first).toHaveAttribute('aria-current', 'location');
    expect(second).not.toHaveAttribute('aria-current');
    // The weight class is the non-color signal that travels with aria-current.
    expect(first.className).toMatch(/font-semibold/);
    expect(second.className).not.toMatch(/font-semibold/);

    vi.unstubAllGlobals();
  });

  it('activating a link moves focus onto the target section heading', () => {
    render(
      <>
        <Target id="s1" />
        <Target id="s2" />
        <SectionIndexNav
          sections={[
            { id: 's1', label: 'Venue' },
            { id: 's2', label: 'Travel' },
          ]}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('link', { name: 'Travel' }));
    expect(document.activeElement).toHaveAttribute('id', 's2');
    expect(screen.getByRole('link', { name: 'Travel' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('link', { name: 'Venue' })).not.toHaveAttribute('aria-current');
  });

  it('does not navigate the browser on click', () => {
    render(
      <>
        <Target id="s1" />
        <SectionIndexNav sections={[{ id: 's1', label: 'Venue' }]} />
      </>,
    );
    const link = screen.getByRole('link', { name: 'Venue' });
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    const prevented = !link.dispatchEvent(event);
    expect(prevented).toBe(true);
  });

  it('tracks which section is in view through IntersectionObserver', () => {
    // A minimal stub: captures the callback passed by the component and lets
    // the test fire it directly, the same technique HorizontalScrollRegion's
    // ResizeObserver guard is written to tolerate the absence of.
    const instances = [];
    class FakeIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        instances.push(this);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    render(
      <>
        <Target id="s1" />
        <Target id="s2" />
        <SectionIndexNav
          sections={[
            { id: 's1', label: 'Venue' },
            { id: 's2', label: 'Travel' },
          ]}
        />
      </>,
    );

    const observer = instances[0];
    const s2 = document.getElementById('s2');
    act(() => {
      observer.callback([
        { isIntersecting: true, boundingClientRect: { top: 10 }, target: s2 },
      ]);
    });

    expect(screen.getByRole('link', { name: 'Travel' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('link', { name: 'Venue' })).not.toHaveAttribute('aria-current');

    vi.unstubAllGlobals();
  });

  it('clears the current section instead of keeping a stale one once nothing crosses the band', () => {
    const instances = [];
    class FakeIntersectionObserver {
      constructor(callback) {
        this.callback = callback;
        instances.push(this);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

    render(
      <>
        <Target id="s1" />
        <Target id="s2" />
        <SectionIndexNav
          sections={[
            { id: 's1', label: 'Venue' },
            { id: 's2', label: 'Travel' },
          ]}
        />
      </>,
    );

    const observer = instances[0];
    const s2 = document.getElementById('s2');
    act(() => {
      observer.callback([{ isIntersecting: true, boundingClientRect: { top: 10 }, target: s2 }]);
    });
    expect(screen.getByRole('link', { name: 'Travel' })).toHaveAttribute(
      'aria-current',
      'location',
    );

    // Scrolled past the last section (or above the first, or between two
    // that don't meet the band) — nothing intersects this tick.
    act(() => {
      observer.callback([{ isIntersecting: false, boundingClientRect: { top: -400 }, target: s2 }]);
    });
    expect(screen.getByRole('link', { name: 'Travel' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Venue' })).not.toHaveAttribute('aria-current');

    vi.unstubAllGlobals();
  });
});
