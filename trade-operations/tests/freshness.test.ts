import { expect, it } from '@effect/vitest';
import { confirmedAt, feeds } from '../src/integration/kingdee/connection-status.js';

const NOW = '2026-11-19T10:00:00.000Z';
const connected = (failing?: Record<string, string>) => ({
	active: true,
	status: { state: 'connected', databaseVerified: true, ...(failing ? { failing } : {}) }
});

it('a feed is as fresh as its ledger confirms: current while connected, as old as its failures', () => {
	expect(confirmedAt(connected(), feeds.stock, NOW)).toBe(NOW);
	const since = '2026-11-19T09:20:00.000Z';
	expect(confirmedAt(connected({ [feeds.stock]: since }), feeds.stock, NOW)).toBe(since);
	// another feed failing says nothing about this one
	expect(confirmedAt(connected({ [feeds.credit]: since }), feeds.stock, NOW)).toBe(NOW);
	expect(confirmedAt({ ...connected(), active: false }, feeds.stock, NOW)).toBeNull();
	expect(
		confirmedAt({ active: true, status: { state: 'connected' } }, feeds.stock, NOW)
	).toBeNull();
	expect(confirmedAt({ active: true, status: null }, feeds.stock, NOW)).toBeNull();
});
