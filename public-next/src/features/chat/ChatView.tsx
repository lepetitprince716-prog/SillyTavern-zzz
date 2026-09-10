import { MessageSquareDashed } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { newChatFileName } from '@/api/chats';
import { useCharacterChats, useCharacters } from '@/api/queries';
import { SOURCE_LABELS } from '@/api/types';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { useSessionStore } from '@/store/session';
import { useUiStore } from '@/store/ui';
import type { ImageRequest } from '@/api/images';
import type { MediaAttachment, MediaLayout } from '@/api/types';
import { CharacterInspector } from '@/features/characters/CharacterInspector';
import { ImageGenerationDialog } from '@/features/images/ImageGenerationDialog';
import { BACKENDS } from '@/features/textcompletion/backends';
import { promptSuggestions } from '@/features/images/prompts';
import { useImageGeneration } from '@/features/images/useImageGeneration';
import { ChatHeader } from './ChatHeader';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { useChatSession } from './useChatSession';

function ChatSkeleton() {
    return (
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
            {[0, 1, 2].map((row) => (
                <div key={row} className="flex gap-3">
                    <Skeleton className="size-10 rounded-[0.625rem]" />
                    <div className="flex-1 space-y-2">
                        <Skeleton className="h-3 w-28" />
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-[85%]" />
                        <Skeleton className="h-3 w-[60%]" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function ChatView({ onOpenSettings }: { onOpenSettings(): void }) {
    const params = useParams<{ avatar: string; file?: string }>();
    const navigate = useNavigate();
    const avatar = params.avatar ? decodeURIComponent(params.avatar) : null;
    const fileFromRoute = params.file ? decodeURIComponent(params.file) : null;

    const charactersQuery = useCharacters();
    const chatsQuery = useCharacterChats(avatar);
    const connection = useSessionStore((state) => state.connection);
    const textSettings = useSessionStore((state) => state.text);
    const personaAvatar = useSessionStore((state) => state.personaAvatar);
    const inspectorOpen = useUiStore((state) => state.inspectorOpen);

    const character = useMemo(
        () => charactersQuery.data?.find((item) => item.avatar === avatar) ?? null,
        [charactersQuery.data, avatar],
    );

    /** Saved chats, newest first. */
    const chats = useMemo(() => {
        const list = chatsQuery.data ?? [];
        return [...list].sort((a, b) => (b.last_mes ?? 0) - (a.last_mes ?? 0));
    }, [chatsQuery.data]);

    // Resolve which chat to show when the route does not name one: the most
    // recent, or a fresh file for a character with no history.
    const pendingNewChat = useRef<string | null>(null);
    useEffect(() => {
        if (fileFromRoute || !avatar || !character || chatsQuery.isPending) {
            return;
        }
        const newest = chats[0];
        const target = newest
            ? (newest.file_id ?? newest.file_name.replace(/\.jsonl$/, ''))
            : newChatFileName(character.name);
        if (!newest) {
            pendingNewChat.current = target;
        }
        void navigate(`/chat/${encodeURIComponent(avatar)}/${encodeURIComponent(target)}`, {
            replace: true,
        });
    }, [avatar, character, chats, chatsQuery.isPending, fileFromRoute, navigate]);

    const session = useChatSession(character, fileFromRoute);
    const { isLoading: chatLoading, reset: resetChat } = session;
    const messageCount = session.messages.length;

    // Which message the generation panel is illustrating. `null` means closed;
    // -1 means "a standalone render appended to the chat".
    const [illustrating, setIllustrating] = useState<number | null>(null);
    const setImage = useSessionStore((state) => state.setImage);
    const { addMedia } = session;

    const onRenderComplete = useCallback(
        (messageIndex: number, attachment: MediaAttachment, layout: MediaLayout) => {
            addMedia(messageIndex, attachment, layout);
        },
        [addMedia],
    );

    const render = useImageGeneration({
        onComplete: onRenderComplete,
        ...(character ? { characterName: character.name } : {}),
    });

    const suggestions = useMemo(
        () => promptSuggestions(character, session.messages, illustrating ?? -1),
        [character, session.messages, illustrating],
    );

    const initialPrompt = suggestions[0]?.prompt ?? '';

    const startRender = (request: ImageRequest, layout: MediaLayout) => {
        // A standalone render still needs a message to live on; the newest one
        // is where the user was looking.
        const target = illustrating !== null && illustrating >= 0
            ? illustrating
            : session.messages.length - 1;
        if (target < 0) {
            return;
        }
        render.start({ messageIndex: target, request, layout });
    };

    /** Re-opens the panel with the settings that produced an existing render. */
    const reuseSettings = (item: MediaAttachment) => {
        setImage({
            ...(item.provider === 'novelai' || item.provider === 'comfyui'
                ? { provider: item.provider }
                : {}),
            ...(item.negative !== undefined ? { negativePrompt: item.negative } : {}),
            ...(item.width ? { width: item.width } : {}),
            ...(item.height ? { height: item.height } : {}),
            ...(typeof item.steps === 'number' ? { steps: item.steps } : {}),
            ...(typeof item.cfgScale === 'number' ? { cfgScale: item.cfgScale } : {}),
            ...(typeof item.seed === 'number' ? { seed: item.seed } : {}),
            ...(item.sampler ? { sampler: item.sampler } : {}),
            ...(item.scheduler ? { scheduler: item.scheduler } : {}),
            ...(item.model ? { model: item.model } : {}),
        });
        setIllustrating((current) => current ?? session.messages.length - 1);
    };

    // Seed a brand-new chat with the character's greeting. Depends on the
    // individual values rather than the session object, which is rebuilt on
    // every render.
    useEffect(() => {
        if (!fileFromRoute || !character || chatLoading) {
            return;
        }
        if (pendingNewChat.current === fileFromRoute && messageCount === 0) {
            pendingNewChat.current = null;
            resetChat();
        }
    }, [character, fileFromRoute, chatLoading, messageCount, resetChat]);

    const startNewChat = () => {
        if (!character || !avatar) {
            return;
        }
        const target = newChatFileName(character.name);
        pendingNewChat.current = target;
        void navigate(`/chat/${encodeURIComponent(avatar)}/${encodeURIComponent(target)}`);
    };

    if (charactersQuery.isPending) {
        return <ChatSkeleton />;
    }

    if (!character) {
        return (
            <EmptyState
                icon={<MessageSquareDashed />}
                title="Character not found"
                description="This character may have been renamed or removed. Pick another from the library."
            />
        );
    }

    // Identity of the open chat: remounting on change resets per-chat view
    // state (scroll position, composer draft) without reset effects.
    //
    // The two keys must differ from each other. React reconciles siblings
    // through a Map keyed by `key`, so two siblings sharing one key lose the
    // first fiber to the second and the displaced subtree is never unmounted —
    // one leaked message list per chat switch. React only warns about
    // duplicate keys in development builds.
    const chatKey = `${character.avatar}:${fileFromRoute ?? ''}`;
    const messagesKey = `messages:${chatKey}`;
    const composerKey = `composer:${chatKey}`;

    // In text mode the provider list does not apply: the label has to name the
    // backend and its server, which is what identifies the connection there.
    const textBackend = BACKENDS[textSettings.backend];
    const connectionLabel = connection.mode === 'text'
        ? [
            textBackend.label,
            textSettings.model || (textBackend.needsUrl ? textSettings.url : ''),
        ].filter(Boolean).join(' · ')
        : connection.model
            ? `${SOURCE_LABELS[connection.source]} · ${connection.model}`
            : `${SOURCE_LABELS[connection.source]} · no model selected`;

    const connected = connection.mode === 'text'
        ? !textBackend.needsUrl || Boolean(textSettings.url.trim())
        : Boolean(connection.model);

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
                <ChatHeader
                    character={character}
                    chats={chats}
                    activeChatId={fileFromRoute ?? ''}
                    onOpenChat={(fileId) =>
                        void navigate(
                            `/chat/${encodeURIComponent(character.avatar)}/${encodeURIComponent(fileId)}`,
                        )
                    }
                    onNewChat={startNewChat}
                    onOpenSettings={onOpenSettings}
                    connectionLabel={connectionLabel}
                    connected={connected}
                />

                {session.isLoading ? (
                    <ChatSkeleton />
                ) : (
                    <MessageList
                        key={messagesKey}
                        session={session}
                        characterAvatar={character.avatar}
                        personaAvatar={personaAvatar}
                        characterName={character.name}
                        onIllustrate={setIllustrating}
                        onReuseSeed={reuseSettings}
                        pendingRender={render.pending}
                        renderElapsedMs={render.elapsedMs}
                        onCancelRender={render.cancel}
                    />
                )}

                <Composer
                    key={composerKey}
                    chatId={chatKey}
                    isGenerating={session.isGenerating}
                    onSend={session.send}
                    onStop={session.stop}
                    disabled={!fileFromRoute}
                    placeholder={`Message ${character.name}…`}
                    onIllustrate={
                        session.messages.length > 0 && !render.isGenerating
                            ? () => setIllustrating(-1)
                            : undefined
                    }
                />

                <ImageGenerationDialog
                    open={illustrating !== null}
                    onOpenChange={(open) => setIllustrating(open ? illustrating : null)}
                    initialPrompt={initialPrompt}
                    suggestions={suggestions}
                    onSubmit={startRender}
                />
            </div>

            {inspectorOpen ? (
                <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-surface/40 xl:block">
                    <CharacterInspector character={character} session={session} />
                </aside>
            ) : null}
        </div>
    );
}
