import { Check, ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RESPONSES_API_SOURCES, SOURCES_WITH_MODEL_LIST, SUGGESTED_MODELS } from '@/api/generate';
import { queryKeys, useModels, useSecretState, useVersion } from '@/api/queries';
import { hasSecret, SECRET_KEY_BY_SOURCE, writeSecret } from '@/api/settings';
import {
    CHAT_COMPLETION_SOURCES,
    REASONING_EFFORTS,
    SOURCE_LABELS,
    type ChatCompletionSource,
    type ReasoningEffort,
} from '@/api/types';
import {
    SegmentedControl,
    Select,
    Slider,
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
    ToggleRow,
} from '@/components/ui/controls';
import { Drawer } from '@/components/ui/overlays';
import { Badge, Button, Field, Input, Textarea } from '@/components/ui/primitives';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { SamplerPanel } from '@/features/textcompletion/SamplerPanel';
import { TextBackendPanel } from '@/features/textcompletion/TextBackendPanel';
import { DEFAULT_SYSTEM_PROMPT, useSessionStore } from '@/store/session';
import { applyAppearance, useUiStore } from '@/store/ui';
import { PersonaManager } from './PersonaManager';
import { WorldInfoSettings } from './WorldInfoSettings';

const SOURCE_OPTIONS = Object.values(CHAT_COMPLETION_SOURCES).map((source) => ({
    value: source,
    label: SOURCE_LABELS[source],
}));

/**
 * Chat completions or text completions.
 *
 * The two are different enough — a message array against a single string,
 * different samplers, different stop-string handling — that folding them into
 * one provider list would mean a panel where half the controls silently do
 * nothing depending on what is selected.
 */
function ApiModeSwitch() {
    const mode = useSessionStore((state) => state.connection.mode);
    const setConnection = useSessionStore((state) => state.setConnection);

    return (
        <div className="space-y-2">
            <SegmentedControl
                label="API type"
                value={mode}
                onValueChange={(next) => setConnection({ mode: next })}
                options={[
                    { value: 'chat', label: 'Chat completions' },
                    { value: 'text', label: 'Text completions' },
                ]}
            />
            <p className="text-[0.6875rem] leading-relaxed text-subtle">
                {mode === 'chat'
                    ? 'Sends the chat as a list of messages. What hosted providers expect.'
                    : 'Flattens the chat into one prompt using an instruct template. What local servers and NovelAI expect.'}
            </p>
        </div>
    );
}

function ChatConnectionPanel() {
    const connection = useSessionStore((state) => state.connection);
    const setConnection = useSessionStore((state) => state.setConnection);
    const queryClient = useQueryClient();

    const { data: secrets, isPending: secretsPending } = useSecretState();
    const [apiKey, setApiKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [lastSource, setLastSource] = useState(connection.source);

    // Clear the field when switching providers so a key is never sent to the
    // wrong one by accident. Adjusting during render keeps the cleared value on
    // screen for the very first paint after the switch.
    if (connection.source !== lastSource) {
        setLastSource(connection.source);
        setApiKey('');
    }

    const keyConfigured = hasSecret(secrets, connection.source);
    // A custom endpoint may legitimately need no key; every other source does.
    const canListModels =
        SOURCES_WITH_MODEL_LIST.has(connection.source) &&
        (keyConfigured || (connection.source === 'custom' && connection.customUrl.length > 0));
    const modelsQuery = useModels(connection.source, connection.customUrl, canListModels);

    const modelOptions = useMemo(() => {
        const live = modelsQuery.data ?? [];
        const list = live.length > 0 ? live : (SUGGESTED_MODELS[connection.source] ?? []);
        const withCurrent =
            connection.model && !list.includes(connection.model) ? [connection.model, ...list] : list;
        return withCurrent.map((model) => ({ value: model, label: model }));
    }, [connection.model, connection.source, modelsQuery.data]);

    const saveKey = async () => {
        const value = apiKey.trim();
        if (!value) {
            return;
        }
        setSaving(true);
        try {
            await writeSecret(SECRET_KEY_BY_SOURCE[connection.source], value);
            setApiKey('');
            await queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
            await queryClient.invalidateQueries({
                queryKey: queryKeys.models(connection.source, connection.customUrl),
            });
            toast.success('API key saved', 'It is stored on the server, never in the browser.');
        } catch (error) {
            toast.error('Could not save the key', error instanceof Error ? error.message : undefined);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-5">
            <Field label="Provider">
                <Select
                    value={connection.source}
                    onValueChange={(value) =>
                        setConnection({ source: value as ChatCompletionSource, model: '' })
                    }
                    options={SOURCE_OPTIONS}
                />
            </Field>

            {connection.source === 'custom' ? (
                <Field
                    label="Base URL"
                    hint="Any OpenAI-compatible endpoint, e.g. http://127.0.0.1:5001/v1"
                >
                    <Input
                        value={connection.customUrl}
                        onChange={(event) => setConnection({ customUrl: event.target.value })}
                        placeholder="http://127.0.0.1:5001/v1"
                        spellCheck={false}
                    />
                </Field>
            ) : null}

            <Field
                label="API key"
                hint={
                    keyConfigured
                        ? 'A key is already stored for this provider. Enter a new one to replace it.'
                        : 'Stored server-side in secrets.json. It is never written to browser storage.'
                }
            >
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
                        <Input
                            type="password"
                            value={apiKey}
                            onChange={(event) => setApiKey(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void saveKey();
                                }
                            }}
                            placeholder={keyConfigured ? '••••••••••••' : 'Paste your key'}
                            autoComplete="off"
                            spellCheck={false}
                            className="pl-8"
                        />
                    </div>
                    <Button variant="primary" onClick={() => void saveKey()} disabled={!apiKey.trim() || saving}>
                        {saving ? 'Saving…' : 'Save'}
                    </Button>
                </div>
                {!secretsPending && keyConfigured ? (
                    <Badge tone="success" className="mt-2">
                        <Check className="size-3" />
                        Key configured
                    </Badge>
                ) : null}
            </Field>

            <Field
                label="Model"
                hint={
                    modelsQuery.data && modelsQuery.data.length > 0
                        ? `${modelsQuery.data.length} models available from the provider.`
                        : canListModels
                            ? 'The provider did not return a model list. Type a model id below.'
                            : 'This provider does not publish a model list — the suggestions are a starting point, and any model id can be typed below.'
                }
            >
                <Select
                    value={connection.model}
                    onValueChange={(model) => setConnection({ model })}
                    options={modelOptions}
                    placeholder="Select a model…"
                />
                <div className="mt-2 flex items-center gap-2">
                    <Input
                        value={connection.model}
                        onChange={(event) => setConnection({ model: event.target.value })}
                        placeholder="…or type a model id"
                        spellCheck={false}
                        className="h-8 text-xs"
                    />
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void modelsQuery.refetch()}
                        disabled={modelsQuery.isFetching || !canListModels}
                    >
                        <RefreshCw className={cn('size-3.5', modelsQuery.isFetching && 'animate-spin')} />
                        Refresh
                    </Button>
                </div>
            </Field>

            {RESPONSES_API_SOURCES.has(connection.source) ? (
                <div className="space-y-2 border-t border-border pt-4">
                    <ToggleRow
                        label="Use the Responses API"
                        description="Sends to /v1/responses instead of /v1/chat/completions. Required by some newer reasoning models; frequency and presence penalties are not supported there and are dropped."
                        checked={connection.useResponsesApi}
                        onCheckedChange={(useResponsesApi) => setConnection({ useResponsesApi })}
                    />
                    {connection.useResponsesApi ? (
                        <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs leading-relaxed text-muted">
                            Requests are sent with <code className="font-mono">store: false</code>, so the
                            provider is asked not to retain the conversation. Reasoning options live under
                            Sampling.
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

const REASONING_EFFORT_OPTIONS = REASONING_EFFORTS.map((effort) => ({
    value: effort,
    label: effort === 'default' ? 'Model default' : effort,
}));

function ConnectionTab() {
    const mode = useSessionStore((state) => state.connection.mode);

    return (
        <div className="space-y-5">
            <ApiModeSwitch />
            {mode === 'text' ? <TextBackendPanel /> : <ChatConnectionPanel />}
        </div>
    );
}

function GenerationTab() {
    const sampling = useSessionStore((state) => state.sampling);
    const setSampling = useSessionStore((state) => state.setSampling);
    const connection = useSessionStore((state) => state.connection);
    const onResponsesApi = connection.useResponsesApi && RESPONSES_API_SOURCES.has(connection.source);

    if (connection.mode === 'text') {
        return (
            <div className="space-y-5">
                <ToggleRow
                    label="Stream responses"
                    description="Show tokens as they arrive instead of waiting for the full reply. The Horde queues requests and cannot stream."
                    checked={sampling.stream}
                    onCheckedChange={(stream) => setSampling({ stream })}
                />
                <SamplerPanel />
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <ToggleRow
                label="Stream responses"
                description="Show tokens as they arrive instead of waiting for the full reply."
                checked={sampling.stream}
                onCheckedChange={(stream) => setSampling({ stream })}
            />

            <Slider
                label="Temperature"
                value={sampling.temperature}
                onValueChange={(temperature) => setSampling({ temperature })}
                min={0}
                max={2}
                step={0.05}
                format={(value) => value.toFixed(2)}
            />

            <Slider
                label="Response length"
                value={sampling.maxTokens}
                onValueChange={(maxTokens) => setSampling({ maxTokens })}
                min={64}
                max={8192}
                step={64}
                format={(value) => `${value} tok`}
            />

            <Slider
                label="Top P"
                value={sampling.topP}
                onValueChange={(topP) => setSampling({ topP })}
                min={0}
                max={1}
                step={0.01}
                format={(value) => value.toFixed(2)}
            />

            <div className={cn('space-y-5', onResponsesApi && 'opacity-50')}>
                <Slider
                    label="Frequency penalty"
                    value={sampling.frequencyPenalty}
                    onValueChange={(frequencyPenalty) => setSampling({ frequencyPenalty })}
                    min={-2}
                    max={2}
                    step={0.05}
                    format={(value) => value.toFixed(2)}
                />

                <Slider
                    label="Presence penalty"
                    value={sampling.presencePenalty}
                    onValueChange={(presencePenalty) => setSampling({ presencePenalty })}
                    min={-2}
                    max={2}
                    step={0.05}
                    format={(value) => value.toFixed(2)}
                />
            </div>
            {onResponsesApi ? (
                <p className="text-xs leading-relaxed text-subtle">
                    The Responses API has no equivalent for these two penalties, so they are not sent
                    while it is enabled.
                </p>
            ) : null}

            <div className="space-y-4 border-t border-border pt-4">
                <Field
                    label="Reasoning effort"
                    hint="How much thinking the model does before answering. Ignored by models without a reasoning budget; if a model rejects the value, the request is retried without it."
                >
                    <Select
                        value={sampling.reasoningEffort}
                        onValueChange={(value) => setSampling({ reasoningEffort: value as ReasoningEffort })}
                        options={REASONING_EFFORT_OPTIONS}
                    />
                </Field>

                <ToggleRow
                    label="Show reasoning"
                    description="Ask for a summary of the model's reasoning and render it above the reply."
                    checked={sampling.includeReasoning}
                    onCheckedChange={(includeReasoning) => setSampling({ includeReasoning })}
                />
            </div>
        </div>
    );
}

function PromptTab() {
    const prompt = useSessionStore((state) => state.prompt);
    const setPrompt = useSessionStore((state) => state.setPrompt);

    return (
        <div className="space-y-5">
            <Field
                label="System prompt"
                hint="Used unless the character card ships its own. Supports {{char}} and {{user}}."
            >
                <Textarea
                    value={prompt.systemPrompt}
                    onChange={(event) => setPrompt({ systemPrompt: event.target.value })}
                    rows={6}
                    spellCheck={false}
                />
                <Button
                    size="sm"
                    variant="ghost"
                    className="mt-1.5"
                    onClick={() => setPrompt({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}
                >
                    Reset to default
                </Button>
            </Field>

            <Field
                label="Final instruction"
                hint="Appended after the chat history, closest to the model's turn. Leave empty to skip."
            >
                <Textarea
                    value={prompt.jailbreak}
                    onChange={(event) => setPrompt({ jailbreak: event.target.value })}
                    rows={4}
                    spellCheck={false}
                />
            </Field>

            <ToggleRow
                label="Include example dialogue"
                description="Send the card's example messages to establish the character's voice."
                checked={prompt.includeExamples}
                onCheckedChange={(includeExamples) => setPrompt({ includeExamples })}
            />

            <Slider
                label="History depth"
                value={prompt.historyDepth}
                onValueChange={(historyDepth) => setPrompt({ historyDepth })}
                min={0}
                max={200}
                step={5}
                format={(value) => (value === 0 ? 'All messages' : `Last ${value}`)}
            />
        </div>
    );
}

function AppearanceTab() {
    const ui = useUiStore();

    return (
        <div className="space-y-5">
            <Field label="Theme">
                <SegmentedControl
                    label="Theme"
                    value={ui.theme}
                    onValueChange={ui.setTheme}
                    options={[
                        { value: 'light', label: 'Light' },
                        { value: 'dark', label: 'Dark' },
                        { value: 'system', label: 'System' },
                    ]}
                />
            </Field>

            <Field label="Density" hint="Controls the spacing between messages.">
                <SegmentedControl
                    label="Density"
                    value={ui.density}
                    onValueChange={ui.setDensity}
                    options={[
                        { value: 'compact', label: 'Compact' },
                        { value: 'comfortable', label: 'Comfortable' },
                        { value: 'spacious', label: 'Spacious' },
                    ]}
                />
            </Field>

            <Field label="Message typeface" hint="Serif is easier on the eyes for long prose.">
                <SegmentedControl
                    label="Message typeface"
                    value={ui.proseFont}
                    onValueChange={ui.setProseFont}
                    options={[
                        { value: 'sans', label: 'Sans' },
                        { value: 'serif', label: 'Serif' },
                    ]}
                />
            </Field>

            <Slider
                label="Message size"
                value={ui.proseSize}
                onValueChange={ui.setProseSize}
                min={0.875}
                max={1.375}
                step={0.0625}
                format={(value) => `${Math.round(value * 16)}px`}
            />

            <div className="space-y-2">
                <Slider
                    label="Accent colour"
                    value={ui.accentHue}
                    onValueChange={ui.setAccentHue}
                    min={0}
                    max={360}
                    step={1}
                    format={(value) => `${value}°`}
                />
                <div
                    aria-hidden
                    className="h-2 rounded-full"
                    style={{
                        backgroundImage:
                            'linear-gradient(90deg, oklch(0.7 0.16 0), oklch(0.7 0.16 60), oklch(0.7 0.16 120), oklch(0.7 0.16 180), oklch(0.7 0.16 240), oklch(0.7 0.16 300), oklch(0.7 0.16 360))',
                    }}
                />
            </div>

            <div className="space-y-1 border-t border-border pt-4">
                <ToggleRow
                    label="Show timestamps"
                    checked={ui.showTimestamps}
                    onCheckedChange={ui.setShowTimestamps}
                />
                <ToggleRow
                    label="Show token counts"
                    description="Estimated per message, from the message text."
                    checked={ui.showTokenCounts}
                    onCheckedChange={ui.setShowTokenCounts}
                />
                <ToggleRow
                    label="Enter sends the message"
                    description="Off: Enter inserts a newline and ⌘/Ctrl+Enter sends."
                    checked={ui.enterToSend}
                    onCheckedChange={ui.setEnterToSend}
                />
            </div>
        </div>
    );
}

function AboutFooter() {
    const { data } = useVersion();
    return (
        <div className="mt-6 space-y-1.5 border-t border-border pt-4 text-[0.6875rem] text-subtle">
            <p>
                SillyTavern {data?.pkgVersion ?? '—'}
                {data?.gitBranch ? ` · ${data.gitBranch}` : ''}
            </p>
            <a
                href="/"
                className="inline-flex items-center gap-1 text-accent transition-opacity hover:opacity-80"
            >
                Open the classic interface
                <ExternalLink className="size-3" />
            </a>
        </div>
    );
}

export function SettingsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
    const theme = useUiStore((state) => state.theme);
    const density = useUiStore((state) => state.density);
    const proseFont = useUiStore((state) => state.proseFont);
    const accentHue = useUiStore((state) => state.accentHue);
    const proseSize = useUiStore((state) => state.proseSize);

    // Appearance is stored state; the DOM is the projection of it.
    useEffect(() => {
        applyAppearance({ theme, density, proseFont, accentHue, proseSize });
    }, [theme, density, proseFont, accentHue, proseSize]);

    return (
        <Drawer open={open} onOpenChange={onOpenChange} title="Settings">
            <Tabs defaultValue="connection">
                <TabsList>
                    <TabsTrigger value="connection">API</TabsTrigger>
                    <TabsTrigger value="generation">Sampling</TabsTrigger>
                    <TabsTrigger value="prompt">Prompt</TabsTrigger>
                    <TabsTrigger value="lore">Lore</TabsTrigger>
                    <TabsTrigger value="persona">You</TabsTrigger>
                    <TabsTrigger value="appearance">Look</TabsTrigger>
                </TabsList>
                <TabsContent value="connection">
                    <ConnectionTab />
                </TabsContent>
                <TabsContent value="generation">
                    <GenerationTab />
                </TabsContent>
                <TabsContent value="prompt">
                    <PromptTab />
                </TabsContent>
                <TabsContent value="lore">
                    <WorldInfoSettings />
                </TabsContent>
                <TabsContent value="persona">
                    <PersonaManager />
                </TabsContent>
                <TabsContent value="appearance">
                    <AppearanceTab />
                </TabsContent>
            </Tabs>
            <AboutFooter />
        </Drawer>
    );
}
