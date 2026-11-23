// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { Slot as SlotPrimitive } from 'radix-ui';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'tw:inline-flex tw:items-center tw:justify-center tw:gap-1 tw:w-fit tw:whitespace-nowrap tw:shrink-0 tw:overflow-hidden tw:rounded-md tw:border tw:px-2 tw:py-0.5 tw:text-xs tw:font-medium tw:[&>svg]:size-3 tw:[&>svg]:pointer-events-none tw:transition-[color,box-shadow]',
  {
    variants: {
      variant: {
        default: 'tw:border-transparent tw:bg-primary tw:text-primary-foreground',
        secondary: 'tw:border-transparent tw:bg-secondary tw:text-secondary-foreground',
        destructive: 'tw:border-transparent tw:bg-destructive tw:text-white',
        outline: 'tw:border-border tw:text-foreground'
      }
    },
    defaultVariants: { variant: 'default' }
  }
);

function Badge({ className, variant, asChild = false, ...props }) {
  const Comp = asChild ? SlotPrimitive.Slot : 'span';
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
