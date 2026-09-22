// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * Round 4, letter O — Malaysia's Part F rounding, the EA 1955 s.24(8) half, and Singapore's
 * self-help-group funds on salary in lieu of notice. Every figure is derived by hand from the
 * instrument quoted beside it; the rules are read from the sealed seed, in every version.
 *
 *   EPF Act 1991 Third Schedule Part F (Act A1760 s.10(b); KWSP consolidated Third Schedule from
 *     1 October 2025, p.54): 2% by the employer and 2% by the employee; para 2 “The total
 *     contribution which includes cents shall be rounded to the next ringgit.” Part F prints no RM
 *     table. KWSP Employer Mandatory Contribution, example 2.4: RM6,710 → 268.40 → RM269.00.
 *   Employment Act 1955 (Act 265, reprint as at 1 August 2023) s.24(1), (2)(d), (8), (9).
 *   CPF Board FAQs: CPF “not payable on compensation in lieu of notice”; SHG contributions are
 *     “based on the total wages payable to an employee in a calendar month”; CDAC/ECF/SINDA are
 *     payable “if CPF contributions are payable”. Muis MBMF employer information, Table 2:
 *     salary in lieu of notice is a termination benefit not accounted for MBMF.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { settle } from '../src/collections/payroll_runs/lib/settle.ts';
import {
	COMPANY,
	assertEveryVersionPriced,
	assessStatutory,
	chargeOf,
	expectStatutory,
	settingsVersions
} from './fixtures/statutory-world.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
const FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };
/** One period inside each sealed MY version: from 2025-12-01, 2026-06-01, 2026-07-08, 2028-06-01 and 2031-06-01. */
const MY_PERIODS = ['2026-01', '2026-06', '2026-09', '2028-07', '2031-07'];

// ─── 1. EPF Third Schedule Part F ────────────────────────────────────────────────────────────────

test('MY Part F: the total is rounded to the next ringgit, the employee share up, the employer the rest — every version, both lineages', () => {
	for (const code of ['MY', 'MY-nihon']) {
		for (const period of MY_PERIODS) {
			const book = assessStatutory({
				code,
				period,
				people: [
					{ key: 'F-1751', wage: 1751, citizenship: 'FOREIGNER', registrations: FOREIGN },
					{ key: 'F-3250', wage: 3250, citizenship: 'FOREIGNER', registrations: FOREIGN },
					{ key: 'F-5001', wage: 5001, citizenship: 'FOREIGNER', registrations: FOREIGN },
					{ key: 'F-6710', wage: 6710, citizenship: 'FOREIGNER', registrations: FOREIGN }
				]
			});
			const at = `${code} ${period}`;
			// 1,751: 2% = 35.02 each; total 70.04 → 71 (para 2), not the FAQ's 36 + 36 = 72.
			// Employee 35.02 → 36; employer 71 − 36 = 35.
			expectStatutory(book, 'F-1751', 'EPF_NON_CITIZEN', 36, 35);
			// 3,250: 65.00 each, total 130.00 — no cents (KWSP example 2.4).
			expectStatutory(book, 'F-3250', 'EPF_NON_CITIZEN', 65, 65);
			// 5,001: 100.02 each, 200.04 → 201; employee 101, employer 100.
			expectStatutory(book, 'F-5001', 'EPF_NON_CITIZEN', 101, 100);
			// 6,710: 134.20 each, 268.40 → 269.00 (KWSP example 2.4); employee 135, employer 134.
			const f67 = chargeOf(book, 'F-6710', 'EPF_NON_CITIZEN');
			assert.equal(f67.employee + f67.employer, 269, at);
			assert.equal(f67.employee, 135, at);
		}
		assertEveryVersionPriced(code);
	}
});

// ─── 2. EA 1955 s.24(8): statutory deductions inside the half ───────────────────────────────────

const loan = (code: string, amount: number) => ({
	input: { family: 'LOAN_REPAYMENT', id: `repayment-${code}` },
	catalogueComponent: { id: code, code, family: 'LOAN' },
	bucket: 'DEDUCTION',
	label: code,
	amount
});

test('MY EA s.24(8): EPF, SOCSO, EIS and PCB are s.24(2)(d) deductions under the section and count toward the half — every version, both lineages', () => {
	for (const code of ['MY', 'MY-nihon']) {
		for (const version of settingsVersions(code)) {
			const ceiling = version.payroll.deduction_ceiling;
			assert.equal(ceiling.share, 0.5, code);
			assert.equal(ceiling.counts_statutory, true, code);
			assert.equal(ceiling.counts_loans, true, code);
			const month = (loans: readonly unknown[], finalPay = false) =>
				settle({
					base: [
						{
							catalogueComponent: { id: 'basic', code: 'BASIC', family: 'WORK' },
							bucket: 'EARNING',
							label: 'BASIC',
							amount: 2000
						}
					],
					adjustments: loans,
					charges: [{ employee: 600, employer: 0 }],
					currency: 'MYR',
					ceiling,
					finalPay
				});
			// Wages 2,000 → half 1,000. Statutory 600 (EPF 220 + SOCSO/EIS + PCB) is deducted under
			// s.24(2)(d), leaving 400. A 500 loan instalment (s.24(2)(c)/(4)(b)) exceeds it and is
			// dropped whole; had statutory not counted, 500 ≤ 1,000 would have stood.
			const over = month([loan('STAFF', 500)]);
			assert.deepEqual(over.shortfalls, [
				{ componentCatalogueId: 'STAFF', amount: 500, cause: 'DEDUCTION_CEILING' }
			]);
			assert.equal(over.net, 1400); // 2,000 − 600
			// 400 exactly fits: 600 + 400 = 1,000.
			const fits = month([loan('STAFF', 400)]);
			assert.deepEqual(fits.shortfalls, []);
			assert.equal(fits.net, 1000);
			// s.24(9)(b): an amount due to the employer taken from the final payment is outside s.24(8).
			assert.equal(month([loan('STAFF', 500)], true).net, 900);
		}
	}
});

// ─── 3. SG self-help groups on salary in lieu of notice ─────────────────────────────────────────

/** One period inside each sealed SG version. */
const SG_PERIODS = ['2025-12', '2026-02', '2026-05', '2026-08', '2027-02'];

test('SG salary in lieu of notice is outside CDAC, ECF, MBMF and SINDA in every version', () => {
	for (const period of SG_PERIODS) {
		// Salary 3,000 + 2,000 in lieu of notice. Total Wages for the SHG bands = 3,000 (the notice
		// pay is not CPF wages). On 3,000: CDAC >2,000–3,500 → $1; ECF >2,500–4,000 → $9; MBMF
		// >2,000–3,000 → $6.50; SINDA >2,500–4,500 → $7. Counted in (5,000) they would be $1.50,
		// $12, $19.50 and $9.
		const book = assessStatutory(
			{
				code: 'SG',
				period,
				people: [
					{ key: 'CDAC', wage: 3000, age: 40, citizenship: 'CITIZEN', race: 'CHINESE' },
					{ key: 'ECF', wage: 3000, age: 40, citizenship: 'CITIZEN', race: 'EURASIAN' },
					{
						key: 'MBMF',
						wage: 3000,
						age: 40,
						citizenship: 'CITIZEN',
						race: 'MALAY',
						religion: 'ISLAM'
					},
					{ key: 'SINDA', wage: 3000, age: 40, citizenship: 'CITIZEN', race: 'INDIAN' }
				]
			},
			(world) => {
				const version = settingsVersions('SG').find(
					(row) =>
						String(row.effective_range.start).slice(0, 7) <= period &&
						period < String(row.effective_range.end).slice(0, 7)
				);
				const row = world.adhoc_catalogue.find(
					(entry) => entry.settings_id === version.id && entry.code === 'SALARY_IN_LIEU_OF_NOTICE'
				);
				assert.deepEqual(row.counts_toward, ['SDL'], period);
				world.employments.forEach((employment, index) =>
					world.adhoc_requests.push({
						id: `d4000000-0000-4000-8000-00000000010${index}`,
						employment_id: employment.id,
						catalogue_id: row.id,
						amount: 2000,
						event_date: `${period}-15`,
						pay_period: period,
						payslip_id: null,
						reason: 'salary in lieu of notice',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					})
				);
			}
		);
		expectStatutory(book, 'CDAC', 'CDAC', 1, 0);
		expectStatutory(book, 'ECF', 'ECF', 9, 0);
		expectStatutory(book, 'MBMF', 'MBMF', 6.5, 0);
		expectStatutory(book, 'SINDA', 'SINDA', 7, 0);
		// The notice pay is on the payslip: SDL (SDL Act s.2 wages) reads 3,000 + 2,000 per person.
		const sdl = book.get('CDAC')?.get('SDL') ?? book.get(COMPANY)?.get('SDL');
		assert.ok(sdl && sdl.base >= 5000, `${period}: notice pay absent from SDL`);
	}
	assertEveryVersionPriced('SG');
});
