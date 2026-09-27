// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Round 2, letter A — the deduction ceiling, the working-day final-pay deadline, Singapore's
 * departure facts, the exit pay-out condition on annual leave and Singapore's salary in lieu of
 * notice. Every figure is derived by hand from the instrument named beside it; the ceilings, rules
 * and predicates are read from the sealed seed, so a test is of the law as transcribed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { Effect } from 'effect';
import { settle } from '../src/lib/payroll/run/settle.ts';
import { settleExit } from '../src/lib/leave/exit-settlement.ts';
import { evaluateBoolean, expressionEngine } from '../src/lib/expressions/evaluate.ts';
import {
	COMPANY,
	COMPANY_ID,
	assessStatutory,
	buildStatutory,
	contributionSchemes,
	expectStatutory,
	expectStatutoryBase,
	leaveCatalogue,
	settingsVersions
} from './fixtures/statutory-world.ts';
import { readLawFile } from './fixtures/law-file.ts';
import { id, leaveContext } from './helpers/manual-leave-context.ts';

const versionOn = (code: string, date: string) =>
	settingsVersions(code).find(
		(version) =>
			String(version.effective_range.start).slice(0, 10) <= date &&
			date < String(version.effective_range.end).slice(0, 10)
	);
const ceilingOf = (code: string, date = '2026-01-15') =>
	versionOn(code, date).payroll.deduction_ceiling;

// ─── settle(): the ceiling each lineage seals ───────────────────────────────────────────────────

const earning = (amount: number) => ({
	catalogueComponent: { id: 'basic', code: 'BASIC', family: 'WORK' },
	bucket: 'EARNING',
	label: 'BASIC',
	amount
});
const deduction = (code: string, amount: number) => ({
	input: { family: 'ADHOC', id: `adhoc-${code}` },
	catalogueComponent: { id: code, code, family: 'ADHOC' },
	bucket: 'DEDUCTION',
	label: code,
	amount
});
const loan = (code: string, amount: number) => ({
	input: { family: 'LOAN_REPAYMENT', id: `repayment-${code}` },
	catalogueComponent: { id: code, code, family: 'LOAN' },
	bucket: 'DEDUCTION',
	label: code,
	amount
});
const settled = (
	code: string,
	gross: number,
	statutory: number,
	adjustments: readonly unknown[],
	finalPay = false
) =>
	settle({
		base: [earning(gross)],
		adjustments,
		charges: [{ contribution: { row: { code: 'SI' } }, employee: statutory, employer: 0 }],
		currency: 'MYR',
		ceiling: ceilingOf(code),
		finalPay
	});

test('MY EA s.24(8): deductions in a month stay within half the wages, statutory deductions counted', () => {
	for (const code of ['MY', 'MY-nihon']) {
		// Wages 3,000 → s.24(8) half = 1,500; EPF/SOCSO/EIS/MTD 400 are s.24(2)(d) deductions under
		// the section, leaving 1,100. Loans 700 then 500 = 1,200 > 1,100: the last recovery (500) is
		// dropped whole and stays outstanding; 700 ≤ 1,100 fits.
		const month = settled(code, 3000, 400, [loan('AIR', 700), loan('FESTIVE', 500)]);
		assert.deepEqual(
			month.adjustments.map((row) => row.label),
			['AIR'],
			code
		);
		assert.deepEqual(month.shortfalls, [
			{ componentCatalogueId: 'FESTIVE', amount: 500, cause: 'DEDUCTION_CEILING' }
		]);
		assert.equal(month.ceilingExcess, 0);
		assert.equal(month.net, 1900); // 3,000 − 400 − 700
		// s.24(9)(b): deductions from the final payment of wages are outside the limit.
		const last = settled(code, 3000, 400, [loan('AIR', 700), loan('FESTIVE', 500)], true);
		assert.deepEqual(last.shortfalls, []);
		assert.equal(last.net, 1400); // 3,000 − 400 − 1,200
	}
});

test('SG EA s.32: CPF counts toward the half, loans (s.27(1)(f)) do not, and an excess other deduction is reported', () => {
	// Salary 4,000 → half = 2,000; employee CPF 800 (s.27(1)(h)) counts, leaving 1,200. A consented
	// deduction (s.27(1)(i)) of 1,300 exceeds it by 100; a 1,000 loan instalment is s.27(1)(f),
	// outside s.32 and at s.31(5)'s separate quarter limit.
	const month = settled('SG', 4000, 800, [deduction('CONSENTED', 1300), loan('STAFF', 1000)]);
	assert.equal(month.ceilingExcess, 100);
	assert.deepEqual(month.shortfalls, []);
	assert.equal(month.adjustments.length, 2);
	// 1,200 exactly fits.
	assert.equal(settled('SG', 4000, 800, [deduction('CONSENTED', 1200)]).ceilingExcess, 0);
	// s.32(2): the last salary on termination is outside the limit.
	assert.equal(settled('SG', 4000, 800, [deduction('CONSENTED', 1300)], true).ceilingExcess, 0);
	// Statutory alone past the half is not the run's to cut: with nothing counted, nothing is over.
	assert.equal(settled('SG', 1000, 600, []).ceilingExcess, 0);
});

test('ID PP 36/2021 art.65: art.63 deductions at most half of each wage payment, final pay included', () => {
	// Wage 10,000,000 → half = 5,000,000. BPJS/PPh 300,000 are art.64(3), not counted; the employee's
	// BPJS Kesehatan termination-month share (200,000) is exempt by code. DEDUCTION 4,000,000 +
	// STAFF_LOAN 1,500,000 = 5,500,000 > 5,000,000: the loan is dropped, leaving 4,000,000.
	const lines = [
		deduction('DEDUCTION', 4_000_000),
		deduction('KESEHATAN_TERMINATION_MONTH_EMPLOYEE', 200_000),
		loan('STAFF_LOAN', 1_500_000)
	];
	for (const finalPay of [false, true]) {
		const month = settled('ID', 10_000_000, 300_000, lines, finalPay);
		assert.deepEqual(
			month.shortfalls.map((row) => [row.componentCatalogueId, row.amount]),
			[['STAFF_LOAN', 1_500_000]],
			`final pay ${finalPay}`
		);
		assert.equal(month.ceilingExcess, 0);
	}
});

test('VN Labour Code art.102(3): compensation deductions at most 30% of the wage paid after SI, HI, UI and PIT', () => {
	// Gross 10,000,000; employee SI 8% + HI 1.5% + UI 1% = 1,050,000 → 8,950,000 × 30% = 2,685,000.
	// A 2,700,000 compensation deduction exceeds it by 15,000. An advance (art.101) is outside art.102.
	const month = settled('VN', 10_000_000, 1_050_000, [
		deduction('COMPENSATION', 2_700_000),
		loan('ADVANCE', 1_000_000)
	]);
	assert.equal(month.ceilingExcess, 15_000);
	assert.deepEqual(month.shortfalls, []);
	assert.equal(
		settled('VN', 10_000_000, 1_050_000, [deduction('COMPENSATION', 2_685_000)]).ceilingExcess,
		0
	);
});

test('PH and TW state no general deduction ceiling (Labor Code art.113; LSA §22, §26)', () => {
	for (const code of ['PH', 'TW'])
		for (const version of settingsVersions(code))
			assert.equal(version.payroll.deduction_ceiling ?? null, null, code);
});

// ─── the run: a dropped recovery warns, an excess blocks ────────────────────────────────────────

const unregistered = (code: string) =>
	Object.fromEntries(
		contributionSchemes(code).map((row) => [row.code, { kind: 'NOT_REGISTERED' }])
	);

test('MY run: a loan instalment past the s.24(8) half stays outstanding and the run says why', () => {
	// Wages 3,000, no statutory deductions registered → half = 1,500. The air-ticket instalment
	// (1,000, due 5 Jan) fits; the festive-advance instalment (800, due 10 Jan) would make 1,800.
	const version = versionOn('MY', '2026-01-15');
	const catalogue = readLawFile(
		resolve(import.meta.dirname, '../seed/jurisdiction/MY/loan_catalogue')
	).filter((row) => row.settings_id === version.id);
	const { slips, warnings } = buildStatutory(
		{
			code: 'MY',
			period: '2026-01',
			people: [
				{ key: 'BORROWER', wage: 3000, citizenship: 'CITIZEN', registrations: unregistered('MY') }
			]
		},
		(world) => {
			world.loan_catalogue.push(
				...catalogue.map((row) => ({
					...row,
					loan_type: null,
					minimum_repayment: null,
					approval_id: null
				}))
			);
			const employment = world.employments[0];
			for (const [index, [code, amount, due]] of [
				['LOAN_RECOVERY_AIR_TICKET', 1000, '2026-01-05'],
				['LOAN_RECOVERY_FESTIVE_ADVANCE', 800, '2026-01-10']
			].entries()) {
				world.loans.push({
					id: `loan-${index}`,
					employment_id: employment.id,
					loan_catalogue_id: catalogue.find((row) => row.code === code).id,
					principal: amount,
					effective_range: { start: '2026-01-01', end: '2026-12-31' },
					approval_id: null
				});
				world.loan_repayments.push({
					id: `repayment-${index}`,
					loan_id: `loan-${index}`,
					employment_id: employment.id,
					due_date: due,
					amount_due: amount,
					sequence: 1,
					payslip_id: null,
					approval_id: null
				});
			}
		}
	);
	const slip = slips.get('BORROWER');
	assert.deepEqual(
		slip.adjustments.map((row) => [row.component_code, row.amount]),
		[['LOAN_RECOVERY_AIR_TICKET', 1000]]
	);
	assert.equal(slip.net, 2000);
	assert.ok(
		warnings.some(
			(line) =>
				line.includes('LOAN_REPAYMENT_SHORT') &&
				line.includes('LOAN_RECOVERY_FESTIVE_ADVANCE') &&
				line.includes('lawful ceiling')
		),
		JSON.stringify(warnings)
	);
});

test('SG run: a consented deduction past the s.32 half refuses the payroll by name', () => {
	// Salary 4,000 → half = 2,000. CPF is owed for a citizen whether or not the employer registered (the CPF scheme
	// assesses unregistered), and s.27(1)(h) CPF counts toward s.32: 800 + a 2,500 consented deduction is 1,300 over.
	assert.throws(
		() =>
			buildStatutory(
				{
					code: 'SG',
					period: '2026-01',
					people: [
						{
							key: 'SG-DED',
							wage: 4000,
							citizenship: 'CITIZEN',
							registrations: { ...unregistered('SG'), SDL: { kind: 'REGISTERED' } }
						}
					]
				},
				(world) => {
					const version = versionOn('SG', '2026-01-15');
					world.adhoc_catalogue.push({
						id: 'consented-deduction',
						settings_id: version.id,
						code: 'CONSENTED_DEDUCTION',
						name: 'Consented deduction',
						authority: 'EA s.27(1)(i)',
						eligibility: '',
						evidence: 'NONE',
						destination: 'NET',
						direction: 'SUBTRACT',
						bands: [{ when: '', amount: 'entry.amount', limit: null }],
						counts_toward: [],
						raised_by: 'MANUAL',
						approval_id: null
					});
					world.adhoc_requests.push({
						id: 'd4000000-0000-4000-8000-000000000001',
						employment_id: world.employments[0].id,
						catalogue_id: 'consented-deduction',
						amount: 2500,
						event_date: '2026-01-15',
						pay_period: '2026-01',
						payslip_id: null,
						reason: 'consented',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
			),
		/DEDUCTION_CEILING_EXCEEDED: SG-DED: deductions exceed the lawful ceiling by 1300 SGD \(Employment Act 1968 s\.32/
	);
});

// ─── VN art.48(1): fourteen working days ────────────────────────────────────────────────────────

const holiday = (date: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name: 'Test holiday',
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	given_to: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
const vnLate = (exit: string, holidays: readonly string[] = []) =>
	buildStatutory(
		{
			code: 'VN',
			period: '2026-01',
			region: 'I',
			people: [
				{
					key: 'VN-LEAVER',
					wage: 10_000_000,
					exit_date: exit,
					exit_reason: 'RESIGNATION',
					citizenship: 'CITIZEN'
				}
			]
		},
		(world) => world.jurisdiction_holidays.push(...holidays.map(holiday))
	).warnings.find((line) => line.startsWith('FINAL_PAY_LATE'));

test('VN art.48(1): the final settlement is due on the 14th working day of the leaver’s pattern, holidays excluded', () => {
	// The January run pays on 31 Jan 2026. Pattern Monday–Friday.
	// Last day Fri 9 Jan: working days 12–16 (5), 19–23 (10), 26–29 (14) → due Thu 29 Jan: late.
	assert.match(vnLate('2026-01-09') ?? '', /within 14 working days of the last day, by 2026-01-29/);
	// A published holiday on Wed 21 Jan is not a working day: the 14th becomes Fri 30 Jan.
	assert.match(vnLate('2026-01-09', ['2026-01-21']) ?? '', /by 2026-01-30/);
	// Last day Tue 13 Jan: 14–16 (3), 19–23 (8), 26–30 (13) — the 14th is 2 Feb, after the pay
	// date: on time. Fourteen calendar days (27 Jan) would have warned.
	assert.equal(vnLate('2026-01-13'), undefined);
});

// ─── SG departure facts ─────────────────────────────────────────────────────────────────────────

test('SG EA s.23: a resignation with notice served is paid on the last day, without it within 7 days', () => {
	const late = (facts?: Record<string, boolean>) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [
					{ key: 'SG-QUIT', wage: 6000, exit_date: '2026-01-10', exit_reason: 'RESIGNATION' }
				]
			},
			(world) => {
				if (facts != null) world.employments[0].exit_facts = facts;
			}
		).warnings.find((line) => line.startsWith('FINAL_PAY_LATE'));
	// s.23(2): 10 Jan + 7 = 17 Jan.
	assert.match(late() ?? '', /by 2026-01-17.*s\.23\(2\)/);
	assert.match(late({ notice_served: false }) ?? '', /by 2026-01-17/);
	// s.23(1): the day the contract ends.
	assert.match(late({ notice_served: true }) ?? '', /by 2026-01-10.*23\(1\)/);
});

test('SG EA s.22: employer exit is payable immediately unless same-day payment was impossible', () => {
	for (const version of settingsVersions('SG')) {
		assert.equal(version.payroll.final_pay_deadlines[1].days, 3);
		assert.equal(version.payroll.final_pay_deadlines[1].basis, 'NON_REST_HOLIDAY_DAYS');
		assert.match(version.payroll.final_pay_deadlines[1].when, /final_pay_not_possible/);
		assert.equal(version.payroll.final_pay_deadlines[2].days, 0);
		assert.ok(version.exit_facts.some((fact) => fact.key === 'final_pay_not_possible'));
	}
	const late = (facts: Record<string, boolean>, holidays: readonly string[] = []) =>
		buildStatutory(
			{
				code: 'SG',
				period: '2026-01',
				people: [
					{ key: 'SG-DISMISSED', wage: 6000, exit_date: '2026-01-23', exit_reason: 'DISMISSAL' }
				]
			},
			(world) => {
				world.employments[0]!.exit_facts = facts;
				world.jurisdiction_holidays.push(...holidays.map(holiday));
				const offId = 'f0000000-0000-4000-8000-000000000033';
				world.shift_definitions.push({
					...world.shift_definitions[1]!,
					id: offId,
					code: 'OFF',
					name: 'Off day',
					variant: { kind: 'OFF' }
				});
				world.shift_patterns[0]!.pattern.days[5] = { roster_code_id: offId };
			}
		).warnings.find((line) => line.startsWith('FINAL_PAY_LATE'));
	assert.match(late({ final_pay_not_possible: false }) ?? '', /by 2026-01-23/);
	assert.match(late({ final_pay_not_possible: true }) ?? '', /by 2026-01-27/);
	// Saturday is an OFF day, not a REST day. The Monday holiday does not count.
	assert.match(late({ final_pay_not_possible: true }, ['2026-01-26']) ?? '', /by 2026-01-28/);
});

test('SG IR21: every non-citizen is held, except a permanent resident not leaving Singapore', () => {
	for (const version of settingsVersions('SG')) {
		const held = (citizenship: string | null, facts: Record<string, boolean> = {}) =>
			evaluateBoolean(expressionEngine, version.payroll.tax_clearance.when, {
				employee: { citizenship: citizenship ?? '' },
				employment: { exit_fact_keys: Object.keys(facts), exit_facts: facts }
			});
		assert.equal(held('FOREIGNER'), true);
		assert.equal(held('PERMANENT_RESIDENT'), false);
		assert.equal(held('PERMANENT_RESIDENT', { leaving_singapore: true }), true);
		assert.equal(held('CITIZEN', { leaving_singapore: true }), false);
		// Unrecorded standing is held, as before: clearance is not waived on a missing fact.
		assert.equal(held(null), true);
		assert.deepEqual(
			version.exit_facts.map((fact) => fact.key),
			[
				'notice_served',
				'leaving_singapore',
				'misconduct_dismissal',
				'final_pay_not_possible',
				'clearance_awareness_on'
			]
		);
	}
});

// ─── MY s.60E(3A) / SG s.88A(8): no annual-leave pay-out on a misconduct dismissal ─────────────

/** The off-boarding automation over one in-memory leaver, with the lineage's own annual-leave row. */
async function exitPayout(code: string, exitReason: string, facts: Record<string, boolean>) {
	const context = leaveContext();
	const annual = leaveCatalogue(code).find(
		(row) => row.code === 'ANNUAL_LEAVE' && row.encash_on_exit
	);
	context.catalogues[0].entitlement = {
		...context.catalogues[0].entitlement,
		encash_on_exit_when: annual.entitlement.encash_on_exit_when
	};
	context.versions[0].exit_facts = versionOn(code, '2026-06-30').exit_facts;
	context.employments[0].effective_range = { start: '2025-01-01', end: '2026-06-30' };
	// MY's notice declarations (EA 1955 ss.12–14) are required on every departure; this probe is about leave, so
	// no party gave notice and none of them apply.
	context.employments[0].exit_facts = code.startsWith('MY')
		? { notice_termination_party: 'NEITHER', ...facts }
		: { final_pay_not_possible: false, clearance_awareness_on: '2026-06-30', ...facts };
	const employment = {
		...context.employments[0],
		employee_number: 'E-1',
		exit_reason: exitReason,
		approval_id: null
	};
	const rows = {
		employments: [employment],
		employees: context.employees,
		companies: context.companies,
		employment_terms: context.terms,
		jurisdiction_settings: context.versions,
		leave_catalogue: context.catalogues,
		shift_patterns: context.patterns,
		shift_definitions: context.shifts
	};
	const written: unknown[] = [];
	const now = '2026-06-30T12:00:00.000Z';
	await settleExit(
		{
			now,
			today: now.slice(0, 10),
			todayIn: () => now.slice(0, 10),
			progress: async () => {},
			get: async () => employment,
			read: async (collection: string) => ({ rows: rows[collection] ?? [], next: null }),
			act: async (callable: string, input: unknown[]) => {
				if (callable === 'leave_entries.create') written.push(...input);
				return { kind: 'committed', output: undefined, records: [] };
			}
		} as never,
		id(1)
	);
	return written.length;
}

test('MY s.60E(3A) proviso and SG s.88A(8): a misconduct dismissal gets no annual-leave pay-out; every other departure does', async () => {
	for (const code of ['MY', 'MY-nihon', 'SG']) {
		assert.equal(await exitPayout(code, 'DISMISSAL', { misconduct_dismissal: true }), 0, code);
		// Unrecorded on a dismissal is refused, not read as "no misconduct" (round 5, D15).
		await assert.rejects(
			() => exitPayout(code, 'DISMISSAL', {}),
			/Dismissed for misconduct is required/
		);
		assert.equal(await exitPayout(code, 'DISMISSAL', { misconduct_dismissal: false }), 1, code);
		// The fact reads only on a dismissal: a resignation is paid out whatever is recorded.
		// (A resignation states its notice question, round 5 D15.)
		const notice = code === 'SG' ? { notice_served: true } : { terminated_without_notice: false };
		assert.equal(
			await exitPayout(code, 'RESIGNATION', { ...notice, misconduct_dismissal: true }),
			1,
			code
		);
	}
});

// ─── SG EA ss.10–11: salary in lieu of notice ───────────────────────────────────────────────────

test('SG salary in lieu of notice is outside CPF and the SHG funds, inside SDL', () => {
	// Salary 4,000 + 2,000 in lieu of notice. CPF (citizen, 40): on the 4,000 only — employee 20% =
	// 800, employer 17% = 680. CDAC (Chinese): 4,000 of Total Wages is the >3,500–5,000 band, $1.50.
	// SDL: 0.25% of wages up to 4,500; the 6,000 month is capped → 11.25.
	const book = assessStatutory(
		{
			code: 'SG',
			period: '2026-01',
			people: [{ key: 'SG-PILON', wage: 4000, age: 40, citizenship: 'CITIZEN', race: 'CHINESE' }]
		},
		(world) => {
			const version = versionOn('SG', '2026-01-15');
			const row = world.adhoc_catalogue.find(
				(entry) => entry.settings_id === version.id && entry.code === 'SALARY_IN_LIEU_OF_NOTICE'
			);
			assert.equal(row.raised_by, 'MANUAL');
			world.adhoc_requests.push({
				id: 'd4000000-0000-4000-8000-000000000002',
				employment_id: world.employments[0].id,
				catalogue_id: row.id,
				amount: 2000,
				event_date: '2026-01-15',
				pay_period: '2026-01',
				payslip_id: null,
				reason: 'salary in lieu of notice',
				evidence_file: null,
				as_adjustment_entry: false,
				approval_id: null
			});
		}
	);
	expectStatutory(book, 'SG-PILON', 'CPF', 800, 680);
	expectStatutory(book, 'SG-PILON', 'CDAC', 1.5, 0);
	const sdl = book.get('SG-PILON')?.get('SDL') ?? book.get(COMPANY)?.get('SDL');
	assert.ok(sdl, 'no SDL charge');
	assert.equal(sdl.base, 6000);
	assert.equal(sdl.employer, 11.25);
	expectStatutoryBase(book, 'SG-PILON', 'CPF', 4000);
});

test('SG s.31(3)/(5): each loan instalment stays within a quarter, including final salary — every version', () => {
	for (const version of settingsVersions('SG')) {
		for (const finalPay of [false, true]) {
			const run = (gross: number, amount: number) =>
				settle({
					base: [earning(gross)],
					adjustments: [loan('STAFF', amount)],
					charges: [{ employee: 0, employer: 0 }],
					currency: 'SGD',
					ceiling: version.payroll.deduction_ceiling,
					finalPay
				});
			assert.equal(run(4000, 1000).net, 3000);
			const over = run(4000, 1000.01);
			assert.equal(over.net, 4000);
			assert.deepEqual(over.shortfalls, [
				{ componentCatalogueId: 'STAFF', amount: 1000.01, cause: 'DEDUCTION_CEILING' }
			]);
			// A partial salary period uses salary actually payable; reimbursements cannot enlarge it.
			assert.equal(run(1500, 500).adjustments.length, 0);
			assert.equal(run(3999.99, 1000).adjustments.length, 0);
			assert.equal(run(3999.99, 999.99).adjustments.length, 1);
		}
	}
});
