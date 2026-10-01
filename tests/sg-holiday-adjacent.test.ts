import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, COMPANY_ID } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

// Employment Act s.88(3); MOM primary guidance:
// https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay
// https://www.mom.gov.sg/faq/public-holidays/are-public-holidays-paid-even-when-an-employee-is-not-required-to-work
// Hari Raya Puasa: Saturday 21 March 2026. Monthly salary $3,000, 22 March weekdays;
// absence deduction $3,000 / 22 = $136.36. Off-day holiday award, where eligible:
// Third Schedule gross day = $3,000 × 12 / (52 × 5) = $138.46.
type Decision = {
	absence_permission: 'YES' | 'NO';
	absence_reasonable_excuse: 'YES' | 'NO';
	absence_decision: string;
};
const unauthorized: Decision = {
	absence_permission: 'NO',
	absence_reasonable_excuse: 'NO',
	absence_decision: 'Synthetic attendance review 2026-03-20'
};

function day(world: PayrollWorld, date: string, facts?: Decision, worked = false) {
	world.work_days.push({
		id: `sg-adjacent-${date}`,
		employment_id: world.employments[0]!.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: worked
			? [
					{ start: `${date}T09:00:00+08:00`, end: `${date}T13:00:00+08:00` },
					{ start: `${date}T14:00:00+08:00`, end: `${date}T18:00:00+08:00` }
				]
			: [],
		...(worked ? { approved_overtime_hours: 8 } : {}),
		...(facts == null ? {} : { facts }),
		approval_id: null
	});
	if (facts != null)
		world.fact_evidence!.push({
			id: `sg-adjacent-evidence-${date}`,
			subject: { collection: 'work_days', id: `sg-adjacent-${date}` },
			fact_key: 'absence_decision',
			reference: facts.absence_decision,
			received_on: date,
			approval_id: null
		});
}

function payroll(
	options: {
		absent?: string;
		decision?: Decision;
		workedHoliday?: boolean;
		period?: string;
		holiday?: string;
		workClass?: string;
	} = {}
) {
	const holiday = options.holiday ?? '2026-03-21';
	return buildStatutory(
		{
			code: 'SG',
			period: options.period ?? '2026-03',
			people: [
				{
					key: 'SG-ADJACENT',
					wage: 3000,
					citizenship: 'CITIZEN',
					...(options.workClass == null ? {} : { work_classification: options.workClass })
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			const off = {
				...world.shift_definitions[1]!,
				id: 'sg-adjacent-off',
				code: 'OFF',
				name: 'Off',
				variant: { kind: 'OFF' }
			};
			world.shift_definitions.push(off);
			world.shift_patterns[0]!.pattern.days[5] = { roster_code_id: off.id };
			world.jurisdiction_holidays.push({
				id: `sg-holiday-${holiday}`,
				company_id: COMPANY_ID,
				date: holiday,
				name: holiday === '2026-03-21' ? 'Hari Raya Puasa' : 'Labour Day',
				kind: 'PUBLIC_HOLIDAY',
				given_to: 'EVERYONE',
				replaces: null,
				source: null,
				published_at: '2025-12-01T00:00:00.000Z',
				approval_id: null
			});
			day(world, holiday, undefined, options.workedHoliday);
			if (options.absent != null) day(world, options.absent, options.decision);
		}
	);
}

const slip = (options: Parameters<typeof payroll>[0] = {}) =>
	payroll(options).slips.get('SG-ADJACENT')!;

test('Singapore — unauthorized Friday absence forfeits Saturday holiday pay', () => {
	const result = slip({ absent: '2026-03-20', decision: unauthorized });
	assert.equal(result.gross, 2863.64);
	assert.equal(result.adjustments.filter((row) => row.label === 'PH-NON-WORKING-DAY').length, 0);
});

for (const [label, decision] of [
	['permission', { ...unauthorized, absence_permission: 'YES' }],
	['reasonable excuse', { ...unauthorized, absence_reasonable_excuse: 'YES' }]
] as const)
	test(`Singapore — ${label} protects Saturday holiday pay despite Friday absence`, () => {
		// The underlying absence remains unpaid; permission/excuse protects the holiday only.
		const result = slip({ absent: '2026-03-20', decision });
		assert.equal(result.gross, 3002.1);
		assert.equal(
			result.adjustments.find((row) => row.label === 'PH-NON-WORKING-DAY')!.amount,
			138.46
		);
	});

test('Singapore — unauthorized Monday absence also forfeits Saturday holiday pay', () => {
	assert.equal(slip({ absent: '2026-03-23', decision: unauthorized }).gross, 2863.64);
});

test('Singapore — forfeiture preserves wages for actual work on the holiday', () => {
	const result = slip({
		period: '2026-05',
		holiday: '2026-05-01',
		absent: '2026-05-04',
		decision: unauthorized,
		workedHoliday: true
	});
	// Labour Day is a working Friday. May has 21 weekdays; the following Monday is absent.
	// $3,000 − (2 × $3,000 / 21) = $2,714.29 after absence and holiday-pay forfeiture;
	// preserve the separate basic day's award for actual holiday work: $138.46.
	assert.equal(result.gross, 2852.75);
	assert.equal(result.adjustments.find((row) => row.label === 'OT-1.0X')!.amount, 138.46);
});

test('Singapore — adjacent absence across the month boundary forfeits the next holiday', () => {
	// Labour Day Friday 1 May; Thursday 30 April is immediately before it.
	// May has 21 weekdays: only May holiday pay $3,000/21 = $142.86 is lost in May.
	assert.equal(
		slip({ period: '2026-05', holiday: '2026-05-01', absent: '2026-04-30', decision: unauthorized })
			.gross,
		2857.14
	);
});

test('Singapore — missing adjacent absence decision cannot establish holiday forfeiture', () => {
	const result = payroll({ absent: '2026-03-20' });
	assert.equal(result.slips.get('SG-ADJACENT')!.gross, 3002.1);
	assert.ok(
		result.warnings.some((warning) =>
			/absence.*(permission|excuse|decision|evidence)/i.test(warning)
		)
	);
});

test('Singapore — no recorded adjacent absence preserves the off-day holiday award', () => {
	const result = slip();
	assert.equal(result.gross, 3138.46);
	assert.equal(
		result.adjustments.find((row) => row.label === 'PH-NON-WORKING-DAY')!.amount,
		138.46
	);
});

test('Singapore — next-month unauthorized absence forfeits the current working-day holiday', () => {
	assert.equal(
		slip({ period: '2026-06', holiday: '2026-06-30', absent: '2026-07-01', decision: unauthorized })
			.gross,
		2863.64
	);
});

test('Singapore — statutory holiday forfeiture excludes employment outside the Employment Act', () => {
	const result = payroll({
		period: '2026-05',
		holiday: '2026-05-01',
		absent: '2026-05-04',
		decision: unauthorized,
		workClass: 'NON_EA'
	});
	assert.equal(result.slips.get('SG-ADJACENT')!.gross, 2857.14);
});
