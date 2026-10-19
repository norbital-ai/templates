import { expect, it } from '@effect/vitest';
import { dayOf } from '../src/lib/format.js';
it.each([
	[null, null],
	['', null],
	['2024-02-29', '2024-02-29'],
	['2025-02-29', null],
	['1900-02-29', null],
	['2000-02-29', '2000-02-29'],
	['2026-10-12', '2026-10-12'],
	['2026-13-01', null],
	['2026-04-31', null],
	['2026-10-12T00:00:00Z', null],
	[' 2026-10-12', null],
	['2026-10-12 ', null]
] as const)('keeps native date validation for %s', (input, expected) => {
	expect(dayOf(input)).toBe(expected);
});
