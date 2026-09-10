/** Toggles, sliders, selects and tabs. */

import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Select as RadixSelect, Slider as RadixSlider, Switch as RadixSwitch, Tabs as RadixTabs } from 'radix-ui';
import { cn } from '@/lib/cn';

export function Switch({
    checked,
    onCheckedChange,
    id,
    disabled,
}: {
    checked: boolean;
    onCheckedChange(checked: boolean): void;
    id?: string;
    disabled?: boolean;
}) {
    return (
        <RadixSwitch.Root
            id={id}
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            className={cn(
                'relative h-5.5 w-10 shrink-0 cursor-pointer rounded-full border border-transparent',
                'transition-colors duration-200 disabled:opacity-50',
                'data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-3',
                'data-[state=unchecked]:border-border',
            )}
        >
            <RadixSwitch.Thumb
                className={cn(
                    'block size-4.5 rounded-full bg-white shadow-sm',
                    'transition-transform duration-200 will-change-transform',
                    'translate-x-0.5 data-[state=checked]:translate-x-[1.125rem]',
                )}
            />
        </RadixSwitch.Root>
    );
}

/** A switch with a label and optional description, as used in settings lists. */
export function ToggleRow({
    label,
    description,
    checked,
    onCheckedChange,
}: {
    label: string;
    description?: string;
    checked: boolean;
    onCheckedChange(checked: boolean): void;
}) {
    const id = `toggle-${label.replace(/\s+/g, '-').toLowerCase()}`;
    return (
        <div className="flex items-start justify-between gap-4 py-1">
            <div className="min-w-0">
                <label htmlFor={id} className="block cursor-pointer text-[0.8125rem] font-medium">
                    {label}
                </label>
                {description ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-subtle">{description}</p>
                ) : null}
            </div>
            <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
        </div>
    );
}

export function Slider({
    value,
    onValueChange,
    min,
    max,
    step = 1,
    label,
    format,
}: {
    value: number;
    onValueChange(value: number): void;
    min: number;
    max: number;
    step?: number;
    label: string;
    /** Renders the current value; defaults to the raw number. */
    format?(value: number): string;
}) {
    return (
        <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[0.8125rem] font-medium">{label}</span>
                <span className="font-mono text-xs tabular-nums text-muted">
                    {format ? format(value) : value}
                </span>
            </div>
            <RadixSlider.Root
                value={[value]}
                onValueChange={([next]) => onValueChange(next ?? value)}
                min={min}
                max={max}
                step={step}
                aria-label={label}
                className="relative flex h-5 w-full touch-none select-none items-center"
            >
                <RadixSlider.Track className="relative h-1.5 w-full grow rounded-full bg-surface-3">
                    <RadixSlider.Range className="absolute h-full rounded-full bg-accent" />
                </RadixSlider.Track>
                <RadixSlider.Thumb
                    className={cn(
                        'block size-4 cursor-grab rounded-full border-2 border-accent bg-surface shadow-sm',
                        'transition-transform hover:scale-110 active:cursor-grabbing',
                        'focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                />
            </RadixSlider.Root>
        </div>
    );
}

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
}

export function Select({
    value,
    onValueChange,
    options,
    placeholder = 'Select…',
    id,
    disabled,
    className,
    'aria-label': ariaLabel,
}: {
    value: string;
    onValueChange(value: string): void;
    options: SelectOption[];
    placeholder?: string;
    id?: string;
    disabled?: boolean;
    className?: string;
    'aria-label'?: string;
}) {
    return (
        <RadixSelect.Root value={value || undefined} onValueChange={onValueChange} disabled={disabled}>
            <RadixSelect.Trigger
                id={id}
                aria-label={ariaLabel}
                className={cn(
                    'flex h-9.5 w-full items-center justify-between gap-2 rounded-lg border border-border',
                    'bg-surface px-3 text-left text-sm transition-colors',
                    'hover:border-border-strong focus:border-accent focus:outline-none',
                    'focus-visible:ring-2 focus-visible:ring-accent/35 disabled:opacity-50',
                    'data-[placeholder]:text-subtle',
                    className,
                )}
            >
                <RadixSelect.Value placeholder={placeholder} className="truncate" />
                <RadixSelect.Icon>
                    <ChevronDown className="size-4 shrink-0 text-subtle" />
                </RadixSelect.Icon>
            </RadixSelect.Trigger>
            <RadixSelect.Portal>
                <RadixSelect.Content
                    position="popper"
                    sideOffset={6}
                    className={cn(
                        'z-50 max-h-[min(24rem,60dvh)] min-w-[var(--radix-select-trigger-width)]',
                        'overflow-hidden rounded-xl border border-border bg-surface shadow-pop',
                    )}
                >
                    <RadixSelect.ScrollUpButton className="flex h-6 items-center justify-center text-subtle">
                        <ChevronDown className="size-3 rotate-180" />
                    </RadixSelect.ScrollUpButton>
                    <RadixSelect.Viewport className="p-1">
                        {options.map((option) => (
                            <RadixSelect.Item
                                key={option.value}
                                value={option.value}
                                className={cn(
                                    'flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-2.5 pr-8',
                                    'text-[0.8125rem] outline-none transition-colors',
                                    'data-[highlighted]:bg-surface-2 data-[state=checked]:text-accent',
                                )}
                            >
                                <div className="min-w-0 flex-1">
                                    <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                                    {option.description ? (
                                        <p className="mt-0.5 truncate text-xs text-subtle">{option.description}</p>
                                    ) : null}
                                </div>
                                <RadixSelect.ItemIndicator className="absolute right-2.5">
                                    <Check className="size-3.5" />
                                </RadixSelect.ItemIndicator>
                            </RadixSelect.Item>
                        ))}
                    </RadixSelect.Viewport>
                    <RadixSelect.ScrollDownButton className="flex h-6 items-center justify-center text-subtle">
                        <ChevronDown className="size-3" />
                    </RadixSelect.ScrollDownButton>
                </RadixSelect.Content>
            </RadixSelect.Portal>
        </RadixSelect.Root>
    );
}

/** A compact set of mutually exclusive options, styled as one control. */
export function SegmentedControl<T extends string>({
    value,
    onValueChange,
    options,
    label,
}: {
    value: T;
    onValueChange(value: T): void;
    options: Array<{ value: T; label: ReactNode; title?: string }>;
    label: string;
}) {
    return (
        <div
            role="radiogroup"
            aria-label={label}
            className="flex gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5"
        >
            {options.map((option) => {
                const active = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={option.title}
                        onClick={() => onValueChange(option.value)}
                        className={cn(
                            'flex-1 rounded-[0.3125rem] px-2.5 py-1.5 text-xs font-medium transition-colors',
                            active
                                ? 'bg-surface text-text shadow-sm'
                                : 'text-muted hover:text-text',
                        )}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}

export const Tabs = RadixTabs.Root;

export function TabsList({ children }: { children: ReactNode }) {
    return (
        <RadixTabs.List className="flex gap-1 border-b border-border">{children}</RadixTabs.List>
    );
}

export function TabsTrigger({ value, children }: { value: string; children: ReactNode }) {
    return (
        <RadixTabs.Trigger
            value={value}
            className={cn(
                'relative -mb-px border-b-2 border-transparent px-3 py-2 text-[0.8125rem] font-medium',
                'text-muted transition-colors hover:text-text',
                'data-[state=active]:border-accent data-[state=active]:text-text',
            )}
        >
            {children}
        </RadixTabs.Trigger>
    );
}

export function TabsContent({ value, children }: { value: string; children: ReactNode }) {
    return (
        <RadixTabs.Content value={value} className="pt-4 focus-visible:outline-none">
            {children}
        </RadixTabs.Content>
    );
}
