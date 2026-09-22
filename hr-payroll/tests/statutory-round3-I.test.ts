/**
 * Round 3, letter I — what an overtime ceiling counts, this month and in the months before it.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 * Vietnam — Labour Code 2019 (Law 45/2019/QH14) and Decree 145/2020/NĐ-CP:
 *   art.107(1)  "Thời gian làm thêm giờ là khoảng thời gian làm việc ngoài thời giờ làm việc bình
 *               thường theo quy định của pháp luật, thỏa ước lao động tập thể hoặc nội quy lao
 *               động." — every hour outside normal working time, a weekly rest day's and a
 *               holiday's included, is overtime; art.98(1)(b)–(c) prices exactly that overtime
 *               ("làm thêm giờ … vào ngày nghỉ hằng tuần … 200%; vào ngày nghỉ lễ, tết … 300%").
 *   art.107(2)  (b) no more than 40 hours a month; (c) no more than 200 a year (art.107(3): 300 in
 *               the listed sectors). Resolution 17/2022/UBTVQH15's 60 a month ran 1 April – 31
 *               December 2022 only; 40 is the figure for every sealed version.
 *   art.108     work the employer may demand "mà không bị giới hạn về số giờ làm thêm theo quy
 *               định tại Điều 107" — an emergency day stays outside the caps.
 *   Decree 145 art.60(4) sets 12 hours a day "khi làm thêm vào ngày nghỉ lễ, tết và ngày nghỉ hằng
 *               tuần"; art.60(5) deducts only the paid breaks of art.58(1) from the monthly and
 *               yearly totals — no carve-out for rest-day or holiday hours.
 *   Sources: https://hethongphapluat.com/bo-luat-lao-dong-2019/dieu-107 ,
 *            https://hethongphapluat.com/bo-luat-lao-dong-2019/dieu-108 ,
 *            https://tracuuluat.lcalawfirm.vn/bai-viet/dieu-60-gioi-han-so-gio-lam-them-nghi-dinh-1452020ndcp-2500.html
 *
 * Taiwan — 勞動基準法 §32(2): 46 extended hours a month (54 with consent), 138 a quarter. Hours past
 *   eight on a §36 例假 or a §37 休假日 are extended hours and count toward that total; the first
 *   eight do not (內政部 73.11.29 台內勞字第274334號; 勞委會 89.10.21 (89)台勞動二字第0041535號
 *   函 and 91.3.6 勞動二字第0910010425號令, as the 新北市勞工局 Q&A restates them:
 *   https://ilabor.ntpc.gov.tw/ckeditor/downloadFile/848321550). §32(4) emergency hours stay out.
 *
 * Fixture: 09:00–18:00 with a one-hour break is the normal day (8 hours); Saturday and Sunday are
 * rest days (TW: Saturday the 休息日, Sunday the 例假). The company cuts attendance on the 21st, so
 * every day below falls on or before the 21st and each run settles its own month's days; a run
 * reads its whole calendar months from attendance and earlier months from the earlier runs.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatutory, COMPANY_ID } from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

type Lineage = 'VN' | 'TW';

const holiday = (date: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name: 'Holiday',
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});

type Punch = readonly [date: string, start: string, end: string, emergency?: boolean];

const plant = (
	world: PayrollWorld,
	key: string,
	punches: readonly Punch[],
	holidays: string[],
	offset: string
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	for (const date of holidays) world.jurisdiction_holidays.push(holiday(date) as never);
	for (const [date, start, end, emergency] of punches)
		world.work_days.push({
			id: `wd-${key}-${date}`,
			employment_id: employment.id,
			work_date: date,
			shift_definition_id: null,
			worked_intervals: [
				{ start: `${date}T${start}:00${offset}`, end: `${date}T${end}:00${offset}` }
			],
			requested_by: null,
			emergency_cause: emergency === true ? true : null,
			time_off_in_lieu: null,
			approval_id: null
		});
};

/**
 * Builds each period in turn, every earlier run and its payslips standing in the world as they
 * would after settlement, and returns the last run's ceiling warnings.
 */
const chain = (options: {
	readonly code: Lineage;
	readonly periods: readonly string[];
	readonly punches: readonly Punch[];
	readonly holidays?: string[];
	readonly companyFacts?: Readonly<Record<string, boolean>>;
	/** Sunday a statutory rest day (TW 勞基法 §36 例假), as `statutory_rest` reads it. */
	readonly statutorySunday?: boolean;
}) => {
	const person = { key: `${options.code}-OT`, wage: 17_600_000, citizenship: 'CITIZEN' } as const;
	const settled: { run: object; slips: object[] }[] = [];
	let warnings: readonly string[] = [];
	for (const period of options.periods) {
		const built = buildStatutory(
			{
				code: options.code,
				period,
				...(options.code === 'VN' ? { region: 'I' } : { riskClass: '1' }),
				people: [options.code === 'TW' ? { ...person, wage: 60_000 } : person],
				companyFacts: options.companyFacts ?? {}
			},
			(world) => {
				// Local clock time: Hanoi is UTC+7, Taipei UTC+8.
				plant(
					world,
					person.key,
					options.punches,
					options.holidays ?? [],
					options.code === 'VN' ? '+07:00' : '+08:00'
				);
				if (options.statutorySunday === true) {
					world.shift_definitions.push({
						...world.shift_definitions[1]!,
						id: 'c0000000-0000-4000-8000-0000000000e9',
						code: 'LIJIA',
						name: '例假',
						variant: { kind: 'REST', statutory: true }
					});
					world.shift_patterns[0]!.pattern.days[6] = {
						roster_code_id: 'c0000000-0000-4000-8000-0000000000e9'
					};
				}
				for (const { run, slips } of settled) {
					world.payroll_runs.push(run as never);
					world.payslips.push(...(slips as never[]));
				}
			}
		);
		const runId = `run-${period}`;
		settled.push({
			run: {
				id: runId,
				company_id: COMPANY_ID,
				period,
				lifecycle: 'PAID',
				calculation_trace: built.trace
			},
			slips: [...built.slips.values()].map((slip) => ({
				...slip,
				payroll_run_id: runId,
				status: 'PAID',
				paid_at: `${period}-28T00:00:00.000Z`
			}))
		});
		warnings = built.warnings.filter((line) => line.startsWith('OVERTIME_LIMIT_EXCEEDED'));
	}
	return warnings;
};

const days = (month: string, list: readonly number[], start: string, end: string): Punch[] =>
	list.map((day) => [`${month}-${String(day).padStart(2, '0')}`, start, end] as const);

test('Vietnam round 3 I — art.107(1): rest-day and holiday hours enter the 40-hour month', () => {
	const warnings = chain({
		code: 'VN',
		periods: ['2026-01'],
		holidays: ['2026-01-01'],
		punches: [
			// Nine weekdays 09:00–21:00 less the one-hour break: 11 worked, 3 beyond the normal day each
			// — 27, inside 40 on their own.
			...days('2026-01', [2, 5, 6, 7, 8, 9, 12, 13, 14], '09:00', '21:00'),
			// Saturday the 10th, a rest day: 9 hours of clock, art.109(1)'s thirty minutes not working
			// time — 8.5 hours, every one of them overtime (art.107(1), paid at art.98(1)(b)).
			['2026-01-10', '09:00', '18:00'],
			// Thursday 1 January, Tết Dương lịch: 09:00–18:00 less the break, 8 hours at art.98(1)(c).
			['2026-01-01', '09:00', '18:00']
		]
	});
	// 27 + 8.5 + 8 = 43.5 > 40. The year (43.5) is inside 200.
	assert.deepEqual(
		warnings.map((line) =>
			line
				.match(/worked ([\d.]+) regulated overtime hours in ([^,\s]+), against a (\d+)-hour/)
				?.slice(1)
		),
		[['43.5', '2026-01', '40']],
		warnings.join('\n')
	);
});

test('Vietnam round 3 I — the 200-hour year reads two earlier months as they were counted', () => {
	const warnings = chain({
		code: 'VN',
		periods: ['2026-01', '2026-02', '2026-03', '2026-04'],
		holidays: ['2026-01-01'],
		punches: [
			// Weekdays 09:00–22:00 less the break: 12 worked, 4 beyond — art.107(2)(b)'s daily half.
			// January: twelve weekdays (48), the Saturday 10th (8.5, as above) and the 1st (8) = 64.5.
			...days('2026-01', [2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19], '09:00', '22:00'),
			['2026-01-10', '09:00', '18:00'],
			['2026-01-01', '09:00', '18:00'],
			// February: twelve weekdays (48) and Saturday the 7th (8.5) = 56.5; the 18th is an art.108
			// emergency, its 4 hours beyond the day outside every cap.
			...days('2026-02', [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17], '09:00', '22:00'),
			['2026-02-07', '09:00', '18:00'],
			['2026-02-18', '09:00', '22:00', true],
			// March: twelve weekdays (48) and Saturday the 7th (8.5) = 56.5.
			...days('2026-03', [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17], '09:00', '22:00'),
			['2026-03-07', '09:00', '18:00'],
			// April: twelve weekdays (48) and Saturday the 4th (8.5) = 56.5.
			...days('2026-04', [1, 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16], '09:00', '22:00'),
			['2026-04-04', '09:00', '18:00']
		]
	});
	// The April run measures March and April whole from attendance (56.5 + 56.5) and reads January
	// (64.5) and February (56.5) from the runs that settled them, the emergency hours in neither:
	// 64.5 + 56.5 + 56.5 + 56.5 = 234 > 200. Each month is also past its own 40.
	const year = warnings.filter((line) => / in 2026, /.test(line));
	assert.equal(year.length, 1, warnings.join('\n'));
	assert.match(
		year[0]!,
		/worked 234 regulated overtime hours in 2026, against a 200-hour calendar-year/
	);
});

test('Taiwan round 3 I — the 138-hour quarter reads January as its ceiling counted it', () => {
	const warnings = chain({
		code: 'TW',
		periods: ['2026-01', '2026-02', '2026-03'],
		holidays: ['2026-01-01'],
		// Consent lifts the month to 54, so each month below stands inside it.
		companyFacts: { overtime_consent: true },
		punches: [
			// Weekdays 09:00–22:00 less the break: 12 worked, 4 extended (§32(1)); 12 is §32(2)'s day.
			// January: twelve weekdays = 48, and the 1st (開國紀念日, §37) 09:00–21:00: 11 worked, the
			// first 8 the §39 doubled day outside the total, the 3 past them inside it — 51.
			...days('2026-01', [2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16, 19], '09:00', '22:00'),
			['2026-01-01', '09:00', '21:00'],
			// February: twelve weekdays = 48; the 18th is a §32(4) emergency, outside the total.
			...days('2026-02', [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17], '09:00', '22:00'),
			['2026-02-18', '09:00', '23:00', true],
			// March: twelve weekdays = 48.
			...days('2026-03', [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17], '09:00', '22:00')
		]
	});
	// The March run measures February and March whole (48 + 48) and reads January's 51 from its run:
	// 51 + 48 + 48 = 147 > 138. Counting every earlier OVERTIME line instead would have read January
	// as 59 (the holiday's 8 doubled hours too) and February again as 53 (its emergency line too).
	assert.deepEqual(
		warnings.map((line) =>
			line
				.match(/worked ([\d.]+) regulated overtime hours in ([^,\s]+), against a (\d+)-hour/)
				?.slice(1)
		),
		[['147', '2026-Q1', '138']],
		warnings.join('\n')
	);
});

test('Taiwan round 3 I — §32(2): hours past eight on a §37 休假日 and a 例假 enter the 46-hour month', () => {
	const month = (extra: readonly Punch[]) =>
		chain({
			code: 'TW',
			periods: ['2026-01'],
			holidays: ['2026-01-01'],
			statutorySunday: true,
			punches: [
				// Eleven weekdays 09:00–22:00: 4 extended each — 44, inside 46 on their own.
				...days('2026-01', [2, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16], '09:00', '22:00'),
				...extra
			]
		}).map((line) => line.match(/worked ([\d.]+) regulated overtime hours in ([^,\s]+)/)?.slice(1));
	// The holiday worked 09:00–18:00: 8 hours, all inside the §39 day — 44, no report.
	assert.deepEqual(month([['2026-01-01', '09:00', '18:00']]), []);
	// The holiday worked 09:00–21:00: 11 hours, 3 past eight — 44 + 3 = 47 > 46.
	assert.deepEqual(month([['2026-01-01', '09:00', '21:00']]), [['47', '2026-01']]);
	// Sunday the 11th, the 例假, worked 09:00–21:00: 12 hours of clock with no break taken, §35's
	// thirty minutes not working time — 11.5 hours, 3.5 past eight: 44 + 3.5 = 47.5 > 46.
	assert.deepEqual(month([['2026-01-11', '09:00', '21:00']]), [['47.5', '2026-01']]);
});
