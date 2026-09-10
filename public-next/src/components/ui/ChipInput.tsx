import { X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import { Input } from './primitives';

export interface ChipInputProps {
    values: string[];
    onChange(values: string[]): void;
    /** Accessible name and placeholder hint for the text field. */
    label: string;
    placeholder?: string;
    /** Offered as one-click additions below the field. */
    suggestions?: string[];
    /** Styles the chips as a warning, e.g. for exclusion keys. */
    tone?: 'neutral' | 'danger';
}

/**
 * Comma-or-Enter separated list editor.
 *
 * Used for character tags and for world info keys, which behave the same way:
 * a small set of short strings where pasting a comma-separated list should just
 * work and Backspace on an empty field should remove the last one.
 */
export function ChipInput({
    values,
    onChange,
    label,
    placeholder,
    suggestions = [],
    tone = 'neutral',
}: ChipInputProps) {
    const [entry, setEntry] = useState('');

    const add = (raw: string) => {
        const next = raw
            .split(',')
            .map((value) => value.trim())
            .filter((value) => value && !values.includes(value));
        if (next.length > 0) {
            onChange([...values, ...next]);
        }
        setEntry('');
    };

    const unused = suggestions.filter((value) => !values.includes(value)).slice(0, 8);

    return (
        <div className="space-y-2">
            {values.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                    {values.map((value) => (
                        <span
                            key={value}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-full py-0.5 pl-2.5 pr-1 text-xs',
                                tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-surface-3',
                            )}
                        >
                            {value}
                            <button
                                type="button"
                                onClick={() => onChange(values.filter((item) => item !== value))}
                                aria-label={`Remove ${value}`}
                                className="rounded-full p-0.5 text-subtle transition-colors hover:text-danger"
                            >
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}

            <Input
                value={entry}
                onChange={(event) => setEntry(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ',') {
                        event.preventDefault();
                        add(entry);
                    }
                    if (event.key === 'Backspace' && !entry && values.length > 0) {
                        onChange(values.slice(0, -1));
                    }
                }}
                onBlur={() => add(entry)}
                placeholder={placeholder ?? 'Type and press Enter'}
                aria-label={label}
            />

            {unused.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                    {unused.map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => onChange([...values, value])}
                            className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] text-subtle transition-colors hover:border-accent hover:text-accent"
                        >
                            + {value}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
