// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }) {
  return <div data-slot="card" className={cn('tw:flex tw:flex-col tw:gap-6 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:py-6 tw:text-card-foreground tw:shadow-sm', className)} {...props} />;
}
function CardHeader({ className, ...props }) {
  return <div data-slot="card-header" className={cn('tw:grid tw:auto-rows-min tw:items-start tw:gap-1.5 tw:px-6', className)} {...props} />;
}
function CardTitle({ className, ...props }) {
  return <div data-slot="card-title" className={cn('tw:leading-none tw:font-semibold', className)} {...props} />;
}
function CardDescription({ className, ...props }) {
  return <div data-slot="card-description" className={cn('tw:text-sm tw:text-muted-foreground', className)} {...props} />;
}
function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('tw:px-6', className)} {...props} />;
}
function CardFooter({ className, ...props }) {
  return <div data-slot="card-footer" className={cn('tw:flex tw:items-center tw:px-6', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
