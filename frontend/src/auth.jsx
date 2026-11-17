import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth, UserButton } from '@clerk/react';

// Clerk is a front-door gate only: it decides who may open /app.
// Case access is still enforced by the MAHA backend token inside the workspace.
export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || '';
export const clerkEnabled = /^pk_(test|live)_/.test(CLERK_KEY);

export const clerkAppearance = {
  variables: {
    colorPrimary: '#38bdf8',
    colorBackground: '#0b1220',
    colorForeground: '#e2e8f0',
    colorMutedForeground: '#94a3b8',
    colorInput: '#0f172a',
    colorInputForeground: '#f8fafc',
    borderRadius: '10px',
    fontFamily: 'Inter, system-ui, sans-serif'
  },
  elements: {
    card: { boxShadow: '0 30px 80px -20px rgba(0,0,0,.7)', border: '1px solid rgba(148,163,184,.14)' },
    // Clerk's default social button text is dark; make it readable on the dark card.
    socialButtonsBlockButton: { backgroundColor: '#0f172a', border: '1px solid rgba(148,163,184,.25)', color: '#e2e8f0' },
    socialButtonsBlockButtonText: { color: '#e2e8f0', fontWeight: 500 },
    dividerLine: { backgroundColor: 'rgba(148,163,184,.2)' },
    dividerText: { color: '#94a3b8' }
  }
};

function Splash() {
  return (
    <div className="auth-splash" role="status">
      <span className="auth-spinner" aria-hidden="true" />
      Checking your session…
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
