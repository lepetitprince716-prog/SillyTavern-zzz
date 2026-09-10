import { describe, expect, it } from 'vitest';
import { substituteMacros, tidy } from './macros';

const base = { char: 'Seraphina', user: 'Alex' };

describe('substituteMacros', () => {
    it('replaces the name macros and their aliases', () => {
        expect(substituteMacros('{{char}} greets {{user}}.', base)).toBe('Seraphina greets Alex.');
        expect(substituteMacros('{{bot}} / {{username}}', base)).toBe('Seraphina / Alex');
    });

    it('is case-insensitive', () => {
        expect(substituteMacros('{{Char}} and {{USER}}', base)).toBe('Seraphina and Alex');
    });

    it('resolves macros nested inside a substituted value', () => {
        const result = substituteMacros('{{description}}', {
            ...base,
            description: 'A guardian who protects {{user}}.',
        });
        expect(result).toBe('A guardian who protects Alex.');
    });

    it('leaves unknown macros untouched so other consumers can handle them', () => {
        expect(substituteMacros('{{getvar::hp}} and {{char}}', base)).toBe('{{getvar::hp}} and Seraphina');
    });

    it('picks from a random list deterministically when given a seed', () => {
        const result = substituteMacros('{{random: red, green, blue}}', { ...base, random: () => 0.5 });
        expect(result).toBe('green');
    });

    it('accepts double-pipe separated choices', () => {
        const result = substituteMacros('{{random:a||b}}', { ...base, random: () => 0 });
        expect(result).toBe('a');
    });

    it('never overruns the choice list when random returns 1', () => {
        expect(substituteMacros('{{random:a,b}}', { ...base, random: () => 1 })).toBe('b');
    });

    it('rolls dice', () => {
        expect(substituteMacros('{{roll:2d6}}', { ...base, random: () => 0.5 })).toBe('8');
        expect(substituteMacros('{{roll:20}}', { ...base, random: () => 0 })).toBe('1');
    });

    it('returns an empty string for an unparsable roll', () => {
        expect(substituteMacros('{{roll:banana}}', base)).toBe('');
    });

    it('expands {{newline}}', () => {
        expect(substituteMacros('a{{newline}}b', base)).toBe('a\nb');
    });

    it('short-circuits text with no macros', () => {
        expect(substituteMacros('plain text', base)).toBe('plain text');
        expect(substituteMacros('', base)).toBe('');
    });

    it('does not loop forever on a self-referential macro', () => {
        const result = substituteMacros('{{description}}', {
            ...base,
            description: '{{description}}',
        });
        expect(result).toBe('{{description}}');
    });
});

describe('tidy', () => {
    it('collapses blank line runs and trims', () => {
        expect(tidy('a\n\n\n\nb\n\n')).toBe('a\n\nb');
    });

    it('normalises CRLF', () => {
        expect(tidy('a\r\nb')).toBe('a\nb');
    });
});
