// The setup nudge: it must reach a new account's first landing, and it must
// not trap anyone (issue #17 review finding).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let profileValue;
vi.mock('../contexts/ProfileContext.jsx', () => ({
  useProfile: () => profileValue,
}));

const { default: ProfileSetupRedirect } = await import('./ProfileSetupRedirect.jsx');

function CurrentPath() {
  const { pathname } = useLocation();
  return <p>path:{pathname}</p>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ProfileSetupRedirect />
      <Routes>
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  profileValue = { status: 'ready', needsProfileSetup: true };
});

describe('ProfileSetupRedirect', () => {
  it('sends a new account from the post-sign-in landing to the setup flow', () => {
    renderAt('/');
    expect(screen.getByText('path:/profile')).toBeInTheDocument();
  });

  it('also catches the /signin landing', () => {
    renderAt('/signin');
    expect(screen.getByText('path:/profile')).toBeInTheDocument();
  });

  it('leaves a deep link alone', () => {
    renderAt('/schedule');
    expect(screen.getByText('path:/schedule')).toBeInTheDocument();
  });

  it('does nothing for a complete profile', () => {
    profileValue = { status: 'ready', needsProfileSetup: false };
    renderAt('/');
    expect(screen.getByText('path:/')).toBeInTheDocument();
  });

  it('waits until the account document exists', () => {
    profileValue = { status: 'pending-account', needsProfileSetup: false };
    renderAt('/');
    expect(screen.getByText('path:/')).toBeInTheDocument();
  });

  it('does nothing at all when signed out', () => {
    profileValue = { status: 'signed-out', needsProfileSetup: false };
    renderAt('/');
    expect(screen.getByText('path:/')).toBeInTheDocument();
  });
});
