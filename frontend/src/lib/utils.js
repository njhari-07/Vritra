import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Tailwind is loaded with prefix(tw), so classes look like `tw:px-2`.
const twMerge = extendTailwindMerge({ prefix: 'tw' });

/** Join class names and resolve conflicting Tailwind classes (shadcn's `cn`). */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
