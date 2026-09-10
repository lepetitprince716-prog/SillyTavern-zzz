/**
 * Why this turn went the way it did.
 *
 * The classic group engine rolls talkativeness against `Math.random()` per
 * member, shuffles the survivors and returns a list of ids. When the wrong
 * character answers, or nobody does, there is nothing to look at. This lists
 * every member with the decision and the numbers behind it, and the count
 * reconciles with the group.
 */

import { Mic, MicOff } from 'lucide-react';
import { avatarUrl } from '@/api/characters';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { explainDecision, type TurnPlan } from './engine';

const STRATEGY_LABEL: Record<TurnPlan['strategy'], string> = {
    natural: 'Whoever the moment called for',
    list: 'Everyone, in order',
    pooled: 'Taking turns',
    manual: 'Only who you picked',
};

export function TurnTrace({ plan }: { plan: TurnPlan | null }) {
    if (!plan) {
        return (
            <p className="text-xs leading-relaxed text-subtle">
                Send a message and this will show who replied and why — the names that were
                matched, the rolls each member made, and who was held back.
            </p>
        );
    }

    const speaking = plan.decisions.filter((entry) => entry.speaking);
    // A hand-picked turn was not decided by the group's strategy, so labelling
    // it with that strategy contradicts the reasons listed underneath it.
    const byHand = plan.decisions.some((entry) => entry.reason === 'chosen');

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">
                    {byHand ? 'You picked one member' : STRATEGY_LABEL[plan.strategy]}
                </Badge>
                <span className="text-[0.6875rem] text-subtle">
                    {speaking.length} of {plan.decisions.length} replied
                </span>
            </div>

            <ul className="space-y-1.5">
                {plan.decisions.map((entry) => (
                    <li
                        key={entry.avatar}
                        className={cn(
                            'flex items-start gap-2 rounded-lg border px-2 py-1.5',
                            entry.speaking
                                ? 'border-accent/40 bg-accent-soft/40'
                                : 'border-border bg-surface-2/40',
                        )}
                    >
                        <Avatar
                            src={avatarUrl(entry.avatar)}
                            name={entry.name}
                            size="sm"
                            rounded="card"
                            className={entry.speaking ? undefined : 'opacity-55'}
                        />
                        <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 text-[0.8125rem] font-medium">
                                {entry.speaking ? (
                                    <Mic className="size-3 shrink-0 text-accent" aria-hidden />
                                ) : (
                                    <MicOff className="size-3 shrink-0 text-subtle" aria-hidden />
                                )}
                                <span className="truncate">{entry.name}</span>
                                {entry.speaking && entry.order !== null ? (
                                    <span className="ml-auto shrink-0 tabular-nums text-[0.625rem] text-subtle">
                                        #{entry.order + 1}
                                    </span>
                                ) : null}
                            </p>
                            <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-muted">
                                {explainDecision(entry)}
                            </p>
                        </div>
                    </li>
                ))}
            </ul>

            <p className="text-[0.625rem] leading-relaxed text-subtle">
                Every member is listed, whether they spoke or not — a turn that cannot be explained
                is a turn you cannot tune.
            </p>
        </div>
    );
}

/** Compact live indicator while a turn is running. */
export function SpeakingNow({ name }: { name: string | null }) {
    if (!name) {
        return null;
    }
    return (
        <p className="flex items-center gap-1.5 px-4 text-xs text-subtle" role="status">
            <Mic className="size-3 animate-pulse text-accent" aria-hidden />
            {name} is replying…
        </p>
    );
}
