import { expect, it as test } from '@effect/vitest';
import { fixtureId } from './test-runtime.js';
import { agingSummary, creditTotals, overdueTotals } from '../src/lib/reports.js';
import { blockedDrafts } from '../src/app/operations/dashboard/blocked-drafts.js';

test('a draft is blocked by missing payment terms, no lines, or an open request on it or one of its lines', () => {
	const order = (n: number) => fixtureId('orders', `00000000-0000-4000-8000-00000000010${n}`);
	const terms = fixtureId('settlements', '00000000-0000-4000-8000-000000000201');
	const held = {
		request_id: 'request-1',
		state: 'Pending',
		step: 0,
		steps: [],
		requested_by: 'member:sales-1'
	} as const;
	expect(
		blockedDrafts(
			[
				{ id: order(1), payment_terms: terms, line_count: 2 },
				{ id: order(2), payment_terms: null, line_count: 0 },
				{ id: order(3), payment_terms: terms, line_count: 1, $approval: held },
				{ id: order(4), payment_terms: terms, line_count: 1 }
			],
			[{ order: order(1) }, { order: order(4), $approval: held }]
		)
	).toEqual([
		{ order: order(2), reasons: ['no_terms', 'no_lines'] },
		{ order: order(3), reasons: ['approval'] },
		{ order: order(4), reasons: ['approval'] }
	]);
});

test('overdue receivables and credit exceptions total per currency, never across currencies', () => {
	const ledger = fixtureId('sys_integration', 'kingdee');
	const entry = (
		fields: Partial<Parameters<typeof agingSummary>[0][number]>
	): Parameters<typeof agingSummary>[0][number] => ({
		contact_id: null,
		order: null,
		order_number: '',
		invoice: null,
		ledger,
		ledger_name: 'Primary',
		party: 'a',
		party_name: 'Customer A',
		reference: 'INV',
		currency: 'CNY',
		issued_on: '2026-09-01',
		due_on: '2026-10-01',
		settled_on: null,
		settlement: null,
		delivered_on: null,
		as_of: '2026-11-20',
		bucket: '31_60',
		balance: '10',
		unapplied: '0',
		overpaid: '0',
		credit: '0',
		...fields
	});
	expect(
		overdueTotals(
			agingSummary([
				entry({}),
				entry({ bucket: 'over_90', balance: '5' }),
				entry({ party: 'b', bucket: 'not_due', due_on: '2026-12-01', balance: '7' }),
				entry({ party: 'c', currency: 'USD', bucket: '1_30', balance: '3' })
			])
		)
	).toEqual([
		{ currency: 'CNY', customers: 1, overdue: '15' },
		{ currency: 'USD', customers: 1, overdue: '3' }
	]);
	expect(
		creditTotals([
			{ currency: 'CNY', overdue: '15', over_limit: null },
			{ currency: 'CNY', overdue: null, over_limit: '4.5' },
			{ currency: 'USD', overdue: '3', over_limit: '1' }
		])
	).toEqual([
		{
			currency: 'CNY',
			customers: 2,
			figures: [
				{ field: 'overdue', value: '15' },
				{ field: 'over_limit', value: '4.5' }
			]
		},
		{
			currency: 'USD',
			customers: 1,
			figures: [
				{ field: 'overdue', value: '3' },
				{ field: 'over_limit', value: '1' }
			]
		}
	]);
});
