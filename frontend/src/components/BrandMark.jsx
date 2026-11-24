import React from 'react';

/** MAHA logo: three linked nodes, in Evidence Gold. */
export default function BrandMark() {
  return (
    <svg className="tw:size-[22px] tw:fill-none tw:stroke-gold tw:[stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 18L12 5l7 13H5Z" />
      <g className="tw:fill-gold tw:stroke-none">
        <circle cx="5" cy="18" r="2" /><circle cx="12" cy="5" r="2" /><circle cx="19" cy="18" r="2" />
      </g>
    </svg>
  );
}
