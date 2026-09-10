// RegistrationAction: the configured registration action (M7 issue 8).
//
// The case that matters most is the empty one. A provider that sells no
// tickets, and a client who has not been handed a link, are the ordinary
// starting state of a deployment — so "renders no control anywhere" is
// asserted for both placements, and against every shape a runtime
// config/event doc can arrive in, not just an absent field. The schema
// refuses a non-https destination at the save (schema.test.cjs covers that
// half); this file covers the renderer's own second look, because a doc
// written before that rule existed is still unvalidated data at read time.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let eventConfig;

vi.mock('../contexts/EventConfigContext.jsx', () => ({
  useEventConfig: () => ({ eventConfig }),
}));

const { default: RegistrationAction, resolveRegistrationLink } = await import(
  './RegistrationAction.jsx'
);

function renderAction(config, placement) {
  eventConfig = config;
  return render(<RegistrationAction placement={placement} />);
}

const CONFIGURED = {
  registration: {
    externalUrl: 'https://register.example.org/summit',
    actionLabel: 'Get a ticket',
  },
};

describe('RegistrationAction', () => {
  it('links to the configured destination on the home lead, in the filled register', () => {
    renderAction(CONFIGURED, 'lead');
    const link = screen.getByRole('link', { name: /^Get a ticket\b/ });
    expect(link).toHaveAttribute('href', 'https://register.example.org/summit');
    // Somebody else's form, opened in its own tab with the opener severed
    // and no referrer, the same way every other outbound link opens here.
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
    expect(link.className).toContain('bg-accent');
  });

  it('renders the same action in the header, in the quiet register', () => {
    renderAction(CONFIGURED, 'header');
    const link = screen.getByRole('link', { name: /^Get a ticket\b/ });
    expect(link).toHaveAttribute('href', 'https://register.example.org/summit');
    // The header's own register: a ruled rectangle, never the filled one —
    // the identity row is not where the site shouts.
    expect(link.className).toContain('border-rule-hairline');
    expect(link.className).not.toContain('bg-accent');
  });

  it('puts the canonical href in the anchor, not the string that was stored', () => {
    // The destination is unvalidated Firestore data at read time, so what
    // the reader clicks is the href the shared reader parsed and approved —
    // host lower-cased, path present, components encoded. A raw string in
    // the anchor is how a value validates as one URL and resolves as
    // another.
    renderAction(
      { registration: { externalUrl: '  HTTPS://Register.Example.ORG  ', actionLabel: 'Register' } },
      'lead',
    );
    expect(screen.getByRole('link', { name: /^Register\b/ })).toHaveAttribute(
      'href',
      'https://register.example.org/',
    );
  });

  it('falls back to a stated label rather than drawing a blank control', () => {
    renderAction({ registration: { externalUrl: 'https://register.example.org' } }, 'lead');
    expect(screen.getByRole('link', { name: /^Register\b/ })).toBeInTheDocument();
    renderAction(
      { registration: { externalUrl: 'https://register.example.org', actionLabel: '   ' } },
      'lead',
    );
    expect(screen.getAllByRole('link', { name: /^Register\b/ }).length).toBeGreaterThan(0);
  });

  it('renders no control at all, in either placement, when nothing is configured', () => {
    for (const config of [
      undefined,
      {},
      { registration: {} },
      { registration: { externalUrl: null } },
      { registration: { externalUrl: '   ' } },
      // A label with no destination is not an action: there is nowhere to
      // send a reader, so there is no control.
      { registration: { actionLabel: 'Register' } },
    ]) {
      for (const placement of ['lead', 'header']) {
        const { container, unmount } = renderAction(config, placement);
        expect(container).toBeEmptyDOMElement();
        unmount();
      }
    }
  });

  it('renders nothing for a destination it cannot vouch for', () => {
    for (const url of [
      'http://register.example.org',
      'javascript:alert(1)',
      'register.example.org',
      42,
      // Codex review (P2): a scheme with no authority reads as https to a
      // protocol test, and in an `href` resolves against the page it sits
      // on — a reader clicking Register would land on this site's own
      // /register.example.org, not on the registration form.
      'https:register.example.org',
      'https:/register.example.org',
    ]) {
      const { container, unmount } = renderAction({ registration: { externalUrl: url } }, 'lead');
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe('resolveRegistrationLink', () => {
  it('reports absence as absence, so a caller can leave its own row out', () => {
    expect(resolveRegistrationLink(undefined)).toBeNull();
    expect(resolveRegistrationLink({ registration: { externalUrl: '' } })).toBeNull();
    expect(resolveRegistrationLink(CONFIGURED)).toEqual({
      label: 'Get a ticket',
      url: 'https://register.example.org/summit',
    });
  });
});
