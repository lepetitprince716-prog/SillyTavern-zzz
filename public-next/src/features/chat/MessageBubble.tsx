import {
    Brain,
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    MoreHorizontal,
    Pencil,
    RefreshCw,
    Scissors,
    Trash2,
} from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { avatarUrl, personaAvatarUrl } from '@/api/characters';
import type { ChatMessage } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import {
    Menu,
    MenuContent,
    MenuItem,
    MenuSeparator,
    MenuTrigger,
    Tooltip,
} from '@/components/ui/overlays';
import { Badge, Button, IconButton, Textarea } from '@/components/ui/primitives';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { absoluteTime, compactNumber, estimateTokens, relativeTime } from '@/lib/format';
import { renderMessage } from '@/lib/markdown';
import { useUiStore } from '@/store/ui';

export interface MessageBubbleProps {
    message: ChatMessage;
    index: number;
    /** Avatar file of the character, for the assistant side. */
    characterAvatar: string;
    /** Avatar file of the active persona, for the user side. */
    personaAvatar: string | null;
    isLast: boolean;
    /** Text currently streaming into this message, if any. */
    streamingText?: string;
    streamingReasoning?: string;
    onEdit(index: number, text: string): void;
    onDelete(index: number): void;
    onTruncate(index: number): void;
    onRegenerate?(): void;
    onSwipe?(delta: 1 | -1): void;
    canSwipe?: boolean;
}

/** Collapsible chain-of-thought block. */
function ReasoningBlock({ reasoning, streaming }: { reasoning: string; streaming: boolean }) {
    const [open, setOpen] = useState(false);

    return (
        <div className="mb-2.5 overflow-hidden rounded-lg border border-border bg-surface-2/70">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted transition-colors hover:text-text"
            >
                <Brain className={cn('size-3.5 shrink-0', streaming && 'animate-pulse text-accent')} />
                <span className="font-medium">{streaming ? 'Thinking…' : 'Reasoning'}</span>
                <span className="ml-auto tabular-nums text-subtle">
                    {compactNumber(estimateTokens(reasoning))} tok
                </span>
                <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            </button>
            {open ? (
                <p className="whitespace-pre-wrap border-t border-border px-3 py-2.5 font-mono text-[0.6875rem] leading-relaxed text-muted">
                    {reasoning}
                </p>
            ) : null}
        </div>
    );
}

/** Inline editor shown in place of the message body. */
function MessageEditor({
    initial,
    onSave,
    onCancel,
}: {
    initial: string;
    onSave(text: string): void;
    onCancel(): void;
}) {
    const [draft, setDraft] = useState(initial);
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
        // Grow to fit the existing text so the whole message is visible.
        element.style.height = `${Math.min(element.scrollHeight, 480)}px`;
    }, []);

    return (
        <div className="space-y-2">
            <Textarea
                ref={ref}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        onCancel();
                    }
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        onSave(draft);
                    }
                }}
                className="min-h-24 font-[inherit] text-[0.9375rem] leading-relaxed"
                aria-label="Edit message"
            />
            <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" onClick={() => onSave(draft)}>
                    <Check className="size-3.5" />
                    Save
                </Button>
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <span className="ml-auto text-xs text-subtle">⌘↩ to save · Esc to cancel</span>
            </div>
        </div>
    );
}

function MessageBubbleImpl({
    message,
    index,
    characterAvatar,
    personaAvatar,
    isLast,
    streamingText,
    streamingReasoning,
    onEdit,
    onDelete,
    onTruncate,
    onRegenerate,
    onSwipe,
    canSwipe,
}: MessageBubbleProps) {
    const [editing, setEditing] = useState(false);
    const [copied, setCopied] = useState(false);
    const showTimestamps = useUiStore((state) => state.showTimestamps);
    const showTokenCounts = useUiStore((state) => state.showTokenCounts);

    const isUser = message.is_user;
    const isStreaming = streamingText !== undefined;

    const swipes = message.swipes;
    const swipeIndex = message.swipe_id ?? 0;
    const swipeCount = Array.isArray(swipes) && swipes.length > 0 ? swipes.length : 1;

    const text = isStreaming
        ? streamingText
        : Array.isArray(swipes) && swipes.length > 0
            ? (swipes[swipeIndex] ?? message.mes)
            : message.mes;

    const reasoning = isStreaming ? (streamingReasoning ?? '') : (message.extra?.reasoning ?? '');

    const html = useMemo(() => renderMessage(text ?? ''), [text]);
    const tokenCount = message.extra?.token_count ?? estimateTokens(text ?? '');

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(text ?? '');
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            toast.error('Could not copy', 'The clipboard is unavailable in this context.');
        }
    };

    return (
        <article
            className={cn('group/message relative', isUser && 'pl-0')}
            data-message-index={index}
            aria-label={`${message.name}'s message`}
        >
            <div
                className={cn(
                    'flex gap-3 rounded-card px-[var(--density-bubble-x)] py-[var(--density-bubble-y)]',
                    'transition-colors',
                    isUser ? 'bg-surface-2/70' : 'bg-transparent',
                )}
            >
                <Avatar
                    src={isUser ? personaAvatarUrl(personaAvatar ?? undefined) : avatarUrl(characterAvatar)}
                    name={message.name || (isUser ? 'You' : 'Character')}
                    size="md"
                    rounded="card"
                    className="mt-0.5"
                />

                <div className="min-w-0 flex-1">
                    <header className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[0.8125rem] font-semibold">{message.name}</span>
                        {showTimestamps && message.send_date ? (
                            <Tooltip content={absoluteTime(message.send_date)}>
                                <time className="text-[0.6875rem] text-subtle">
                                    {relativeTime(message.send_date)}
                                </time>
                            </Tooltip>
                        ) : null}
                        {showTokenCounts ? (
                            <Badge className="text-[0.625rem]">{compactNumber(tokenCount)} tok</Badge>
                        ) : null}
                        {message.extra?.model && !isUser ? (
                            <span className="truncate text-[0.6875rem] text-subtle">
                                {message.extra.model}
                            </span>
                        ) : null}
                    </header>

                    {reasoning ? <ReasoningBlock reasoning={reasoning} streaming={isStreaming} /> : null}

                    {editing ? (
                        <MessageEditor
                            initial={text ?? ''}
                            onSave={(next) => {
                                onEdit(index, next);
                                setEditing(false);
                            }}
                            onCancel={() => setEditing(false)}
                        />
                    ) : (
                        <div
                            className={cn('prose-message', isStreaming && 'streaming-caret')}
                            // Sanitised by renderMessage() before it reaches here.
                            dangerouslySetInnerHTML={{ __html: html }}
                        />
                    )}

                    {(isLast && !isUser && !isStreaming) || (swipeCount > 1 && isLast) ? (
                        <div className="mt-2.5 flex items-center gap-1">
                            {canSwipe && onSwipe ? (
                                <>
                                    <IconButton
                                        label="Previous alternative"
                                        variant="ghost"
                                        size="icon-sm"
                                        disabled={swipeIndex === 0}
                                        onClick={() => onSwipe(-1)}
                                    >
                                        <ChevronLeft className="size-4" />
                                    </IconButton>
                                    <span className="min-w-10 text-center text-[0.6875rem] tabular-nums text-subtle">
                                        {swipeIndex + 1} / {swipeCount}
                                    </span>
                                    <IconButton
                                        label="Next alternative — generates a new one at the end"
                                        variant="ghost"
                                        size="icon-sm"
                                        onClick={() => onSwipe(1)}
                                    >
                                        <ChevronRight className="size-4" />
                                    </IconButton>
                                </>
                            ) : null}
                            {onRegenerate ? (
                                <Button size="sm" variant="ghost" onClick={onRegenerate}>
                                    <RefreshCw className="size-3.5" />
                                    Regenerate
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                {!editing && !isStreaming ? (
                    <div
                        className={cn(
                            'flex shrink-0 items-start gap-0.5',
                            // Revealed on hover for pointers, always available for
                            // keyboard users via focus-within.
                            'opacity-0 transition-opacity group-hover/message:opacity-100',
                            'focus-within:opacity-100 max-sm:opacity-100',
                        )}
                    >
                        <IconButton
                            label={copied ? 'Copied' : 'Copy message'}
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void copy()}
                        >
                            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                        </IconButton>
                        <Menu>
                            <MenuTrigger asChild>
                                <IconButton label="More actions" variant="ghost" size="icon-sm">
                                    <MoreHorizontal className="size-4" />
                                </IconButton>
                            </MenuTrigger>
                            <MenuContent>
                                <MenuItem onSelect={() => setEditing(true)}>
                                    <Pencil />
                                    Edit
                                </MenuItem>
                                <MenuItem onSelect={() => onTruncate(index)}>
                                    <Scissors />
                                    Delete from here down
                                </MenuItem>
                                <MenuSeparator />
                                <MenuItem tone="danger" onSelect={() => onDelete(index)}>
                                    <Trash2 />
                                    Delete message
                                </MenuItem>
                            </MenuContent>
                        </Menu>
                    </div>
                ) : null}
            </div>
        </article>
    );
}

/**
 * Memoised: a long chat re-renders on every streamed frame otherwise, and the
 * markdown pass is the expensive part.
 */
export const MessageBubble = memo(MessageBubbleImpl);
