import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import payslips from '../src/collections/payslips/+collection.ts';
import holds from '../src/collections/payment_holds/+collection.ts';
import { transformOne, transformSync } from './helpers/transform.ts';

const storedSlip = {
	id: 'p1',
	payroll_run_id: 'r1',
	employment_id: 'e1',
	status: 'DRAFT',
	paid_at: null,
	currency: 'MYR',
	unfunded_contributions: 0,
	funding_received: 0
};

const db = (openHolds: readonly Record<string, unknown>[]) => ({
	payroll_runs: {
		findMany: () => Effect.succeed([{ id: 'r1', company_id: 'c1', period: '2026-01' }])
	},
	payslips: { findMany: () => Effect.succeed([]) },
	payment_holds: { findMany: () => Effect.succeed(openHolds) }
});

test('an open disbursement hold stops a payslip being marked paid', () => {
	assert.throws(
		() =>
			transformOne(
				payslips,
				{ status: 'PAID', paid_at: '2026-01-31T00:00:00.000Z' },
				storedSlip,
				db([{ employment_id: 'e1', directive_reference: 'IR21-2026-1' }])
			),
		/Disbursement hold IR21-2026-1 is open/
	);
	const saved = transformOne(
		payslips,
		{ status: 'PAID', paid_at: '2026-01-31T00:00:00.000Z' },
		storedSlip,
		db([])
	);
	assert.equal(saved.status, 'PAID');
});

test('a released hold records the directive and cannot exceed the amount held', () => {
	const employment = { id: 'e1' };
	const version = {
		id: 'v1',
		code: 'MY',
		payroll: { currency: 'MYR', timezone: 'Asia/Kuala_Lumpur', tax_year_start_month: 1 },
		effective_range: { start: '2020-01-01', end: null },
		sealed_at: '2020-01-01T00:00:00.000Z',
		voided_at: null,
		approval_id: null
	};
	const schemaDb = {
		employments: {
			findMany: () => Effect.succeed([{ id: 'e1', employment_company: { settings_code: 'MY' } }])
		},
		jurisdiction_settings: { findMany: () => Effect.succeed([version]) }
	};
	const row = (extra: Record<string, unknown>) => ({
		employment_id: employment.id,
		category: 'TAX_CLEARANCE',
		directive_reference: 'IR21-2026-1',
		amount: 1000,
		held_on: '2026-01-20T00:00:00.000Z',
		...extra
	});
	assert.throws(
		() =>
			transformOne(
				holds,
				row({ released_on: '2026-02-01T00:00:00.000Z', released_amount: 1000 }),
				undefined,
				schemaDb
			),
		/Releasing a hold requires the directive that released it/
	);
	assert.throws(
		() =>
			transformOne(
				holds,
				row({
					released_on: '2026-02-01T00:00:00.000Z',
					released_amount: 1500,
					reconciliation_reference: 'CLEARANCE-1'
				}),
				undefined,
				schemaDb
			),
		/released amount cannot exceed the held amount/
	);
	assert.throws(
		() =>
			transformOne(
				holds,
				row({
					held_on: '2026-02-01T00:00:00.000Z',
					released_on: '2026-01-20T00:00:00.000Z',
					released_amount: 100,
					reconciliation_reference: 'CLEARANCE-1'
				}),
				undefined,
				schemaDb
			),
		/cannot be released before it was placed/
	);
	const saved = transformSync(
		holds,
		[
			row({
				released_on: '2026-02-01T00:00:00.000Z',
				released_amount: 1000,
				reconciliation_reference: 'CLEARANCE-1'
			})
		],
		{ db: schemaDb }
	);
	assert.equal(saved.length, 1);
});
