import { Check, Save, Star, Trash2, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { personaAvatarUrl } from '@/api/characters';
import {
    deletePersonaAvatar,
    savePersonaPatch,
    uploadPersonaAvatar,
    type PersonaPatch,
} from '@/api/personas';
import { queryKeys, usePersonas } from '@/api/queries';
import type { Persona } from '@/api/settings';
import { Avatar } from '@/components/ui/Avatar';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/overlays';
import { Badge, Button, Field, IconButton, Input, SectionLabel, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { useSessionStore } from '@/store/session';

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Persona list and editor.
 *
 * Two layers, kept visibly separate because they persist to different places:
 * the *active* persona is this app's own state and drives `{{user}}` right
 * away, while saving writes into the settings file the classic interface owns.
 */
export function PersonaManager() {
    const personaAvatar = useSessionStore((state) => state.personaAvatar);
    const userName = useSessionStore((state) => state.userName);
    const personaDescription = useSessionStore((state) => state.personaDescription);
    const setPersona = useSessionStore((state) => state.setPersona);

    const { data, isPending } = usePersonas();
    const queryClient = useQueryClient();
    const fileInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);

    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.personas });

    const patchPersona = useMutation<void, Error, PersonaPatch>({
        mutationFn: (patch) => savePersonaPatch(patch),
        onSuccess: () => void refresh(),
        onError: (error) => toast.error('Could not save the persona', describe(error)),
    });

    const removePersona = useMutation<void, Error, Persona>({
        mutationFn: async (persona) => {
            await savePersonaPatch({ avatar: persona.avatar, remove: true });
            await deletePersonaAvatar(persona.avatar);
        },
        onSuccess: (_result, persona) => {
            if (persona.avatar === personaAvatar) {
                setPersona({ avatar: null, name: userName, description: '' });
            }
            void refresh();
            toast.success('Persona deleted');
        },
        onError: (error) => toast.error('Could not delete the persona', describe(error)),
    });

    const createPersona = async (file: File | undefined) => {
        if (!file) {
            return;
        }
        if (!file.type.startsWith('image/')) {
            toast.error('That is not an image', file.name);
            return;
        }
        setBusy(true);
        try {
            const avatar = await uploadPersonaAvatar(file);
            const name = file.name.replace(/\.[^.]+$/, '') || 'New persona';
            await savePersonaPatch({ avatar, name, description: '' });
            await refresh();
            setPersona({ avatar, name, description: '' });
            toast.success('Persona created', name);
        } catch (error) {
            toast.error('Could not create the persona', describe(error));
        } finally {
            setBusy(false);
        }
    };

    const activePersona = data?.personas.find((persona) => persona.avatar === personaAvatar) ?? null;
    const isDirty =
        activePersona !== null &&
        (activePersona.name !== userName || activePersona.description !== personaDescription);

    return (
        <div className="space-y-5">
            <div className="flex items-start gap-3">
                <Avatar
                    src={personaAvatarUrl(personaAvatar ?? undefined)}
                    name={userName || 'You'}
                    size="lg"
                    rounded="card"
                />
                <div className="min-w-0 flex-1 space-y-4">
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
                </div>
            </div>

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

            {activePersona ? (
                <div className="flex items-center gap-2">
                    <Button
                        size="sm"
                        variant={isDirty ? 'primary' : 'secondary'}
                        disabled={!isDirty || patchPersona.isPending}
                        onClick={() =>
                            patchPersona.mutate(
                                {
                                    avatar: activePersona.avatar,
                                    name: userName,
                                    description: personaDescription,
                                },
                                { onSuccess: () => toast.success('Persona saved') },
                            )
                        }
                    >
                        <Save className="size-3.5" />
                        {patchPersona.isPending ? 'Saving…' : 'Save to persona'}
                    </Button>
                    {isDirty ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                                setPersona({
                                    avatar: activePersona.avatar,
                                    name: activePersona.name,
                                    description: activePersona.description,
                                })
                            }
                        >
                            Revert
                        </Button>
                    ) : (
                        <span className="text-xs text-subtle">In sync with the saved persona.</span>
                    )}
                </div>
            ) : (
                <p className="text-xs leading-relaxed text-subtle">
                    Not linked to a saved persona, so these values stay in this browser. Pick one below,
                    or create one to share it with the classic interface.
                </p>
            )}

            <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                    <SectionLabel className="px-0">Saved personas</SectionLabel>
                    <input
                        ref={fileInput}
                        type="file"
                        accept="image/*"
                        hidden
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            void createPersona(file);
                        }}
                    />
                    <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() => fileInput.current?.click()}
                    >
                        <UserPlus className="size-3.5" />
                        {busy ? 'Creating…' : 'New'}
                    </Button>
                </div>

                {isPending ? (
                    <p className="text-xs text-subtle">Loading…</p>
                ) : (data?.personas.length ?? 0) === 0 ? (
                    <p className="text-xs leading-relaxed text-subtle">
                        None yet. Creating one uploads an avatar image and stores the name and
                        description where both interfaces can see them.
                    </p>
                ) : (
                    <div className="space-y-1">
                        {data?.personas.map((persona) => {
                            const active = persona.avatar === personaAvatar;
                            return (
                                <div
                                    key={persona.avatar}
                                    className={cn(
                                        'flex items-center gap-2 rounded-lg border p-2 transition-colors',
                                        active ? 'border-accent bg-accent-soft' : 'border-border',
                                    )}
                                >
                                    <button
                                        type="button"
                                        onClick={() =>
                                            setPersona({
                                                avatar: persona.avatar,
                                                name: persona.name,
                                                description: persona.description,
                                            })
                                        }
                                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                                    >
                                        <Avatar
                                            src={personaAvatarUrl(persona.avatar)}
                                            name={persona.name}
                                            size="sm"
                                            rounded="card"
                                        />
                                        <span className="min-w-0 flex-1">
                                            <span className="flex items-center gap-1.5">
                                                <span className="truncate text-[0.8125rem] font-medium">
                                                    {persona.name}
                                                </span>
                                                {persona.avatar === data?.defaultAvatar ? (
                                                    <Badge>default</Badge>
                                                ) : null}
                                                {active ? (
                                                    <Check className="size-3 shrink-0 text-accent" />
                                                ) : null}
                                            </span>
                                            {persona.description ? (
                                                <span className="block truncate text-[0.6875rem] text-subtle">
                                                    {persona.description}
                                                </span>
                                            ) : null}
                                        </span>
                                    </button>

                                    <Menu>
                                        <MenuTrigger asChild>
                                            <IconButton
                                                label={`Actions for ${persona.name}`}
                                                variant="ghost"
                                                size="icon-sm"
                                            >
                                                <Star className="size-3.5" />
                                            </IconButton>
                                        </MenuTrigger>
                                        <MenuContent>
                                            <MenuItem
                                                onSelect={() =>
                                                    patchPersona.mutate({
                                                        avatar: persona.avatar,
                                                        isDefault: persona.avatar !== data?.defaultAvatar,
                                                    })
                                                }
                                            >
                                                <Star />
                                                {persona.avatar === data?.defaultAvatar
                                                    ? 'Clear default'
                                                    : 'Set as default'}
                                            </MenuItem>
                                            <MenuSeparator />
                                            <MenuItem
                                                tone="danger"
                                                onSelect={() => removePersona.mutate(persona)}
                                            >
                                                <Trash2 />
                                                Delete persona
                                            </MenuItem>
                                        </MenuContent>
                                    </Menu>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
