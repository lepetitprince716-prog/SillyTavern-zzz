/**
 * World info activation.
 *
 * A replacement for the classic engine's three-state scan loop, built around
 * four rules:
 *
 *  1. **Nothing is dropped silently.** Every entry comes back with a decision
 *     and a reason, including the ones that lost the budget.
 *  2. **The budget is spent on relevance, not on insertion order.** Entries are
 *     ranked by an explicit, inspectable score; `order` only decides where the
 *     survivors sit in the prompt.
 *  3. **Recursion is bounded and recorded.** Each entry reports the round it
 *     activated on, so a chain is legible instead of emergent.
 *  4. **Unimplemented legacy fields are reported, not ignored.** A book written
 *     for the classic engine can use timers and group weighting that this
 *     engine does not apply; callers get that list so the UI can say so rather
 *     than quietly behaving differently.
 *
 * The function is pure: semantic similarity is supplied by the caller, and
 * randomness is injectable, so activation is fully testable.
 */

import { estimateTokens } from '@/lib/format';
import { WI_LOGIC, WI_POSITION, type WiLogic, type WiPosition, type WorldInfoEntry } from '@/api/worldinfo';
import { allowsSemantic } from './entry-settings';

/** Why an entry did or did not make it into the prompt. */
export type ActivationReason =
    | 'always'
    | 'keyword'
    | 'semantic'
    | 'disabled'
    | 'empty'
    | 'no-keys'
    | 'no-keyword-match'
    | 'secondary-keys'
    | 'below-similarity'
    | 'semantic-rank'
    | 'probability'
    | 'budget';

/** The parts that add up to an entry's ranking score, for display. */
export interface ScoreBreakdown {
    /** Author-mandated entries outrank everything else. */
    always: number;
    /** How recent the matching message is. */
    recency: number;
    /** How many distinct keys matched. */
    keyMatches: number;
    /** Semantic similarity, when available. */
    semantic: number;
    /** Penalty for activating via recursion rather than the chat itself. */
    recursion: number;
    /** The entry's own `order`, as a tiebreak only. */
    order: number;
    total: number;
}

export interface EntryDecision {
    entry: WorldInfoEntry;
    included: boolean;
    reason: ActivationReason;
    /** Keys that matched, for showing the user why. */
    matchedKeys: string[];
    /** Cosine similarity, when a semantic score was supplied. */
    similarity: number | null;
    /** 0 for the initial scan, 1+ for recursion rounds. */
    round: number;
    /** Estimated tokens the content costs. */
    tokens: number;
    score: ScoreBreakdown;
    /** Legacy fields set on this entry that this engine does not apply. */
    ignoredFields: string[];
    /**
     * False when the entry's insertion position has no equivalent here, so its
     * content activated but was not placed. Reported rather than silently
     * relocated.
     */
    positionSupported: boolean;
}

export interface EngineSettings {
    /** Total tokens world info may spend. */
    budgetTokens: number;
    /** Messages scanned for keys, counting back from the latest. */
    scanDepth: number;
    /** Recursion rounds allowed after the initial scan. 0 disables it. */
    maxRecursionRounds: number;
    /**
     * Floor for a semantic activation, 0-1.
     *
     * Absolute similarity is model-dependent: the local embedding model scores
     * clearly related lore around 0.4 and unrelated lore around 0.1, so this is
     * a noise floor rather than a confidence level. {@link semanticTopK} is what
     * bounds how much meaning-based matching can add.
     */
    semanticThreshold: number;
    /** At most this many entries may activate on meaning alone. */
    semanticTopK: number;
    /** Injected for tests; defaults to Math.random. */
    random?: () => number;
}

export const DEFAULT_ENGINE_SETTINGS: EngineSettings = {
    budgetTokens: 1024,
    scanDepth: 4,
    maxRecursionRounds: 1,
    semanticThreshold: 0.3,
    semanticTopK: 3,
};

export interface ActivateOptions {
    entries: WorldInfoEntry[];
    /** Chat messages, oldest first. Only the text matters here. */
    messages: string[];
    settings: EngineSettings;
    /** Similarity per entry uid, when semantic retrieval ran. */
    similarities?: Map<number, number>;
}

export interface ActivationResult {
    decisions: EntryDecision[];
    included: EntryDecision[];
    /** Assembled text per insertion position, `order` respected. */
    blocks: Map<WiPosition, string>;
    /** `atDepth` insertions, grouped by depth. */
    depthBlocks: Map<number, string>;
    budget: { limit: number; used: number; dropped: number };
}

/**
 * Legacy fields this engine does not implement, and what each one does.
 * Surfaced per entry so the UI can be honest about the difference instead of
 * behaving unexpectedly.
 */
export const UNSUPPORTED_FIELDS: Record<string, string> = {
    sticky: 'keeps an entry active for N messages after it fires',
    cooldown: 'blocks re-activation for N messages',
    delay: 'suppresses the entry until the chat is N messages long',
    delayUntilRecursion: 'holds the entry back until a recursion round',
    group: 'picks one winner out of a named group',
    groupOverride: 'forces this entry to win its group',
    useGroupScoring: 'ranks a group by score rather than weight',
    automationId: 'triggers a Quick Reply when the entry fires',
    vectorized: 'routes the entry through the classic vector storage extension',
};

/** Lists the unsupported fields actually set on an entry. */
export function findIgnoredFields(entry: WorldInfoEntry): string[] {
    const ignored: string[] = [];
    for (const field of Object.keys(UNSUPPORTED_FIELDS)) {
        const value = entry[field];
        if (value === undefined || value === null || value === false || value === '' || value === 0) {
            continue;
        }
        // groupWeight only matters alongside a group, so it is not listed alone.
        ignored.push(field);
    }
    return ignored;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Finds a key in text.
 *
 * `wholeWords` uses a boundary that works for scripts without spaces too: a
 * plain `\b` never matches around CJK, which would silently disable
 * whole-word matching for those keys, so it is only applied when the key is
 * itself word-like.
 */
export function keyMatches(
    text: string,
    key: string,
    options: { caseSensitive: boolean; wholeWords: boolean },
): boolean {
    const needle = key.trim();
    if (!needle) {
        return false;
    }
    const haystack = options.caseSensitive ? text : text.toLowerCase();
    const target = options.caseSensitive ? needle : needle.toLowerCase();

    if (!options.wholeWords || !/^[\w][\w\s'-]*$/.test(needle)) {
        return haystack.includes(target);
    }

    return new RegExp(`\\b${escapeRegExp(target)}\\b`).test(haystack);
}

/** Every key that matches, so the reason can name them. */
function matchingKeys(
    text: string,
    keys: string[],
    options: { caseSensitive: boolean; wholeWords: boolean },
): string[] {
    return keys.filter((key) => keyMatches(text, key, options));
}

/** Applies the secondary-key logic. */
export function secondaryKeysSatisfied(
    text: string,
    secondary: string[],
    logic: WiLogic,
    options: { caseSensitive: boolean; wholeWords: boolean },
): boolean {
    const present = matchingKeys(text, secondary, options).length;
    switch (logic) {
        case WI_LOGIC.andAll:
            return present === secondary.length;
        case WI_LOGIC.notAny:
            return present === 0;
        case WI_LOGIC.notAll:
            return present < secondary.length;
        case WI_LOGIC.andAny:
        default:
            return present > 0;
    }
}

/** The slice of chat that keyword scanning looks at. */
function scanWindow(messages: string[], depth: number): string[] {
    const limit = Math.max(0, Math.floor(depth));
    return limit === 0 ? [] : messages.slice(-limit);
}

/**
 * Position of the most recent message a key matched in, as 0–1 where 1 is the
 * latest message. Drives the recency part of the score.
 */
function recencyOf(
    window: string[],
    keys: string[],
    options: { caseSensitive: boolean; wholeWords: boolean },
): number {
    if (window.length === 0) {
        return 0;
    }
    for (let index = window.length - 1; index >= 0; index--) {
        const text = window[index] ?? '';
        if (matchingKeys(text, keys, options).length > 0) {
            return (index + 1) / window.length;
        }
    }
    return 0;
}

const EMPTY_SCORE: ScoreBreakdown = {
    always: 0,
    recency: 0,
    keyMatches: 0,
    semantic: 0,
    recursion: 0,
    order: 0,
    total: 0,
};

function buildScore(parts: Partial<ScoreBreakdown>): ScoreBreakdown {
    const score = { ...EMPTY_SCORE, ...parts };
    score.total =
        score.always + score.recency + score.keyMatches + score.semantic + score.order - score.recursion;
    return score;
}

/**
 * Decides which entries go into the prompt, and why.
 *
 * Runs the initial scan over the recent chat, then up to
 * `maxRecursionRounds` further rounds over the text activated so far. Once no
 * new entry activates, survivors are ranked by score and the budget is spent
 * from the top; whatever does not fit is returned with reason `budget`.
 */
export function activateWorldInfo(options: ActivateOptions): ActivationResult {
    const { entries, messages, settings } = options;
    const similarities = options.similarities ?? new Map<number, number>();
    const random = settings.random ?? Math.random;

    /** Decisions for entries that are out of the running for good. */
    const rejected: EntryDecision[] = [];
    /** Entries that activated, in activation order. */
    const activated: EntryDecision[] = [];
    /** Entries still eligible in later rounds. */
    let pending: WorldInfoEntry[] = [];

    const baseDecision = (entry: WorldInfoEntry): Omit<EntryDecision, 'reason' | 'included' | 'score'> => ({
        entry,
        matchedKeys: [],
        similarity: similarities.get(entry.uid) ?? null,
        round: 0,
        tokens: estimateTokens(entry.content ?? ''),
        ignoredFields: findIgnoredFields(entry),
        positionSupported: isPositionSupported(entry.position),
    });

    // Pass one: settle the entries whose fate does not depend on the chat.
    for (const entry of entries) {
        const base = baseDecision(entry);

        if (entry.disable) {
            rejected.push({ ...base, included: false, reason: 'disabled', score: buildScore({}) });
            continue;
        }
        if (!(entry.content ?? '').trim()) {
            rejected.push({ ...base, included: false, reason: 'empty', score: buildScore({}) });
            continue;
        }
        if (entry.constant) {
            activated.push({
                ...base,
                included: true,
                reason: 'always',
                score: buildScore({ always: 10_000, order: orderBonus(entry) }),
            });
            continue;
        }
        pending.push(entry);
    }

    const window = scanWindow(messages, settings.scanDepth);
    let scanText = window.join('\n');
    const rounds = Math.max(0, Math.floor(settings.maxRecursionRounds));

    for (let round = 0; round <= rounds; round++) {
        const newlyActivated: EntryDecision[] = [];
        const stillPending: WorldInfoEntry[] = [];

        for (const entry of pending) {
            // An entry marked preventRecursion is only eligible on the initial
            // scan. It stays in the pending list rather than being dropped, so
            // the final pass still reports a decision for it.
            if (round > 0 && entry.preventRecursion) {
                stillPending.push(entry);
                continue;
            }
            const base = { ...baseDecision(entry), round };
            const matchOptions = {
                caseSensitive: entry.caseSensitive === true,
                wholeWords: entry.matchWholeWords === true,
            };
            const perEntryWindow =
                typeof entry.scanDepth === 'number' && entry.scanDepth > 0
                    ? scanWindow(messages, entry.scanDepth)
                    : window;
            // Recursion rounds scan the text activated so far as well.
            const searchText = round === 0 ? perEntryWindow.join('\n') : scanText;

            const keys = (entry.key ?? []).filter((key) => key.trim());
            const matched = matchingKeys(searchText, keys, matchOptions);

            if (matched.length === 0) {
                // Keyless entries fall through here too: only the semantic pass
                // below can activate them.
                stillPending.push(entry);
                continue;
            }

            const secondary = (entry.keysecondary ?? []).filter((key) => key.trim());
            if (entry.selective && secondary.length > 0) {
                const logic = (entry.selectiveLogic ?? WI_LOGIC.andAny) as WiLogic;
                if (!secondaryKeysSatisfied(searchText, secondary, logic, matchOptions)) {
                    rejected.push({
                        ...base,
                        included: false,
                        reason: 'secondary-keys',
                        matchedKeys: matched,
                        score: buildScore({}),
                    });
                    continue;
                }
            }

            const probability = entry.useProbability === false ? 100 : (entry.probability ?? 100);
            if (probability < 100 && random() * 100 >= probability) {
                rejected.push({
                    ...base,
                    included: false,
                    reason: 'probability',
                    matchedKeys: matched,
                    score: buildScore({}),
                });
                continue;
            }

            const similarity = similarities.get(entry.uid) ?? null;
            newlyActivated.push({
                ...base,
                included: true,
                reason: 'keyword',
                matchedKeys: matched,
                similarity,
                score: buildScore({
                    recency: Math.round(recencyOf(perEntryWindow, keys, matchOptions) * 100),
                    keyMatches: Math.min(matched.length * 10, 50),
                    semantic: similarity !== null ? Math.round(similarity * 100) : 0,
                    recursion: round * 25,
                    order: orderBonus(entry),
                }),
            });
        }

        activated.push(...newlyActivated);
        pending = stillPending;

        if (newlyActivated.length === 0 || round === rounds) {
            break;
        }

        // Feed the next round, minus entries that opt out of contributing.
        const contribution = newlyActivated
            .filter((decision) => !decision.entry.excludeRecursion)
            .map((decision) => decision.entry.content ?? '')
            .join('\n');
        if (!contribution) {
            break;
        }
        scanText = `${scanText}\n${contribution}`;
    }

    // Semantic pass: meaning fills in what the keys missed.
    //
    // Ranking the leftovers, rather than thresholding every entry up front,
    // does two things. It keeps the feature predictable across embedding models,
    // whose absolute score scales differ wildly; and it stops an entry that
    // already matched by key from consuming one of the limited semantic slots.
    const semanticBudget = Math.max(0, Math.floor(settings.semanticTopK));
    const eligible = pending
        .filter((entry) => allowsSemantic(entry))
        .map((entry) => ({ entry, similarity: similarities.get(entry.uid) ?? null }))
        .filter(
            (candidate): candidate is { entry: WorldInfoEntry; similarity: number } =>
                candidate.similarity !== null && candidate.similarity >= settings.semanticThreshold,
        )
        .sort((a, b) => b.similarity - a.similarity);

    const semanticWinners = new Set(
        eligible.slice(0, semanticBudget).map((candidate) => candidate.entry.uid),
    );

    for (const entry of pending) {
        const base = baseDecision(entry);
        const similarity = similarities.get(entry.uid) ?? null;

        if (semanticWinners.has(entry.uid)) {
            activated.push({
                ...base,
                included: true,
                reason: 'semantic',
                similarity,
                score: buildScore({
                    semantic: Math.round((similarity ?? 0) * 100),
                    order: orderBonus(entry),
                }),
            });
            continue;
        }

        // Four distinct ways to miss, each named so the trace can explain it.
        const hasKeys = (entry.key ?? []).some((key) => key.trim());
        const reason: ActivationReason =
            similarity === null
                ? hasKeys
                    ? 'no-keyword-match'
                    : 'no-keys'
                : similarity < settings.semanticThreshold
                    ? 'below-similarity'
                    : 'semantic-rank';

        rejected.push({ ...base, included: false, reason, score: buildScore({}) });
    }

    // Spend the budget on the highest-scoring entries.
    const ranked = [...activated].sort((a, b) => b.score.total - a.score.total);
    const kept: EntryDecision[] = [];
    let used = 0;
    let dropped = 0;

    for (const decision of ranked) {
        if (used + decision.tokens <= settings.budgetTokens) {
            used += decision.tokens;
            kept.push(decision);
        } else {
            dropped++;
            rejected.push({ ...decision, included: false, reason: 'budget' });
        }
    }

    // Assemble the prompt blocks. `order` decides layout, not survival.
    const blocks = new Map<WiPosition, string>();
    const depthBlocks = new Map<number, string>();
    const layout = [...kept].sort((a, b) => (a.entry.order ?? 100) - (b.entry.order ?? 100));

    for (const decision of layout) {
        const content = (decision.entry.content ?? '').trim();
        const position = (decision.entry.position ?? WI_POSITION.beforeCharacter) as WiPosition;

        if (!decision.positionSupported) {
            // Activated, but there is nowhere to put it. The decision carries
            // positionSupported: false so the UI can say so.
            continue;
        }

        if (position === WI_POSITION.atDepth) {
            const depth = Math.max(0, Math.floor(decision.entry.depth ?? 4));
            depthBlocks.set(depth, [depthBlocks.get(depth), content].filter(Boolean).join('\n'));
            continue;
        }
        blocks.set(position, [blocks.get(position), content].filter(Boolean).join('\n'));
    }

    const decisions = [...kept, ...rejected];

    return {
        decisions,
        included: kept,
        blocks,
        depthBlocks,
        budget: { limit: settings.budgetTokens, used, dropped },
    };
}

/**
 * Insertion positions this engine can place.
 *
 * `outlet` is a named-slot mechanism belonging to the classic extension system,
 * which has no counterpart here.
 */
export function isPositionSupported(position: number | undefined): boolean {
    return position !== WI_POSITION.outlet;
}

/** `order` contributes only a small tiebreak, never enough to outrank a match. */
function orderBonus(entry: WorldInfoEntry): number {
    const order = Number(entry.order);
    if (!Number.isFinite(order)) {
        return 0;
    }
    // Lower order means "earlier", which the classic engine treats as higher
    // priority, so it is inverted here.
    return Math.max(0, 10 - Math.min(100, Math.max(0, order)) / 10);
}

/** Human-readable explanation of a decision, for the trace UI. */
export function explainDecision(decision: EntryDecision): string {
    switch (decision.reason) {
        case 'always':
            return 'Always on';
        case 'keyword':
            return `Matched ${decision.matchedKeys.map((key) => `"${key}"`).join(', ')}`;
        case 'semantic':
            return `Semantically similar (${((decision.similarity ?? 0) * 100).toFixed(0)}%)`;
        case 'disabled':
            return 'Switched off';
        case 'empty':
            return 'No content';
        case 'no-keys':
            return 'No trigger keys, and not always on';
        case 'no-keyword-match':
            return 'No key appeared in the scanned messages';
        case 'below-similarity':
            return `Too dissimilar (${((decision.similarity ?? 0) * 100).toFixed(0)}%)`;
        case 'semantic-rank':
            return `Similar (${((decision.similarity ?? 0) * 100).toFixed(0)}%) but outranked by closer entries`;
        case 'secondary-keys':
            return 'Secondary key condition not met';
        case 'probability':
            return `Lost its ${decision.entry.probability ?? 100}% probability roll`;
        case 'budget':
            return 'Ranked too low to fit the token budget';
        default:
            return 'Unknown';
    }
}
