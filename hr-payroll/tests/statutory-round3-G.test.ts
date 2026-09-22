/**
 * Round 3, letter G — MY/MY-nihon taxable termination compensation through PCB, and the ID PTKP
 * status fixed on 1 January of the tax year.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 *   LHDN, Specification for MTD Calculations Using Computerized Calculation for 2026, section D
 *     (normal and additional remuneration; "compensation for loss of employment" is additional
 *     remuneration): https://www.hasil.gov.my/wp-content/uploads/spesifikasi-kaedah-pengiraan-berkomputer-pcb-2026.pdf
 *   LHDN, Explanatory Notes Form BE 2026, "Compensation For Loss Of Employment": partial exemption
 *     of RM10,000 for each completed year of service with the same employer (ITA 1967 Sch.6
 *     para 15): https://ef.hasil.gov.my/eBE2026/Pdf/Nota_BE_e.pdf
 *   PMK 168/2023 art.9(4): PTKP "ditentukan berdasarkan keadaan pada awal tahun kalender".
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	expectStatutory,
	settingsVersions,
	type Lineage
} from './fixtures/statutory-world.ts';
import { personFactsOn } from '../src/lib/payroll/facts.ts';
import { monthsAt, priorWages } from './fixtures/prior-wages.ts';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// MY / MY-nihon — the taxable part of termination compensation is PCB additional remuneration.
// ─────────────────────────────────────────────────────────────────────────────────────────────

for (const code of ['MY', 'MY-nihon'] as const satisfies readonly Lineage[]) {
	test(`${code} round 3 — termination compensation above RM10,000 a completed year reaches PCB as additional remuneration`, () => {
		// A supervisor of manual labour (EA First Schedule para 2: inside the Regulations at any
		// wage) at RM20,000 a month, hired 1 January 2021, retrenched 31 January 2026.
		//
		// Termination benefit (reg.6(1)(c), (2); JTKSM 12 months' wages ÷ 365): 1,856 days ÷
		// 30.4375 = 60.98 → 61 months = 61/12 years; five years or more → 20 days a year. Twelve
		// months at 20,000 = 240,000 ÷ 365 = 657.5342466 a day. 20 × 61/12 × 657.5342466 =
		// 66,849.3151 → 66,849.32.
		//
		// Sch.6 para 15(1)(a): RM10,000 × 5 completed years = 50,000 exempt; 16,849.32 taxable,
		// and LHDN lists compensation for loss of employment as additional remuneration.
		//
		// PCB, January 2026 (n = 11), single resident, no reliefs beyond the individual's 9,000:
		//   EPF on the normal 20,000 = 2,200; K2 = min((4,000 − 2,200) ÷ 11, 2,200) = 163.6364, so
		//   K + K1 + K2·n = 4,000 (the qualifying cap). SOCSO + EIS at the RM6,000 ceiling:
		//   29.75 + 11.90 = 41.65 (LP1). The compensation is not EPF or SOCSO wages: Kt = 0.
		//   Normal P = 20,000 × 12 − 4,000 − 9,000 − 41.65 = 226,958.35.
		//   Table 1 (100,001–400,000: M 100,000, R 25%, B 9,400):
		//     (126,958.35 × 25%) + 9,400 = 41,139.5875; ÷ 12 = 3,428.2990 → 3,428.29 → 3,428.30.
		//   Step 1[E] year MTD = 3,428.30 × 12 = 41,139.60.
		//   Additional P = 226,958.35 + 16,849.32 = 243,807.67 → (143,807.67 × 25%) + 9,400 =
		//     45,351.9175. Step 4: 45,351.9175 − 41,139.60 = 4,212.3175 → 4,212.31 → 4,212.35.
		//   Step 5: 3,428.30 + 4,212.35 = 7,640.65.
		const versionId = settingsVersions(code).find((version) =>
			String(version.effective_range.start).startsWith('2025-12')
		)!.id;
		const { slips } = buildStatutory(
			{
				code,
				period: '2026-01',
				people: [
					{
						key: 'LEAVER',
						wage: 20_000,
						citizenship: 'CITIZEN',
						statutory_work_category: 'MANUAL_LABOUR_SUPERVISOR',
						registrations: { EPF_NON_CITIZEN: { kind: 'NOT_REGISTERED' } },
						hire_date: '2021-01-01',
						exit_date: '2026-01-31',
						exit_reason: 'RETRENCHMENT'
					}
				]
			},
			(world) => {
				priorWages(world, 'LEAVER', monthsAt('2025-01', '2025-12', 20_000));
				const row = world.adhoc_catalogue!.find(
					(candidate) =>
						candidate.code === 'TERMINATION_BENEFIT' && candidate.settings_id === versionId
				)!;
				world.adhoc_requests!.push({
					id: 'd0000000-0000-4000-8000-00000000a901',
					employment_id: world.employments[0]!.id,
					catalogue_id: row.id,
					amount: 0,
					event_date: '2026-01-31',
					pay_period: '2026-01',
					payslip_id: null,
					reason: 'TERMINATION_BENEFIT',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		);
		const slip = slips.get('LEAVER')!;
		assert.equal(
			slip.adjustments.find((line) => line.component_code === 'TERMINATION_BENEFIT')?.amount,
			66_849.32
		);
		const pcb = slip.statutory.find((line) => line.scheme_code === 'PCB')!;
		// The PCB base is the month's 20,000 plus the taxable 16,849.32.
		assert.equal(pcb.base_amount, 36_849.32);
		assert.equal(pcb.employee_amount, 7_640.65);
	});
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// ID — PMK 168/2023 art.9(4): the PTKP is the status at the start of the calendar year.
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('ID round 3 — a YEAR_START declaration holds its 1 January value until the next 1 January', () => {
	const fields = [
		{ key: 'ptkp_dependants', type: 'number' as const, change_effect: 'YEAR_START' as const },
		{ key: 'ptkp_marital_status', type: 'string' as const, change_effect: 'YEAR_START' as const }
	];
	const declaration = (start: string, end: string | null, dependants: number, status: string) => ({
		employment_id: 'e1',
		statutory_contribution_id: 's1',
		status: {
			kind: 'REGISTERED' as const,
			reference_number: 'R',
			rate_override: null,
			elections: { ptkp_dependants: dependants, ptkp_marital_status: status }
		},
		effective_range: { start, end }
	});
	const rows = [
		declaration('2025-03-01T00:00:00.000Z', '2026-05-31T00:00:00.000Z', 0, 'SINGLE'),
		declaration('2026-06-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z', 2, 'MARRIED'),
		declaration('2027-01-01T00:00:00.000Z', null, 3, 'MARRIED')
	];
	const on = (asOf: string) =>
		personFactsOn(rows as never, [{ id: 's1', code: 'PPH21', elections: fields }], asOf, 'e1')[0]!
			.elections;
	// The first declaration is the person's status from its own day (art.9(5): an arrival's status
	// is the start of the arrival month; a hire states the 1 January status on joining).
	assert.deepEqual(on('2025-06-30'), { ptkp_dependants: 0, ptkp_marital_status: 'SINGLE' });
	// Married with two dependants from 1 June 2026: the 1 January 2026 status governs 2026.
	assert.deepEqual(on('2026-06-15'), { ptkp_dependants: 0, ptkp_marital_status: 'SINGLE' });
	assert.deepEqual(on('2026-12-31'), { ptkp_dependants: 0, ptkp_marital_status: 'SINGLE' });
	// A declaration dated 1 January is that day's status: three dependants for 2027.
	assert.deepEqual(on('2027-01-01'), { ptkp_dependants: 3, ptkp_marital_status: 'MARRIED' });
});

test('ID round 3 — the December reckoning reads the PTKP declared for 1 January, not the current record', () => {
	// Hired 1 December 2026 at 100,000,000 a month; the employee record now says married with two
	// dependants (K/2), but the PPH21 declarations say TK/0 from hire and K/2 only from 15 December.
	//
	// December is the last tax period (PMK 168/2023 art.15): the annual UU PPh art.17 reckoning.
	// Gross (art.5(1), employer-borne premiums added): 100,000,000 + JKK 0.54% 540,000 + JKM 0.30%
	// 300,000 + Kesehatan 4% of the 12,000,000 cap 480,000 = 101,320,000.
	// Biaya jabatan: 5% = 5,066,000, capped at 500,000 × 1 month employed = 500,000.
	// Art.10(1)(b): JP 1% of the 11,086,300 ceiling = 110,863; JHT 2% = 2,000,000.
	// Net = 101,320,000 − 500,000 − 110,863 − 2,000,000 = 98,709,137.
	// TK/0 (UU PPh art.7(1)): PTKP 54,000,000 → PKP 44,709,137 → 44,709,000 (art.17(4)) × 5% =
	// 2,235,450. Read as K/2 (54,000,000 + 4,500,000 + 2 × 4,500,000 = 67,500,000) it would be
	// 31,209,000 × 5% = 1,560,450.
	const people = [
		{
			key: 'DECLARED',
			wage: 100_000_000,
			marital_status: 'MARRIED',
			children: 2,
			hire_date: '2026-12-01'
		},
		{
			key: 'UNDECLARED',
			wage: 100_000_000,
			marital_status: 'MARRIED',
			children: 2,
			hire_date: '2026-12-01'
		}
	];
	const book = assessStatutory(
		{ code: 'ID', period: '2026-12', region: 'DKI Jakarta', riskClass: 'II', people },
		(world) => {
			const employee = world.employees.find((row) =>
				world.employments.some(
					(employment) =>
						employment.employee_number === 'DECLARED' && employment.employee_id === row.id
				)
			)!;
			const pph21 = new Set(
				world.statutory_contributions.filter((row) => row.code === 'PPH21').map((row) => row.id)
			);
			for (const fact of world.employment_statutory_facts.filter(
				(row) => row.employee_id === employee.id && pph21.has(row.statutory_contribution_id)
			)) {
				const status = fact.status as { elections: Record<string, unknown> };
				world.employment_statutory_facts.push({
					...fact,
					id: `${fact.id}-k2`,
					status: {
						...status,
						elections: { ...status.elections, ptkp_marital_status: 'MARRIED', ptkp_dependants: 2 }
					},
					effective_range: { start: '2026-12-15', end: null }
				});
				Object.assign(fact, {
					status: {
						...status,
						elections: { ...status.elections, ptkp_marital_status: 'SINGLE', ptkp_dependants: 0 }
					},
					effective_range: { start: '2026-12-01', end: '2026-12-14' }
				});
			}
		}
	);
	expectStatutory(book, 'DECLARED', 'PPH21', 2_235_450, 0);
	// Unrecorded, the current record is read: K/2.
	expectStatutory(book, 'UNDECLARED', 'PPH21', 1_560_450, 0);
});
