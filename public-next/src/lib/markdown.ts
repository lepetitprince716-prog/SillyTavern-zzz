/**
 * Message rendering: markdown in, sanitised HTML out.
 *
 * Model output is untrusted, and so are character cards downloaded from the
 * internet, so every string that reaches the DOM passes through DOMPurify. The
 * markdown step is deliberately configured for chat: GFM on, single newlines
 * become line breaks, and no heading-id generation.
 */

import DOMPurify from 'dompurify';
import { Marked } from 'marked';

const marked = new Marked({
    gfm: true,
    breaks: true,
    async: false,
    silent: true,
});

/**
 * Regions that quote highlighting must not touch: fenced blocks, inline code,
 * and HTML tags — rewriting a quoted attribute would break the tag and get it
 * escaped into visible text.
 */
const PROTECTED_REGIONS = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|<\/?[a-zA-Z][^>\n]*>)/g;

/** A run of quoted speech on a single line. */
const QUOTED_SPEECH = /(["“])([^"”\n]{1,600})(["”])/g;

/**
 * Wraps quoted speech so it can be styled apart from narration — the standard
 * roleplay reading convention. Code and HTML tags are skipped so that string
 * literals in a snippet and quoted attributes are left intact.
 */
export function markQuotedSpeech(markdown: string): string {
    return markdown
        .split(PROTECTED_REGIONS)
        .map((segment, index) =>
            // split() with a capturing group puts the delimiters at odd indices.
            index % 2 === 1
                ? segment
                : segment.replace(QUOTED_SPEECH, '<span class="quoted">$1$2$3</span>'),
        )
        .join('');
}

const THINK_BLOCK = /<(think|thinking|reasoning)>([\s\S]*?)(?:<\/\1>|$)/gi;

/**
 * Pulls inline `<think>` blocks out of model output.
 *
 * Several models emit reasoning inline rather than on a separate stream field.
 * @returns The visible content and any reasoning found, both trimmed.
 */
export function splitReasoning(text: string): { content: string; reasoning: string } {
    if (!text.includes('<')) {
        return { content: text, reasoning: '' };
    }
    const found: string[] = [];
    const content = text.replace(THINK_BLOCK, (_match, _tag: string, inner: string) => {
        found.push(inner.trim());
        return '';
    });
    return { content: content.trim(), reasoning: found.join('\n\n').trim() };
}

let hooksInstalled = false;

/** Makes every link open safely in a new tab. */
function installHooks(): void {
    if (hooksInstalled || typeof DOMPurify.addHook !== 'function') {
        return;
    }
    DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node instanceof HTMLElement && node.tagName === 'A' && node.hasAttribute('href')) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noreferrer noopener');
        }
    });
    hooksInstalled = true;
}

/**
 * Left unannotated on purpose: the inferred shape (mutable arrays, no
 * `RETURN_DOM*` keys) selects DOMPurify's string-returning overload.
 */
const SANITIZE_CONFIG = {
    ADD_ATTR: ['target'],
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset'],
};

export interface RenderOptions {
    /** Style quoted speech distinctly. Defaults to true. */
    highlightQuotes?: boolean;
}

/**
 * Renders a chat message to sanitised HTML.
 *
 * Safe to call on partial text mid-stream: unbalanced markdown degrades to
 * plain text rather than throwing.
 */
export function renderMessage(markdown: string, options: RenderOptions = {}): string {
    if (!markdown) {
        return '';
    }
    installHooks();

    const source = options.highlightQuotes === false ? markdown : markQuotedSpeech(markdown);
    let html: string;
    try {
        html = marked.parse(source) as string;
    } catch {
        // Fall back to escaped plain text so a malformed token never blanks the
        // message the user is reading.
        html = source.replace(/[&<>]/g, (character) =>
            character === '&' ? '&amp;' : character === '<' ? '&lt;' : '&gt;',
        );
    }

    return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}
