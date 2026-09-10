import { AlertTriangle } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui/primitives';

interface Props {
    children: ReactNode;
}

interface State {
    error: Error | null;
}

/**
 * Catches render-time crashes so a single bad message or malformed card cannot
 * take the whole app down with a blank page.
 */
export class ErrorBoundary extends Component<Props, State> {
    override state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error('Unhandled UI error', error, info.componentStack);
    }

    override render(): ReactNode {
        const { error } = this.state;
        if (!error) {
            return this.props.children;
        }

        return (
            <div className="flex h-full items-center justify-center p-6">
                <div className="w-full max-w-md space-y-4 rounded-card border border-border bg-surface p-6 text-center">
                    <AlertTriangle className="mx-auto size-8 text-warning" />
                    <div className="space-y-1">
                        <h1 className="text-sm font-semibold">Something broke while rendering</h1>
                        <p className="text-[0.8125rem] leading-relaxed text-muted">
                            Your chats are saved on the server — nothing was lost.
                        </p>
                    </div>
                    <pre className="max-h-32 overflow-auto rounded-lg bg-surface-2 p-3 text-left font-mono text-[0.6875rem] text-muted">
                        {error.message}
                    </pre>
                    <div className="flex justify-center gap-2">
                        <Button variant="primary" onClick={() => this.setState({ error: null })}>
                            Try again
                        </Button>
                        <Button onClick={() => window.location.reload()}>Reload</Button>
                    </div>
                </div>
            </div>
        );
    }
}
