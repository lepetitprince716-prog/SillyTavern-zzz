import type { Character } from '@/api/types';

/** Cards store `fav` as a boolean or the string "true", depending on vintage. */
export function isFavourite(character: Character): boolean {
    return character.fav === true || character.fav === 'true';
}
