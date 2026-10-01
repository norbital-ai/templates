// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * A floor that substitutes itself for a lower contract (`wages.substitutes_below`) binds only the
 * work performed while it is in force: a rise effective mid-month re-rates the days from its
 * effective date, and the days before keep the agreed wage the earlier floor did not break.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { raiseToMinimumWage } from '../src/lib/payroll/contribution.ts';
import { measureContractSegments } from '../src/lib/payroll/work.ts';

const version = (id: string, from: string, to: string | null, floor: number) => ({
	id,
	code: 'X',
	jurisdiction_code: 'X',
	sealed_at: '2026-01-01',
	voided_at: null,
	approval_id: null,
	effective_range: { from, to },
	payroll: { currency: 'XXX' },
	work_rules: {
		proration: { by: 'CALENDAR_DAYS' },
		wages: { by_region: { R: floor }, substitutes_below: true }
	}
});

test('a floor rising on 16 March re-rates only 16–31 March of a 1,050 monthly contract', () => {
	const before = version('v1', '2026-01-01', '2026-03-15', 1000);
	const after = version('v2', '2026-03-16', null, 1100);
	const configuration = {
		jurisdiction: after,
		lineageVersions: [before, after],
		work: { ...after.work_rules, settings_id: after.id, jurisdiction_code: 'X' },
		company: { id: 'co', region: 'R' },
		patternById: new Map([
			[
				'week',
				{
					id: 'week',
					effective_range: { from: '2025-01-01', to: null },
					pattern: {
						expectation: {
							days_per_week: 5,
							minimum_paid_minutes_per_week: null,
							maximum_paid_minutes_per_week: null
						}
					}
				}
			]
		]),
		shiftById: new Map(),
		catalogueComponents: [],
		allowanceCodeById: new Map(),
		companyFactRevisions: []
	};
	const term = {
		id: 'terms-1',
		employment_type: 'PERMANENT',
		pay_frequency: 'MONTHLY',
		base_salary: 1050,
		currency: 'XXX',
		shift_pattern_id: 'week',
		effective_range: { from: '2025-01-01', to: null }
	};
	const march = { start: '2026-03-01', end: '2026-03-31' };
	const bundle = {
		employment: {
			id: 'job',
			employee_number: 'E1',
			effective_range: { from: '2025-01-01', to: null }
		},
		employee: { date_of_birth: '1990-01-01' },
		children: [],
		window: { salary: march, attendance: march },
		employedDays: march,
		terms: [term],
		termsHistory: [term],
		workDays: [],
		payRequests: []
	};
	const { bundles, issues } = raiseToMinimumWage(configuration, [bundle]);
	const raised = bundles[0];
	// 1,050 meets the 1,000 floor to 15 March and breaks the 1,100 floor from 16 March.
	assert.deepEqual(
		raised.termsHistory.map((row) => [row.id, row.base_salary, row.effective_range]),
		[
			['terms-1', 1050, { from: '2025-01-01', to: '2026-03-15' }],
			['terms-1', 1100, { from: '2026-03-16', to: null }]
		]
	);
	assert.equal(raised.terms.length, 2);
	assert.equal(issues.length, 1);
	assert.match(issues[0].message, /pays 1100 in place of the agreed 1050/);
	// Calendar-day proration prices each piece: 1,050 × 15/31 + 1,100 × 16/31 = 33,350/31 = 1,075.81
	// (the whole month at the new floor would be 1,100).
	const basic = measureContractSegments({
		component: { code: 'BASIC', destination: 'PAY', direction: 'ADD' },
		bundle: raised,
		configuration,
		salary: march,
		employed: march,
		contracted: march,
		workingDaysIn: () => 0,
		contractOf: (row) => row.base_salary
	});
	assert.equal(basic.amount, 1075.81);
	assert.deepEqual(
		basic.proration.map((segment) => [
			segment.from,
			segment.to,
			segment.days,
			segment.contract_amount
		]),
		[
			['2026-03-01', '2026-03-15', 15, 1050],
			['2026-03-16', '2026-03-31', 16, 1100]
		]
	);
});
