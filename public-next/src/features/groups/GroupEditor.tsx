/**
 * The group settings panel.
 *
 * The classic UI presents `activation_strategy` and `generation_mode` as radio
 * buttons labelled with their internal names — "Natural order", "Swap
 * character cards" — which say what the code does rather than what happens.
 * These are the same four and three choices, described by their consequence.
 */

import { Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { avatarUrl } from '@/api/characters';
import type { Group } from '@/api/groups';
import { withGenerationMode, withStrategy, groupGenerationMode, groupStrategy } from '@/api/groups';
import type { Character } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import { Select, Slider, ToggleRow } from '@/components/ui/controls';
import { Modal } from '@/components/ui/overlays';
import { Button, Field, IconButton, Input, SectionLabel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { fuzzyFilter } from '@/lib/search';
import type { ActivationStrategy, GenerationMode } from './engine';

/** What each strategy does, in terms of what the reader will see. */
const STRATEGIES: Array<{ value: ActivationStrategy; label: string; hint: string }> = [
    {
        value: 'natural',
        label: 'Whoever the moment calls for',
        hint: 'Anyone you name replies first. The rest each roll against their talkativeness, so a chatty character speaks more often.',
    },
    {
        value: 'list',
        label: 'Everyone, in order',
        hint: 'Every enabled member replies to each of your messages, top to bottom.',
    },
    {
        value: 'pooled',
        label: 'Take turns',
        hint: 'One reply at a time, from whoever has not spoken since your last message. Nobody gets left out.',
    },
    {
        value: 'manual',
        label: 'Only who you pick',
        hint: 'Nobody replies until you choose a member. Useful for staging a scene beat by beat.',
    },
];

const MODES: Array<{ value: GenerationMode; label: string; hint: string }> = [
    {
        value: 'swap',
        label: 'One card at a time',
        hint: 'Each reply is generated from that member\'s card alone. Cheapest, and each reply is squarely in character.',
    },
    {
        value: 'join',
        label: 'All cards together',
        hint: 'Every enabled member\'s card goes into the prompt, so a member can react to what another\'s card says. Costs more context.',
    },
    {
        value: 'joinAll',
        label: 'All cards, silenced members included',
        hint: 'As above, but a member you switched off stays present in the fiction while not speaking.',
    },
];

function MemberRow({
    character,
    disabled,
    onToggle,
    onRemove,
    onMove,
    canMoveUp,
    canMoveDown,
}: {
    character: Character;
    disabled: boolean;
    onToggle(): void;
    onRemove(): void;
    onMove(delta: -1 | 1): void;
    canMoveUp: boolean;
    canMoveDown: boolean;
}) {
    return (
        <li
            className={cn(
                'flex items-center gap-2 rounded-lg border border-border bg-surface px-2 py-1.5',
                disabled && 'opacity-55',
            )}
        >
            {/* Arrows rather than drag: order matters for "everyone, in order",
                and a keyboard user needs to be able to change it. */}
            <div className="flex flex-col">
                <button
                    type="button"
                    aria-label={`Move ${character.name} up`}
                    disabled={!canMoveUp}
                    onClick={() => onMove(-1)}
                    className="px-0.5 text-[0.5rem] leading-none text-subtle hover:text-text disabled:opacity-30"
                >
                    ▲
                </button>
                <button
                    type="button"
                    aria-label={`Move ${character.name} down`}
                    disabled={!canMoveDown}
                    onClick={() => onMove(1)}
                    className="px-0.5 text-[0.5rem] leading-none text-subtle hover:text-text disabled:opacity-30"
                >
                    ▼
                </button>
            </div>
            <Avatar src={avatarUrl(character.avatar)} name={character.name} size="sm" rounded="card" />
            <span className="min-w-0 flex-1 truncate text-[0.8125rem]">{character.name}</span>
            <IconButton
                label={disabled ? `Let ${character.name} speak` : `Silence ${character.name}`}
                size="icon-sm"
                variant="ghost"
                onClick={onToggle}
            >
                {disabled ? <UserPlus className="size-3.5" /> : <UserMinus className="size-3.5" />}
            </IconButton>
            <IconButton
                label={`Remove ${character.name} from the group`}
                size="icon-sm"
                variant="ghost"
                onClick={onRemove}
            >
                <Trash2 className="size-3.5" />
            </IconButton>
        </li>
    );
}

export interface GroupEditorProps {
    open: boolean;
    onOpenChange(open: boolean): void;
    group: Group;
    characters: Character[];
    onSave(group: Group): void;
    onDelete(): void;
}

export function GroupEditor({
    open,
    onOpenChange,
    group,
    characters,
    onSave,
    onDelete,
}: GroupEditorProps) {
    const [draft, setDraft] = useState(group);
    const [candidateQuery, setCandidateQuery] = useState('');

    // Re-seed when a different group is opened.
    const [seededId, setSeededId] = useState(group.id);
    if (open && seededId !== group.id) {
        setSeededId(group.id);
        setDraft(group);
        setCandidateQuery('');
    }

    const byAvatar = useMemo(
        () => new Map(characters.map((character) => [character.avatar, character])),
        [characters],
    );

    const members = draft.members
        .map((avatar) => byAvatar.get(avatar))
        .filter((character): character is Character => Boolean(character));

    const candidates = useMemo(() => {
        const inGroup = new Set(draft.members);
        const available = characters.filter((character) => !inGroup.has(character.avatar));
        // Ranked by the same fuzzy match the library uses, over name and tags.
        return fuzzyFilter(available, candidateQuery, (character) => [
            character.name,
            ...(character.tags ?? []),
        ]).slice(0, 20);
    }, [candidateQuery, characters, draft.members]);

    const disabled = new Set(draft.disabled_members ?? []);

    const patch = (next: Partial<Group>) => setDraft((current) => ({ ...current, ...next }));

    const move = (index: number, delta: -1 | 1) => {
        const next = [...draft.members];
        const target = index + delta;
        if (target < 0 || target >= next.length) {
            return;
        }
        [next[index], next[target]] = [next[target]!, next[index]!];
        patch({ members: next });
    };

    const strategy = groupStrategy(draft);
    const mode = groupGenerationMode(draft);

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title="Group settings"
            description={`${members.length} member${members.length === 1 ? '' : 's'}`}
            size="lg"
            footer={
                <div className="flex flex-wrap items-center gap-2">
                    <Button
                        variant="primary"
                        onClick={() => {
                            onSave(draft);
                            onOpenChange(false);
                        }}
                    >
                        Save
                    </Button>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="ghost"
                        className="ml-auto text-danger hover:bg-danger-soft"
                        onClick={() => {
                            onDelete();
                            onOpenChange(false);
                        }}
                    >
                        <Trash2 className="size-4" />
                        Delete group
                    </Button>
                </div>
            }
        >
            <div className="space-y-5">
                <Field label="Name" htmlFor="group-name">
                    <Input
                        id="group-name"
                        value={draft.name}
                        onChange={(event) => patch({ name: event.target.value })}
                    />
                </Field>

                <section className="space-y-2">
                    <SectionLabel className="px-0">Members</SectionLabel>
                    {members.length === 0 ? (
                        <p className="text-xs text-subtle">
                            Add at least two characters — a group of one is just a chat.
                        </p>
                    ) : (
                        <ul className="space-y-1.5">
                            {members.map((character, index) => (
                                <MemberRow
                                    key={character.avatar}
                                    character={character}
                                    disabled={disabled.has(character.avatar)}
                                    canMoveUp={index > 0}
                                    canMoveDown={index < members.length - 1}
                                    onMove={(delta) => move(index, delta)}
                                    onToggle={() => {
                                        const next = new Set(disabled);
                                        if (next.has(character.avatar)) {
                                            next.delete(character.avatar);
                                        } else {
                                            next.add(character.avatar);
                                        }
                                        patch({ disabled_members: [...next] });
                                    }}
                                    onRemove={() =>
                                        patch({
                                            members: draft.members.filter(
                                                (avatar) => avatar !== character.avatar,
                                            ),
                                        })}
                                />
                            ))}
                        </ul>
                    )}
                </section>

                <Field label="Add a member" htmlFor="group-candidates">
                    <Input
                        id="group-candidates"
                        value={candidateQuery}
                        onChange={(event) => setCandidateQuery(event.target.value)}
                        placeholder="Search the character library…"
                    />
                    {candidates.length > 0 ? (
                        <ul className="mt-1.5 max-h-48 space-y-1 overflow-y-auto">
                            {candidates.map((character) => (
                                <li key={character.avatar}>
                                    <button
                                        type="button"
                                        onClick={() =>
                                            patch({ members: [...draft.members, character.avatar] })}
                                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                                    >
                                        <Avatar
                                            src={avatarUrl(character.avatar)}
                                            name={character.name}
                                            size="sm"
                                            rounded="card"
                                        />
                                        <span className="min-w-0 flex-1 truncate text-[0.8125rem]">
                                            {character.name}
                                        </span>
                                        <UserPlus className="size-3.5 shrink-0 text-subtle" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : null}
                </Field>

                <Field
                    label="Who replies"
                    htmlFor="group-strategy"
                    hint={STRATEGIES.find((entry) => entry.value === strategy)?.hint}
                >
                    <Select
                        id="group-strategy"
                        value={strategy}
                        onValueChange={(value) =>
                            setDraft((current) => withStrategy(current, value as ActivationStrategy))}
                        options={STRATEGIES.map(({ value, label }) => ({ value, label }))}
                    />
                </Field>

                <Field
                    label="What the model is told"
                    htmlFor="group-mode"
                    hint={MODES.find((entry) => entry.value === mode)?.hint}
                >
                    <Select
                        id="group-mode"
                        value={mode}
                        onValueChange={(value) =>
                            setDraft((current) => withGenerationMode(current, value as GenerationMode))}
                        options={MODES.map(({ value, label }) => ({ value, label }))}
                    />
                </Field>

                <ToggleRow
                    label="Let a member reply to themselves"
                    description="Off means whoever spoke last sits out the next reply, so two members alternate instead of one monologuing."
                    checked={Boolean(draft.allow_self_responses)}
                    onCheckedChange={(allow_self_responses) => patch({ allow_self_responses })}
                />

                <Slider
                    label="Pause between replies when the group talks among itself"
                    value={draft.auto_mode_delay ?? 5}
                    min={1}
                    max={60}
                    step={1}
                    format={(value) => `${value}s`}
                    onValueChange={(auto_mode_delay) => patch({ auto_mode_delay })}
                />

                {mode !== 'swap' ? (
                    <section className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-3">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">
                            How each member’s card is introduced
                        </h3>
                        <p className="text-[0.6875rem] leading-relaxed text-subtle">
                            Wraps each member’s block when the cards are joined. Left empty, the
                            descriptions run together with nothing saying whose is whose, so this
                            defaults to naming them.
                            {' '}<code className="font-mono">{'{{char}}'}</code> is the member and{' '}
                            <code className="font-mono">&lt;FIELDNAME&gt;</code> the field.
                        </p>
                        <Field label="Before" htmlFor="group-join-prefix">
                            <Input
                                id="group-join-prefix"
                                value={draft.generation_mode_join_prefix ?? ''}
                                onChange={(event) =>
                                    patch({ generation_mode_join_prefix: event.target.value })}
                                placeholder="{{char}}'s <FIELDNAME>:"
                                spellCheck={false}
                            />
                        </Field>
                        <Field label="After" htmlFor="group-join-suffix">
                            <Input
                                id="group-join-suffix"
                                value={draft.generation_mode_join_suffix ?? ''}
                                onChange={(event) =>
                                    patch({ generation_mode_join_suffix: event.target.value })}
                                placeholder="(a blank line)"
                                spellCheck={false}
                            />
                        </Field>
                    </section>
                ) : null}
            </div>
        </Modal>
    );
}
