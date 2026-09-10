import { Check, ExternalLink, KeyRound, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { personaAvatarUrl } from '@/api/characters';
import { SOURCES_WITH_MODEL_LIST, SUGGESTED_MODELS } from '@/api/generate';
import { queryKeys, useModels, usePersonas, useSecretState, useVersion } from '@/api/queries';
import { hasSecret, SECRET_KEY_BY_SOURCE, writeSecret } from '@/api/settings';
import { CHAT_COMPLETION_SOURCES, SOURCE_LABELS, type ChatCompletionSource } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
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
import { Badge, Button, Field, Input, SectionLabel, Textarea } from '@/components/ui/primitives';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { DEFAULT_SYSTEM_PROMPT, useSessionStore } from '@/store/session';
import { applyAppearance, useUiStore } from '@/store/ui';

const SOURCE_OPTIONS = Object.values(CHAT_COMPLETION_SOURCES).map((source) => ({
    value: source,
    label: SOURCE_LABELS[source],
}));

function ConnectionTab() {
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
        </div>
    );
}

function GenerationTab() {
    const sampling = useSessionStore((state) => state.sampling);
    const setSampling = useSessionStore((state) => state.setSampling);

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

function PersonaTab() {
    const personaAvatar = useSessionStore((state) => state.personaAvatar);
    const userName = useSessionStore((state) => state.userName);
    const personaDescription = useSessionStore((state) => state.personaDescription);
    const setPersona = useSessionStore((state) => state.setPersona);
    const { data, isPending } = usePersonas();

    return (
        <div className="space-y-5">
            <Field label="Display name" hint="Substituted for {{user}} in prompts and greetings.">
                <Input
                    value={userName}
                    onChange={(event) =>
                        setPersona({
                            avatar: personaAvatar,
                            name: event.target.value,
                            description: personaDescription,
                        })
                    }
                />
            </Field>

            <Field label="Persona description" hint="Injected into the system block as who you are.">
                <Textarea
                    value={personaDescription}
                    onChange={(event) =>
                        setPersona({
                            avatar: personaAvatar,
                            name: userName,
                            description: event.target.value,
                        })
                    }
                    rows={4}
                />
            </Field>

            <div className="space-y-2">
                <SectionLabel className="px-0">Saved personas</SectionLabel>
                {isPending ? (
                    <p className="text-xs text-subtle">Loading…</p>
                ) : (data?.personas.length ?? 0) === 0 ? (
                    <p className="text-xs text-subtle">
                        No personas found. Create one in the classic interface and it will show up here.
                    </p>
                ) : (
                    <div className="space-y-1">
                        {data?.personas.map((persona) => (
                            <button
                                key={persona.avatar}
                                type="button"
                                onClick={() =>
                                    setPersona({
                                        avatar: persona.avatar,
                                        name: persona.name,
                                        description: persona.description,
                                    })
                                }
                                className={cn(
                                    'flex w-full items-center gap-2.5 rounded-lg border p-2 text-left transition-colors',
                                    persona.avatar === personaAvatar
                                        ? 'border-accent bg-accent-soft'
                                        : 'border-border hover:bg-surface-2',
                                )}
                            >
                                <Avatar
                                    src={personaAvatarUrl(persona.avatar)}
                                    name={persona.name}
                                    size="sm"
                                    rounded="card"
                                />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[0.8125rem] font-medium">
                                        {persona.name}
                                    </span>
                                    {persona.description ? (
                                        <span className="block truncate text-[0.6875rem] text-subtle">
                                            {persona.description}
                                        </span>
                                    ) : null}
                                </span>
                                {persona.avatar === data?.defaultAvatar ? <Badge>default</Badge> : null}
                            </button>
                        ))}
                    </div>
                )}
            </div>
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
                <TabsContent value="persona">
                    <PersonaTab />
                </TabsContent>
                <TabsContent value="appearance">
                    <AppearanceTab />
                </TabsContent>
            </Tabs>
            <AboutFooter />
        </Drawer>
    );
}
