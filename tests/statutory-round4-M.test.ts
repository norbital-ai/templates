/**
 * Round 4, letter M — Taiwan: the disability premium subsidy's rounding, and the 補休 balance
 * payroll keeps for overtime taken as time off.
 *
 * Every expected figure is derived by hand in the comment beside it from the instrument named;
 * none was read off an engine run.
 *
 * 身心障礙者權益保障法 §73; 身心障礙者參加社會保險保險費補助辦法 §4 (以其自付者為限), §5 (極重度、重度
 *   全額; 中度 二分之一; 輕度 四分之一): https://law.moj.gov.tw/LawClass/LawAll.aspx?PCode=D0050090
 * BLI's own worked example (勞動部勞工保險局納保組 許晉慶, 〈身心障礙勞工保險費減免〉, 台灣勞工季刊
 *   第44期 p.72–73, https://www.mol.gov.tw/media/q5cjfwu3/%E6%B4%BB%E7%94%A8%E6%B3%95%E8%A6%8F.pdf):
 *   輕度, grade 28,800, LI 9%: (28,800×9%×20%) − (28,800×9%×20%×25%) = 518 − 130 = 388; EI 1%:
 *   58 − 14 = 44. The subsidy is taken on the unrounded share and rounded on its own.
 * 全民健康保險法 §27(1)(1): 被保險人及其眷屬自付百分之三十 — each dependant's premium is their own.
 * 全民健康保險法施行細則 §52: 保險費…以元為單位，角以下四捨五入。被保險人應自付之保險費及政府補助
 *   金額尾數均為五角時，以政府補助金額進位。 https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=L0060002
 *
 * 勞動基準法 §32-1: 補休 hour for hour; 補休期限屆期或契約終止未補休之時數，應依延長工作時間或
 *   休息日工作當日之工資計算標準發給工資。 https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030001&flno=32-1
 * 施行細則 §22-2: 應依勞工延長工作時間或休息日工作事實發生時間先後順序補休。補休之期限逾依第二十四條
 *   第二項所約定年度之末日者，以該日為期限之末日。 https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=N0030002&flno=22-2
 *
 * The fixture's day is 09:00–18:00 with a one-hour break (8 normal hours, §30); Saturday is the
 * 休息日. 60,000 a month on TW's 30-day divisor is 2,000 a day and 250 an hour. §24(1): the first
 * two extended hours at 4/3 (333.33… an hour), the rest at 5/3 (416.66… an hour); §24(2) prices
 * 休息日 work on the same ladder from its first hour. Each band line is rounded to the cent.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	COMPANY_ID,
	expectStatutory,
	leaveCatalogue,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

test('TW round 4 — the LI/EI disability subsidy is rounded on its own, on the unrounded share (BLI)', () => {
	// 60,000 insures at the LI ceiling 45,800 (2026-02, LI 11.5%). The worker's share
	// 45,800 × 11.5% × 20% = 1,053.40 → 1,053.
	//   中度 50%: subsidy 1,053.40 × 50% = 526.70 → 527; withheld 1,053 − 527 = 526
	//     (halving the rounded share would give 526.50 → 527: the method matters here).
	//   輕度 25%: subsidy 263.35 → 263; withheld 790.
	// EI 45,800 × 1% × 20% = 91.60 → 92; 50%: 45.80 → 46, withheld 46; 25%: 22.90 → 23, withheld 69.
	const book = assessStatutory({
		code: 'TW',
		period: '2026-02',
		riskClass: '1',
		people: [25, 50].map((share) => ({
			key: `TW-DIS-${share}`,
			wage: 60_000,
			citizenship: 'CITIZEN',
			registrations: {
				LI: { kind: 'REGISTERED', elections: { disability_subsidy: share } },
				EI: { kind: 'REGISTERED', elections: { disability_subsidy: share } }
			}
		}))
	});
	expectStatutory(book, 'TW-DIS-50', 'LI', 526, 3687);
	expectStatutory(book, 'TW-DIS-50', 'EI', 46, 321);
	expectStatutory(book, 'TW-DIS-25', 'LI', 790, 3687);
	expectStatutory(book, 'TW-DIS-25', 'EI', 69, 321);
});

test('TW round 4 — NHI subsidises the insured and each disabled dependant on their own premium (§27, 細則 §52)', () => {
	// 60,000 insures at NHI grade 60,800, whose published per-person premium is 943
	// (60,800 × 5.17% × 30% = 943.008). Insured 輕度 with three dependants: one 重度, one 中度, one
	// with no certificate. Premium before subsidy 4 × 943 = 3,772. Subsidies, each person's own:
	//   insured 943 × 25% = 235.75 → 236; 重度 dependant 943 in full; 中度 dependant 943 × 50% =
	//   471.50 — self-paid 471.50 and subsidy 471.50 both end in five 角, so the subsidy rounds up
	//   (細則 §52): 472. Withheld 3,772 − 236 − 943 − 472 = 2,121.
	// The employer's share is untouched by the subsidy (only 自付 is subsidised, 辦法 §4).
	const person = (key: string, elections: Record<string, number>) => ({
		key,
		wage: 60_000,
		citizenship: 'CITIZEN',
		registrations: {
			NHI: { kind: 'REGISTERED', elections: { enrolled_dependants: 3, ...elections } }
		}
	});
	const book = assessStatutory({
		code: 'TW',
		period: '2026-02',
		riskClass: '1',
		people: [
			person('TW-NHI-NONE', {}),
			person('TW-NHI-DIS', {
				disability_subsidy: 25,
				dependants_subsidised_full: 1,
				dependants_subsidised_half: 1
			})
		]
	});
	const employer = book.get('TW-NHI-NONE')!.get('NHI')!.employer;
	expectStatutory(book, 'TW-NHI-NONE', 'NHI', 3772, employer);
	expectStatutory(book, 'TW-NHI-DIS', 'NHI', 2121, employer);
	// Four disabled dependants cannot be recorded against three charged.
	assert.throws(
		() =>
			assessStatutory({
				code: 'TW',
				period: '2026-02',
				riskClass: '1',
				people: [person('TW-NHI-OVER', { dependants_subsidised_quarter: 4 })]
			}),
		/More disabled dependants are recorded than dependants charged/
	);
});

// ── §32-1 補休 ────────────────────────────────────────────────────────────────────────────────

const PERSON = { key: 'TW-TOIL', wage: 60_000, citizenship: 'CITIZEN' } as const;
/** The 2026 version (1 January 2026 onward) and its 補休 leave row. */
const COMP = leaveCatalogue('TW').find(
	(row) => row.code === 'COMPENSATORY_TIME_OFF' && row.settings_id.startsWith('1fcfa66f')
)!;

const elect = (world: PayrollWorld, date: string, start: string, end: string) => {
	const employment = world.employments.find((row) => row.employee_number === PERSON.key)!;
	world.work_days.push({
		id: `wd-${PERSON.key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: [{ start: `${date}T${start}:00+08:00`, end: `${date}T${end}:00+08:00` }],
		requested_by: null,
		emergency_cause: null,
		time_off_in_lieu: true,
		approval_id: null
	});
};

/** HR records `hours` of 補休 on `date` — an eighth of the day per hour (leave_charges). */
const takeCompTime = (world: PayrollWorld, date: string, hours: number) => {
	const employment = world.employments.find((row) => row.employee_number === PERSON.key)!;
	const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
	world.leave_entries.push({
		id: `e1000000-0000-4000-8000-${date.replaceAll('-', '').padStart(12, '0')}`,
		employment_id: employment.id,
		catalogue_id: COMP.id,
		leave_code: 'COMPENSATORY_TIME_OFF',
		reference: `COMP-${date}`,
		from_date: date,
		to_date: date,
		half_day_start: false,
		half_day_end: false,
		days: hours / 8,
		hours,
		effective_on: date,
		reason: '補休',
		allocations: [],
		charges: [
			{
				date,
				days: hours / 8,
				catalogue_id: COMP.id,
				employment_term_id: term.id,
				holiday_id: null,
				shift_definition_id: null,
				work_day_id: null
			}
		],
		approval_id: null,
		payslip_id: null
	} as never);
};

const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));

const THIRD = 'OT-1.3333333333333333X';
const TWO_THIRDS = 'OT-1.6666666666666667X';

/** Each period in turn, every earlier run and its payslips standing in the world as settled. */
const chain = (options: {
	readonly periods: readonly string[];
	readonly plant: (world: PayrollWorld) => void;
	readonly companyFacts?: Readonly<Record<string, number>>;
	readonly exit?: string;
}) => {
	const settled: { run: object; slips: object[] }[] = [];
	let last: ReturnType<typeof buildStatutory> | null = null;
	for (const period of options.periods) {
		const built = buildStatutory(
			{
				code: 'TW',
				period,
				riskClass: '1',
				companyFacts: options.companyFacts ?? {},
				people: [
					options.exit == null
						? PERSON
						: { ...PERSON, exit_date: options.exit, exit_reason: 'RESIGNATION' }
				]
			},
			(world) => {
				world.leave_catalogue.push(...(leaveCatalogue('TW') as never[]));
				options.plant(world);
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
		last = built;
	}
	return last!;
};

test('TW round 4 — §32-1: six elected hours, two taken as 補休, the four left are paid on termination at the day rates', () => {
	// Monday 5 January 2026, 09:00–21:00: 3 extended hours, elected — credited in worked order as
	//   2 h at 4/3 (666.67) then 1 h at 5/3 (416.67).
	// Saturday 10 January (休息日), 09:00–12:00: 3 hours, elected — 2 h at 4/3, 1 h at 5/3.
	// Six hours in all. 補休 of 2 hours on Thursday 15 January takes the oldest first (細則 §22-2):
	// Monday's two 4/3 hours. The contract ends on 20 January (the cut-off day), so the four
	// untaken hours are paid now (§32-1(2)) at the rates of the days they were worked:
	//   Monday   1 h × 250 × 5/3 = 416.67
	//   Saturday 2 h × 250 × 4/3 = 666.67; 1 h × 250 × 5/3 = 416.67
	// Four hours, 1,500.01 (250 × (5/3 + 8/3 + 5/3) = 1,500, each line rounded to the cent).
	const built = chain({
		periods: ['2026-01'],
		exit: '2026-01-20',
		plant: (world) => {
			elect(world, '2026-01-05', '09:00', '21:00');
			elect(world, '2026-01-10', '09:00', '12:00');
			takeCompTime(world, '2026-01-15', 2);
		}
	});
	assert.deepEqual(workLines(built.slips.get(PERSON.key)!), [
		['2026-01-05', TWO_THIRDS, 1, 416.67],
		['2026-01-10', THIRD, 2, 666.67],
		['2026-01-10', TWO_THIRDS, 1, 416.67]
	]);
});

test('TW round 4 — §32-1: untaken hours are paid when the agreed period expires; one hour taken first', () => {
	// Agreed period one month (entity fact): Monday 5 January's credit expires 4 February 2026,
	// before the annual-leave year ends on 31 December (細則 §22-2). The January run credits the
	// three hours and pays none; 1 hour of 補休 on Monday 26 January (February's window) takes the
	// first 4/3 hour. The February run, whose window reaches the expiry, pays what is left:
	//   1 h × 250 × 4/3 = 333.33 and 1 h × 250 × 5/3 = 416.67.
	const plant = (world: PayrollWorld) => {
		elect(world, '2026-01-05', '09:00', '21:00');
		takeCompTime(world, '2026-01-26', 1);
	};
	const january = chain({
		periods: ['2026-01'],
		companyFacts: { time_off_in_lieu_months: 1 },
		plant
	});
	assert.deepEqual(workLines(january.slips.get(PERSON.key)!), []);
	const february = chain({
		periods: ['2026-01', '2026-02'],
		companyFacts: { time_off_in_lieu_months: 1 },
		plant
	});
	assert.deepEqual(workLines(february.slips.get(PERSON.key)!), [
		['2026-01-05', THIRD, 1, 333.33],
		['2026-01-05', TWO_THIRDS, 1, 416.67]
	]);
	// A third run owes nothing more: the February payslip's payout is read back.
	const march = chain({
		periods: ['2026-01', '2026-02', '2026-03'],
		companyFacts: { time_off_in_lieu_months: 1 },
		plant
	});
	assert.deepEqual(workLines(march.slips.get(PERSON.key)!), []);
});

test('TW round 4 — §32-1 with no agreed period: the credit lives to the end of the annual-leave year, then is paid', () => {
	// No period recorded: 細則 §22-2 and MOL's 加班補休規定 Q&A make 31 December 2026 (ANNUAL_LEAVE's
	// calendar year) the last day. February's run pays nothing; the run whose salary window
	// reaches 31 December pays all three hours: 666.67 + 416.67.
	const plant = (world: PayrollWorld) => elect(world, '2026-01-05', '09:00', '21:00');
	const february = chain({ periods: ['2026-01', '2026-02'], plant });
	assert.deepEqual(workLines(february.slips.get(PERSON.key)!), []);
	const december = chain({ periods: ['2026-01', '2026-12'], plant });
	assert.deepEqual(workLines(december.slips.get(PERSON.key)!), [
		['2026-01-05', THIRD, 2, 666.67],
		['2026-01-05', TWO_THIRDS, 1, 416.67]
	]);
});
