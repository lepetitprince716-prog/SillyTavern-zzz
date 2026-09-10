import { ArrowDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import type { ChatSession } from './useChatSession';
import { MessageBubble } from './MessageBubble';

/**
 * How many messages to render initially. Long histories mount a bounded window
 * and grow on demand — cheaper than virtualising, and it keeps browser
 * find-in-page, text selection across messages and scroll anchoring intact.
 */
const INITIAL_WINDOW = 120;
const WINDOW_STEP = 200;

/** Distance from the bottom, in pixels, still counted as "at the bottom". */
const STICK_THRESHOLD = 140;

export interface MessageListProps {
    /**
     * The parent keys this component by chat, so per-chat view state (window
     * size, stick-to-bottom) resets on switch without an effect.
     */
    session: ChatSession;
    characterAvatar: string;
    personaAvatar: string | null;
    characterName: string;
}

export function MessageList({
    session,
    characterAvatar,
    personaAvatar,
    characterName,
}: MessageListProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);
    const [atBottom, setAtBottom] = useState(true);
    const { messages, streaming, isGenerating } = session;

    const hiddenCount = Math.max(0, messages.length - windowSize);
    const visible = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        element.scrollTo({ top: element.scrollHeight, behavior });
    }, []);

    const handleScroll = useCallback(() => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
        setAtBottom(distance < STICK_THRESHOLD);
    }, []);

    // Follow new content only while the reader is already at the bottom, so
    // scrolling up to re-read is never yanked back down mid-stream.
    useLayoutEffect(() => {
        if (atBottom) {
            scrollToBottom(streaming ? 'auto' : 'smooth');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, streaming?.text, atBottom, scrollToBottom]);

    // Land at the newest message on first paint of a chat.
    useEffect(() => {
        const frame = requestAnimationFrame(() => scrollToBottom('auto'));
        return () => cancelAnimationFrame(frame);
    }, [scrollToBottom]);

    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    const canSwipeLast = Boolean(last && !last.is_user && !isGenerating);
    // A streaming swipe overwrites the last message in place; a streaming
    // append renders as an extra provisional bubble after it.
    const streamingInPlace = streaming?.isSwipe === true;

    return (
        <div className="relative min-h-0 flex-1">
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-label={`Conversation with ${characterName}`}
            >
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-[var(--density-gap)] px-3 py-6 sm:px-4">
                    {hiddenCount > 0 ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="mx-auto"
                            onClick={() => setWindowSize((size) => size + WINDOW_STEP)}
                        >
                            <ChevronUp className="size-3.5" />
                            Load {Math.min(hiddenCount, WINDOW_STEP)} earlier messages
                        </Button>
                    ) : null}

                    {visible.map((message, offset) => {
                        const index = hiddenCount + offset;
                        const isLast = index === lastIndex;
                        const streamProps =
                            isLast && streamingInPlace && streaming
                                ? { streamingText: streaming.text, streamingReasoning: streaming.reasoning }
                                : {};
                        return (
                            <div
                                key={`${index}-${message.send_date ?? ''}`}
                                // Skip layout and paint for messages scrolled far
                                // out of view without removing them from the DOM.
                                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 180px' }}
                            >
                                <MessageBubble
                                    message={message}
                                    index={index}
                                    characterAvatar={characterAvatar}
                                    personaAvatar={personaAvatar}
                                    isLast={isLast}
                                    onEdit={session.editMessage}
                                    onDelete={session.deleteMessage}
                                    onTruncate={session.truncateFrom}
                                    {...(isLast && canSwipeLast ? { onRegenerate: session.regenerate } : {})}
                                    {...(isLast ? { onSwipe: session.swipe, canSwipe: canSwipeLast } : {})}
                                    {...streamProps}
                                />
                            </div>
                        );
                    })}

                    {streaming && !streamingInPlace ? (
                        <MessageBubble
                            message={{
                                name: characterName,
                                is_user: false,
                                mes: '',
                                send_date: undefined,
                                ...(streaming.reasoning ? { extra: { reasoning: streaming.reasoning } } : {}),
                            }}
                            index={-1}
                            characterAvatar={characterAvatar}
                            personaAvatar={personaAvatar}
                            isLast
                            streamingText={streaming.text}
                            streamingReasoning={streaming.reasoning}
                            onEdit={() => undefined}
                            onDelete={() => undefined}
                            onTruncate={() => undefined}
                        />
                    ) : null}

                    {isGenerating && !streaming ? (
                        <p className="px-4 text-xs text-subtle" role="status">
                            Waiting for the model…
                        </p>
                    ) : null}
                </div>
            </div>

            <div
                className={cn(
                    'pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 transition-opacity duration-200',
                    atBottom ? 'opacity-0' : 'opacity-100',
                )}
            >
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => scrollToBottom()}
                    className={cn('shadow-pop', !atBottom && 'pointer-events-auto')}
                    tabIndex={atBottom ? -1 : 0}
                >
                    <ArrowDown className="size-3.5" />
                    Jump to latest
                </Button>
            </div>
        </div>
    );
}
