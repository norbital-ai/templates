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
import { payrollWorld } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import { finalPayIssues } from '../src/lib/payroll/contribution.ts';
import { ordinaryDivisorDays } from '../src/lib/payroll/run/ordinary-rate.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
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
		region: 'Provinsi DKI Jakarta',
		// PP 44/2015 Ps.16 group II, "risiko rendah": the art.16(1) rate 0.54%, which is what BPJS
		// bills — the 0.14% JKP recomposition stays inside it, never a second payslip line.
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

test('Indonesia — an unrecorded PTKP status withholds no PPh 21 and warns, rather than reading TK/0', () => {
	// UU PPh art.7(2): the PTKP is the status at the start of the year, which the employee declares;
	// no provision presumes TK/0 for an unknown one, and the current family record is not that
	// declaration (PMK 168/2023 art.9(4)). Nothing is withheld on a guess, and nobody else's pay
	// waits for the declaration: the run warns by name.
	const run = buildStatutory(
		{
			...idWorld('2026-01'),
			people: [{ key: 'ID-BLANK-15M', wage: 15_000_000, marital_status: '' }]
		},
		(world) => {
			for (const fact of world.employment_statutory_facts)
				if (fact.status.kind === 'REGISTERED') delete fact.status.elections?.ptkp_marital_status;
		}
	);
	const pph21 = run.slips.get('ID-BLANK-15M')!.statutory.find((row) => row.scheme_code === 'PPH21');
	assert.equal(pph21?.employee_amount ?? 0, 0);
	assert.match(
		run.warnings.join('\n'),
		/ID-BLANK-15M: PPH21: PTKP status or dependants on 1 January/
	);
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
	// 25,000,000 + JKK 135,000 + JKM 75,000 + Kesehatan 480,000 (4% of the 12,000,000 cap) =
	// 25,690,000, in TER A bracket 24,150,001–26,450,000 at 10.00% → 2,569,000.
	expectStatutory(book, 'ID-25M', 'PPH21', 2569000, 0);

	// TER C covers K/3 (PTKP 72,000,000).
	// 15,606,000 (the premiums in the gross, as above) is in bracket 15,550,001–17,050,000 at 6.00%
	// → 936,360.
	expectStatutory(book, 'ID-C-15M', 'PPH21', 936360, 0);
	// 25,690,000 is in bracket 22,700,001–26,600,000 at 9.00% → 2,312,100.
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
	// PKP = annual gross − biaya jabatan (5%, at most 6,000,000 a year; PMK 168/2023 art.10(2)) − the
	// year's employee JP AND JHT (PMK 168/2023 art.10(1)(b): iuran terkait program pensiun dan hari
	// tua paid through the employer to BPJS Ketenagakerjaan) − PTKP 54,000,000 TK/0, rounded down
	// to the whole thousand (UU PPh art.17(4); PMK 168/2023 art.8(4)), at 5% to 60,000,000 and 15% above; December charges
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
	// ID-5M: December's gross carries its premiums (JKK 27,000 + JKM 15,000 + Kesehatan 229,195 on
	// the DKI floor), so the year is 60,271,195; biaya jabatan 5% = 3,013,559.75; PKP = 60,271,195 −
	// 3,013,559.75 − JP 600,000 − JHT 1,200,000 − 54,000,000 = 1,457,635.25 → 1,457,000 → 5% =
	// 72,850; the TER withheld nothing all year, so December charges the whole annual figure.
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
	// Without the certificate she is TK/0, TER category A: the 15,606,000 gross withholds 7% =
	// 1,092,420. With it the married ladder applies (K/3, category C): 6% = 936,360.
	expectStatutory(book, 'ID-W-15M', 'PPH21', 1_092_420, 0);
	expectStatutory(book, 'ID-W-KI-15M', 'PPH21', 936360, 0);
});

test('Indonesia — a married woman whose husband has no income is relieved for self, marriage and dependants, never K/I', () => {
	// PMK 168/2023 art.9(2)(b): a married woman employee holding the kecamatan statement that her
	// husband has no income is relieved PTKP for herself (54,000,000) + married (4,500,000) + three
	// dependants (13,500,000) = 72,000,000. The K/I addition for a spouse's combined income
	// (UU PPh art.7(1)) belongs to the household's own annual return, not employer withholding.
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
	const book = assessStatutoryUnvalidated(
		{
			...idWorld('2026-12'),
			people: [
				{
					key: 'ID-W-KI-15M',
					wage: 15_000_000,
					gender: 'FEMALE',
					marital_status: 'MARRIED',
					children: 3,
					registrations: { PPH21: { kind: 'REGISTERED', elections: { ptkp: 'KI' } } }
				}
			]
		},
		(world) => {
			const employment = world.employments.find((row) => row.employee_number === 'ID-W-KI-15M');
			assert.ok(employment);
			for (const period of priorPeriods) {
				const runId = `ki-prior-${period}`;
				world.payroll_runs.push({ id: runId, company_id: COMPANY_ID, period });
				world.payslips.push({
					id: `ki-payslip-${period}`,
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
							employee_amount: 936_360,
							employer_amount: 0,
							base_amount: 15_000_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'JP',
							employee_amount: priorJp(period),
							employer_amount: priorJp(period) * 2,
							base_amount: 15_000_000,
							rule_when: null,
							authority: null
						},
						{
							scheme_code: 'JHT',
							employee_amount: 300_000,
							employer_amount: 555_000,
							base_amount: 15_000_000,
							rule_when: null,
							authority: null
						}
					]
				});
			}
		}
	);
	// PKP = 180,606,000 − 6,000,000 − 1,319,578 − 3,600,000 − 72,000,000 = 97,686,422 →
	// 97,686,000; annual tax = 5% × 60,000,000 + 15% × 37,686,000 = 3,000,000 + 5,652,900 =
	// 8,652,900; December = 8,652,900 − 11 × 936,360 (10,299,960) = −1,647,060.
	expectStatutory(book, 'ID-W-KI-15M', 'PPH21', -1_647_060, 0);
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
	// Each departure is judged against the leaver's own religious holiday — here Idul Fitri 1447 H,
	// 21 March 2026 (SKB 2026) — with the rest of the departure record a leaver owes.
	for (const employment of world.employments)
		if (employment.effective_range.end != null)
			employment.exit_facts = {
				thr_holiday_date: '2026-03-21',
				micro_small_enterprise: false,
				...(employment.employee_number === 'ID-PERM-25MAR'
					? {
							termination_cause: 'VOLUNTARY_RESIGNATION',
							separation_pay_amount: 0,
							separation_pay_reference: 'NONE',
							pension_offset_applies: false
						}
					: {})
			};
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
	const prepared = gatherPayrollRun({
		world: payrollWorld(world),
		companyId: COMPANY_ID,
		period: '2026-03'
	});
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
				terms: { base_salary: 17_300_000, currency: 'IDR' },
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
	// PPh 21 reads the overtime (PMK 168/2023 Ps.15, gross) and the employer-borne premiums beside
	// it (Ps.5(1)): JKK class III 0.89% × 17,300,000 = 153,970, JKM 0.30% = 51,900 and Kesehatan
	// 4% of the Rp12,000,000 cap = 480,000, together 685,870. The BPJS bases are the wage alone
	// (PP 44/2015 Ps.19(2), PP 45/2015 Ps.29(1): upah pokok + tunjangan tetap).
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

test('Indonesia — biaya jabatan is capped per month of income, the join month whole (PMK 168/2023 art.10(2))', async () => {
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
	// PMK 168/2023 art.24(a) revoked PMK 250/PMK.03/2008: every sealed PPH21 version cites art.10(2)
	// for the cap and art.10(1)(b) for the JP/JHT deduction.
	const { readFileSync } = await import('node:fs');
	const versions = (
		JSON.parse(readFileSync('seed/jurisdiction/ID/statutory_contributions.json', 'utf8')) as {
			code: string;
			authority: string;
		}[]
	).filter((scheme) => scheme.code === 'PPH21');
	assert.equal(versions.length, 3);
	for (const { authority } of versions) {
		assert.match(authority, /at most 6,000,000; PMK 168\/2023 art\.10\(2\)/);
		assert.match(authority, /employee JP and JHT \(PMK 168\/2023 art\.10\(1\)\(b\)/);
	}
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
					// Idul Fitri 1447 H (SKB 2026): the holiday the departure's THR is judged against.
					thr_holiday_date: '2026-03-21',
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
	// PP 68/2009 art.2–4: severance paid at once carries its own final tax — nothing to
	// 50,000,000 and 5% to 100,000,000 — separate from the monthly TER, which reads neither line.
	// The redundant leaver's 50,000,000 + 20,000,000 = 70,000,000 pays 5% × 20,000,000; the
	// retrenched one's 25,000,000 + 20,000,000 = 45,000,000 stays under the first rung.
	const finalTax = (key: string) =>
		slips.get(key)!.statutory.find((row) => row.scheme_code === 'PPH21_FINAL_SEVERANCE')
			?.employee_amount;
	assert.equal(finalTax('ID-REDUNDANT'), 1_000_000);
	assert.equal(finalTax('ID-RETRENCHED'), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenario goldens, 2026-09-28 — every figure from the instrument cited beside it, on the
// 1 March 2026 version unless stated: DKI Jakarta UMP 5,729,876 (Kep.1142/2025), JKK group II
// 0.54% (PP 44/2015 art.16(1)), JKM 0.30%, JHT 2% / 3.7% (PP 46/2015 art.16), JP 1% / 2% on the
// Rp11,086,300 ceiling from 1 March 2026 (PP 45/2015 arts.28–29), Kesehatan 1% / 4% floored at
// the workplace UMK/UMP and capped at Rp12,000,000 (Perpres 82/2018 arts.30, 32 as amended),
// PPh 21 TER on gross including the employer-borne JKK, JKM and Kesehatan premiums (PP 58/2023
// Lampiran; PMK 168/2023 art.5(1), art.15). BPJS and PPh figures round to the whole rupiah
// (register ID-127 records that this rounding rule is not yet sourced).
//
// Part-month pay and unpaid days: no statute fixes how a monthly wage is divided (register
// ID-106: PP 36/2021 art.17's ÷25/÷21 is for wages SET daily; PP 36/2021 art.40(1) says only that
// no wage is due for days not worked). The seed's stated policy is calendar days
// (`work_rules.proration`), and these goldens price that policy; the statutory figures on top of
// the wage are the law's.
// ─────────────────────────────────────────────────────────────────────────────

const MARCH_2026 = 'f5282c8e-2224-4714-afb7-7314a5bfe37d';
const scenario = (period: string, people: Parameters<typeof buildStatutory>[0]['people']) => ({
	code: 'ID' as const,
	period,
	region: 'Provinsi DKI Jakarta',
	riskClass: 'II',
	people
});
const charges = (slip: BuiltPayslip) =>
	Object.fromEntries(
		slip.statutory.map((row) => [row.scheme_code, [row.employee_amount, row.employer_amount]])
	);
const priorSlips = (
	world: PayrollWorld,
	key: string,
	months: ReadonlyArray<{ period: string; gross: number; pph21: number; jp: number; jht: number }>
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	for (const month of months) {
		const runId = `prior-${month.period}-${key}`;
		world.payroll_runs.push({ id: runId, company_id: COMPANY_ID, period: month.period });
		world.payslips.push({
			id: `payslip-${month.period}-${key}`,
			payroll_run_id: runId,
			employment_id: employment.id,
			status: 'PAID',
			paid_at: `${month.period}-28T00:00:00.000Z`,
			currency: 'IDR',
			base: [],
			adjustments: [],
			statutory: [
				{
					scheme_code: 'PPH21',
					employee_amount: month.pph21,
					employer_amount: 0,
					base_amount: month.gross,
					rule_when: null,
					authority: null
				},
				{
					scheme_code: 'JP',
					employee_amount: month.jp,
					employer_amount: month.jp * 2,
					base_amount: month.gross,
					rule_when: null,
					authority: null
				},
				{
					scheme_code: 'JHT',
					employee_amount: month.jht,
					employer_amount: month.jht * 1.85,
					base_amount: month.gross,
					rule_when: null,
					authority: null
				}
			]
		});
	}
};

test('Indonesia — a joiner after the cut-off: November is its own JP and Kesehatan month on the December slip (ID-AUD-1)', () => {
	// Hired 25 November 2026 at 124,000,000, after the 21st cut-off: November is deferred and paid
	// as back pay in December, 6 of 30 days = 24,800,000. Contributions are owed month by month
	// from the first day of work (PP 46/2015 art.9(2); PP 44/2015 art.8(2); PP 45/2015 arts.28–29;
	// Perpres 82/2018 arts.30, 32). The November slip carries November's JHT, JKK and JKM on the
	// monthly rate (ID-161): 2% / 3.7% of 124,000,000 = 2,480,000 / 4,588,000, JKK class I 0.24% =
	// 297,600, JKM 0.30% = 372,000. JP and Kesehatan are on the month's wage (PP 45/2015 art.29(1)
	// "pada bulan yang bersangkutan"), so November's are priced on the 24,800,000 when it is paid,
	// capped as its own month: JP 1% / 2% of 11,086,300 = 110,863 / 221,726; Kesehatan 1% / 4% of
	// 12,000,000 = 120,000 / 480,000. December's own 124,000,000 adds the same capped figures:
	// JP 221,726 / 443,452, Kesehatan 240,000 / 960,000 on the one slip.
	const world = (period: string) => ({
		code: 'ID' as const,
		period,
		region: 'Provinsi DKI Jakarta',
		riskClass: 'I',
		people: [{ key: 'S7b', wage: 124_000_000, age: 40, hire_date: '2026-11-25' }]
	});
	const november = buildStatutory(world('2026-11')).slips.get('S7b')!;
	assert.deepEqual(november.base, []);
	const nov = charges(november);
	assert.deepEqual(nov.JHT, [2_480_000, 4_588_000]);
	assert.deepEqual(nov.JKK, [0, 297_600]);
	assert.deepEqual(nov.JKM, [0, 372_000]);
	assert.equal(nov.JP, undefined);
	assert.equal(nov.KESEHATAN, undefined);
	const december = buildStatutory(world('2026-12')).slips.get('S7b')!;
	assert.deepEqual(
		december.base.map((row) => [row.component_code, row.amount]),
		[
			['BASIC', 24_800_000],
			['BASIC', 124_000_000]
		]
	);
	const dec = charges(december);
	assert.deepEqual(dec.JHT, [2_480_000, 4_588_000]);
	assert.deepEqual(dec.JKK, [0, 297_600]);
	assert.deepEqual(dec.JKM, [0, 372_000]);
	assert.deepEqual(dec.JP, [221_726, 443_452]);
	assert.deepEqual(dec.KESEHATAN, [240_000, 960_000]);
});

test('Indonesia — a full month, a joiner on the 16th and a raise on the 16th, April 2026', () => {
	const { slips } = buildStatutory(
		scenario('2026-04', [
			{ key: 'ID-FULL', wage: 10_000_000 },
			{ key: 'ID-JOIN', wage: 12_000_000, hire_date: '2026-04-16' },
			{ key: 'ID-RAISE', wage: 10_000_000 }
		]),
		(world) => {
			const raise = world.employments.find((row) => row.employee_number === 'ID-RAISE')!;
			const terms = world.employment_terms.find((row) => row.employment_id === raise.id)!;
			terms.effective_range = { start: '2015-01-01', end: '2026-04-15' };
			world.employment_terms.push({
				...terms,
				id: 'b0000000-0000-4000-8000-0000000000ff',
				base_salary: 13_000_000,
				effective_range: { start: '2026-04-16', end: null }
			});
		}
	);
	// Full month, 10,000,000: JHT 200,000 / 370,000; JKK 54,000; JKM 30,000; JP 100,000 / 200,000
	// (under the ceiling); Kesehatan 100,000 / 400,000 (above the floor, under the cap). PPh 21:
	// 10,000,000 + 54,000 + 30,000 + 400,000 = 10,484,000, TER A 10,350,001–10,700,000 at 2.50% →
	// 262,100.
	assert.deepEqual(charges(slips.get('ID-FULL')!), {
		JHT: [200_000, 370_000],
		JKK: [0, 54_000],
		JKM: [0, 30_000],
		JKP: [0, 0],
		JP: [100_000, 200_000],
		KESEHATAN: [100_000, 400_000],
		PPH21: [262_100, 0]
	});
	// Joiner: 15 of April's 30 days of 12,000,000 = 6,000,000 paid. Owner rule 2026-09-28 (ID-161):
	// JHT, JKK and JKM are on "Upah sebulan", the contract's monthly rate (PP 46/2015 art.17(1)–(2),
	// PP 44/2015 art.19(1)–(2)): 2% / 3.7% of 12,000,000 = 240,000 / 444,000, JKK 0.54% = 64,800,
	// JKM 0.30% = 36,000. JP is on the wage paid "pada bulan yang bersangkutan" (PP 45/2015
	// art.29(1)): 1% / 2% of 6,000,000. Kesehatan charges the wage paid; its floor is on the
	// contract (12,000,000 ≥ 5,729,876), so it does not lift the part month. PPh 21 on the month's
	// actual gross (PMK 168/2023 art.15; the TER is never annualised): 6,000,000 + 64,800 + 36,000 +
	// 240,000 = 6,340,800, TER A 6,300,001–6,750,000 at 1% → 63,408.
	assert.equal(
		slips.get('ID-JOIN')!.base.find((row) => row.component_code === 'BASIC')!.amount,
		6_000_000
	);
	assert.deepEqual(charges(slips.get('ID-JOIN')!), {
		JHT: [240_000, 444_000],
		JKK: [0, 64_800],
		JKM: [0, 36_000],
		JKP: [0, 0],
		JP: [60_000, 120_000],
		KESEHATAN: [60_000, 240_000],
		PPH21: [63_408, 0]
	});
	// Raise: 15 days at 10,000,000 (5,000,000) + 15 days at 13,000,000 (6,500,000) = 11,500,000.
	// JHT, JKK and JKM are on the monthly rate in force on the month's last day (owner rule
	// 2026-09-28, ID-161: the law is silent on a mid-month change): 13,000,000 → 260,000 / 481,000,
	// 70,200, 39,000. JP is on the wage paid, at the ceiling (11,500,000 > 11,086,300): 110,863 /
	// 221,726. PPh 21: 11,500,000 + 70,200 + 39,000 + 460,000 = 12,069,200, TER A
	// 11,600,001–12,500,000 at 4% → 482,768.
	assert.deepEqual(charges(slips.get('ID-RAISE')!), {
		JHT: [260_000, 481_000],
		JKK: [0, 70_200],
		JKM: [0, 39_000],
		JKP: [0, 0],
		JP: [110_863, 221_726],
		KESEHATAN: [115_000, 460_000],
		PPH21: [482_768, 0]
	});
});

test('Indonesia — two unpaid days (PP 36/2021 art.40(1)), priced on the seed’s calendar-day policy', () => {
	const { slips } = buildStatutory(
		scenario('2026-04', [{ key: 'ID-NPL', wage: 10_000_000 }]),
		(world) => {
			world.leave_catalogue.push(
				...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null }))
			);
			const unpaid = world.leave_catalogue.find(
				(row) => row.settings_id === MARCH_2026 && row.code === 'UNPAID_LEAVE'
			)!;
			for (const date of ['2026-04-06', '2026-04-07'])
				world.leave_entries.push({
					id: `e1000000-0000-4000-8000-0000000000${date.slice(-2)}`,
					employment_id: world.employments[0]!.id,
					catalogue_id: unpaid.id,
					leave_code: 'UNPAID_LEAVE',
					reference: `NPL-${date}`,
					from_date: date,
					to_date: date,
					half_day_start: false,
					half_day_end: false,
					days: 1,
					effective_on: date,
					reason: 'Unpaid day',
					allocations: [],
					charges: [
						{
							date,
							days: 1,
							catalogue_id: unpaid.id,
							employment_term_id: world.employment_terms[0]!.id,
							holiday_id: null,
							shift_definition_id: null,
							work_day_id: null
						}
					],
					approval_id: null,
					payslip_id: null
				} as never);
		}
	);
	const slip = slips.get('ID-NPL')!;
	// 10,000,000 ÷ 30 × 2 = 666,666.67 off (split 333,333.33 + 333,333.34 so the cents close).
	const off = slip.adjustments
		.filter((row) => row.component_code === 'UNPAID_LEAVE')
		.reduce((total, row) => total + row.amount, 0);
	assert.equal(Math.round(off * 100) / 100, 666_666.67);
	// JHT, JKK and JKM stay on the contract's monthly rate, 10,000,000 (owner rule 2026-09-28,
	// ID-161; PP 46/2015 art.17(1)–(2), PP 44/2015 art.19(1)–(2)): 200,000 / 370,000, 54,000,
	// 30,000. JP (PP 45/2015 art.29(1)) and Kesehatan charge the wage paid, 9,333,333.33; the
	// contract stays above the Kesehatan floor so nothing lifts it: JP 93,333.33 → 93,333 and
	// 186,666.67 → 186,667. PPh 21: 9,333,333.33 + 54,000 + 30,000 + 373,333 = 9,790,666.33, TER A
	// 9,650,001–10,050,000 at 2% → 195,813.33 → 195,813.
	assert.deepEqual(charges(slip), {
		JHT: [200_000, 370_000],
		JKK: [0, 54_000],
		JKM: [0, 30_000],
		JKP: [0, 0],
		JP: [93_333, 186_667],
		KESEHATAN: [93_333, 373_333],
		PPH21: [195_813, 0]
	});
});

test('Indonesia — the part-month default is calendar days on every version, recorded as ID-106', () => {
	// No instrument divides a monthly wage for a part month (register ID-106), so the seed records
	// its default: monthly ÷ the month's calendar days. One unpaid day on 9,300,000 is 9,300,000 ÷ 30
	// = 310,000 in April and 9,300,000 ÷ 31 = 300,000 in May.
	for (const version of settingsVersions('ID')) {
		assert.deepEqual(version.work_rules.proration, { by: 'CALENDAR_DAYS' }, version.id);
		assert.match(version.work_rules.authority, /Recorded default 2026-09-28 \(register ID-106\)/);
	}
	const unpaidDay = (period: string, date: string) => {
		const { slips } = buildStatutory(
			scenario(period, [{ key: 'ID-DAY', wage: 9_300_000 }]),
			(world) => {
				world.leave_catalogue.push(
					...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null }))
				);
				const unpaid = world.leave_catalogue.find(
					(row) => row.settings_id === MARCH_2026 && row.code === 'UNPAID_LEAVE'
				)!;
				world.leave_entries.push({
					id: 'e1000000-0000-4000-8000-000000000099',
					employment_id: world.employments[0]!.id,
					catalogue_id: unpaid.id,
					leave_code: 'UNPAID_LEAVE',
					reference: `NPL-${date}`,
					from_date: date,
					to_date: date,
					half_day_start: false,
					half_day_end: false,
					days: 1,
					effective_on: date,
					reason: 'Unpaid day',
					allocations: [],
					charges: [
						{
							date,
							days: 1,
							catalogue_id: unpaid.id,
							employment_term_id: world.employment_terms[0]!.id,
							holiday_id: null,
							shift_definition_id: null,
							work_day_id: null
						}
					],
					approval_id: null,
					payslip_id: null
				} as never);
			}
		);
		return slips
			.get('ID-DAY')!
			.adjustments.filter((row) => row.component_code === 'UNPAID_LEAVE')
			.reduce((total, row) => total + row.amount, 0);
	};
	assert.equal(unpaidDay('2026-04', '2026-04-07'), 310_000);
	assert.equal(unpaidDay('2026-05', '2026-05-12'), 300_000);
});

test('Indonesia — a bonus month: TER on the whole gross, no BPJS on the bonus (PP 36/2021 art.8)', () => {
	const bonus = (residency: 'RESIDENT' | 'NON_RESIDENT') =>
		buildStatutory(
			scenario('2026-06', [
				{
					key: 'ID-BONUS',
					wage: residency === 'RESIDENT' ? 10_000_000 : 30_000_000,
					...(residency === 'RESIDENT'
						? {}
						: { tax_residency: 'NON_RESIDENT', citizenship: 'FOREIGNER' })
				}
			]),
			(world) => {
				const row = world.adhoc_catalogue!.find(
					(item) => item.settings_id === MARCH_2026 && item.code === 'BONUS_THR'
				)!;
				world.adhoc_requests!.push({
					id: 'a1a1a1a1-0000-4000-8000-0000000000b1',
					employment_id: world.employments[0]!.id,
					catalogue_id: row.id,
					amount: 20_000_000,
					event_date: '2026-06-10',
					pay_period: null,
					payslip_id: null,
					reason: 'Annual bonus',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
			}
		).slips.get('ID-BONUS')!;
	// PP 36/2021 art.8(1)–(2): a bonus is non-wage income, so the BPJS bases (upah pokok + tunjangan
	// tetap) stay at 10,000,000. PMK 168/2023 art.15 and the Lampiran's Tuan A example: the bonus
	// month's TER is the rate for the whole month's gross: 10,000,000 + 20,000,000 + 54,000 + 30,000
	// + 400,000 = 30,484,000, TER A 30,050,001–32,400,000 at 13% → 3,962,920.
	const resident = charges(bonus('RESIDENT'));
	assert.deepEqual(resident.JHT, [200_000, 370_000]);
	assert.deepEqual(resident.PPH21, [3_962_920, 0]);
	// UU PPh art.26(1): a non-resident is withheld 20% of gross, no PTKP and no TER: 30,000,000 +
	// 20,000,000 + JKK 162,000 + JKM 90,000 + Kesehatan 480,000 = 50,732,000 → 10,146,400.
	const nonResident = charges(bonus('NON_RESIDENT'));
	assert.deepEqual(nonResident.PPH26, [10_146_400, 0]);
	assert.equal(nonResident.PPH21, undefined, 'PPh 21 does not reach a non-resident');
});

test('Indonesia — a resigner on 15 June: final pay, untaken leave as UPH, and the leaver-month reckoning', async () => {
	// Five years' service at 10,000,000, resigning (PP 35/2021 art.36(i), art.50: UPH and any uang
	// pisah). Five untaken, unlapsed annual-leave days are UPH (PP 35/2021 art.40(4)(a)), valued on
	// the PKB basis the entity declared (UU 13/2003 art.79(4)): basic ÷ 21 = 476,190.48 a day, ×5 =
	// 2,380,952.38.
	const { slips, warnings } = buildStatutory(
		scenario('2026-06', [
			{
				key: 'ID-LEAVER',
				wage: 10_000_000,
				hire_date: '2021-01-04',
				exit_date: '2026-06-15',
				exit_reason: 'RESIGNATION'
			}
		]),
		(world) => {
			world.companies[0]!.facts = {
				leave_cash_out_day_divisor: 21,
				leave_cash_out_wage_basis: 'BASIC'
			};
			world.employments[0]!.exit_facts = {
				thr_holiday_date: '2027-03-10',
				micro_small_enterprise: false,
				termination_cause: 'VOLUNTARY_RESIGNATION',
				separation_pay_amount: 0,
				separation_pay_reference: 'NONE',
				pension_offset_applies: false
			};
			world.leave_catalogue.push(
				...leaveCatalogue('ID').map((row) => ({ ...row, approval_id: null }))
			);
			const annual = world.leave_catalogue.find(
				(row) => row.settings_id === MARCH_2026 && row.code === 'ANNUAL_LEAVE'
			)!;
			world.leave_entries.push({
				id: 'a4000000-0000-4000-8000-000000000009',
				employment_id: world.employments[0]!.id,
				catalogue_id: annual.id,
				leave_code: 'ANNUAL_LEAVE',
				reference: `exit:${world.employments[0]!.id}:ANNUAL_LEAVE`,
				from_date: '2026-01-01',
				to_date: '2026-12-31',
				days: 5,
				encash_days: 5,
				effective_on: '2026-06-15',
				due_on: '2026-06-15',
				charges: [],
				allocations: [],
				approval_id: null,
				payslip_id: null,
				as_adjustment_entry: false
			} as never);
			// January–May as the engine priced them: 10,484,000 gross, TER A 2.5% = 262,100.
			priorSlips(
				world,
				'ID-LEAVER',
				['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'].map((period) => ({
					period,
					gross: 10_484_000,
					pph21: 262_100,
					jp: 100_000,
					jht: 200_000
				}))
			);
		}
	);
	const slip = slips.get('ID-LEAVER')!;
	assert.equal(slip.base.find((row) => row.component_code === 'BASIC')!.amount, 5_000_000);
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')!.amount,
		2_380_952.38
	);
	const charge = charges(slip);
	// The UPH is not upah. JHT, JKK and JKM on the contract's monthly rate, 10,000,000 (owner rule
	// 2026-09-28, ID-161); JP and Kesehatan on the 5,000,000 paid.
	assert.deepEqual(charge.JHT, [200_000, 370_000]);
	assert.deepEqual(charge.JKK, [0, 54_000]);
	assert.deepEqual(charge.JKM, [0, 30_000]);
	assert.deepEqual(charge.JP, [50_000, 100_000]);
	assert.deepEqual(charge.KESEHATAN, [50_000, 200_000]);
	// PP 68/2009 art.1 angka 4: uang pesangon includes uang penggantian hak, paid in connection with
	// the end of service — so the leave UPH takes the final rates (0% to Rp50,000,000, art.4(a))
	// and stays out of the PPh 21 annual base.
	assert.deepEqual(charge.PPH21_FINAL_SEVERANCE, [0, 0]);
	// PMK 168/2023 (DJP Lampiran example, Tuan D): the month a resident employee stops working is the
	// last tax period, reckoned on actual year income with the whole PTKP. Year gross = 5 × 10,484,000
	// + June 5,284,000 (5,000,000 + 54,000 + 30,000 + 200,000) = 57,704,000; biaya jabatan 5% =
	// 2,885,200 (under 6 × 500,000); JP 550,000; JHT 1,200,000; PTKP 54,000,000 → PKP −931,200 → 0.
	// The 1,310,500 withheld January–May is refunded.
	assert.deepEqual(charge.PPH21, [-1_310_500, 0]);
	// Final pay: PP 36/2021 art.55(1) pays wages at the agreed time and art.55(4) caps the interval
	// at a month; UU 13/2003 art.156(1) owes severance on termination without a day count. The
	// deadline is the agreed payday (basis NEXT_PAYDAY), here 30 June, so the month-end run for a
	// 15 June leaver is on time.
	assert.deepEqual(
		warnings.filter((warning) => warning.includes('FINAL_PAY_LATE')),
		[]
	);
	// Every sealed version cites the signed Kemnaker SALINAN of PP 36/2021 (a scan: arts 15–17
	// checked against the page images, pp. 10–11), never a commercial copy.
	const { readFileSync } = await import('node:fs');
	const settings = JSON.parse(
		readFileSync('seed/jurisdiction/ID/jurisdiction_settings.json', 'utf8')
	) as { work_rules: { encashment: { authority: string } } }[];
	assert.equal(settings.length, 3);
	for (const version of settings) {
		const { authority } = version.work_rules.encashment;
		assert.match(
			authority,
			/Source: https:\/\/jdih\.kemnaker\.go\.id\/asset\/data_puu\/PP362021\.pdf/
		);
		assert.match(
			authority,
			/PP 36\/2021 art\.17 \(monthly wage ÷25 on a six-day week, ÷21 on a five-day week\)/
		);
		assert.doesNotMatch(authority, /hukumonline/);
	}
});

test('Indonesia — final pay falls due on the agreed payday of the exit period (PP 36/2021 art.55)', () => {
	for (const version of settingsVersions('ID'))
		assert.deepEqual(
			version.payroll.final_pay_deadlines.map(({ when, days, basis }) => ({ when, days, basis })),
			[{ when: '', days: 0, basis: 'NEXT_PAYDAY' }]
		);
	const late = (payFrequency: 'MONTHLY' | 'SEMI_MONTHLY', period: string, payDate: string) => {
		const world = createStatutoryWorld({
			...scenario(period, [
				{
					key: 'ID-LEAVER',
					wage: 10_000_000,
					hire_date: '2021-01-04',
					exit_date: '2026-06-15',
					exit_reason: 'RESIGNATION',
					pay_frequency: payFrequency
				}
			]),
			payFrequency
		});
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		return finalPayIssues({
			configuration: prepared.configuration,
			bundles: prepared.gathered.bundles,
			payDate
		}).map((issue) => issue.message);
	};
	// Monthly: the agreed payday of June is its month end (art.55(1), (4)); paying on it is on time,
	// a day later is late — art.61(1) counts the fine from the agreed date.
	assert.deepEqual(late('MONTHLY', '2026-06', '2026-06-30'), []);
	assert.match(late('MONTHLY', '2026-06', '2026-07-01')[0] ?? '', /agreed payday, by 2026-06-30/);
	// Semi-monthly: the 15th is the payday of the 1st–15th half the exit falls in.
	assert.deepEqual(late('SEMI_MONTHLY', '2026-06-1', '2026-06-15'), []);
	assert.match(
		late('SEMI_MONTHLY', '2026-06-1', '2026-06-16')[0] ?? '',
		/agreed payday, by 2026-06-15/
	);
});

test('Indonesia — band seams: every ceiling inclusive, the next band a rupiah above', () => {
	// TER A row 1 ends at 5,400,000 and row 2 starts at 5,400,001 (PP 58/2023 Lampiran). In
	// Kabupaten Subang (UMK 3,737,482) at group II, a wage of 5,150,706 grosses exactly
	// 5,400,000: JKK 27,813.81 → 27,814, JKM 15,452.12 → 15,452, Kesehatan 206,028.24 → 206,028.
	const subang = assessStatutoryUnvalidated({
		...scenario('2026-04', [
			{ key: 'ID-TER-AT', wage: 5_150_706 },
			{ key: 'ID-TER-CENT', wage: 5_150_706.01 },
			{ key: 'ID-TER-ABOVE', wage: 5_150_707 }
		]),
		region: 'Kabupaten Subang'
	});
	expectStatutory(subang, 'ID-TER-AT', 'PPH21', 0, 0);
	// A gross one cent above (5,400,000.01) is already row 2, 0.25%: 13,500.000025 → 13,500.
	expectStatutory(subang, 'ID-TER-CENT', 'PPH21', 13_500, 0);
	// 5,400,001 at 0.25% = 13,500.0025 → 13,500.
	expectStatutory(subang, 'ID-TER-ABOVE', 'PPH21', 13_500, 0);

	const dki = assessStatutoryUnvalidated(
		scenario('2026-04', [
			{ key: 'ID-JP-AT', wage: 11_086_300 },
			{ key: 'ID-KES-AT', wage: 12_000_000 },
			{ key: 'ID-FLOOR-BELOW', wage: 5_729_875 },
			{ key: 'ID-FLOOR-AT', wage: 5_729_876 }
		])
	);
	// PP 45/2015 art.29: JP on the wage up to the ceiling, inclusive: 1% / 2% of 11,086,300.
	expectStatutory(dki, 'ID-JP-AT', 'JP', 110_863, 221_726);
	// Perpres 82/2018 art.32(1): the Rp12,000,000 cap is inclusive.
	expectStatutory(dki, 'ID-KES-AT', 'KESEHATAN', 120_000, 480_000);
	// art.32(2): a rupiah below the UMP is lifted to it; at the UMP it is the UMP. 1% =
	// 57,298.76 → 57,299; 4% = 229,195.04 → 229,195.
	expectStatutory(dki, 'ID-FLOOR-BELOW', 'KESEHATAN', 57_299, 229_195);
	expectStatutory(dki, 'ID-FLOOR-AT', 'KESEHATAN', 57_299, 229_195);
});

test('Indonesia — age and identity branches: JP pension age 59 (PP 45/2015 art.15), no NPWP (UU PPh art.21(5a))', () => {
	const book = assessStatutoryUnvalidated(
		scenario('2026-04', [
			{ key: 'ID-58', wage: 10_000_000, age: 58 },
			{ key: 'ID-59', wage: 10_000_000, age: 59 },
			// art.15(4): a participant still employed may defer the pension up to three years, and
			// contributions continue on that choice.
			{
				key: 'ID-60-DEFER',
				wage: 10_000_000,
				age: 60,
				registrations: {
					JP: { kind: 'REGISTERED', elections: { continue_after_pension_age: true } }
				}
			},
			{
				key: 'ID-62-DEFER',
				wage: 10_000_000,
				age: 62,
				registrations: {
					JP: { kind: 'REGISTERED', elections: { continue_after_pension_age: true } }
				}
			},
			{
				key: 'ID-NO-NPWP',
				wage: 15_000_000,
				registrations: { PPH21: { kind: 'REGISTERED', elections: { no_tax_id: true } } }
			}
		])
	);
	// Pension age is 59 from 1 January 2025 to 31 December 2027 (art.15(1)–(3)).
	expectStatutory(book, 'ID-58', 'JP', 100_000, 200_000);
	expectStatutorySkipped(book, 'ID-59', 'JP');
	expectStatutory(book, 'ID-60-DEFER', 'JP', 100_000, 200_000);
	expectStatutorySkipped(book, 'ID-62-DEFER', 'JP');
	// JHT has no age limit while employed (PP 46/2015 art.16).
	expectStatutory(book, 'ID-59', 'JHT', 200_000, 370_000);
	// 15,606,000 at TER A 7% = 1,092,420, × 1.2 without an NPWP or usable NIK = 1,310,904.
	expectStatutory(book, 'ID-NO-NPWP', 'PPH21', 1_310_904, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Round 2 closures, 2026-09-28. Every figure is worked from the instrument cited beside it.
// ─────────────────────────────────────────────────────────────────────────────

/** Raise ad hoc severance lines (priced by their own bands) for one leaver in `period`. */
const separationLines = (
	world: PayrollWorld,
	key: string,
	period: string,
	eventDate: string,
	codes: readonly string[],
	// A PKWT that ends by its term is not a PP 35/2021 art.36 termination: no cause is recorded.
	cause: string | null = 'EFFICIENCY_PREVENT_LOSS'
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	employment.exit_facts = {
		thr_holiday_date: '2027-03-10',
		micro_small_enterprise: false,
		pension_offset_applies: false,
		...(cause == null ? {} : { termination_cause: cause, separation_wage_basis: 'MONTHLY' })
	};
	const version = world.jurisdiction_settings.find(
		(row) =>
			String(row.effective_range.start).slice(0, 10) <= `${period}-01` &&
			String(row.effective_range.end).slice(0, 10) > `${period}-01`
	)!;
	for (const [offset, code] of codes.entries()) {
		const row = world.adhoc_catalogue!.find(
			(item) => item.code === code && item.settings_id === version.id
		)!;
		world.adhoc_requests!.push({
			id: `d0000000-0000-4000-8000-00000000${String(world.adhoc_requests!.length).padStart(2, '0')}${offset}0`,
			employment_id: employment.id,
			catalogue_id: row.id,
			amount: 0,
			event_date: eventDate,
			pay_period: period,
			payslip_id: null,
			reason: code,
			evidence_file: null,
			as_adjustment_entry: false,
			approval_id: null
		});
	}
};
const paidLine = (slip: BuiltPayslip, code: string) =>
	slip.adjustments.find((row) => row.component_code === code)?.amount;

test('Indonesia — JP reaches a foreign worker only on a recorded BPJS registration (PP 45/2015 arts.3(1), 4(1))', () => {
	// PP 45/2015 art.2 names every worker of a non-state employer and has no nationality clause;
	// art.3(1) starts participation only once the worker is registered and the first contribution
	// paid. BPJS Ketenagakerjaan does not register a foreign national for JP (its FAQ), so the
	// default record is NOT_REGISTERED and nothing is charged (the rule `when`, not the unregistered
	// action: a local worker's missing registration is still charged); a registration on file is charged
	// like anyone else's. JHT has no such gate once the six-month rule is met (PP 46/2015 art.2(2)).
	const { slips, warnings } = buildStatutory(
		scenario('2026-04', [
			{
				key: 'ID-TKA-NOJP',
				wage: 20_000_000,
				citizenship: 'FOREIGNER',
				registrations: { JP: { kind: 'NOT_REGISTERED' } }
			},
			{ key: 'ID-TKA-JP', wage: 20_000_000, citizenship: 'FOREIGNER' }
		])
	);
	const noJp = charges(slips.get('ID-TKA-NOJP')!).JP;
	assert.ok(
		noJp == null || (noJp[0] === 0 && noJp[1] === 0),
		'no JP for an unregistrable foreigner'
	);
	assert.ok(!warnings.some((line) => line.includes('JP: registration incomplete')));
	// 20,000,000 is above the Rp11,086,300 ceiling (PP 45/2015 art.29): 1% / 2% of the ceiling.
	assert.deepEqual(charges(slips.get('ID-TKA-JP')!).JP, [110_863, 221_726]);
	// JHT 2% / 3.7% of 20,000,000, uncapped.
	assert.deepEqual(charges(slips.get('ID-TKA-NOJP')!).JHT, [400_000, 740_000]);
});

test('Indonesia — a missing BPJS registration does not waive JHT, JP, JKK, JKM or Kesehatan (R46, JP-LOCAL)', () => {
	// UU 24/2011 art.15(1) and art.19(1)–(2): the employer must register its workers and collect and
	// pay the contribution. PP 46/2015 art.2(1), 9(2), 11(4) (JHT) and PP 44/2015 art.4(1), 8(2)–(3),
	// 10(4) (JKK, JKM) run the contribution from the first day of work and make a negligent employer
	// pay it; Perpres 82/2018 art.13(1) registers the worker "dengan membayar Iuran". So an
	// unregistered local worker is charged exactly as a registered one, with a warning. JP too:
	// PP 45/2015 art.4(1)–(2) makes registration mandatory within 30 days of starting work and
	// art.5(5) obliges the negligent employer to collect and pay both shares; art.3(1) only dates
	// the benefit protection and art.6 adds the employer's own benefit liability meanwhile.
	const unregistered = Object.fromEntries(
		['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN'].map((code) => [
			code,
			{ kind: 'NOT_REGISTERED', reason: 'Enrolment outstanding' }
		])
	);
	const { slips, warnings } = buildStatutory(
		scenario('2026-04', [
			{ key: 'ID-UNREG', wage: 10_000_000, registrations: unregistered },
			{ key: 'ID-REG', wage: 10_000_000 }
		])
	);
	const unreg = charges(slips.get('ID-UNREG')!);
	const reg = charges(slips.get('ID-REG')!);
	// Hand computation on the 10,000,000 monthly wage, DKI Jakarta, JKK group II:
	// JHT 2% = 200,000 / 3.7% = 370,000 (PP 46/2015 art.16); JKK 0.54% = 54,000 and JKM 0.30% =
	// 30,000, employer only (PP 44/2015 arts.16, 18); Kesehatan 1% = 100,000 / 4% = 400,000, under
	// the 12,000,000 ceiling and above the DKI UMP floor (Perpres 82/2018 arts.30, 32).
	for (const charge of [unreg, reg]) {
		assert.deepEqual(charge.JHT, [200_000, 370_000]);
		assert.deepEqual(charge.JKK, [0, 54_000]);
		assert.deepEqual(charge.JKM, [0, 30_000]);
		assert.deepEqual(charge.KESEHATAN, [100_000, 400_000]);
	}
	// JP 1% / 2% of 10,000,000 = 100,000 / 200,000, under the Rp11,086,300 ceiling (art.29).
	for (const charge of [unreg, reg]) assert.deepEqual(charge.JP, [100_000, 200_000]);
	for (const code of ['JHT', 'JP', 'JKK', 'JKM', 'KESEHATAN'])
		assert.ok(
			warnings.some((line) => line.includes(`${code}: registration incomplete`)),
			`${code} warns that registration is outstanding`
		);
});

test('Indonesia — a missing tax registration does not waive PPh 26 (UU PPh arts.21(5a), 26(1); R46)', () => {
	// The payer withholds; a recipient without an NPWP is answered with a higher rate (art.21(5a)),
	// never with no tax. Same non-resident as the regular-wage PPh 26 golden: gross 20,648,000 × 20%
	// = 4,129,600, now with the PPh 26 record NOT_REGISTERED.
	const { slips, warnings } = buildStatutory(
		scenario('2026-04', [
			{
				key: 'ID-NR-UNREG',
				wage: 20_000_000,
				tax_residency: 'NON_RESIDENT',
				citizenship: 'FOREIGNER',
				registrations: {
					JP: { kind: 'NOT_REGISTERED' },
					PPH26: { kind: 'NOT_REGISTERED', reason: 'No tax identity on file' }
				}
			}
		])
	);
	assert.deepEqual(charges(slips.get('ID-NR-UNREG')!).PPH26, [4_129_600, 0]);
	assert.ok(warnings.some((line) => line.includes('PPH26: registration incomplete')));
});

test('Indonesia — a recipient outside an employment relationship owes no BPJS premium (PP 44/2015 art.5)', () => {
	// PP 44/2015 art.5(2)–(3) and PP 46/2015 art.4(2)–(3): a worker outside an employment
	// relationship is a non-wage-earning participant who registers and pays himself (PP 44/2015
	// art.11(1)); Perpres 82/2018 art.13(1) binds the employer only for its Pekerja. A PMK 168/2023
	// bukan pegawai paid 10,000,000 for services: no BPJS line; PPh 21 on 50% of gross at 5% =
	// 250,000 (PMK 168/2023 art.12(4)).
	const { slips } = buildStatutory(
		scenario('2026-04', [
			{
				key: 'ID-SERVICE',
				wage: 10_000_000,
				registrations: {
					PPH21: {
						kind: 'REGISTERED',
						elections: { recipient_class: 'NON_EMPLOYEE', service_kind: 'OTHER', no_tax_id: false }
					}
				}
			}
		])
	);
	const charge = charges(slips.get('ID-SERVICE')!);
	for (const code of ['JHT', 'JKK', 'JKM', 'KESEHATAN'])
		assert.ok(charge[code] == null || (charge[code][0] === 0 && charge[code][1] === 0), code);
	assert.deepEqual(charge.PPH21, [250_000, 0]);
});

test('Indonesia — PP 68/2009 art.4: the 15% and 25% severance bands', () => {
	// Ten years' service ending 31 January 2026, redundancy to prevent losses (PP 35/2021 art.43(1)
	// whole award): pesangon 9 months (art.40(2)(i), eight years or more) and UPMK 4 months
	// (art.40(3)(c), nine to under twelve years).
	const { slips } = buildStatutory(
		scenario('2026-01', [
			{
				key: 'ID-SEV-50M',
				wage: 50_000_000,
				hire_date: '2016-01-04',
				exit_date: '2026-01-31',
				exit_reason: 'REDUNDANCY'
			},
			{
				key: 'ID-SEV-20M',
				wage: 20_000_000,
				hire_date: '2016-01-04',
				exit_date: '2026-01-31',
				exit_reason: 'REDUNDANCY'
			}
		]),
		(world) => {
			for (const key of ['ID-SEV-50M', 'ID-SEV-20M'])
				separationLines(world, key, '2026-01', '2026-01-31', ['PESANGON', 'UPMK']);
		}
	);
	const final = (key: string) => charges(slips.get(key)!).PPH21_FINAL_SEVERANCE;
	// 450,000,000 + 200,000,000 = 650,000,000: 0% of 50,000,000, 5% of 50,000,000 = 2,500,000,
	// 15% of 400,000,000 = 60,000,000, 25% of 150,000,000 = 37,500,000 → 100,000,000.
	assert.equal(paidLine(slips.get('ID-SEV-50M')!, 'PESANGON'), 450_000_000);
	assert.equal(paidLine(slips.get('ID-SEV-50M')!, 'UPMK'), 200_000_000);
	assert.deepEqual(final('ID-SEV-50M'), [100_000_000, 0]);
	// 180,000,000 + 80,000,000 = 260,000,000: 2,500,000 + 15% of 160,000,000 = 24,000,000 →
	// 26,500,000.
	assert.deepEqual(final('ID-SEV-20M'), [26_500_000, 0]);
});

test('Indonesia — PP 68/2009 art.2(2): a later severance payment in the same year joins the bands of the first', () => {
	// Pesangon 5 months and UPMK 2 months at 10,000,000 (four years' service) = 70,000,000, paid in
	// March 2026 after 40,000,000 of separation pay was already paid, and withheld at 0%, in
	// February. Payments within two calendar years count as paid at once: 110,000,000 cumulative →
	// 2,500,000 + 15% of 10,000,000 = 4,000,000, less the 0 already withheld. Alone, the March
	// payment would have carried 1,000,000.
	const build = (withPrior: boolean) =>
		buildStatutory(
			scenario('2026-03', [
				{
					key: 'ID-SEV-SPLIT',
					wage: 10_000_000,
					hire_date: '2021-12-15',
					exit_date: '2026-03-31',
					exit_reason: 'REDUNDANCY'
				}
			]),
			(world) => {
				separationLines(world, 'ID-SEV-SPLIT', '2026-03', '2026-03-31', ['PESANGON', 'UPMK']);
				if (!withPrior) return;
				const employment = world.employments[0]!;
				world.payroll_runs.push({
					id: 'prior-2026-02-sev',
					company_id: COMPANY_ID,
					period: '2026-02'
				});
				world.payslips.push({
					id: 'payslip-2026-02-sev',
					payroll_run_id: 'prior-2026-02-sev',
					employment_id: employment.id,
					status: 'PAID',
					paid_at: '2026-02-27T00:00:00.000Z',
					currency: 'IDR',
					base: [],
					adjustments: [],
					statutory: [
						{
							scheme_code: 'PPH21_FINAL_SEVERANCE',
							employee_amount: 0,
							employer_amount: 0,
							base_amount: 40_000_000,
							rule_when: null,
							authority: null
						}
					]
				});
			}
		).slips.get('ID-SEV-SPLIT')!;
	assert.deepEqual(charges(build(false)).PPH21_FINAL_SEVERANCE, [1_000_000, 0]);
	assert.deepEqual(charges(build(true)).PPH21_FINAL_SEVERANCE, [4_000_000, 0]);
});

test('Indonesia — PP 68/2009 art.2(2): a part paid in the next calendar year joins the first year’s bands', () => {
	// Art.2(2) and its elucidation: parts paid within two calendar years are one payment "dan
	// dihitung sebagai satu kesatuan untuk pengenaan pajaknya". 40,000,000 paid in December 2025
	// and withheld at 0% (art.4(a)); 70,000,000 paid in January 2026. Together 110,000,000 →
	// 0 + 5% of 50,000,000 + 15% of 10,000,000 = 4,000,000, less the 0 withheld in 2025 →
	// 4,000,000 in January (`scheme.last_year`); alone, January would carry 5% of 20,000,000 = 1,000,000.
	const slip = buildStatutory(
		scenario('2026-01', [
			{
				key: 'ID-SEV-XYEAR',
				wage: 10_000_000,
				hire_date: '2021-12-15',
				exit_date: '2026-01-31',
				exit_reason: 'REDUNDANCY'
			}
		]),
		(world) => {
			separationLines(world, 'ID-SEV-XYEAR', '2026-01', '2026-01-31', ['PESANGON', 'UPMK']);
			const employment = world.employments[0]!;
			world.payroll_runs.push({
				id: 'prior-2025-12-sev',
				company_id: COMPANY_ID,
				period: '2025-12'
			});
			world.payslips.push({
				id: 'payslip-2025-12-sev',
				payroll_run_id: 'prior-2025-12-sev',
				employment_id: employment.id,
				status: 'PAID',
				paid_at: '2025-12-29T00:00:00.000Z',
				currency: 'IDR',
				base: [],
				adjustments: [],
				statutory: [
					{
						scheme_code: 'PPH21_FINAL_SEVERANCE',
						employee_amount: 0,
						employer_amount: 0,
						base_amount: 40_000_000,
						rule_when: null,
						authority: null
					}
				]
			});
		}
	).slips.get('ID-SEV-XYEAR')!;
	assert.deepEqual(charges(slip).PPH21_FINAL_SEVERANCE, [4_000_000, 0]);
});

test('Indonesia — PP 68/2009 art.6: a part paid in the third calendar year is PPh 21 at the art.17(1)(a) rates on its gross, not final', () => {
	// Art.6(1): a part of a severance paid "pada tahun ketiga dan tahun-tahun berikutnya" is withheld
	// at the UU PPh art.17(1)(a) rates on the gross of that calendar year; (2) it is not final and is
	// creditable; (3) art.21(5a)'s 120% applies without an NPWP. Leaver of 31 December 2025 with four
	// years' service at 25,000,000: UPMK 2 months (PP 35/2021 art.40(3)(a)) = 50,000,000, paid in
	// March 2027 — the third calendar year after a 2025 part of 100,000,000 (0% + 5% of 50,000,000 =
	// 2,500,000 final) and a 2026 part of 30,000,000. Only this part is paid in 2027, the
	// elucidation's case: 5% × 50,000,000 = 2,500,000 (UU 7/2021 keeps 5% to 60,000,000), and
	// 120% × 5% × 50,000,000 = 3,000,000 without an NPWP. Joined to 2025 in the final bands, it
	// would have carried 5% of 30,000,000 = 1,500,000.
	const build = (noTaxId: boolean) =>
		buildStatutory(
			scenario('2027-03', [
				{
					key: 'ID-SEV-Y3',
					wage: 25_000_000,
					hire_date: '2021-11-01',
					exit_date: '2025-12-31',
					exit_reason: 'REDUNDANCY',
					registrations: {
						PPH21_FINAL_SEVERANCE: { kind: 'REGISTERED', elections: { no_tax_id: noTaxId } }
					}
				}
			]),
			(world) => {
				// The award is priced by the catalogue of the final service day, and paid in March 2027.
				separationLines(world, 'ID-SEV-Y3', '2025-12', '2025-12-31', ['UPMK']);
				world.adhoc_requests!.at(-1)!.pay_period = '2027-03';
				const employment = world.employments[0]!;
				for (const [period, paidAt, base, employee] of [
					['2025-12', '2025-12-29', 100_000_000, 2_500_000],
					['2026-06', '2026-06-26', 30_000_000, 0]
				] as const) {
					world.payroll_runs.push({ id: `prior-${period}-sev`, company_id: COMPANY_ID, period });
					world.payslips.push({
						id: `payslip-${period}-sev`,
						payroll_run_id: `prior-${period}-sev`,
						employment_id: employment.id,
						status: 'PAID',
						paid_at: `${paidAt}T00:00:00.000Z`,
						currency: 'IDR',
						base: [],
						adjustments: [],
						statutory: [
							{
								scheme_code: 'PPH21_FINAL_SEVERANCE',
								employee_amount: employee,
								employer_amount: 0,
								base_amount: base,
								rule_when: null,
								authority: null
							}
						]
					});
				}
			}
		).slips.get('ID-SEV-Y3')!;
	const withId = build(false);
	assert.equal(paidLine(withId, 'UPMK'), 50_000_000);
	assert.deepEqual(charges(withId).PPH21_FINAL_SEVERANCE, [2_500_000, 0]);
	assert.deepEqual(charges(build(true)).PPH21_FINAL_SEVERANCE, [3_000_000, 0]);
});

test('Indonesia — a non-resident’s severance is PPh 26 at 20% of gross, not PP 68/2009 (art.1 angka 3)', () => {
	// PP 68/2009 art.1 angka 3: its "Pegawai" is a resident individual. A non-resident's
	// separation pay is income of a permanent employee under any name (PMK 168/2023 art.5(1)) and
	// is withheld at 20% of gross (arts.12(9), 14(1)). Five years' service at 30,000,000 ending
	// 30 April 2026: pesangon 6 months = 180,000,000 (PP 35/2021 art.40(2)(f)), UPMK 2 months =
	// 60,000,000 (art.40(3)(a)). Gross = 30,000,000 + 240,000,000 + JKK 0.54% 162,000 + JKM 0.30%
	// 90,000 + Kesehatan 4% of the 12,000,000 cap 480,000 = 270,732,000 → 20% = 54,146,400.
	const { slips } = buildStatutory(
		scenario('2026-04', [
			{
				key: 'ID-NR-SEV',
				wage: 30_000_000,
				hire_date: '2021-01-04',
				exit_date: '2026-04-30',
				exit_reason: 'REDUNDANCY',
				tax_residency: 'NON_RESIDENT',
				citizenship: 'FOREIGNER'
			}
		]),
		(world) => separationLines(world, 'ID-NR-SEV', '2026-04', '2026-04-30', ['PESANGON', 'UPMK'])
	);
	const slip = slips.get('ID-NR-SEV')!;
	assert.equal(paidLine(slip, 'PESANGON'), 180_000_000);
	assert.equal(paidLine(slip, 'UPMK'), 60_000_000);
	const charge = charges(slip);
	assert.deepEqual(charge.PPH26, [54_146_400, 0]);
	assert.ok(
		charge.PPH21_FINAL_SEVERANCE == null || charge.PPH21_FINAL_SEVERANCE[0] === 0,
		'PP 68/2009 does not reach a non-resident'
	);
});

test('Indonesia — THR is paid whole and once a year: an instalment is refused (Permenaker 6/2016 art.5(1); SE M/3/HK.04.00/III/2026 item 7)', () => {
	const thrWorld = (amounts: readonly number[]) =>
		buildStatutory(scenario('2026-03', [{ key: 'ID-THR', wage: 10_000_000 }]), (world) => {
			for (const [index, amount] of amounts.entries())
				world.adhoc_requests!.push({
					id: `a1a1a1a1-0000-4000-8000-0000000009${index}0`,
					employment_id: world.employments[0]!.id,
					catalogue_id: THR_ID,
					amount,
					event_date: '2026-03-01',
					pay_period: null,
					payslip_id: null,
					reason: 'THR 2026',
					evidence_file: null,
					as_adjustment_entry: false,
					approval_id: null
				});
		});
	// Permenaker 6/2016 art.3(1)(a): twelve months' service or more is one month's wage, whatever
	// amount the request was keyed at — half keyed, the whole paid.
	assert.deepEqual(
		thrWorld([5_000_000])
			.slips.get('ID-THR')!
			.adjustments.filter((row) => row.component_code === 'THR')
			.map((row) => row.amount),
		[10_000_000]
	);
	// A second request in the year — a second instalment — is not a second THR.
	assert.throws(() => thrWorld([5_000_000, 5_000_000]), /THR entitlement exceeded/);
	// The keyed figure is not the THR: two requests keyed at 0 are each priced by the band at
	// 10,000,000 (art.3(1)(a)), so the second is a second THR in the year and is refused
	// (art.5(1); SE M/3/HK.04.00/III/2026 item 7).
	assert.throws(() => thrWorld([0, 0]), /THR entitlement exceeded/);
});

test('Indonesia — the same religious holiday twice in one year carries a THR for each (Permenaker 6/2016 art.5(2))', () => {
	// Art.5(1): THR once a year; art.5(2): where the same religious holiday falls more than once in
	// a year, THR is given for each occurrence. Idul Fitri moves about eleven days earlier each
	// year, so a year opening and closing on it has two; no SKB in this version's range does, so
	// the two ISLAM-tagged days below are a synthetic calendar, not SKB dates. They fall outside
	// March, so they price no holiday work in this run. Twelve months' service: one THR is one
	// month's wage, 10,000,000 (art.3(1)(a)); the ceiling is two of them.
	const thrWorld = (religion: string, count: number) =>
		buildStatutory(
			scenario('2026-03', [{ key: 'ID-THR2', wage: 10_000_000, religion }]),
			(world) => {
				for (const date of ['2026-01-02', '2026-12-22'])
					world.jurisdiction_holidays.push({
						id: `holiday-${date}`,
						company_id: COMPANY_ID,
						date,
						name: 'Idul Fitri (synthetic)',
						religion: 'ISLAM',
						replaces: null,
						source: null,
						published_at: '2025-12-01T00:00:00.000Z',
						approval_id: null
					});
				for (let index = 0; index < count; index += 1)
					world.adhoc_requests!.push({
						id: `a1a1a1a1-0000-4000-8000-0000000019${index}0`,
						employment_id: world.employments[0]!.id,
						catalogue_id: THR_ID,
						amount: 0,
						event_date: '2026-03-01',
						pay_period: null,
						payslip_id: null,
						reason: 'THR 2026',
						evidence_file: null,
						as_adjustment_entry: false,
						approval_id: null
					});
			}
		);
	assert.deepEqual(
		thrWorld('ISLAM', 2)
			.slips.get('ID-THR2')!
			.adjustments.filter((row) => row.component_code === 'THR')
			.map((row) => row.amount),
		[10_000_000, 10_000_000]
	);
	// A third is not an occurrence: 30,000,000 against 20,000,000.
	assert.throws(() => thrWorld('ISLAM', 3), /THR entitlement exceeded/);
	// The days are Idul Fitri's; a Christian's own holiday (Natal) falls once, so a second is refused.
	assert.throws(() => thrWorld('CHRISTIAN', 2), /THR entitlement exceeded/);
});

test('Indonesia — the December reckoning deducts zakat paid through the employer (PMK 168/2023 art.10(1)(c))', () => {
	// The December golden above, with 200,000 a month of zakat withheld and paid through the
	// employer to a government-approved BAZNAS body, declared as ZAKAT deduction claims: PKP =
	// 115,686,422 − 2,400,000 = 113,286,422 → 113,286,000 (art.8(4), down to the whole thousand).
	// Annual tax 5% × 60,000,000 + 15% × 53,286,000 = 10,992,900; December = 10,992,900 − the
	// 9,900,000 the TER withheld = 1,092,900 (1,452,900 without the zakat).
	const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11'].map(
		(month) => `2026-${month}`
	);
	const { slips } = buildStatutory(
		scenario('2026-12', [
			{
				key: 'ID-ZAKAT',
				wage: 15_000_000,
				marital_status: 'SINGLE',
				children: 0,
				registrations: {
					PPH21: {
						kind: 'REGISTERED',
						deduction_claims: [...months, '2026-12'].map((period) => ({
							period,
							category: 'ZAKAT',
							amount: 200_000,
							source: 'EMPLOYEE' as const,
							reference: `BAZNAS-${period}`
						}))
					}
				}
			},
			{ key: 'ID-NO-ZAKAT', wage: 15_000_000, marital_status: 'SINGLE', children: 0 }
		]),
		(world) => {
			for (const key of ['ID-ZAKAT', 'ID-NO-ZAKAT']) {
				priorSlips(
					world,
					key,
					months
						.filter((period) => period < '2026-03')
						.map((period) => ({
							period,
							gross: 15_000_000,
							pph21: 900_000,
							jp: 105_474,
							jht: 300_000
						}))
				);
				priorSlips(
					world,
					key,
					months
						.filter((period) => period >= '2026-03')
						.map((period) => ({
							period,
							gross: 15_000_000,
							pph21: 900_000,
							jp: 110_863,
							jht: 300_000
						}))
				);
			}
		}
	);
	assert.deepEqual(charges(slips.get('ID-NO-ZAKAT')!).PPH21, [1_452_900, 0]);
	assert.deepEqual(charges(slips.get('ID-ZAKAT')!).PPH21, [1_092_900, 0]);
});

test('Indonesia — PKWT profile: the art.15 compensation at the end of a one-year term, none to a foreign worker (PP 35/2021 arts.15(5), 16(1))', () => {
	// A PKWT of 1 July 2025 to 30 June 2026 at 8,000,000: twelve months' service is one month's
	// wage, 8,000,000 (art.16(1)(a)), inside PP 68/2009's 0% band (art.4(a)). Art.15(5): a foreign
	// worker under a PKWT is not owed it.
	const { slips } = buildStatutory(
		scenario('2026-06', [
			{
				key: 'ID-PKWT',
				wage: 8_000_000,
				employment_type: 'CONTRACT',
				hire_date: '2025-07-01',
				exit_date: '2026-06-30',
				exit_reason: 'CONTRACT_END'
			},
			{
				key: 'ID-PKWT-TKA',
				wage: 8_000_000,
				employment_type: 'CONTRACT',
				citizenship: 'FOREIGNER',
				hire_date: '2025-07-01',
				exit_date: '2026-06-30',
				exit_reason: 'CONTRACT_END'
			}
		]),
		(world) => {
			for (const key of ['ID-PKWT', 'ID-PKWT-TKA'])
				separationLines(world, key, '2026-06', '2026-06-30', ['PKWT_COMPENSATION'], null);
		}
	);
	assert.equal(paidLine(slips.get('ID-PKWT')!, 'PKWT_COMPENSATION'), 8_000_000);
	assert.equal(paidLine(slips.get('ID-PKWT-TKA')!, 'PKWT_COMPENSATION') ?? 0, 0);
	assert.deepEqual(charges(slips.get('ID-PKWT')!).PPH21_FINAL_SEVERANCE, [0, 0]);
});

test('Indonesia — UMP 2026 by province: the Kesehatan floor in a workplace with no UMK (Perpres 82/2018 art.32(3))', () => {
	// A wage of 2,000,000 is below every 2026 UMP, so the art.32(2) floor lifts the base to it.
	const kesehatan = (region: string, period = '2026-04') =>
		assessStatutoryUnvalidated({
			...scenario(period, [{ key: 'ID-UMP', wage: 2_000_000 }]),
			region
		});
	// Bengkulu, Kep. Gubernur K.646.DKKTRANS Tahun 2025: Rp2,827,250.90 — 1% = 28,272.51 → 28,273;
	// 4% = 113,090.04 → 113,090.
	expectStatutory(kesehatan('Provinsi Bengkulu'), 'ID-UMP', 'KESEHATAN', 28_273, 113_090);
	// Banten, Kep. Gubernur 701/2025: Rp3,100,881.40 — 31,008.81 → 31,009; 124,035.26 → 124,035.
	expectStatutory(kesehatan('Provinsi Banten'), 'ID-UMP', 'KESEHATAN', 31_009, 124_035);
	// Aceh, Kep. Gubernur 500.15.14.1/1488/2025: Rp3,932,552 — 39,325.52 → 39,326; 157,302.08 →
	// 157,302. The same figure on the 1 January version.
	expectStatutory(kesehatan('Provinsi Aceh'), 'ID-UMP', 'KESEHATAN', 39_326, 157_302);
	expectStatutory(kesehatan('Provinsi Aceh', '2026-02'), 'ID-UMP', 'KESEHATAN', 39_326, 157_302);
	// Sulawesi Selatan, Kep. Gubernur 2129/XII/TAHUN 2025 diktum KESATU: Rp3,921,088.79 —
	// 39,210.8879 → 39,211; 156,843.5516 → 156,844. The sen is the decree's, not a press rounding.
	expectStatutory(kesehatan('Provinsi Sulawesi Selatan'), 'ID-UMP', 'KESEHATAN', 39_211, 156_844);
	// Bangka Belitung, Kep. Gubernur 100.3.3.1/…/DISNAKER/2025 diktum KEDUA: Rp4,035,000 —
	// 40,350; 161,400.
	expectStatutory(
		kesehatan('Provinsi Kepulauan Bangka Belitung'),
		'ID-UMP',
		'KESEHATAN',
		40_350,
		161_400
	);
	// December 2025 prices the 2025 UMP, not the 2026 one. Banten 2025 Rp2,905,119.90 (Pemprov
	// Banten): 29,051.199 → 29,051; 116,204.796 → 116,205. Sulawesi Tenggara 2025 Rp3,073,551.70
	// (Kep. Gubernur 100.3.3.1/470 Tahun 2024): 30,735.517 → 30,736; 122,942.068 → 122,942.
	expectStatutory(kesehatan('Provinsi Banten', '2025-12'), 'ID-UMP', 'KESEHATAN', 29_051, 116_205);
	expectStatutory(
		kesehatan('Provinsi Sulawesi Tenggara', '2025-12'),
		'ID-UMP',
		'KESEHATAN',
		30_736,
		122_942
	);
	// Nusa Tenggara Timur 2025, Kep. Gubernur NTT 430/KEP/HK/2024 (Biro Adpim NTT, 12 Dec 2024):
	// Rp2,328,969.69 — 23,289.6969 → 23,290; 93,158.7876 → 93,159.
	expectStatutory(
		kesehatan('Provinsi Nusa Tenggara Timur', '2025-12'),
		'ID-UMP',
		'KESEHATAN',
		23_290,
		93_159
	);
	// A province whose decree was not read has no floor, and refuses by name rather than charging
	// a guessed one: Papua Selatan in 2026, Aceh in December 2025, Sulawesi Tengah in 2026 (only its
	// 2025 figure is seeded) and Nusa Tenggara Timur in 2026 (its 2026 sen is unread).
	for (const [region, period] of [
		['Provinsi Nusa Tenggara Timur', '2026-04'],
		['Provinsi Papua Selatan', '2026-04'],
		['Provinsi Aceh', '2025-12'],
		['Provinsi Sulawesi Tengah', '2026-04']
	] as const)
		assert.throws(
			() => kesehatan(region, period),
			/KESEHATAN bounds its base by the regional minimum wage/
		);
});

test('Indonesia — the minimum-wage comparison holds a fractional UMP to the sen, never a rounded rupiah (ID-127)', () => {
	// Owner rule 2026-09-28 (ID-127): only PKP rounding is prescribed (UU PPh art.17(4), PMK 168/2023
	// art.8(4)); a floor the decree states in sen is compared in sen. Sulawesi Selatan, Kep. Gubernur
	// 2129/XII/TAHUN 2025 diktum KESATU: Rp3,921,088.79. A contract at the floor is lawful; one sen
	// under it, or the floor rounded down to the rupiah, is below it.
	const below = (region: string, wages: ReadonlyArray<readonly [string, number]>) =>
		buildStatutory({
			...scenario(
				'2026-04',
				wages.map(([key, wage]) => ({ key, wage }))
			),
			region
		})
			.warnings.filter((warning) => warning.startsWith('MINIMUM_WAGE_BELOW:'))
			.map((warning) => warning.split(' ')[1]);
	assert.deepEqual(
		below('Provinsi Sulawesi Selatan', [
			['SS-AT', 3_921_088.79],
			['SS-SEN', 3_921_088.78],
			['SS-RP', 3_921_088]
		]),
		['SS-SEN', 'SS-RP']
	);
	// Central Java, Kep.100.3.3.1/505/2025 Lampiran I (signed 24 Dec 2025, from 1 Jan 2026): the
	// Kabupaten Banyumas UMK Rp2,474,598.99, compared at the decree's precision. The province's UMP
	// (Kep.100.3.3.1/504/2025, Rp2,327,386.07) is not seeded: every Central Java regency and city
	// has a higher UMK, so a province key would floor a workplace below its own UMK.
	assert.deepEqual(
		below('Provinsi Jawa Tengah/Kabupaten Banyumas', [
			['JT-AT', 2_474_598.99],
			['JT-RP', 2_474_598]
		]),
		['JT-RP']
	);
});

test('Indonesia — the monthly floor is the workplace’s, raised by the sector order that binds it (engine defect 6/20)', () => {
	// UU 13/2003 art.88C as amended by UU 6/2023: a UMK binds in its regency or city, the UMP
	// elsewhere in the province. Perpres 82/2018 art.32(2)–(3) as amended by Perpres 64/2020: the
	// Kesehatan base is floored at the UMK, the UMP where none is set — never a sector wage. April
	// 2026, the 1 March version; one company, whatever its own region.
	const book = (people: Parameters<typeof buildStatutory>[0]['people'], facts = {}) => ({
		...scenario('2026-04', people),
		companyFacts: facts
	});
	const below = (options: ReturnType<typeof book>) =>
		buildStatutory(options).warnings.filter((warning) => warning.startsWith('MINIMUM_WAGE_BELOW:'));
	// (1) Two West Java sites of one company (Kepgub Jabar 561.7/Kep.862-Kesra/2025): Kota Bekasi
	// Rp5,999,443 — 1% 59,994.43 → 59,994, 4% 239,977.72 → 239,978; Kabupaten Karawang Rp5,886,853
	// — 58,868.53 → 58,869, 235,474.12 → 235,474. Each site is held to its own UMK.
	const sites = book([
		{ key: 'BKS', wage: 2_000_000, worksite: 'Provinsi Jawa Barat/Kota Bekasi' },
		{ key: 'KRW', wage: 2_000_000, worksite: 'Provinsi Jawa Barat/Kabupaten Karawang' }
	]);
	expectStatutory(assessStatutory(sites), 'BKS', 'KESEHATAN', 59_994, 239_978);
	expectStatutory(assessStatutory(sites), 'KRW', 'KESEHATAN', 58_869, 235_474);
	assert.match(below(sites).join('\n'), /BKS .*\/Kota Bekasi minimum wage of 5999443/);
	assert.match(below(sites).join('\n'), /KRW .*\/Kabupaten Karawang minimum wage of 5886853/);
	// (2) DKI Kep. Gubernur 33 Tahun 2026 Lampiran A row 1: KBLI 10437 Rp5,741,201, for a worker
	// with less than one year's service (diktum KETIGA). The DKI UMP Rp5,729,876 is below it.
	const oil = (hire: string) =>
		book([
			{
				key: 'OIL',
				wage: 5_729_876,
				hire_date: hire,
				worksite: 'Provinsi DKI Jakarta',
				worksite_sector: '10437'
			}
		]);
	assert.match(below(oil('2026-01-01')).join('\n'), /OIL .* minimum wage of 5741201/);
	assert.deepEqual(below(oil('2015-01-01')), [], 'a year’s service is outside the sector order');
	// Kesehatan stays on the UMP: 1% 57,298.76 → 57,299, 4% 229,195.04 → 229,195.
	expectStatutory(assessStatutory(oil('2026-01-01')), 'OIL', 'KESEHATAN', 57_299, 229_195);
	// Row 10: KBLI 14111 Rp5,831,497, "EKSPOR" — only an exporting employer's.
	const garment = (exporter: boolean) =>
		below(
			book(
				[
					{
						key: 'GAR',
						wage: 5_800_000,
						hire_date: '2026-01-01',
						worksite: 'Provinsi DKI Jakarta',
						worksite_sector: '14111'
					}
				],
				{ umsp_export_oriented: exporter }
			)
		);
	assert.match(garment(true).join('\n'), /GAR .* minimum wage of 5831497/);
	assert.deepEqual(garment(false), []);
	// (3) Central Java, Kep.100.3.3.1/505/2025: Lampiran I Kota Semarang UMK Rp3,701,709 (1%
	// 37,017.09 → 37,017; 4% 148,068.36 → 148,068); Lampiran II Kabupaten Demak KBLI 30911
	// Rp3,137,685 over its UMK Rp3,122,805, for less than one year's service (diktum KETIGA).
	const central = book([
		{ key: 'SMG', wage: 2_000_000, worksite: 'Provinsi Jawa Tengah/Kota Semarang' },
		{
			key: 'DMK',
			wage: 3_130_000,
			hire_date: '2026-01-01',
			worksite: 'Provinsi Jawa Tengah/Kabupaten Demak',
			worksite_sector: '30911'
		},
		{ key: 'DMK-UMK', wage: 3_122_805, worksite: 'Provinsi Jawa Tengah/Kabupaten Demak' }
	]);
	expectStatutory(assessStatutory(central), 'SMG', 'KESEHATAN', 37_017, 148_068);
	assert.match(below(central).join('\n'), /DMK .* minimum wage of 3137685/);
	assert.ok(!below(central).some((warning) => warning.includes('DMK-UMK ')));
	// A bare province whose regencies and cities all carry a UMK names no floor.
	assert.throws(
		() => assessStatutory(book([{ key: 'JT', wage: 2_000_000, worksite: 'Provinsi Jawa Tengah' }])),
		/KESEHATAN bounds its base by the regional minimum wage/
	);
});

test('Indonesia — a labour-intensive employer’s JKK is halved through January 2026 (PP 7/2025, PP 36/2025; ID-52)', () => {
	// PP 7/2025 art.4(1): JKK cut by 50% to I 0.120%, II 0.270%, III 0.445%, IV 0.635%, V 0.870%;
	// art.10 February–July 2025, extended by PP 36/2025 art.10A through the January 2026 month.
	// DKI Jakarta, a 10,000,000 monthly wage (the JKK base has no ceiling).
	const jkk = (period: string, riskClass: string, relief: boolean) =>
		charges(
			buildStatutory({
				...scenario(period, [{ key: 'P', wage: 10_000_000 }]),
				riskClass,
				companyFacts: { jkk_padat_karya: relief }
			}).slips.get('P')!
		).JKK;
	assert.deepEqual(jkk('2025-12', 'II', true), [0, 27_000]); // 0.270% × 10,000,000
	assert.deepEqual(jkk('2026-01', 'I', true), [0, 12_000]); // 0.120%
	assert.deepEqual(jkk('2026-01', 'III', true), [0, 44_500]); // 0.445%
	assert.deepEqual(jkk('2026-01', 'V', true), [0, 87_000]); // 0.870%
	// The relief ends with the January 2026 month; an unverified employer never has it.
	assert.deepEqual(jkk('2026-02', 'I', true), [0, 24_000]); // PP 44/2015 art.16(1) 0.24%
	assert.deepEqual(jkk('2026-01', 'I', false), [0, 24_000]);
});

test('Indonesia — a non-resident’s regular wage is PPh 26 at 20% of gross, with no PPh 21 (UU PPh art.26(1))', () => {
	// UU 36/2008 art.26(1): remuneration for work paid to a non-resident individual is withheld at
	// 20% of the gross amount; PPh 21's biaya jabatan, PTKP and TER do not apply. A foreign national
	// on an open-ended contract (six months' work, PP 44/2015 art.1 angka 4) at 20,000,000 for all of
	// April 2026, JKK group II. No JP: a foreigner is charged JP only on a recorded registration
	// (PP 45/2015 art.3(1)). Gross = 20,000,000 + JKK 0.54% 108,000 + JKM 0.30% 60,000 + Kesehatan
	// 4% of the 12,000,000 cap 480,000 = 20,648,000 → 20% = 4,129,600. The employee's own JHT 2%
	// (400,000) is not deducted from a gross-basis tax.
	const { slips } = buildStatutory(
		scenario('2026-04', [
			{
				key: 'ID-NR',
				wage: 20_000_000,
				tax_residency: 'NON_RESIDENT',
				citizenship: 'FOREIGNER',
				registrations: { JP: { kind: 'NOT_REGISTERED' } }
			}
		])
	);
	const charge = charges(slips.get('ID-NR')!);
	assert.deepEqual(charge.PPH26, [4_129_600, 0]);
	assert.deepEqual(charge.JHT, [400_000, 740_000]);
	assert.deepEqual(charge.JKK, [0, 108_000]);
	assert.deepEqual(charge.JKM, [0, 60_000]);
	assert.deepEqual(charge.KESEHATAN, [120_000, 480_000]);
	assert.ok(charge.JP == null || (charge.JP[0] === 0 && charge.JP[1] === 0), 'no JP unregistered');
	assert.ok(charge.PPH21 == null || charge.PPH21[0] === 0, 'PPh 21 does not reach a non-resident');
});
