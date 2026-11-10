// What Chinese statute and the Shanghai and Kunming rules condition on leave and its pay: dated facts open the days, a
// region picks its figure, and a share the wage does not pay comes off the salary. The figures are synthetic: these prove the
// mechanism, not the seeded law.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from '@effect/vitest';
import { TestWorkspace, type Kit } from '@norbital-ai/bolt-cli/test';
import { Effect, Schema } from 'effect';
import type { LeavePerson } from '../src/lib/ledger/entitlement.ts';
import { entitlementOf } from '../src/lib/ledger/entitlement.ts';
import { entitlementPlans } from '../src/lib/ledger/service.ts';
import type { JsonObject } from '../src/lib/payroll_engine/contracts.ts';
import { evaluate } from '../src/lib/payroll_engine/expressions.ts';
import { PayslipBreakdown } from '../src/lib/payroll_engine/payslip_breakdown.ts';
import { paidShareOf, payBasis } from '../src/lib/payroll_engine/engine.ts';
import { eventOn, eventsOf } from '../src/lib/ledger/core.ts';
import { idOf, objectValue } from '../src/lib/payroll_engine/reads.ts';
import {
	ENTITY,
	accountsIn,
	catalogRow,
	measureOf,
	pack,
	read,
	syncAll,
	uuid,
	wholeDays,
	workspace,
	leaveCreate
} from './kit.ts';

const ROOT = 'seed/public/jurisdiction/CN';
const file = (version: number, name: string) =>
	read(join(ROOT, `version_${version}`, `${name}.json`));
const leaveRow = (code: string, version = 2) => {
	const row = file(version, 'leave_catalog').find((item) => item.code === code);
	assert.ok(row !== undefined, code);
	return row;
};
const lookupOf = (code: string, version = 2) => objectValue(leaveRow(code, version).lookup);

type Person = {
	readonly region?: string;
	readonly gender?: string;
	readonly events?: readonly JsonObject[];
	readonly facts?: JsonObject;
	readonly term_facts?: JsonObject;
	readonly started?: string;
};
const personOf = ({
	region = 'SH',
	gender = 'FEMALE',
	events = [],
	facts = {},
	term_facts = {},
	started = '2020-01-01'
}: Person): LeavePerson => {
	const native = Array.isArray(facts.family) ? { family: facts.family } : {};
	const extensionFacts = Object.fromEntries(
		Object.entries(facts).filter(([key]) => key !== 'family')
	);
	return {
		started,
		partTime: false,
		gender,
		maritalStatus: 'MARRIED',
		employment: {
			service_started_on: started,
			effective_range: { from: started, to: null },
			events,
			...native,
			employee_extension_data: { ...extensionFacts, ...term_facts }
		},
		employer: { entity_extension_data: { region } }
	};
};
/** What the events on a contract open of a row, by period. */
const opened = (code: string, person: Person, law: JsonObject = {}) => {
	const events = person.events ?? [];
	return Object.fromEntries(
		entitlementPlans(
			[{ account: 'leave', code, lookup: { ...lookupOf(code), ...law } }],
			personOf(person),
			{
				scope: 'CN',
				started: '2020-01-01',
				events: events.map((event) => ({ kind: String(event.kind), on: String(event.on) }))
			},
			'balance',
			{},
			'2026-06-15'
		).map((plan) => [
			String(plan.source.split(':').at(-1)),
			plan.wanted.reduce((total, row) => total + row.amount, 0)
		])
	);
};
const yearly = (code: string, person: Person, on: string, law: JsonObject = {}) =>
	entitlementOf({ ...lookupOf(code), ...law }, personOf(person), on);

describe('dated facts open maternity leave', () => {
	const LAW = {
		grant_days: 100,
		prenatal_days: 10,
		difficult_birth_extra_days: 7,
		additional_baby_extra_days: 5,
		miscarriage_month_threshold: 3,
		miscarriage_under_threshold_days: 2,
		miscarriage_from_threshold_days: 4
	};
	const open = (events: readonly JsonObject[], gender = 'FEMALE') =>
		opened('MATERNITY_LEAVE', { events, gender }, LAW);
	it('adds a difficult birth and each further baby to the birth', () => {
		assert.deepEqual(
			open([
				{ kind: 'CHILD_BIRTH', on: '2026-03-02' },
				{ kind: 'DIFFICULT_BIRTH', on: '2026-03-02' },
				{ kind: 'ADDITIONAL_BABY', on: '2026-03-02' },
				{ kind: 'ADDITIONAL_BABY', on: '2026-03-02' }
			]),
			{ 'CN.E.2026-03-02': 117 }
		);
	});
	it('takes the days before the birth out of the same grant, up to the statute’s share', () => {
		assert.deepEqual(
			open([
				{ kind: 'CONFINEMENT', on: '2026-02-26' },
				{ kind: 'CHILD_BIRTH', on: '2026-03-02' }
			]),
			{ 'CN.E.2026-02-26': 4, 'CN.E.2026-03-02': 96 }
		);
		assert.deepEqual(
			open([
				{ kind: 'CONFINEMENT', on: '2026-02-01' },
				{ kind: 'CHILD_BIRTH', on: '2026-03-02' }
			]),
			{ 'CN.E.2026-02-01': 10, 'CN.E.2026-03-02': 90 }
		);
		assert.deepEqual(open([{ kind: 'CONFINEMENT', on: '2026-02-26' }]), { 'CN.E.2026-02-26': 10 });
	});
	it('does not let an earlier confinement reach a later birth', () => {
		assert.deepEqual(
			open([
				{ kind: 'CONFINEMENT', on: '2024-02-26' },
				{ kind: 'CHILD_BIRTH', on: '2024-03-02' },
				{ kind: 'CHILD_BIRTH', on: '2026-03-02' }
			]),
			{ 'CN.E.2024-02-26': 5, 'CN.E.2024-03-02': 95, 'CN.E.2026-03-02': 100 }
		);
	});
	it('counts a miscarriage by how far the pregnancy had come', () => {
		const lost = (pregnant: string) =>
			open([
				{ kind: 'PREGNANCY', on: pregnant },
				{ kind: 'MISCARRIAGE', on: '2026-03-02' }
			]);
		assert.deepEqual(lost('2026-01-02'), { 'CN.E.2026-03-02': 2 });
		assert.deepEqual(lost('2025-12-02'), { 'CN.E.2026-03-02': 4 });
		assert.deepEqual(open([{ kind: 'MISCARRIAGE', on: '2026-03-02' }]), { 'CN.E.2026-03-02': 2 });
	});
	it('opens nothing for a man', () => {
		assert.deepEqual(open([{ kind: 'CHILD_BIRTH', on: '2026-03-02' }], 'MALE'), {});
	});
});

describe('a region picks the days', () => {
	const BIRTH = [{ kind: 'CHILD_BIRTH', on: '2026-03-02' }];
	const TABLE = {
		days_by_region: [
			{ region: 'SH', days: 3 },
			{ region: 'KM', days: 9 }
		]
	};
	const PERIOD = 'CN.E.2026-03-02';
	it('on the rows a birth or a marriage opens', () => {
		for (const [code, gender] of [
			['MATERNITY_EXTENSION', 'FEMALE'],
			['PATERNITY_LEAVE', 'MALE']
		] as const) {
			assert.deepEqual(opened(code, { events: BIRTH, gender }, TABLE), { [PERIOD]: 3 });
			assert.deepEqual(opened(code, { events: BIRTH, gender, region: 'KM' }, TABLE), {
				[PERIOD]: 9
			});
		}
		assert.deepEqual(
			opened(
				'MARRIAGE_EXTENSION',
				{ events: [{ kind: 'MARRIAGE', on: '2026-03-02' }], region: 'KM' },
				TABLE
			),
			{ [PERIOD]: 9 }
		);
	});
	it('gives no extension for a miscarriage', () => {
		assert.deepEqual(
			opened('MATERNITY_EXTENSION', { events: [{ kind: 'MISCARRIAGE', on: '2026-03-02' }] }, TABLE),
			{}
		);
	});
	it('gives a region without the rule nothing', () => {
		const shanghaiOnly = { days_by_region: [{ region: 'SH', days: 3 }] };
		const pregnant = [{ kind: 'PREGNANCY', on: '2026-03-02' }];
		assert.deepEqual(opened('PRENATAL_LEAVE', { events: pregnant }, shanghaiOnly), { [PERIOD]: 3 });
		assert.deepEqual(opened('PRENATAL_LEAVE', { events: pregnant, region: 'KM' }, shanghaiOnly), {
			[PERIOD]: 0
		});
		assert.deepEqual(opened('NURSING_LEAVE', { events: BIRTH }, shanghaiOnly), { [PERIOD]: 3 });
	});
	it('reads a surgery’s days from the event', () => {
		const law = {
			days_by_surgery_by_region: [
				{ region: 'SH', surgery: 'VASECTOMY', days: 4 },
				{ region: 'KM', surgery: 'VASECTOMY', days: 6 }
			]
		};
		const events = [{ kind: 'VASECTOMY', on: '2026-03-02' }];
		assert.deepEqual(opened('FAMILY_PLANNING_LEAVE', { events, gender: 'MALE' }, law), {
			[PERIOD]: 4
		});
		assert.deepEqual(
			opened('FAMILY_PLANNING_LEAVE', { events, gender: 'MALE', region: 'KM' }, law),
			{ [PERIOD]: 6 }
		);
	});
	it('counts the children still under the age limit', () => {
		const law = {
			child_age_limit_years: 2,
			per_child_days_by_region: [{ region: 'SH', days: 3 }],
			days_by_children_by_region: [
				{ region: 'KM', children: 0, days: 0 },
				{ region: 'KM', children: 1, days: 8 },
				{ region: 'KM', children: 2, days: 11 }
			]
		};
		const events = [
			{ kind: 'CHILD_BIRTH', on: '2025-01-10' },
			{ kind: 'CHILD_BIRTH', on: '2026-02-10' }
		];
		const days = (on: string, region: string) =>
			yearly('CHILDCARE_LEAVE', { events, region }, on, law);
		assert.equal(days('2026-06-15', 'SH'), 6);
		assert.equal(days('2027-01-10', 'SH'), 3);
		assert.equal(days('2028-02-10', 'SH'), 0);
		assert.equal(days('2026-06-15', 'KM'), 11);
		assert.equal(days('2027-01-10', 'KM'), 8);
		assert.equal(days('2028-02-10', 'KM'), 0);
	});
	it('reads the only-child fact on parent-care leave', () => {
		const law = {
			days_by_region: [{ region: 'SH', days: 2, only_child_days: 5 }]
		};
		assert.equal(yearly('ELDER_CARE_LEAVE', {}, '2026-06-15', law), 2);
		assert.equal(
			yearly(
				'ELDER_CARE_LEAVE',
				{ facts: { statutory: { IIT: { elderly_support_only_child: true } } } },
				'2026-06-15',
				law
			),
			5
		);
		assert.equal(yearly('ELDER_CARE_LEAVE', { region: 'KM' }, '2026-06-15', law), 0);
	});
});

describe('annual leave', () => {
	const LAW = {
		qualifying_service_months: 12,
		first_year_proration_days: 100,
		carry_forward_years: 1,
		service_bands: [
			{ service_months: 12, days: 6 },
			{ service_months: 60, days: 20 }
		]
	};
	const review = (year: number, fields: JsonObject = {}) => ({
		year,
		disqualified: false,
		next_year_disqualified: false,
		waived_days: 0,
		deferred_days: 0,
		reference: 'Reviewed',
		...fields
	});
	const days = (term_facts: JsonObject, on = '2026-06-15', started = '2020-01-01') =>
		yearly('ANNUAL_LEAVE', { term_facts, started }, on, LAW);
	it('is the band of the person’s service, and nothing before they qualify', () => {
		assert.equal(days({}), 20);
		assert.equal(days({}, '2026-06-15', '2023-01-01'), 6);
		assert.equal(days({}, '2026-06-15', '2025-08-01'), 0);
	});
	it('counts the calendar days left in the year they first qualify, whole days only', () => {
		assert.equal(days({}, '2026-12-01', '2025-11-02'), 3);
	});
	it('comes down by school vacation, to nothing when it reaches the grant', () => {
		assert.equal(days({ school_vacation_days: 15 }), 5);
		assert.equal(days({ school_vacation_days: 25 }), 0);
	});
	it('is gone in a year a review disqualifies, and the year after one that says so', () => {
		const annual_leave_year_reviews = [review(2026, { disqualified: true })];
		assert.equal(days({ annual_leave_year_reviews }), 0);
		assert.equal(
			days({ annual_leave_year_reviews: [review(2025, { next_year_disqualified: true })] }),
			0
		);
		assert.equal(days({ annual_leave_year_reviews }, '2027-06-15'), 20);
	});
	it('loses waived days, and deferred days reach the next year and no further', () => {
		const annual_leave_year_reviews = [review(2026, { waived_days: 2, deferred_days: 3 })];
		assert.equal(days({ annual_leave_year_reviews }), 15);
		assert.equal(days({ annual_leave_year_reviews }, '2027-06-15'), 23);
		assert.equal(days({ annual_leave_year_reviews }, '2028-06-15'), 20);
	});
});

const dated = (date: string, part: 'AM' | 'PM' = 'AM') => ({ date, part });
const whole = (...dates: readonly string[]) =>
	dates.flatMap((date) => [dated(date), dated(date, 'PM')]);
type Pay = {
	readonly rate?: JsonObject;
	readonly region?: string;
	readonly zone?: string;
	readonly events?: readonly JsonObject[];
	readonly term_facts?: JsonObject;
	readonly days: readonly JsonObject[];
	readonly coverage?: { readonly from: string; readonly to: string };
	readonly started?: string;
	readonly to?: string | null;
	readonly day_rate?: number;
	readonly encashment?: boolean;
	readonly law?: JsonObject;
};
const JUNE = { from: '2026-06-01', to: '2026-06-30' };
/**
 * A 22-working-day June: a day of this salary is 100. What the run takes for the entry: an encashment pays its payout;
 * a day taken comes off at the day's share of the salary for each slot's unpaid part, `1 − paid_share`.
 */
const lineOf = (
	code: string,
	version: number,
	{
		rate = { amount: 2200, unit: 'MONTHLY' },
		region = 'SH',
		zone,
		events = [],
		term_facts = {},
		days,
		coverage = JUNE,
		started = '2025-01-01',
		to = null,
		day_rate = 110,
		encashment = false,
		law = {}
	}: Pay
) => {
	const row = leaveRow(code, version);
	const lookup = { ...objectValue(row.lookup), ...law };
	const context = {
		subject: {
			employment: {
				effective_range: { from: started, to },
				terms: { rate, normal_days_per_week: 5 },
				events,
				employee_extension_data: { ...term_facts }
			},
			employer: {
				entity_extension_data: { region, ...(zone === undefined ? {} : { wage_zone: zone }) },
				payment_schedule: { non_working_weekdays: [0, 6] }
			}
		},
		entry: { days, quantity: days.length / 2, encashment },
		lookup,
		run: { salary_coverage: coverage },
		work: { days: [] },
		calendar_days:
			(Date.parse(`${coverage.to}T00:00:00Z`) - Date.parse(`${coverage.from}T00:00:00Z`)) /
				86_400_000 +
			1,
		working_days: workingDays(coverage),
		// what the law's own divisor prices a month at, as the engine's day rate does
		month_wage: day_rate * Number(objectValue(law).monthly_divisor ?? 21.75),
		day_rate,
		hour_rate: day_rate / 8,
		as_of: coverage.to
	};
	if (encashment)
		return Number(evaluate(String(row.payout), 'CALCULATION', context, `${code}.payout`));
	// a salary's day is its share of the month's working days; a day rate is its own day
	const dayPay =
		rate.unit === 'MONTHLY' ? Number(rate.amount) / workingDays(coverage) : Number(rate.amount);
	const held = eventsOf({ events });
	return days.reduce((total, slot) => {
		const date = String(slot.date);
		const share = paidShareOf(row, () => ({
			...context,
			as_of: date,
			event: eventOn(lookup, held, date) ?? null
		}));
		return total + (dayPay * (1 - share)) / 2;
	}, 0);
};
/** The working days of a coverage period, as the engine counts them (the employer's week is Monday to Friday here). */
const workingDays = (coverage: { from: string; to: string }) => {
	const from = Date.parse(`${coverage.from}T00:00:00Z`),
		to = Date.parse(`${coverage.to}T00:00:00Z`);
	let count = 0;
	for (let at = from; at <= to; at += 86_400_000) {
		const day = new Date(at).getUTCDay();
		if (day !== 0 && day !== 6) count += 1;
	}
	return count;
};
const near = (actual: number, expected: number) =>
	assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} is not ${expected}`);

describe('sick pay', () => {
	const LAW = {
		monthly_divisor: 20,
		minimum_wage_floor_share: 0.5,
		minimum_wage_by_zone: [
			{ region: 'SH', zone: '1', monthly: 1100, default_zone: '1' },
			{ region: 'KM', zone: '1', monthly: 1100, default_zone: '1' },
			{ region: 'KM', zone: '2', monthly: 660, default_zone: '1' }
		],
		shanghai_scale_first_months: 6,
		shanghai_scale_first: [
			{ completed_months: 23, share: 0.6 },
			{ completed_months: null, share: 0.9 }
		],
		shanghai_scale_later: [{ completed_months: null, share: 0.1 }]
	};
	const sick = (pay: Omit<Pay, 'days'> & { days?: Pay['days'] }, version = 2) =>
		lineOf('SICK_LEAVE', version, { days: whole('2026-06-02'), ...pay, law: LAW });
	// the floor: half of 1100 over 20 is 27.5, a quarter of the 110 day rate
	const FLOOR = 0.25;
	it('takes what the Shanghai scale leaves, by continuous service', () => {
		near(sick({}), 40);
		near(sick({ started: '2020-01-01' }), 10);
	});
	it('moves to the later scale past the months an illness has run', () => {
		const events = [{ kind: 'ILLNESS', on: '2025-12-02' }];
		near(sick({ events }), 75);
		near(sick({ events: [{ kind: 'ILLNESS', on: '2026-01-03' }] }), 40);
		near(sick({ events: [{ ...events[0], ended_on: '2026-03-01' }] }), 40);
	});
	it('never pays under the floor', () => {
		near(sick({ events: [{ kind: 'ILLNESS', on: '2025-01-02' }] }), (1 - FLOOR) * 100);
	});
	it('pays the floor in Kunming, by wage zone, unless a higher share is agreed', () => {
		near(sick({ region: 'KM' }), (1 - FLOOR) * 100);
		near(sick({ region: 'KM', zone: '2' }), 85);
		near(sick({ region: 'KM', term_facts: { sick_pay_share: 0.8 } }), 20);
	});
	it('counts half days and working days only', () => {
		near(sick({ days: [dated('2026-06-02')] }), 20);
		near(sick({ days: whole('2026-06-06') }), 0);
	});
	it('takes a daily rate’s own day', () => {
		near(sick({ rate: { amount: 110, unit: 'DAILY' } }), 44);
	});
	it('leaves a person with no region alone', () => {
		near(sick({ region: '' }), 0);
	});
	it('ends the Shanghai scale on its day, within the version that spans it', () => {
		const coverage = { from: '2026-08-01', to: '2026-08-31' };
		const days = whole('2026-08-14', '2026-08-17');
		near(sick({ coverage, days }, 3), (2200 / 21) * (0.4 + (1 - FLOOR)));
	});
	it('has no scale after it', () => {
		assert.equal(lookupOf('SICK_LEAVE', 4).shanghai_scale_first, undefined);
		near(sick({ started: '2020-01-01' }, 4), (1 - FLOOR) * 100);
		near(sick({ term_facts: { sick_pay_share: 0.9 } }, 4), 10);
	});
});

describe('a paid share by region', () => {
	const LAW = {
		paid_share_by_region: [
			{ region: 'SH', share: 0.75 },
			{ region: 'KM', share: 0 }
		]
	};
	const days = whole('2026-06-02', '2026-06-03', '2026-06-06');
	for (const code of ['PRENATAL_LEAVE', 'NURSING_LEAVE', 'FAMILY_PLANNING_LEAVE'])
		it(`${code} takes the rest of each working day`, () => {
			near(lineOf(code, 2, { days, law: LAW }), 50);
			near(lineOf(code, 2, { days, region: 'KM', law: LAW }), 200);
			near(lineOf(code, 2, { days, region: 'XX', law: LAW }), 0);
		});
});

describe('untaken annual leave', () => {
	const LAW = {
		encashment_factor: 2,
		qualifying_service_months: 12,
		first_year_proration_days: 100,
		service_bands: [{ service_months: 12, days: 20 }]
	};
	const coverage = { from: '2026-02-01', to: '2026-02-28' };
	const days = whole(...Array.from({ length: 20 }, () => '2026-02-20'));
	const pay = (over: Partial<Pay>) =>
		lineOf('ANNUAL_LEAVE', 2, {
			days,
			coverage,
			started: '2020-01-01',
			encashment: true,
			day_rate: 10,
			law: LAW,
			...over
		});
	it('pays nothing on leave taken', () => {
		near(pay({ encashment: false }), 0);
	});
	it('pays the factor on every day of a contract still running', () => {
		near(pay({}), 400);
	});
	it('on exit pays only the days the year has earned, whole days only', () => {
		// 41 of 100 days earned 8.2 of 20: eight whole days
		near(pay({ to: '2026-02-10' }), 160);
		near(
			pay({ to: '2026-02-10', days: whole(...Array.from({ length: 5 }, () => '2026-02-20')) }),
			0
		);
	});
});

describe('the day rate', () => {
	it('adds the fixed allowances to the salary', () => {
		const settings = file(4, 'jurisdiction_settings')[0];
		assert.ok(settings !== undefined);
		const day = payBasis(
			{
				run: {},
				settings: {
					...settings,
					conversions: { ...(settings.conversions as object), day: { basis: 'FIXED', days: 10 } }
				},
				subtotals: [],
				allowance: [
					{ code: 'FIXED_ALLOWANCE', include_in_rate: true },
					{ code: 'FOREIGN_LANGUAGE_ALLOWANCE', include_in_rate: true },
					{ code: 'FOREIGN_CHILD_EDUCATION_ALLOWANCE', include_in_rate: true },
					{ code: 'MEAL_SUBSIDY_OUT', include_in_rate: false }
				],
				overtime: [],
				statutory: [],
				leave_catalog: [],
				claim_catalog: [],
				adhoc_catalog: [],
				loan_catalog: [],
				employee: {},
				employment: {
					terms: {
						rate: { amount: 900, unit: 'MONTHLY' },
						normal_hours_per_day: 8,
						normal_hours_per_week: 40,
						normal_days_per_week: 5,
						allowances: {
							FIXED_ALLOWANCE: { amount: 50 },
							FOREIGN_LANGUAGE_ALLOWANCE: { amount: 30 },
							FOREIGN_CHILD_EDUCATION_ALLOWANCE: { amount: 20 },
							MEAL_SUBSIDY_OUT: { amount: 400 }
						}
					}
				},
				employer: { payment_schedule: { non_working_weekdays: [0, 6] } },
				balance: {},
				entries: {}
			},
			{ from: '2026-06-01', to: '2026-06-30' }
		).day_rate;
		assert.equal(day, 100);
	});
});

describe('the only-child and high-temperature allowances', () => {
	const allowance = (code: string) => {
		const row = file(4, 'allowance_catalog').find((item) => item.code === code);
		assert.ok(row !== undefined, code);
		return row;
	};
	const eligible = (
		code: string,
		extension: JsonObject,
		asOf = '2026-07-15',
		workEvents: readonly JsonObject[] = []
	) => {
		const row = allowance(code);
		return (
			evaluate(
				String(row.eligibility),
				'CALCULATION',
				{
					subject: {
						employment: {
							...(Array.isArray(extension.family) ? { family: extension.family } : {}),
							employee_extension_data: Object.fromEntries(
								Object.entries(extension).filter(([key]) => key !== 'family')
							)
						},
						employer: { entity_extension_data: { region: 'SH' } }
					},
					lookup: objectValue(row.lookup),
					work_events: workEvents,
					as_of: asOf
				},
				`${code}.eligibility`,
				['work_events', 'subject', 'lookup', 'as_of']
			) === true
		);
	};
	it('pays the only-child allowance only to the parent of one child', () => {
		const child = { relation: 'CHILD' };
		assert.equal(eligible('ONLY_CHILD_ALLOWANCE', { family: [child] }), true);
		assert.equal(eligible('ONLY_CHILD_ALLOWANCE', { family: [child, child] }), false);
		assert.equal(eligible('ONLY_CHILD_ALLOWANCE', {}), false);
	});
	it('pays the high-temperature allowance for a dated work event', () => {
		const exposure = (from: string, to?: string) => [
			{ code: 'HIGH_TEMPERATURE', from, to: to ?? null }
		];
		assert.equal(
			eligible(
				'HIGH_TEMPERATURE_ALLOWANCE',
				{},
				'2026-07-15',
				exposure('2026-06-01', '2026-09-30')
			),
			true
		);
		assert.equal(
			eligible(
				'HIGH_TEMPERATURE_ALLOWANCE',
				{},
				'2026-07-15',
				exposure('2026-06-01', '2026-06-30')
			),
			false
		);
		assert.equal(
			eligible('HIGH_TEMPERATURE_ALLOWANCE', {}, '2026-07-15', exposure('2026-07-15')),
			true
		);
		assert.equal(
			eligible('HIGH_TEMPERATURE_ALLOWANCE', {}, '2026-07-15', exposure('2026-07-14')),
			false
		);
	});
});

describe('work events in leave entitlement', () => {
	it('exposes dated work events to the entitlement expression', () => {
		const lookup = {
			entitlement:
				'return (ctx.work_events ?? []).some((event) => event.code === "NATURAL_DISASTER") ? 3 : 0;'
		};
		const person = personOf({ facts: {} });
		assert.equal(entitlementOf(lookup, person, '2026-07-15'), 0);
		assert.equal(
			entitlementOf(
				lookup,
				{
					...person,
					workEvents: [{ code: 'NATURAL_DISASTER', from: '2026-07-01', to: '2026-07-31' }]
				},
				'2026-07-15'
			),
			3
		);
	});
});

const NOW = '2026-06-20T02:00:00.000Z';
const CONTRACT = idOf('employee_contract', uuid(6));
const TERMS = {
	rate: { amount: 22_000, unit: 'MONTHLY' },
	normal_hours_per_day: 8,
	normal_hours_per_week: 40,
	normal_days_per_week: 5,
	statutory_work_category: 'NON_MANUAL',
	work_classification: 'EA_COVERED',
	residency_status: 'CITIZEN',
	wage_payment_method: 'BANK',
	allowances: {}
};
type Seeded = Person & { readonly family?: readonly JsonObject[]; readonly account?: JsonObject };
const seedOf = ({
	region = 'SH',
	gender = 'FEMALE',
	events = [],
	family = [],
	facts = {},
	term_facts = {},
	started = '2015-01-01',
	account = {}
}: Seeded) => {
	const seed = pack(
		'CN',
		'Asia/Shanghai',
		TERMS,
		{ events, family, facts, term_facts },
		[],
		[],
		'2026-06-15'
	);
	return {
		...seed,
		employee_balance: (seed.employee_balance ?? []).map((row) => ({ ...row, account })),
		entity_profile_version: (seed.entity_profile_version ?? []).map((row) => ({
			...row,
			entity_extension_data: {
				region,
				hpf_rate_percent: 7,
				work_injury_rate_percent: 0.2
			}
		})),
		employee_contract: (seed.employee_contract ?? []).map((row) => ({
			...row,
			service_started_on: started,
			payroll: { date_of_birth: '1990-01-01', gender, marital_status: 'MARRIED' }
		}))
	};
};
type Seed = ReturnType<typeof seedOf>;
const take = (t: Kit, seed: Seed, code: string, ...dates: readonly string[]) =>
	t.as(t.admin).act('leave_catalog_entry.create', [
		leaveCreate({
			entity_id: ENTITY,
			employment_id: CONTRACT,
			catalog_id: idOf('leave_catalog', catalogRow(seed, 'leave_catalog', code)),
			days: wholeDays(...dates)
		})
	]);
const refused = (t: Kit, seed: Seed, code: string, ...dates: readonly string[]) =>
	Effect.flip(take(t, seed, code, ...dates)).pipe(Effect.map(String));
/** Consecutive days from a date. */
const run = (from: string, count: number) =>
	Array.from({ length: count }, (_, index) => {
		const at = new Date(`${from}T00:00:00Z`);
		at.setUTCDate(at.getUTCDate() + index);
		return at.toISOString().slice(0, 10);
	});

describe('leave a person cannot take', () => {
	const held = {
		leave: {
			ANNUAL_LEAVE: { 'CN.Y.2025-01-01': { entitled: 15 }, 'CN.Y.2026-01-01': { entitled: 15 } }
		}
	};
	const personal = seedOf({
		account: held,
		term_facts: { medical_period_review: 'Reviewed' }
	});
	it.live('annual leave stops once paid personal leave reaches the limit', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, personal, 'ANNUAL_LEAVE', '2026-03-02');
			yield* take(t, personal, 'PERSONAL_LEAVE_PAID', ...run('2026-04-01', 19));
			yield* take(t, personal, 'ANNUAL_LEAVE', '2026-05-04');
			yield* take(t, personal, 'PERSONAL_LEAVE_PAID', '2026-05-05');
			assert.match(
				yield* refused(t, personal, 'ANNUAL_LEAVE', '2026-05-06'),
				/forfeits annual leave/
			);
		}).pipe(Effect.provide(workspace({ seed: personal, now: NOW })))
	);
	it.live('and a year that crossed the limit after annual leave takes the next year’s', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, personal, 'ANNUAL_LEAVE', '2025-03-03');
			yield* take(t, personal, 'SICK_LEAVE', ...run('2025-04-01', 120));
			assert.match(
				yield* refused(t, personal, 'ANNUAL_LEAVE', '2026-03-02'),
				/forfeits annual leave/
			);
		}).pipe(Effect.provide(workspace({ seed: personal, now: NOW })))
	);
	it.live('but a year that crossed it with no annual leave taken leaves the next alone', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, personal, 'SICK_LEAVE', ...run('2025-04-01', 120));
			yield* take(t, personal, 'ANNUAL_LEAVE', '2026-03-02');
		}).pipe(Effect.provide(workspace({ seed: personal, now: NOW })))
	);
	const menstrual = seedOf({ facts: { protected_work: true } });
	const noFact = seedOf({});
	it.live('menstrual leave needs the local fact', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			assert.match(
				yield* refused(t, noFact, 'MENSTRUAL_LEAVE', '2026-06-01'),
				/does not hold the fact/
			);
		}).pipe(Effect.provide(workspace({ seed: noFact, now: NOW })))
	);
	it.live('menstrual leave holds the days of the month', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, menstrual, 'MENSTRUAL_LEAVE', '2026-05-04');
			yield* take(t, menstrual, 'MENSTRUAL_LEAVE', '2026-06-01');
			assert.match(
				yield* refused(t, menstrual, 'MENSTRUAL_LEAVE', '2026-06-02'),
				/past the days of this calendar month/
			);
		}).pipe(Effect.provide(workspace({ seed: menstrual, now: NOW })))
	);
	const nursing = seedOf({ family: [{ relation: 'CHILD', born_on: '2025-06-10' }] });
	it.live('a nursing break ends with the child’s first year', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, nursing, 'NURSING_BREAK', '2026-06-09');
			assert.match(yield* refused(t, nursing, 'NURSING_BREAK', '2026-06-10'), /child under one/);
		}).pipe(Effect.provide(workspace({ seed: nursing, now: NOW })))
	);
	const long = seedOf({ events: [{ kind: 'ILLNESS', on: '2024-06-02' }] });
	const extended = seedOf({
		events: [{ kind: 'ILLNESS', on: '2024-06-02' }],
		term_facts: { medical_period_extension: 'Approved', medical_period_review: 'Reviewed' }
	});
	it.live('sick leave stops where an illness runs out the medical period', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, long, 'SICK_LEAVE', '2026-06-01');
			assert.match(yield* refused(t, long, 'SICK_LEAVE', '2026-06-02'), /24-month medical period/);
		}).pipe(Effect.provide(workspace({ seed: long, now: NOW })))
	);
	it.live('unless an extension is on the contract', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, extended, 'SICK_LEAVE', '2026-06-02');
		}).pipe(Effect.provide(workspace({ seed: extended, now: NOW })))
	);
	const reviewed = seedOf({ term_facts: { medical_period_review: 'Reviewed' } });
	it.live('a long sick leave reads the review where the contract keeps it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, reviewed, 'SICK_LEAVE', ...run('2026-02-01', 70));
		}).pipe(Effect.provide(workspace({ seed: reviewed, now: NOW })))
	);
});

describe('on the ledger and the payslip', () => {
	const mother = seedOf({
		events: [
			{ kind: 'CONFINEMENT', on: '2026-05-28' },
			{ kind: 'CHILD_BIRTH', on: '2026-06-01' }
		]
	});
	it.live('a birth’s days are limited, and those before it draw on the confinement', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* syncAll(t);
			yield* take(t, mother, 'MATERNITY_LEAVE', '2026-05-28', '2026-05-29');
			yield* take(t, mother, 'MATERNITY_LEAVE', '2026-06-01');
			yield* t.runDue();
			const accounts = yield* accountsIn(t);
			assert.equal(measureOf(accounts, 'leave', 'MATERNITY_LEAVE', 'used'), 3);
			assert.equal(accounts.leave?.MATERNITY_LEAVE?.['CN.E.2026-05-28']?.used, 2);
			assert.equal(accounts.leave?.MATERNITY_LEAVE?.['CN.E.2026-06-01']?.used, 1);
			const before = run('2026-05-20', 3);
			assert.match(
				yield* refused(t, mother, 'MATERNITY_LEAVE', ...before),
				/MATERNITY_LEAVE: insufficient balance/
			);
		}).pipe(Effect.provide(workspace({ seed: mother, now: NOW })))
	);
	const injured = seedOf({ events: [{ kind: 'WORK_INJURY', on: '2026-06-03' }] });
	it.live('the recognition deadline runs from the accident', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, injured, 'WORK_INJURY_LEAVE', '2026-06-10');
			yield* t.runDue();
			const { obligation } = yield* t.storedQuery({ obligation: { limit: 100 } });
			const task = obligation.rows.find((row) =>
				String(row.occurrence_key).startsWith('WORK_INJURY_RECOGNITION:')
			);
			const due = Number(
				new Date(`${String(task?.due_on)}T00:00:00Z`).getTime() -
					new Date('2026-06-03T00:00:00Z').getTime()
			);
			assert.equal(due / 86_400_000, 30);
		}).pipe(Effect.provide(workspace({ seed: injured, now: NOW })))
	);
	const fresh = seedOf({ started: '2025-01-01' });
	it.live('a sick day is a line off the salary', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			yield* take(t, fresh, 'SICK_LEAVE', '2026-06-01');
			yield* t
				.as(t.admin)
				.act('payroll_run.create', [{ entity_id: ENTITY, period: '2026-06', kind: 'ON_CYCLE' }]);
			const { payslip } = yield* t.storedQuery({ payslip: { limit: 1 } });
			const lines = Schema.decodeUnknownSync(PayslipBreakdown)(payslip.rows[0]?.breakdown).lines;
			const [step] = (lookupOf('SICK_LEAVE').shanghai_scale_first ?? []) as readonly JsonObject[];
			// the day's unpaid share at the day rate to the fen: 22,000 ÷ 21.75 = 1,011.49
			const sick = lines.find((row) => row.code === 'SICK_LEAVE');
			assert.equal(sick?.direction, 'DEDUCT');
			assert.equal(
				sick?.amount,
				Math.round((1 - Number(step?.share)) * Math.round((22_000 / 21.75) * 100)) / 100
			);
			assert.equal(lines.find((row) => row.code === 'BASIC')?.amount, 22_000);
		}).pipe(Effect.provide(workspace({ seed: fresh, now: NOW })))
	);
});
