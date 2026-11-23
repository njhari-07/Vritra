// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { Slider as SliderPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function Slider({ className, defaultValue, value, min = 0, max = 100, ...props }) {
  const values = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min, max]),
    [value, defaultValue, min, max]
  );
  return (
    <SliderPrimitive.Root data-slot="slider" defaultValue={defaultValue} value={value} min={min} max={max} className={cn('tw:relative tw:flex tw:w-full tw:touch-none tw:items-center tw:select-none tw:data-[disabled]:opacity-50', className)} {...props}>
      <SliderPrimitive.Track data-slot="slider-track" className="tw:relative tw:h-1.5 tw:w-full tw:grow tw:overflow-hidden tw:rounded-full tw:bg-muted">
        <SliderPrimitive.Range data-slot="slider-range" className="tw:absolute tw:h-full tw:bg-primary" />
      </SliderPrimitive.Track>
      {values.map((_, i) => <SliderPrimitive.Thumb data-slot="slider-thumb" key={i} className="tw:block tw:size-4 tw:shrink-0 tw:cursor-grab tw:rounded-full tw:border tw:border-primary tw:bg-background tw:shadow-sm tw:transition-[color,box-shadow] tw:hover:ring-4 tw:hover:ring-ring/40 tw:focus-visible:ring-4 tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none" />)}
    </SliderPrimitive.Root>
  );
}

export { Slider };
