/**
 * Round 4 (Q) — Vietnam and Indonesia. Every figure is derived by hand from the instrument cited
 * beside it.
 *
 * D11 — residence is a fact, not a default. Decree 253/2026/NĐ-CP art.4: a resident is present 183
 * days in the calendar year or twelve months from arrival, or has a registered permanent residence
 * or a rented home for 183 days or more; art.5: everyone else is non-resident. UU 36/2008 (PPh)
 * art.2(3)–(4): the same 183-day / residence / intent test. Neither presumes a status for an
 * unknown one, so an unrecorded `terms.tax_residency` stops the calculation (like TW INCOME_TAX).
 *
 * D12 — Decree 253/2026 art.66(1)(a): residence governs the calendar year; art.46(3) and art.64(4):
 * wage income is taxed when paid. Each month is withheld on the status recorded for it; the
 * change is settled in the finalisation (art.51), which re-prices the year's income on the annual
 * table and credits the 20% already withheld.
 *
 * D13 — Decree 253/2026 art.26(1): "Miễn thuế thu nhập cá nhân đối với tiền lương, tiền công làm
 * việc ban đêm, làm thêm giờ …" — the night-work wage itself, where Circular 111/2013 art.3(1)(i)
 * exempted only "phần tiền lương, tiền công trả cao hơn" the day wage. Residents from tax year 2026,
 * non-residents from 1 July 2026 (art.69(1)).
 *
 * D14 — art.26(2)–(3): untaken-leave pay is exempt within Labour Code art.113(3); the excess is
 * taxable income of the month it is paid (art.46(3)), never spread over earlier periods.
 *
 * G14 — Permenaker 6/2016 art.7(1): a PKWTT worker whose employment ends within thirty days before
 * the religious holiday keeps the THR; the holiday is the declared departure input, so a 2027
 * leaver is judged against 2027's holiday.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	chargeOf,
	COMPANY_ID,
	contributionSchemes,
	createStatutoryWorld,
	expectStatutory,
	settingsVersions,
	adhocCatalogue
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { gatherPayrollRun, buildPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { evaluateNumber, expressionEngine } from '../src/lib/expressions/evaluate.ts';

const start = (row: { effective_range: { start: string } }) =>
	String(row.effective_range.start).slice(0, 10);

// ─── D11: unknown residence ─────────────────────────────────────────────────────────────────

for (const period of ['2025-12', '2026-01', '2026-06', '2026-07'])
	test(`VN D11 ${period}: an unrecorded tax residence stops PIT`, () => {
		assert.throws(
			() =>
				assessStatutory({
					code: 'VN',
					period,
					region: 'I',
					people: [{ key: 'VN-UNKNOWN', wage: 20_000_000, tax_residency: null }]
				}),
			/Record tax residency as resident or non-resident/
		);
	});

for (const period of ['2025-12', '2026-01', '2026-03'])
	test(`ID D11 ${period}: an unrecorded tax residence stops PPh 21 / PPh 26`, () => {
		assert.throws(
			() =>
				assessStatutoryUnvalidated({
					code: 'ID',
					period,
					region: 'DKI Jakarta',
					riskClass: 'II',
					people: [{ key: 'ID-UNKNOWN', wage: 10_000_000, tax_residency: null }]
				}),
			/Record tax residency as resident or non-resident/
		);
	});

// ─── D12: a change of residence during the year ─────────────────────────────────────────────

/** Eleven earlier 2026 payslips of 30,000,000: non-resident 20% January–June, resident after. */
function residentFromJuly(world: PayrollWorld) {
	const employment = world.employments[0]!;
	// 30,000,000: SI 8% 2,400,000, HI 1.5% 450,000, UI 1% 300,000 (Law 41/2024 art.33; Law 74/2025).
	// July–November on the monthly table: 30,000,000 − 3,150,000 − 15,500,000 = 11,350,000 →
	// 5% × 10,000,000 + 10% × 1,350,000 = 635,000. January–June 20% × 30,000,000 = 6,000,000.
	for (let month = 1; month <= 11; month += 1) {
		const period = `2026-${String(month).padStart(2, '0')}`;
		world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
		const line = (scheme_code: string, employee_amount: number) => ({
			scheme_code,
			employee_amount,
			employer_amount: 0,
			base_amount: 30_000_000,
			rule_when: null,
			authority: null
		});
		world.payslips.push({
			id: `payslip-${period}`,
			payroll_run_id: `prior-${period}`,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${period}-28T00:00:00.000Z`,
			currency: 'VND',
			base: [],
			adjustments: [],
			statutory: [
				line('SI', 2_400_000),
				line('HI', 450_000),
				line('UI', 300_000),
				line('PIT', month <= 6 ? 6_000_000 : 635_000)
			]
		});
	}
}

test('VN D12: each month is withheld on its own recorded residence; the change is not re-withheld', () => {
	// July, now resident: the monthly table on 30,000,000 alone (635,000), not a re-pricing of the
	// non-resident months.
	const book = assessStatutory(
		{
			code: 'VN',
			period: '2026-07',
			region: 'I',
			people: [{ key: 'VN-ARRIVED', wage: 30_000_000, tax_residency: 'RESIDENT' }]
		},
		(world) => {
			residentFromJuly(world);
			world.payslips.splice(6);
			world.payroll_runs.splice(6);
		}
	);
	expectStatutory(book, 'VN-ARRIVED', 'PIT', 635_000, 0);
});

test('VN D12: the authorised finalisation re-prices the whole resident year and credits the 20% withheld', () => {
	// December, authorised (Decree 126/2020 art.8(6)(d); Decree 253/2026 art.51): the year's
	// 12 × 30,000,000 = 360,000,000, less 12 × 3,150,000 = 37,800,000 insurance and
	// 12 × 15,500,000 = 186,000,000 self-deduction = 136,200,000 on the annual table:
	// 5% × 120,000,000 + 10% × 16,200,000 = 7,620,000. Withheld to date 6 × 6,000,000 +
	// 5 × 635,000 = 39,175,000, so December refunds 31,555,000.
	const book = assessStatutory(
		{
			code: 'VN',
			period: '2026-12',
			region: 'I',
			people: [
				{
					key: 'VN-ARRIVED',
					wage: 30_000_000,
					tax_residency: 'RESIDENT',
					registrations: {
						PIT: { kind: 'REGISTERED', elections: { finalisation_authorised: true } }
					}
				}
			]
		},
		residentFromJuly
	);
	expectStatutory(book, 'VN-ARRIVED', 'PIT', 7_620_000 - 39_175_000, 0);
});

// ─── D13: an ordinary night shift ───────────────────────────────────────────────────────────

const NIGHT_SHIFT_ID = 'c0000000-0000-4000-8000-0000000000e1';

/** One ordinary night shift, 22:00 to 07:00 with an hour's break: eight hours, all at night. */
function nightShift(world: PayrollWorld, date: string) {
	const [year, month, day] = date.split('-').map(Number);
	const next = new Date(Date.UTC(year!, month! - 1, day! + 1)).toISOString().slice(0, 10);
	world.shift_definitions.push({
		id: NIGHT_SHIFT_ID,
		company_id: COMPANY_ID,
		code: 'NIGHT',
		name: 'Night',
		variant: { kind: 'WORK', start_time: '22:00', end_time: '07:00', break_minutes: 60 },
		effective_range: { start: '2000-01-01', end: null },
		approval_id: null
	});
	world.work_days.push({
		id: `wd-night-${date}`,
		employment_id: world.employments[0]!.id,
		work_date: date,
		shift_definition_id: NIGHT_SHIFT_ID,
		worked_intervals: [{ start: `${date}T22:00:00+07:00`, end: `${next}T07:00:00+07:00` }],
		approval_id: null
	});
}

for (const [period, date, wage, residency, base, tax, derivation] of [
	// January 2026, 22 weekdays: 35,200,000 ÷ 22 ÷ 8 = 200,000 an hour; 8 night hours = 1,600,000,
	// premium 30% = 480,000. Insurance: SI 2,816,000 + HI 528,000 + UI 352,000 = 3,696,000.
	[
		'2026-01',
		'2026-01-12',
		35_200_000,
		'RESIDENT',
		33_600_000,
		940_400,
		'resident from tax year 2026: 35,200,000 − the 1,600,000 night wage = 33,600,000; − 3,696,000 − 15,500,000 = 14,404,000 → 500,000 + 10% × 4,404,000 = 940,400'
	],
	[
		'2026-01',
		'2026-01-12',
		35_200_000,
		'NON_RESIDENT',
		35_200_000,
		7_040_000,
		'non-resident before 1 July 2026 (art.69(1)): only the premium is exempt, 20% × 35,200,000 = 7,040,000'
	],
	// July 2026, 23 weekdays: 36,800,000 ÷ 23 ÷ 8 = 200,000. Insurance: SI 2,944,000 + HI 552,000 +
	// UI 368,000 = 3,864,000.
	[
		'2026-07',
		'2026-07-06',
		36_800_000,
		'NON_RESIDENT',
		35_200_000,
		7_040_000,
		'non-resident from 1 July 2026: 36,800,000 − 1,600,000 = 35,200,000 × 20% = 7,040,000'
	],
	[
		'2026-07',
		'2026-07-06',
		36_800_000,
		'RESIDENT',
		35_200_000,
		1_083_600,
		'resident: 35,200,000 − 3,864,000 − 15,500,000 = 15,836,000 → 500,000 + 10% × 5,836,000 = 1,083,600'
	],
	// December 2025, 23 weekdays: 36,800,000 ÷ 23 ÷ 8 = 200,000; Circular 111/2013 art.3(1)(i).
	[
		'2025-12',
		'2025-12-08',
		36_800_000,
		'RESIDENT',
		36_800_000,
		2_737_200,
		'Circular 111/2013 exempts the premium only: 36,800,000 − 3,864,000 − 11,000,000 = 21,936,000 → 1,950,000 + 20% × 3,936,000 = 2,737,200'
	]
] as const)
	test(`VN D13 ${period} ${residency}: an ordinary night shift — ${derivation}`, () => {
		const { slips } = buildStatutory(
			{
				code: 'VN',
				period,
				region: 'I',
				people: [{ key: 'VN-NIGHT', wage, tax_residency: residency }]
			},
			(world) => nightShift(world, date)
		);
		const slip = slips.get('VN-NIGHT')!;
		const line = (code: string) =>
			slip.adjustments
				.filter((row) => row.component_code === code)
				.map((row) => [row.quantity, row.amount, row.bucket]);
		assert.deepEqual(line('NIGHT_PREMIUM'), [[8, 480_000, 'EARNING']]);
		// The statement art.26(1) ¶2 asks for: the night hours and the night wage paid.
		assert.deepEqual(line('NIGHT_WAGE'), [[8, 1_600_000, 'INFORMATION']]);
		const pit = slip.statutory.find((row) => row.scheme_code === 'PIT')!;
		assert.deepEqual([pit.base_amount, pit.employee_amount], [base, tax]);
	});

// ─── D14: leave pay beyond the statutory level ──────────────────────────────────────────────

test('VN D14: cessation leave pay is exempt and an excess paid beside it is income of the paying month', () => {
	// A leaver whose last day falls in the period is paid 1,000,000 for untaken days (art.26(2):
	// exempt) and 500,000 more than the statutory level as an ad hoc payment (art.26(3): taxable).
	// The base is this payslip's own lines — nothing reaches back into earlier months.
	const july = contributionSchemes('VN').find(
		(row) =>
			row.code === 'PIT' &&
			start(settingsVersions('VN').find((version) => version.id === row.settings_id)!) ===
				'2026-07-01'
	)!;
	assert.equal(/year|earned|history/.test(july.assessed_on), false);
	const base = evaluateNumber(expressionEngine, july.assessed_on, {
		BASE: 10_000_000,
		ALLOWANCES: 0,
		ADHOC: 500_000,
		OVERTIME: 0,
		OVERTIME_PREMIUM: 0,
		ENCASHMENT: 1_000_000,
		INCENTIVE: 0,
		NIGHT_WAGE: 0,
		ABSENCE: 0,
		NO_PAY_LEAVE: 0,
		MEAL: { ALLOWANCES: 0, ADHOC: 0 },
		HOUSING: { ALLOWANCES: 0, ADHOC: 0 },
		person: { terms: { tax_residency: 'RESIDENT' }, employment: { exit_date: '2026-07-15' } },
		period: { end: '2026-07-20' }
	});
	assert.equal(base, 10_500_000);
});

// ─── D15 / D16: every declared input is required or carries a cited default ───────────────

test('VN and ID D15: every election, entity fact and departure input is required or has a statutory default', () => {
	for (const lineage of ['VN', 'ID'] as const) {
		const undeclared: string[] = [];
		const versions = settingsVersions(lineage);
		const settled = (field: {
			required?: boolean;
			required_when?: string;
			default_value?: unknown;
		}) =>
			field.required === true || field.required_when != null || field.default_value !== undefined;
		for (const version of versions) {
			// A cash-out profile's `required_facts` stop the cash-out by name when unrecorded.
			const atUse = new Set<string>(version.work_rules.encashment?.required_facts ?? []);
			for (const field of [...(version.facts ?? []), ...(version.exit_facts ?? [])])
				if (!settled(field) && !atUse.has(field.key))
					undeclared.push(`${start(version)} ${field.key}`);
		}
		// An election a rule of the scheme warns of when undeclared (`"<key>" in
		// scheme.election_keys` under a `warning`) is settled by that rule: nothing is charged on a
		// guess, and the run names the person.
		const warned = (
			scheme: { rules: readonly { warning?: string; when: string }[] },
			key: string
		) =>
			scheme.rules.some(
				(rule) => rule.warning != null && rule.when.includes(`"${key}" in scheme.election_keys`)
			);
		for (const scheme of contributionSchemes(lineage))
			for (const field of scheme.elections ?? [])
				if (!settled(field) && !warned(scheme, field.key))
					undeclared.push(`${scheme.code}.${field.key}`);
		assert.deepEqual(undeclared, [], lineage);
	}
});

test('ID D16: PPh 21 no longer reads the current family record, and THR no longer reads religion', () => {
	for (const scheme of contributionSchemes('ID').filter((row) => row.code === 'PPH21'))
		assert.equal(
			/employee\.(marital_status|dependents_count)|election_keys/.test(
				// The undeclared-PTKP warning reads which elections are declared, never their values.
				JSON.stringify(scheme.rules.filter((rule) => rule.warning == null))
			),
			false
		);
	for (const row of adhocCatalogue('ID').filter((item) => item.code === 'THR'))
		assert.equal(row.eligibility.includes('religion'), false);
});

test('ID D15: a resident without the declared tax identity withholds no PPh 21 and warns (UU PPh art.21(5a))', () => {
	const run = buildStatutory(
		{
			code: 'ID',
			period: '2026-03',
			region: 'DKI Jakarta',
			riskClass: 'II',
			people: [{ key: 'ID-NO-ID', wage: 10_000_000 }]
		},
		(world) => {
			for (const fact of world.employment_statutory_facts) delete fact.status.elections?.no_tax_id;
		}
	);
	assert.equal(
		run.slips.get('ID-NO-ID')!.statutory.find((row) => row.scheme_code === 'PPH21')
			?.employee_amount ?? 0,
		0
	);
	assert.match(run.warnings.join('\n'), /ID-NO-ID: PPH21: .*NPWP or NIK, not declared/);
});

test('ID D15: a declared missing tax identity withholds 20% more (UU PPh art.21(5a))', () => {
	// TK/0 on 10,000,000 in March 2026: gross 10,000,000 + JKK 0.54% 54,000 + JKM 0.30% 30,000 +
	// Kesehatan 4% 400,000 = 10,484,000 (PMK 168/2023 art.5(1)). The surcharge multiplies the
	// same TER withholding by 1.2, so the two figures stand in that ratio.
	const run = (noTaxId: boolean) =>
		chargeOf(
			assessStatutoryUnvalidated({
				code: 'ID',
				period: '2026-03',
				region: 'DKI Jakarta',
				riskClass: 'II',
				people: [
					{
						key: 'ID-TK0',
						wage: 10_000_000,
						registrations: { PPH21: { kind: 'REGISTERED', elections: { no_tax_id: noTaxId } } }
					}
				]
			}),
			'ID-TK0',
			'PPH21'
		);
	const declared = run(false);
	const missing = run(true);
	assert.equal(declared.base, 10_484_000);
	assert.ok(declared.employee > 0);
	assert.equal(missing.employee, Math.round(declared.employee * 1.2));
});

for (const [lineage, person, message] of [
	[
		'VN',
		{ key: 'X', wage: 20_000_000, citizenship: null },
		/Record the employee as a Vietnamese citizen or a foreign national/
	],
	[
		'VN',
		{ key: 'X', wage: 20_000_000, citizenship: 'FOREIGNER', pass_type: '' },
		/Record the foreign employee’s gender and work permit type/
	],
	[
		'VN',
		{ key: 'X', wage: 20_000_000, citizenship: 'FOREIGNER', gender: '' },
		/Record the foreign employee’s gender and work permit type/
	],
	[
		'ID',
		{ key: 'X', wage: 10_000_000, citizenship: null },
		/Record the employee as an Indonesian citizen or a foreign national/
	],
	[
		'ID',
		{ key: 'X', wage: 10_000_000, marital_status: 'MARRIED', gender: '' },
		/Record the married employee’s gender/
	]
] as const)
	test(`${lineage} D16: an unrecorded ${Object.keys(person).at(-1)} stops the run`, () => {
		assert.throws(
			() =>
				assessStatutoryUnvalidated({
					code: lineage,
					period: '2026-07',
					region: lineage === 'VN' ? 'I' : 'DKI Jakarta',
					riskClass: 'II',
					people: [person]
				}),
			message
		);
	});

test('ID D16: an entity with no JKK risk group stops the run (PP 44/2015 art.16)', () => {
	assert.throws(
		() =>
			assessStatutoryUnvalidated({
				code: 'ID',
				period: '2026-07',
				region: 'DKI Jakarta',
				riskClass: '1',
				people: [{ key: 'X', wage: 10_000_000 }]
			}),
		/Record the entity’s JKK risk group/
	);
});

// ─── G14: THR for a 2027 leaver ─────────────────────────────────────────────────────────────

test('ID G14: a 2027 departure is judged against the 2027 religious holiday, not the 2026 dates', () => {
	// Idul Fitri 1448 H declared as 10 March 2027 (the SKB date the employer records). Thirty days
	// before it is 8 February 2027 (720 hours).
	// • PKWTT, last day 15 February 2027: inside the thirty days → one month's wage, 10,000,000
	//   (art.3(1)(a): more than twelve months' service).
	// • PKWTT, last day 5 February 2027: outside them → nothing. Under the 2026 dates written into
	//   the old window (on or after 21 March 2026) this leaver was paid.
	// • PKWT, last day 15 February 2027: art.7(3), a fixed term ending before the holiday → nothing.
	const holiday = '2027-03-10';
	const world = createStatutoryWorld({
		code: 'ID',
		period: '2027-02',
		region: 'DKI Jakarta',
		riskClass: 'II',
		people: [
			{ key: 'PKWTT-15FEB', wage: 10_000_000, hire_date: '2020-01-01', exit_date: '2027-02-15' },
			{ key: 'PKWTT-5FEB', wage: 10_000_000, hire_date: '2020-01-01', exit_date: '2027-02-05' },
			{
				key: 'PKWT-15FEB',
				wage: 10_000_000,
				employment_type: 'CONTRACT',
				hire_date: '2025-02-16',
				exit_date: '2027-02-15'
			}
		]
	});
	const resigned = {
		termination_cause: 'VOLUNTARY_RESIGNATION',
		separation_pay_amount: 0,
		separation_pay_reference: 'NONE',
		pension_offset_applies: false,
		micro_small_enterprise: false,
		thr_holiday_date: holiday
	};
	for (const employment of world.employments)
		employment.exit_facts =
			employment.employee_number === 'PKWT-15FEB'
				? { micro_small_enterprise: false, thr_holiday_date: holiday }
				: resigned;
	const version = world.jurisdiction_settings.find((row) => start(row) === '2026-03-01')!;
	const thr = world.adhoc_catalogue!.find(
		(row) => row.settings_id === version.id && row.code === 'THR'
	)!;
	for (const [index, employment] of world.employments.entries())
		world.adhoc_requests!.push({
			id: `d5000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
			employment_id: employment.id,
			catalogue_id: thr.id,
			amount: 1,
			event_date: String(employment.effective_range.end).slice(0, 10),
			pay_period: '2027-02',
			payslip_id: null,
			reason: 'THR on departure',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	const built = buildPayrollRun(
		Effect.runSync(
			gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2027-02' })
		)
	);
	const paid = (key: string) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		return built.payslip_payroll_run
			.find((row) => String(row.employment_id) === employment.id)!
			.adjustments.filter((line) => line.component_code === 'THR')
			.map((line) => line.amount);
	};
	assert.deepEqual(paid('PKWTT-15FEB'), [10_000_000]);
	assert.deepEqual(paid('PKWTT-5FEB'), []);
	assert.deepEqual(paid('PKWT-15FEB'), []);
});

test('ID G14: a departure without the declared holiday skips the THR, and a malformed date is refused', () => {
	const world = (facts: Record<string, string | number | boolean>) => {
		const w = createStatutoryWorld({
			code: 'ID',
			period: '2027-02',
			region: 'DKI Jakarta',
			riskClass: 'II',
			people: [
				{ key: 'LEAVER', wage: 10_000_000, hire_date: '2020-01-01', exit_date: '2027-02-15' }
			]
		});
		w.employments[0]!.exit_facts = {
			termination_cause: 'VOLUNTARY_RESIGNATION',
			separation_pay_amount: 0,
			separation_pay_reference: 'NONE',
			pension_offset_applies: false,
			micro_small_enterprise: false,
			...facts
		};
		const version = w.jurisdiction_settings.find((row) => start(row) === '2026-03-01')!;
		w.adhoc_requests!.push({
			id: 'd5000000-0000-4000-8000-000000000099',
			employment_id: w.employments[0]!.id,
			catalogue_id: w.adhoc_catalogue!.find(
				(row) => row.settings_id === version.id && row.code === 'THR'
			)!.id,
			amount: 1,
			event_date: '2027-02-15',
			pay_period: '2027-02',
			payslip_id: null,
			reason: 'THR on departure',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
		return () =>
			buildPayrollRun(
				Effect.runSync(
					gatherPayrollRun({ api: memoryPayrollApi(w), companyId: COMPANY_ID, period: '2027-02' })
				)
			);
	};
	// Undeclared, the THR cannot be judged and is skipped by name; the rest of the run is paid.
	const undeclared = world({})();
	assert.match(
		undeclared.warnings.join('\n'),
		/LEAVER: adhoc THR was captured for 2027-02 and paid nothing — the departure record is incomplete: Religious holiday the THR is judged against is required/
	);
	assert.throws(world({ thr_holiday_date: '10/03/2027' }), /must be a date written YYYY-MM-DD/);
});
