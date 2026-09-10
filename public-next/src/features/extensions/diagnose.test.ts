import { describe, expect, it } from 'vitest';
import type { ExtensionManifest, ExtensionScope } from '@/api/extensions';
import {
    NATIVE_EQUIVALENTS,
    diagnoseExtensions,
    explainState,
    meetsClientVersion,
    summarise,
    type DiagnoseOptions,
} from './diagnose';

function entry(name: string, type: ExtensionScope = 'system') {
    return { name, type };
}

function diagnose(patch: Partial<DiagnoseOptions> = {}) {
    return diagnoseExtensions({
        extensions: [entry('regex')],
        manifests: { regex: { display_name: 'Regex', loading_order: 1 } },
        disabled: [],
        modules: [],
        clientVersion: '1.18.0',
        ...patch,
    });
}

describe('meetsClientVersion', () => {
    it('compares version numbers by value, not lexically', () => {
        expect(meetsClientVersion('1.13.0', '1.9.0')).toBe(true);
        expect(meetsClientVersion('1.9.0', '1.13.0')).toBe(false);
        expect(meetsClientVersion('1.18.0', '1.18.0')).toBe(true);
    });

    it('treats a missing version as the oldest possible', () => {
        expect(meetsClientVersion('', '1.0.0')).toBe(false);
        expect(meetsClientVersion('', '0.0.0')).toBe(true);
    });
});

describe('diagnoseExtensions', () => {
    it('reports an extension nothing is holding back as active', () => {
        const [status] = diagnose();
        expect(status).toMatchObject({ state: 'active', active: true, displayName: 'Regex' });
    });

    it('gives every extension a state, in loading order', () => {
        const statuses = diagnose({
            extensions: [entry('vectors'), entry('regex'), entry('gallery')],
            manifests: {
                vectors: { display_name: 'Vector Storage', loading_order: 100 },
                regex: { display_name: 'Regex', loading_order: 1 },
                gallery: { display_name: 'Gallery', loading_order: 10 },
            },
        });
        expect(statuses.map((status) => status.displayName)).toEqual([
            'Regex', 'Gallery', 'Vector Storage',
        ]);
        expect(statuses.every((status) => status.state.length > 0)).toBe(true);
    });

    it('names the Extras modules an extension is waiting for', () => {
        const [status] = diagnose({
            manifests: { regex: { requires: ['classify', 'embeddings'] } },
            modules: ['embeddings'],
        });
        expect(status).toMatchObject({ state: 'missing-modules', missingModules: ['classify'] });
        expect(explainState(status!, '1.18.0')).toContain('classify');
    });

    it('separates a dependency that is absent from one that is switched off', () => {
        const manifests: Record<string, ExtensionManifest> = {
            'third-party/child': { dependencies: ['third-party/parent'] },
            'third-party/parent': {},
        };
        const both = diagnoseExtensions({
            extensions: [entry('third-party/child', 'local'), entry('third-party/parent', 'local')],
            manifests,
            disabled: ['third-party/parent'],
            modules: [],
            clientVersion: '1.18.0',
        });
        const byFolder = new Map(both.map((status) => [status.folder, status]));
        expect(byFolder.get('child')).toMatchObject({
            state: 'disabled-dependencies',
            disabledDependencies: ['third-party/parent'],
            missingDependencies: [],
        });
        expect(byFolder.get('parent')?.state).toBe('disabled');

        const alone = diagnoseExtensions({
            extensions: [entry('third-party/child', 'local')],
            manifests,
            disabled: [],
            modules: [],
            clientVersion: '1.18.0',
        });
        expect(alone[0]).toMatchObject({
            state: 'missing-dependencies',
            missingDependencies: ['third-party/parent'],
        });
    });

    it('reports a client version requirement this build does not meet', () => {
        const [status] = diagnose({
            manifests: { regex: { minimum_client_version: '2.0.0' } },
        });
        expect(status?.state).toBe('client-too-old');
        expect(explainState(status!, '1.18.0')).toContain('1.18.0');
    });

    it('reports a folder with no manifest rather than omitting it', () => {
        // The loader skips these silently, so the folder is simply absent from
        // the classic panel and there is nothing to explain the gap.
        const [status] = diagnose({
            extensions: [entry('third-party/broken', 'local')],
            manifests: { 'third-party/broken': null },
        });
        expect(status).toMatchObject({ state: 'no-manifest', displayName: 'broken', active: false });
    });

    it('does not read a malformed requires field as a failed requirement', () => {
        // The loader warns and loads anyway; reporting a failure here would
        // disagree with what actually happens.
        const [status] = diagnose({
            manifests: { regex: { requires: 'classify' as unknown as string[] } },
        });
        expect(status?.state).toBe('active');
    });

    it('applies the manual switch last, so a blocked extension says what blocks it', () => {
        // Otherwise turning an extension off would hide the reason it could
        // not have loaded anyway.
        const [status] = diagnose({
            manifests: { regex: { requires: ['classify'] } },
            disabled: ['regex'],
        });
        expect(status?.state).toBe('missing-modules');
        expect(status?.disabled).toBe(true);
    });

    it('marks the extensions this interface implements itself', () => {
        const statuses = diagnose({
            extensions: [entry('vectors'), entry('gallery')],
            manifests: { vectors: {}, gallery: {} },
        });
        const byFolder = new Map(statuses.map((status) => [status.folder, status]));
        expect(byFolder.get('vectors')).toMatchObject({ support: 'native' });
        expect(byFolder.get('gallery')).toMatchObject({ support: 'classic-only' });
        expect(byFolder.get('vectors')?.nativeAt?.path).toBe('/worldinfo');
    });

    it('claims a native equivalent only where one really exists', () => {
        // Marking an extension as covered here tells the reader they can leave
        // it switched off. Every entry has to be something this frontend
        // actually implements — an estimate is not a token counter, and API
        // settings are not connection profiles.
        expect(Object.keys(NATIVE_EQUIVALENTS).sort()).toEqual(['stable-diffusion', 'vectors']);
    });

    it('flags an extension that rewrites the prompt during generation', () => {
        const [status] = diagnose({
            manifests: { regex: { generate_interceptor: 'vectors_rearrangeChat' } },
        });
        expect(status?.interceptsGeneration).toBe(true);
    });

    it('separates optional modules from required ones', () => {
        const [status] = diagnose({
            manifests: { regex: { optional: ['classify'], requires: [] } },
        });
        expect(status).toMatchObject({ state: 'active', missingOptional: ['classify'] });
    });

    it('counts reconcile with the list', () => {
        const statuses = diagnose({
            extensions: [entry('regex'), entry('vectors'), entry('gallery'), entry('tts')],
            manifests: {
                regex: {},
                vectors: {},
                gallery: { requires: ['classify'] },
                tts: {},
            },
            disabled: ['tts'],
        });
        const counts = summarise(statuses);
        expect(counts.total).toBe(4);
        expect(counts.active + counts.disabled + counts.blocked).toBe(counts.total);
        expect(counts).toMatchObject({ active: 2, disabled: 1, blocked: 1, native: 1 });
    });
});

describe('explainState', () => {
    it('explains every state it can produce', () => {
        const states = [
            'active', 'disabled', 'missing-modules', 'missing-dependencies',
            'disabled-dependencies', 'client-too-old', 'no-manifest',
        ] as const;
        for (const state of states) {
            const text = explainState(
                {
                    name: 'x', folder: 'x', scope: 'system', displayName: 'X',
                    manifest: { minimum_client_version: '2.0.0' },
                    state, active: state === 'active', disabled: false, installed: false,
                    support: 'classic-only', missingModules: ['classify'],
                    missingOptional: [], missingDependencies: ['dep'],
                    disabledDependencies: ['dep'], interceptsGeneration: false, loadingOrder: 0,
                },
                '1.18.0',
            );
            expect(text, state).not.toBe('');
        }
    });

    it('reads naturally for one item and for several', () => {
        const status = {
            name: 'x', folder: 'x', scope: 'system' as const, displayName: 'X', manifest: {},
            state: 'missing-modules' as const, active: false, disabled: false, installed: false,
            support: 'classic-only' as const, missingOptional: [], missingDependencies: [],
            disabledDependencies: [], interceptsGeneration: false, loadingOrder: 0,
        };
        expect(explainState({ ...status, missingModules: ['classify'] }, '1.18.0'))
            .toContain('provide classify.');
        expect(explainState({ ...status, missingModules: ['classify', 'caption', 'sd'] }, '1.18.0'))
            .toContain('classify, caption and sd');
    });
});
