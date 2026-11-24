import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserButton } from '@clerk/react';

// Clerk is a front-door gate only: it decides who may open /app.
// Case access is still enforced by the MAHA backend token inside the workspace.
export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
export const clerkEnabled = /^pk_(test|live)_/.test(CLERK_KEY);

export const clerkAppearance = {
  variables: {
    // "Case File Night": gold for the primary action, navy surfaces, blue focus.
    colorPrimary: '#F2B544',
    colorPrimaryForeground: '#0A1020',
    colorBackground: '#131E35',
    colorForeground: '#EDF2FA',
    colorMutedForeground: '#A59FC4',
    colorInput: '#0A1020',
    colorInputForeground: '#EDF2FA',
    colorRing: '#5AA9FF',
    colorDanger: '#FF6B5B',
    colorSuccess: '#3DD6B5',
    borderRadius: '10px',
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  elements: {
    card: { boxShadow: '0 30px 80px -20px rgba(0,0,0,.7)', border: '1px solid #233350' },
    headerTitle: { fontFamily: "'Space Grotesk', Inter, sans-serif", letterSpacing: '-0.02em' },
    // Clerk's default social button text is dark; make it readable on the dark card.
    socialButtonsBlockButton: { backgroundColor: '#0A1020', border: '1px solid #233350', color: '#EDF2FA' },
    socialButtonsBlockButtonText: { color: '#EDF2FA', fontWeight: 500 },
    dividerLine: { backgroundColor: '#233350' },
    dividerText: { color: '#A59FC4' }
  }
};

/** Full-screen loading state, shown while the session or a page chunk loads. */
export function Splash({ label = 'Checking your session…' }) {
  return (
    <div className="tw:flex tw:min-h-screen tw:items-center tw:justify-center tw:gap-3 tw:bg-night tw:font-sans tw:text-sm tw:text-ink-3" role="status">
      <span className="tw:size-[18px] tw:animate-spin tw:rounded-full tw:border-2 tw:border-gold/25 tw:border-t-gold tw:motion-reduce:animate-none" aria-hidden="true" />
      {label}
    </div>
  );
}

function ClerkGate({ children }) {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  if (!isLoaded) return <Splash />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace state={{ from: location.pathname }} />;
  return children;
}

// Without a key the app runs in an explicit, labelled dev mode instead of failing.
export function RequireAuth({ children }) {
  return clerkEnabled ? <ClerkGate>{children}</ClerkGate> : children;
}

export function UserSlot() {
  if (!clerkEnabled) return <span className="dev-auth-chip">Auth: dev mode (no Clerk key)</span>;
  return <UserButton showName />; // sign-out destination is set on ClerkProvider
}
