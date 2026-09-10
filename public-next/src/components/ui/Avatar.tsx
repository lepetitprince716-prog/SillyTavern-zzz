import { useState } from 'react';
import { cn } from '@/lib/cn';

/** Stable hue from a name, so a character keeps the same fallback colour. */
function hueFromName(name: string): number {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) % 360;
    }
    return hash;
}

/** First letters of up to two words, for the image-less fallback. */
function initials(name: string): string {
    const words = name.trim().split(/\s+/).slice(0, 2);
    return words.map((word) => [...word][0] ?? '').join('').toUpperCase() || '?';
}

const SIZES = {
    xs: 'size-6 text-[0.5625rem]',
    sm: 'size-8 text-[0.6875rem]',
    md: 'size-10 text-xs',
    lg: 'size-14 text-sm',
    xl: 'size-24 text-lg',
} as const;

export function Avatar({
    src,
    name,
    size = 'md',
    className,
    rounded = 'full',
}: {
    src?: string;
    name: string;
    size?: keyof typeof SIZES;
    className?: string;
    rounded?: 'full' | 'card';
}) {
    const [failed, setFailed] = useState(false);
    const showImage = Boolean(src) && !failed;
    const shape = rounded === 'full' ? 'rounded-full' : 'rounded-[0.625rem]';

    return (
        <span
            className={cn(
                'relative inline-flex shrink-0 items-center justify-center overflow-hidden',
                'border border-border/60 bg-surface-2 font-semibold text-white/90 select-none',
                SIZES[size],
                shape,
                className,
            )}
            style={
                showImage
                    ? undefined
                    : { backgroundColor: `oklch(0.55 0.12 ${hueFromName(name)})` }
            }
        >
            {showImage ? (
                <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailed(true)}
                    className="size-full object-cover"
                />
            ) : (
                <span aria-hidden>{initials(name)}</span>
            )}
        </span>
    );
}
