import { ImageUp, Plus, Star, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { avatarUrl } from '@/api/characters';
import { characterToDraft, EMPTY_DRAFT, type CharacterDraft, type DepthPromptRole } from '@/api/character-edit';
import { useCharacters } from '@/api/queries';
import type { Character } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { ChipInput } from '@/components/ui/ChipInput';
import { Select, Slider, Tabs, TabsContent, TabsList, TabsTrigger, ToggleRow } from '@/components/ui/controls';
import { Modal } from '@/components/ui/overlays';
import { Badge, Button, Field, IconButton, Input, SectionLabel, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { estimateTokens } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useCharacterMutations } from './useCharacterMutations';

/** Largest avatar we will hand to the server, which re-encodes it anyway. */
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/** A textarea with a live token estimate, for the long card fields. */
function CardField({
    label,
    hint,
    value,
    onChange,
    rows = 5,
    placeholder,
}: {
    label: string;
    hint?: string;
    value: string;
    onChange(value: string): void;
    rows?: number;
    placeholder?: string;
}) {
    const tokens = estimateTokens(value);
    return (
        <Field
            label={label}
            hint={
                <span className="flex items-baseline justify-between gap-3">
                    <span>{hint}</span>
                    {tokens > 0 ? (
                        <span className="shrink-0 tabular-nums">~{tokens} tok</span>
                    ) : null}
                </span>
            }
        >
            <Textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                rows={rows}
                placeholder={placeholder}
                spellCheck
            />
        </Field>
    );
}

const DEPTH_ROLE_OPTIONS = [
    { value: 'system', label: 'System' },
    { value: 'user', label: 'User' },
    { value: 'assistant', label: 'Assistant' },
];

export interface CharacterEditorProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    /** The character being edited, or null to create a new one. */
    character: Character | null;
    /** Called with the new character's avatar file name after a create. */
    onCreated?(avatar: string): void;
}

/**
 * The card editor's body.
 *
 * Mounted only while open, so the draft can be seeded from the card in the
 * state initialiser rather than synced by an effect. Fields are grouped by what
 * they do rather than by where they sit in the V2 spec: what the character
 * *is*, how it opens a chat, and the prompt overrides most cards leave alone.
 */
function CharacterEditorDialog({ open, onOpenChange, character, onCreated }: CharacterEditorProps) {
    const { data: allCharacters } = useCharacters();
    const { save } = useCharacterMutations();
    // The draft starts from the card because this component only mounts while
    // the editor is open — see the wrapper below.
    const [draft, setDraft] = useState<CharacterDraft>(() =>
        character ? characterToDraft(character) : EMPTY_DRAFT,
    );
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);

    const avatarPreview = useMemo(
        () => (avatarFile ? URL.createObjectURL(avatarFile) : null),
        [avatarFile],
    );

    // Object URLs must be released or the blob stays in memory for the session.
    useEffect(() => {
        if (!avatarPreview) {
            return;
        }
        return () => URL.revokeObjectURL(avatarPreview);
    }, [avatarPreview]);

    const patch = useCallback(
        (changes: Partial<CharacterDraft>) => setDraft((current) => ({ ...current, ...changes })),
        [],
    );

    /** Tags already used elsewhere in the library, offered as shortcuts. */
    const tagSuggestions = useMemo(() => {
        const counts = new Map<string, number>();
        for (const item of allCharacters ?? []) {
            for (const tag of [...(item.tags ?? []), ...(item.data?.tags ?? [])]) {
                if (typeof tag === 'string' && tag.trim()) {
                    counts.set(tag, (counts.get(tag) ?? 0) + 1);
                }
            }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
    }, [allCharacters]);

    const pickAvatar = (file: File | undefined) => {
        if (!file) {
            return;
        }
        if (!file.type.startsWith('image/')) {
            toast.error('That is not an image', file.name);
            return;
        }
        if (file.size > MAX_AVATAR_BYTES) {
            toast.error('That image is too large', 'Pick something under 10 MB.');
            return;
        }
        setAvatarFile(file);
    };

    const submit = () => {
        save.mutate(
            {
                draft,
                ...(character ? { original: character } : {}),
                avatarFile,
            },
            {
                onSuccess: (avatar) => {
                    onOpenChange(false);
                    if (!character && avatar) {
                        onCreated?.(avatar);
                    }
                },
            },
        );
    };

    const greetings = draft.alternateGreetings;

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={character ? `Edit ${character.name}` : 'New character'}
            description={
                character
                    ? 'Changes are written straight to the card file, and the classic interface sees them too.'
                    : 'Creates a new character card in your library.'
            }
            size="lg"
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={submit} disabled={save.isPending || !draft.name.trim()}>
                        {save.isPending ? 'Saving…' : character ? 'Save changes' : 'Create character'}
                    </Button>
                </>
            }
        >
            <Tabs defaultValue="identity">
                <TabsList>
                    <TabsTrigger value="identity">Identity</TabsTrigger>
                    <TabsTrigger value="definition">Definition</TabsTrigger>
                    <TabsTrigger value="greetings">Greetings</TabsTrigger>
                    <TabsTrigger value="prompts">Prompts</TabsTrigger>
                </TabsList>

                <TabsContent value="identity">
                    <div className="space-y-5">
                        <div className="flex items-start gap-4">
                            <div className="space-y-2">
                                <Avatar
                                    src={avatarPreview ?? avatarUrl(character?.avatar)}
                                    name={draft.name || 'New'}
                                    size="xl"
                                    rounded="card"
                                />
                                <input
                                    ref={fileInput}
                                    type="file"
                                    accept="image/*"
                                    hidden
                                    onChange={(event) => pickAvatar(event.target.files?.[0])}
                                />
                                <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()}>
                                    <ImageUp className="size-3.5" />
                                    {avatarFile ? 'Change' : 'Avatar'}
                                </Button>
                                {avatarFile ? (
                                    <Button size="sm" variant="ghost" onClick={() => setAvatarFile(null)}>
                                        Reset
                                    </Button>
                                ) : null}
                            </div>

                            <div className="min-w-0 flex-1 space-y-4">
                                <Field label="Name" hint="Substituted for {{char}} throughout the prompt.">
                                    <Input
                                        value={draft.name}
                                        onChange={(event) => patch({ name: event.target.value })}
                                        placeholder="Seraphina"
                                        autoFocus
                                    />
                                </Field>

                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Creator">
                                        <Input
                                            value={draft.creator}
                                            onChange={(event) => patch({ creator: event.target.value })}
                                            placeholder="Your name"
                                        />
                                    </Field>
                                    <Field label="Version">
                                        <Input
                                            value={draft.characterVersion}
                                            onChange={(event) => patch({ characterVersion: event.target.value })}
                                            placeholder="1.0.0"
                                        />
                                    </Field>
                                </div>
                            </div>
                        </div>

                        <Field label="Tags" hint="Used by search and filtering. Not sent to the model.">
                            <ChipInput
                                values={draft.tags}
                                onChange={(tags) => patch({ tags })}
                                label="Add a tag"
                                placeholder="Add a tag and press Enter"
                                suggestions={tagSuggestions}
                            />
                        </Field>

                        <CardField
                            label="Creator notes"
                            hint="Notes for whoever uses the card. Not sent to the model."
                            value={draft.creatorNotes}
                            onChange={(creatorNotes) => patch({ creatorNotes })}
                            rows={3}
                        />

                        <ToggleRow
                            label="Favourite"
                            description="Pins the character to the top of the library."
                            checked={draft.favourite}
                            onCheckedChange={(favourite) => patch({ favourite })}
                        />
                    </div>
                </TabsContent>

                <TabsContent value="definition">
                    <div className="space-y-5">
                        <CardField
                            label="Description"
                            hint="Who the character is. The largest part of most cards."
                            value={draft.description}
                            onChange={(description) => patch({ description })}
                            rows={9}
                            placeholder="Appearance, history, relationships…"
                        />
                        <CardField
                            label="Personality"
                            hint="A short summary of temperament and manner."
                            value={draft.personality}
                            onChange={(personality) => patch({ personality })}
                            rows={4}
                        />
                        <CardField
                            label="Scenario"
                            hint="The situation the chat opens in."
                            value={draft.scenario}
                            onChange={(scenario) => patch({ scenario })}
                            rows={4}
                        />
                        <CardField
                            label="Example dialogue"
                            hint="Separate exchanges with <START>. Establishes the character's voice."
                            value={draft.messageExample}
                            onChange={(messageExample) => patch({ messageExample })}
                            rows={7}
                            placeholder={'<START>\n{{user}}: Hello.\n{{char}}: Well met.'}
                        />
                    </div>
                </TabsContent>

                <TabsContent value="greetings">
                    <div className="space-y-5">
                        <CardField
                            label="First message"
                            hint="How the character opens a new chat."
                            value={draft.firstMessage}
                            onChange={(firstMessage) => patch({ firstMessage })}
                            rows={8}
                        />

                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <SectionLabel className="px-0">
                                    Alternate greetings ({greetings.length})
                                </SectionLabel>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => patch({ alternateGreetings: [...greetings, ''] })}
                                >
                                    <Plus className="size-3.5" />
                                    Add
                                </Button>
                            </div>

                            {greetings.length === 0 ? (
                                <p className="text-xs leading-relaxed text-subtle">
                                    None yet. Alternates let you re-roll the opening of a chat without
                                    editing the card.
                                </p>
                            ) : (
                                greetings.map((greeting, index) => (
                                    <div key={index} className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[0.6875rem] font-medium text-subtle">
                                                Alternate {index + 1}
                                            </span>
                                            <IconButton
                                                label={`Remove alternate ${index + 1}`}
                                                variant="ghost"
                                                size="icon-sm"
                                                onClick={() =>
                                                    patch({
                                                        alternateGreetings: greetings.filter(
                                                            (_item, i) => i !== index,
                                                        ),
                                                    })
                                                }
                                            >
                                                <Trash2 className="size-3.5" />
                                            </IconButton>
                                        </div>
                                        <Textarea
                                            value={greeting}
                                            onChange={(event) =>
                                                patch({
                                                    alternateGreetings: greetings.map((item, i) =>
                                                        i === index ? event.target.value : item,
                                                    ),
                                                })
                                            }
                                            rows={4}
                                        />
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </TabsContent>

                <TabsContent value="prompts">
                    <div className="space-y-5">
                        <CardField
                            label="System prompt override"
                            hint="Replaces your default system prompt for this character. Leave empty to use yours."
                            value={draft.systemPrompt}
                            onChange={(systemPrompt) => patch({ systemPrompt })}
                            rows={5}
                        />
                        <CardField
                            label="Post-history instructions"
                            hint="Appended after the chat history, closest to the model's turn."
                            value={draft.postHistoryInstructions}
                            onChange={(postHistoryInstructions) => patch({ postHistoryInstructions })}
                            rows={4}
                        />

                        <div className="space-y-3 border-t border-border pt-4">
                            <SectionLabel className="px-0">Depth prompt</SectionLabel>
                            <p className="text-xs leading-relaxed text-subtle">
                                Injected a fixed number of messages from the end of the chat, which keeps a
                                reminder close to the model&apos;s turn.
                                <Badge className="ml-1.5">not yet used by this interface</Badge>
                            </p>
                            <Textarea
                                value={draft.depthPromptText}
                                onChange={(event) => patch({ depthPromptText: event.target.value })}
                                rows={3}
                                aria-label="Depth prompt"
                            />
                            <div className="grid grid-cols-2 gap-3">
                                <Slider
                                    label="Depth"
                                    value={draft.depthPromptDepth}
                                    onValueChange={(depthPromptDepth) => patch({ depthPromptDepth })}
                                    min={0}
                                    max={16}
                                    step={1}
                                />
                                <Field label="Role">
                                    <Select
                                        value={draft.depthPromptRole}
                                        onValueChange={(value) =>
                                            patch({ depthPromptRole: value as DepthPromptRole })
                                        }
                                        options={DEPTH_ROLE_OPTIONS}
                                    />
                                </Field>
                            </div>
                        </div>

                        <div className="space-y-4 border-t border-border pt-4">
                            <Slider
                                label="Talkativeness"
                                value={draft.talkativeness}
                                onValueChange={(talkativeness) => patch({ talkativeness })}
                                min={0}
                                max={1}
                                step={0.05}
                                format={(value) => value.toFixed(2)}
                            />
                            <Field
                                label="World info book"
                                hint="Name of a lorebook bound to this card. Managed in the classic interface for now."
                            >
                                <Input
                                    value={draft.world}
                                    onChange={(event) => patch({ world: event.target.value })}
                                    placeholder="None"
                                />
                            </Field>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>
        </Modal>
    );
}

/**
 * The character card editor.
 *
 * A thin gate so the dialog mounts fresh on every open: reopening it must show
 * the card as it is on disk, not the draft from last time.
 */
export function CharacterEditor(props: CharacterEditorProps) {
    if (!props.open) {
        return null;
    }
    return <CharacterEditorDialog {...props} />;
}

/** Shows the star that toggles a character's favourite state. */
export function FavouriteButton({ character }: { character: Character }) {
    const { toggleFavourite } = useCharacterMutations();
    const isFavourite = character.fav === true || character.fav === 'true';
    return (
        <IconButton
            label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
            variant="ghost"
            size="icon-sm"
            onClick={() => toggleFavourite.mutate(character)}
        >
            <Star className={cn('size-4', isFavourite ? 'fill-warning text-warning' : 'text-subtle')} />
        </IconButton>
    );
}
