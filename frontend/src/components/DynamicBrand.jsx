import React, { useEffect, useState, useRef } from 'react';
import BrandMark from './BrandMark';

/**
 * DynamicBrand — Animated VRITRA wordmark.
 * Sequence on load:
 * 1. Displays only the logo mark initially.
 * 2. 'VRITRA' smoothly fades & glides in.
 * 3. The logo mark performs a smooth, slow 360° spin.
 * Replays rotation on hover or click.
 */
export default function DynamicBrand({ size = 24, className = '', textClassName = '', interactive = true }) {
  const [phase, setPhase] = useState('initial'); // 'initial' -> 'text-revealed' -> 'spinning' -> 'idle'
  const spinningRef = useRef(false);

  useEffect(() => {
    // Step 1: display just the logo, then reveal 'VRITRA' at 700ms
    const t1 = setTimeout(() => {
      setPhase('text-revealed');
    }, 700);

    // Step 2: once text appears, trigger the slow 360 spin at 1500ms
    const t2 = setTimeout(() => {
      setPhase('spinning');
      spinningRef.current = true;
    }, 1500);

    // Step 3: transition to idle after 360 spin finishes
    const t3 = setTimeout(() => {
      setPhase('idle');
      spinningRef.current = false;
    }, 5200);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  const triggerSpin = () => {
    if (!interactive || spinningRef.current) return;
    spinningRef.current = true;
    setPhase('spinning-manual');
    setTimeout(() => {
      setPhase('idle');
      spinningRef.current = false;
    }, 3500);
  };

  const showText = phase !== 'initial';
  const isSpinning = phase === 'spinning' || phase === 'spinning-manual';

  return (
    <div
      className={`dynamic-brand ${className}`}
      onClick={triggerSpin}
      onMouseEnter={triggerSpin}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '9px',
        cursor: interactive ? 'pointer' : 'default',
        userSelect: 'none',
      }}
      title="Hover or click to spin"
    >
      <div
        className="dynamic-brand-icon-stage"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          perspective: '600px',
        }}
      >
        <div
          className="dynamic-brand-icon"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transformStyle: 'preserve-3d',
            transition: isSpinning
              ? 'transform 3.2s cubic-bezier(0.25, 1, 0.4, 1)'
              : 'transform 0.4s ease',
            transform: isSpinning ? 'rotateY(360deg)' : 'rotateY(0deg)',
            transformOrigin: 'center center',
            willChange: 'transform',
          }}
        >
          <BrandMark size={size} />
        </div>
      </div>

      <span
        className={`dynamic-brand-text ${textClassName}`}
        style={{
          display: 'inline-block',
          opacity: showText ? 1 : 0,
          transform: showText ? 'translateX(0) scale(1)' : 'translateX(-8px) scale(0.96)',
          transition: 'opacity 0.65s cubic-bezier(0.16, 1, 0.3, 1), transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)',
          letterSpacing: showText ? '0.04em' : '0.12em',
          fontWeight: 900,
          whiteSpace: 'nowrap',
        }}
      >
        VRITRA
      </span>
    </div>
  );
}
