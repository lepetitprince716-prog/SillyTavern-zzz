/**
 * Connection settings for a text-completion backend.
 *
 * The classic UI shows one panel and greys nothing out, so it presents a
 * `mirostat` slider against a backend that has no such parameter. Here the
 * backend picker drives what the rest of the panel offers, and the sampler
 * grid says plainly which controls the chosen backend ignores.
 */

import { Link2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchBackendStatus, NOVEL_MODELS } from '@/api/text-completion';
import { writeSecret } from '@/api/settings';
import { queryKeys, useSecretState } from '@/api/queries';
import { Select, ToggleRow } from '@/components/ui/controls';
import { Badge, Button, Field, Input } from '@/components/ui/primitives';
import { ChipInput } from '@/components/ui/ChipInput';
import { toast } from '@/lib/toast';
import { useSessionStore } from '@/store/session';
import { BACKENDS, TEXT_BACKENDS, type TextBackend } from './backends';
import { useTemplates } from './useTemplates';

const BACKEND_OPTIONS = TEXT_BACKENDS.map((id) => ({
    value: id,
    label: BACKENDS[id].label,
    description: BACKENDS[id].hint,
}));

export function TextBackendPanel() {
    const settings = useSessionStore((state) => state.text);
    const setText = useSessionStore((state) => state.setText);
    const queryClient = useQueryClient();
    const templates = useTemplates();

    const backend = BACKENDS[settings.backend];
    const [token, setToken] = useState('');
    const [savingToken, setSavingToken] = useState(false);

    const { data: secrets } = useSecretState();
    const tokenConfigured = backend.secretKey ? Boolean(secrets?.[backend.secretKey]) : true;

    // Only probed on demand: a status check on a URL the user is still typing
    // would fire a request per keystroke.
    const [probing, setProbing] = useState(false);
    const status = useQuery({
        queryKey: ['text-backend-status', settings.backend, settings.url],
        queryFn: () => fetchBackendStatus(settings.backend, settings.url),
        enabled: probing,
        retry: false,
        staleTime: 30_000,
    });

    const probe = async () => {
        setProbing(true);
        try {
            const result = await queryClient.fetchQuery({
                queryKey: ['text-backend-status', settings.backend, settings.url],
                queryFn: () => fetchBackendStatus(settings.backend, settings.url),
                retry: false,
            });
            if (result.result) {
                toast.success(`${backend.label} answered`, `Loaded model: ${result.result}`);
            } else if (result.models.length > 0) {
                toast.success(`${backend.label} answered`, `${result.models.length} models available.`);
            } else {
                // The status route says "reachable" without naming a model,
                // which is worth reporting honestly rather than as a model.
                toast.info(`${backend.label} answered`, 'It did not say which model is loaded.');
            }
        } catch (error) {
            toast.error(
                `${backend.label} did not answer`,
                error instanceof Error ? error.message : undefined,
            );
        } finally {
            setProbing(false);
        }
    };

    const saveToken = async () => {
        const value = token.trim();
        if (!value || !backend.secretKey) {
            return;
        }
        setSavingToken(true);
        try {
            await writeSecret(backend.secretKey, value);
            setToken('');
            await queryClient.invalidateQueries({ queryKey: queryKeys.secrets });
            toast.success('Token saved', 'It is stored on the server, never in the browser.');
        } catch (error) {
            toast.error('Could not save the token', error instanceof Error ? error.message : undefined);
        } finally {
            setSavingToken(false);
        }
    };

    const modelOptions = settings.backend === 'novel'
        ? NOVEL_MODELS.map((model) => ({ value: model.id, label: model.label }))
        : (status.data?.models ?? []).map((model) => ({ value: model, label: model }));

    return (
        <div className="space-y-5">
            <Field label="Backend" hint={backend.hint} htmlFor="text-backend">
                <Select
                    id="text-backend"
                    value={settings.backend}
                    onValueChange={(value) => setText({ backend: value as TextBackend, model: '' })}
                    options={BACKEND_OPTIONS}
                />
            </Field>

            {backend.needsUrl ? (
                <Field label="Server URL" htmlFor="text-backend-url">
                    <div className="flex gap-2">
                        <Input
                            id="text-backend-url"
                            value={settings.url}
                            onChange={(event) => setText({ url: event.target.value })}
                            placeholder="http://127.0.0.1:5000"
                            spellCheck={false}
                        />
                        <Button variant="ghost" disabled={probing} onClick={() => void probe()}>
                            <Link2 className="size-4" />
                            {probing ? 'Checking…' : 'Check'}
                        </Button>
                    </div>
                </Field>
            ) : null}

            {backend.secretKey ? (
                <Field
                    label="Access token"
                    htmlFor="text-backend-token"
                    hint={tokenConfigured
                        ? 'A token is stored on the server. Enter a new one to replace it.'
                        : `${backend.label} needs a token before it will generate.`}
                >
                    <div className="flex gap-2">
                        <Input
                            id="text-backend-token"
                            type="password"
                            value={token}
                            onChange={(event) => setToken(event.target.value)}
                            placeholder={tokenConfigured ? '••••••••' : 'Paste the token'}
                            autoComplete="off"
                            spellCheck={false}
                        />
                        <Button
                            variant="secondary"
                            disabled={savingToken || !token.trim()}
                            onClick={() => void saveToken()}
                        >
                            Save
                        </Button>
                    </div>
                </Field>
            ) : null}

            {modelOptions.length > 0 ? (
                <Field
                    label="Model"
                    htmlFor="text-backend-model"
                    hint={settings.backend === 'novel'
                        ? undefined
                        : 'Most local servers load one model and ignore this.'}
                >
                    <Select
                        id="text-backend-model"
                        value={settings.model}
                        onValueChange={(model) => setText({ model })}
                        options={modelOptions}
                        placeholder="Whatever the server has loaded"
                    />
                </Field>
            ) : backend.needsUrl ? (
                <Field label="Model" htmlFor="text-backend-model" hint="Check the server to list its models.">
                    <div className="flex gap-2">
                        <Input
                            id="text-backend-model"
                            value={settings.model}
                            onChange={(event) => setText({ model: event.target.value })}
                            placeholder="Whatever the server has loaded"
                            spellCheck={false}
                        />
                        <Button variant="ghost" disabled={probing} onClick={() => void probe()}>
                            <RefreshCw className="size-4" />
                        </Button>
                    </div>
                </Field>
            ) : null}

            {settings.backend === 'horde' ? (
                <Field
                    label="Preferred models"
                    hint="Leave empty to take whichever worker is free. Naming models narrows the queue."
                >
                    <ChipInput
                        values={settings.hordeModels}
                        onChange={(hordeModels) => setText({ hordeModels })}
                        label="Preferred Horde models"
                        placeholder="Add a model name…"
                    />
                </Field>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
                <Field label="Response length" htmlFor="text-max-tokens" hint="Tokens the backend may generate.">
                    <Input
                        id="text-max-tokens"
                        type="number"
                        min={16}
                        max={8192}
                        step={16}
                        value={settings.maxTokens}
                        onChange={(event) => setText({ maxTokens: Number(event.target.value) })}
                    />
                </Field>
                <Field label="Context size" htmlFor="text-max-context" hint="Tokens the model can hold, prompt included.">
                    <Input
                        id="text-max-context"
                        type="number"
                        min={512}
                        max={1_000_000}
                        step={512}
                        value={settings.maxContext}
                        onChange={(event) => setText({ maxContext: Number(event.target.value) })}
                    />
                </Field>
            </div>

            <section className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">
                    Prompt format
                </h3>
                {/* Named distinctly from the "Instruct template" picker below:
                    two controls whose accessible names differ only by a
                    leading verb are hard to tell apart by ear. */}
                <ToggleRow
                    label="Wrap turns in instruct markers"
                    description="Uses the model family's own turn markers. Turn it off for a base model, which continues plain dialogue better than markers it has never seen."
                    checked={settings.instructEnabled}
                    onCheckedChange={(instructEnabled) => setText({ instructEnabled })}
                />

                {settings.instructEnabled ? (
                    <Field
                        label="Instruct template"
                        htmlFor="text-instruct-template"
                        hint="Match this to the model. The wrong markers cost more quality than any sampler setting."
                    >
                        <Select
                            id="text-instruct-template"
                            value={settings.instructName}
                            onValueChange={(instructName) => setText({ instructName })}
                            options={templates.instruct.map((template) => ({
                                value: template.name,
                                label: template.name,
                            }))}
                        />
                    </Field>
                ) : null}

                <Field
                    label="Context template"
                    htmlFor="text-context-template"
                    hint="Decides how the card, persona and lore are laid out above the chat."
                >
                    <Select
                        id="text-context-template"
                        value={settings.contextName}
                        onValueChange={(contextName) => setText({ contextName })}
                        options={templates.context.map((template) => ({
                            value: template.name,
                            label: template.name,
                        }))}
                    />
                </Field>

                <p className="text-[0.6875rem] text-subtle">
                    Both lists come from the templates on the server — the same files the classic
                    interface edits, so a change there shows up here.
                </p>
            </section>

            <Field
                label="Extra stop strings"
                hint="Added to the ones the templates already contribute."
            >
                <ChipInput
                    values={settings.customStops}
                    onChange={(customStops) => setText({ customStops })}
                    label="Extra stop strings"
                    placeholder="Add a stop string…"
                />
            </Field>

            {status.data?.result ? (
                <p className="flex items-center gap-2 text-xs text-muted">
                    <Badge tone="success">Connected</Badge>
                    {status.data.result}
                </p>
            ) : null}
        </div>
    );
}
