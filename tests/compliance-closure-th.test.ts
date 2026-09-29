/**
 * Compliance closure probes — Thailand (2026-09-29 pass).
 *
 * Each test closes one register row's named open probe with a saved input/output case:
 *
 * - TH-WORK-05 (docs/inventory/thailand.md): "probe THB18,000, 8h → THB75/h, OT 1.5× → THB112.50."
 *   LPA s.68: the hourly rate of a monthly wage is monthly ÷ (30 × normal daily hours).
 * - TH-SS-13: "probe salary 15,000 + OT 4,000 → base 15,000." Social Security Act s.5: the
 *   contributory wage is pay for normal working time; overtime is outside it.
 * - TH-WAGE-01: "probe all 16 base-rate groups." Notice 14 (17 June 2025, in force 1 July 2025):
 *   the Ministry's printed table, 77 provinces; the base rates are
 *   337/345/347/348/349/350/351/352/354/355/356/357/358/359/372/400.
 * - TH-WAGE-02: district overrides — Songkhla/Hat Yai THB380 over the province remainder.
 * - TH-WAGE-03: hotel type 3/4 and a service establishment owe THB400 in a low-rate province; a
 *   type 1 hotel (no sector) stays on the geographic rate in Bangkok and Yala. The hotel's legal
 *   type is the operator's declaration (`employment_terms.worksite_sector`); the probe prices each
 *   declared class, it does not derive it from room counts.
 *
 * Figures are the instruments' own; they are not read off the engine.
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

const TH = 'TH';
const citizen = (key: string, wage: number, extra: Record<string, unknown> = {}) => ({
	key,
	wage,
	citizenship: 'CITIZEN',
	tax_residency: 'RESIDENT',
	...extra
});
const daily = (key: string, wage: number, worksite: string, sector?: string) =>
	citizen(key, wage, {
		pay_frequency: 'DAILY',
		worksite,
		...(sector == null ? {} : { worksite_sector: sector })
	});
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code);
	assert.ok(row, `no ${code} row`);
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
/** The Thai timecard the goldens use: the midday hour timed; a long day takes 20 minutes first. */
const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	approvedHours: number
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const clock = (time: string) => `${date}T${time}:00+07:00`;
	const endMinute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5));
	const long = start === '09:00' && endMinute >= 20 * 60;
	const actualEnd = long
		? `${String(Math.floor((endMinute + 20) / 60)).padStart(2, '0')}:${String((endMinute + 20) % 60).padStart(2, '0')}`
		: end;
	const intervals =
		start === '09:00' && endMinute >= 14 * 60
			? [
					{ start: clock(start), end: clock('13:00') },
					{ start: clock('14:00'), end: clock(long ? '18:00' : end) },
					...(long ? [{ start: clock('18:20'), end: clock(actualEnd) }] : [])
				]
			: [{ start: clock(start), end: clock(end) }];
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: intervals,
		approved_overtime_hours: approvedHours,
		overtime_consented_at: `${date}T00:00:00+07:00`,
		approval_id: null
	});
};
const belowNotice14 = (world: PayrollWorld) => {
	for (const version of world.jurisdiction_settings)
		version.work_rules = {
			...version.work_rules,
			wages: { ...version.work_rules.wages, block_below_when: 'false' }
		};
};

test('TH-WORK-05 — THB18,000 a month is THB75 an hour: one planned overtime hour is THB112.50 (LPA s.68, s.61)', () => {
	// s.68: 18,000 ÷ (30 × 8) = 75. s.61: 75 × 1.5 = 112.50. Monday 5 January 2026, 09:00–19:00
	// with the midday hour timed: nine worked, one beyond the normal day.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-01', people: [citizen('TH-18K', 18_000)] },
		(world) => punch(world, 'TH-18K', '2026-01-05', '09:00', '19:00', 1)
	);
	const slip = slips.get('TH-18K')!;
	assert.deepEqual(workLines(slip), [['2026-01-05', 'OT-1.5X', 1, 112.5]]);
	assert.equal(slip.gross, 18_000 + 112.5);
});

test('TH-SS-13 — the s.5 contributory wage is the salary: 15,000 of salary plus 4,000 of overtime is a 15,000 SSO base', () => {
	// Social Security Act s.5 excludes overtime from the wage. 15,000 ÷ (30 × 8) = 62.50/hour;
	// one and a half times 62.50 is 93.75, so 4,000.00 of overtime is 40 planned hours on ten days
	// at four hours plus one day at two hours forty minutes (2⅔ × 93.75 = 250). Each planned day is
	// a saved clock at or beyond the plan; the base stays the salary.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-01', people: [citizen('TH-15K', 15_000)] },
		(world) => {
			const days = ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16'];
			for (const day of days) punch(world, 'TH-15K', `2026-01-${day}`, '09:00', '21:00', 4);
			punch(world, 'TH-15K', '2026-01-19', '09:00', '19:00', 8 / 3);
		}
	);
	const slip = slips.get('TH-15K')!;
	const overtime = workLines(slip).reduce((total, line) => total + line[3], 0);
	assert.equal(overtime, 4_000);
	assert.deepEqual(charge(slip, 'SSO'), [15_000, 750, 750]);
});

test('TH-WAGE-01 — every Notice 14 base-rate group blocks one satang below the day and pays the day', () => {
	// Notice 14's printed table: 77 provinces in 16 base-rate groups, plus the three district
	// overrides TH-WAGE-02 prices. The representative province for each group is named here.
	const groups: ReadonlyArray<readonly [string, number]> = [
		['Narathiwat', 337],
		['Nan', 345],
		['Amnat Charoen', 347],
		['Ang Thong', 348],
		['Bueng Kan', 349],
		['Lamphun', 350],
		['Chumphon', 351],
		['Buriram', 352],
		['Krabi', 354],
		['Nakhon Nayok', 355],
		['Lop Buri', 356],
		['Khon Kaen', 357],
		['Samut Songkhram', 358],
		['Nakhon Ratchasima', 359],
		['Nakhon Pathom', 372],
		['Bangkok', 400]
	];
	const version = settingsVersions(TH).find((row) => row.id === settingsIdOn(TH, '2026-02-10'))!;
	const table = (version.work_rules as { wages: { daily_by_worksite: Record<string, number> } })
		.wages.daily_by_worksite;
	const provinces = Object.entries(table).filter(([site]) => !site.includes('/'));
	assert.equal(provinces.length, 77);
	assert.deepEqual(
		[...new Set(provinces.map(([, rate]) => rate))].toSorted((a, b) => a - b),
		groups.map(([, rate]) => rate)
	);
	assert.deepEqual(
		Object.entries(table)
			.filter(([site]) => site.includes('/'))
			.map(([site]) => site),
		['Chiang Mai/Mueang Chiang Mai', 'Songkhla/Hat Yai', 'Surat Thani/Ko Samui']
	);
	const warnings = (people: ReturnType<typeof daily>[]) =>
		buildStatutory({ code: TH, period: '2026-02', people }).warnings.filter((line) =>
			line.startsWith('MINIMUM_WAGE_BELOW')
		);
	for (const [province, rate] of groups) {
		assert.equal(table[province], rate, `${province} carries the Notice 14 rate`);
		assert.deepEqual(warnings([daily(`AT-${rate}`, rate, province)]), []);
		assert.throws(
			() => warnings([daily(`BELOW-${rate}`, rate - 0.01, province)]),
			/of (337|345|347|348|349|350|351|352|354|355|356|357|358|359|372|400)/
		);
	}
});

test('TH-WAGE-02 — Songkhla/Hat Yai THB380 overrides the Songkhla remainder, and a bare province with a district refuses', () => {
	// Notice 14 cl.4(2)/cl.11: Hat Yai 380, the rest of Songkhla 352. A bare "Songkhla" names no
	// rate where a district has its own.
	const run = (people: ReturnType<typeof daily>[]) =>
		buildStatutory({ code: TH, period: '2026-02', people }).warnings.filter((line) =>
			line.startsWith('MINIMUM_WAGE_BELOW')
		);
	assert.deepEqual(run([daily('HAT-YAI-380', 380, 'Songkhla/Hat Yai')]), []);
	assert.throws(
		() => run([daily('HAT-YAI-379', 379, 'Songkhla/Hat Yai')]),
		/Songkhla\/Hat Yai daily minimum wage of 380/
	);
	assert.deepEqual(run([daily('SONGKHLA-352', 352, 'Songkhla/Mueang Songkhla')]), []);
	assert.throws(() => run([daily('SONGKHLA-BARE', 380, 'Songkhla')]), /record the worksite/);
});

test('TH-WAGE-03 — hotel type 3, type 4 and a service establishment owe THB400 in Yala; a type 1 hotel keeps the geographic rate', () => {
	// Notice 14 cl.2(1): hotels of type 2–4 nationwide 400; the signed notice adds service
	// establishments. Yala's geographic rate is 337, so 399 blocks; 400 pays. A type 1 hotel
	// records no sector and stays on 337.
	const run = (people: ReturnType<typeof daily>[]) =>
		buildStatutory({ code: TH, period: '2026-02', people }).warnings.filter((line) =>
			line.startsWith('MINIMUM_WAGE_BELOW')
		);
	for (const sector of ['HOTEL_TYPE_3', 'HOTEL_TYPE_4', 'SERVICE_ESTABLISHMENT']) {
		assert.deepEqual(run([daily(`${sector}-400`, 400, 'Yala/Mueang Yala', sector)]), []);
		assert.throws(
			() => run([daily(`${sector}-399`, 399, 'Yala/Mueang Yala', sector)]),
			new RegExp(`Yala/Mueang Yala ${sector} daily minimum wage of 400`)
		);
	}
	assert.deepEqual(run([daily('TYPE-1-YALA', 337, 'Yala/Mueang Yala')]), []);
	assert.throws(
		() => run([daily('TYPE-1-YALA-336', 336.99, 'Yala/Mueang Yala')]),
		/Yala\/Mueang Yala daily minimum wage of 337/
	);
	assert.deepEqual(run([daily('TYPE-1-BKK', 400, 'Bangkok')]), []);
});
