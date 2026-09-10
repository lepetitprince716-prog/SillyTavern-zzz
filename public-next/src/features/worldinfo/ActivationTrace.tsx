import { AlertTriangle, BookOpen, ChevronRight, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, SectionLabel } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/overlays';
import { cn } from '@/lib/cn';
import { compactNumber } from '@/lib/format';
import type { ActiveEntry } from './books';
import {
    explainDecision,
    UNSUPPORTED_FIELDS,
    type ActivationReason,
    type EntryDecision,
} from './engine';
import type { WorldInfoState } from './useWorldInfo';

/** A label for an entry: the author's comment, else its first key. */
function entryLabel(decision: EntryDecision): string {
    const entry = decision.entry;
    const comment = (entry.comment ?? '').trim();
    if (comment) {
        return comment;
    }
    const firstKey = (entry.key ?? []).find((key) => key.trim());
    return firstKey ?? `Entry ${entry.uid}`;
}

/** Reasons grouped for the "not included" list, in the order shown. */
const SKIP_GROUPS: Array<{ reason: ActivationReason; title: string }> = [
    { reason: 'budget', title: 'Did not fit the budget' },
    { reason: 'no-keyword-match', title: 'No key matched' },
    { reason: 'semantic-rank', title: 'Outranked by closer entries' },
    { reason: 'below-similarity', title: 'Not similar enough' },
    { reason: 'secondary-keys', title: 'Secondary key condition failed' },
    { reason: 'probability', title: 'Lost a probability roll' },
    { reason: 'no-keys', title: 'Has no trigger' },
    { reason: 'empty', title: 'Empty' },
    { reason: 'disabled', title: 'Switched off' },
];

const REASON_TONE: Partial<Record<ActivationReason, 'accent' | 'success' | 'warning' | 'neutral'>> = {
    always: 'warning',
    keyword: 'accent',
    semantic: 'success',
};

function ScoreRow({ label, value }: { label: string; value: number }) {
    if (value === 0) {
        return null;
    }
    return (
        <div className="flex items-baseline justify-between gap-3">
            <span className="text-subtle">{label}</span>
            <span className={cn('tabular-nums', value < 0 ? 'text-danger' : 'text-muted')}>
                {value > 0 ? '+' : ''}
                {value}
            </span>
        </div>
    );
}

function IncludedRow({ decision }: { decision: EntryDecision }) {
    const [open, setOpen] = useState(false);
    const source = (decision.entry as ActiveEntry).sourceBook;
    const score = decision.score;

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="flex w-full items-start gap-2 px-2.5 py-2 text-left transition-colors hover:bg-surface-2"
            >
                <ChevronRight
                    className={cn('mt-0.5 size-3.5 shrink-0 text-subtle transition-transform', open && 'rotate-90')}
                />
                <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                        <span className="truncate text-[0.8125rem] font-medium">{entryLabel(decision)}</span>
                        <Badge tone={REASON_TONE[decision.reason] ?? 'neutral'}>{decision.reason}</Badge>
                    </span>
                    <span className="block truncate text-[0.6875rem] text-subtle">
                        {explainDecision(decision)}
                    </span>
                </span>
                <span className="shrink-0 text-right">
                    <span className="block text-[0.6875rem] tabular-nums text-muted">{score.total}</span>
                    <span className="block text-[0.625rem] tabular-nums text-subtle">
                        {compactNumber(decision.tokens)} tok
                    </span>
                </span>
            </button>

            {open ? (
                <div className="space-y-2 border-t border-border px-2.5 py-2 text-[0.6875rem]">
                    {source ? (
                        <p className="flex items-center gap-1.5 text-subtle">
                            <BookOpen className="size-3" />
                            {source}
                        </p>
                    ) : null}

                    <div className="space-y-0.5">
                        <p className="font-medium text-muted">Score</p>
                        <ScoreRow label="Always on" value={score.always} />
                        <ScoreRow label="Recency of the match" value={score.recency} />
                        <ScoreRow label="Keys matched" value={score.keyMatches} />
                        <ScoreRow label="Semantic similarity" value={score.semantic} />
                        <ScoreRow label="Recursion penalty" value={-score.recursion} />
                        <ScoreRow label="Order tiebreak" value={score.order} />
                        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border pt-1">
                            <span className="font-medium text-muted">Total</span>
                            <span className="font-medium tabular-nums">{score.total}</span>
                        </div>
                    </div>

                    {decision.round > 0 ? (
                        <p className="text-subtle">Activated on recursion round {decision.round}.</p>
                    ) : null}

                    {!decision.positionSupported ? (
                        <p className="flex items-start gap-1.5 text-warning">
                            <AlertTriangle className="mt-px size-3 shrink-0" />
                            Its insertion position has no equivalent here, so the content was not placed.
                        </p>
                    ) : null}

                    {decision.ignoredFields.length > 0 ? (
                        <div className="space-y-1 text-warning">
                            <p className="flex items-start gap-1.5">
                                <AlertTriangle className="mt-px size-3 shrink-0" />
                                This engine does not apply:
                            </p>
                            <ul className="ml-4 list-disc space-y-0.5 text-subtle">
                                {decision.ignoredFields.map((field) => (
                                    <li key={field}>
                                        <code className="font-mono">{field}</code> — {UNSUPPORTED_FIELDS[field]}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    <p className="whitespace-pre-wrap border-t border-border pt-1.5 font-mono leading-relaxed text-muted">
                        {(decision.entry.content ?? '').slice(0, 600)}
                    </p>
                </div>
            ) : null}
        </div>
    );
}

/**
 * What world info did this turn, and why.
 *
 * The whole point of this panel: every candidate entry is accounted for, with
 * the reason it was included or left out, so a surprising reply can be traced
 * back to the lore that was or was not in the prompt.
 */
export function ActivationTrace({ state }: { state: WorldInfoState }) {
    const [showSkipped, setShowSkipped] = useState(false);

    if (state.bookNames.length === 0) {
        return (
            <section className="space-y-1.5">
                <SectionLabel className="px-0">World info</SectionLabel>
                <p className="text-xs leading-relaxed text-subtle">
                    No lorebook is active for this chat. Bind one on the character card, or pick one under
                    Settings.
                </p>
            </section>
        );
    }

    const result = state.result;
    const skipped = (result?.decisions ?? []).filter((decision) => !decision.included);
    const included = result?.included ?? [];
    const budget = result?.budget;

    return (
        <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
                <SectionLabel className="px-0">World info</SectionLabel>
                {state.isScoring ? (
                    <span className="flex items-center gap-1 text-[0.6875rem] text-subtle">
                        <Loader2 className="size-3 animate-spin" />
                        scoring
                    </span>
                ) : null}
            </div>

            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-subtle">
                <span>
                    {included.length} of {state.entries.length} entries active
                </span>
                {budget ? (
                    <Tooltip content="Tokens spent out of the world info budget">
                        <span className="tabular-nums">
                            {compactNumber(budget.used)} / {compactNumber(budget.limit)} tok
                        </span>
                    </Tooltip>
                ) : null}
                <span className="truncate">{state.bookNames.join(', ')}</span>
            </p>

            {state.semanticError ? (
                <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-2 text-[0.6875rem] leading-relaxed text-warning">
                    <AlertTriangle className="mt-px size-3 shrink-0" />
                    Semantic matching failed, so only keys were used: {state.semanticError}
                </p>
            ) : null}

            {included.length > 0 ? (
                <div className="space-y-1">
                    {included.map((decision) => (
                        <IncludedRow key={decision.entry.uid} decision={decision} />
                    ))}
                </div>
            ) : (
                <p className="text-xs text-subtle">Nothing activated for the current messages.</p>
            )}

            {skipped.length > 0 ? (
                <div className="space-y-1.5">
                    <button
                        type="button"
                        onClick={() => setShowSkipped((value) => !value)}
                        aria-expanded={showSkipped}
                        className="flex w-full items-center gap-1.5 text-[0.6875rem] text-subtle transition-colors hover:text-text"
                    >
                        <ChevronRight className={cn('size-3 transition-transform', showSkipped && 'rotate-90')} />
                        {skipped.length} not included
                    </button>

                    {showSkipped ? (
                        <div className="space-y-2">
                            {SKIP_GROUPS.map(({ reason, title }) => {
                                const group = skipped.filter((decision) => decision.reason === reason);
                                if (group.length === 0) {
                                    return null;
                                }
                                return (
                                    <div key={reason} className="space-y-0.5">
                                        <p className="text-[0.625rem] font-semibold uppercase tracking-wide text-subtle">
                                            {title} ({group.length})
                                        </p>
                                        <ul className="space-y-0.5">
                                            {group.map((decision) => (
                                                <li
                                                    key={decision.entry.uid}
                                                    className="flex items-baseline justify-between gap-2 text-[0.6875rem]"
                                                >
                                                    <span className="truncate text-muted">
                                                        {entryLabel(decision)}
                                                    </span>
                                                    <span className="shrink-0 tabular-nums text-subtle">
                                                        {compactNumber(decision.tokens)} tok
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </section>
    );
}
