import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import { gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { leaveEncashmentRate } from '../src/lib/leave/encashment-rate.ts';
import { memoryPayrollApi, refusalMessage } from './fixtures/memory-payroll-api.ts';
import { settle } from '../src/collections/payroll_runs/lib/settle.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { id, leaveContext, submission, timeOff } from './helpers/manual-leave-context.ts';
import {
	COMPANY_ID,
	contributionSchemes,
	assessStatutory,
	buildStatutory,
	createStatutoryWorld,
	expectStatutory,
	leaveCatalogue,
	settingsVersions,
	type Person
} from './fixtures/statutory-world.ts';

const OUT = { kind: 'NOT_REGISTERED' };

// D07 — YA2025 TP1 in the MY / MY-nihon version of 1 December 2025. LHDN "Amendment to Specification
// for MTD Calculations Using Computerized Calculation for 2025" (1 January 2025), part E list of
// deductions a–p: the same caps as 2026 except learning-disability intervention (amendment 1.C:
// "increased from RM4,000 to RM6,000", raised to RM10,000 only from YA2026). No tourism relief and no
// food-waste-grinder/CCTV relief (Budget 2026, YA2026). Formulas D(1)–(5) are unchanged.
//
// December 2025 is the last month, so n = 0 and MTD = annual tax − MTD already paid (X = 0 here).
// Opening (TP3): 11 × 5,001 = 55,011; December 5,001; EPF/SOCSO/EIS not registered, so
// P = 60,012 − 9,000 − TP1 relief. Single resident (category 1): 35,001–50,000 → (P − 35,000) × 6% + 600;
// 50,001–70,000 → (P − 50,000) × 11% + 1,500.
const claim = (category: string, amount: number, period = '2025-12') => ({
	period,
	category,
	amount,
	source: 'EMPLOYEE' as const,
	reference: `${category} ${period} ${amount}`
});
const december = (
	key: string,
	claims: ReturnType<typeof claim>[],
	elections: Record<string, number | string | boolean> = {}
): Person => ({
	key,
	wage: 5001,
	citizenship: 'CITIZEN',
	hire_date: '2024-01-01',
	registrations: {
		EPF: OUT,
		EPF_PR: OUT,
		EPF_NON_CITIZEN: OUT,
		SOCSO: OUT,
		EIS: OUT,
		PCB: {
			kind: 'REGISTERED',
			deduction_claims: claims,
			elections,
			opening: [
				{ year: '2025', base: 55011, employee: 0, employer: 0, months: 11, reference: 'TP3 2025' }
			]
		}
	}
});

for (const code of ['MY', 'MY-nihon'] as const) {
	test(`${code} — D07 YA2025 TP1 claims price in December 2025 with the 2025 caps`, () => {
		const book = assessStatutory({
			code,
			period: '2025-12',
			people: [
				december('NONE', []),
				// Learning disability 11,000 → RM6,000 (YA2025): P = 45,012 → 10,012 × 6% + 600 = 1,200.72 → 1,200.75.
				december('LEARNING', [claim('LEARNING_DISABILITY', 11000)]),
				// Lifestyle 3,000 → RM2,500: P = 48,512 → 13,512 × 6% + 600 = 1,410.72 → 1,410.75.
				december('LIFESTYLE', [claim('LIFESTYLE', 3000)]),
				// Education/medical insurance 5,000 → RM4,000 (2025 amendment 7): P = 47,012 → 1,320.72 → 1,320.75.
				december('INSURANCE', [claim('EDUCATION_MEDICAL_INSURANCE', 5000)])
			]
		});
		// No claim: P = 51,012 → 1,012 × 11% + 1,500 = 1,611.32 → 1,611.35.
		expectStatutory(book, 'NONE', 'PCB', 1611.35, 0);
		expectStatutory(book, 'LEARNING', 'PCB', 1200.75, 0);
		expectStatutory(book, 'LIFESTYLE', 'PCB', 1410.75, 0);
		expectStatutory(book, 'INSURANCE', 'PCB', 1320.75, 0);
	});

	test(`${code} — D07 YA2026-only reliefs and a later first-home year refuse in YA2025`, () => {
		for (const category of ['TOURISM', 'FOOD_GRINDER_CCTV'])
			assert.throws(
				() =>
					buildStatutory({
						code,
						period: '2025-12',
						people: [december(category, [claim(category, 500)])]
					}),
				/YA2025 has no/
			);
		assert.throws(
			() =>
				buildStatutory({
					code,
					period: '2025-12',
					people: [
						december('HOME_2026', [claim('HOME_INTEREST', 1000)], {
							tp1_home_price: 400000,
							tp1_home_spa_date: '2025-06-01',
							tp1_home_first_interest_year: 2026,
							tp1_home_total_interest: 1000
						})
					]
				}),
			/first-home/
		);
	});

	test(`${code} — D07 first-home interest from 2025 prices in YA2025`, () => {
		// Price ≤ 500,000 → cap RM7,000; 8,000 paid by one owner → 7,000. P = 44,012 → 1,140.72 → 1,140.75.
		const book = assessStatutory({
			code,
			period: '2025-12',
			people: [
				december('HOME', [claim('HOME_INTEREST', 8000)], {
					tp1_home_price: 400000,
					tp1_home_spa_date: '2025-03-01',
					tp1_home_first_interest_year: 2025,
					tp1_home_total_interest: 8000
				})
			]
		});
		expectStatutory(book, 'HOME', 'PCB', 1140.75, 0);
	});

	test(`${code} — D07 approved profiles price in YA2025 within their approval years`, () => {
		const profile = (first: number, last: number) => ({
			pcb_tax_profile: 'REP',
			pcb_approval_first_year: first,
			pcb_approval_last_year: last,
			pcb_approval_reference: 'Synthetic REP approval',
			pcb_profile_conditions_confirmed: true
		});
		// D(3): P × 15% − X; P = 51,012 → 7,651.80 (above 35,000, no rebate).
		const book = assessStatutory({
			code,
			period: '2025-12',
			people: [december('REP', [], profile(2021, 2025))]
		});
		expectStatutory(book, 'REP', 'PCB', 7651.8, 0);
		// Approval 2026–2030 does not cover YA2025.
		assert.throws(
			() =>
				buildStatutory({
					code,
					period: '2025-12',
					people: [december('REP_LATER', [], profile(2026, 2030))]
				}),
			/approval years/
		);
	});
}

// ─── EA 1955 s.24(9)(b) / SG EA 1968 s.32(2): the final payslip ───────────────────────────────────

const line = (family: string, code: string, amount: number) => ({
	input: { family: family === 'LOAN' ? 'LOAN_REPAYMENT' : 'ADHOC', id: `${family}-${code}` },
	catalogueComponent: { id: code, code, family },
	bucket: 'DEDUCTION',
	label: code,
	amount
});
const finalSlip = (code: string, gross: number, statutory: number, lines: readonly unknown[]) =>
	settingsVersions(code).map((version) =>
		settle({
			base: [
				{
					catalogueComponent: { id: 'basic', code: 'BASIC', family: 'WORK' },
					bucket: 'EARNING',
					label: 'BASIC',
					amount: gross
				}
			],
			adjustments: lines as never,
			charges: [{ employee: statutory, employer: 0 }],
			currency: code === 'SG' ? 'SGD' : 'MYR',
			ceiling: version.payroll.deduction_ceiling,
			finalPay: true
		})
	);

test('MY s.24(9)(b): only amounts due to the employer leave the half on the final payslip — every version, both lineages', () => {
	// Act 265 s.24(9)(b): the limit does not apply to "deductions from the final payment of the wages
	// of an employee for any amount due to the employer and remaining unpaid". Wages 3,000 → half
	// 1,500; statutory 400 (s.24(2)(d), counted) leaves 1,100.
	for (const code of ['MY', 'MY-nihon']) {
		// A 1,300 loan recovery is owed to the employer: outside the limit, taken whole, nothing over.
		for (const slip of finalSlip(code, 3000, 400, [line('LOAN', 'AIR', 1300)])) {
			assert.deepEqual(slip.shortfalls, [], code);
			assert.equal(slip.ceilingExcess, 0, code);
			assert.equal(slip.net, 1300, code); // 3,000 − 400 − 1,300
		}
		// A 1,300 third-party deduction (s.24(4)(c)) is not owed to the employer: 1,300 − 1,100 = 200 over.
		for (const slip of finalSlip(code, 3000, 400, [
			line('LOAN', 'AIR', 700),
			line('ADHOC', 'THIRD_PARTY', 1300)
		])) {
			assert.equal(slip.ceilingExcess, 200, code);
			assert.deepEqual(slip.shortfalls, [], code); // the loan is not dropped to make room
		}
	}
});

test('SG s.32(2): every deduction from the last salary is outside the 50% limit — every version', () => {
	// EmA 1968 s.32(2) (SSO, 2026-09-23): "Subsection (1) does not apply to deductions made from the
	// last salary due to an employee on termination of his or her contract of service or on
	// completion of his or her contract of service." Salary 4,000, CPF 800, consented deduction 1,300:
	// 2,100 > 2,000 would be 100 over in an ordinary month, and is nothing over on the last salary.
	for (const slip of finalSlip('SG', 4000, 800, [line('ADHOC', 'CONSENTED', 1300)]))
		assert.equal(slip.ceilingExcess, 0);
});

// ─── G10: SG childcare leave — days taken with earlier employers ─────────────────────────────────

test('G10 SG: declared earlier-employer childcare days come off the 42-day lifetime room, not the year’s six — every version', () => {
	// MSF ProFamily, Childcare leave: GPCL "up to a total of 42 days per child"; "Employees are
	// entitled to take (prorated) GPCL with the new employer, regardless of the GPCL taken with the
	// previous employer". One citizen child born 2024 (under 7): six days a year; lifetime 42.
	for (const row of leaveCatalogue('SG').filter((entry) => entry.code === 'CHILDCARE_LEAVE')) {
		const refusal = (prior: number | null, from: string, to: string) => {
			const context = leaveContext();
			context.employees[0]!.children = [
				{
					child_birthdate: '2024-01-01',
					relationship: 'CHILD',
					effective_range: null,
					citizenship: 'CITIZEN',
					...(prior == null ? {} : { prior_childcare_days: prior })
				}
			];
			context.catalogues.push({
				id: id(27),
				settings_id: id(6),
				code: 'CHILDCARE_LEAVE',
				name: 'Childcare leave',
				is_npl: false,
				can_encash: false,
				evidence_after_days: null,
				eligibility: '',
				entitlement: row.entitlement
			} as never);
			try {
				planLeaveActivity(
					context,
					{ ...submission(timeOff(from, to), 'C1'), catalogue_id: id(27) },
					id(62)
				);
				return '';
			} catch (error) {
				return refusalMessage(error);
			}
		};
		// Nothing declared: five days (2–6 March 2026) fit the year's six and the 42.
		assert.equal(refusal(null, '2026-03-02', '2026-03-06'), '');
		// 38 declared with earlier employers: 42 − 38 = 4 left; five days are refused, four fit.
		assert.match(
			refusal(38, '2026-03-02', '2026-03-06'),
			/granted for 4 days in a lifetime; 0 are already taken/
		);
		assert.equal(refusal(38, '2026-03-02', '2026-03-05'), '');
		// 20 declared: 22 left, so the year's full six stand — the annual pool is not reduced.
		// (the fixture's roster works every day: 2–7 March is six days).
		assert.equal(refusal(20, '2026-03-02', '2026-03-07'), '');
	}
});

// ─── D19: SG leave cash-out for weekly, daily and hourly rates ──────────────────────────────────

/** The day rate SG prices a 1.5-day cash-out at on 30 June 2026, for a contract of this cadence. */
function sgCashDay(
	frequency: 'MONTHLY' | 'WEEKLY' | 'DAILY' | 'HOURLY',
	salary: number,
	allowance = 0
): number {
	const world = createStatutoryWorld({
		code: 'SG',
		period: '2026-06',
		people: [{ key: 'CASH', wage: salary }]
	});
	world.leave_catalogue.push(...leaveCatalogue('SG').map((row) => ({ ...row, approval_id: null })));
	const version = world.jurisdiction_settings.find(
		(row) => String(row.effective_range.start).slice(0, 10) === '2026-04-01'
	)!;
	const annual = world.leave_catalogue.find(
		(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
	)!;
	const terms = world.employment_terms[0]!;
	terms.pay_frequency = frequency;
	terms.ordinary_hours_per_week = 40;
	if (allowance > 0) {
		for (const row of world.jurisdiction_settings)
			row.work_rules.encashment!.include_allowances = ['SHIFT'];
		world.allowance_catalogue.push({
			id: 'a5000000-0000-4000-8000-000000000001',
			settings_id: version.id,
			code: 'SHIFT',
			name: 'SHIFT',
			destination: 'PAY',
			direction: 'ADD',
			eligibility: '',
			counts_toward: [],
			bands: [{ when: '', amount: 'entry.amount', limit: null }],
			approval_id: null
		} as never);
		terms.allowances = [
			{ catalogue_id: 'a5000000-0000-4000-8000-000000000001', amount: allowance }
		];
	}
	world.leave_entries.push({
		id: 'a5000000-0000-4000-8000-000000000002',
		employment_id: world.employments[0]!.id,
		catalogue_id: annual.id,
		leave_code: 'ANNUAL_LEAVE',
		reference: 'CASH-OUT',
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days: 1.5,
		encash_days: 1.5,
		effective_on: '2026-06-30',
		due_on: '2026-06-30',
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-06' })
	);
	const bundle = prepared.gathered.bundles[0]!;
	return leaveEncashmentRate({
		bundle,
		configuration: prepared.configuration,
		entry: bundle.leave.entries.find((entry) => entry.leave_code === 'ANNUAL_LEAVE')!
	});
}

test('D19 SG: weekly, daily and hourly contracts price a leave day at the EA s.2 gross rate of pay', () => {
	// EmA 1968 s.2: gross rate of pay is the money "for working for a period of time, that is, for
	// one hour, one day, one week, one month". Five-day week, 40 contractual hours.
	// Monthly (Third Schedule item 2): 2,600 × 12 ÷ (52 × 5) = 120.
	assert.equal(sgCashDay('MONTHLY', 2600), 120);
	// Daily: the day's rate itself, 120.
	assert.equal(sgCashDay('DAILY', 120), 120);
	// Hourly: 15 an hour × the day's normal hours, 40 ÷ 5 = 8 → 120.
	assert.equal(sgCashDay('HOURLY', 15), 120);
	// Weekly: 600 a week over the five days required in it → 120.
	assert.equal(sgCashDay('WEEKLY', 600), 120);
	// A qualifying monthly allowance of 260 adds its item 2 day share, 260 × 12 ÷ 260 = 12.
	assert.equal(sgCashDay('DAILY', 120, 260), 132);
});

// ─── D15 / D16: every MY, MY-nihon and SG key is required, conditionally required or defaulted ──

test('D15 MY, MY-nihon, SG: every declared election and fact names its requirement or a statutory default — every version', () => {
	// Keys whose absence is itself the statutory state are listed with the reason: SG
	// `shg_monthly_amount` (absent = the Schedule amount; presence is read by key), MY `wages_12m`
	// (read only for months no payslip covers, refused where neither exists), and the PCB
	// approval/levy keys already carrying `required_when`.
	const absenceIsTheLaw = new Set(['shg_monthly_amount', 'wages_12m']);
	const unsettled: string[] = [];
	const check = (where: string, field: Record<string, unknown>) => {
		if (
			!absenceIsTheLaw.has(String(field.key)) &&
			field.required !== true &&
			field.required_when == null &&
			!('default_value' in field)
		)
			unsettled.push(`${where} ${String(field.key)}`);
	};
	for (const code of ['MY', 'MY-nihon', 'SG'] as const) {
		for (const version of settingsVersions(code)) {
			const at = `${code} ${String(version.effective_range.start).slice(0, 10)}`;
			for (const field of (version.facts ?? []) as Record<string, unknown>[])
				check(`${at} fact`, field);
			for (const field of (version.exit_facts ?? []) as Record<string, unknown>[])
				check(`${at} exit`, field);
		}
		for (const scheme of contributionSchemes(code))
			for (const field of (scheme.elections ?? []) as Record<string, unknown>[])
				check(`${code} ${scheme.code}`, field);
	}
	assert.deepEqual(unsettled, []);
});

test('D16 SG: an unrecorded residency status refuses CPF; an unrecorded race or religion warns and deducts no fund', () => {
	// CPF Act 1953 s.7: contributions for every citizen and PR employee, so no residency status is
	// no CPF at all. The SHG funds deduct by NRIC race (CDAC, ECF, SINDA for citizens and PRs) and by
	// religion (MBMF) unless opted out; the identity cannot be assumed, and a fund of undeterminable
	// membership is not a reason to stop everyone else's pay: the run deducts no fund and says so.
	const run = (person: Partial<Person>) =>
		buildStatutory({
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'X', wage: 3000, citizenship: 'CITIZEN', ...person } as Person]
		});
	const refusal = (person: Partial<Person>) => {
		try {
			run(person);
			return '';
		} catch (error) {
			return refusalMessage(error);
		}
	};
	const funds = (person: Partial<Person>) =>
		run(person)
			.slips.get('X')!
			.statutory.filter((row) => ['CDAC', 'ECF', 'SINDA', 'MBMF'].includes(row.scheme_code))
			.reduce((sum, row) => sum + row.employee_amount, 0);
	assert.match(refusal({ citizenship: '' }), /residency status: CPF/);
	assert.match(run({ race: '' }).warnings.join('\n'), /X: CDAC: Race not stated/);
	assert.equal(funds({ race: '' }), 0);
	assert.match(run({ religion: '' }).warnings.join('\n'), /X: MBMF: Religion not stated/);
	// A foreign worker has no NRIC race: nothing to warn of.
	assert.doesNotMatch(
		run({ citizenship: 'FOREIGNER', race: '' }).warnings.join('\n'),
		/Race not stated/
	);
	// A recorded race still deducts: CDAC's $2,000–$3,500 band is $1.00.
	assert.equal(funds({ race: 'CHINESE' }), 1);
});

test('SG versions chain: each version is cloned from the one it follows', () => {
	const versions = settingsVersions('SG');
	for (const [index, version] of versions.entries())
		if (index > 0) assert.equal(version.cloned_from_id, versions[index - 1]!.id);
});
