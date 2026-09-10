import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { cardField, characterTags, greetings } from '@/api/characters';
import type { Character } from '@/api/types';
import { Modal } from '@/components/ui/overlays';
import { Badge, Button, SectionLabel } from '@/components/ui/primitives';
import { compactNumber, estimateTokens } from '@/lib/format';
import type { ChatSession } from '@/features/chat/useChatSession';
import { ActivationTrace } from '@/features/worldinfo/ActivationTrace';
import { CharacterActions } from './CharacterActions';
import { CharacterEditor, FavouriteButton } from './CharacterEditor';

function Detail({ label, value }: { label: string; value: string }) {
    if (!value.trim()) {
        return null;
    }
    return (
        <section className="space-y-1.5">
            <SectionLabel className="px-0">{label}</SectionLabel>
            <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-muted">{value}</p>
        </section>
    );
}

/**
 * Right-hand panel: what the card actually contains, and what the app is about
 * to send. The prompt preview matters — it is the difference between guessing
 * at a bad reply and seeing why it happened.
 */
export function CharacterInspector({
    character,
    session,
}: {
    character: Character;
    session: ChatSession;
}) {
    const [promptOpen, setPromptOpen] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const navigate = useNavigate();
    const tags = characterTags(character);
    const alternates = greetings(character);

    const prompt = promptOpen ? session.previewPrompt() : [];
    const promptTokens = prompt.reduce((total, message) => total + estimateTokens(message.content), 0);

    return (
        <div className="space-y-5 p-5">
            <div className="space-y-2">
                <div className="flex items-start gap-1">
                    <h2 className="min-w-0 flex-1 text-[0.9375rem] font-semibold">{character.name}</h2>
                    <FavouriteButton character={character} />
                    <CharacterActions
                        character={character}
                        onEdit={() => setEditorOpen(true)}
                        onDeleted={() => void navigate('/characters')}
                        compact
                    />
                </div>
                {character.data?.creator ? (
                    <p className="text-xs text-subtle">
                        by {character.data.creator}
                        {character.data.character_version ? ` · v${character.data.character_version}` : ''}
                    </p>
                ) : null}
                {tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                        {tags.map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                        ))}
                    </div>
                ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={() => setEditorOpen(true)}>
                    <Pencil className="size-3.5" />
                    Edit card
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPromptOpen(true)}>
                    Inspect prompt
                </Button>
                {alternates.length > 1 ? (
                    <Button size="sm" variant="ghost" onClick={() => session.reset(0)}>
                        Reset to greeting
                    </Button>
                ) : null}
            </div>

            {alternates.length > 1 ? (
                <section className="space-y-2">
                    <SectionLabel className="px-0">Greetings ({alternates.length})</SectionLabel>
                    <div className="space-y-1.5">
                        {alternates.map((greeting, index) => (
                            <button
                                key={index}
                                type="button"
                                onClick={() => session.reset(index)}
                                className="block w-full rounded-lg border border-border bg-surface p-2.5 text-left text-xs leading-relaxed text-muted transition-colors hover:border-border-strong hover:text-text"
                            >
                                <span className="mb-1 block text-[0.625rem] font-semibold uppercase tracking-wide text-subtle">
                                    {index === 0 ? 'Primary' : `Alternate ${index}`}
                                </span>
                                <span className="line-clamp-3">{greeting}</span>
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}

            <div className="border-t border-border pt-4">
                <ActivationTrace state={session.worldInfo} />
            </div>

            <Detail label="Description" value={cardField(character, 'description')} />
            <Detail label="Personality" value={cardField(character, 'personality')} />
            <Detail label="Scenario" value={cardField(character, 'scenario')} />
            <Detail label="Creator notes" value={character.data?.creator_notes ?? character.creatorcomment ?? ''} />

            <Modal
                open={promptOpen}
                onOpenChange={setPromptOpen}
                title="Prompt preview"
                description={`${prompt.length} messages · roughly ${compactNumber(promptTokens)} tokens`}
                size="lg"
            >
                <div className="space-y-3">
                    {prompt.map((message, index) => (
                        <div key={index} className="overflow-hidden rounded-lg border border-border">
                            <div className="flex items-center justify-between gap-2 bg-surface-2 px-3 py-1.5">
                                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide text-muted">
                                    {message.role}
                                </span>
                                <span className="text-[0.6875rem] tabular-nums text-subtle">
                                    ~{compactNumber(estimateTokens(message.content))} tok
                                </span>
                            </div>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[0.6875rem] leading-relaxed text-muted">
                                {message.content}
                            </pre>
                        </div>
                    ))}
                    {prompt.length === 0 ? (
                        <p className="py-6 text-center text-sm text-subtle">
                            Nothing to send yet — pick a model and start the chat.
                        </p>
                    ) : null}
                </div>
            </Modal>

            <CharacterEditor open={editorOpen} onOpenChange={setEditorOpen} character={character} />
        </div>
    );
}
