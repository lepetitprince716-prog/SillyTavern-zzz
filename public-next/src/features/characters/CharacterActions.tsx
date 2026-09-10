import { Copy, Download, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { exportCharacter } from '@/api/character-edit';
import type { Character } from '@/api/types';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Modal } from '@/components/ui/overlays';
import { Button, IconButton } from '@/components/ui/primitives';
import { ToggleRow } from '@/components/ui/controls';
import { toast } from '@/lib/toast';
import { formatBytes } from '@/lib/format';
import { useCharacterMutations } from './useCharacterMutations';

/** Confirmation for a destructive, irreversible delete. */
function DeleteDialog({
    character,
    open,
    onOpenChange,
    onDeleted,
}: {
    character: Character;
    open: boolean;
    onOpenChange(open: boolean): void;
    onDeleted?(): void;
}) {
    const { remove } = useCharacterMutations();
    const [alsoChats, setAlsoChats] = useState(false);

    return (
        <Modal
            open={open}
            onOpenChange={onOpenChange}
            title={`Delete ${character.name}?`}
            description="The card file is removed from disk. This cannot be undone."
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant="danger"
                        disabled={remove.isPending}
                        onClick={() =>
                            remove.mutate(
                                { avatar: character.avatar, deleteChats: alsoChats },
                                {
                                    onSuccess: () => {
                                        onOpenChange(false);
                                        onDeleted?.();
                                    },
                                },
                            )
                        }
                    >
                        {remove.isPending ? 'Deleting…' : 'Delete'}
                    </Button>
                </>
            }
        >
            <ToggleRow
                label="Also delete the chat history"
                description={
                    character.chat_size
                        ? `${formatBytes(character.chat_size)} of saved chats would be removed as well.`
                        : 'This character has no saved chats.'
                }
                checked={alsoChats}
                onCheckedChange={setAlsoChats}
            />
        </Modal>
    );
}

export interface CharacterActionsProps {
    character: Character;
    onEdit(character: Character): void;
    /** Called after the character is deleted, e.g. to navigate away. */
    onDeleted?(): void;
    /** Rendered as a compact icon button rather than a labelled one. */
    compact?: boolean;
}

/** The per-character overflow menu, shared by the library and the inspector. */
export function CharacterActions({ character, onEdit, onDeleted, compact }: CharacterActionsProps) {
    const { duplicate } = useCharacterMutations();
    const [deleting, setDeleting] = useState(false);

    const download = async (format: 'png' | 'json') => {
        try {
            await exportCharacter(character, format);
        } catch (error) {
            toast.error('Could not export the card', error instanceof Error ? error.message : undefined);
        }
    };

    return (
        <>
            <Menu>
                <MenuTrigger asChild>
                    <IconButton
                        label={`Actions for ${character.name}`}
                        variant="ghost"
                        size={compact ? 'icon-sm' : 'icon'}
                        // Stop the click from reaching the card link behind it.
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                    >
                        <MoreVertical className="size-4" />
                    </IconButton>
                </MenuTrigger>
                <MenuContent>
                    <MenuItem onSelect={() => onEdit(character)}>
                        <Pencil />
                        Edit card
                    </MenuItem>
                    <MenuItem onSelect={() => duplicate.mutate(character.avatar)}>
                        <Copy />
                        Duplicate
                    </MenuItem>
                    <MenuSeparator />
                    <MenuLabel>Export</MenuLabel>
                    <MenuItem onSelect={() => void download('png')}>
                        <Download />
                        PNG card
                    </MenuItem>
                    <MenuItem onSelect={() => void download('json')}>
                        <Download />
                        JSON
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem tone="danger" onSelect={() => setDeleting(true)}>
                        <Trash2 />
                        Delete
                    </MenuItem>
                </MenuContent>
            </Menu>

            <DeleteDialog
                character={character}
                open={deleting}
                onOpenChange={setDeleting}
                {...(onDeleted ? { onDeleted } : {})}
            />
        </>
    );
}
