import { describe, expect, it } from 'vitest';
import { patchPersonaSettings, type SettingsDocument } from './personas';

const settings: SettingsDocument = {
    // A field this app knows nothing about, which must survive every patch.
    some_legacy_setting: { deeply: { nested: true } },
    power_user: {
        personas: { 'alex.png': 'Alex' },
        persona_descriptions: {
            'alex.png': { description: 'A cartographer.', position: 0, depth: 2 },
        },
        default_persona: 'alex.png',
        other_power_user_field: 'kept',
    },
};

describe('patchPersonaSettings', () => {
    it('does not mutate the input', () => {
        const before = JSON.stringify(settings);
        patchPersonaSettings(settings, { avatar: 'alex.png', name: 'Renamed' });
        expect(JSON.stringify(settings)).toBe(before);
    });

    it('carries unrelated top-level settings through', () => {
        const next = patchPersonaSettings(settings, { avatar: 'new.png', name: 'New' });
        expect(next.some_legacy_setting).toEqual({ deeply: { nested: true } });
    });

    it('carries unrelated power_user fields through', () => {
        const next = patchPersonaSettings(settings, { avatar: 'new.png', name: 'New' });
        expect(next.power_user?.other_power_user_field).toBe('kept');
    });

    it('renames a persona', () => {
        const next = patchPersonaSettings(settings, { avatar: 'alex.png', name: 'Alexandra' });
        expect(next.power_user?.personas?.['alex.png']).toBe('Alexandra');
    });

    it('updates a description without losing its other fields', () => {
        const next = patchPersonaSettings(settings, { avatar: 'alex.png', description: 'A weary one.' });
        expect(next.power_user?.persona_descriptions?.['alex.png']).toEqual({
            description: 'A weary one.',
            position: 0,
            depth: 2,
        });
    });

    it('adds a new persona', () => {
        const next = patchPersonaSettings(settings, {
            avatar: 'nova.png',
            name: 'Nova',
            description: 'A pilot.',
        });
        expect(next.power_user?.personas?.['nova.png']).toBe('Nova');
        expect(next.power_user?.persona_descriptions?.['nova.png']?.description).toBe('A pilot.');
        expect(next.power_user?.personas?.['alex.png']).toBe('Alex');
    });

    it('leaves the name alone when only the description is patched', () => {
        const next = patchPersonaSettings(settings, { avatar: 'alex.png', description: 'x' });
        expect(next.power_user?.personas?.['alex.png']).toBe('Alex');
    });

    it('sets a new default', () => {
        const next = patchPersonaSettings(settings, { avatar: 'nova.png', isDefault: true });
        expect(next.power_user?.default_persona).toBe('nova.png');
    });

    it('clears the default when unsetting the current one', () => {
        const next = patchPersonaSettings(settings, { avatar: 'alex.png', isDefault: false });
        expect(next.power_user?.default_persona).toBeNull();
    });

    it('does not clear the default when unsetting a different persona', () => {
        const next = patchPersonaSettings(settings, { avatar: 'nova.png', isDefault: false });
        expect(next.power_user?.default_persona).toBe('alex.png');
    });

    it('removes a persona and clears it as default', () => {
        const next = patchPersonaSettings(settings, { avatar: 'alex.png', remove: true });
        expect(next.power_user?.personas).toEqual({});
        expect(next.power_user?.persona_descriptions).toEqual({});
        expect(next.power_user?.default_persona).toBeNull();
    });

    it('works on a settings file with no power_user block yet', () => {
        const next = patchPersonaSettings({}, { avatar: 'a.png', name: 'A', description: 'B' });
        expect(next.power_user?.personas).toEqual({ 'a.png': 'A' });
        expect(next.power_user?.persona_descriptions?.['a.png']?.description).toBe('B');
    });
});
