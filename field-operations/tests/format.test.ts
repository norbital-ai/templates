import { expect, it } from '@effect/vitest';
import { dayOf } from '../src/lib/format.js';
import { senderName } from '../src/lib/dispatch.js';
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
it('names a sender by its member, never by a raw provider identity', () => {
	const members = [
		{
			id: '01990000-0000-7000-8002-000000000001',
			name: 'Bob',
			email: 'bob@x.test',
			phone: '+6581234567'
		}
	];
	expect(senderName('6581234567@s.whatsapp.net', members)).toBe('Bob');
	expect(senderName('01990000-0000-7000-8002-000000000001', members)).toBe('Bob');
	expect(senderName('BOB@x.test', members)).toBe('Bob');
	expect(senderName('6591111111@s.whatsapp.net', members)).toBe('+6591111111');
	expect(senderName('120363@g.us', members)).toBeNull();
	expect(senderName('01990000-0000-7000-8002-000000000009', members)).toBeNull();
	expect(senderName('~ B', members)).toBe('~ B');
});
