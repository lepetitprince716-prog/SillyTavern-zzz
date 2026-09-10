import { AlertTriangle, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { WI_LOGIC, WI_POSITION, type WorldInfoEntry } from '@/api/worldinfo';
import { ChipInput } from '@/components/ui/ChipInput';
import { Select, Slider, ToggleRow } from '@/components/ui/controls';
import { Badge, Button, Field, Input, SectionLabel, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { compactNumber, estimateTokens } from '@/lib/format';
import { UNSUPPORTED_FIELDS, findIgnoredFields, isPositionSupported } from './engine';
import { allowsSemantic, writeEntrySettings } from './entry-settings';

/**
 * Insertion positions in plain language.
 *
 * The stored values are integers whose meaning is impossible to guess, so the
 * editor never shows the number.
 */
const POSITION_OPTIONS = [
    { value: String(WI_POSITION.beforeCharacter), label: 'Before the character definition' },
    { value: String(WI_POSITION.afterCharacter), label: 'After the character definition' },
    { value: String(WI_POSITION.exampleMessagesTop), label: 'Above the example dialogue' },
    { value: String(WI_POSITION.exampleMessagesBottom), label: 'Below the example dialogue' },
    { value: String(WI_POSITION.atDepth), label: 'Inside the chat, a set depth from the end' },
    { value: String(WI_POSITION.authorNoteTop), label: "After the chat (author's note slot)" },
    { value: String(WI_POSITION.authorNoteBottom), label: "After the chat, lower (author's note slot)" },
];

/**
 * Secondary-key logic as sentences.
 *
 * The stored field is `selectiveLogic: 0 | 1 | 2 | 3`, which tells a reader
 * nothing. These four sentences are the whole feature.
 */
const LOGIC_OPTIONS = [
    { value: String(WI_LOGIC.andAny), label: 'at least one of these also appears' },
    { value: String(WI_LOGIC.andAll), label: 'all of these also appear' },
    { value: String(WI_LOGIC.notAny), label: 'none of these appear' },
    { value: String(WI_LOGIC.notAll), label: 'at least one of these is missing' },
];

type Activation = 'always' | 'keys';

export interface EntryEditorProps {
    entry: WorldInfoEntry;
    onPatch(patch: Partial<WorldInfoEntry>): void;
    onReplace(entry: WorldInfoEntry): void;
    onDelete(): void;
    /** Keys used elsewhere in the book, offered as shortcuts. */
    keySuggestions: string[];
    /** True when semantic matching is switched on globally. */
    semanticAvailable: boolean;
}

/**
 * The entry form.
 *
 * Organised by the question each field answers - when does this fire, what does
 * it say, where does it go - rather than by the shape of the stored record. The
 * fields that rarely matter are behind a disclosure, and the fields this engine
 * does not implement are shown read-only with an explanation instead of being
 * offered as if they worked.
 */
export function EntryEditor({
    entry,
    onPatch,
    onReplace,
    onDelete,
    keySuggestions,
    semanticAvailable,
}: EntryEditorProps) {
    const [showAdvanced, setShowAdvanced] = useState(false);
    const activation: Activation = entry.constant ? 'always' : 'keys';
    const position = entry.position ?? WI_POSITION.beforeCharacter;
    const secondary = entry.keysecondary ?? [];
    /**
     * A second condition only does anything with `selective` set *and* at least
     * one secondary key: books in the wild are full of entries with
     * `selective: true` and no keys, which has no effect. The switch reflects
     * whether the condition is really in play, and its own state keeps the
     * editor open long enough to add that first key.
     *
     * The parent keys this component per entry, so this initialises correctly
     * for each one.
     */
    const [showCondition, setShowCondition] = useState(
        Boolean(entry.selective) && secondary.length > 0,
    );
    const ignored = findIgnoredFields(entry);
    const tokens = estimateTokens(entry.content ?? '');

    return (
        <div className="space-y-6">
            <div className="flex items-start gap-2">
                <Field
                    label="Label"
                    hint="For you, not the model. Shown in the entry list and the activation trace."
                    className="min-w-0 flex-1"
                >
                    <Input
                        value={entry.comment ?? ''}
                        onChange={(event) => onPatch({ comment: event.target.value })}
                        placeholder="What this entry covers"
                    />
                </Field>
                <Button
                    variant="ghost"
                    className="mt-6 text-danger hover:bg-danger-soft"
                    onClick={onDelete}
                >
                    <Trash2 className="size-4" />
                </Button>
            </div>

            <ToggleRow
                label="Enabled"
                description="A disabled entry never activates, but stays in the book."
                checked={!entry.disable}
                onCheckedChange={(enabled) => onPatch({ disable: !enabled })}
            />

            <div className="space-y-3 border-t border-border pt-4">
                <SectionLabel className="px-0">When it fires</SectionLabel>

                <div className="grid gap-2 sm:grid-cols-2">
                    {(
                        [
                            {
                                value: 'always' as Activation,
                                title: 'Always on',
                                blurb: 'In every prompt. Spends budget first.',
                            },
                            {
                                value: 'keys' as Activation,
                                title: 'When a key appears',
                                blurb: 'Scanned against the recent messages.',
                            },
                        ]
                    ).map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={activation === option.value}
                            onClick={() => onPatch({ constant: option.value === 'always' })}
                            className={cn(
                                'rounded-lg border p-3 text-left transition-colors',
                                activation === option.value
                                    ? 'border-accent bg-accent-soft'
                                    : 'border-border hover:bg-surface-2',
                            )}
                        >
                            <span className="block text-[0.8125rem] font-medium">{option.title}</span>
                            <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-subtle">
                                {option.blurb}
                            </span>
                        </button>
                    ))}
                </div>

                {activation === 'keys' ? (
                    <>
                        <Field label="Keys" hint="Any one of these appearing in the scanned messages fires the entry.">
                            <ChipInput
                                values={entry.key ?? []}
                                onChange={(key) => onPatch({ key })}
                                label="Add a key"
                                placeholder="Add a key and press Enter"
                                suggestions={keySuggestions}
                            />
                        </Field>

                        <ToggleRow
                            label="Also require a second condition"
                            description="Narrows a broad key, for instance only firing at night."
                            checked={showCondition}
                            onCheckedChange={(on) => {
                                setShowCondition(on);
                                // The keys are kept either way, so switching the
                                // condition off does not destroy them.
                                onPatch({ selective: on });
                            }}
                        />

                        {showCondition ? (
                            <div className="space-y-2 rounded-lg border border-border p-3">
                                <Field label="Fire only if…">
                                    <Select
                                        value={String(entry.selectiveLogic ?? WI_LOGIC.andAny)}
                                        onValueChange={(value) =>
                                            onPatch({ selectiveLogic: Number(value) as WorldInfoEntry['selectiveLogic'] })
                                        }
                                        options={LOGIC_OPTIONS}
                                    />
                                </Field>
                                <ChipInput
                                    values={secondary}
                                    onChange={(keysecondary) => onPatch({ keysecondary })}
                                    label="Add a second-condition key"
                                    placeholder="Add a key and press Enter"
                                    tone={
                                        entry.selectiveLogic === WI_LOGIC.notAny ||
                                        entry.selectiveLogic === WI_LOGIC.notAll
                                            ? 'danger'
                                            : 'neutral'
                                    }
                                />
                            </div>
                        ) : null}

                        {semanticAvailable ? (
                            <ToggleRow
                                label="Also fire on meaning"
                                description="Lets the entry activate when the conversation is about it, even with no key present."
                                checked={allowsSemantic(entry)}
                                onCheckedChange={(allowSemantic) =>
                                    onReplace(writeEntrySettings(entry, { allowSemantic }))
                                }
                            />
                        ) : (
                            <p className="text-[0.6875rem] leading-relaxed text-subtle">
                                Meaning-based matching is switched off globally. Turn it on under Settings to
                                let entries fire without an exact key.
                            </p>
                        )}
                    </>
                ) : null}
            </div>

            <div className="space-y-2 border-t border-border pt-4">
                <div className="flex items-baseline justify-between gap-2">
                    <SectionLabel className="px-0">What it says</SectionLabel>
                    <span className="text-[0.6875rem] tabular-nums text-subtle">
                        ~{compactNumber(tokens)} tok
                    </span>
                </div>
                <Textarea
                    value={entry.content ?? ''}
                    onChange={(event) => onPatch({ content: event.target.value })}
                    rows={10}
                    aria-label="Entry content"
                    placeholder="The lore this entry adds to the prompt. Macros like {{char}} work here."
                />
            </div>

            <div className="space-y-3 border-t border-border pt-4">
                <SectionLabel className="px-0">Where it goes</SectionLabel>
                <Select
                    value={String(position)}
                    onValueChange={(value) => onPatch({ position: Number(value) as WorldInfoEntry['position'] })}
                    options={POSITION_OPTIONS}
                    aria-label="Insertion position"
                />

                {!isPositionSupported(position) ? (
                    <p className="flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-warning">
                        <AlertTriangle className="mt-px size-3 shrink-0" />
                        This position belongs to the classic extension system and has no equivalent here, so
                        the entry will activate but its content will not be placed.
                    </p>
                ) : null}

                {position === WI_POSITION.atDepth ? (
                    <Slider
                        label="Depth"
                        value={entry.depth ?? 4}
                        onValueChange={(depth) => onPatch({ depth })}
                        min={0}
                        max={16}
                        step={1}
                        format={(value) =>
                            value === 0 ? 'after the last message' : `${value} message${value === 1 ? '' : 's'} from the end`
                        }
                    />
                ) : null}

                <Slider
                    label="Layout order"
                    value={entry.order ?? 100}
                    onValueChange={(order) => onPatch({ order })}
                    min={0}
                    max={1000}
                    step={10}
                    format={(value) => `${value} — lower sits earlier`}
                />
                <p className="text-[0.6875rem] leading-relaxed text-subtle">
                    Order decides where an entry sits among the others at the same position. It is only a
                    tiebreak for the budget, not a priority: relevance decides what fits.
                </p>
            </div>

            <div className="border-t border-border pt-4">
                <button
                    type="button"
                    onClick={() => setShowAdvanced((value) => !value)}
                    aria-expanded={showAdvanced}
                    className="text-[0.8125rem] font-medium text-muted transition-colors hover:text-text"
                >
                    {showAdvanced ? 'Hide' : 'Show'} advanced matching
                </button>

                {showAdvanced ? (
                    <div className="mt-3 space-y-4">
                        <Slider
                            label="Chance of firing"
                            value={entry.useProbability === false ? 100 : (entry.probability ?? 100)}
                            onValueChange={(probability) =>
                                onPatch({ probability, useProbability: probability < 100 })
                            }
                            min={5}
                            max={100}
                            step={5}
                            format={(value) => `${value}%`}
                        />

                        <Field
                            label="Scan depth override"
                            hint="Messages scanned for this entry's keys. Leave empty to use the global setting."
                        >
                            <Input
                                type="number"
                                min={0}
                                max={100}
                                value={entry.scanDepth ?? ''}
                                onChange={(event) =>
                                    onPatch({
                                        scanDepth: event.target.value === '' ? null : Number(event.target.value),
                                    })
                                }
                                placeholder="Global"
                            />
                        </Field>

                        <ToggleRow
                            label="Case sensitive keys"
                            checked={entry.caseSensitive === true}
                            onCheckedChange={(caseSensitive) => onPatch({ caseSensitive })}
                        />
                        <ToggleRow
                            label="Whole words only"
                            description={'Stops "forest" matching "deforestation". Ignored for scripts without word boundaries.'}
                            checked={entry.matchWholeWords === true}
                            onCheckedChange={(matchWholeWords) => onPatch({ matchWholeWords })}
                        />
                        <ToggleRow
                            label="Do not let this entry trigger others"
                            description="Its content is left out of the recursion scan."
                            checked={entry.excludeRecursion === true}
                            onCheckedChange={(excludeRecursion) => onPatch({ excludeRecursion })}
                        />
                        <ToggleRow
                            label="Only fire from the chat, never from other entries"
                            checked={entry.preventRecursion === true}
                            onCheckedChange={(preventRecursion) => onPatch({ preventRecursion })}
                        />

                        {ignored.length > 0 ? (
                            <div className="space-y-1.5 rounded-lg bg-warning/10 p-3">
                                <p className="flex items-start gap-1.5 text-[0.75rem] font-medium text-warning">
                                    <AlertTriangle className="mt-px size-3.5 shrink-0" />
                                    Set on this entry, but not applied here
                                </p>
                                <ul className="ml-4 list-disc space-y-1 text-[0.6875rem] leading-relaxed text-muted">
                                    {ignored.map((field) => (
                                        <li key={field}>
                                            <code className="font-mono">{field}</code> —{' '}
                                            {UNSUPPORTED_FIELDS[field]}. The value is preserved in the file, so
                                            the classic interface still honours it.
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <p className="text-[0.6875rem] text-subtle">
                <Badge>uid {entry.uid}</Badge>
            </p>
        </div>
    );
}
