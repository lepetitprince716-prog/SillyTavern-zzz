/**
 * Toast surface.
 *
 * Deliberately hand-rolled rather than another dependency: the surface needed
 * here is one function and one region, and this way the styling comes from the
 * same tokens as everything else. State and the imperative API live in
 * `@/lib/toast`.
 */

import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/lib/cn';
import { AUTO_DISMISS_MS, useToastStore, type Toast, type ToastTone } from '@/lib/toast';

const TONES: Record<ToastTone, { icon: typeof Info; className: string }> = {
    info: { icon: Info, className: 'text-accent' },
    success: { icon: CheckCircle2, className: 'text-success' },
    error: { icon: AlertTriangle, className: 'text-danger' },
};

function ToastCard({ toast: item }: { toast: Toast }) {
    const dismiss = useToastStore((state) => state.dismiss);
    const { icon: Icon, className } = TONES[item.tone];

    useEffect(() => {
        const timeout = AUTO_DISMISS_MS[item.tone];
        if (!timeout) {
            return;
        }
        const handle = window.setTimeout(() => dismiss(item.id), timeout);
        return () => window.clearTimeout(handle);
    }, [item.id, item.tone, dismiss]);

    return (
        <div
            className={cn(
                'animate-fade-rise pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3',
                'rounded-xl border border-border bg-surface p-3.5 shadow-pop',
            )}
        >
            <Icon className={cn('mt-px size-4 shrink-0', className)} />
            <div className="min-w-0 flex-1">
                <p className="text-[0.8125rem] font-medium">{item.title}</p>
                {item.description ? (
                    <p className="mt-0.5 break-words text-xs leading-relaxed text-muted">{item.description}</p>
                ) : null}
            </div>
            <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss"
                className="-m-1 rounded p-1 text-subtle transition-colors hover:text-text"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}

/** Mount once, near the app root. */
export function Toaster() {
    const toasts = useToastStore((state) => state.toasts);
    return (
        <div
            aria-live="polite"
            aria-atomic="false"
            className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col-reverse gap-2 pb-safe"
        >
            {toasts.map((item) => (
                <ToastCard key={item.id} toast={item} />
            ))}
        </div>
    );
}
