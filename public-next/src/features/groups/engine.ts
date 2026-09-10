/**
 * Who speaks next in a group chat.
 *
 * The classic engine picks its speakers and tells you nothing. Mentions are
 * matched, talkativeness is rolled against `Math.random()` per member, the
 * survivors are shuffled, and the result is a list of character ids — so a
 * turn where the wrong character answered, or nobody did, cannot be explained
 * after the fact. It is the same problem the world info engine had, and it
 * gets the same treatment: every member comes back with a decision and a
 * reason, the rolls are shown against the thresholds they were compared to,
 * and the whole turn can be replayed from a seed.
 *
 * Three defects in the classic implementation are fixed here, each with a test:
 *
 * 1. **A non-ASCII name can never be mentioned.** `extractAllWords` matches
 *    `/\b\w+\b/`, and `\w` is `[A-Za-z0-9_]`, so a character called 小明 or
 *    Аня produces an empty word list and silently falls through to the
 *    talkativeness roll. Naming them has no effect at all.
 * 2. **An ambiguous mention activates only one member.** The classic loop
 *    breaks out after the first member matching a word, so in a group holding
 *    both "Alice" and "Alice Smith", saying either name activates whichever
 *    sits earlier in the member list.
 * 3. **Speaking order is shuffled**, so even a deliberate two-character
 *    exchange comes out in a random order each turn.
 */

import type { Character, ChatMessage } from '@/api/types';

/** Stored as an integer in the group file; these are the four it can hold. */
export const GROUP_ACTIVATION = {
    natural: 0,
    list: 1,
    manual: 2,
    pooled: 3,
} as const;

export type ActivationStrategy = keyof typeof GROUP_ACTIVATION;

export function activationFromNumber(value: unknown): ActivationStrategy {
    switch (Number(value)) {
        case GROUP_ACTIVATION.list:
            return 'list';
        case GROUP_ACTIVATION.manual:
            return 'manual';
        case GROUP_ACTIVATION.pooled:
            return 'pooled';
        default:
            return 'natural';
    }
}

/** How the members' cards reach the prompt. */
export const GROUP_GENERATION_MODE = {
    /** One member's card per reply: the model plays one character at a time. */
    swap: 0,
    /** Every enabled member's card joined into one prompt. */
    join: 1,
    /** As `join`, but disabled members are included too. */
    joinAll: 2,
} as const;

export type GenerationMode = keyof typeof GROUP_GENERATION_MODE;

export function generationModeFromNumber(value: unknown): GenerationMode {
    switch (Number(value)) {
        case GROUP_GENERATION_MODE.join:
            return 'join';
        case GROUP_GENERATION_MODE.joinAll:
            return 'joinAll';
        default:
            return 'swap';
    }
}

/** Why a member is or is not speaking this turn. */
export type DecisionReason =
    /** Their name appears in the message. */
    | 'mentioned'
    /** Won their talkativeness roll. */
    | 'talkative'
    /** Lost their talkativeness roll. */
    | 'quiet'
    /** Every enabled member speaks, in list order. */
    | 'listed'
    /** Had not spoken since the user's last message. */
    | 'pooled'
    /** Already spoke since the user's last message. */
    | 'spoke-recently'
    /** Would speak twice in a row. */
    | 'back-to-back'
    /** Switched off in the group. */
    | 'disabled'
    /** Manual mode: nobody speaks unless asked. */
    | 'not-asked'
    /** Someone else was picked for this one turn. */
    | 'not-chosen'
    /** Nobody was activated, so one was picked to avoid a dead turn. */
    | 'fallback'
    /** Chosen by hand. */
    | 'chosen';

/** Where a member's name was found, and which part of it matched. */
export interface Mention {
    matched: string;
    /** Character offset in the message. */
    at: number;
}

export interface MemberDecision {
    /** Avatar file name, which is the member id. */
    avatar: string;
    name: string;
    speaking: boolean;
    reason: DecisionReason;
    /** Position in the reply order, or null when not speaking. */
    order: number | null;
    /** The roll and the value it was compared against, for a talkativeness decision. */
    roll?: number;
    talkativeness?: number;
    /** Which part of their name matched, for a mention. */
    matched?: string;
}

export interface TurnPlan {
    /** Members speaking, in order. */
    speakers: MemberDecision[];
    /** Every member, speaking or not. The count reconciles with the group. */
    decisions: MemberDecision[];
    strategy: ActivationStrategy;
}

/** Talkativeness when a card does not state one, matching the classic default. */
export const DEFAULT_TALKATIVENESS = 0.5;

function talkativenessOf(character: Character): number {
    const raw = Number(character.talkativeness);
    if (!Number.isFinite(raw)) {
        return DEFAULT_TALKATIVENESS;
    }
    return Math.min(1, Math.max(0, raw));
}

/**
 * Where `name` is mentioned in `text`, or -1.
 *
 * Uses Unicode letter classes rather than `\w`, so a name in any script can be
 * mentioned. Word boundaries are only applied where they mean something: a
 * name written in a script that does not space its words cannot be bounded by
 * spaces, so for those a plain substring match is the honest test.
 *
 * The position matters because a named member replies first, and "first"
 * should mean the order they were named in — not their position in the group's
 * member list, which has nothing to do with what was said.
 */
export function mentionIndex(text: string, name: string): number {
    const needle = name.trim();
    if (!needle || !text) {
        return -1;
    }

    const haystack = text.toLowerCase();
    const lowered = needle.toLowerCase();

    // A name with no cased letters — CJK, mostly — has no word boundaries to
    // anchor to. `\b` would never match, which is exactly the classic bug.
    if (!/[\p{Letter}]/u.test(needle) || !/[a-zÀ-ɏͰ-ӿ]/i.test(needle)) {
        return haystack.indexOf(lowered);
    }

    const escaped = lowered.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // `(?<![\p{L}\p{N}])` rather than `\b`: `\b` is defined against `\w`, so it
    // fires in the middle of an accented or Cyrillic name.
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u');
    return haystack.search(pattern);
}

/** True when `name` is mentioned in `text`. */
export function isMentioned(text: string, name: string): boolean {
    return mentionIndex(text, name) >= 0;
}

/**
 * Finds which members the message names.
 *
 * The full name is tried first, then the individual parts, and a part only
 * counts when no member matched on their full name — otherwise "Alice" in a
 * group holding both Alice and Alice Smith is genuinely ambiguous, and the
 * classic engine resolves it by member order, which is to say arbitrarily.
 */
export function findMentions(
    text: string,
    members: Array<{ avatar: string; name: string }>,
): Map<string, Mention> {
    const found = new Map<string, Mention>();

    for (const member of members) {
        const at = mentionIndex(text, member.name);
        if (at >= 0) {
            found.set(member.avatar, { matched: member.name, at });
        }
    }

    if (found.size > 0) {
        return found;
    }

    // No full-name match: fall back to the parts, which is how a group gets
    // "Smith, what do you think?" to work.
    for (const member of members) {
        const parts = member.name.split(/\s+/).filter((part) => part.length > 1);
        if (parts.length < 2) {
            continue;
        }
        for (const part of parts) {
            const at = mentionIndex(text, part);
            if (at >= 0) {
                found.set(member.avatar, { matched: part, at });
                break;
            }
        }
    }

    return found;
}

/** Who spoke since the user's last message, newest first. */
export function spokenSinceUser(messages: ChatMessage[]): string[] {
    const spoken: string[] = [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message || message.is_user) {
            break;
        }
        if (message.is_system) {
            continue;
        }
        const avatar = message.original_avatar;
        if (typeof avatar === 'string' && avatar) {
            spoken.push(avatar);
        }
    }
    return spoken;
}

export interface PlanTurnOptions {
    /** Group members in list order, resolved to cards. */
    members: Character[];
    /** Avatars switched off in the group. */
    disabled: string[];
    strategy: ActivationStrategy;
    /** The chat so far, oldest first. */
    messages: ChatMessage[];
    /** The user's new message, when this turn was started by one. */
    input?: string;
    /** Let a member reply to themselves. */
    allowSelfResponses: boolean;
    /** Force exactly this member to speak, for a manual turn. */
    forceMember?: string;
    /** Randomness, injectable so a turn can be replayed. */
    random?: () => number;
}

function decision(
    character: Character,
    speaking: boolean,
    reason: DecisionReason,
    extra: Partial<MemberDecision> = {},
): MemberDecision {
    return {
        avatar: character.avatar,
        name: character.name,
        speaking,
        reason,
        order: null,
        ...extra,
    };
}

/**
 * Decides who speaks, and records why for everyone.
 *
 * Speaking order is deliberate rather than shuffled: mentions first in the
 * order they were named, then everyone else in the group's own list order. A
 * shuffle makes a two-character exchange come out differently every turn for
 * no stated reason.
 */
export function planTurn(options: PlanTurnOptions): TurnPlan {
    const { members, disabled, strategy, messages, input = '', allowSelfResponses } = options;
    const random = options.random ?? Math.random;
    const disabledSet = new Set(disabled);

    const decisions: MemberDecision[] = [];
    const speaking: MemberDecision[] = [];

    /** Blocked from replying to themselves, unless the group allows it. */
    const lastMessage = messages.at(-1);
    const lastSpeaker = !allowSelfResponses
        && lastMessage
        && !lastMessage.is_user
        && !input
        ? lastMessage.original_avatar
        : undefined;

    const enabled = members.filter((member) => !disabledSet.has(member.avatar));

    // A hand-picked member overrides every strategy, and still gets everybody
    // else a reason.
    if (options.forceMember) {
        for (const member of members) {
            if (member.avatar === options.forceMember) {
                const chosen = decision(member, true, 'chosen', { order: 0 });
                decisions.push(chosen);
                speaking.push(chosen);
            } else if (disabledSet.has(member.avatar)) {
                // Being switched off is the more fundamental reason, and the
                // one the reader can act on.
                decisions.push(decision(member, false, 'disabled'));
            } else {
                // Not `not-asked`: that reason describes a group configured to
                // wait for a pick, and claiming it here would misreport the
                // group's own setting on every hand-picked turn.
                decisions.push(decision(member, false, 'not-chosen'));
            }
        }
        return { speakers: speaking, decisions, strategy };
    }

    for (const member of members) {
        if (disabledSet.has(member.avatar)) {
            decisions.push(decision(member, false, 'disabled'));
        }
    }

    if (strategy === 'manual') {
        for (const member of enabled) {
            decisions.push(decision(member, false, 'not-asked'));
        }
        return { speakers: [], decisions: inOrder(members, decisions), strategy };
    }

    if (strategy === 'list') {
        for (const member of enabled) {
            if (member.avatar === lastSpeaker) {
                decisions.push(decision(member, false, 'back-to-back'));
                continue;
            }
            const speaks = decision(member, true, 'listed', { order: speaking.length });
            decisions.push(speaks);
            speaking.push(speaks);
        }
        return finish(members, decisions, speaking, strategy, enabled, random);
    }

    if (strategy === 'pooled') {
        const spoken = new Set(input ? [] : spokenSinceUser(messages));
        const waiting = enabled.filter(
            (member) => !spoken.has(member.avatar) && member.avatar !== lastSpeaker,
        );

        for (const member of enabled) {
            if (member.avatar === lastSpeaker) {
                decisions.push(decision(member, false, 'back-to-back'));
            } else if (spoken.has(member.avatar)) {
                decisions.push(decision(member, false, 'spoke-recently'));
            }
        }

        if (waiting.length > 0) {
            // One at a time, so the pool drains in a visible order rather than
            // everyone answering at once.
            const picked = waiting[Math.floor(random() * waiting.length)] ?? waiting[0]!;
            for (const member of waiting) {
                if (member.avatar === picked.avatar) {
                    const speaks = decision(member, true, 'pooled', { order: 0 });
                    decisions.push(speaks);
                    speaking.push(speaks);
                } else {
                    decisions.push(decision(member, false, 'spoke-recently'));
                }
            }
        }

        return finish(members, decisions, speaking, strategy, enabled, random);
    }

    // Natural order: mentions, then a talkativeness roll for everyone else.
    const mentions = input
        ? findMentions(input, enabled.map((member) => ({ avatar: member.avatar, name: member.name })))
        : new Map<string, Mention>();

    const eligible = enabled.filter((member) => {
        if (member.avatar === lastSpeaker) {
            decisions.push(decision(member, false, 'back-to-back'));
            return false;
        }
        return true;
    });

    // Two passes, so a named member replies first — and in the order they were
    // named, not the order they happen to sit in the member list.
    const named = eligible
        .filter((member) => mentions.has(member.avatar))
        .sort((a, b) => (mentions.get(a.avatar)!.at - mentions.get(b.avatar)!.at));

    for (const member of named) {
        const speaks = decision(member, true, 'mentioned', {
            order: speaking.length,
            matched: mentions.get(member.avatar)!.matched,
        });
        decisions.push(speaks);
        speaking.push(speaks);
    }

    // Everyone else, in the group's own list order. The rolls are taken in
    // that order too, so a turn replays from the same sequence.
    for (const member of eligible) {
        if (mentions.has(member.avatar)) {
            continue;
        }
        const talkativeness = talkativenessOf(member);
        const roll = random();
        if (talkativeness >= roll) {
            const speaks = decision(member, true, 'talkative', {
                order: speaking.length,
                roll,
                talkativeness,
            });
            decisions.push(speaks);
            speaking.push(speaks);
        } else {
            decisions.push(decision(member, false, 'quiet', { roll, talkativeness }));
        }
    }

    return finish(members, decisions, speaking, strategy, enabled, random);
}

/**
 * Guarantees somebody speaks, unless there is nobody who could.
 *
 * A turn where every roll failed would otherwise leave the user's message
 * hanging with no reply and no explanation.
 */
function finish(
    members: Character[],
    decisions: MemberDecision[],
    speaking: MemberDecision[],
    strategy: ActivationStrategy,
    enabled: Character[],
    random: () => number,
): TurnPlan {
    if (speaking.length > 0 || enabled.length === 0) {
        return { speakers: speaking, decisions: inOrder(members, decisions), strategy };
    }

    // Prefer someone who is at least willing to talk.
    const willing = enabled.filter((member) => talkativenessOf(member) > 0);
    const pool = willing.length > 0 ? willing : enabled;
    const picked = pool[Math.floor(random() * pool.length)] ?? pool[0]!;

    const replaced = decisions.findIndex((entry) => entry.avatar === picked.avatar);
    const fallback: MemberDecision = {
        ...decision(picked, true, 'fallback', { order: 0 }),
        // Keep the roll that failed: "nobody was willing, so this one was
        // picked" is more useful than losing the numbers.
        ...(replaced >= 0
            ? { roll: decisions[replaced]?.roll, talkativeness: decisions[replaced]?.talkativeness }
            : {}),
    };
    if (replaced >= 0) {
        decisions[replaced] = fallback;
    } else {
        decisions.push(fallback);
    }
    speaking.push(fallback);

    return { speakers: speaking, decisions: inOrder(members, decisions), strategy };
}

/** Returns the decisions in the group's own member order, for a stable trace. */
function inOrder(members: Character[], decisions: MemberDecision[]): MemberDecision[] {
    const byAvatar = new Map(decisions.map((entry) => [entry.avatar, entry]));
    const ordered: MemberDecision[] = [];
    for (const member of members) {
        const entry = byAvatar.get(member.avatar);
        if (entry) {
            ordered.push(entry);
        }
    }
    return ordered;
}

/** Plain-language summary of a decision, for the trace. */
export function explainDecision(entry: MemberDecision): string {
    switch (entry.reason) {
        case 'mentioned':
            return `Named in the message${entry.matched && entry.matched !== entry.name ? ` (“${entry.matched}”)` : ''}.`;
        case 'talkative':
            return `Rolled ${entry.roll?.toFixed(2)} against a talkativeness of ${entry.talkativeness?.toFixed(2)}.`;
        case 'quiet':
            return `Rolled ${entry.roll?.toFixed(2)}, above their talkativeness of ${entry.talkativeness?.toFixed(2)}.`;
        case 'listed':
            return 'Every enabled member replies, in list order.';
        case 'pooled':
            return 'Had not spoken since your last message.';
        case 'spoke-recently':
            return 'Already spoke since your last message.';
        case 'back-to-back':
            return 'Spoke last, and this group does not let a member reply to themselves.';
        case 'disabled':
            return 'Switched off in this group.';
        case 'not-asked':
            return 'This group only replies when you pick someone.';
        case 'not-chosen':
            return 'You picked another member for this turn.';
        case 'fallback':
            return 'Nobody won a roll, so one member was picked to answer.';
        case 'chosen':
            return 'You asked for this member.';
        default:
            return '';
    }
}
