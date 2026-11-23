// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

function Tabs({ className, ...props }) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('tw:flex tw:flex-col tw:gap-2', className)} {...props} />;
}
function TabsList({ className, ...props }) {
  return <TabsPrimitive.List data-slot="tabs-list" className={cn('tw:inline-flex tw:h-9 tw:w-fit tw:items-center tw:justify-center tw:rounded-lg tw:bg-muted tw:p-[3px] tw:text-muted-foreground', className)} {...props} />;
}
function TabsTrigger({ className, ...props }) {
  return <TabsPrimitive.Trigger data-slot="tabs-trigger" className={cn('tw:inline-flex tw:min-h-0 tw:hover:transform-none tw:hover:opacity-100 tw:h-[calc(100%-1px)] tw:flex-1 tw:cursor-pointer tw:items-center tw:justify-center tw:gap-1.5 tw:rounded-md tw:border tw:border-transparent tw:bg-transparent tw:px-3 tw:py-1 tw:text-sm tw:font-medium tw:whitespace-nowrap tw:text-muted-foreground tw:transition-[color,box-shadow] tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none tw:disabled:pointer-events-none tw:disabled:opacity-50 tw:data-[state=active]:bg-background tw:data-[state=active]:text-foreground tw:data-[state=active]:shadow-sm tw:dark:data-[state=active]:border-input tw:dark:data-[state=active]:bg-input/30 tw:[&_svg]:pointer-events-none tw:[&_svg]:shrink-0 tw:[&_svg:not([class*=size-])]:size-4', className)} {...props} />;
}
function TabsContent({ className, ...props }) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('tw:flex-1 tw:outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
