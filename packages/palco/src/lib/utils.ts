import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The shadcn/ui `cn` convention — `clsx` for conditional class composition,
 * `tailwind-merge` to resolve conflicting Tailwind utility classes (e.g. a
 * caller-supplied `className` overriding a component's default `p-2`)
 * instead of letting both survive in the DOM. Exists so any future
 * shadcn-style component drops into this package without extra plumbing
 * (v3.2 plan, Commit 1).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
