/**
 * Prompt assembly.
 *
 * Turns a character card, a persona and a chat history into the message array
 * sent to the completion endpoint. Kept free of React and of network access so
 * it can be unit tested directly.
 *
 * This models the core of SillyTavern's prompt: system block, optional example
 * dialogue, chat history, and a trailing instruction block. World info,
 * author's notes and prompt-manager ordering are not handled here.
 */

import { cardField } from '@/api/characters';
import type { Character, ChatMessage, PromptMessage } from '@/api/types';
import { substituteMacros, tidy, type MacroContext } from '@/lib/macros';
import type { PromptSettings } from '@/store/session';

export interface BuildPromptOptions {
    character: Character;
    /** Chat history, oldest first. */
    messages: ChatMessage[];
    /** Persona name, used for `{{user}}`. */
    userName: string;
    personaDescription?: string;
    settings: PromptSettings;
    /** Deterministic randomness for macros, for tests. */
    random?: () => number;
}

/** The text currently shown for a message, honouring the selected swipe. */
export function activeMessageText(message: ChatMessage): string {
    const swipes = message.swipes;
    const index = message.swipe_id ?? 0;
    if (Array.isArray(swipes) && swipes.length > 0) {
        return swipes[index] ?? swipes[0] ?? message.mes ?? '';
    }
    return message.mes ?? '';
}

/** Example dialogue split into blocks on the `<START>` separator. */
export function splitExamples(mesExample: string): string[] {
    if (!mesExample.trim()) {
        return [];
    }
    return mesExample
        .split(/<START>/i)
        .map((block) => block.trim())
        .filter((block) => block.length > 0);
}

function macroContext(options: BuildPromptOptions): MacroContext {
    const { character } = options;
    const context: MacroContext = {
        char: character.name,
        user: options.userName,
        description: cardField(character, 'description'),
        personality: cardField(character, 'personality'),
        scenario: cardField(character, 'scenario'),
        persona: options.personaDescription ?? '',
        mesExamples: cardField(character, 'mes_example'),
    };
    if (options.random) {
        context.random = options.random;
    }
    return context;
}

/**
 * Builds the system block: instruction, character definition, persona.
 *
 * A card's own `system_prompt` overrides the user's default, matching the
 * behaviour character authors expect from the V2 spec.
 */
function buildSystemBlock(options: BuildPromptOptions, context: MacroContext): string {
    const { character, settings } = options;
    const sections: string[] = [];

    const cardSystemPrompt = character.data?.system_prompt?.trim();
    const instruction = cardSystemPrompt || settings.systemPrompt;
    if (instruction.trim()) {
        sections.push(substituteMacros(instruction, context));
    }

    const description = cardField(character, 'description').trim();
    if (description) {
        sections.push(`${character.name}'s description:\n${substituteMacros(description, context)}`);
    }

    const personality = cardField(character, 'personality').trim();
    if (personality) {
        sections.push(`${character.name}'s personality:\n${substituteMacros(personality, context)}`);
    }

    const scenario = cardField(character, 'scenario').trim();
    if (scenario) {
        sections.push(`Scenario:\n${substituteMacros(scenario, context)}`);
    }

    const persona = (options.personaDescription ?? '').trim();
    if (persona) {
        sections.push(`${options.userName}'s persona:\n${substituteMacros(persona, context)}`);
    }

    return tidy(sections.join('\n\n'));
}

/**
 * Selects the slice of history to send.
 * `historyDepth` of 0 means "everything"; otherwise the most recent N messages.
 */
export function selectHistory(messages: ChatMessage[], historyDepth: number): ChatMessage[] {
    const visible = messages.filter((message) => !message.is_system);
    if (historyDepth > 0 && visible.length > historyDepth) {
        return visible.slice(-historyDepth);
    }
    return visible;
}

/**
 * Assembles the full prompt.
 * @returns Messages ready to POST to the completion endpoint.
 */
export function buildPrompt(options: BuildPromptOptions): PromptMessage[] {
    const context = macroContext(options);
    const prompt: PromptMessage[] = [];

    const system = buildSystemBlock(options, context);
    if (system) {
        prompt.push({ role: 'system', content: system });
    }

    if (options.settings.includeExamples) {
        const examples = splitExamples(cardField(options.character, 'mes_example'));
        if (examples.length > 0) {
            const rendered = examples
                .map((block) => substituteMacros(block, context))
                .join('\n\n');
            prompt.push({
                role: 'system',
                content: `Example conversations between ${options.character.name} and ${options.userName}:\n\n${rendered}`,
            });
        }
    }

    for (const message of selectHistory(options.messages, options.settings.historyDepth)) {
        const content = substituteMacros(activeMessageText(message), context).trim();
        if (!content) {
            continue;
        }
        prompt.push({ role: message.is_user ? 'user' : 'assistant', content });
    }

    const jailbreak = options.settings.jailbreak.trim();
    if (jailbreak) {
        prompt.push({ role: 'system', content: substituteMacros(jailbreak, context) });
    }

    const postHistory = options.character.data?.post_history_instructions?.trim();
    if (postHistory) {
        prompt.push({ role: 'system', content: substituteMacros(postHistory, context) });
    }

    return prompt;
}

/** Rough character count of a prompt, for the context meter. */
export function promptSize(prompt: PromptMessage[]): number {
    return prompt.reduce((total, message) => total + message.content.length, 0);
}
