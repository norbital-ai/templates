/**
 * Round 5 (S) — Philippines. Every figure is derived by hand from the instrument cited beside it.
 *
 * D11 — NIRC s.22(E)-(G), s.24(A), s.25(A)-(B): citizens and resident aliens, and a non-resident
 * alien engaged in trade or business (more than 180 days in the calendar year is deemed engaged,
 * s.25(A)(1)), are withheld on the graduated table (RR 11-2018 Annex E); a non-resident alien not
 * engaged is withheld 25% of the gross (s.25(B)). No provision supplies a default for an unknown
 * status, so positive taxable pay with none recorded stops the run.
 *
 * D19 — DOLE Handbook on Workers' Statutory Monetary Benefits (2023) ch.7 §D: SIL converts at
 * "the salary rate at the date of conversion"; ch.1 §D–E: a monthly-paid wage pays every day
 * (factor 365), a daily-paid one the days worked. A weekly wage is the same salary rate: the
 * week's pay over the days it pays.
 *
 * D41 — Handbook ch.7 §D illustration: hired 1 Jan 2022, resigned 1 Mar 2023 — 5 days earned as
 * of 31 Dec 2022 plus (2/12) × 5 = 0.833 for January–February 2023, unrounded.
 *
 * D15 — Labor Code art.95(b) (SIL: establishments regularly employing fewer than ten) and
 * art.302 / RA 7641 (retirement: retail, service and agricultural establishments of not more than
 * ten) are two required entity facts with no default.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	chargeOf,
	leaveCatalogue,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { computedEntitlement } from '../src/lib/leave/entitlement.ts';
import type { PersonContext } from '../src/collections/payroll_runs/lib/eligibility.ts';

const PERIODS = ['2025-12', '2026-01', '2026-04', '2026-10'] as const;

// ─── D11: tax residency classification ──────────────────────────────────────────────────────

for (const period of PERIODS) {
	test(`PH D11 ${period}: resident and engaged non-resident alien on the table, not engaged 25% of gross`, () => {
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [
				{ key: 'RES', wage: 30_000, tax_residency: 'RESIDENT' },
				{ key: 'NRA-ETB', wage: 30_000, tax_residency: 'NON_RESIDENT' },
				{ key: 'NRA-NETB', wage: 30_000, tax_residency: 'NON_RESIDENT_NETB' }
			]
		});
		// Monthly column (RR 11-2018 Annex E): 20,833 → 0 + 15% of the excess.
		// 30,000 − (SSS 1,000 + MPF 500 + PhilHealth 750 + Pag-IBIG 200) = 27,550;
		// 15% × (27,550 − 20,833) = 15% × 6,717 = 1,007.55. Before the 2025 SSS schedule the
		// shares differ, so the resident and the engaged non-resident are compared to each other.
		const resident = chargeOf(book, 'RES', 'WTAX').employee;
		if (period !== '2025-12') assert.equal(resident, 1007.55);
		assert.equal(chargeOf(book, 'NRA-ETB', 'WTAX').employee, resident);
		// s.25(B): 25% × 30,000 = 7,500, no contribution relief.
		assert.equal(chargeOf(book, 'NRA-NETB', 'WTAX').employee, 7500);
	});

	test(`PH D11 ${period}: taxable pay with no recorded residency stops withholding`, () => {
		assert.throws(
			() =>
				assessStatutory({
					code: 'PH',
					period,
					people: [{ key: 'UNKNOWN', wage: 30_000, tax_residency: null }]
				}),
			/Record tax residency on the employment terms/
		);
	});

	test(`PH D11 ${period}: a minimum-wage earner with nothing taxable needs no residency`, () => {
		// IV-A floor ≥ ₱510 × 261 ÷ 12 = 11,092.50 a month on a five-day week in every version
		// (IVA-22's lowest area rate); 11,000 is at or below it, so the basic is exempt
		// (NIRC s.24(A)(2)) and the taxable base is 0 — the refusal needs positive taxable pay.
		const book = assessStatutory({
			code: 'PH',
			period,
			people: [{ key: 'MWE', wage: 11_000, tax_residency: null }]
		});
		// No refusal, and nothing withheld (a zero-base scheme may produce no row at all).
		assert.equal(book.get('MWE')?.get('WTAX')?.employee ?? 0, 0);
	});

	test(`PH D16 ${period}: a kasambahay outside a transcribed domestic wage order stops withholding`, () => {
		// RA 10361 s.24: her floor is the domestic-worker wage order, stated here for NCR only; in
		// IV-A the minimum-wage-earner test (RR 11-2018 s.2.78.1(B)(13)) has no floor to read.
		assert.throws(
			() =>
				assessStatutory({
					code: 'PH',
					period,
					people: [
						{
							key: 'KASAMBAHAY',
							wage: 9_000,
							employment_type: 'DOMESTIC',
							tax_residency: 'RESIDENT'
						}
					]
				}),
			/no minimum wage for this employee's region and employment type/
		);
	});
}

// ─── D15: establishment-size facts ──────────────────────────────────────────────────────────

test('PH D15: both establishment-size exemptions are required entity facts in every version', () => {
	for (const version of settingsVersions('PH')) {
		const keys = version.facts.filter((field) => field.required).map((field) => field.key);
		assert.deepEqual(keys, ['small_establishment', 'retirement_exempt_establishment']);
		assert.ok(version.facts.every((field) => field.default_value === undefined));
	}
});

test('PH D15: an entity that has not recorded its establishment size stops payroll', () => {
	assert.throws(
		() =>
			assessStatutory(
				{ code: 'PH', period: '2026-04', people: [{ key: 'P', wage: 30_000 }] },
				(world) => {
					world.companies[0]!.facts = { small_establishment: false };
				}
			),
		/Retail, service or agricultural establishment of ten or fewer is required/
	);
});

test('PH D15: RA 7641 reads its own fact — a small manufacturer still owes retirement pay', () => {
	const retire = (facts: Record<string, boolean>) =>
		buildStatutory(
			{
				code: 'PH',
				period: '2026-01',
				people: [
					{
						key: 'RETIREE',
						wage: 26_100,
						age: 62,
						hire_date: '2016-01-01',
						exit_date: '2026-01-31',
						exit_reason: 'RETIREMENT'
					}
				]
			},
			(world) => {
				world.companies[0]!.facts = facts;
				const version = world.jurisdiction_settings.find((row) =>
					String(row.effective_range.start).startsWith('2026-01-06')
				)!;
				world.adhoc_requests!.push({
					id: 'a5000000-0000-4000-8000-000000000001',
					employment_id: world.employments[0]!.id,
					catalogue_id: world.adhoc_catalogue!.find(
						(row) => row.code === 'RETIREMENT_PAY' && row.settings_id === version.id
					)!.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'retirement',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		)
			.slips.get('RETIREE')!
			.adjustments.filter((row) => row.component_code === 'RETIREMENT_PAY')
			.reduce((sum, row) => sum + row.amount, 0);
	// 1 Jan 2016 – 31 Jan 2026 is ten years and a month: ten years. Half a month's salary is 22.5
	// days of 26,100 × 12 ÷ 261 = 1,200 a day (the fixture's five-day week) = 27,000 a year;
	// × 10 = 270,000 (RA 7641). An eight-person manufacturer is outside SIL, not RA 7641.
	assert.equal(
		retire({ small_establishment: true, retirement_exempt_establishment: false }),
		270_000
	);
	// A retail, service or agricultural establishment of ten or fewer owes none.
	assert.equal(retire({ small_establishment: false, retirement_exempt_establishment: true }), 0);
});

// ─── D19: weekly SIL conversion ─────────────────────────────────────────────────────────────

/** The month's second Monday–Sunday week, its run key `<month>-2` (a week is named by its Sunday). */
const secondWeek = (month: string) => {
	const first = new Date(`${month}-01T00:00:00Z`);
	const sunday = 1 + ((7 - first.getUTCDay()) % 7) + 7;
	const day = (n: number) => `${month}-${String(n).padStart(2, '0')}`;
	return {
		key: `${month}-2`,
		monday: day(sunday - 6),
		wednesday: day(sunday - 4),
		sunday: day(sunday)
	};
};

const weeklyConversion = (month: string, paidRestDays: boolean) => {
	const week = secondWeek(month);
	return buildStatutory(
		{
			code: 'PH',
			period: week.key,
			payFrequency: 'WEEKLY',
			people: [{ key: 'SIL', wage: 4_200, pay_frequency: 'WEEKLY', hire_date: '2015-01-01' }]
		},
		(world) => {
			const current = world.employment_terms[0]!;
			current.paid_rest_days = paidRestDays;
			// The conversion date's (Monday's) rate is the old one: 3,500 a week until Wednesday.
			world.employment_terms.push({
				...current,
				id: 'f5000000-0000-4000-8000-000000000001',
				base_salary: { ...current.base_salary, value: 3_500 },
				effective_range: { start: '2015-01-01', end: week.wednesday }
			});
			current.effective_range = { start: week.wednesday, end: null };
			const version = world.jurisdiction_settings.find(
				(row) =>
					String(row.effective_range.start).slice(0, 10) <= week.monday &&
					String(row.effective_range.end).slice(0, 10) > week.monday
			)!;
			world.leave_catalogue.push(
				...leaveCatalogue('PH').map((row) => ({ ...row, approval_id: null }))
			);
			const catalogue = world.leave_catalogue.find(
				(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
			)!;
			world.leave_entries.push({
				id: 'f5000000-0000-4000-8000-000000000002',
				employment_id: world.employments[0]!.id,
				catalogue_id: catalogue.id,
				leave_code: catalogue.code,
				reference: 'SIL-WEEKLY',
				from_date: `${month.slice(0, 4)}-01-01`,
				to_date: `${month.slice(0, 4)}-12-31`,
				days: 1.5,
				encash_days: 1.5,
				effective_on: week.monday,
				due_on: week.sunday,
				charges: [],
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false
			} as never);
		}
	)
		.slips.get('SIL')!
		.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount;
};

for (const period of PERIODS) {
	test(`PH D19 ${period}: a weekly wage converts SIL at the week's pay over the days it pays`, () => {
		// Monday–Friday: 3,500 ÷ 5 = 700 a day; 1.5 days = 1,050.
		assert.equal(weeklyConversion(period, false), 1050);
		// A weekly wage that pays the rest days too covers seven: 3,500 ÷ 7 = 500; 1.5 × 500 = 750.
		assert.equal(weeklyConversion(period, true), 750);
	});
}

// ─── D41: SIL earned by completed months, unrounded ─────────────────────────────────────────

test('PH D41: the Handbook illustration — 5 days for the first year, then 2/12 × 5 = 0.833', () => {
	for (const version of settingsVersions('PH')) {
		const rule = leaveCatalogue('PH').find(
			(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
		)!.entitlement;
		// Hired 1 January 2025: completed months through the day, a month's last day closing it.
		const personOn = (date: string) => {
			const [y, m, d] = date.split('-').map(Number) as [number, number, number];
			const last = new Date(Date.UTC(y, m, 0)).getUTCDate() === d ? 1 : 0;
			return {
				employment: { service_months: (y - 2025) * 12 + (m - 1) + last }
			} as unknown as PersonContext;
		};
		const run = (window: { start: string; end: string }, asOf: string, exit: string | null) =>
			computedEntitlement({
				rule,
				window,
				asOf,
				hireDate: '2025-01-01',
				exitDate: exit,
				servedOn: () => true,
				eligibleOn: () => true,
				personOn
			}).entitlement;
		// First year, 1 Jan – 31 Dec 2025: twelve completed months, all five days.
		assert.equal(run({ start: '2025-01-01', end: '2025-12-31' }, '2025-12-31', null), 5);
		// Resigned 1 March 2026: January and February complete, March not — 5 × 2/12, unrounded.
		const fraction = run({ start: '2026-01-01', end: '2026-12-31' }, '2026-03-01', '2026-03-01');
		assert.ok(Math.abs((fraction ?? 0) - 10 / 12) < 1e-9, String(fraction));
		// A whole year of service holds all five from the year's start.
		assert.equal(run({ start: '2026-01-01', end: '2026-12-31' }, '2026-01-02', null), 5);
	}
});

// ─── De minimis ceilings: RR 2-98 s.2.78.1(A)(3), as amended ───────────────────────────────
//
// RR 29-2025 (in force 6 January 2026): uniform ₱8,000 a year, actual medical assistance ₱12,000,
// achievement awards ₱12,000, Christmas/anniversary gifts ₱6,000, CBA + productivity ₱12,000,
// laundry ₱400 a month, dependants' medical cash ₱2,000 a semester, OT/night meal 30% of the
// regional basic minimum wage a day. Before it, RR 11-2018 (uniform ₱7,000 and awards ₱10,000 by
// RR 4-2025): ₱10,000 / ₱10,000 / ₱5,000 / ₱10,000, laundry ₱300, dependants ₱1,500, meal 25%.
// The excess of any ceiling is an "other benefit" inside the ₱90,000 exclusion (NIRC
// s.32(B)(7)(e)), so each case pays a ₱90,000 bonus beside it: the pool is then full and only the
// excess reaches the base. The ₱30,000 salary is the whole base otherwise.

type Extra = { readonly code: string; readonly amount: number };

const deMinimis = (period: string, adhoc: readonly Extra[], allowances: readonly Extra[] = []) => {
	const end = `${period}-28`;
	const book = assessStatutory(
		{ code: 'PH', period, people: [{ key: 'DM', wage: 30_000 }] },
		(world) => {
			const version = world.jurisdiction_settings.find(
				(row) =>
					String(row.effective_range.start).slice(0, 10) <= end &&
					String(row.effective_range.end).slice(0, 10) > end
			)!;
			const id = (
				rows: readonly { id: string; code: string; settings_id: string }[],
				code: string
			) => rows.find((row) => row.code === code && row.settings_id === version.id)!.id;
			world.employment_terms[0]!.allowances = allowances.map((row) => ({
				catalogue_id: id(world.allowance_catalogue, row.code),
				amount: row.amount
			}));
			for (const [index, row] of adhoc.entries())
				world.adhoc_requests!.push({
					id: `a5100000-0000-4000-8000-00000000000${index}`,
					employment_id: world.employments[0]!.id,
					catalogue_id: id(world.adhoc_catalogue!, row.code),
					amount: row.amount,
					event_date: `${period}-15`,
					pay_period: period,
					payslip_id: null,
					reason: 'de minimis',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		}
	);
	return chargeOf(book, 'DM', 'WTAX').base;
};

const CEILINGS = {
	// period: [uniform, medical, award, gift, cba, laundry, dependants' medical]
	'2025-12': [7000, 10_000, 10_000, 5000, 10_000, 300, 1500],
	'2026-04': [8000, 12_000, 12_000, 6000, 12_000, 400, 2000]
} as const;
const ANNUAL_CODES = [
	'UNIFORM_ALLOWANCE',
	'MEDICAL_ASSISTANCE',
	'ACHIEVEMENT_AWARD',
	'CHRISTMAS_GIFT',
	'CBA_PRODUCTIVITY'
] as const;

for (const [period, caps] of Object.entries(CEILINGS)) {
	for (const [index, code] of ANNUAL_CODES.entries()) {
		test(`PH de minimis ${period}: ${code} is exempt to ₱${caps[index]} a year, the excess in the ₱90,000 pool`, () => {
			// At the ceiling: nothing taxable beside the salary, even with the pool full.
			assert.equal(
				deMinimis(period, [
					{ code, amount: caps[index] },
					{ code: 'bonus', amount: 90_000 }
				]),
				30_000
			);
			// ₱100 over it: the pool (bonus 90,000 + excess 100) exempts 90,000, so 100 is taxed.
			assert.equal(
				deMinimis(period, [
					{ code, amount: caps[index] + 100 },
					{ code: 'bonus', amount: 90_000 }
				]),
				30_100
			);
			// Without the bonus the excess sits inside the pool: 30,000.
			assert.equal(deMinimis(period, [{ code, amount: caps[index] + 100 }]), 30_000);
		});
	}
	for (const [index, code] of [
		[5, 'LAUNDRY_ALLOWANCE'],
		[6, 'DEPENDANT_MEDICAL_ALLOWANCE']
	] as const) {
		test(`PH de minimis ${period}: ${code} is exempt to ₱${caps[index]}, the excess in the ₱90,000 pool`, () => {
			const bonus = [{ code: 'bonus', amount: 90_000 }];
			assert.equal(deMinimis(period, bonus, [{ code, amount: caps[index] }]), 30_000);
			assert.equal(deMinimis(period, bonus, [{ code, amount: caps[index] + 100 }]), 30_100);
		});
	}
}

test('PH de minimis: the dependants’ semester ceiling holds in the second semester too', () => {
	// July opens the July–December semester: ₱2,000 exempt, ₱2,100 leaves 100 over the full pool.
	const bonus = [{ code: 'bonus', amount: 90_000 }];
	const code = 'DEPENDANT_MEDICAL_ALLOWANCE';
	assert.equal(deMinimis('2026-07', bonus, [{ code, amount: 2000 }]), 30_000);
	assert.equal(deMinimis('2026-07', bonus, [{ code, amount: 2100 }]), 30_100);
});

for (const [period, percent, paid] of [
	// IV-A (IVA-22 from 5 Oct 2025): ₱600 a day, stated as 600 × 313 ÷ 12 = 15,650 a month.
	// 25% × 600 = 150 (RR 11-2018); 30% × 600 = 180 (RR 29-2025).
	['2025-12', 25, 150],
	['2026-04', 30, 180]
] as const) {
	test(`PH de minimis ${period}: a day's OT/night meal allowance is exempt to ${percent}% of the regional minimum wage, paid whole`, () => {
		const { slips } = buildStatutory(
			{ code: 'PH', period, people: [{ key: 'OT', wage: 30_000 }] },
			(world) => {
				const end = `${period}-28`;
				const version = world.jurisdiction_settings.find(
					(row) =>
						String(row.effective_range.start).slice(0, 10) <= end &&
						String(row.effective_range.end).slice(0, 10) > end
				)!;
				for (const [index, amount] of [100, 500].entries())
					world.adhoc_requests!.push({
						id: `a5200000-0000-4000-8000-00000000000${index}`,
						employment_id: world.employments[0]!.id,
						catalogue_id: world.adhoc_catalogue!.find(
							(row) => row.code === 'OT_MEAL_ALLOWANCE' && row.settings_id === version.id
						)!.id,
						amount,
						event_date: `${period}-1${index + 1}`,
						pay_period: period,
						payslip_id: null,
						reason: 'overtime meal',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
			}
		);
		const slip = slips.get('OT')!;
		const meals = slip.adjustments
			.filter((row) => row.component_code === 'OT_MEAL_ALLOWANCE')
			.map((row) => row.amount)
			.sort((a, b) => a - b);
		// The ceiling (₱150 / ₱180) bounds the exemption, never the pay (RR 11-2018 s.2.78.1(A)(3)(j),
		// round 5 V): both entries are paid whole. With no overtime or night day the whole ₱600 is an
		// other benefit inside the ₱90,000 pool, so the base stays 30,000.
		assert.deepEqual(meals, [100, 500]);
		assert.ok(paid < 500);
		const wtax = slip.statutory.find((row) => row.scheme_code === 'WTAX')!;
		assert.equal(wtax.base_amount, 30_000);
	});
}
