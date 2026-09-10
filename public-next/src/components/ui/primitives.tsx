/**
 * Core form and layout primitives.
 *
 * React 19 treats `ref` as an ordinary prop, so none of these need
 * `forwardRef` — they simply spread through to the underlying element.
 */

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const BUTTON_BASE =
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
    'transition-[background-color,color,border-color,opacity,transform] duration-150 ' +
    'disabled:pointer-events-none disabled:opacity-45 active:scale-[0.98] select-none';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-fg hover:bg-accent-hover shadow-sm',
    secondary: 'bg-surface-2 text-text border border-border hover:bg-surface-3 hover:border-border-strong',
    ghost: 'text-muted hover:bg-surface-2 hover:text-text',
    danger: 'bg-danger text-white hover:opacity-90',
    link: 'text-accent hover:underline underline-offset-4 px-0',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
    sm: 'h-8 px-3 text-[0.8125rem]',
    md: 'h-9.5 px-4 text-sm',
    lg: 'h-11 px-5 text-[0.9375rem]',
    icon: 'size-9.5 shrink-0',
    'icon-sm': 'size-8 shrink-0',
};

export interface ButtonProps extends ComponentProps<'button'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
}

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
    return (
        <button
            type="button"
            className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
            {...props}
        />
    );
}

/** A square, icon-only button. `label` becomes its accessible name. */
export function IconButton({
    label,
    size = 'icon',
    className,
    ...props
}: Omit<ButtonProps, 'children'> & { label: string; children?: ReactNode }) {
    return <Button aria-label={label} title={label} size={size} className={className} {...props} />;
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
    return (
        <input
            className={cn(
                'h-9.5 w-full rounded-lg border border-border bg-surface px-3 text-sm',
                'placeholder:text-subtle transition-colors',
                'hover:border-border-strong focus:border-accent focus:outline-none',
                'focus-visible:ring-2 focus-visible:ring-accent/35',
                'disabled:opacity-50',
                className,
            )}
            {...props}
        />
    );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
    return (
        <textarea
            className={cn(
                'w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm leading-relaxed',
                'placeholder:text-subtle transition-colors resize-y',
                'hover:border-border-strong focus:border-accent focus:outline-none',
                'focus-visible:ring-2 focus-visible:ring-accent/35',
                className,
            )}
            {...props}
        />
    );
}

/** A labelled control group with optional help text. */
export function Field({
    label,
    hint,
    htmlFor,
    children,
    className,
}: {
    label: string;
    hint?: ReactNode;
    htmlFor?: string;
    children: ReactNode;
    className?: string;
}) {
    return (
        <div className={cn('space-y-1.5', className)}>
            <label htmlFor={htmlFor} className="block text-[0.8125rem] font-medium text-text">
                {label}
            </label>
            {children}
            {hint ? <p className="text-xs leading-relaxed text-subtle">{hint}</p> : null}
        </div>
    );
}

export function Badge({
    tone = 'neutral',
    className,
    ...props
}: ComponentProps<'span'> & { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }) {
    const tones = {
        neutral: 'bg-surface-3 text-muted',
        accent: 'bg-accent-soft text-accent',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger-soft text-danger',
    } as const;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium',
                tones[tone],
                className,
            )}
            {...props}
        />
    );
}

export function Spinner({ className }: { className?: string }) {
    return (
        <span
            role="status"
            aria-label="Loading"
            className={cn(
                'inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent opacity-60',
                className,
            )}
        />
    );
}

/** Placeholder block used while content loads. */
export function Skeleton({ className }: { className?: string }) {
    return <div aria-hidden className={cn('skeleton rounded-md', className)} />;
}

/** Centred message for an empty list or an error. */
export function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon?: ReactNode;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            {icon ? <div className="text-subtle [&>svg]:size-8">{icon}</div> : null}
            <div className="space-y-1">
                <p className="text-sm font-medium text-text">{title}</p>
                {description ? (
                    <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted">{description}</p>
                ) : null}
            </div>
            {action}
        </div>
    );
}

/** Section heading inside panels and the sidebar. */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <p
            className={cn(
                'px-1 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-subtle',
                className,
            )}
        >
            {children}
        </p>
    );
}
