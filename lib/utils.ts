import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names, with later classes winning conflicts.
 * Standard shadcn/ui helper — components under components/ui import this.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
