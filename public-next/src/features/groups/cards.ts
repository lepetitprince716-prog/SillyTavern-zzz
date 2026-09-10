/**
 * Turning a group's members into the character the prompt describes.
 *
 * There are two ways a group can be presented to a model, and they are not
 * variants of one thing:
 *
 * - **Swap**: one member's card per reply. The model plays a single character
 *   who happens to be in a room with others, and the others exist only as
 *   chat history. Cheap, and each reply is in character.
 * - **Join**: every member's card in one prompt. The model plays whoever it is
 *   asked to, with all the cast in front of it. Expensive, but a member can
 *   react to what another's card says about them.
 *
 * Join has a trap in the classic implementation: the wrappers it puts around
 * each member's block, `generation_mode_join_prefix` and `_suffix`, default to
 * empty strings. So the joined description is every member's description
 * concatenated with newlines and no attribution at all — three paragraphs
 * about three different people, and nothing telling the model which is which.
 * The defaults here attribute each block; an explicit setting in the group
 * file still wins.
 */

import type { Character } from '@/api/types';

/**
 * Default wrappers for a joined block.
 *
 * `<FIELDNAME>` and `{{char}}` are the classic UI's own placeholders, so a
 * user who already set these in the other interface gets what they wrote.
 */
export const DEFAULT_JOIN_PREFIX = '{{char}}\'s <FIELDNAME>:\n';
export const DEFAULT_JOIN_SUFFIX = '\n';

/** Reads a V2 field, preferring the `data` block. */
function cardField(
    character: Character,
    field: 'description' | 'personality' | 'scenario' | 'mes_example',
): string {
    return (character.data?.[field] ?? character[field] ?? '').trim();
}

export interface JoinOptions {
    /** Wrapper before each member's block. Empty string means "no wrapper". */
    prefix?: string;
    suffix?: string;
}

function wrap(
    value: string,
    characterName: string,
    fieldName: string,
    options: JoinOptions,
): string {
    if (!value) {
        return '';
    }
    // `undefined` means "use the default"; an empty string is a deliberate
    // choice to add nothing, and is respected.
    const prefix = options.prefix ?? DEFAULT_JOIN_PREFIX;
    const suffix = options.suffix ?? DEFAULT_JOIN_SUFFIX;
    const substitute = (text: string) => text
        .replace(/<FIELDNAME>/gi, fieldName)
        .replace(/\{\{char\}\}/gi, characterName);
    return `${substitute(prefix)}${value}${substitute(suffix)}`;
}

/** The four fields a joined group card carries. */
export interface JoinedCard {
    description: string;
    personality: string;
    scenario: string;
    mesExample: string;
}

/**
 * Joins the members' cards into one.
 *
 * @param members The members to include, in order.
 * @param options Wrappers for each block.
 */
export function joinMemberCards(members: Character[], options: JoinOptions = {}): JoinedCard {
    const collect = (
        fieldName: string,
        field: 'description' | 'personality' | 'scenario' | 'mes_example',
    ) => members
        .map((member) => wrap(cardField(member, field), member.name, fieldName, options))
        .filter(Boolean)
        .join('\n');

    return {
        description: collect('description', 'description'),
        personality: collect('personality', 'personality'),
        scenario: collect('scenario', 'scenario'),
        mesExample: collect('example dialogue', 'mes_example'),
    };
}

/**
 * Builds the character the prompt should describe for this turn.
 *
 * Returning a `Character` rather than a bag of strings is deliberate: the
 * prompt builders already know how to turn a card into a prompt, for both the
 * chat-completion and the text-completion path. A group is then just a
 * different way of arriving at a card, and neither builder needs to know a
 * group exists.
 *
 * @param speaker The member replying. Their name is the one the model answers
 * as, in both modes.
 * @param members Every member whose card should be included. Empty for swap.
 */
export function groupCharacterFor(
    speaker: Character,
    members: Character[],
    options: JoinOptions = {},
): Character {
    if (members.length === 0) {
        return speaker;
    }

    const joined = joinMemberCards(members, options);

    return {
        ...speaker,
        // The speaker's own name and greeting survive: the model is answering
        // *as* them, whatever else it has been told about.
        data: {
            ...speaker.data,
            description: joined.description,
            personality: joined.personality,
            scenario: joined.scenario,
            mes_example: joined.mesExample,
        },
        description: joined.description,
        personality: joined.personality,
        scenario: joined.scenario,
        mes_example: joined.mesExample,
    };
}

/**
 * Which members' cards belong in the prompt.
 *
 * `swap` sends nobody's but the speaker's; `join` sends the enabled members';
 * `joinAll` sends everyone's, disabled included — which is how a group keeps a
 * character present in the fiction while stopping them from talking.
 */
export function membersForPrompt(options: {
    mode: 'swap' | 'join' | 'joinAll';
    members: Character[];
    disabled: string[];
    speaker: Character;
}): Character[] {
    const { mode, members, disabled, speaker } = options;
    if (mode === 'swap') {
        return [];
    }
    if (mode === 'joinAll') {
        return members;
    }
    const disabledSet = new Set(disabled);
    // The speaker is always included, even if disabled: they are the one
    // replying, so leaving their card out would describe everyone but them.
    return members.filter(
        (member) => !disabledSet.has(member.avatar) || member.avatar === speaker.avatar,
    );
}
