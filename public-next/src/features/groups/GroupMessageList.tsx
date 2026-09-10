/**
 * The message list for a group chat.
 *
 * Wraps the single-character list rather than reimplementing it: the bounded
 * render window, the stick-to-bottom behaviour, markdown, images and inline
 * editing are all the same, and a second copy would drift. What a group adds
 * is that each message's avatar comes from the member who said it rather than
 * from one character.
 */

import { ArrowDown } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { MessageBubble } from '@/features/chat/MessageBubble';
import { useSessionStore } from '@/store/session';
import type { GroupSession } from './useGroupSession';

/** Same window as a single-character chat, for the same reasons. */
const INITIAL_WINDOW = 120;
const WINDOW_STEP = 200;
const STICK_THRESHOLD = 140;

export function GroupMessageList({
    session,
    groupName,
}: {
    session: GroupSession;
    groupName: string;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);
    const [atBottom, setAtBottom] = useState(true);
    const personaAvatar = useSessionStore((state) => state.personaAvatar);
    const { messages, streaming, isGenerating } = session;

    const hiddenCount = Math.max(0, messages.length - windowSize);
    const visible = hiddenCount > 0 ? messages.slice(hiddenCount) : messages;

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior });
    }, []);

    const handleScroll = useCallback(() => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
        setAtBottom(distance < STICK_THRESHOLD);
    }, []);

    useLayoutEffect(() => {
        if (atBottom) {
            scrollToBottom(streaming ? 'auto' : 'smooth');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages.length, streaming?.text, atBottom, scrollToBottom]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => scrollToBottom('auto'));
        return () => cancelAnimationFrame(frame);
    }, [scrollToBottom]);

    const lastIndex = messages.length - 1;

    return (
        <div className="relative min-h-0 flex-1">
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
                role="log"
                aria-live="polite"
                aria-relevant="additions text"
                aria-label={`Conversation with ${groupName}`}
            >
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-[var(--density-gap)] px-3 py-6 sm:px-4">
                    {hiddenCount > 0 ? (
                        <Button
                            variant="secondary"
                            size="sm"
                            className="mx-auto"
                            onClick={() => setWindowSize((size) => size + WINDOW_STEP)}
                        >
                            Load {Math.min(hiddenCount, WINDOW_STEP)} earlier messages
                        </Button>
                    ) : null}

                    {visible.map((message, offset) => {
                        const index = hiddenCount + offset;
                        return (
                            <div
                                key={`${index}-${message.send_date ?? ''}`}
                                style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 180px' }}
                            >
                                <MessageBubble
                                    message={message}
                                    index={index}
                                    // The speaker's own avatar, not the group's:
                                    // in a group the avatar is how the reader
                                    // tells who is talking.
                                    characterAvatar={message.original_avatar ?? ''}
                                    personaAvatar={personaAvatar}
                                    isLast={index === lastIndex}
                                    onEdit={session.editMessage}
                                    onDelete={session.deleteMessage}
                                    onTruncate={session.truncateFrom}
                                    {...(index === lastIndex && !message.is_user && !isGenerating
                                        ? { onRegenerate: session.regenerate }
                                        : {})}
                                />
                            </div>
                        );
                    })}

                    {streaming ? (
                        <MessageBubble
                            message={{
                                name: session.speakingNow ?? groupName,
                                is_user: false,
                                mes: '',
                                ...(session.speakingNow
                                    ? {
                                        original_avatar: session.members.find(
                                            (member) => member.name === session.speakingNow,
                                        )?.avatar,
                                    }
                                    : {}),
                            }}
                            index={-1}
                            characterAvatar={
                                session.members.find((member) => member.name === session.speakingNow)
                                    ?.avatar ?? ''
                            }
                            personaAvatar={personaAvatar}
                            isLast
                            streamingText={streaming.text}
                            streamingReasoning={streaming.reasoning}
                            onEdit={() => undefined}
                            onDelete={() => undefined}
                            onTruncate={() => undefined}
                        />
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
