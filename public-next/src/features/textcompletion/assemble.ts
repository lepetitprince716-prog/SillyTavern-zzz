/**
 * Assembles a text-completion prompt from a chat.
 *
 * `features/chat/prompt.ts` produces the message array a chat-completions
 * endpoint takes. This is the other shape: the same material — card fields,
 * persona, world info, examples, history — poured into a context template's
 * story string and wrapped in an instruct template's turn sequences.
 *
 * The slot names are the classic UI's (`description`, `wiBefore`,
 * `anchorBefore`, …), because the templates that reference them are the same
 * files. `loreBefore` and `loreAfter` are kept as aliases for `wiBefore` and
 * `wiAfter` for the same reason.
 */

import type { Character, ChatMessage } from '@/api/types';
import { activeMessageText, selectHistory, splitExamples } from '@/features/chat/prompt';
import { WI_POSITION, type WiPosition } from '@/api/worldinfo';
import type { ActivationResult } from '@/features/worldinfo/engine';
import { substituteMacros, type MacroContext } from '@/lib/macros';
import type { PromptSettings } from '@/store/session';
import {
    buildTextPrompt,
    turnFromMessage,
    type ContextTemplate,
    type InstructTemplate,
    type PromptTurn,
    type StoryValues,
    type TextPrompt,
} from './templates';

/** Reads a V2 field, preferring the `data` block. */
function cardField(character: Character, field: 'description' | 'personality' | 'scenario' | 'mes_example'): string {
    return character.data?.[field] ?? character[field] ?? '';
}

export interface AssembleOptions {
    character: Character;
    /** Chat history, oldest first. */
    messages: ChatMessage[];
    userName: string;
    personaDescription?: string;
    settings: PromptSettings;
    worldInfo?: ActivationResult;
    instruct: InstructTemplate;
    context: ContextTemplate;
    instructEnabled: boolean;
    customStops?: string[];
}

/**
 * Builds the prompt and its stop strings.
 *
 * World info lands in the story string's `wiBefore` and `wiAfter` slots rather
 * than in extra turns: a text-completion prompt has no system role to put it
 * in, and the templates already reserve those two positions for it.
 */
export function assembleTextPrompt(options: AssembleOptions): TextPrompt {
    const { character, instruct, context, instructEnabled } = options;

    const macros: MacroContext = {
        char: character.name,
        user: options.userName,
        description: cardField(character, 'description'),
        personality: cardField(character, 'personality'),
        scenario: cardField(character, 'scenario'),
        persona: options.personaDescription ?? '',
        mesExamples: cardField(character, 'mes_example'),
    };
    const substitute = (text: string) => substituteMacros(text, macros);

    const blocks = options.worldInfo?.blocks;
    const lore = (position: WiPosition): string =>
        substitute(blocks?.get(position)?.trim() ?? '');

    const cardSystemPrompt = character.data?.system_prompt?.trim();
    const system = substitute((cardSystemPrompt || options.settings.systemPrompt).trim());

    const wiBefore = lore(WI_POSITION.beforeCharacter);
    const wiAfter = lore(WI_POSITION.afterCharacter);

    const story: Partial<StoryValues> = {
        system,
        description: substitute(cardField(character, 'description').trim()),
        personality: substitute(cardField(character, 'personality').trim()),
        scenario: substitute(cardField(character, 'scenario').trim()),
        persona: substitute((options.personaDescription ?? '').trim()),
        wiBefore,
        wiAfter,
        // Aliases a custom template may use instead.
        loreBefore: wiBefore,
        loreAfter: wiAfter,
        anchorBefore: lore(WI_POSITION.exampleMessagesTop),
        anchorAfter: lore(WI_POSITION.exampleMessagesBottom),
        char: character.name,
        user: options.userName,
    };

    const examples = options.settings.includeExamples && !instruct.skip_examples
        ? splitExamples(cardField(character, 'mes_example')).map((block) => substitute(block))
        : [];

    const history = selectHistory(options.messages, options.settings.historyDepth);
    const depthBlocks = options.worldInfo?.depthBlocks;
    const turns: PromptTurn[] = [];

    history.forEach((message, index) => {
        // `atDepth` counts back from the end, matching the chat-completion path.
        const depth = history.length - index;
        const atDepth = depthBlocks?.get(depth)?.trim();
        if (atDepth) {
            turns.push({ role: 'system', name: '', content: substitute(atDepth) });
        }
        const content = substitute(activeMessageText(message)).trim();
        if (content) {
            turns.push(turnFromMessage(message, content));
        }
    });

    const atEnd = depthBlocks?.get(0)?.trim();
    if (atEnd) {
        turns.push({ role: 'system', name: '', content: substitute(atEnd) });
    }

    // The author's-note positions have no note to anchor to yet, so their
    // content goes where a note would: after the history.
    for (const position of [WI_POSITION.authorNoteTop, WI_POSITION.authorNoteBottom] as const) {
        const block = lore(position);
        if (block) {
            turns.push({ role: 'system', name: '', content: block });
        }
    }

    // The closing instruction and the card's post-history block are the last
    // thing the model sees before its own turn, which is the point of them.
    const jailbreak = substitute(options.settings.jailbreak.trim());
    if (jailbreak) {
        turns.push({ role: 'system', name: '', content: jailbreak });
    }
    const postHistory = character.data?.post_history_instructions?.trim();
    if (postHistory) {
        turns.push({ role: 'system', name: '', content: substitute(postHistory) });
    }

    return buildTextPrompt({
        instructEnabled,
        instruct,
        context,
        story,
        examples,
        turns,
        userName: options.userName,
        charName: character.name,
        ...(options.customStops ? { customStops: options.customStops } : {}),
    });
}
