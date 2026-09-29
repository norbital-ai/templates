/**
 * Compliance closure probes — Vietnam (2026-09-29 pass).
 *
 * - VN-MW74-01 / VN-MW293-02 (docs/inventory/vietnam.md): "Each pair still needs a seed comparison
 *   probe." Decree 74/2024/NĐ-CP art.3 (1 July 2024 – 31 December 2025): monthly/hourly
 *   I 4,960,000/23,800; II 4,410,000/21,200; III 3,860,000/18,600; IV 3,450,000/16,600. Decree
 *   293/2025/NĐ-CP art.3 (1 January 2026): I 5,310,000/25,500; II 4,730,000/22,700;
 *   III 4,140,000/20,000; IV 3,700,000/17,800. The probe compares the sealed tables with the
 *   decrees and prices each monthly pair at the floor and one đồng below.
 * - VN-PRORATE-01: the owner rule 2026-09-28 defaults the divisor to the period's normal working
 *   days (`work_rules.proration` WORKING_DAYS). 22,000,000 hired 19 January 2026 worked ten of
 *   January's twenty-two working days: 22,000,000 × 10 ÷ 22 = 10,000,000.
 *
 * Figures are the decrees' own; they are not read off the engine.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildStatutory,
	settingsIdOn,
	settingsVersions,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	mealStart: string
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const at = (from: string, to: string) => ({
		start: `${date}T${from}:00+07:00`,
		end: `${date}T${to}:00+07:00`
	});
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [
			at(start, mealStart),
			at(`${String(Number(mealStart.slice(0, 2)) + 1).padStart(2, '0')}:${mealStart.slice(3)}`, end)
		],
		approval_id: null
	});
};
const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code);
	assert.ok(row, `no ${code} row`);
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};

const VN = 'VN';
const versions = [
	{
		period: '2025-12',
		day: '2025-12-15',
		decree: 'Nghị định 74/2024/NĐ-CP',
		regions: [
			['I', 4_960_000, 23_800],
			['II', 4_410_000, 21_200],
			['III', 3_860_000, 18_600],
			['IV', 3_450_000, 16_600]
		]
	},
	{
		period: '2026-01',
		day: '2026-01-15',
		decree: 'Nghị định 293/2025/NĐ-CP',
		regions: [
			['I', 5_310_000, 25_500],
			['II', 4_730_000, 22_700],
			['III', 4_140_000, 20_000],
			['IV', 3_700_000, 17_800]
		]
	}
] as const;

for (const { period, day, decree, regions } of versions)
	test(`VN-MW — ${decree} monthly and hourly pairs are sealed and each monthly floor blocks below it (${period})`, () => {
		const version = settingsVersions(VN).find((row) => row.id === settingsIdOn(VN, day))!;
		const wages = (
			version.work_rules as {
				wages: {
					by_region: Record<string, number>;
					hourly_by_region: Record<string, number>;
				};
			}
		).wages;
		for (const [region, monthly, hourly] of regions) {
			assert.equal(wages.by_region[region], monthly, `${decree} ${region} monthly`);
			assert.equal(wages.hourly_by_region[region], hourly, `${decree} ${region} hourly`);
			const warnings = (wage: number) =>
				buildStatutory({
					code: VN,
					period,
					region,
					people: [{ key: `VN-${region}-${wage}`, wage, citizenship: 'CITIZEN' }]
				}).warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW'));
			assert.deepEqual(warnings(monthly), []);
			assert.throws(() => warnings(monthly - 1), /MINIMUM_WAGE_BELOW/);
		}
	});

test('VN-PRORATE-01 — the default divisor is the period’s normal working days (22,000,000 × 10 ÷ 22)', () => {
	// Labour Code art.97 and Decree 145/2020 art.55 name no divisor; the owner rule defaults to the
	// version's `proration` WORKING_DAYS. January 2026 holds 22 working days; a 19 January joiner
	// worked ten of them.
	const { slips } = buildStatutory({
		code: VN,
		period: '2026-01',
		region: 'I',
		people: [
			{ key: 'VN-PRORATE', wage: 22_000_000, citizenship: 'CITIZEN', hire_date: '2026-01-19' }
		]
	});
	const basic = slips
		.get('VN-PRORATE')!
		.proration.filter((row) => row.component_code === 'BASIC')
		.map((row) => [row.days, row.denominator, row.prorated_amount]);
	assert.deepEqual(basic, [[10, 22, 10_000_000]]);
});

test('VN-PIT-09 — the December 2025 OT exemption is premium-only; from the 2026 tax year the whole OT wage is outside PIT', () => {
	// Law 04/2007 art.4(9) exempted only the part above the ordinary rate; Law 109/2025 art.4(8),
	// in force for salary income "từ kỳ tính thuế năm 2026" (art.29(2)), exempts the overtime wage
	// whole. Same facts both months: 18,400,000 a month, a Monday two hours past the normal day at
	// 150%, the midday hour timed.
	const run = (period: string, date: string) =>
		buildStatutory(
			{
				code: VN,
				period,
				region: 'I',
				people: [{ key: 'VN-OT-CMP', wage: 18_400_000, citizenship: 'CITIZEN' }]
			},
			(world) => punch(world, 'VN-OT-CMP', date, '09:00', '20:00', '13:00')
		).slips.get('VN-OT-CMP')!;
	const december = run('2025-12', '2025-12-08');
	// 18,400,000 ÷ 23 ÷ 8 = 100,000 an hour; 2 × 1.5 × 100,000 = 300,000, of which the 200,000 at
	// the ordinary rate is taxable (Circular 111/2013 art.3(1)(i)). Base 18,600,000.
	assert.deepEqual(charge(december, 'PIT'), [18_600_000, 316_800, 0]);
	const january = run('2026-01', '2026-01-12');
	// The whole 300,000-and-up overtime line is outside the base: 18,400,000 − 1,932,000 insurance
	// − 15,500,000 (Resolution 110/2025) = 968,000 × 5% = 48,400.
	assert.equal(december.gross, 18_400_000 + 300_000);
	assert.ok(january.gross > 18_400_000);
	assert.deepEqual(charge(january, 'PIT'), [18_400_000, 48_400, 0]);
});
