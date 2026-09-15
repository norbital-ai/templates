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
	chargeOf,
	createStatutoryWorld,
	expectStatutory,
	assertEveryVersionPriced,
	COMPANY_ID
} from './fixtures/statutory-world.ts';
import { memoryPayrollApi } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/collections/payroll_runs/lib/engine.ts';

const ID_PEOPLE = [
	// Exactly the Kabupaten Bekasi UMK 2026: what five of the bank's sixteen contracts are paid.
	{ key: 'ID-UMK', wage: 5_938_885, age: 30, marital_status: 'SINGLE', children: 0 },
	{ key: 'ID-5M', wage: 5_000_000, age: 25, marital_status: 'SINGLE', children: 0 },
	{ key: 'ID-15M', wage: 15_000_000, marital_status: 'SINGLE', children: 0 },
	{ key: 'ID-25M', wage: 25_000_000, age: 55, marital_status: 'SINGLE', children: 0 },
	// K/3 — married with three dependent children — is TER category C.
	{ key: 'ID-C-15M', wage: 15_000_000, marital_status: 'MARRIED', children: 3 },
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
	expectStatutory(book, 'ID-BLANK-15M', 'PPH21', 900_000, 0);
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
	// 15,000,000 is in TER A bracket 13,750,001–15,100,000 at 6.00% → 900,000.
	expectStatutory(book, 'ID-15M', 'PPH21', 900_000, 0);
	// 25,000,000 is in TER A bracket 24,150,001–26,450,000 at 10.00% → 2,500,000.
	expectStatutory(book, 'ID-25M', 'PPH21', 2_500_000, 0);

	// TER C covers K/3 (PTKP 72,000,000).
	// 15,000,000 is in bracket 14,150,001–15,550,000 at 5.00% → 750,000.
	expectStatutory(book, 'ID-C-15M', 'PPH21', 750_000, 0);
	// 25,000,000 is in bracket 22,700,001–26,600,000 at 9.00% → 2,250,000.
	expectStatutory(book, 'ID-C-25M', 'PPH21', 2_250_000, 0);
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
	// TER A "5,400,001 – 5,650,000 → 0.25%": 0.25% × 5,400,000.01 = 13,500.00.
	expectStatutory(book, 'ID-5400000.01', 'PPH21', 13_500, 0);
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
	// JKK group II 0.40%, JKM 0.30% and the employer's 0.14% of JKP, all employer-borne.
	expectStatutory(book, 'ID-5M', 'JKK', 0, 27_000);
	expectStatutory(book, 'ID-5M', 'JKM', 0, 15_000);
	// JKP: PP 37/2021 Ps.11 as amended by PP 6/2025 recomposes the employer's share from JKK,
	// so the JKP line itself is 0/0 on this version too.
	expectStatutory(book, 'ID-5M', 'JKP', 0, 0);
	// PMK 168/2023 TER A: 5,000,000 is inside bracket 1 at 0.00%; 15,000,000 is in the
	// 13,750,001–15,100,000 bracket at 6.00% → 900,000.
	expectStatutory(book, 'ID-5M', 'PPH21', 0, 0);
	expectStatutory(book, 'ID-15M', 'PPH21', 900_000, 0);
});

test('every sealed version of `ID` is priced by a golden here', () => {
	// Not "are the numbers right" — the goldens above do that — but "was a version skipped". A
	// golden names its version through the period it runs, so a version sealed afterwards is priced
	// by nothing and stays green.
	assertEveryVersionPriced('ID');
});

// ─────────────────────────────────────────────────────────────────────────────
// THR (Permenaker 6/2016) — RFC 0005 §1.2, the first row of the obligation model.
//
// Due seven days before the religious holiday (Idul Fitri 2026-03-20 → 13 March): one month's wage
// after twelve months of continuous service, pro rata by completed months from one month, and
// "one month's wage" is the basic wage plus the fixed allowances (art. 3(2)). THR is income for
// PPh 21 and outside every BPJS base.
// ─────────────────────────────────────────────────────────────────────────────

const HOUSE_ALLOWANCE_ID = 'a1a1a1a1-0000-4000-8000-000000000001';

test('Indonesia — THR is a twelfth of the monthly wage per completed month, whole after a year', () => {
	const world = createStatutoryWorld({
		...idWorld('2026-03'),
		people: [
			{ key: 'ID-24M', wage: 10_000_000 },
			// Six completed months on 13 March 2026.
			{ key: 'ID-6M', wage: 12_000_000, hire_date: '2025-09-13' },
			// Under a month of service on the day.
			{ key: 'ID-NEW', wage: 12_000_000, hire_date: '2026-02-20' },
			// A standing house allowance is part of the wage THR is measured on.
			{ key: 'ID-FIXED', wage: 20_000_000 }
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
		recurring: true,
		prorates: false,
		on_day: null,
		bands: [{ when: '', amount: 'entry.amount', limit: null }],
		approval_id: null
	});
	const fixed = world.employments.find((row) => row.employee_number === 'ID-FIXED')!;
	world.allowance_requests.push({
		id: 'a1a1a1a1-0000-4000-8000-000000000002',
		employment_id: fixed.id,
		catalogue_id: HOUSE_ALLOWANCE_ID,
		amount: 5_000_000,
		recurrence: { kind: 'RECURRING', from: '2026-01-01', to: null },
		evidence_file: null,
		as_adjustment_entry: false,
		derived_from_id: null,
		payslip_id: null,
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
	assert.deepEqual(slip('ID-6M').thr, [6_000_000]);
	assert.deepEqual(slip('ID-NEW').thr, []);
	assert.deepEqual(slip('ID-FIXED').thr, [25_000_000]);
	// PPh 21 is on gross, THR included; the BPJS bases are the wage alone.
	assert.equal(slip('ID-24M').base('PPH21'), 20_000_000);
	assert.equal(slip('ID-24M').base('JHT'), 10_000_000);
	assert.equal(slip('ID-FIXED').base('PPH21'), 50_000_000);
	// The open-ended standing allowance is paid as a March slice; the source row itself is never
	// pinned, so April cuts its own slice (a pinned source paid January alone on the host).
	const fixedSlip = slips.find((row) => String(row.employment_id) === fixed.id)!;
	const capture = built.captures.find((row) => row.payslipId === fixedSlip.id)!;
	assert.deepEqual(capture.allowances, []);
	assert.deepEqual(
		capture.materialised
			.filter((row) => row.collection === 'allowance_requests')
			.map((row) => [row.values.amount, row.values.recurrence]),
		[[5_000_000, { kind: 'RECURRING', from: '2026-03-01', to: '2026-03-31' }]]
	);
});
