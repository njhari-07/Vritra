import React, { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { SignIn, SignUp } from '@clerk/react';
import BrandMark from '../components/BrandMark';
import '../landing.css';

const HeroScene = lazy(() => import('../components/three/HeroScene'));

export default function AuthPage({ mode }) {
  return (
    <div className="landing auth-page">
      <div className="auth-bg" aria-hidden="true">
        <Suspense fallback={null}><HeroScene dim /></Suspense>
      </div>
      <header className="lp-nav">
        <Link to="/" className="lp-brand"><BrandMark /> MAHA</Link>
      </header>
      <main className="auth-center">
        {mode === 'sign-up'
          ? <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/app" />
          : <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/app" />}
        <p className="auth-note">Signing in opens the workspace. Case access still needs your MAHA access token.</p>
      </main>
    </div>
  );
}
