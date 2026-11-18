import React, { lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { ClerkProvider } from '@clerk/react';
import { CLERK_KEY, clerkEnabled, clerkAppearance, RequireAuth, UserSlot } from './auth';
import Landing from './pages/Landing';
import './style.css';

// The workspace (vis-network, three.js) loads only when someone opens /app.
const Workspace = lazy(() => import('./Workspace'));
const AuthPage = lazy(() => import('./pages/AuthPage'));

function Loading() {
  return <div className="auth-splash" role="status"><span className="auth-spinner" aria-hidden="true" />Loading…</div>;
}

function AppRoutes() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sign-in/*" element={clerkEnabled ? <AuthPage mode="sign-in" /> : <Navigate to="/app" replace />} />
        <Route path="/sign-up/*" element={clerkEnabled ? <AuthPage mode="sign-up" /> : <Navigate to="/app" replace />} />
        <Route path="/app/*" element={<RequireAuth><Workspace userSlot={<UserSlot />} /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function ClerkWithRouter({ children }) {
  const navigate = useNavigate();
  return (
    <ClerkProvider
      publishableKey={CLERK_KEY}
      routerPush={to => navigate(to)}
      routerReplace={to => navigate(to, { replace: true })}
      afterSignOutUrl="/"
      appearance={clerkAppearance}
    >
      {children}
    </ClerkProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      {clerkEnabled ? <ClerkWithRouter><AppRoutes /></ClerkWithRouter> : <AppRoutes />}
    </BrowserRouter>
  </React.StrictMode>
);
