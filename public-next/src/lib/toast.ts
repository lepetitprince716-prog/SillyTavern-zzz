/**
 * Toast state and the imperative API.
 *
 * Kept apart from the `Toaster` component so that modules which only need to
 * *raise* a toast do not import React components, and so both files stay
 * Fast-Refresh friendly.
 */

import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
    id: number;
    tone: ToastTone;
    title: string;
    description?: string;
}

interface ToastState {
    toasts: Toast[];
    push(toast: Omit<Toast, 'id'>): number;
    dismiss(id: number): void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set) => ({
    toasts: [],
    push: (toast) => {
        const id = nextId++;
        // Cap the stack so a failing retry loop cannot bury the UI.
        set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }));
        return id;
    },
    dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Errors stay until dismissed; everything else auto-hides. */
export const AUTO_DISMISS_MS: Record<ToastTone, number> = {
    info: 4000,
    success: 3000,
    error: 0,
};

/** Raises a toast from anywhere, including outside React. */
export const toast = {
    info: (title: string, description?: string) =>
        useToastStore.getState().push({ tone: 'info', title, ...(description ? { description } : {}) }),
    success: (title: string, description?: string) =>
        useToastStore.getState().push({ tone: 'success', title, ...(description ? { description } : {}) }),
    error: (title: string, description?: string) =>
        useToastStore.getState().push({ tone: 'error', title, ...(description ? { description } : {}) }),
    dismiss: (id: number) => useToastStore.getState().dismiss(id),
};
