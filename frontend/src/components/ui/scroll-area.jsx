// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function ScrollArea({ className, children, ...props }) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('tw:relative tw:overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className="tw:size-full tw:rounded-[inherit] tw:outline-none tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring/50">{children}</ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ className, orientation = 'vertical', ...props }) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn('tw:flex tw:touch-none tw:p-px tw:transition-colors tw:select-none', orientation === 'vertical' && 'tw:h-full tw:w-2.5 tw:border-l tw:border-l-transparent', orientation === 'horizontal' && 'tw:h-2.5 tw:flex-col tw:border-t tw:border-t-transparent', className)}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb data-slot="scroll-area-thumb" className="tw:relative tw:flex-1 tw:rounded-full tw:bg-border" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
