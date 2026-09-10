/**
 * Creating, editing and deleting groups.
 *
 * `/api/groups/edit` writes the request body to the file wholesale, so every
 * mutation here reads the current group, changes one thing, and sends the whole
 * object back. Sending a patch would silently drop the chat list.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    createGroup,
    deleteGroup,
    fetchGroups,
    newGroupChatId,
    saveGroup,
    type Group,
    type NewGroup,
} from '@/api/groups';
import { toast } from '@/lib/toast';

export const groupsQueryKey = ['groups'] as const;

export function useGroups() {
    return useQuery({
        queryKey: groupsQueryKey,
        queryFn: () => fetchGroups(),
        staleTime: 30_000,
    });
}

export function useGroupMutations() {
    const queryClient = useQueryClient();
    const invalidate = () => queryClient.invalidateQueries({ queryKey: groupsQueryKey });

    const create = useMutation({
        mutationFn: (group: NewGroup) => createGroup(group),
        onSuccess: async (group) => {
            await invalidate();
            toast.success('Group created', group.name);
        },
        onError: (error: Error) => toast.error('Could not create the group', error.message),
    });

    const save = useMutation({
        mutationFn: (group: Group) => saveGroup(group),
        onSuccess: async () => {
            await invalidate();
        },
        onError: (error: Error) => toast.error('Could not save the group', error.message),
    });

    const remove = useMutation({
        mutationFn: (id: string) => deleteGroup(id),
        onSuccess: async () => {
            await invalidate();
            toast.success('Group deleted');
        },
        onError: (error: Error) => toast.error('Could not delete the group', error.message),
    });

    /** Adds a chat to the group and makes it the open one. */
    const startChat = useMutation({
        mutationFn: (group: Group) => {
            const chatId = newGroupChatId();
            return saveGroup({
                ...group,
                chat_id: chatId,
                chats: [...new Set([...(group.chats ?? []), chatId])],
            });
        },
        onSuccess: async () => {
            await invalidate();
        },
        onError: (error: Error) => toast.error('Could not start a new chat', error.message),
    });

    return { create, save, remove, startChat };
}
