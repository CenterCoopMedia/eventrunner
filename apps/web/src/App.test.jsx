// Smoke test: the app shell renders end to end from the committed synthetic
// snapshot — providers nest, routes resolve, and the snapshot content
// reaches the DOM with no Firebase connection (spec §2.4 first-paint path).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';
import { eventConfig } from '@generated/eventConfig.js';
import siteContent from '@generated/siteContent.js';

function renderAt(path) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </MemoryRouter>,
  );
}

describe('app shell', () => {
  it('renders the home page from the snapshot', () => {
    renderAt('/');
    // Hero title comes from the generated snapshot, not hardcoded copy.
    expect(
      screen.getByRole('heading', { level: 1, name: siteContent.hero__title.value }),
    ).toBeInTheDocument();
    // Event days render from eventConfig.
    for (const day of eventConfig.days) {
      expect(screen.getByRole('heading', { name: day.label })).toBeInTheDocument();
    }
    // The skip link is the first focusable element in the shell.
    expect(screen.getByText('Skip to main content')).toHaveAttribute(
      'href',
      '#main-content',
    );
    // EventConfigProvider owns the runtime theme style element (spec §7.2).
    expect(document.getElementById('event-theme-runtime')).not.toBeNull();
    expect(document.title).toBe(eventConfig.name);
  });

  it('renders the schedule from the snapshot with sessions grouped by day', () => {
    renderAt('/schedule');
    expect(screen.getByRole('heading', { level: 1, name: 'Schedule' })).toBeInTheDocument();
    expect(screen.getByText('[Demo] Welcome and orientation')).toBeInTheDocument();
  });

  it('renders a designed empty state on unknown routes', () => {
    renderAt('/definitely-not-a-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeInTheDocument();
  });
});
