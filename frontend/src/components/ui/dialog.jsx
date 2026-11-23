// shadcn/ui (new-york) component, adapted to this project's `tw:` Tailwind prefix.
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

function Dialog(props) { return <DialogPrimitive.Root data-slot="dialog" {...props} />; }
function DialogTrigger(props) { return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />; }
function DialogPortal(props) { return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />; }
function DialogClose(props) { return <DialogPrimitive.Close data-slot="dialog-close" {...props} />; }

function DialogOverlay({ className, ...props }) {
  return <DialogPrimitive.Overlay data-slot="dialog-overlay" className={cn('tw:fixed tw:inset-0 tw:z-50 tw:bg-black/60 tw:backdrop-blur-[2px] tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0', className)} {...props} />;
}

function DialogContent({ className, children, showCloseButton = true, ...props }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content data-slot="dialog-content" className={cn('tw:fixed tw:top-[50%] tw:left-[50%] tw:z-50 tw:grid tw:max-h-[calc(100vh-2rem)] tw:w-full tw:max-w-[calc(100%-2rem)] tw:translate-x-[-50%] tw:translate-y-[-50%] tw:gap-4 tw:overflow-y-auto tw:rounded-xl tw:border tw:border-border tw:bg-background tw:p-6 tw:text-foreground tw:shadow-lg tw:duration-200 tw:data-[state=open]:animate-in tw:data-[state=closed]:animate-out tw:data-[state=closed]:fade-out-0 tw:data-[state=open]:fade-in-0 tw:data-[state=closed]:zoom-out-95 tw:data-[state=open]:zoom-in-95 tw:sm:max-w-lg', className)} {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" className="tw:absolute tw:top-4 tw:right-4 tw:inline-flex tw:size-7 tw:min-h-0 tw:cursor-pointer tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-muted-foreground tw:opacity-80 tw:transition-opacity tw:hover:bg-accent tw:hover:opacity-100 tw:focus-visible:ring-[3px] tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none tw:[&_svg]:size-4">
            <XIcon />
            <span className="tw:sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }) {
  return <div data-slot="dialog-header" className={cn('tw:flex tw:flex-col tw:gap-2 tw:text-center tw:sm:text-left', className)} {...props} />;
}
function DialogFooter({ className, ...props }) {
  return <div data-slot="dialog-footer" className={cn('tw:flex tw:flex-col-reverse tw:gap-2 tw:sm:flex-row tw:sm:justify-end', className)} {...props} />;
}
function DialogTitle({ className, ...props }) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('tw:m-0 tw:font-display tw:text-lg tw:leading-tight tw:font-semibold', className)} {...props} />;
}
function DialogDescription({ className, ...props }) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('tw:m-0 tw:text-sm tw:text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger };
