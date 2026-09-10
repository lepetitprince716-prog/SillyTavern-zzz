/**
 * A group chat.
 *
 * Shares the message list and composer with a single-character chat — a group
 * message is a message, and reusing the renderer is what keeps markdown,
 * images, editing and the bounded window identical in both. What differs is
 * the header, the per-member controls, and that a turn can hold several
 * replies.
 */

import {
    Menu as MenuIcon,
    MessageSquareDashed,
    MoreVertical,
    Play,
    Settings2,
    Sparkles,
    UsersRound,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { avatarUrl } from '@/api/characters';
import { useCharacters } from '@/api/queries';
import type { Group } from '@/api/groups';
import { Avatar } from '@/components/ui/Avatar';
import { Drawer, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Tooltip } from '@/components/ui/overlays';
import { Button, EmptyState, IconButton, SectionLabel, Skeleton } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useUiStore } from '@/store/ui';
import { useSessionStore } from '@/store/session';
import { Composer } from '@/features/chat/Composer';
import { GroupEditor } from './GroupEditor';
import { GroupMessageList } from './GroupMessageList';
import { SpeakingNow, TurnTrace } from './TurnTrace';
import { useGroupMutations, useGroups } from './useGroupMutations';
import { useGroupSession } from './useGroupSession';

/** Overlapping avatars, so the header says who is in the room at a glance. */
function MemberStack({ group, size = 'sm' }: { group: Group; size?: 'sm' | 'md' }) {
    const shown = group.members.slice(0, 4);
    return (
        <div className="flex shrink-0 items-center">
            {shown.map((avatar, index) => (
                <Avatar
                    key={avatar}
                    src={avatarUrl(avatar)}
                    name={avatar}
                    size={size}
                    rounded="full"
                    className={cn(
                        'ring-2 ring-bg',
                        index > 0 && '-ml-2',
                        group.disabled_members?.includes(avatar) && 'opacity-45',
                    )}
                />
            ))}
            {group.members.length > shown.length ? (
                <span className="-ml-1 rounded-full bg-surface-3 px-1.5 py-0.5 text-[0.625rem] text-muted ring-2 ring-bg">
                    +{group.members.length - shown.length}
                </span>
            ) : null}
        </div>
    );
}

export function GroupChatView({ onOpenSettings }: { onOpenSettings(): void }) {
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const groupsQuery = useGroups();
    const charactersQuery = useCharacters();
    const { save, remove, startChat } = useGroupMutations();
    const inspectorOpen = useUiStore((state) => state.inspectorOpen);
    const toggleSidebar = useUiStore((state) => state.toggleSidebar);
    const toggleInspector = useUiStore((state) => state.toggleInspector);
    const isWide = useMediaQuery('(min-width: 80rem)');
    const connection = useSessionStore((state) => state.connection);

    const [editorOpen, setEditorOpen] = useState(false);

    const group = useMemo(
        () => groupsQuery.data?.find((entry) => entry.id === params.id) ?? null,
        [groupsQuery.data, params.id],
    );

    const session = useGroupSession(group, charactersQuery.data ?? []);

    if (groupsQuery.isPending || charactersQuery.isPending) {
        return (
            <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
                {[0, 1, 2].map((row) => (
                    <div key={row} className="flex gap-3">
                        <Skeleton className="size-10 rounded-[0.625rem]" />
                        <div className="flex-1 space-y-2">
                            <Skeleton className="h-3 w-28" />
                            <Skeleton className="h-3 w-full" />
                            <Skeleton className="h-3 w-[70%]" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (!group) {
        return (
            <EmptyState
                icon={<UsersRound />}
                title="Group not found"
                description="It may have been deleted. Pick another from the library."
            />
        );
    }

    const missing = group.members.filter(
        (avatar) => !(charactersQuery.data ?? []).some((character) => character.avatar === avatar),
    );

    /**
     * The occasional actions.
     *
     * Rendered as icons where there is room and folded into one menu where
     * there is not: five icon buttons at phone width crush the group's name
     * down to a couple of characters, and the name is the part the reader
     * needs.
     */
    const actions = [
        {
            key: 'new-chat',
            label: 'Start a new group chat',
            icon: <Sparkles className="size-4.5" />,
            run: () => startChat.mutate(group),
        },
        {
            key: 'group-settings',
            label: 'Group settings',
            icon: <UsersRound className="size-4.5" />,
            run: () => setEditorOpen(true),
        },
        {
            key: 'app-settings',
            label: 'Settings',
            icon: <Settings2 className="size-4.5" />,
            run: onOpenSettings,
        },
    ];

    const sidePanel = (
        <div className="space-y-4 p-5">
            <SectionLabel className="px-0">This turn</SectionLabel>
            <TurnTrace plan={session.lastTurn} />
        </div>
    );

    return (
        <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-bg/85 px-2 backdrop-blur-md sm:px-3">
                    <IconButton
                        label="Toggle character list"
                        variant="ghost"
                        className="lg:hidden"
                        onClick={() => toggleSidebar()}
                    >
                        <MenuIcon className="size-4.5" />
                    </IconButton>

                    {/* Decorative, and the first thing to go when space is
                        short: the header already names the group. */}
                    <div className="max-sm:hidden">
                        <MemberStack group={group} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-sm font-semibold leading-tight">{group.name}</h1>
                        <p className="truncate text-[0.6875rem] text-subtle">
                            {session.members.length} member
                            {session.members.length === 1 ? '' : 's'}
                            {' · '}
                            {connection.mode === 'text' ? 'text completion' : connection.model || 'no model selected'}
                        </p>
                    </div>

                    <Menu>
                        <MenuTrigger asChild>
                            <IconButton label="Ask a member to reply" variant="ghost">
                                <Play className="size-4.5" />
                            </IconButton>
                        </MenuTrigger>
                        <MenuContent>
                            <MenuLabel>Ask someone to reply</MenuLabel>
                            {session.members.map((member) => (
                                <MenuItem
                                    key={member.avatar}
                                    onSelect={() => session.askMember(member.avatar)}
                                >
                                    <Avatar
                                        src={avatarUrl(member.avatar)}
                                        name={member.name}
                                        size="sm"
                                        rounded="card"
                                    />
                                    {member.name}
                                </MenuItem>
                            ))}
                            <MenuSeparator />
                            <MenuItem onSelect={session.advance}>
                                <Sparkles />
                                Let the group carry on
                            </MenuItem>
                        </MenuContent>
                    </Menu>

                    {actions.map((action) => (
                        <Tooltip key={action.key} content={action.label}>
                            <IconButton
                                label={action.label}
                                variant="ghost"
                                className="max-sm:hidden"
                                onClick={action.run}
                            >
                                {action.icon}
                            </IconButton>
                        </Tooltip>
                    ))}

                    <Menu>
                        <MenuTrigger asChild>
                            <IconButton label="More group actions" variant="ghost" className="sm:hidden">
                                <MoreVertical className="size-4.5" />
                            </IconButton>
                        </MenuTrigger>
                        <MenuContent>
                            {actions.map((action) => (
                                <MenuItem key={action.key} onSelect={action.run}>
                                    {action.icon}
                                    {action.label}
                                </MenuItem>
                            ))}
                        </MenuContent>
                    </Menu>

                    <Tooltip content={inspectorOpen ? 'Hide the side panel' : 'Show the side panel'}>
                        <IconButton
                            label={inspectorOpen ? 'Hide the side panel' : 'Show the side panel'}
                            variant="ghost"
                            onClick={() => toggleInspector()}
                        >
                            <MessageSquareDashed className="size-4.5" />
                        </IconButton>
                    </Tooltip>
                </header>

                {missing.length > 0 ? (
                    <p className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-muted">
                        {missing.length} member{missing.length === 1 ? '' : 's'} of this group
                        {missing.length === 1 ? ' is' : ' are'} no longer in the library, so
                        {missing.length === 1 ? ' it' : ' they'} cannot reply. Their past messages
                        are still here.
                    </p>
                ) : null}

                {session.isLoading ? (
                    <div className="flex-1 space-y-4 p-6">
                        <Skeleton className="h-3 w-40" />
                        <Skeleton className="h-3 w-full" />
                    </div>
                ) : session.messages.length === 0 ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                        <EmptyState
                            icon={<UsersRound />}
                            title={`${group.name} is quiet`}
                            description="Say something, or have each member introduce themselves."
                            action={
                                <Button variant="secondary" onClick={session.reset}>
                                    Let everyone say hello
                                </Button>
                            }
                        />
                    </div>
                ) : (
                    <GroupMessageList
                        key={group.chat_id}
                        session={session}
                        groupName={group.name}
                    />
                )}

                <SpeakingNow name={session.speakingNow} />

                <Composer
                    key={`group-composer:${group.chat_id}`}
                    chatId={`group:${group.id}`}
                    isGenerating={session.isGenerating}
                    onSend={session.send}
                    onStop={session.stop}
                    placeholder={`Message ${group.name}…`}
                />
            </div>

            {isWide ? (
                inspectorOpen ? (
                    <aside
                        aria-label="Turn details"
                        className="w-80 shrink-0 overflow-y-auto border-l border-border bg-surface/40"
                    >
                        {sidePanel}
                    </aside>
                ) : null
            ) : (
                <Drawer
                    open={inspectorOpen}
                    onOpenChange={(open) => toggleInspector(open)}
                    title={group.name}
                >
                    <div className="-mx-5 -my-4">{sidePanel}</div>
                </Drawer>
            )}

            <GroupEditor
                open={editorOpen}
                onOpenChange={setEditorOpen}
                group={group}
                characters={charactersQuery.data ?? []}
                onSave={(next) => save.mutate(next)}
                onDelete={() => {
                    remove.mutate(group.id);
                    void navigate('/characters');
                }}
            />
        </div>
    );
}
