import { CornerDownLeft, ImagePlus, Send, Square } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IconButton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/overlays';
import { cn } from '@/lib/cn';
import { compactNumber, estimateTokens } from '@/lib/format';
import { useUiStore } from '@/store/ui';

/** Upper bound on the composer's height before it starts scrolling. */
const MAX_HEIGHT = 320;

function draftKey(chatId: string): string {
    return `st-next:draft:${chatId}`;
}

/** Reads a saved draft. Storage can be blocked, so failure means "no draft". */
function readDraft(chatId: string): string {
    try {
        return localStorage.getItem(draftKey(chatId)) ?? '';
    } catch {
        return '';
    }
}

export interface ComposerProps {
    /**
     * Stable id for the active chat, used to scope the saved draft.
     * The parent also uses it as this component's `key`, so switching chats
     * remounts the composer with that chat's draft already in place.
     */
    chatId: string;
    disabled?: boolean;
    isGenerating: boolean;
    onSend(text: string): void;
    onStop(): void;
    placeholder?: string;
    /** Opens the image generation panel. */
    onIllustrate?(): void;
    /**
     * Why the image button cannot be used, if it cannot.
     *
     * Shown rather than hiding the button: a control that vanishes leaves the
     * user with nothing to read and nothing to fix.
     */
    illustrateBlockedReason?: string;
}

export function Composer({
    chatId,
    disabled,
    isGenerating,
    onSend,
    onStop,
    placeholder,
    onIllustrate,
    illustrateBlockedReason,
}: ComposerProps) {
    const [value, setValue] = useState(() => readDraft(chatId));
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const enterToSend = useUiStore((state) => state.enterToSend);

    // Persist the draft so navigating away mid-sentence does not lose it.
    useEffect(() => {
        try {
            if (value) {
                localStorage.setItem(draftKey(chatId), value);
            } else {
                localStorage.removeItem(draftKey(chatId));
            }
        } catch {
            // Storage can be blocked; losing a draft is not worth an error.
        }
    }, [chatId, value]);

    // Grow with the content up to MAX_HEIGHT, then scroll.
    useLayoutEffect(() => {
        const element = textareaRef.current;
        if (!element) {
            return;
        }
        element.style.height = 'auto';
        element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
    }, [value]);

    const submit = useCallback(() => {
        const text = value.trim();
        if (!text || disabled || isGenerating) {
            return;
        }
        onSend(text);
        setValue('');
        textareaRef.current?.focus();
    }, [disabled, isGenerating, onSend, value]);

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            // An IME composition session owns Enter; never intercept it.
            if (event.nativeEvent.isComposing) {
                return;
            }
            if (event.key !== 'Enter') {
                return;
            }
            const wantsSend = enterToSend ? !event.shiftKey : event.metaKey || event.ctrlKey;
            if (wantsSend) {
                event.preventDefault();
                submit();
            }
        },
        [enterToSend, submit],
    );

    const tokens = estimateTokens(value);
    const sendHint = enterToSend ? 'Enter to send · Shift+Enter for a new line' : '⌘↩ to send';

    return (
        <div className="border-t border-border bg-bg/85 backdrop-blur-md">
            <div className="mx-auto w-full max-w-3xl px-3 pb-safe pt-3 sm:px-4">
                <div
                    className={cn(
                        'flex items-end gap-2 rounded-2xl border border-border bg-surface p-2',
                        'transition-colors focus-within:border-accent',
                        'focus-within:ring-2 focus-within:ring-accent/25',
                    )}
                >
                    <textarea
                        ref={textareaRef}
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={handleKeyDown}
                        rows={1}
                        disabled={disabled}
                        placeholder={placeholder ?? 'Write a message…'}
                        aria-label="Message"
                        className={cn(
                            'max-h-80 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5',
                            'text-[0.9375rem] leading-relaxed outline-none',
                            'placeholder:text-subtle disabled:opacity-50',
                        )}
                    />

                    {onIllustrate ? (
                        <Tooltip content={illustrateBlockedReason ?? 'Generate an image'}>
                            <IconButton
                                label="Generate an image"
                                variant="ghost"
                                onClick={onIllustrate}
                                disabled={disabled || Boolean(illustrateBlockedReason)}
                            >
                                <ImagePlus className="size-4" />
                            </IconButton>
                        </Tooltip>
                    ) : null}

                    {isGenerating ? (
                        <Tooltip content="Stop generating">
                            <IconButton label="Stop generating" variant="secondary" onClick={onStop}>
                                <Square className="size-3.5 fill-current" />
                            </IconButton>
                        </Tooltip>
                    ) : (
                        <Tooltip content={sendHint}>
                            <IconButton
                                label="Send message"
                                variant="primary"
                                onClick={submit}
                                disabled={disabled || !value.trim()}
                            >
                                <Send className="size-4" />
                            </IconButton>
                        </Tooltip>
                    )}
                </div>

                <div className="flex items-center justify-between gap-3 px-2 py-1.5 text-[0.6875rem] text-subtle">
                    <span className="inline-flex items-center gap-1.5">
                        <CornerDownLeft className="size-3" />
                        {sendHint}
                    </span>
                    {tokens > 0 ? (
                        <span className="tabular-nums" title="Estimated tokens in this draft">
                            ~{compactNumber(tokens)} tok
                        </span>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
