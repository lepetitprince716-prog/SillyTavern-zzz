import {
    History,
    Menu as MenuIcon,
    MessageSquarePlus,
    PanelRightClose,
    PanelRightOpen,
    Settings2,
    Sparkles,
} from 'lucide-react';
import { avatarUrl } from '@/api/characters';
import type { Character, ChatSummary } from '@/api/types';
import { Avatar } from '@/components/ui/Avatar';
import {
    Menu,
    MenuContent,
    MenuItem,
    MenuLabel,
    MenuSeparator,
    MenuTrigger,
    Tooltip,
} from '@/components/ui/overlays';
import { IconButton } from '@/components/ui/primitives';
import { relativeTime } from '@/lib/format';
import { useUiStore } from '@/store/ui';

export interface ChatHeaderProps {
    character: Character;
    chats: ChatSummary[];
    activeChatId: string;
    onOpenChat(fileId: string): void;
    onNewChat(): void;
    onOpenSettings(): void;
    /** Provider and model shown as connection status. */
    connectionLabel: string;
    connected: boolean;
}

export function ChatHeader({
    character,
    chats,
    activeChatId,
    onOpenChat,
    onNewChat,
    onOpenSettings,
    connectionLabel,
    connected,
}: ChatHeaderProps) {
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const inspectorOpen = useUiStore((state) => state.inspectorOpen);
    const toggleInspector = useUiStore((state) => state.toggleInspector);

    return (
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg/85 px-2 backdrop-blur-md sm:px-3">
            <IconButton
                label="Toggle character list"
                variant="ghost"
                className="lg:hidden"
                onClick={() => toggleSidebar()}
            >
                <MenuIcon className="size-4.5" />
            </IconButton>

            <Avatar src={avatarUrl(character.avatar)} name={character.name} size="sm" rounded="card" />

            <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-semibold leading-tight">{character.name}</h1>
                <p className="flex items-center gap-1.5 truncate text-[0.6875rem] text-subtle">
                    <span
                        aria-hidden
                        className={`inline-block size-1.5 shrink-0 rounded-full ${connected ? 'bg-success' : 'bg-warning'}`}
                    />
                    {connectionLabel}
                </p>
            </div>

            <Menu>
                <MenuTrigger asChild>
                    <IconButton label="Chat history" variant="ghost">
                        <History className="size-4.5" />
                    </IconButton>
                </MenuTrigger>
                <MenuContent className="max-h-[70dvh] w-80 overflow-y-auto">
                    <MenuLabel>Chats with {character.name}</MenuLabel>
                    {chats.length === 0 ? (
                        <p className="px-2.5 py-3 text-xs text-subtle">No saved chats yet.</p>
                    ) : (
                        chats.map((chat) => {
                            const id = chat.file_id ?? chat.file_name.replace(/\.jsonl$/, '');
                            return (
                                <MenuItem
                                    key={chat.file_name}
                                    onSelect={() => onOpenChat(id)}
                                    className={id === activeChatId ? 'bg-surface-2' : undefined}
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[0.8125rem]">{id}</p>
                                        <p className="truncate text-[0.6875rem] text-subtle">
                                            {chat.chat_items ?? 0} messages · {relativeTime(chat.last_mes)}
                                        </p>
                                    </div>
                                </MenuItem>
                            );
                        })
                    )}
                    <MenuSeparator />
                    <MenuItem onSelect={onNewChat}>
                        <MessageSquarePlus />
                        Start a new chat
                    </MenuItem>
                </MenuContent>
            </Menu>

            <Tooltip content="New chat">
                <IconButton label="New chat" variant="ghost" onClick={onNewChat}>
                    <Sparkles className="size-4.5" />
                </IconButton>
            </Tooltip>

            <Tooltip content="Settings">
                <IconButton label="Settings" variant="ghost" onClick={onOpenSettings}>
                    <Settings2 className="size-4.5" />
                </IconButton>
            </Tooltip>

            <Tooltip content={inspectorOpen ? 'Hide character panel' : 'Show character panel'}>
                <IconButton
                    label={inspectorOpen ? 'Hide character panel' : 'Show character panel'}
                    variant="ghost"
                    className="max-xl:hidden"
                    onClick={() => toggleInspector()}
                >
                    {inspectorOpen ? (
                        <PanelRightClose className="size-4.5" />
                    ) : (
                        <PanelRightOpen className="size-4.5" />
                    )}
                </IconButton>
            </Tooltip>
        </header>
    );
}
