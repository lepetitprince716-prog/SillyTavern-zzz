import { Compass } from 'lucide-react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { EmptyState } from '@/components/ui/primitives';
import { CharacterLibrary } from '@/features/characters/CharacterLibrary';
import { ChatView } from '@/features/chat/ChatView';
import { GroupChatView } from '@/features/groups/GroupChatView';
import { WorldInfoPage } from '@/features/worldinfo/WorldInfoPage';

function NotFound() {
    return (
        <EmptyState
            icon={<Compass />}
            title="Nothing here"
            description="That address does not match a page in this interface."
            action={
                <Link
                    to="/characters"
                    className="inline-flex h-9.5 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover"
                >
                    Go to characters
                </Link>
            }
        />
    );
}

export function App() {
    return (
        <AppShell>
            {({ openSettings }) => (
                <Routes>
                    <Route index element={<Navigate to="/characters" replace />} />
                    <Route
                        path="/characters"
                        element={<CharacterLibrary onOpenSettings={openSettings} />}
                    />
                    <Route
                        path="/worldinfo"
                        element={<WorldInfoPage onOpenSettings={openSettings} />}
                    />
                    <Route path="/chat/:avatar" element={<ChatView onOpenSettings={openSettings} />} />
                    <Route
                        path="/chat/:avatar/:file"
                        element={<ChatView onOpenSettings={openSettings} />}
                    />
                    <Route
                        path="/group/:id"
                        element={<GroupChatView onOpenSettings={openSettings} />}
                    />
                    <Route path="*" element={<NotFound />} />
                </Routes>
            )}
        </AppShell>
    );
}
