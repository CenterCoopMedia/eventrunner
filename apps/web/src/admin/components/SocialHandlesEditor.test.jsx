import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import SocialHandlesEditor, {
  normalizeSocialHandles,
  socialHandlesPayload,
  validateSocialHandles,
} from './SocialHandlesEditor.jsx';

describe('social account helpers', () => {
  it('reads stored accounts as string rows and drops what is not an entry', () => {
    expect(
      normalizeSocialHandles({
        handles: [
          { platform: 'Mastodon', handle: '@eventname', url: 'https://example.org/@eventname' },
          { platform: 'Video', url: 'https://example.org/v', handle: null },
          'https://example.org/stray',
          null,
        ],
      }),
    ).toEqual([
      { platform: 'Mastodon', handle: '@eventname', url: 'https://example.org/@eventname' },
      { platform: 'Video', handle: '', url: 'https://example.org/v' },
    ]);
    expect(normalizeSocialHandles(undefined)).toEqual([]);
    expect(normalizeSocialHandles({ handles: 'nope' })).toEqual([]);
  });

  it('sends trimmed values, the canonical link, and no empty handle', () => {
    expect(
      socialHandlesPayload([
        { platform: ' Mastodon ', handle: ' @eventname ', url: ' https://EXAMPLE.org ' },
        { platform: 'Video', handle: '  ', url: 'https://example.org/v' },
      ]),
    ).toEqual([
      { platform: 'Mastodon', handle: '@eventname', url: 'https://example.org/' },
      { platform: 'Video', url: 'https://example.org/v' },
    ]);
  });

  it('names each field the shared schema would refuse, by the path the server uses', () => {
    const errors = validateSocialHandles([
      { platform: '', handle: '', url: 'javascript:alert(1)' },
      { platform: 'Mastodon', handle: 'x'.repeat(41), url: 'https:example.org/@eventname' },
      { platform: 'Video', handle: '', url: 'https://example.org/v' },
      { platform: 'Video', handle: '', url: 'https://EXAMPLE.org/v' },
    ]);
    expect(errors.get('social.handles[0].platform')).toMatch(/service name/);
    expect(errors.get('social.handles[0].url')).toMatch(/full link/);
    expect(errors.get('social.handles[1].handle')).toMatch(/40 characters or fewer/);
    expect(errors.get('social.handles[1].url')).toMatch(/full link/);
    expect(errors.has('social.handles[2].url')).toBe(false);
    expect(errors.get('social.handles[3].url')).toMatch(/already listed/);
    expect(validateSocialHandles([]).size).toBe(0);
  });
});

function Harness({ initial = [] }) {
  const [social, setSocial] = useState({ hashtag: '', handles: initial });
  return (
    <SocialHandlesEditor
      social={social}
      onChange={(patch) => setSocial((current) => ({ ...current, ...patch }))}
      errorFor={() => undefined}
    />
  );
}

describe('SocialHandlesEditor', () => {
  it('states an empty list, and adding an account puts the keyboard in its first field', async () => {
    render(<Harness />);
    expect(screen.getByText('No social accounts configured yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    const service = screen.getByLabelText('Account 1 service');
    await waitFor(() => expect(service).toHaveFocus());
    expect(screen.getByLabelText('Account 1 handle')).toBeInTheDocument();
    expect(screen.getByLabelText('Account 1 link')).toHaveAttribute('type', 'url');

    fireEvent.click(screen.getByRole('button', { name: 'Add account' }));
    await waitFor(() => expect(screen.getByLabelText('Account 2 service')).toHaveFocus());
  });

  it('removes an account and moves focus to a control that still exists', async () => {
    render(
      <Harness
        initial={[
          { platform: 'Mastodon', handle: '', url: 'https://example.org/@a' },
          { platform: 'Video', handle: '', url: 'https://example.org/v' },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove account 2' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'The account will be removed when you save.',
    );
    expect(screen.queryByLabelText('Account 2 service')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove account 1' })).toHaveFocus(),
    );

    // The last one goes, and focus falls back to the add control.
    fireEvent.click(screen.getByRole('button', { name: 'Remove account 1' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add account' })).toHaveFocus());
    expect(screen.getByText('No social accounts configured yet.')).toBeInTheDocument();
  });

  it('marks a field with the message it is given', () => {
    render(
      <SocialHandlesEditor
        social={{ hashtag: '', handles: [{ platform: 'Mastodon', handle: '', url: '/about' }] }}
        onChange={() => {}}
        errorFor={(field) =>
          field === 'social.handles[0].url' ? 'Enter the full link.' : undefined}
      />,
    );
    const link = screen.getByLabelText('Account 1 link');
    expect(link).toHaveAttribute('aria-invalid', 'true');
    expect(link).toHaveAccessibleDescription(/Enter the full link\./);
    expect(screen.getByLabelText('Account 1 service')).not.toHaveAttribute('aria-invalid');
  });
});
