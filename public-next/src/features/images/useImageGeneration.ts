/**
 * Drives an image generation and writes the result into a message.
 *
 * The classic extension generates into whichever message is current when the
 * request returns, which is the wrong message if the chat moved on during a
 * two-minute render. This keys the in-flight request to the message it started
 * from and applies the result there.
 */

import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    attachmentFromResult,
    generateImage,
    imageErrorMessage,
    saveGeneratedImage,
    type ImageRequest,
} from '@/api/images';
import type { MediaAttachment, MediaLayout } from '@/api/types';
import { toast } from '@/lib/toast';
import { imageFileName } from './media';

export interface PendingRender {
    /** Index of the message the render belongs to. */
    messageIndex: number;
    width: number;
    height: number;
    startedAt: number;
}

export interface UseImageGenerationOptions {
    /** Called once the image is saved, with the attachment to store. */
    onComplete(messageIndex: number, attachment: MediaAttachment, layout: MediaLayout): void | Promise<void>;
    /** Sub-folder for the saved file, so the gallery stays organised. */
    characterName?: string;
}

export interface StartRenderOptions {
    messageIndex: number;
    request: ImageRequest;
    /**
     * Placement for the finished render, carried with the request rather than
     * read at completion: a render can take minutes, and the setting the user
     * chose when they pressed the button is the one they meant.
     */
    layout: MediaLayout;
}

export function useImageGeneration({ onComplete, characterName }: UseImageGenerationOptions) {
    const [pending, setPending] = useState<PendingRender | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    const controller = useRef<AbortController | null>(null);

    // A ticking clock is the only honest progress signal available: neither
    // provider reports how far along a render is. The value is written from
    // the timer callback rather than computed during render, which would make
    // the component's output depend on the wall clock.
    useEffect(() => {
        if (!pending) {
            return;
        }
        const { startedAt } = pending;
        const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
        return () => window.clearInterval(timer);
    }, [pending]);

    // Abandon an in-flight render when the view goes away, so the server stops
    // waiting on a response nobody will read.
    useEffect(() => () => controller.current?.abort(), []);

    const mutation = useMutation({
        mutationFn: async ({ messageIndex, request, layout }: StartRenderOptions) => {
            controller.current?.abort();
            const abort = new AbortController();
            controller.current = abort;

            // Reset from the event that starts the render, not from an effect
            // reacting to it.
            setElapsedMs(0);
            setPending({
                messageIndex,
                width: request.width,
                height: request.height,
                startedAt: Date.now(),
            });

            const result = await generateImage(request, abort.signal);
            const url = await saveGeneratedImage({
                data: result.image.data,
                format: result.image.format,
                ...(characterName ? { characterName } : {}),
                fileName: imageFileName(result.meta.prompt, result.meta.seed),
            });

            return { messageIndex, layout, attachment: attachmentFromResult(result, url) };
        },
        onSuccess: async ({ messageIndex, attachment, layout }) => {
            await onComplete(messageIndex, attachment, layout);
        },
        onError: (error) => {
            // AbortError means the user cancelled; they know already.
            if (error instanceof Error && error.name === 'AbortError') {
                return;
            }
            toast.error('The image could not be generated', imageErrorMessage(error));
        },
        onSettled: () => {
            setPending(null);
            controller.current = null;
        },
    });

    const cancel = useCallback(() => {
        controller.current?.abort();
    }, []);

    return {
        pending,
        elapsedMs,
        isGenerating: mutation.isPending,
        start: mutation.mutate,
        cancel,
    };
}
