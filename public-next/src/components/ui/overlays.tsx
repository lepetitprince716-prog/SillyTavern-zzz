/**
 * Overlay primitives built on Radix, which supplies the focus trapping, escape
 * handling and ARIA wiring that hand-rolled overlays usually get wrong.
 */

import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Dialog as RadixDialog, DropdownMenu as RadixMenu, Tooltip as RadixTooltip } from 'radix-ui';
import { cn } from '@/lib/cn';
import { IconButton } from './primitives';

const OVERLAY_CLASS = 'fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px]';

export interface ModalProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    description?: string;
    children: ReactNode;
    footer?: ReactNode;
    /** Constrains the dialog width. Defaults to `md`. */
    size?: 'sm' | 'md' | 'lg';
}

const MODAL_SIZES = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-3xl',
} as const;

/**
 * A centred modal on desktop that becomes a bottom sheet on narrow screens,
 * which keeps the primary action within thumb reach on a phone.
 */
export function Modal({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    size = 'md',
}: ModalProps) {
    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className={OVERLAY_CLASS} />
                <RadixDialog.Content
                    className={cn(
                        'fixed z-50 flex flex-col overflow-hidden border border-border bg-surface shadow-pop',
                        'inset-x-0 bottom-0 max-h-[88dvh] rounded-t-2xl pb-safe',
                        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100vw-2rem)]',
                        'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0',
                        MODAL_SIZES[size],
                    )}
                >
                    <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                        <div className="min-w-0 flex-1">
                            <RadixDialog.Title className="truncate text-[0.9375rem] font-semibold">
                                {title}
                            </RadixDialog.Title>
                            {description ? (
                                <RadixDialog.Description className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">
                                    {description}
                                </RadixDialog.Description>
                            ) : null}
                        </div>
                        <RadixDialog.Close asChild>
                            <IconButton label="Close" variant="ghost" size="icon-sm">
                                <X className="size-4" />
                            </IconButton>
                        </RadixDialog.Close>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

                    {footer ? (
                        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-2/60 px-5 py-3">
                            {footer}
                        </div>
                    ) : null}
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}

/** A side drawer. Used for settings and the character inspector on mobile. */
export function Drawer({
    open,
    onOpenChange,
    title,
    side = 'right',
    children,
}: {
    open: boolean;
    onOpenChange(open: boolean): void;
    title: string;
    side?: 'left' | 'right';
    children: ReactNode;
}) {
    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className={OVERLAY_CLASS} />
                <RadixDialog.Content
                    className={cn(
                        'fixed inset-y-0 z-50 flex w-[min(24rem,100vw)] flex-col border-border bg-surface shadow-pop',
                        side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
                    )}
                >
                    <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4 pt-safe">
                        <RadixDialog.Title className="text-[0.9375rem] font-semibold">{title}</RadixDialog.Title>
                        <RadixDialog.Close asChild>
                            <IconButton label="Close" variant="ghost" size="icon-sm">
                                <X className="size-4" />
                            </IconButton>
                        </RadixDialog.Close>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 pb-safe">{children}</div>
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}

export function TooltipProvider({ children }: { children: ReactNode }) {
    return (
        <RadixTooltip.Provider delayDuration={450} skipDelayDuration={200}>
            {children}
        </RadixTooltip.Provider>
    );
}

/** Wraps a trigger with a tooltip. Pointer-only; keyboard users get the label. */
export function Tooltip({
    content,
    children,
    side = 'top',
}: {
    content: ReactNode;
    children: ReactNode;
    side?: 'top' | 'right' | 'bottom' | 'left';
}) {
    if (!content) {
        return <>{children}</>;
    }
    return (
        <RadixTooltip.Root>
            <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
            <RadixTooltip.Portal>
                <RadixTooltip.Content
                    side={side}
                    sideOffset={6}
                    className={cn(
                        'z-50 max-w-xs rounded-md border border-border bg-surface-2 px-2.5 py-1.5',
                        'text-xs leading-relaxed text-text shadow-pop',
                    )}
                >
                    {content}
                </RadixTooltip.Content>
            </RadixTooltip.Portal>
        </RadixTooltip.Root>
    );
}

export const Menu = RadixMenu.Root;
export const MenuTrigger = RadixMenu.Trigger;

export function MenuContent({
    children,
    align = 'end',
    className,
}: {
    children: ReactNode;
    align?: 'start' | 'center' | 'end';
    className?: string;
}) {
    return (
        <RadixMenu.Portal>
            <RadixMenu.Content
                align={align}
                sideOffset={6}
                className={cn(
                    'z-50 min-w-48 overflow-hidden rounded-xl border border-border bg-surface p-1 shadow-pop',
                    className,
                )}
            >
                {children}
            </RadixMenu.Content>
        </RadixMenu.Portal>
    );
}

export function MenuItem({
    className,
    tone = 'neutral',
    ...props
}: ComponentProps<typeof RadixMenu.Item> & { tone?: 'neutral' | 'danger' }) {
    return (
        <RadixMenu.Item
            className={cn(
                'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem]',
                'outline-none transition-colors data-[highlighted]:bg-surface-2',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
                '[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-subtle',
                tone === 'danger'
                    ? 'text-danger data-[highlighted]:bg-danger-soft [&>svg]:text-danger'
                    : 'text-text',
                className,
            )}
            {...props}
        />
    );
}

export function MenuSeparator() {
    return <RadixMenu.Separator className="my-1 h-px bg-border" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
    return (
        <RadixMenu.Label className="px-2.5 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-subtle">
            {children}
        </RadixMenu.Label>
    );
}
