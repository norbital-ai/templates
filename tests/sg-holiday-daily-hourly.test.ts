import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, COMPANY_ID } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

// Employment Act s.88(3); the holiday entitlement and wages for actual holiday work are separate.
// https://www.mom.gov.sg/employment-practices/public-holidays-entitlement-and-pay
// https://www.mom.gov.sg/faq/public-holidays/are-public-holidays-paid-even-when-an-employee-is-not-required-to-work
type Decision = {
	absence_permission: 'YES' | 'NO';
	absence_reasonable_excuse: 'YES' | 'NO';
	absence_decision: string;
};
const unauthorized: Decision = {
	absence_permission: 'NO',
	absence_reasonable_excuse: 'NO',
	absence_decision: 'Synthetic attendance review: neither permission nor reasonable excuse'
};

function day(world: PayrollWorld, date: string, facts?: Decision, worked = false) {
	const id = `sg-earned-holiday-${date}`;
	world.work_days.push({
		id,
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
			id: `${id}-evidence`,
			subject: { collection: 'work_days', id },
			fact_key: 'absence_decision',
			reference: facts.absence_decision,
			received_on: date,
			approval_id: null
		});
}

function payroll(
	frequency: 'DAILY' | 'HOURLY',
	options: {
		absent?: string;
		decision?: Decision;
		workedHoliday?: boolean;
		offDay?: boolean;
	} = {}
) {
	const holiday = options.offDay ? '2026-03-21' : '2026-05-01';
	return buildStatutory(
		{
			code: 'SG',
			period: options.offDay ? '2026-03' : '2026-05',
			people: [
				{
					key: 'SG-EARNED-HOLIDAY',
					wage: frequency === 'DAILY' ? 100 : 12.5,
					pay_frequency: frequency,
					citizenship: 'CITIZEN',
					ordinary_hours_per_week: 40
				}
			]
		},
		(world) => {
			world.companies[0]!.pay_cutoff_day = 1;
			const off = {
				...world.shift_definitions[1]!,
				id: 'sg-earned-off',
				code: 'OFF',
				name: 'Off',
				variant: { kind: 'OFF' }
			};
			world.shift_definitions.push(off);
			world.shift_patterns[0]!.pattern.days[5] = { roster_code_id: off.id };
			world.jurisdiction_holidays.push({
				id: `sg-earned-public-${holiday}`,
				company_id: COMPANY_ID,
				date: holiday,
				name: options.offDay ? 'Hari Raya Puasa' : 'Labour Day',
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

// Both rates buy an eight-hour $100 day. The five-day monthly equivalent is $2,166.67,
// within Part 4's $2,600 non-workman threshold. May has 21 weekdays; March has 22.
for (const frequency of ['DAILY', 'HOURLY'] as const) {
	const slip = (options: Parameters<typeof payroll>[1] = {}) =>
		payroll(frequency, options).slips.get('SG-EARNED-HOLIDAY')!;

	test(`Singapore ${frequency} — unauthorized prior-month absence forfeits working-day holiday entitlement`, () => {
		assert.equal(slip({ absent: '2026-04-30', decision: unauthorized }).gross, 2000);
	});

	test(`Singapore ${frequency} — unauthorized following absence forfeits working-day holiday entitlement`, () => {
		assert.equal(slip({ absent: '2026-05-04', decision: unauthorized }).gross, 1900);
	});

	for (const [label, decision] of [
		['permission', { ...unauthorized, absence_permission: 'YES' }],
		['reasonable excuse', { ...unauthorized, absence_reasonable_excuse: 'YES' }]
	] as const)
		test(`Singapore ${frequency} — ${label} protects working-day holiday entitlement`, () => {
			assert.equal(slip({ absent: '2026-05-04', decision }).gross, 2000);
		});

	test(`Singapore ${frequency} — unknown adjacent absence protects entitlement and warns`, () => {
		const result = payroll(frequency, { absent: '2026-05-04' });
		assert.equal(result.slips.get('SG-EARNED-HOLIDAY')!.gross, 2000);
		assert.ok(
			result.warnings.some((warning) =>
				/absence.*(permission|excuse|decision|evidence)/i.test(warning)
			)
		);
	});

	test(`Singapore ${frequency} — forfeiture preserves separate wages for actual holiday work`, () => {
		const result = slip({ absent: '2026-05-04', decision: unauthorized, workedHoliday: true });
		assert.equal(result.gross, 2000);
		assert.equal(result.adjustments.find((row) => row.label === 'OT-1.0X')!.amount, 100);
	});

	test(`Singapore ${frequency} — no adjacent absence preserves working-day holiday entitlement`, () => {
		assert.equal(slip().gross, 2100);
	});

	test(`Singapore ${frequency} — unauthorized absence forfeits the off-day holiday award`, () => {
		const result = slip({ offDay: true, absent: '2026-03-20', decision: unauthorized });
		assert.equal(result.gross, 2100);
		assert.equal(result.adjustments.filter((row) => row.label === 'PH-NON-WORKING-DAY').length, 0);
	});

	test(`Singapore ${frequency} — consent preserves the off-day holiday award`, () => {
		const result = slip({
			offDay: true,
			absent: '2026-03-20',
			decision: { ...unauthorized, absence_permission: 'YES' }
		});
		assert.equal(result.gross, 2200);
		assert.equal(result.adjustments.find((row) => row.label === 'PH-NON-WORKING-DAY')!.amount, 100);
	});

	test(`Singapore ${frequency} — no adjacent absence preserves the off-day holiday award`, () => {
		const result = slip({ offDay: true });
		assert.equal(result.gross, 2300);
		assert.equal(result.adjustments.find((row) => row.label === 'PH-NON-WORKING-DAY')!.amount, 100);
	});
}
