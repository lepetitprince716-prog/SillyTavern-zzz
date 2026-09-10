/**
 * The image generation panel.
 *
 * Two things it does differently from the classic extension's settings drawer.
 *
 * - It only shows what the chosen provider can actually use. The ComfyUI panel
 *   asks the workflow which placeholders it substitutes and greys out the rest,
 *   rather than presenting a full set of sliders where half do nothing because
 *   the workflow never references them.
 * - It reports the seed. A render you liked can be reproduced, and "vary this"
 *   keeps the settings but rolls a new seed — the pair of operations the
 *   classic UI cannot express because it never tells you the seed it used.
 */

import { Dices, ImagePlus, Link2, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    fetchComfyPlaceholders,
    fetchComfyWorkflows,
    fetchImageProviders,
    imageErrorMessage,
    pingComfy,
    type ImageProvider,
    type ImageRequest,
} from '@/api/images';
import type { MediaLayout } from '@/api/types';
import { SegmentedControl, Select, Slider, ToggleRow } from '@/components/ui/controls';
import { Modal } from '@/components/ui/overlays';
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { useSessionStore } from '@/store/session';

/** Sizes worth one click. Both providers accept anything, in multiples of 64. */
const SIZE_PRESETS: Array<{ label: string; width: number; height: number }> = [
    { label: 'Portrait', width: 832, height: 1216 },
    { label: 'Square', width: 1024, height: 1024 },
    { label: 'Landscape', width: 1216, height: 832 },
    { label: 'Wide', width: 1344, height: 768 },
];

const LAYOUT_OPTIONS: Array<{ value: MediaLayout; label: string; hint: string }> = [
    { value: 'inline', label: 'Below the text', hint: 'The reply stays as it is and the image follows it.' },
    { value: 'caption', label: 'As a caption', hint: 'The image leads, with the reply beneath it as a caption.' },
    { value: 'cover', label: 'Image only', hint: 'The reply is collapsed behind a toggle.' },
];

export interface ImageGenerationDialogProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    /** Seeds the prompt field; typically drawn from the message being illustrated. */
    initialPrompt?: string;
    /** Prompt suggestions taken from the chat, offered as one-click fills. */
    suggestions?: Array<{ label: string; prompt: string }>;
    onSubmit(request: ImageRequest, layout: MediaLayout): void;
}

export function ImageGenerationDialog({
    open,
    onOpenChange,
    initialPrompt = '',
    suggestions = [],
    onSubmit,
}: ImageGenerationDialogProps) {
    const settings = useSessionStore((state) => state.image);
    const setImage = useSessionStore((state) => state.setImage);

    const [prompt, setPrompt] = useState(initialPrompt);

    // Re-seed the prompt whenever the dialog is opened from a new place.
    const [promptSource, setPromptSource] = useState(initialPrompt);
    if (open && promptSource !== initialPrompt) {
        setPromptSource(initialPrompt);
        setPrompt(initialPrompt);
    }

    const providers = useQuery({
        queryKey: ['image-providers'],
        queryFn: fetchImageProviders,
        enabled: open,
        staleTime: 60_000,
    });

    const workflows = useQuery({
        queryKey: ['comfy-workflows'],
        queryFn: fetchComfyWorkflows,
        enabled: open && settings.provider === 'comfyui',
        staleTime: 60_000,
    });

    const placeholders = useQuery({
        queryKey: ['comfy-placeholders', settings.comfyui.workflow],
        queryFn: () => fetchComfyPlaceholders(settings.comfyui.workflow),
        enabled: open && settings.provider === 'comfyui' && Boolean(settings.comfyui.workflow),
        staleTime: 60_000,
    });

    const [pinging, setPinging] = useState(false);

    const providerStatus = providers.data?.find((entry) => entry.id === settings.provider);
    const isComfy = settings.provider === 'comfyui';

    /**
     * Placeholders the chosen workflow substitutes, or null when every control
     * is live — NovelAI consumes all of them, and a workflow that has not been
     * read yet is assumed to as well rather than greying out the whole panel.
     */
    const live = isComfy ? (placeholders.data ?? null) : null;

    /** Whether a control actually reaches the render. */
    const uses = (key: string) => !live || live.includes(key);

    // Reset a stale workflow selection once the real list arrives.
    useEffect(() => {
        const list = workflows.data;
        if (!list || list.length === 0 || list.includes(settings.comfyui.workflow)) {
            return;
        }
        setImage({ comfyui: { ...settings.comfyui, workflow: list[0]! } });
    }, [workflows.data, settings.comfyui, setImage]);

    const testComfy = async () => {
        setPinging(true);
        try {
            await pingComfy(settings.comfyui.url, settings.comfyui.auth || undefined);
            toast.success('ComfyUI answered', settings.comfyui.url);
        } catch (error) {
            toast.error('ComfyUI did not answer', imageErrorMessage(error));
        } finally {
            setPinging(false);
        }
    };

    const submit = (options: { newSeed: boolean }) => {
        const trimmed = prompt.trim();
        if (!trimmed) {
            toast.error('An image needs a prompt', 'Describe what you want to see.');
            return;
        }

        const request: ImageRequest = {
            provider: settings.provider,
            prompt: trimmed,
            negativePrompt: settings.negativePrompt,
            width: settings.width,
            height: settings.height,
            steps: settings.steps,
            cfgScale: settings.cfgScale,
            seed: options.newSeed ? -1 : settings.seed,
            ...(settings.sampler ? { sampler: settings.sampler } : {}),
            ...(settings.scheduler ? { scheduler: settings.scheduler } : {}),
            ...(settings.model ? { model: settings.model } : {}),
            ...(settings.provider === 'novelai' ? { novelai: settings.novelai } : {}),
            ...(isComfy
                ? {
                    comfyui: {
                        url: settings.comfyui.url,
                        auth: settings.comfyui.auth || undefined,
                        workflow: settings.comfyui.workflow,
                        denoise: settings.comfyui.denoise,
                        clipSkip: settings.comfyui.clipSkip,
                    },
                }
                : {}),
        };

        onSubmit(request, settings.layout);
        onOpenChange(false);
    };

    const providerOptions = (providers.data ?? []).map((entry) => ({
        value: entry.id,
        label: entry.configured ? entry.label : `${entry.label} — not configured`,
    }));

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title="Generate an image"
            description="Renders through the server, and saves into this character's image folder."
            size="lg"
            footer={
                <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" onClick={() => submit({ newSeed: false })}>
                        <ImagePlus className="size-4" />
                        Render
                    </Button>
                    <Button variant="secondary" onClick={() => submit({ newSeed: true })}>
                        <Dices className="size-4" />
                        Render with a new seed
                    </Button>
                    <Button variant="ghost" className="ml-auto" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                </div>
            }
        >
            <div className="space-y-5">
                <Field label="Provider" hint={providerStatus && !providerStatus.configured
                    ? providerStatus.requires === 'token'
                        ? 'Add a NovelAI token in Settings → Connection before rendering.'
                        : 'Point this at a running ComfyUI server below.'
                    : undefined}
                >
                    <Select
                        value={settings.provider}
                        onValueChange={(value) => setImage({ provider: value as ImageProvider })}
                        options={providerOptions.length > 0 ? providerOptions : [
                            { value: 'novelai', label: 'NovelAI' },
                            { value: 'comfyui', label: 'ComfyUI' },
                        ]}
                        aria-label="Image provider"
                    />
                </Field>

                <Field label="Prompt">
                    <Textarea
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="masterpiece, best quality, a fox girl with orange hair, warm evening light"
                        className="min-h-24"
                        aria-label="Image prompt"
                    />
                </Field>

                {suggestions.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                        {suggestions.map((suggestion) => (
                            <Button
                                key={suggestion.label}
                                size="sm"
                                variant="ghost"
                                onClick={() => setPrompt(suggestion.prompt)}
                            >
                                <Wand2 className="size-3.5" />
                                {suggestion.label}
                            </Button>
                        ))}
                    </div>
                ) : null}

                <Field label="Negative prompt" hint={uses('negative_prompt') ? undefined : 'This workflow ignores it.'}>
                    <Textarea
                        value={settings.negativePrompt}
                        onChange={(event) => setImage({ negativePrompt: event.target.value })}
                        placeholder="lowres, bad anatomy, watermark"
                        className={cn('min-h-16', !uses('negative_prompt') && 'opacity-50')}
                        aria-label="Negative prompt"
                    />
                </Field>

                <div className="space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                        {SIZE_PRESETS.map((preset) => {
                            const active = settings.width === preset.width && settings.height === preset.height;
                            return (
                                <Button
                                    key={preset.label}
                                    size="sm"
                                    variant={active ? 'primary' : 'ghost'}
                                    onClick={() => setImage({ width: preset.width, height: preset.height })}
                                >
                                    {preset.label}
                                    <span className="text-[0.625rem] opacity-70">
                                        {preset.width}×{preset.height}
                                    </span>
                                </Button>
                            );
                        })}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Width">
                            <Input
                                type="number"
                                min={64}
                                max={4096}
                                step={64}
                                value={settings.width}
                                onChange={(event) => setImage({ width: Number(event.target.value) })}
                            />
                        </Field>
                        <Field label="Height">
                            <Input
                                type="number"
                                min={64}
                                max={4096}
                                step={64}
                                value={settings.height}
                                onChange={(event) => setImage({ height: Number(event.target.value) })}
                            />
                        </Field>
                    </div>
                </div>

                <div className={cn('space-y-4', !uses('steps') && !uses('scale') && 'opacity-50')}>
                    <Slider
                        label="Steps"
                        value={settings.steps}
                        min={1}
                        max={80}
                        step={1}
                        onValueChange={(steps) => setImage({ steps })}
                        disabled={!uses('steps')}
                    />
                    <Slider
                        label="Guidance (CFG)"
                        value={settings.cfgScale}
                        min={1}
                        max={20}
                        step={0.5}
                        onValueChange={(cfgScale) => setImage({ cfgScale })}
                        disabled={!uses('scale')}
                    />
                </div>

                <Field
                    label="Seed"
                    hint="−1 rolls a new one each render. The seed used is recorded on the image."
                >
                    <div className="flex gap-2">
                        <Input
                            type="number"
                            value={settings.seed}
                            onChange={(event) => setImage({ seed: Number(event.target.value) })}
                            aria-label="Seed"
                        />
                        <Button variant="ghost" onClick={() => setImage({ seed: -1 })}>
                            <Dices className="size-4" />
                            Random
                        </Button>
                    </div>
                </Field>

                {settings.provider === 'novelai' ? (
                    <section className="space-y-1 rounded-lg border border-border bg-surface-2/50 p-3">
                        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                            NovelAI
                        </h3>
                        <Field label="Model">
                            <Input
                                value={settings.model}
                                onChange={(event) => setImage({ model: event.target.value })}
                                placeholder="nai-diffusion-4-5-full"
                                aria-label="NovelAI model"
                            />
                        </Field>
                        <ToggleRow
                            label="SMEA"
                            description="Improves coherence above the model's native resolution."
                            checked={settings.novelai.sm}
                            onCheckedChange={(sm) => setImage({ novelai: { ...settings.novelai, sm } })}
                        />
                        <ToggleRow
                            label="SMEA DYN"
                            description="A stronger variant. Needs SMEA."
                            checked={settings.novelai.smDyn}
                            onCheckedChange={(smDyn) => setImage({ novelai: { ...settings.novelai, smDyn } })}
                            disabled={!settings.novelai.sm}
                        />
                        <ToggleRow
                            label="Variety+"
                            description="Holds guidance back early on, which widens the range of compositions."
                            checked={settings.novelai.varietyBoost}
                            onCheckedChange={(varietyBoost) => setImage({ novelai: { ...settings.novelai, varietyBoost } })}
                        />
                        <ToggleRow
                            label="Decrisper"
                            description="Dampens the over-sharpened look at high guidance."
                            checked={settings.novelai.decrisper}
                            onCheckedChange={(decrisper) => setImage({ novelai: { ...settings.novelai, decrisper } })}
                        />
                        <Slider
                            label="Upscale"
                            value={settings.novelai.upscaleRatio}
                            min={0}
                            max={4}
                            step={1}
                            format={(value) => (value === 0 ? 'off' : `${value}×`)}
                            onValueChange={(upscaleRatio) => setImage({ novelai: { ...settings.novelai, upscaleRatio } })}
                        />
                    </section>
                ) : (
                    <section className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">ComfyUI</h3>
                        <Field label="Server URL">
                            <div className="flex gap-2">
                                <Input
                                    value={settings.comfyui.url}
                                    onChange={(event) =>
                                        setImage({ comfyui: { ...settings.comfyui, url: event.target.value } })
                                    }
                                    placeholder="http://127.0.0.1:8188"
                                    aria-label="ComfyUI server URL"
                                />
                                <Button variant="ghost" disabled={pinging} onClick={() => void testComfy()}>
                                    <Link2 className="size-4" />
                                    {pinging ? 'Testing…' : 'Test'}
                                </Button>
                            </div>
                        </Field>
                        <Field label="Workflow">
                            <Select
                                value={settings.comfyui.workflow}
                                onValueChange={(workflow) => setImage({ comfyui: { ...settings.comfyui, workflow } })}
                                options={(workflows.data ?? []).map((name) => ({
                                    value: name,
                                    label: name.replace(/\.json$/i, '').replace(/_/g, ' '),
                                }))}
                                aria-label="ComfyUI workflow"
                            />
                        </Field>
                        {placeholders.data ? (
                            <p className="flex flex-wrap items-center gap-1 text-[0.6875rem] text-subtle">
                                <span>This workflow uses:</span>
                                {placeholders.data.map((name) => (
                                    <Badge key={name} className="text-[0.5625rem]">
                                        {name}
                                    </Badge>
                                ))}
                            </p>
                        ) : null}
                        <Field label="Checkpoint" hint={uses('model') ? undefined : 'This workflow picks its own.'}>
                            <Input
                                value={settings.model}
                                onChange={(event) => setImage({ model: event.target.value })}
                                placeholder="sd_xl_base_1.0.safetensors"
                                disabled={!uses('model')}
                                aria-label="Checkpoint"
                            />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Sampler" hint={uses('sampler') ? undefined : 'Not used.'}>
                                <Input
                                    value={settings.sampler}
                                    onChange={(event) => setImage({ sampler: event.target.value })}
                                    placeholder="euler"
                                    disabled={!uses('sampler')}
                                    aria-label="Sampler"
                                />
                            </Field>
                            <Field label="Scheduler" hint={uses('scheduler') ? undefined : 'Not used.'}>
                                <Input
                                    value={settings.scheduler}
                                    onChange={(event) => setImage({ scheduler: event.target.value })}
                                    placeholder="normal"
                                    disabled={!uses('scheduler')}
                                    aria-label="Scheduler"
                                />
                            </Field>
                        </div>
                    </section>
                )}

                <div className="space-y-2">
                    <SegmentedControl
                        label="Where the image goes"
                        value={settings.layout}
                        options={LAYOUT_OPTIONS.map(({ value, label }) => ({ value, label }))}
                        onValueChange={(layout) => setImage({ layout })}
                    />
                    <p className="text-[0.6875rem] text-subtle">
                        {LAYOUT_OPTIONS.find((option) => option.value === settings.layout)?.hint}
                    </p>
                </div>
            </div>
        </Modal>
    );
}
