import React, { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { SignIn, SignUp } from '@clerk/react';
import BrandMark from '../components/BrandMark';

const HeroScene = lazy(() => import('../components/three/HeroScene'));

export default function AuthPage({ mode }) {
  return (
    <div className="landing tw:relative tw:flex tw:min-h-screen tw:flex-col tw:overflow-x-hidden tw:font-sans tw:text-ink tw:lp-bg">
      <div className="tw:fixed tw:inset-0 tw:opacity-85" aria-hidden="true">
        <Suspense fallback={null}><HeroScene dim /></Suspense>
      </div>
      <header className="tw:fixed! tw:inset-x-0 tw:top-0 tw:z-30 tw:m-0 tw:flex tw:items-center tw:border-0 tw:px-[max(16px,4vw)] tw:py-3.5 tw:shadow-none tw:backdrop-blur-[8px] tw:lp-nav-fade">
        <Link to="/" className="tw:flex tw:items-center tw:gap-2.5 tw:font-display tw:text-[19px] tw:font-bold tw:tracking-[0.04em] tw:text-ink tw:no-underline"><BrandMark /> MAHA</Link>
      </header>
      <main className="tw:relative tw:z-[1] tw:flex tw:flex-1 tw:flex-col tw:items-center tw:justify-center tw:gap-[18px] tw:px-4 tw:pt-[110px] tw:pb-12">
        {mode === 'sign-up'
          ? <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/app" />
          : <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/app" />}
        <p className="tw:m-0 tw:max-w-[400px] tw:rounded-[10px] tw:border tw:border-line tw:bg-night/80 tw:px-3.5 tw:py-2 tw:text-center tw:text-[13px] tw:text-ink-2 tw:backdrop-blur-[6px]">
          Signing in opens the workspace. Case access still needs your MAHA access token.
        </p>
      </main>
    </div>
  );
}
