/**
 * Starting points for an image prompt.
 *
 * The classic extension asks the language model to write the image prompt,
 * which costs a round-trip and a token budget before anything is rendered, and
 * gives no way to see what it came up with until it has already been sent.
 * These are cheap local transforms offered as one-click fills in the prompt
 * field, so what gets rendered is whatever the user can see and edit.
 */

import type { Character, ChatMessage } from '@/api/types';
import { activeMessageText } from '@/features/chat/prompt';

/** Longest prompt these helpers will produce. */
const MAX_PROMPT_LENGTH = 480;

/**
 * Reduces prose to something a diffusion model can use.
 *
 * Markdown emphasis, headings and quotes are noise to an image model, and the
 * asterisks around narration are actively harmful — a model that has learned
 * booru-style tags reads them as emphasis weights.
 */
export function promptFromProse(text: string): string {
    const cleaned = text
        // Fenced and inline code are never scene description.
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]*`/g, ' ')
        // Markdown emphasis and headings.
        .replace(/[*_~#>]+/g, ' ')
        // Links keep their label, not their target.
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        // Straight and curly quotes around dialogue.
        .replace(/["“”„«»]/g, ' ')
        .replace(/\s+/g, ' ')
        // Removing the markers leaves a space before the punctuation that
        // followed them — `*she smiles*, then` becomes `she smiles , then`.
        // Prompts are comma-separated, so a floating comma matters.
        .replace(/\s+([,.;:!?)\]}、。，；：！？」』]) ?/g, '$1 ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleaned.length <= MAX_PROMPT_LENGTH) {
        return cleaned;
    }
    // Cut at a sentence end where possible, so the prompt is not truncated
    // mid-clause.
    const window = cleaned.slice(0, MAX_PROMPT_LENGTH);
    const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('。'));
    return (lastStop > MAX_PROMPT_LENGTH * 0.5 ? window.slice(0, lastStop + 1) : window).trim();
}

/**
 * A portrait prompt from the character card.
 *
 * The card's `description` is written for a language model, so only its
 * leading sentences are used — the rest is usually backstory that describes
 * nothing visible.
 */
export function portraitPrompt(character: Pick<Character, 'name' | 'description' | 'data'>): string {
    const description = character.data?.description ?? character.description ?? '';
    const summary = promptFromProse(description).split(/(?<=[.。])\s+/).slice(0, 3).join(' ');
    return [`portrait of ${character.name}`, summary].filter(Boolean).join(', ').slice(0, MAX_PROMPT_LENGTH);
}

export interface PromptSuggestion {
    label: string;
    prompt: string;
}

/**
 * Fills offered in the generation panel.
 *
 * @param messages The chat, oldest first.
 * @param index The message being illustrated, or -1 for a standalone render.
 */
export function promptSuggestions(
    character: Pick<Character, 'name' | 'description' | 'data'> | null,
    messages: ChatMessage[],
    index: number,
): PromptSuggestion[] {
    const suggestions: PromptSuggestion[] = [];

    const target = index >= 0 ? messages[index] : undefined;
    if (target) {
        const prompt = promptFromProse(activeMessageText(target));
        if (prompt) {
            suggestions.push({ label: 'This message', prompt });
        }
    }

    // The most recent assistant message, when it is not the one already
    // offered above.
    for (let position = messages.length - 1; position >= 0; position -= 1) {
        const message = messages[position];
        if (!message || message.is_user || position === index) {
            continue;
        }
        const prompt = promptFromProse(activeMessageText(message));
        if (prompt) {
            suggestions.push({ label: 'Latest reply', prompt });
        }
        break;
    }

    if (character) {
        const prompt = portraitPrompt(character);
        if (prompt) {
            suggestions.push({ label: `Portrait of ${character.name}`, prompt });
        }
    }

    return suggestions;
}
