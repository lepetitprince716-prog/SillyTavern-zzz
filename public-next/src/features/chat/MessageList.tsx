import { ArrowDown, ChevronUp } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MediaAttachment } from '@/api/types';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { inlineImageFor } from '@/features/images/media';
import type { PendingRender } from '@/features/images/useImageGeneration';
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
    /** Opens the generation panel seeded from a message. */
    onIllustrate?(index: number): void;
    onReuseSeed?(item: MediaAttachment): void;
    /** The render currently in flight, and how long it has been running. */
    pendingRender?: PendingRender | null;
    renderElapsedMs?: number;
    onCancelRender?(): void;
    /**
     * A message to scroll to and highlight, from the image panel.
     *
     * The nonce is what makes asking for the *same* message twice work: the
     * index alone would not change, so nothing would happen the second time.
     */
    reveal?: { index: number; nonce: number } | null;
}

export function MessageList({
    session,
    characterAvatar,
    personaAvatar,
    characterName,
    onIllustrate,
    onReuseSeed,
    pendingRender,
    renderElapsedMs = 0,
    onCancelRender,
    reveal,
}: MessageListProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);
    const [atBottom, setAtBottom] = useState(true);
    const { messages, streaming, isGenerating } = session;

    // A revealed message has to be in the DOM to be scrolled to, so the window
    // widens to include it. Derived during render rather than pushed into state
    // from an effect, which would cost a second render and a paint.
    const effectiveWindow = reveal
        ? Math.max(windowSize, messages.length - reveal.index)
        : windowSize;
    const hiddenCount = Math.max(0, messages.length - effectiveWindow);
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
    // scrolling up to re-read is never yanked back down mid-stream. A reveal
    // is an explicit jump, so it wins over sticking to the bottom.
    useLayoutEffect(() => {
        if (atBottom && !reveal) {
            scrollToBottom(streaming ? 'auto' : 'smooth');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, streaming?.text, atBottom, scrollToBottom, reveal]);

    // Land at the newest message on first paint of a chat.
    useEffect(() => {
        const frame = requestAnimationFrame(() => scrollToBottom('auto'));
        return () => cancelAnimationFrame(frame);
    }, [scrollToBottom]);

    // Scroll to a message the image panel asked for, and flash it so it is
    // obvious which one was meant.
    useEffect(() => {
        if (!reveal) {
            return;
        }

        let frame = 0;
        const find = () => scrollRef.current?.querySelector(`[data-message-index="${reveal.index}"]`);

        // One frame, so the widened window has been painted first.
        frame = requestAnimationFrame(() => {
            const element = find();
            const container = scrollRef.current;
            if (!(element instanceof HTMLElement) || !container) {
                return;
            }

            // A long jump scrolls instantly. Smooth scrolling thousands of
            // pixels is a two-second blur that shows nothing, and it does not
            // even arrive: `content-visibility: auto` means off-screen messages
            // are only *estimated* heights until they are scrolled into view,
            // so the target moves under a long animation and the scroll lands
            // in the wrong place.
            const distance = Math.abs(
                element.getBoundingClientRect().top - container.getBoundingClientRect().top,
            );
            const isNear = distance < container.clientHeight * 2;
            element.scrollIntoView({ behavior: isNear ? 'smooth' : 'auto', block: 'center' });

            element.classList.add('message-flash');
            // Removed on animation end rather than a timer, so a re-reveal
            // during the flash restarts it cleanly.
            element.addEventListener(
                'animationend',
                () => element.classList.remove('message-flash'),
                { once: true },
            );

            if (isNear) {
                return;
            }
            // One correction after the heights either side have resolved.
            frame = requestAnimationFrame(() => {
                const settled = find();
                if (settled instanceof HTMLElement) {
                    settled.scrollIntoView({ behavior: 'auto', block: 'center' });
                }
            });
        });

        return () => cancelAnimationFrame(frame);
    }, [reveal]);

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
                                    onSelectMedia={(target, position) =>
                                        session.patchExtra(target, { media_index: position })
                                    }
                                    onMediaDisplayChange={(target, display) =>
                                        session.patchExtra(target, { media_display: display })
                                    }
                                    onRemoveMedia={session.removeMedia}
                                    onMeasureMedia={session.measureMedia}
                                    onSetMediaLayout={(target, layout) =>
                                        session.patchExtra(target, {
                                            media_layout: layout,
                                            inline_image: inlineImageFor(layout),
                                        })
                                    }
                                    {...(onIllustrate ? { onIllustrate } : {})}
                                    {...(onReuseSeed ? { onReuseSeed } : {})}
                                    {...(pendingRender?.messageIndex === index
                                        ? {
                                            pending: {
                                                width: pendingRender.width,
                                                height: pendingRender.height,
                                                elapsedMs: renderElapsedMs,
                                            },
                                            ...(onCancelRender ? { onCancelRender } : {}),
                                        }
                                        : {})}
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
