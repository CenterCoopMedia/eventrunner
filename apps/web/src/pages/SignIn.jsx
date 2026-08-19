// Sign-in page — placeholder the auth tranche replaces with the OTP flow
// (functions/src/auth/otp.cjs: sendOtpCode → verifyOtpCode → custom token).
// TODO(m2-auth): email step, code step (inputmode="numeric",
// autocomplete="one-time-code", paste always allowed), single failure
// message shape, focus moved to errors with aria-invalid.
import EmptyState from '../components/EmptyState.jsx';

export default function SignIn() {
  return (
    <article>
      <h1 className="font-heading text-3xl font-semibold text-brand-ink">Sign in</h1>
      <div className="mt-6">
        <EmptyState
          title="Sign-in is not available yet"
          description="Email code sign-in is coming in a later milestone. You can browse the site without an account."
        />
      </div>
    </article>
  );
}
