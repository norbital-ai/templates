import { expect, it } from '@effect/vitest';
import { joinName } from '../src/lib/join-name.js';

it('keeps the two names separated, including a missing side', () => {
	expect(joinName('Steel', 'Tower')).toBe('Steel · Tower');
	expect(joinName(undefined, 'Tower')).toBe('— · Tower');
	expect(joinName('Steel', undefined)).toBe('Steel · —');
});
