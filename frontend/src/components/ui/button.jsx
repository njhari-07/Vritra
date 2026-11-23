// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { Slot as SlotPrimitive } from 'radix-ui';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'tw:inline-flex tw:min-h-0 tw:items-center tw:justify-center tw:hover:transform-none tw:hover:opacity-100 tw:gap-2 tw:whitespace-nowrap tw:rounded-md tw:text-sm tw:font-medium tw:transition-all tw:cursor-pointer tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:[&_svg]:pointer-events-none tw:[&_svg:not([class*=size-])]:size-4 tw:shrink-0 tw:[&_svg]:shrink-0 tw:outline-none tw:focus-visible:border-ring tw:focus-visible:ring-ring/50 tw:focus-visible:ring-[3px]',
  {
    variants: {
      variant: {
        default: 'tw:bg-primary tw:text-primary-foreground tw:shadow-xs tw:hover:bg-primary/90',
        destructive: 'tw:bg-destructive tw:text-white tw:shadow-xs tw:hover:bg-destructive/90 tw:focus-visible:ring-destructive/40',
        outline: 'tw:border tw:border-border tw:bg-background tw:text-foreground tw:shadow-xs tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:bg-input/30 tw:dark:hover:bg-input/50',
        secondary: 'tw:bg-secondary tw:text-secondary-foreground tw:shadow-xs tw:hover:bg-secondary/80',
        ghost: 'tw:bg-transparent tw:text-foreground tw:hover:bg-accent tw:hover:text-accent-foreground tw:dark:hover:bg-accent/50',
        link: 'tw:bg-transparent tw:text-primary tw:underline-offset-4 tw:hover:underline'
      },
      size: {
        default: 'tw:h-9 tw:px-4 tw:py-2 tw:has-[>svg]:px-3',
        sm: 'tw:h-8 tw:gap-1.5 tw:rounded-md tw:px-3 tw:has-[>svg]:px-2.5',
        lg: 'tw:h-10 tw:rounded-md tw:px-6 tw:has-[>svg]:px-4',
        icon: 'tw:size-9'
      }
    },
    defaultVariants: { variant: 'default', size: 'default' }
  }
);

function Button({ className, variant, size, asChild = false, ...props }) {
  const Comp = asChild ? SlotPrimitive.Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
