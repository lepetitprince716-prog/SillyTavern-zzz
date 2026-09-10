/**
 * Instruct and context templates, read from the server.
 *
 * `POST /api/settings/get` already returns both sets parsed — the same files
 * the classic UI edits — so there is nothing to add server-side and a template
 * changed there applies here on the next load.
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { fetchSettings } from '@/api/settings';
import {
    normalizeContext,
    normalizeInstruct,
    type ContextTemplate,
    type InstructTemplate,
} from './templates';

interface TemplateSets {
    instruct: InstructTemplate[];
    context: ContextTemplate[];
}

/**
 * A minimal instruct template, for the case where the server returns none.
 *
 * Plain `### Instruction:` / `### Response:` works with most instruction-tuned
 * models and is recognisable, which beats an empty picker.
 */
export const FALLBACK_INSTRUCT: InstructTemplate = normalizeInstruct({
    name: 'Alpaca',
    input_sequence: '### Instruction:',
    output_sequence: '### Response:',
    system_sequence: '',
    stop_sequence: '',
    input_suffix: '\n',
    output_suffix: '\n',
    system_suffix: '\n',
    wrap: true,
    macro: true,
    names_behavior: 'none',
    sequences_as_stop_strings: true,
});

export const FALLBACK_CONTEXT: ContextTemplate = normalizeContext({
    name: 'Default',
    story_string: '{{#if system}}{{system}}\n{{/if}}{{#if wiBefore}}{{wiBefore}}\n{{/if}}'
        + '{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{personality}}\n{{/if}}'
        + '{{#if scenario}}{{scenario}}\n{{/if}}{{#if wiAfter}}{{wiAfter}}\n{{/if}}'
        + '{{#if persona}}{{persona}}\n{{/if}}{{trim}}',
    example_separator: '',
    chat_start: '',
    names_as_stop_strings: true,
});

export function useTemplates() {
    const query = useQuery({
        queryKey: ['settings-templates'],
        queryFn: () => fetchSettings(),
        // The template files change rarely, and only from the other interface.
        staleTime: 5 * 60_000,
    });

    const sets = useMemo<TemplateSets>(() => {
        const data = query.data as { instruct?: unknown[]; context?: unknown[] } | undefined;
        const instruct = (data?.instruct ?? [])
            .map(normalizeInstruct)
            .sort((a, b) => a.name.localeCompare(b.name));
        const context = (data?.context ?? [])
            .map(normalizeContext)
            .sort((a, b) => a.name.localeCompare(b.name));
        return {
            instruct: instruct.length > 0 ? instruct : [FALLBACK_INSTRUCT],
            context: context.length > 0 ? context : [FALLBACK_CONTEXT],
        };
    }, [query.data]);

    /**
     * Resolves a saved name, falling back rather than generating nothing.
     *
     * Memoised because the chat session lists these among a `useCallback`'s
     * dependencies: a fresh closure each render would make the generation
     * handler unstable and defeat the memoisation on every message bubble.
     */
    const resolveInstruct = useCallback(
        (name: string): InstructTemplate =>
            sets.instruct.find((template) => template.name === name)
                ?? sets.instruct[0]
                ?? FALLBACK_INSTRUCT,
        [sets.instruct],
    );

    const resolveContext = useCallback(
        (name: string): ContextTemplate =>
            sets.context.find((template) => template.name === name)
                ?? sets.context[0]
                ?? FALLBACK_CONTEXT,
        [sets.context],
    );

    return { ...sets, isLoading: query.isPending, resolveInstruct, resolveContext };
}
