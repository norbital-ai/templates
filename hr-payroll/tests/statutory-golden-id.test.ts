/**
 * Indonesia: expected payslips against the sealed stack, which does not build.
 *
 * PP 46/2015 Ps.16 (JHT); PP 45/2015 Ps.28–29 (JP); PP 44/2015 Ps.16 and 18 as recomposed by
 * PP 49/2023 Ps.16A and 18A (JKK, JKM) and unwound by PP 6/2025 art.11 (JKM, JKP); PP 37/2021 Ps.43
 * (JKP); Perpres 82/2018 Ps.30 as substituted by Perpres 64/2020 (Kesehatan); PMK 168/2023
 * (PPh 21 TER).
 *
 * Every figure below is derived by hand from those instruments and is what the engine computes.
 *
 * No Indonesian run used to build at all. The sealed `PPH21` row named JHT and JP in its relief edges
 * meaning "relieved BY them", while the engine reads a relief edge as "a relief inside [the named]
 * scheme's computation" — the reading every other lineage follows (EPF→PCB, SI/HI/UI→PIT,
 * SSS/PHIC/HDMF→WTAX) — so validation refused with `RELIEF_ORDER`: PPH21 (sequence 600) ran after
 * the schemes it claimed to relieve (100, 200). The linkage is gone from all three sealed versions:
 * PMK 168/2023 Ps.15 applies the monthly effective rate to `jumlah penghasilan bruto` undeducted,
 * so there is no relief to state. Not one figure moved, because a relief edge is inert on a
 * `PERCENT` award and every TER band is one — the withholding was always on gross, and only
 * validation disagreed. The goldens that assess short of validation stay as they are, because a
 * version's schemes are the same either way.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Effect } from 'effect';
import {
	assessStatutory,
	assessStatutoryUnvalidated,
	buildStatutory,
	chargeOf,
	createStatutoryWorld,
	expectStatutory,
	expectStatutorySkipped,
	assertEveryVersionPriced,
	COMPANY_ID,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';
import { ordinaryDivisorDays } from '../src/collections/payroll_runs/lib/ordinary-rate.ts';
import { personContext } from '../src/collections/payroll_runs/lib/eligibility.ts';
import { restBreakAssessment } from '../src/lib/scheduling/rest-break.ts';
import { settingsVersions, leaveCatalogue } from './fixtures/statutory-world.ts';
import { assignAllowance } from './fixtures/contract-allowances.ts';

const ID_PEOPLE = [
	// Exactly the Kabupaten Bekasi UMK 2026: what five of the bank's sixteen contracts are paid.
	{ key: 'ID-UMK', wage: 5_938_885, age: 30, marital_status: 'SINGLE', children: 0 },
	{ key: 'ID-5M', wage: 5_000_000, age: 25, marital_status: 'SINGLE', children: 0 },
	{ key: 'ID-15M', wage: 15_000_000, marital_status: 'SINGLE', children: 0 },
	{ key: 'ID-25M', wage: 25_000_000, age: 55, marital_status: 'SINGLE', children: 0 },
	// K/3 — married with three dependent children — is TER category C.
	{ key: 'ID-C-15M', wage: 15_000_000, marital_status: 'MARRIED', children: 3 },
	// A married woman is TK/0 (TER A) unless she holds the certificate combining her husband's
	// income, which this employment carries as `scheme.elections.ptkp`.
	{ key: 'ID-W-15M', wage: 15_000_000, gender: 'FEMALE', marital_status: 'MARRIED', children: 3 },
	{ key: 'ID-C-25M', wage: 25_000_000, marital_status: 'MARRIED', children: 3 }
];

function idWorld(period: string) {
	return {
		code: 'ID' as const,
		period,
		// DKI Jakarta: UMP 5,729,876 in 2026, which is the BPJS Kesehatan salary floor.
		region: 'DKI Jakarta',
		// PP 44/2015 Ps.16 group II, "risiko rendah", recomposed by PP 49/2023 to 0.40%.
		riskClass: 'II',
		people: ID_PEOPLE
	};
}

test('Indonesia — a validated run builds, and prices the same as the unvalidated one', () => {
	// This used to assert the opposite. PPH21's relief edges named this version's JHT and JP, and the
	// engine reads a relief edge as "a relief inside the named scheme's computation" — so PPH21 at
	// sequence 600 claimed to be a relief inside schemes that run at 100 and 200, and
	// `validateConfiguration` refused every Indonesian run before anything was measured.
	//
	// The linkage was wrong on its own terms too: PMK 168/2023 Ps.15 applies the monthly effective
	// rate to `jumlah penghasilan bruto`, undeducted. Clearing it is why the run builds — and no
	// figure moved, because a relief edge is inert on a `PERCENT` award, which is what every TER
	// band is. The withholding was always on gross; only validation disagreed.
	const validated = assessStatutory(idWorld('2026-01'));
	assert.deepEqual(validated, assessStatutoryUnvalidated(idWorld('2026-01')));
});

test('Indonesia — the workplace region is stated, so a run builds at all', () => {
	// The second Indonesian blocker, and it outlived the first. `KESEHATAN` carries
	// `FLOOR:MINIMUM_WAGE`, which refuses by name when the company's region has no wage in the
	// version — and the bank's Indonesian company stated no region at all, so every Indonesian
	// payroll stopped before it measured anyone.
	//
	// Perpres 64/2020 art.32(2) floors the chargeable wage at the workplace UMK, the UMP being only
	// the art.32(3) fallback, and the workplace is Kabupaten Bekasi: five of the sixteen contracts
	// are paid Rp 5,938,885, its UMK 2026 to the rupiah.
	assert.throws(
		() => assessStatutory({ ...idWorld('2026-01'), region: undefined }),
		/KESEHATAN bounds its base by the regional minimum wage/,
		'a company with no region still refuses, by name'
	);
	const book = assessStatutory({ ...idWorld('2026-01'), region: 'Kabupaten Bekasi' });
	// 5% on the UMK itself — 1% participant, 4% employer — for a person paid exactly the floor.
	expectStatutory(book, 'ID-UMK', 'KESEHATAN', 59_389, 237_555);
});

test('Indonesia — BPJS Ketenagakerjaan and Kesehatan on the 1 January 2026 version', () => {
	const book = assessStatutoryUnvalidated(idWorld('2026-01'));

	// JHT: 5.7% of the monthly wage — 2% worker, 3.7% employer — with no ceiling. Rupiah has no
	// circulating subunit, so every BPJS figure rounds to the whole rupiah.
	expectStatutory(book, 'ID-5M', 'JHT', 100_000, 185_000);
	expectStatutory(book, 'ID-15M', 'JHT', 300_000, 555_000);
	expectStatutory(book, 'ID-25M', 'JHT', 500_000, 925_000);

	// JP: 3% — 1% worker, 2% employer — on a wage capped at Rp 10,547,400 from 1 March 2025.
	expectStatutory(book, 'ID-5M', 'JP', 50_000, 100_000);
	expectStatutory(book, 'ID-15M', 'JP', 105_474, 210_948); // 1% and 2% of the ceiling
	expectStatutory(book, 'ID-25M', 'JP', 105_474, 210_948);

	// JKK at the PP 44/2015 Ps.16(1) group rate — group II is 0.54% — which is what BPJS
	// Ketenagakerjaan bills the employer; PP 37/2021 Ps.11 (PP 6/2025) funds JKP by recomposing
	// 0.14% out of it, never as a second line.
	expectStatutory(book, 'ID-5M', 'JKK', 0, 27_000);
	expectStatutory(book, 'ID-15M', 'JKK', 0, 81_000);
	// JKM 0.30%: PP 6/2025 art.11 ended the PP 49/2023 recomposition, so the full 0.30% is charged.
	expectStatutory(book, 'ID-5M', 'JKM', 0, 15_000);
	expectStatutory(book, 'ID-15M', 'JKM', 0, 45_000);
	// JKP: 0.36% of the wage capped at Rp5,000,000 — 0.22% the central government's, 0.14%
	// recomposed out of the JKK contribution above — so nothing further reaches the payslip.
	expectStatutory(book, 'ID-5M', 'JKP', 0, 0);
	expectStatutory(book, 'ID-15M', 'JKP', 0, 0);

	// BPJS Kesehatan: 5% — 1% participant, 4% employer — on a salary FLOORED at the workplace's
	// UMK/UMP and capped at Rp 12,000,000.
	// 5,000,000 is below the DKI Jakarta floor, so the base is 5,729,876:
	// 1% = 57,298.76 → 57,299; 4% = 229,195.04 → 229,195.
	expectStatutory(book, 'ID-5M', 'KESEHATAN', 57_299, 229_195);
	// 15,000,000 is above the ceiling: 1% and 4% of 12,000,000.
	expectStatutory(book, 'ID-15M', 'KESEHATAN', 120_000, 480_000);
});

test('Indonesia — BPJS Kesehatan covers the household of five; a further member is elected', () => {
	// Perpres 82/2018 art.5(1): the 1%/4% covers the worker, a spouse and up to three children.
	// art.5(3)–(4): a fourth child, a parent or a parent-in-law MAY be enrolled, and art.36 prices
	// each at 1% of the wage, paid by the worker — an election on a mandate, so the household count
	// never charges it by itself; the enrolment is a rate override on the registration.
	const household = (children: number, spouse: string | null, rate?: number) =>
		assessStatutory({
			...idWorld('2026-01'),
			region: 'Kabupaten Bekasi',
			people: [
				{
					key: 'ID-FAMILY',
					wage: 8_000_000,
					age: 35,
					marital_status: spouse == null ? 'SINGLE' : 'MARRIED',
					...(spouse == null ? {} : { spouse_status: spouse }),
					children,
					...(rate == null
						? {}
						: { registrations: { KESEHATAN: { kind: 'REGISTERED', rate_override: rate } } })
				}
			]
		});
	const employee = (children: number, spouse: string | null, rate?: number) =>
		chargeOf(household(children, spouse, rate), 'ID-FAMILY', 'KESEHATAN').employee;

	// 1% of 8,000,000, whatever the household: a worker alone, a family of five, a family of seven.
	assert.equal(employee(0, null), 80_000);
	assert.equal(employee(3, 'WITHOUT_INCOME'), 80_000);
	assert.equal(employee(5, 'WITH_INCOME'), 80_000);
	// Two further members enrolled: 1% each on top, carried as a 3% override.
	assert.equal(employee(5, 'WITH_INCOME', 3), 240_000);
	// The employer's leg is unmoved throughout.
	assert.equal(
		chargeOf(household(5, 'WITH_INCOME', 3), 'ID-FAMILY', 'KESEHATAN').employer,
		320_000
	);
});

test('Indonesia — an unrecorded PTKP status withholds as TK/0', () => {
	// Category A (TK/0, TK/1, K/0) is the default: a person whose marital status is not recorded
	// reads as TK/0, so the TER A ladder governs rather than no ladder at all.
	const book = assessStatutoryUnvalidated({
		...idWorld('2026-01'),
		people: [{ key: 'ID-BLANK-15M', wage: 15_000_000, marital_status: '' }]
	});
	expectStatutory(book, 'ID-BLANK-15M', 'PPH21', 1_092_420, 0);
});

test('Indonesia — the JP ceiling moves on 1 March 2026', () => {
	const before = assessStatutoryUnvalidated(idWorld('2026-02'));
	const after = assessStatutoryUnvalidated(idWorld('2026-03'));

	// PP 45/2015 Ps.29(3)–(4): BPJS Ketenagakerjaan re-announces the JP wage ceiling each 1 March.
	// 10,547,400 through February 2026; 11,086,300 from 1 March 2026 (SE B/1226/022026, uplift
	// 5.11%). 1% and 2% of each.
	expectStatutory(before, 'ID-15M', 'JP', 105_474, 210_948);
	expectStatutory(after, 'ID-15M', 'JP', 110_863, 221_726);
	// Nothing else moved on that seam.
	expectStatutory(after, 'ID-15M', 'JHT', 300_000, 555_000);
	expectStatutory(after, 'ID-15M', 'KESEHATAN', 120_000, 480_000);
});

test('Indonesia — PPh 21 monthly withholding on the TER A and TER C ladders', () => {
	const book = assessStatutoryUnvalidated(idWorld('2026-01'));

	// PMK 168/2023: for January to November the withholding is the average effective rate for the
	// PTKP category applied to the month's gross, with no annualisation.
	//
	// TER A covers TK/0, TK/1 and K/0. Bracket 1 runs to 5,400,000 at 0.00%.
	expectStatutory(book, 'ID-5M', 'PPH21', 0, 0);
	// PMK 168/2023 art.5(1): the employer-borne JKK (0.54%, class II), JKM (0.30%) and BPJS
	// Kesehatan (4%) premiums are part of the gross — 15,000,000 + 81,000 + 525,000 = 15,606,000,
	// in TER A bracket 15,100,001–16,950,000 at 7.00% → 1,092,420.
	expectStatutory(book, 'ID-15M', 'PPH21', 1_092_420, 0);
	// 25,000,000 is in TER A bracket 24,150,001–26,450,000 at 10.00% → 2,500,000.
	expectStatutory(book, 'ID-25M', 'PPH21', 2569000, 0);

	// TER C covers K/3 (PTKP 72,000,000).
	// 15,000,000 is in bracket 14,150,001–15,550,000 at 5.00% → 750,000.
	expectStatutory(book, 'ID-C-15M', 'PPH21', 936360, 0);
	// 25,000,000 is in bracket 22,700,001–26,600,000 at 9.00% → 2,250,000.
	expectStatutory(book, 'ID-C-25M', 'PPH21', 2312100, 0);
});

test('Indonesia — the rupiah above a TER bracket, or a BPJS ceiling, is charged on the next row', () => {
	// April, not March: the March run carries THR (below), and this test prices the wage alone.
	const book = assessStatutoryUnvalidated({
		...idWorld('2026-04'),
		people: [
			{ key: 'ID-5400000.01', wage: 5_400_000.01, marital_status: 'SINGLE' },
			{ key: 'ID-11086300.01', wage: 11_086_300.01, marital_status: 'SINGLE' },
			{ key: 'ID-12000000.01', wage: 12_000_000.01, marital_status: 'SINGLE' }
		]
	});
	// With the employer premiums in the gross (PMK 168/2023 art.5(1)) the 5,400,000.01 wage is a
	// 5,674,555.01 gross, in TER A "5,650,001 – 5,950,000 → 0.50%": 28,372.78 → 28,373.
	expectStatutory(book, 'ID-5400000.01', 'PPH21', 28_373, 0);
	// JP above the 11,086,300 ceiling charges on the ceiling: 110,863 / 221,726.
	expectStatutory(book, 'ID-11086300.01', 'JP', 110_863, 221_726);
	// Kesehatan above the Rp12,000,000 cap: 120,000 / 480,000.
	expectStatutory(book, 'ID-12000000.01', 'KESEHATAN', 120_000, 480_000);
});

test('Indonesia — the December 2025 version, whose Kesehatan floor is the 2025 UMP', () => {
	// The first sealed version runs 1 December 2025 to 1 January 2026. Every BPJS rate is the same
	// as on the later two; what moves on 1 January is the regional minimum wage the BPJS Kesehatan
	// salary is floored at — DKI Jakarta 5,396,761 in 2025, 5,729,876 in 2026.
	const book = assessStatutoryUnvalidated(idWorld('2025-12'));

	// Perpres 82/2018 Ps.30 as substituted by Perpres 64/2020: 5% — 1% participant, 4% employer —
	// on a salary floored at the workplace's UMK/UMP and capped at Rp 12,000,000. 5,000,000 is
	// below the 2025 DKI floor, so the base is 5,396,761: 1% = 53,967.61 → 53,968 and
	// 4% = 215,870.44 → 215,870. (On the 2026 floor the same wage gives 57,299 / 229,195.)
	expectStatutory(book, 'ID-5M', 'KESEHATAN', 53_968, 215_870);
	// Above the Rp 12,000,000 ceiling the floor never enters, so 15,000,000 is unchanged.
	expectStatutory(book, 'ID-15M', 'KESEHATAN', 120_000, 480_000);

	// JHT 5.7% (2% / 3.7%) with no ceiling, and JP 3% (1% / 2%) on the Rp 10,547,400 ceiling that
	// stands until 1 March 2026 — both identical to the 1 January 2026 version.
	expectStatutory(book, 'ID-5M', 'JHT', 100_000, 185_000);
	expectStatutory(book, 'ID-15M', 'JP', 105_474, 210_948);
	// JKK at the PP 44/2015 Ps.16(1) group II rate of 0.54% (the 0.14% JKP recomposition is
	// inside it, never a second line) and JKM 0.30%, both employer-borne.
	expectStatutory(book, 'ID-5M', 'JKK', 0, 27_000);
	expectStatutory(book, 'ID-5M', 'JKM', 0, 15_000);
	// JKP: PP 37/2021 Ps.11 as amended by PP 6/2025 recomposes the employer's share from JKK,
	// so the JKP line itself is 0/0 on this version too.
	expectStatutory(book, 'ID-5M', 'JKP', 0, 0);
	// PMK 168/2023: the last tax period is the annual reckoning, not a TER month — annual gross
	// less biaya jabatan (5%) and the JP employee share, less PTKP 54,000,000 for TK/0. Both
	// December-only worlds annualise below PTKP, so both withhold nothing this period.
	expectStatutory(book, 'ID-5M', 'PPH21', 0, 0);
	expectStatutory(book, 'ID-15M', 'PPH21', 0, 0);
});

test('Indonesia — December is the annual reckoning against the year the TER already withheld', () => {
	// PMK 168/2023 art.20: the last tax period reconciles. PPh 21 for the year is computed on
	// PKP = annual gross − biaya jabatan (5%, at most 6,000,000 a year; PMK 250/PMK.03/2008) − the
	// year's employee JP AND JHT (PMK 168/2023 art.10(3)(b): iuran terkait program pensiun dan hari
	// tua paid through the employer to BPJS Ketenagakerjaan) − PTKP 54,000,000 TK/0, rounded down
	// to the whole thousand (UU PPh art.17(4)), at 5% to 60,000,000 and 15% above; December charges
	// the year's figure less what the TER already withheld. The prior eleven months are seeded as
	// the engine priced them: TER A at 6% for a 15,000,000 monthly gross (900,000 a month), JP at
	// the announced ceiling — 105,474 through February 2026 and 110,863 from 1 March — and JHT at
	// 2% of the wage.
	const priorPeriods = [
		'2026-01',
		'2026-02',
		'2026-03',
		'2026-04',
		'2026-05',
		'2026-06',
		'2026-07',
		'2026-08',
		'2026-09',
		'2026-10',
		'2026-11'
	];
	const priorJp = (period: string) => (period < '2026-03' ? 105_474 : 110_863);
	// What each seeded month withheld, exactly as the engine priced it in that month: TER A at 6%
	// for 15,000,000 and 0% for 5,000,000, JP at 1% of the announced ceiling.
	const month = (period: string, key: string) =>
		key === 'ID-15M'
			? {
					gross: 15_000_000,
					pph21: 900_000,
					jp: priorJp(period),
					jht: 300_000
				}
			: { gross: 5_000_000, pph21: 0, jp: 50_000, jht: 100_000 };
	const book = assessStatutoryUnvalidated(idWorld('2026-12'), (world) => {
		for (const key of ['ID-15M', 'ID-5M']) {
			const employment = world.employments.find((row) => row.employee_number === key);
			assert.ok(employment, `the ${key} employment exists`);
			for (const period of priorPeriods) {
				const prior = month(period, key);
				const runId = `prior-${period}-${key}`;
				world.payroll_runs.push({ id: runId, company_id: COMPANY_ID, period });
				world.payslips.push({
					id: `payslip-${period}-${key}`,
					payroll_run_id: runId,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `${period}-28T00:00:00.000Z`,
					currency: 'IDR',
					base: [],
					adjustments: [],
					statutory: [
						{
							scheme_code: 'PPH21',
							employee_amount: prior.pph21,
							employer_amount: 0,
							base_amount: prior.gross,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'JP',
							employee_amount: prior.jp,
							employer_amount: prior.jp * 2,
							base_amount: prior.gross,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'JHT',
							employee_amount: prior.jht,
							employer_amount: prior.jht * 1.85,
							base_amount: prior.gross,
							rule_when: null,
							authority: null
						}
					]
				});
			}
		}
	});

	// ID-15M: the eleven slips on file carry 15,000,000 each and December 15,606,000 (the employer
	// premiums in the gross, PMK 168/2023 art.5(1)): PKP = 180,606,000 − 6,000,000 − JP 1,319,578 −
	// JHT 3,600,000 − 54,000,000 = 115,686,422 → 115,686,000 (art.17(4)). Annual tax = 5% ×
	// 60,000,000 + 15% × 55,686,000 = 11,352,900. December = 11,352,900 − 9,900,000 = 1,452,900.
	expectStatutory(book, 'ID-15M', 'PPH21', 1_452_900, 0);
	// ID-5M: PKP = 60,000,000 − 3,000,000 − 600,000 − 1,200,000 − 54,000,000 = 1,200,000 →
	// 60,000; the TER withheld nothing all year, so December charges the whole annual figure.
	expectStatutory(book, 'ID-5M', 'PPH21', 72850, 0);
});

test('Indonesia — a married woman is TK/0 unless the PTKP election combines her husband’s income', () => {
	const book = assessStatutoryUnvalidated({
		...idWorld('2026-01'),
		people: [
			{
				key: 'ID-W-15M',
				wage: 15_000_000,
				gender: 'FEMALE',
				marital_status: 'MARRIED',
				children: 3
			},
			{
				key: 'ID-W-KI-15M',
				wage: 15_000_000,
				gender: 'FEMALE',
				marital_status: 'MARRIED',
				children: 3,
				registrations: {
					PPH21: { kind: 'REGISTERED', elections: { ptkp: 'KI' } }
				}
			}
		]
	});
	// Without the certificate she is TK/0, TER category A: 15,000,000 withholds 900,000. With it the
	// married ladder applies (K/3, category C): 750,000.
	expectStatutory(book, 'ID-W-15M', 'PPH21', 1_092_420, 0);
	expectStatutory(book, 'ID-W-KI-15M', 'PPH21', 936360, 0);
});

test('every sealed version of `ID` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('ID');
});

// ─────────────────────────────────────────────────────────────────────────────
// THR (Permenaker 6/2016) — gap tracker §4.
//
// One month's wage after twelve months of continuous service, pro rata by completed months from
// one month, and "one month's wage" is the basic wage plus the fixed allowances (art. 3(2)). THR
// is income for PPh 21 and outside every BPJS base. The catalogue row prices it; HR keys it as an
// allowance whose window is the month it is paid in, and the band reads the person as they stand
// on the day the window opens.
// ─────────────────────────────────────────────────────────────────────────────

const HOUSE_ALLOWANCE_ID = 'a1a1a1a1-0000-4000-8000-000000000001';
const THR_ID = '6905cf49-a5ed-5833-ad3d-d08074b60c4e';

test('Indonesia — THR is a twelfth of the monthly wage per completed month, whole after a year', () => {
	const world = createStatutoryWorld({
		...idWorld('2026-03'),
		people: [
			{ key: 'ID-24M', wage: 10_000_000 },
			// Five completed months on 1 March 2026, the day the March window opens.
			{ key: 'ID-6M', wage: 12_000_000, hire_date: '2025-09-13' },
			// Under a month of service on the day.
			{ key: 'ID-NEW', wage: 12_000_000, hire_date: '2026-02-20' },
			// A standing house allowance is part of the wage THR is measured on.
			{ key: 'ID-FIXED', wage: 20_000_000 },
			// A one-month reimbursement keyed as an allowance for March alone is not; one that runs
			// past the month is.
			{ key: 'ID-ONEOFF', wage: 20_000_000 },
			{ key: 'ID-TWO-MONTHS', wage: 20_000_000 },
			// Permenaker 6/2016 art.7: a PKWTT leaver of the thirty days before the holiday (Idulfitri,
			// 21 March) is owed the THR (art.7(1)); a PKWT that ends *before* the holiday is not
			// (art.7(3)); one that ends on or after it was employed on the day and is (art.2(1)).
			{ key: 'ID-PERM-25MAR', wage: 10_000_000, exit_date: '2026-03-25' },
			{
				key: 'ID-PKWT-31MAR',
				wage: 10_000_000,
				employment_type: 'CONTRACT',
				exit_date: '2026-03-31'
			},
			{
				key: 'ID-PKWT-21MAR',
				wage: 10_000_000,
				employment_type: 'CONTRACT',
				exit_date: '2026-03-21'
			},
			{
				key: 'ID-PKWT-10MAR',
				wage: 10_000_000,
				employment_type: 'CONTRACT',
				exit_date: '2026-03-10'
			}
		]
	});
	// The version in force in March 2026 (2026-03-01 → open).
	const version = 'f5282c8e-2224-4714-afb7-7314a5bfe37d';
	world.allowance_catalogue.push({
		id: HOUSE_ALLOWANCE_ID,
		settings_id: version,
		code: 'HOUSE_ALLOWANCE',
		name: 'House allowance',
		eligibility: '',
		evidence: 'NONE',
		destination: 'PAY',
		direction: 'ADD',
		bands: [{ when: '', amount: 'entry.amount', limit: null }],
		// A fixed allowance is upah for every BPJS scheme and ordinary income for PPh 21.
		counts_toward: ['JHT', 'JP', 'JKK', 'JKM', 'JKP', 'KESEHATAN', 'PPH21.ORDINARY', 'PPH26'],
		approval_id: null
	});
	const fixed = world.employments.find((row) => row.employee_number === 'ID-FIXED')!;
	assignAllowance(world, {
		id: 'a1a1a1a1-0000-4000-8000-000000000002',
		employment_id: fixed.id,
		catalogue_id: HOUSE_ALLOWANCE_ID,
		amount: 5_000_000,
		effective_from: '2026-01-01',
		effective_to: null,
		reason: '',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
	// A one-month housing payment is not an allowance on the contract: it is ad hoc pay, raised
	// once, and enters no wage a statute defines as basic plus fixed allowances.
	const HOUSE_ONCE_ID = 'a1a1a1a1-0000-4000-8000-0000000000a3';
	world.adhoc_catalogue!.push({
		id: HOUSE_ONCE_ID,
		settings_id: version,
		code: 'HOUSE_ONCE',
		name: 'One-off housing payment',
		eligibility: '',
		evidence: 'NONE',
		destination: 'PAY',
		direction: 'ADD',
		bands: [{ when: '', amount: 'entry.amount', limit: null }],
		counts_toward: ['JHT', 'JP', 'JKK', 'JKM', 'JKP', 'KESEHATAN', 'PPH21.ADDITIONAL', 'PPH26'],
		raised_by: 'MANUAL',
		approval_id: null
	});
	const oneOff = world.employments.find((row) => row.employee_number === 'ID-ONEOFF')!;
	world.adhoc_requests!.push({
		id: 'a1a1a1a1-0000-4000-8000-000000000003',
		employment_id: oneOff.id,
		catalogue_id: HOUSE_ONCE_ID,
		amount: 5_000_000,
		event_date: '2026-03-01',
		pay_period: null,
		payslip_id: null,
		reason: 'one month, one payment',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
	const twoMonths = world.employments.find((row) => row.employee_number === 'ID-TWO-MONTHS')!;
	assignAllowance(world, {
		id: 'a1a1a1a1-0000-4000-8000-000000000004',
		employment_id: twoMonths.id,
		catalogue_id: HOUSE_ALLOWANCE_ID,
		amount: 5_000_000,
		effective_from: '2026-03-01',
		effective_to: '2026-04-30',
		reason: 'two months',
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	});
	// THR keyed for March for everyone; the row's own band prices it, the eligibility declines it.
	for (const [index, employment] of world.employments.entries())
		world.adhoc_requests!.push({
			id: `a1a1a1a1-0000-4000-8000-00000000001${index}`,
			employment_id: employment.id,
			catalogue_id: THR_ID,
			amount: 1,
			event_date: '2026-03-01',
			pay_period: null,
			payslip_id: null,
			reason: 'THR 2026',
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	const prepared = Effect.runSync(
		gatherPayrollRun({ api: memoryPayrollApi(world), companyId: COMPANY_ID, period: '2026-03' })
	);
	const built = buildPayrollRun(prepared);
	const slips = built.payslip_payroll_run;
	const slip = (key: string) => {
		const employment = world.employments.find((row) => row.employee_number === key)!;
		const row = slips.find((candidate) => String(candidate.employment_id) === employment.id)!;
		const thr = row.adjustments
			.filter((line) => line.component_code === 'THR')
			.map((line) => line.amount);
		const base = (code: string) =>
			row.statutory.find((charge) => charge.scheme_code === code)!.base_amount;
		return { thr, base };
	};
	assert.deepEqual(slip('ID-24M').thr, [10_000_000]);
	assert.deepEqual(slip('ID-6M').thr, [5_000_000]);
	assert.deepEqual(slip('ID-NEW').thr, []);
	assert.deepEqual(slip('ID-FIXED').thr, [25_000_000]);
	// Permenaker 6/2016 art.3(2) with SE-07/MEN/1990 §I(2)(b): a tunjangan tetap is paid regularly
	// and irrespective of attendance. A one-month housing payment is ad hoc pay, so the wage a THR
	// is a multiple of is the 20,000,000 basic alone — the 5,000,000 is still paid in March, it
	// just does not become 5,000,000 more of THR.
	assert.deepEqual(slip('ID-ONEOFF').thr, [20_000_000]);
	assert.deepEqual(slip('ID-TWO-MONTHS').thr, [25_000_000]);
	assert.deepEqual(slip('ID-PERM-25MAR').thr, [10_000_000]);
	assert.deepEqual(slip('ID-PKWT-31MAR').thr, [10_000_000]);
	assert.deepEqual(slip('ID-PKWT-21MAR').thr, [10_000_000]);
	assert.deepEqual(slip('ID-PKWT-10MAR').thr, []);
	// PPh 21 is on gross, THR and the employer-borne premiums included (484,000 on 10,000,000).
	// PP 44/45/46 of 2015: the BPJS wage is upah pokok plus tunjangan tetap, so the standing house
	// allowance is in the JHT base and the employer premiums PPh 21 adds rise with it (JKK 0.54% +
	// JKM 0.3% on 5,000,000 = 42,000; Kesehatan is already at its 12,000,000 cap).
	assert.equal(slip('ID-24M').base('PPH21'), 20_484_000);
	assert.equal(slip('ID-24M').base('JHT'), 10_000_000);
	assert.equal(slip('ID-FIXED').base('JHT'), 25_000_000);
	assert.equal(slip('ID-FIXED').base('PPH21'), 50_690_000); // 25,000,000 + THR 25,000,000 + the employer premiums
	// The allowance on the contract is a March base line with its own proration segment; the THR
	// is an ad hoc request: captured once, pinned.
	const fixedSlip = slips.find((row) => String(row.employment_id) === fixed.id)!;
	const capture = built.captures.find((row) => row.payslipId === fixedSlip.id)!;
	assert.deepEqual(
		fixedSlip.proration
			.filter((row) => row.component_code === 'HOUSE_ALLOWANCE')
			.map((row) => [row.prorated_amount, row.from, row.to]),
		[[5_000_000, '2026-03-01', '2026-03-31']],
		'the March segment of the house allowance'
	);
	assert.deepEqual(
		capture.adhoc,
		world.adhoc_requests!.filter((row) => row.employment_id === fixed.id).map((row) => row.id),
		'the THR request is captured'
	);
});

// ─────────────────────────────────────────────────────────────────────────────
// Working time and leave: the law's numbers against the sealed regime, on every version.
// ─────────────────────────────────────────────────────────────────────────────

test('Indonesia — the overtime hour is 1/173 of the monthly wage (PP 35/2021 Pasal 32(1))', () => {
	// The divisor is stated in days per month over the contract's daily hours, so 40 hours over
	// five days and 40 over six both come to one 173rd of the wage per overtime hour.
	for (const version of settingsVersions('ID'))
		for (const [hours, days] of [
			[40, 5],
			[40, 6]
		]) {
			const person = personContext({
				employee: null,
				employment: { service_start: '2020-01-01' },
				terms: { base_salary: { value: 17_300_000, currency: 'IDR' } },
				week: { ordinary_hours_per_week: hours, working_days_per_week: days },
				asOf: '2026-06-30'
			});
			const divisor = ordinaryDivisorDays({
				expression: version.work_rules.ordinary_divisor_days,
				person
			});
			assert.equal(
				Math.round((17_300_000 / divisor / (hours / days)) * 100) / 100,
				100_000,
				`${hours} hours over ${days} days`
			);
		}
});

/** A punch from `start` to `end` on `date`, in Asia/Jakarta (+07:00); `end` may be the next day. */
const punchId = (world: PayrollWorld, key: string, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+07:00`, end: `${date}T${end}:00+07:00` }],
		approval_id: null
	});
};
const workLinesId = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

test('Indonesia — the PP 35/2021 Pasal 31 ladder on an ordinary day, a rest day and a holiday', () => {
	// Rp 17,300,000 a month is Rp 100,000 an hour (Pasal 32(1): 1/173). The fixture week is five
	// days of 09:00–18:00 with an hour's break — Pasal 21(2)(b), 8 hours a day and 40 a week — and
	// both Saturday and Sunday are `REST`, which is what Pasal 31(3) prices for a five-day worker.
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'Kabupaten Bekasi',
			riskClass: 'III',
			people: [{ key: 'ID-OT', wage: 17_300_000, marital_status: 'SINGLE' }]
		},
		(world) => {
			world.jurisdiction_holidays.push({
				id: 'holiday-2026-01-01',
				company_id: COMPANY_ID,
				date: '2026-01-01',
				name: 'Tahun Baru 2026 Masehi',
				replaces: null,
				source: null,
				published_at: '2025-12-01T00:00:00.000Z',
				approval_id: null
			});
			punchId(world, 'ID-OT', '2026-01-01', '09:00', '18:00'); // Thursday holiday, a whole shift
			punchId(world, 'ID-OT', '2026-01-05', '09:00', '20:00'); // Monday, two hours past the shift
			punchId(world, 'ID-OT', '2026-01-10', '09:00', '18:30'); // Saturday rest day, 9.5 hours clocked
			punchId(world, 'ID-OT', '2026-01-17', '09:00', '12:00'); // Saturday rest day, three hours
		}
	);
	// Pasal 31(1): the first overtime hour 1.5×, every further hour 2×.
	// Pasal 31(3): on a rest day or holiday the first 8 hours 2×, the 9th 3×, the 10th–12th 4×.
	// UU 13/2003 Ps.79(2)(a): a 30-minute break is owed after four continuous hours and is not
	// working time, so the 9.5 clocked rest-day hours are 9 payable ones; the holiday's shift has
	// its hour of break inside the clock (09:00–18:00 is eight hours worked).
	assert.deepEqual(workLinesId(slips.get('ID-OT')!), [
		['2026-01-01', 'OT-2.0X', 8, 1_600_000],
		['2026-01-05', 'OT-1.5X', 1, 150_000],
		['2026-01-05', 'OT-2.0X', 1, 200_000],
		['2026-01-10', 'OT-2.0X', 8, 1_600_000],
		['2026-01-10', 'OT-3.0X', 1, 300_000],
		['2026-01-17', 'OT-2.0X', 3, 600_000]
	]);
	// PPh 21 reads the overtime (PMK 168/2023 Ps.15, gross) and the employer-borne JKK (1.27%,
	// class III), JKM (0.30%) and BPJS Kesehatan (4% of 17,300,000) premiums beside it
	// (Ps.5(1)): 219,710 + 51,900 + 692,000 = 685,870 with JKK at 0.24%… the run's own class
	// decides; here 17,300,000 × (0.24% + 0.30%) + 4% × 17,300,000 = 685,870. The BPJS bases are
	// the wage alone (PP 44/2015 Ps.19(2), PP 45/2015 Ps.29(1): upah pokok + tunjangan tetap).
	const charge = (code: string) =>
		slips.get('ID-OT')!.statutory.find((row) => row.scheme_code === code)!;
	assert.equal(charge('PPH21').base_amount, 17_300_000 + 4_450_000 + 685_870);
	assert.equal(charge('JHT').base_amount, 17_300_000);
	assert.equal(charge('KESEHATAN').base_amount, 17_300_000);
});

test('Indonesia — a holiday on a six-day worker’s shortest day prices its own five hours at 2× (Pasal 31(2)(b))', () => {
	// PP 35/2021 Pasal 31(2)(b): where the week is six days, a holiday on the shortest working day
	// pays five hours at 2×, the sixth at 3× and the seventh to ninth at 4×. The guards' week is
	// five seven-hour days and a five-hour Saturday (40 hours); a rostered shift shorter than the normal day is
	// that day’s normal day, so the Saturday’s is its own five hours. Rp 17,300,000
	// is Rp 100,000 an hour. Saturday 3 January 2026 is the holiday, worked 09:00–16:00 (seven).
	const SHORT = 'c0000000-0000-4000-8000-0000000000d8';
	const LONG = 'c0000000-0000-4000-8000-0000000000d7';
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'Kabupaten Bekasi',
			riskClass: 'III',
			people: [{ key: 'ID-SAT', wage: 17_300_000, marital_status: 'SINGLE' }]
		},
		(world) => {
			world.shift_definitions.push(
				{
					...world.shift_definitions[0]!,
					id: LONG,
					code: 'SEVEN',
					name: 'Seven hours',
					variant: { kind: 'WORK', start_time: '09:00', end_time: '17:00', break_minutes: 60 }
				},
				{
					...world.shift_definitions[0]!,
					id: SHORT,
					code: 'FIVE',
					name: 'Five hours',
					variant: { kind: 'WORK', start_time: '09:00', end_time: '14:00', break_minutes: 0 }
				}
			);
			world.shift_patterns[0]!.pattern.days = [
				{ roster_code_id: LONG },
				{ roster_code_id: LONG },
				{ roster_code_id: LONG },
				{ roster_code_id: LONG },
				{ roster_code_id: LONG },
				{ roster_code_id: SHORT },
				{ roster_code_id: world.shift_definitions[1]!.id }
			];
			world.jurisdiction_holidays.push({
				id: 'holiday-2026-01-03',
				company_id: COMPANY_ID,
				date: '2026-01-03',
				name: 'A holiday on the short Saturday',
				replaces: null,
				source: null,
				published_at: '2025-12-01T00:00:00.000Z',
				approval_id: null
			});
			punchId(world, 'ID-SAT', '2026-01-03', '09:00', '16:00');
		}
	);
	// UU 13/2003 Ps.79(2)(a): the thirty-minute break owed after four continuous hours is not
	// working time, so seven clocked hours are six and a half payable: five at 2×, one at 3×,
	// half an hour at 4×.
	assert.deepEqual(workLinesId(slips.get('ID-SAT')!), [
		['2026-01-03', 'OT-2.0X', 5, 1_000_000],
		['2026-01-03', 'OT-3.0X', 1, 300_000],
		['2026-01-03', 'OT-4.0X', 0.5, 200_000]
	]);
});

test('Indonesia — a rest-day stint shorter than a normal day is priced on its payable hours, not the raw clock', () => {
	const { slips } = buildStatutory(
		{
			code: 'ID',
			period: '2026-01',
			region: 'Kabupaten Bekasi',
			riskClass: 'III',
			people: [{ key: 'ID-OT', wage: 17_300_000, marital_status: 'SINGLE' }]
		},
		(world) => punchId(world, 'ID-OT', '2026-01-10', '09:00', '13:20') // Saturday: 4h20 clocked
	);
	// UU 13/2003 Ps.79(2)(a): 4h20 crosses four continuous hours, so the thirty-minute break the day
	// owed and did not take is not working time; 3h50 is the payable time, to the minute, at Pasal
	// 31(3)'s 2× = 766,666.67. The bands consume the payable hours, never the raw clock (4.33 h,
	// 866,667).
	assert.deepEqual(workLinesId(slips.get('ID-OT')!), [
		['2026-01-10', 'OT-2.0X', 23 / 6, 766_666.67]
	]);
});

test('Indonesia — the 30-minute break after four continuous hours governs every worker (UU 13/2003 Ps.79(2)(a))', () => {
	// "Paling sedikit setengah jam setelah bekerja selama 4 jam terus menerus, dan waktu istirahat
	// tersebut tidak termasuk jam kerja" — the trigger is the four continuous hours worked, not a
	// continual-attendance job class, and the break is not working time. The seeded rule had been
	// conjoined with the Malaysian `continuous_attendance` proviso, which no day asserts, so it
	// governed nobody and no shortfall was ever deducted.
	for (const version of settingsVersions('ID')) {
		const assessed = restBreakAssessment({
			intervals: [{ start: '2026-06-15T09:00:00.000+07:00', end: '2026-06-15T14:30:00.000+07:00' }],
			breakMinutes: 0,
			breaks: version.work_rules.breaks
		});
		assert.equal(assessed.rule?.counts_as_worked_time, false);
		assert.equal(assessed.requiredMinutes, 30);
		assert.equal(assessed.shortfallMinutes, 30);
		// Four hours exactly cross nothing.
		const four = restBreakAssessment({
			intervals: [{ start: '2026-06-15T09:00:00.000+07:00', end: '2026-06-15T13:00:00.000+07:00' }],
			breakMinutes: 0,
			breaks: version.work_rules.breaks
		});
		assert.equal(four.rule, null);
	}
});

test('Indonesia — the overtime ceilings are 4 hours a day and 18 a week (PP 35/2021 Pasal 26(1))', () => {
	for (const version of settingsVersions('ID')) {
		const limits = Object.fromEntries(
			version.work_rules.limits
				.filter((limit) => limit.measure !== 'CONSECUTIVE_WORK_DAYS')
				.map((limit) => [`${limit.period}:${limit.measure}`, limit.max_hours])
		);
		assert.deepEqual(limits, { 'DAY:OVERTIME_HOURS': 4, 'WEEK:OVERTIME_HOURS': 18 });
		// The weekly rest rule is the consecutive-work-days limit (UU 13/2003 art.79(2)(b)).
		assert.deepEqual(
			version.work_rules.limits.find((limit) => limit.measure === 'CONSECUTIVE_WORK_DAYS'),
			{
				key: 'weekly_rest',
				measure: 'CONSECUTIVE_WORK_DAYS',
				max_days: 6,
				discharged_by: 'REST_OR_OFF'
			}
		);
		assert.equal(version.work_rules.night_premium ?? null, null);
	}
});

test('Indonesia — the statutory leave ladder on every version', () => {
	// UU 13/2003 Ps.79(3) (12 days after 12 months), Ps.81(1) (menstrual, 2 days a month),
	// Ps.82(1) with UU 4/2024 Ps.4(2)(a) (maternity 3 months = 91 days), Ps.82(2) (miscarriage 1.5
	// months = 45 days), Ps.93(4)(a)–(g) (marriage 3, child's marriage 2, circumcision 2, baptism 2,
	// paternity 2, immediate bereavement 2, household bereavement 1), Ps.93(3) (sick leave runs to
	// termination). The SKB's 8 cuti bersama days.
	const expected: Record<string, [string, number | null]> = {
		ANNUAL_LEAVE: ['employment.service_months >= 12', 12],
		MENSTRUAL_LEAVE: ['', 2],
		MATERNITY_LEAVE: ['', 91],
		MISCARRIAGE_LEAVE: ['', 45],
		MARRIAGE_LEAVE: ['', 3],
		CHILD_MARRIAGE_LEAVE: ['', 2],
		CHILD_CIRCUMCISION_LEAVE: ['', 2],
		CHILD_BAPTISM_LEAVE: ['', 2],
		PATERNITY_LEAVE: ['', 2],
		BEREAVEMENT_LEAVE: ['', 2],
		BEREAVEMENT_HOUSEHOLD_LEAVE: ['', 1],
		JOINT_LEAVE: ['', 8],
		MEDICAL_LEAVE: ['', null]
	};
	for (const version of settingsVersions('ID')) {
		const rows = leaveCatalogue('ID').filter((row) => row.settings_id === version.id);
		for (const [code, [eligibility, days]] of Object.entries(expected)) {
			const row = rows.find((candidate) => candidate.code === code);
			assert.ok(row, `${code} on ${version.name}`);
			const band = row.entitlement.bands.at(-1);
			assert.equal(band?.eligibility ?? '', eligibility, `${code} eligibility`);
			assert.equal(band?.days ?? null, days, `${code} days`);
			if (days === null) assert.equal(row.entitlement.availability, 'UNLIMITED');
			assert.equal(row.is_npl, false, `${code} is paid`);
		}
		assert.equal(
			rows.find((row) => row.code === 'MENSTRUAL_LEAVE')?.entitlement.availability,
			'MONTHLY'
		);
		// UU 4/2024 art.4(3): the birth is the event, and a complicated one grants up to three
		// further months at 75% from the fifth.
		const maternity = rows.find((row) => row.code === 'MATERNITY_LEAVE')!;
		assert.equal(
			maternity.eligibility,
			'employee.gender == "FEMALE" && event.kind in ["BIRTH", "BIRTH_COMPLICATION"]'
		);
		assert.equal(maternity.entitlement.availability, 'PER_EVENT');
		assert.deepEqual(maternity.entitlement.bands[0], {
			eligibility: 'event.kind == "BIRTH_COMPLICATION"',
			days: 182
		});
		// Ps.93(3): the sick-pay scale rides the row as its pay fraction; cuti bersama draws on
		// the annual leave.
		assert.match(
			rows.find((row) => row.code === 'MEDICAL_LEAVE')!.pay_fraction,
			/leave\.month_index <= 4 \? 1\.0/
		);
		assert.equal(rows.find((row) => row.code === 'JOINT_LEAVE')!.consumes_code, 'ANNUAL_LEAVE');
	}
});

test('Indonesia — the Kesehatan floor is on the wage per month, not on a part month’s prorated base (Perpres 82/2018 art.32(2))', () => {
	// A joiner on 15 January at 10,000,000 is paid 17 of 31 days — 5,483,870.97, under the
	// 5,729,876 UMP — but the contract is above the floor: 1% / 4% of the wage paid, 54,839 /
	// 219,355. A contract at 5,000,000 is under it, and its part month is lifted in the same
	// proportion: 5,729,876 × 17 ÷ 31 = 3,142,190 → 31,422 / 125,688.
	const book = assessStatutoryUnvalidated({
		...idWorld('2026-01'),
		people: [
			{ key: 'ID-JOIN-10M', wage: 10_000_000, hire_date: '2026-01-15' },
			{ key: 'ID-JOIN-5M', wage: 5_000_000, hire_date: '2026-01-15' }
		]
	});
	expectStatutory(book, 'ID-JOIN-10M', 'KESEHATAN', 54_839, 219_355);
	expectStatutory(book, 'ID-JOIN-5M', 'KESEHATAN', 31_422, 125_688);
});

test('Indonesia — biaya jabatan is capped per month of income, the join month whole (PMK 250/PMK.03/2008 art.1(1))', () => {
	// A joiner on 15 July at 20,000,000. On file: July's 17 of 31 days, 10,967,742, then four
	// months of 20,000,000 (1,600,000 withheld each, JP 110,863 on the ceiling, JHT 2%). December's
	// gross is 20,648,000 with the employer premiums (Kesehatan 480,000 on the 12,000,000 cap,
	// JKK 108,000, JKM 60,000): the year 111,615,742, biaya jabatan 5% = 5,580,787 capped at six
	// months × 500,000 = 3,000,000 (five would be 2,500,000), JP 665,178, JHT 2,219,355, PTKP
	// 54,000,000 → PKP 51,731,209 → 51,731,000 → 5% = 2,586,550, less the 6,400,000 withheld.
	const book = assessStatutoryUnvalidated(
		{
			...idWorld('2026-12'),
			people: [{ key: 'ID-JUL15', wage: 20_000_000, hire_date: '2026-07-15' }]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'ID-JUL15')!;
			const months: [string, number, number, number][] = [
				['2026-07', 10_967_742, 0, 219_355],
				['2026-08', 20_000_000, 1_600_000, 400_000],
				['2026-09', 20_000_000, 1_600_000, 400_000],
				['2026-10', 20_000_000, 1_600_000, 400_000],
				['2026-11', 20_000_000, 1_600_000, 400_000]
			];
			for (const [period, gross, pph21, jht] of months) {
				world.payroll_runs.push({ id: `prior-${period}`, company_id: COMPANY_ID, period });
				world.payslips.push({
					id: `payslip-${period}-ID-JUL15`,
					payroll_run_id: `prior-${period}`,
					employment_id: employment.id,
					status: 'PAID',
					paid_at: `${period}-28T00:00:00.000Z`,
					currency: 'IDR',
					base: [],
					adjustments: [],
					statutory: [
						{
							scheme_code: 'PPH21',
							employee_amount: pph21,
							employer_amount: 0,
							base_amount: gross,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'JP',
							employee_amount: 110_863,
							employer_amount: 221_726,
							base_amount: gross,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'JHT',
							employee_amount: jht,
							employer_amount: jht * 1.85,
							base_amount: gross,
							rule_when: null,
							authority: null
						}
					]
				});
			}
		}
	);
	expectStatutory(book, 'ID-JUL15', 'PPH21', 2_586_550 - 6_400_000, 0);
});

test('Indonesia — a foreign worker joins JKK, JKM and JHT from six months of work (PP 44/2015, PP 46/2015 art.2(2))', () => {
	// A three-month contract: outside the three; a six-month one, or an open contract, inside.
	// (JP reaches a foreigner only through a registration fact — landed 2026-09-19 (11).)
	const book = assessStatutoryUnvalidated({
		...idWorld('2026-01'),
		people: [
			{
				key: 'ID-TKA-3M',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				hire_date: '2026-01-01',
				exit_date: '2026-03-31'
			},
			{
				key: 'ID-TKA-6M',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				hire_date: '2026-01-01',
				exit_date: '2026-06-30'
			},
			{ key: 'ID-TKA-OPEN', wage: 20_000_000, citizenship: 'FOREIGNER' }
		]
	});
	for (const scheme of ['JHT', 'JKK', 'JKM']) expectStatutorySkipped(book, 'ID-TKA-3M', scheme);
	expectStatutory(book, 'ID-TKA-6M', 'JHT', 400_000, 740_000);
	expectStatutory(book, 'ID-TKA-OPEN', 'JHT', 400_000, 740_000);
});

test('Indonesia — efficiency or closure because of losses is half the pesangon (PP 35/2021 art.43(1)(a), 44(1)); redundancy without losses the whole', () => {
	// Four years' service at 10,000,000: the art.40(2) pesangon is five months' wages — 50,000,000
	// on REDUNDANCY (art.43(1)(b)), 25,000,000 on RETRENCHMENT; UPMK (art.40(3): two months at
	// three years) is whole on both.
	const separation = (key: string, reason: string) => ({
		key,
		wage: 10_000_000,
		hire_date: '2021-12-15',
		exit_date: '2026-01-31',
		exit_reason: reason
	});
	const { slips } = buildStatutory(
		{
			...idWorld('2026-01'),
			people: [
				separation('ID-REDUNDANT', 'REDUNDANCY'),
				separation('ID-RETRENCHED', 'RETRENCHMENT')
			]
		},
		(world) => {
			for (const [index, key] of ['ID-REDUNDANT', 'ID-RETRENCHED'].entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				// PP 35/2021 art.43(1): the detailed cause, not the broad exit reason, chooses the
				// multiplier — preventing loss pays the whole award, an actual loss pays half.
				employment.exit_facts = {
					termination_cause:
						key === 'ID-REDUNDANT' ? 'EFFICIENCY_PREVENT_LOSS' : 'EFFICIENCY_ACTUAL_LOSS',
					separation_wage_basis: 'MONTHLY',
					micro_small_enterprise: false,
					pension_offset_applies: false
				};
				for (const [offset, code] of ['PESANGON', 'UPMK'].entries()) {
					const row = world.adhoc_catalogue!.find(
						(item) =>
							item.code === code &&
							item.settings_id ===
								world.jurisdiction_settings.find((v) =>
									String(v.effective_range.start).startsWith('2026-01')
								)!.id
					)!;
					world.adhoc_requests!.push({
						id: `d0000000-0000-4000-8000-0000000000b${index}${offset}`,
						employment_id: employment.id,
						catalogue_id: row.id,
						amount: 0,
						event_date: '2026-01-31',
						pay_period: '2026-01',
						payslip_id: null,
						reason: code,
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
				}
			}
		}
	);
	const paid = (key: string, code: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === code)?.amount;
	assert.equal(paid('ID-REDUNDANT', 'PESANGON'), 50_000_000);
	assert.equal(paid('ID-RETRENCHED', 'PESANGON'), 25_000_000);
	assert.equal(paid('ID-REDUNDANT', 'UPMK'), 20_000_000);
	assert.equal(paid('ID-RETRENCHED', 'UPMK'), 20_000_000);
});
