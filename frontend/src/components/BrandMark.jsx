import React from 'react';

/**
 * VRITRA Brand Mark — Bold Architectural V+M Synthesis
 * Bolder outer V (VRITRA) framing the inner structural M (MAHA) with crossbar
 * and enlarged, perfectly-spaced vector MAHA core.
 */
export default function BrandMark({ size = 22, className = '' }) {
  const px = typeof size === 'number' ? `${size}px` : size;
  return (
    <svg
      className={className}
      style={{ width: px, height: px, minWidth: px, display: 'inline-block', verticalAlign: 'middle' }}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="vr-c-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5AA9FF" />
          <stop offset="100%" stopColor="#3DD6B5" />
        </linearGradient>
      </defs>

      {/* Bold Outer V (VRITRA) */}
      <path
        d="M3.5 6L18 31L32.5 6"
        stroke="url(#vr-c-grad)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Bold Inner Architectural M (MAHA framework) */}
      <path
        d="M9.5 9.5L9.5 17.5L18 24L26.5 17.5L26.5 9.5"
        stroke="#F2B544"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Crossbar linking the A-H geometry */}
      <line
        x1="9.5"
        y1="14.2"
        x2="26.5"
        y2="14.2"
        stroke="#3DD6B5"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* Inset MAHA with uniform word spacing, larger size & perfect geometric alignment */}
      <g stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {/* M (x: 10.2 -> 13.4) */}
        <path d="M10.2 13L10.2 7L11.8 10.8L13.4 7L13.4 13" />
        {/* A (x: 14.6 -> 17.6) */}
        <path d="M14.6 13L16.1 7L17.6 13 M15.1 11.2L17.1 11.2" />
        {/* H (x: 18.8 -> 21.8) */}
        <path d="M18.8 7L18.8 13 M21.8 7L21.8 13 M18.8 10.2L21.8 10.2" />
        {/* A (x: 23.0 -> 26.0) */}
        <path d="M23 13L24.5 7L26 13 M23.5 11.2L25.5 11.2" />
      </g>
    </svg>
  );
}
