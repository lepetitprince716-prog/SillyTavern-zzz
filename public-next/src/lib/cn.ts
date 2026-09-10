import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and resolves Tailwind conflicts, so a component's default
 * classes can always be overridden by a caller's `className`.
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
