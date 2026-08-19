// AuthProvider — placeholder (M2 auth tranche replaces the body).
//
// TODO(m2-auth): wire firebase.js auth — onAuthStateChanged subscription,
// OTP sign-in against the sendOtpCode / verifyOtpCode endpoints
// (functions/src/auth/otp.cjs):
//   sendOtpCode    { email } → { challengeId, expiresInMinutes }
//   verifyOtpCode  { challengeId, email, code } → { token }  (custom token)
// then signInWithCustomToken. The OTP input must keep paste working and use
// inputmode="numeric" autocomplete="one-time-code" (interface guidelines).
import { createContext, useContext, useMemo } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const value = useMemo(
    () => ({
      user: null,
      isAdmin: false,
      loading: false,
      signOut: async () => {},
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>.');
  }
  return ctx;
}

export default AuthContext;
