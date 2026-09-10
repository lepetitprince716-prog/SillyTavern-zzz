/**
 * Groups in the character sidebar.
 *
 * Listed above the characters rather than mixed in with them: a group is a
 * different kind of thing, there are far fewer of them, and it is the item you
 * are least likely to find by scrolling a long character list.
 */

import { Plus, UsersRound } from 'lucide-react';
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { avatarUrl } from '@/api/characters';
import { useCharacters } from '@/api/queries';
import type { Group } from '@/api/groups';
import { Avatar } from '@/components/ui/Avatar';
import { Modal } from '@/components/ui/overlays';
import { Button, Field, Input, SectionLabel } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { fuzzyFilter } from '@/lib/search';
import { useGroupMutations, useGroups } from './useGroupMutations';

function GroupRow({ group, onNavigate }: { group: Group; onNavigate?(): void }) {
    const shown = group.members.slice(0, 3);
    return (
        <NavLink
            to={`/group/${encodeURIComponent(group.id)}`}
            onClick={onNavigate}
            className={({ isActive }) =>
                cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                    isActive ? 'bg-accent-soft text-text' : 'hover:bg-surface-2',
                )
            }
        >
            <span className="flex shrink-0 items-center">
                {shown.length === 0 ? (
                    <span className="grid size-8 place-items-center rounded-[0.625rem] bg-surface-3 text-subtle">
                        <UsersRound className="size-4" />
                    </span>
                ) : (
                    shown.map((avatar, index) => (
                        <Avatar
                            key={avatar}
                            src={avatarUrl(avatar)}
                            name={avatar}
                            size="sm"
                            rounded="full"
                            className={cn('ring-2 ring-surface', index > 0 && '-ml-3')}
                        />
                    ))
                )}
            </span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.8125rem] font-medium">{group.name}</span>
                <span className="block truncate text-[0.6875rem] text-subtle">
                    {group.members.length} member{group.members.length === 1 ? '' : 's'}
                    {group.date_last_chat ? ` · ${relativeTime(group.date_last_chat)}` : ''}
                </span>
            </span>
        </NavLink>
    );
}

export function GroupRows({ query, onNavigate }: { query: string; onNavigate?(): void }) {
    const { data } = useGroups();
    const groups = fuzzyFilter(data ?? [], query, (group) => [group.name]);

    if (groups.length === 0) {
        return null;
    }

    return (
        <>
            <SectionLabel className="px-2.5 py-1.5">
                {groups.length} group{groups.length === 1 ? '' : 's'}
            </SectionLabel>
            <ul className="space-y-0.5 px-1">
                {groups.map((group) => (
                    <li key={group.id}>
                        <GroupRow group={group} {...(onNavigate ? { onNavigate } : {})} />
                    </li>
                ))}
            </ul>
        </>
    );
}

/**
 * Creates a group.
 *
 * Members are picked in the group's own settings afterwards rather than here:
 * a create dialogue that also has to be a character picker ends up being a
 * worse version of both.
 */
export function GroupCreateButton() {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const { create } = useGroupMutations();
    const { data: characters } = useCharacters();
    const navigate = useNavigate();

    const submit = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const group = await create.mutateAsync({ name: trimmed, members: [] });
        setName('');
        setOpen(false);
        void navigate(`/group/${encodeURIComponent(group.id)}`);
    };

    return (
        <>
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                <Plus className="size-3.5" />
                New group
            </Button>
            <Modal
                open={open}
                onOpenChange={setOpen}
                title="New group"
                description="Several characters in one chat."
                size="sm"
                footer={
                    <div className="flex items-center gap-2">
                        <Button
                            variant="primary"
                            disabled={!name.trim() || create.isPending}
                            onClick={() => void submit()}
                        >
                            Create
                        </Button>
                        <Button variant="ghost" onClick={() => setOpen(false)}>
                            Cancel
                        </Button>
                    </div>
                }
            >
                <Field
                    label="Name"
                    htmlFor="new-group-name"
                    hint={
                        (characters?.length ?? 0) < 2
                            ? 'You will need at least two characters in the library to fill it.'
                            : 'Add members in the group’s settings once it exists.'
                    }
                >
                    <Input
                        id="new-group-name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void submit();
                            }
                        }}
                        placeholder="The tavern regulars"
                        autoFocus
                    />
                </Field>
            </Modal>
        </>
    );
}
