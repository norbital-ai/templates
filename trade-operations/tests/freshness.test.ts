import { BigDecimal } from 'effect';
import { expect, it } from '@effect/vitest';
import { confirmedAt, feeds } from '../src/integration/kingdee/connection-status.js';
import { creditWarning } from '../src/lib/commercial.js';

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

it('credit stays usable through a blip and goes stale once its feed has failed past the limit', () => {
	const order = { currency: 'CNY', direction: 'sales' } as const;
	const credit = {
		currency: 'CNY',
		credit_hold: false,
		credit_limit: '100',
		credit_used: '10'
	} as const;
	const gross = BigDecimal.fromBigInt(5n);
	const at = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
	expect(creditWarning(order, gross, credit, NOW, NOW, 15)).toEqual({
		warning: false,
		unavailable: false
	});
	expect(creditWarning(order, gross, credit, at(14), NOW, 15).unavailable).toBe(false);
	expect(creditWarning(order, gross, credit, at(16), NOW, 15)).toEqual({
		warning: true,
		unavailable: true
	});
	expect(creditWarning(order, gross, credit, null, NOW, 15).unavailable).toBe(true);
});
