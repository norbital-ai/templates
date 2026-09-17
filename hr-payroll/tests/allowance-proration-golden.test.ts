/**
 * Allowance proration, against the law of two jurisdictions.
 *
 * A standing allowance prorates on the same basis as basic salary: a joiner or a leaver inside
 * the period takes the days they were employed, everywhere. Unpaid leave is where the
 * jurisdictions part — the Philippine "no work, no pay" reaches a fixed allowance (a day of
 * unpaid leave comes off it), Singapore's Employment Act leaves a fixed allowance whole. The
 * jurisdiction says which on `payroll.allowance_npl_prorates`, and every entry a payslip prices
 * carries the days, the divisor, the basis and the unpaid days it was priced on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, type Person } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const PH_VERSION = 'bb5137fd-d7fd-4a26-8eae-77211521f892';
const PH_TRANSPORT = '92e2ca4a-bd53-42f5-8b62-84e892da9954';
const PH_UNPAID_LEAVE = '6c4dfeaa-e449-4057-a5cd-1f7292c23777';
const SG_VERSION = 'e363af9a-a034-59f7-84bf-5052f57ecae5';
const SG_TRANSPORT = 'c1c1c1c1-0000-4000-8000-000000000001';
const SG_UNPAID_LEAVE = 'c1c1c1c1-0000-4000-8000-000000000002';

/** A transport allowance of 2,175 a month for everyone, from the start of the year. */
const standing = (world: PayrollWorld, catalogueId: string) => {
	for (const [index, employment] of world.employments.entries())
		world.allowances.push({
			id: `d0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: catalogueId,
			amount: 2175,
			effective_from: '2026-01-01',
			effective_to: null,
			reason: '',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
};

/** One approved day of unpaid leave on Wednesday 14 January for the named person. */
const unpaidDay = (world: PayrollWorld, key: string, catalogueId: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
	world.leave_entries.push({
		id: `e1000000-0000-4000-8000-${key.padEnd(12, '0').slice(0, 12)}`,
		employment_id: employment.id,
		catalogue_id: catalogueId,
		leave_code: 'UNPAID_LEAVE',
		reference: `NPL-${key}`,
		from_date: '2026-01-14',
		to_date: '2026-01-14',
		half_day_start: false,
		half_day_end: false,
		days: 1,
		effective_on: '2026-01-14',
		reason: 'Unpaid',
		allocations: [],
		charges: [
			{
				date: '2026-01-14',
				days: 1,
				catalogue_id: catalogueId,
				employment_term_id: term.id,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			}
		],
		approval_id: null
	});
};

const people: Person[] = [
	{ key: 'WHOLE', wage: 30_000 },
	{ key: 'UNPAID', wage: 30_000 },
	// Joins on Monday 19 January: ten working days of the month remain.
	{ key: 'JOINER', wage: 30_000, hire_date: '2026-01-19' }
];

const facts = (
	built: ReturnType<typeof buildStatutory>,
	key: string
): readonly [number, number, number, number] => {
	const entry = built.entries.get(key)![0]!;
	const line = built.slips.get(key)!.adjustments.find((row) => row.family === 'ALLOWANCE')!;
	assert.equal(line.amount, entry.values.amount, `${key}: the line is the entry`);
	return [
		entry.values.days,
		entry.values.denominator,
		entry.values.unpaid_days,
		entry.values.amount
	];
};

test('Philippines — a joiner takes the working days employed over 21.75, and an unpaid day comes off the allowance', () => {
	const built = buildStatutory({ code: 'PH', period: '2026-01', people }, (world) => {
		standing(world, PH_TRANSPORT);
		world.leave_catalogue.push({
			id: PH_UNPAID_LEAVE,
			settings_id: PH_VERSION,
			code: 'UNPAID_LEAVE',
			name: 'Unpaid leave',
			eligibility: '',
			evidence: 'NONE',
			evidence_after_days: null,
			entitlement: { availability: 'UNLIMITED', year_start_month: 1, proration: 'NONE', bands: [] },
			is_npl: true,
			can_encash: false,
			bands: [],
			approval_id: null
		});
		unpaidDay(world, 'UNPAID', PH_UNPAID_LEAVE);
	});
	// A whole month is the whole monthly amount, whatever January's working days come to.
	assert.deepEqual(facts(built, 'WHOLE'), [21.75, 21.75, 0, 2175]);
	// "No work, no pay" reaches the allowance: one working day off the DOLE factor.
	assert.deepEqual(facts(built, 'UNPAID'), [20.75, 21.75, 1, 2075]);
	// Ten working days of a part month, at the daily rate the factor states.
	assert.deepEqual(facts(built, 'JOINER'), [10, 21.75, 0, 1000]);
	assert.equal(built.entries.get('JOINER')![0]!.values.from, '2026-01-19');
});

test('Singapore — a joiner takes the working days employed over the month’s, and an unpaid day leaves the allowance whole', () => {
	const built = buildStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: people.map((person) => ({ ...person, citizenship: 'CITIZEN' }))
		},
		(world) => {
			world.allowance_catalogue.push({
				id: SG_TRANSPORT,
				settings_id: SG_VERSION,
				code: 'TRANSPORT',
				name: 'Transport',
				eligibility: '',
				evidence: 'NONE',
				destination: 'PAY',
				direction: 'ADD',
				bands: [{ when: '', amount: 'entry.amount', limit: null }],
				approval_id: null
			});
			standing(world, SG_TRANSPORT);
			world.leave_catalogue.push({
				id: SG_UNPAID_LEAVE,
				settings_id: SG_VERSION,
				code: 'UNPAID_LEAVE',
				name: 'Unpaid leave',
				eligibility: '',
				evidence: 'NONE',
				evidence_after_days: null,
				entitlement: {
					availability: 'UNLIMITED',
					year_start_month: 1,
					proration: 'NONE',
					bands: []
				},
				is_npl: true,
				can_encash: false,
				bands: [],
				approval_id: null
			});
			unpaidDay(world, 'UNPAID', SG_UNPAID_LEAVE);
		}
	);
	// January 2026 has 22 working days on a Monday-to-Friday pattern.
	assert.deepEqual(facts(built, 'WHOLE'), [22, 22, 0, 2175]);
	// The unpaid day is priced on the salary line and nowhere else: the allowance is whole.
	assert.deepEqual(facts(built, 'UNPAID'), [22, 22, 0, 2175]);
	assert.ok(
		built.slips.get('UNPAID')!.adjustments.some((row) => row.bucket === 'ABSENCE'),
		'the unpaid day is still deducted from the wage'
	);
	assert.deepEqual(facts(built, 'JOINER'), [10, 22, 0, 988.64]);
});
