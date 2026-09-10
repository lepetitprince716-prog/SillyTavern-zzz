/**
 * Sampler controls for the chosen text-completion backend.
 *
 * A control the backend cannot use is disabled and labelled, rather than
 * presented as working. That is the one thing the classic panel does not do:
 * it shows every slider for every backend, so moving `mirostat` against a
 * vLLM server looks exactly like moving it against KoboldCpp, and only one of
 * those has any effect.
 */

import { RotateCcw } from 'lucide-react';
import { Slider } from '@/components/ui/controls';
import { Button, SectionLabel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/session';
import {
    BACKENDS,
    DEFAULT_SAMPLERS,
    isNeutral,
    SAMPLER_META,
    SAMPLERS,
    supportsSampler,
    type Sampler,
} from './backends';

/** Groups, so the panel reads as a few decisions rather than fifteen sliders. */
const GROUPS: Array<{ title: string; samplers: readonly Sampler[]; note?: string }> = [
    {
        title: 'Randomness',
        samplers: ['temperature'],
    },
    {
        title: 'Truncation',
        samplers: ['top_p', 'top_k', 'min_p', 'top_a', 'typical_p', 'tfs'],
        note: 'Each one cuts the candidate list a different way. Using several at once compounds them; most setups pick one or two.',
    },
    {
        title: 'Repetition',
        samplers: ['repetition_penalty', 'repetition_penalty_range', 'frequency_penalty', 'presence_penalty'],
    },
    {
        title: 'Mirostat',
        samplers: ['mirostat_mode', 'mirostat_tau', 'mirostat_eta'],
        note: 'Overrides the truncation settings above while it is on.',
    },
    {
        title: 'Reproducibility',
        samplers: ['seed'],
    },
];

export function SamplerPanel() {
    const settings = useSessionStore((state) => state.text);
    const setText = useSessionStore((state) => state.setText);
    const backend = BACKENDS[settings.backend];

    const set = (sampler: Sampler, value: number) =>
        setText({ samplers: { ...settings.samplers, [sampler]: value } });

    const unsupported = SAMPLERS.filter((sampler) => !supportsSampler(settings.backend, sampler));

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-3">
                <p className="text-xs leading-relaxed text-subtle">
                    Sampler names differ between backends, so these are sent under whatever{' '}
                    {backend.label} calls them. Anything at its neutral value is left out of the
                    request entirely.
                </p>
                <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() => setText({ samplers: { ...DEFAULT_SAMPLERS } })}
                >
                    <RotateCcw className="size-3.5" />
                    Reset
                </Button>
            </div>

            {GROUPS.map((group) => {
                const available = group.samplers.filter((sampler) =>
                    supportsSampler(settings.backend, sampler));
                if (available.length === 0) {
                    return null;
                }
                return (
                    <section key={group.title} className="space-y-4">
                        <SectionLabel>{group.title}</SectionLabel>
                        {group.note ? (
                            <p className="-mt-2 text-[0.6875rem] leading-relaxed text-subtle">
                                {group.note}
                            </p>
                        ) : null}
                        {available.map((sampler) => {
                            const meta = SAMPLER_META[sampler];
                            const value = settings.samplers[sampler];
                            const off = isNeutral(sampler, value);
                            return (
                                <div key={sampler} className="space-y-1">
                                    <Slider
                                        label={meta.label}
                                        value={value}
                                        min={meta.min}
                                        max={meta.max}
                                        step={meta.step}
                                        onValueChange={(next) => set(sampler, next)}
                                        format={(current) =>
                                            isNeutral(sampler, current)
                                                ? 'off'
                                                : String(Number(current.toFixed(4)))}
                                    />
                                    {meta.hint ? (
                                        <p className={cn('text-[0.6875rem] text-subtle', off && 'opacity-70')}>
                                            {meta.hint}
                                        </p>
                                    ) : null}
                                </div>
                            );
                        })}
                    </section>
                );
            })}

            {unsupported.length > 0 ? (
                <section className="space-y-1.5 rounded-lg border border-border bg-surface-2/50 p-3">
                    <h3 className="text-xs font-semibold text-muted">
                        {backend.label} has no
                    </h3>
                    <p className="text-[0.6875rem] leading-relaxed text-subtle">
                        {unsupported.map((sampler) => SAMPLER_META[sampler].label).join(', ')}. These
                        are hidden rather than shown as working — sending them would change nothing.
                    </p>
                </section>
            ) : null}
        </div>
    );
}
