/**
 * Thailand: expected payslips against the law itself.
 *
 * The register is docs/inventory/thailand.md; each case names the row it prices. Figures come from
 * the instruments, never from the engine:
 *
 * - Social Security Act B.E.2533, Council of State current consolidation
 *   (https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09,
 *   read 28 September 2026; the SSO's own copy stops at No.3 B.E.2542, register TH-SS-12):
 *   s.33 insured while aged 15–60 (a hire over 60 never enters; one insured before 60 stays); s.46 each side at the ministerial rate on the wage between the
 *   ministerial floor and ceiling, a fraction of 50 satang or more counting as one baht, less
 *   dropped; s.5 the wage is pay for normal working time (overtime and holiday-work pay outside).
 *   5% each (Ministerial Regulation on contribution rates B.E.2565, Schedule B). Base THB1,650 to
 *   THB15,000, THB17,500 from 1 January 2026 (2026 base regulation). 3% each side for a registered
 *   employer in nine southern provinces, wage months December 2025–May 2026 (flood-relief notice
 *   published 8 January 2026). TH-SS-01, -02, -11, -12, -13. The base regulation B.E.2568 (Gazette
 *   vol.142 part 81 Kor, 12 December 2025) was read from the SSO's copy
 *   (https://www.sso.go.th/wpr/download/download_by_pool_file/47755): cl.3 THB1,650–17,500 to 2028,
 *   –20,000 2029–2031, –23,000 from 2032. The flood-relief notice was read from the Gazette's own
 *   PDF on 29 September 2026 (https://ratchakitcha.soc.go.th/documents/100888.pdf, vol.143 special
 *   part 6 Ngor p.7, a Ministry of Labour notice under SSA s.46/1 signed 7 January 2026; it had
 *   returned 403 on 28 September). The Employee Welfare Fund rate regulation B.E.2568 was read
 *   from the Gazette facsimile the Council of State serves ('ค0077 กฎกระทรวง 2568-60ก-3.pdf',
 *   https://www.ocs.go.th/searchlaw/power_link/download/eyJ1dWlkIjoiNDNjMTc4OTgtODFiMS00MmVhLWIwNmYtMjQ4YzM1NzlmMzFhIiwiZmlsZW5hbWUiOiLguIQwMDc3IOC4geC4juC4geC4o-C4sOC4l-C4o-C4p-C4hyAyNTY4LTYw4LiBLTMucGRmIn0.CH4M5nGGlUmG48thQPthO-j_qpRZ-5GpRKA0pnN9pw8);
 *   its law-index page (https://www.ocs.go.th/searchlaw/law-index/item/13221) has no text.
 * - Severance withholding: Revenue Code s.50(1) para.3 and s.48(5); DG Notification No.45
 *   (https://www.rd.go.th/3213.html) cls.1(ค), 2(ก), 4; MR No.126 cl.2(51) as amended by No.394
 *   (https://www.rd.go.th/2502.html). TH-PIT-05.
 * - Revenue Code (https://www.rd.go.th/5937.html) s.50(1) and Order P.96/2543
 *   (https://www.rd.go.th/3558.html): each payment × the payments due in the year (12; the remaining
 *   ones in the year of hire), the s.48(1) tax on it ÷ that number, truncated to the satang, the
 *   remainder in December; an occasional payment (overtime, bonus, leave pay) withheld whole as the
 *   annual tax with it less the annual tax without it (cl.1(5)). s.42 bis 50% expense, at most
 *   100,000; s.47(1)(ก) 60,000 personal allowance; s.47(1)(ฌ) social-security contributions paid;
 *   s.47(3) a non-resident keeps the personal allowance. Table (Act No.44 B.E.2560 s.12,
 *   https://www.rd.go.th/59670.html): 0–150,000 exempt, then 5/10/15/20/25/30/35% at
 *   300,000/500,000/750,000/1,000,000/2,000,000/5,000,000. TH-PIT-01–03, TH-PIT-19, TH-PIT-20.
 *   The social-security relief is this employment's monthly contribution × the number of
 *   payments — what the employee's ล.ย.01 declares from the start of the year (P.96 cl.1(2)); no
 *   other ล.ย.01 relief is priced.
 * - Labour Protection Act B.E.2541, Council of State current consolidation through No.9 B.E.2568
 *   (https://searchlaw.ocs.go.th/council-of-state/#/public/doc/ZGN3NXk0eENvNjBSdjRnT2NsdjFTQT09,
 *   read 28 September 2026; No.8 added only s.23/1, No.9 only ss.4/1, 41, 41/1, 59–59/2 and 115/1):
 *   s.61 1.5×; s.62(1) +1× for an employee paid for the holiday, s.62(2) 2× for one who is not (a
 *   daily-paid employee's weekly holiday, s.56); s.63 3×; s.65(1)/s.66 managers outside; s.68 hourly
 *   rate = monthly ÷ (30 × normal hours); s.67 annual-leave pay on termination; s.118 severance;
 *   ss.120–122 special severance; s.70 final pay in three days; s.41/s.59 as amended by No.9 (in
 *   force 7 December 2025): 120 days' maternity leave, holidays counted, wages for 60 of them.
 *   TH-WORK-02, -05, -06; TH-EXIT-02, -03, -06, -07; TH-LEAVE-01.
 *
 * Premises the law is silent on, fixed by owner rule 2026-09-28 (register TH-WORK-05): the Act states no
 * part-month proration, so a monthly wage is prorated on calendar days (s.56(1) pays it for every
 * day, weekly holidays included) and an unpaid day is deducted at the same calendar-day rate; the
 * day of a monthly wage for s.67 leave pay and s.118 severance is monthly ÷ 30 (s.68's conversion,
 * stated there for overtime only). The cases that turn on them say so.
 *
 * Money is kept to the satang (the baht has 100 satang); SSO shares are whole baht by s.46.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	COMPANY_ID,
	assessStatutory,
	buildStatutory,
	expectStatutory,
	expectStatutorySkipped,
	leaveCatalogue,
	rowIn,
	settingsIdOn,
	settingsVersions,
	adhocCatalogue,
	contributionSchemes,
	assertEveryVersionPriced,
	createStatutoryWorld,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import { payrollWorld, type PayrollWorld } from './fixtures/memory-payroll-api.ts';
import { buildPayrollRun, gatherPayrollRun } from '../src/lib/payroll/run/engine.ts';
import {
	evaluateBoolean,
	evaluateNumber,
	expressionEngine
} from '../src/lib/expressions/evaluate.ts';
import { personContext } from '../src/lib/payroll/run/eligibility.ts';
import { evaluateLeavePreview } from '../src/lib/leave/preview.ts';
import { planLeaveActivity } from '../src/lib/leave/activity.ts';
import { leaveContext } from './helpers/manual-leave-context.ts';

const TH = 'TH';
const citizen = (key: string, wage: number, extra: Record<string, unknown> = {}) => ({
	key,
	wage,
	citizenship: 'CITIZEN',
	tax_residency: 'RESIDENT',
	...extra
});

/**
 * The s.33 goldens price contribution bases below Notice 14's floor (1,500 under the 1,650 base
 * floor). cl.20 blocks such a contract; these suites test s.33, so the shortfall is a warning here.
 * The floor itself is proven by the Notice 14 goldens below.
 */
const belowNotice14 = (world: PayrollWorld) => {
	world.jurisdiction_settings = world.jurisdiction_settings.map((version) => ({
		...version,
		work_rules: {
			...version.work_rules,
			wages: { ...version.work_rules.wages, block_below_when: 'false' }
		}
	}));
};

const charge = (slip: BuiltPayslip, code: string) => {
	const row = slip.statutory.find((entry) => entry.scheme_code === code);
	assert.ok(row, `no ${code} row`);
	return [row.base_amount, row.employee_amount, row.employer_amount] as const;
};
/** The severance withholding on one payslip; a nil assessment carries no row. */
const severanceTax = (slip: BuiltPayslip) =>
	slip.statutory.find((entry) => entry.scheme_code === 'SEVERANCE_TAX')?.employee_amount ?? 0;
/** The work-day lines one payslip carries, as `[date, label, hours, amount]`, in date order. */
const workLines = (slip: BuiltPayslip) =>
	slip.adjustments
		.filter((row) => row.family === 'WORK_DAY')
		.map((row) => [row.source_id.slice(-10), row.label, row.quantity, row.amount] as const)
		.toSorted((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
const holiday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	kind: 'PUBLIC_HOLIDAY',
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
/** A Thai timecard: the midday hour is timed, and a long day takes 20 minutes before overtime. */
const punch = (
	world: PayrollWorld,
	key: string,
	date: string,
	start: string,
	end: string,
	approvedHours?: number
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
		approved_overtime_hours: approvedHours ?? 0,
		overtime_consented_at: `${date}T00:00:00+07:00`,
		approval_id: null
	});
};
/** A seven-hour normal day reaches its overtime boundary at 17:00. */
const punchSeven = (
	world: PayrollWorld,
	key: string,
	date: string,
	end: string,
	approvedHours: number
) => {
	punch(world, key, date, '09:00', end, approvedHours);
	const minute = Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) + 20;
	const finish = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
	world.work_days.at(-1)!.worked_intervals = [
		{ start: `${date}T09:00:00+07:00`, end: `${date}T13:00:00+07:00` },
		{ start: `${date}T14:00:00+07:00`, end: `${date}T17:00:00+07:00` },
		{ start: `${date}T17:20:00+07:00`, end: `${date}T${finish}:00+07:00` }
	];
};
const withLeaveCatalogue = (world: PayrollWorld) => {
	if (!world.leave_catalogue.some((row) => String(row.code) === 'ANNUAL_LEAVE'))
		world.leave_catalogue.push(
			...leaveCatalogue(TH).map((row) => ({ ...row, approval_id: null }) as never)
		);
};
const unpaidDays = (world: PayrollWorld, key: string, dates: readonly string[]) => {
	withLeaveCatalogue(world);
	const settingsId = settingsIdOn(TH, dates[0]!);
	const catalogueId = rowIn(leaveCatalogue(TH), settingsId, 'UNPAID_LEAVE');
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
	world.leave_entries.push({
		id: `e1000000-0000-4000-8000-${key.padStart(12, '0').slice(-12)}`,
		employment_id: employment.id,
		catalogue_id: catalogueId,
		leave_code: 'UNPAID_LEAVE',
		reference: `NPL-${key}`,
		from_date: dates[0]!,
		to_date: dates.at(-1)!,
		half_day_start: false,
		half_day_end: false,
		days: dates.length,
		effective_on: dates[0]!,
		reason: 'Agreed unpaid leave',
		allocations: [],
		charges: dates.map((date) => ({
			date,
			days: 1,
			catalogue_id: catalogueId,
			employment_term_id: term.id,
			holiday_id: null,
			shift_definition_id: null,
			work_day_id: null
		})),
		approval_id: null
	} as never);
};
const adhoc = (
	world: PayrollWorld,
	key: string,
	code: string,
	amount: number,
	date: string,
	id: string
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.adhoc_requests!.push({
		id,
		employment_id: employment.id,
		catalogue_id: rowIn(adhocCatalogue(TH), settingsIdOn(TH, date), code),
		amount,
		event_date: date,
		// Captured for the event's own month: an exit on the 31st is past the 21st–20th attendance
		// window, and the separation payment belongs on the final payslip.
		pay_period: date.slice(0, 7),
		payslip_id: null,
		reason: code,
		evidence_file: null,
		as_adjustment_entry: false,
		approval_id: null
	} as never);
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Social security (TH-SS-01, -11, -12, -13)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Thailand — s.33 contributions at the THB1,650 floor, the 15,000 / 17,500 ceilings and s.46 rounding', () => {
	// January 2026: ceiling 17,500 (2026 base regulation), 5% each side (2565 rate regulation).
	const january = assessStatutory(
		{
			code: TH,
			period: '2026-01',
			people: [
				citizen('SS-1500', 1_500), // under the floor: 1,650 × 5% = 82.50 → 83 (s.46: 50 satang counts as 1)
				citizen('SS-1650', 1_650), // on the floor: 82.50 → 83
				citizen('SS-10209', 10_209), // 510.45 → 510 (under 50 satang dropped)
				citizen('SS-10210', 10_210), // 510.50 → 511
				citizen('SS-17499.99', 17_499.99), // 874.9995 → 875
				citizen('SS-17500', 17_500), // on the ceiling: 875
				citizen('SS-17500.01', 17_500.01), // one satang above: capped at 17,500 → 875
				citizen('SS-60000', 60_000) // capped: 875
			]
		},
		belowNotice14
	);
	for (const [key, share] of [
		['SS-1500', 83],
		['SS-1650', 83],
		['SS-10209', 510],
		['SS-10210', 511],
		['SS-17499.99', 875],
		['SS-17500', 875],
		['SS-17500.01', 875],
		['SS-60000', 875]
	] as const)
		expectStatutory(january, key, 'SSO', share, share);

	// December 2025: the ceiling is still 15,000 — 750 at and above it.
	const december = assessStatutory(
		{
			code: TH,
			period: '2025-12',
			people: [
				citizen('SS-14989', 14_989), // 749.45 → 749
				citizen('SS-14990', 14_990), // 749.50 → 750
				citizen('SS-15000', 15_000), // 750
				citizen('SS-15000.01', 15_000.01), // capped: 750
				citizen('SS-17500', 17_500) // capped at 15,000 in December: 750, not 875
			]
		},
		belowNotice14
	);
	for (const [key, share] of [
		['SS-14989', 749],
		['SS-14990', 750],
		['SS-15000', 750],
		['SS-15000.01', 750],
		['SS-17500', 750]
	] as const)
		expectStatutory(december, key, 'SSO', share, share);
});

test('Thailand — the southern flood-relief rate is 3% each side, December 2025 to May 2026 only (TH-SS-02)', () => {
	// Flood-relief notice: 3% each side for a registered employer (and its insured) in the nine
	// listed provinces, wage months December 2025–May 2026. The register's own probe: 10,250 × 3% =
	// 307.50 → 308. Under the floor: 1,650 × 3% = 49.50 → 50. At the cap: 15,000 × 3% = 450 in
	// December, 17,500 × 3% = 525 from January.
	const people = [
		citizen('FL-10250', 10_250),
		citizen('FL-1500', 1_500),
		citizen('FL-60000', 60_000)
	];
	const flood = { sso_flood_relief_area: true };
	const december = assessStatutory(
		{ code: TH, period: '2025-12', people, companyFacts: flood },
		belowNotice14
	);
	expectStatutory(december, 'FL-10250', 'SSO', 308, 308);
	expectStatutory(december, 'FL-1500', 'SSO', 50, 50);
	expectStatutory(december, 'FL-60000', 'SSO', 450, 450);
	for (const period of ['2026-01', '2026-05']) {
		const book = assessStatutory({ code: TH, period, people, companyFacts: flood }, belowNotice14);
		expectStatutory(book, 'FL-10250', 'SSO', 308, 308);
		expectStatutory(book, 'FL-60000', 'SSO', 525, 525);
	}
	// A company outside the listed provinces pays the ordinary 5% in the same months.
	const ordinary = assessStatutory({ code: TH, period: '2026-01', people }, belowNotice14);
	expectStatutory(ordinary, 'FL-10250', 'SSO', 513, 513); // 512.50 → 513
	// June 2026: the notice has run out; the 1 June version carries no flood branch at all.
	const june = assessStatutory({ code: TH, period: '2026-06', people }, belowNotice14);
	expectStatutory(june, 'FL-10250', 'SSO', 513, 513);
	expectStatutory(june, 'FL-60000', 'SSO', 875, 875);
	for (const version of settingsVersions(TH))
		assert.equal(
			version.facts.some((fact: { key: string }) => fact.key === 'sso_flood_relief_area'),
			String(version.effective_range.start) < '2026-06-01',
			`${String(version.effective_range.start).slice(0, 10)} flood fact`
		);
});

test('Thailand — the flood-relief notice as read from the Gazette: cl.1 3% each side, December 2025–May 2026 (TH-SS-02)', () => {
	// Read 29 September 2026 from https://ratchakitcha.soc.go.th/documents/100888.pdf (rendered
	// page): Ministry of Labour notice under SSA s.46/1 para.1, vol.143 special part 6 Ngor p.7,
	// published 8 January 2026, signed 7 January 2026. cl.1: 3% each side of the insured's wage for a
	// registered employer and s.33 insured in the nine listed provinces, wage months December 2025
	// to May 2026 (six months, the s.46/1 para.2 limit). s.46 rounding: 50 satang or more is a baht.
	//   December 2025: 10,209 × 3% = 306.27 → 306; 16,667 capped at 15,000 × 3% = 450.
	//   May 2026: 16,667 × 3% = 500.01 → 500; 16,683 × 3% = 500.49 → 500; 16,684 × 3% = 500.52 → 501.
	//   May 2026 outside the provinces: 16,684 × 5% = 834.20 → 834.
	const people = [
		citizen('GF-10209', 10_209),
		citizen('GF-16667', 16_667),
		citizen('GF-16683', 16_683),
		citizen('GF-16684', 16_684)
	];
	const flood = { sso_flood_relief_area: true };
	const december = assessStatutory(
		{ code: TH, period: '2025-12', people, companyFacts: flood },
		belowNotice14
	);
	expectStatutory(december, 'GF-10209', 'SSO', 306, 306);
	expectStatutory(december, 'GF-16667', 'SSO', 450, 450);
	const may = assessStatutory(
		{ code: TH, period: '2026-05', people, companyFacts: flood },
		belowNotice14
	);
	expectStatutory(may, 'GF-16667', 'SSO', 500, 500);
	expectStatutory(may, 'GF-16683', 'SSO', 500, 500);
	expectStatutory(may, 'GF-16684', 'SSO', 501, 501);
	const ordinary = assessStatutory({ code: TH, period: '2026-05', people }, belowNotice14);
	expectStatutory(ordinary, 'GF-16684', 'SSO', 834, 834);
	// The seed now says how the notice was read; the stale 403 blocker is gone everywhere.
	for (const version of settingsVersions(TH)) {
		const text = JSON.stringify(version);
		assert.ok(text.includes('vol.143 special part 6 Ngor p.7'), `${version.id} Gazette reference`);
		assert.ok(!text.includes('no capture of 100888'), `${version.id} stale flood blocker`);
	}
	for (const scheme of contributionSchemes(TH))
		assert.ok(
			!JSON.stringify(scheme).includes('flood-relief notice PDF returns HTTP 403'),
			`${scheme.id} stale flood blocker`
		);
});

test('Thailand — s.41/1 spouse-birth leave: 15 days within 90 days counted from the birth, as the Gazette reads (TH-LEAVE-03)', () => {
	// Act No.9 s.6 (vol.142 part 74 Kor p.43, read 29 September 2026): s.41/1 up to fifteen days
	// for each birth to help a spouse who gives birth, "within ninety days counted from the day of
	// birth"; s.8 adds s.59/2, working-day wages for up to fifteen days. Every version from
	// 7 December 2025 carries it; the pre-No.9 version does not.
	for (const version of settingsVersions(TH)) {
		const row = leaveCatalogue(TH).find(
			(entry) => entry.settings_id === version.id && entry.code === 'CHILD_BIRTH_LEAVE'
		);
		const from = String(version.effective_range.start).slice(0, 10);
		if (from < '2025-12-07') {
			assert.equal(row, undefined, `${from} predates No.9`);
			continue;
		}
		assert.ok(row, `${from} has no CHILD_BIRTH_LEAVE`);
		assert.deepEqual(
			row.entitlement.bands.map((band: { days: number }) => band.days),
			[15]
		);
		assert.equal(row.is_npl, false);
		assert.ok(row.authority.includes('within 90 days counted from the day of birth'), from);
		assert.ok(!row.authority.includes('before or within 90 days after'), from);
	}
});

test('Thailand — s.33 insures an entrant aged 15–60; a hire over 60 does not enter, an insured person ageing past 60 stays (TH-SS-12)', () => {
	const book = assessStatutory({
		code: TH,
		period: '2026-02',
		people: [
			// 62 in February 2026, hired at 55 in 2019: insured since entry, still insured.
			citizen('SS-62-INSURED', 30_000, { age: 62, hire_date: '2019-02-01' }),
			// Born 1 February 1965: 61 on the hire day 1 February 2026 — over 60 on entry.
			citizen('SS-61-ENTRANT', 30_000, { birth_date: '1965-02-01', hire_date: '2026-02-01' }),
			// Born 2 February 1965: 60 on the hire day 1 February 2026 — "not over sixty" on entry.
			citizen('SS-60-ENTRANT', 30_000, { birth_date: '1965-02-02', hire_date: '2026-02-01' })
		]
	});
	expectStatutory(book, 'SS-62-INSURED', 'SSO', 875, 875);
	expectStatutorySkipped(book, 'SS-61-ENTRANT', 'SSO');
	expectStatutory(book, 'SS-60-ENTRANT', 'SSO', 875, 875);
	// PIT relieves only contributions actually paid (s.47(1)(ฌ)): the 61-year-old entrant has none,
	// and, hired in February, eleven payments are due this year (P.96 cl.1(1)): 30,000 × 11 = 330,000
	// − 100,000 − 60,000 = 170,000 → 20,000 × 5% = 1,000 ÷ 11 = 90.9090… → 90.90. The insured
	// 62-year-old: 360,000 − 100,000 − 60,000 − 10,500 = 189,500 → 39,500 × 5% = 1,975 ÷ 12 =
	// 164.5833… → 164.58.
	expectStatutory(book, 'SS-61-ENTRANT', 'PIT', 90.9, 0);
	expectStatutory(book, 'SS-62-INSURED', 'PIT', 164.58, 0);
});

test('Thailand — s.33 para.1 is a status test: a worker hired under 15 is insured once 15 (TH-SS-12)', () => {
	// s.33 para.1: an employee "not under fifteen full years and not over sixty" is an insured
	// person — a status held while those facts hold, not a one-off test at entry; s.38 ends it only
	// on death or leaving employment. The lower bound is read on the period end, the day the
	// monthly wage is paid (s.47 para.1 deducts from wages paid to an insured person).
	const book = assessStatutory({
		code: TH,
		period: '2026-02',
		people: [
			// Born 1 June 1996, hired 1 July 2010 at 14; 29 in February 2026.
			citizen('SS-HIRED-AT-14', 30_000, { birth_date: '1996-06-01', hire_date: '2010-07-01' }),
			// The fixture's default age (40 at the period end) with a 2001 hire: 14 or 15 at hire.
			citizen('SS-25Y-SERVICE', 30_000, { hire_date: '2001-01-01' })
		]
	});
	// 30,000 over the 17,500 ceiling: 17,500 × 5% = 875 each side. PIT: 360,000 − 100,000 − 60,000
	// − 875 × 12 = 189,500 → 39,500 × 5% = 1,975 ÷ 12 = 164.5833… → 164.58.
	for (const key of ['SS-HIRED-AT-14', 'SS-25Y-SERVICE']) {
		expectStatutory(book, key, 'SSO', 875, 875);
		expectStatutory(book, key, 'PIT', 164.58, 0);
	}
});

test('Thailand — SSO law is read from the current consolidation: s.46 para.5 and s.47 para.1 as amended (TH-SS-11, -12)', () => {
	// s.46 para.5 (as the consolidation reads it): each insured person's contribution is rounded on
	// its own, 50 satang or more to the baht. February 2026, 5% each side under the 17,500 ceiling:
	// 12,345 × 5% = 617.25 → 617; 13,999 × 5% = 699.95 → 700.
	const book = assessStatutory(
		{
			code: TH,
			period: '2026-02',
			people: [citizen('SS-12345', 12_345), citizen('SS-13999', 13_999)]
		},
		belowNotice14
	);
	expectStatutory(book, 'SS-12345', 'SSO', 617, 617);
	expectStatutory(book, 'SS-13999', 'SSO', 700, 700);
	// Every version cites the consolidation, never the SSO copy frozen at No.3 B.E.2542.
	const consolidation =
		'https://searchlaw.ocs.go.th/council-of-state/#/public/doc/alJWY29wVXFRUUo0WkF2MTEwSndpQT09';
	for (const version of [
		...settingsVersions(TH),
		...contributionSchemes(TH).filter((scheme) => scheme.code === 'SSO')
	]) {
		const text = JSON.stringify(version);
		assert.ok(
			!text.includes('download_by_pool_file/14626'),
			`${version.id} cites the pre-No.4 SSO copy`
		);
		assert.ok(text.includes(consolidation), `${version.id} does not cite the consolidation`);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Employee Welfare Fund (TH-EWF-01, -02)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Thailand — Employee Welfare Fund 0.25% each side from 1 October 2026, ten employees or more, no ceiling', () => {
	// Commencement decree and rate regulation: 0.25% employee and 0.25% employer from 1 October 2026.
	// LPA s.130: an employer of ten or more; s.131: a provident-fund member is outside. The register's
	// probe: THB20,000 → THB50 each side. No wage cap: 60,000 → 150.
	const people = [
		citizen('EWF-20000', 20_000),
		citizen('EWF-60000', 60_000),
		citizen('EWF-PVD', 20_000, {
			registrations: {
				EWF: {
					kind: 'REGISTERED',
					elections: {
						provident_fund_member: true,
						provident_fund_registration_reference: 'PVD-plan-7',
						provident_fund_membership_reference: 'PVD-member-9'
					}
				}
			}
		})
	];
	const october = assessStatutory({ code: TH, period: '2026-10', people, headcount: 10 });
	expectStatutory(october, 'EWF-20000', 'EWF', 50, 50);
	expectStatutory(october, 'EWF-60000', 'EWF', 150, 150);
	expectStatutorySkipped(october, 'EWF-PVD', 'EWF');
	// The fund reads the s.5 wage, not the SSO base: SSO stays capped at 875.
	expectStatutory(october, 'EWF-60000', 'SSO', 875, 875);
	// Nine employees: outside s.130.
	const nine = assessStatutory({ code: TH, period: '2026-10', people, headcount: 9 });
	expectStatutorySkipped(nine, 'EWF-20000', 'EWF');
	// September 2026: no contribution yet — the version before 1 October has no EWF scheme.
	const september = assessStatutory({ code: TH, period: '2026-09', people, headcount: 10 });
	expectStatutorySkipped(september, 'EWF-20000', 'EWF');
});

test('Thailand — EWF voluntary membership below ten workers and provident-fund exclusion need dated evidence', () => {
	const voluntary = citizen('EWF-VOLUNTARY', 20_000, {
		registrations: {
			EWF: {
				kind: 'REGISTERED',
				elections: {
					voluntary_ewf_member: true,
					voluntary_ewf_consent_reference: 'worker-and-employer-consent-7',
					voluntary_ewf_certificate_reference: 'DLPW-certificate-9'
				}
			}
		}
	});
	const assessed = assessStatutory({
		code: TH,
		period: '2026-10',
		headcount: 9,
		people: [voluntary]
	});
	expectStatutory(assessed, 'EWF-VOLUNTARY', 'EWF', 50, 50);
	assert.throws(
		() =>
			assessStatutory({
				code: TH,
				period: '2026-10',
				headcount: 9,
				people: [
					citizen('EWF-VOLUNTARY', 20_000, {
						registrations: {
							EWF: {
								kind: 'REGISTERED',
								elections: { voluntary_ewf_member: true }
							}
						}
					})
				]
			}),
		/Voluntary EWF worker and employer consent reference is required/
	);
	assert.throws(
		() =>
			assessStatutory({
				code: TH,
				period: '2026-10',
				headcount: 10,
				people: [
					citizen('EWF-PVD-MISSING', 20_000, {
						registrations: {
							EWF: { kind: 'REGISTERED', elections: { provident_fund_member: true } }
						}
					})
				]
			}),
		/Qualifying provident fund registration reference is required/
	);
});

test('Thailand — the Employee Welfare Fund steps to 0.50% each side on 1 October 2031 (rate regulation B.E.2568 cl.3)', () => {
	// Ministerial Regulation on Employee Welfare Fund contribution rates B.E.2568 (Gazette vol.142
	// part 60 Kor pp.3–4, 15 September 2025; Gazette facsimile served by the Council of State,
	// https://www.ocs.go.th/searchlaw/power_link/download/eyJ1dWlkIjoiNDNjMTc4OTgtODFiMS00MmVhLWIwNmYtMjQ4YzM1NzlmMzFhIiwiZmlsZW5hbWUiOiLguIQwMDc3IOC4geC4juC4geC4o-C4sOC4l-C4o-C4p-C4hyAyNTY4LTYw4LiBLTMucGRmIn0.CH4M5nGGlUmG48thQPthO-j_qpRZ-5GpRKA0pnN9pw8,
	// read 28 September 2026): cl.3(1) 0.25%
	// each side 1 October 2026 – 30 September 2031; cl.3(2) 0.50% each side from 1 October 2031.
	// 20,000 × 0.25% = 50; × 0.50% = 100. 60,000 × 0.50% = 300 (no ceiling).
	// 15,330.40 × 0.25% = 38.326 → 38.33; × 0.50% = 76.652 → 76.65 (kept to the satang, TH-S4).
	const people = [
		citizen('EWF-20000', 20_000),
		citizen('EWF-60000', 60_000),
		citizen('EWF-SATANG', 15_330.4)
	];
	const september2031 = assessStatutory({ code: TH, period: '2031-09', people, headcount: 10 });
	expectStatutory(september2031, 'EWF-20000', 'EWF', 50, 50);
	expectStatutory(september2031, 'EWF-SATANG', 'EWF', 38.33, 38.33);
	const october2031 = assessStatutory({ code: TH, period: '2031-10', people, headcount: 10 });
	expectStatutory(october2031, 'EWF-20000', 'EWF', 100, 100);
	expectStatutory(october2031, 'EWF-60000', 'EWF', 300, 300);
	expectStatutory(october2031, 'EWF-SATANG', 'EWF', 76.65, 76.65);
	// The s.33 base stays THB20,000 to 31 December 2031 (base regulation cl.3(2)): 1,000 each side.
	expectStatutory(october2031, 'EWF-60000', 'SSO', 1_000, 1_000);
	const january2032 = assessStatutory({ code: TH, period: '2032-01', people, headcount: 10 });
	expectStatutory(january2032, 'EWF-60000', 'EWF', 300, 300);
	expectStatutory(january2032, 'EWF-60000', 'SSO', 1_150, 1_150);
});

test('Thailand — Gazette originals: EWF and s.33 base at each cl.3 boundary (TH-S3)', () => {
	// Read 28 September 2026 from the Gazette's own PDFs: Internet Archive captures of 84794 (decree
	// s.4: collection from 1 October 2026) and 86102 (rate regulation cl.3: 0.25% each side to
	// 30 September 2031, 0.5% from 1 October 2031), and the rendered pages of the SSO's copy of the
	// base regulation (47755, cl.3: THB1,650 floor; ceiling 17,500 to 2028, 20,000 2029–2031,
	// 23,000 from 2032). At 30,000 a month: SSO 5% of the ceiling, EWF 30,000 × 0.25% = 75 or
	// × 0.5% = 150.
	const people = [citizen('GZ-30000', 30_000)];
	const cases: ReadonlyArray<readonly [string, number, number | null]> = [
		['2026-09', 875, null],
		['2026-10', 875, 75],
		['2028-12', 875, 75],
		['2029-01', 1_000, 75],
		['2031-09', 1_000, 75],
		['2031-10', 1_000, 150],
		['2032-01', 1_150, 150]
	];
	for (const [period, sso, ewf] of cases) {
		const book = assessStatutory({ code: TH, period, people, headcount: 10 });
		expectStatutory(book, 'GZ-30000', 'SSO', sso, sso);
		if (ewf === null) expectStatutorySkipped(book, 'GZ-30000', 'EWF');
		else expectStatutory(book, 'GZ-30000', 'EWF', ewf, ewf);
	}
	const captures = [
		'https://web.archive.org/web/20260913004819/https://ratchakitcha.soc.go.th/documents/84794.pdf',
		'https://web.archive.org/web/20250919123501/https://ratchakitcha.soc.go.th/documents/86102.pdf'
	];
	for (const version of settingsVersions(TH)) {
		const text = JSON.stringify(version);
		if (!text.includes('documents/86102.pdf')) continue;
		for (const capture of captures)
			assert.ok(text.includes(capture), `${version.id} does not cite ${capture}`);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Personal income tax withholding (TH-PIT-01–03, -19, -20)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Thailand — s.50(1) withholding on the P.96/2543 annualised method, resident and non-resident alike', () => {
	// 60,000 a month, January 2026: × 12 = 720,000; expense 50% capped at 100,000 (s.42 bis);
	// personal 60,000; SSO 875 × 12 = 10,500 → 549,500 net. Tax: 27,500 + 49,500 × 15% = 34,925.
	// ÷ 12 = 2,910.4166… → 2,910.41 (truncated: s.50(1)'s remainder goes to the last payment).
	// A non-resident is withheld the same way: s.50(1) does not turn on residence and s.47(3) keeps
	// the personal allowance (spouse and child allowances only where the family is in Thailand).
	// 200,000 a month: 2,400,000 − 100,000 − 60,000 − 10,500 = 2,229,500 → 365,000 + 229,500 × 30% =
	// 433,850 ÷ 12 = 36,154.1666… → 36,154.16. 20,000 a month: 240,000 − 170,500 = 69,500 → nothing.
	const people = [
		citizen('PIT-60K', 60_000),
		citizen('PIT-60K-NR', 60_000, { citizenship: 'FOREIGNER', tax_residency: 'NON_RESIDENT' }),
		citizen('PIT-200K', 200_000),
		citizen('PIT-20K', 20_000)
	];
	const january = assessStatutory({ code: TH, period: '2026-01', people });
	expectStatutory(january, 'PIT-60K', 'PIT', 2_910.41, 0);
	expectStatutory(january, 'PIT-60K-NR', 'PIT', 2_910.41, 0);
	expectStatutory(january, 'PIT-200K', 'PIT', 36_154.16, 0);
	expectStatutory(january, 'PIT-20K', 'PIT', 0, 0);
	// A foreign employee is insured like anyone else (the Act sets no nationality test).
	expectStatutory(january, 'PIT-60K-NR', 'SSO', 875, 875);
	// December 2026 adds the year's remainder: 34,925 − 12 × 2,910.41 = 0.08 → 2,910.49.
	const december = assessStatutory({ code: TH, period: '2026-12', people });
	expectStatutory(december, 'PIT-60K', 'PIT', 2_910.49, 0);
	// 433,850 − 12 × 36,154.16 = 0.08 → 36,154.24.
	expectStatutory(december, 'PIT-200K', 'PIT', 36_154.24, 0);
	// June and October 2026 (the 1 June and 1 October versions): the same 2,910.41.
	for (const period of ['2026-06', '2026-10'])
		expectStatutory(assessStatutory({ code: TH, period, people }), 'PIT-60K', 'PIT', 2_910.41, 0);
	// Tax year 2025 (December 2025, the 7 December version): the SSO relief is 750 × 12 = 9,000 →
	// 551,000 net → 27,500 + 51,000 × 15% = 35,150 ÷ 12 = 2,929.1666… → 2,929.16, and December
	// carries the remainder 35,150 − 12 × 2,929.16 = 0.08 → 2,929.24.
	expectStatutory(
		assessStatutory({ code: TH, period: '2025-12', people }),
		'PIT-60K',
		'PIT',
		2_929.24,
		0
	);
});

test('Thailand — a bonus is withheld whole in its month as the annual-tax difference (P.96/2543 cl.1(5)); it is outside the SSO wage', () => {
	// March 2026, 60,000 + 120,000 bonus. Regular annual tax 34,925 (above). With the bonus: 840,000 −
	// 100,000 − 60,000 − 10,500 = 669,500 → 27,500 + 169,500 × 15% = 52,925; the bonus's tax 18,000.
	// Withheld: 2,910.41 + 18,000 = 20,910.41. SSO: a discretionary bonus is not pay for normal
	// working time (SSA s.5) — base 60,000, 875.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-03', people: [citizen('BONUS-MAR', 60_000)] },
		(world) =>
			adhoc(
				world,
				'BONUS-MAR',
				'BONUS',
				120_000,
				'2026-03-15',
				'd0000000-0000-4000-8000-0000000000b1'
			)
	);
	const slip = slips.get('BONUS-MAR')!;
	assert.equal(slip.gross, 180_000);
	assert.deepEqual(charge(slip, 'SSO'), [60_000, 875, 875]);
	assert.deepEqual(charge(slip, 'PIT'), [180_000, 20_910.41, 0]);
	assert.equal(slip.net, 158_214.59); // 180,000 − 875 − 20,910.41
	// A 13th month in December 2026: 60,000 + 60,000. With it 780,000 → 609,500 net → 27,500 +
	// 109,500 × 15% = 43,925; its tax 9,000. December's regular 2,910.41 + remainder 0.08 + 9,000 =
	// 11,910.49.
	const december = buildStatutory(
		{ code: TH, period: '2026-12', people: [citizen('BONUS-DEC', 60_000)] },
		(world) =>
			adhoc(
				world,
				'BONUS-DEC',
				'BONUS',
				60_000,
				'2026-12-15',
				'd0000000-0000-4000-8000-0000000000b2'
			)
	).slips.get('BONUS-DEC')!;
	assert.deepEqual(charge(december, 'PIT'), [120_000, 11_910.49, 0]);
	// October 2026 bonus: outside the Employee Welfare Fund wage too (SSA s.5 / LPA s.5 wage).
	const october = buildStatutory(
		{ code: TH, period: '2026-10', headcount: 10, people: [citizen('BONUS-OCT', 20_000)] },
		(world) =>
			adhoc(
				world,
				'BONUS-OCT',
				'BONUS',
				100_000,
				'2026-10-15',
				'd0000000-0000-4000-8000-0000000000b3'
			)
	).slips.get('BONUS-OCT')!;
	assert.deepEqual(charge(october, 'EWF'), [20_000, 50, 50]);
});

test('Thailand — a mid-year joiner annualises over the payments actually due that year (P.96/2543 cl.1(1)); the part month on calendar days', () => {
	// Hired Thursday 16 April 2026 at 60,000. Premise (TH-WORK-05): 15 of April's 30 calendar days =
	// 30,000. P.96 cl.1(1): hired in April with monthly pay, 9 payments are due that year (its own
	// example: hired 1 April → 9). April: 30,000 × 9 = 270,000 − 100,000 − 60,000 − 875 × 9 (7,875) =
	// 102,125 → under 150,000, nothing. May: 60,000 × 9 = 540,000 − 167,875 = 372,125 → 7,500 +
	// 72,125 × 10% = 14,712.50 ÷ 9 = 1,634.7222… → 1,634.72.
	const person = citizen('JOIN-APR', 60_000, { hire_date: '2026-04-16' });
	const april = buildStatutory({ code: TH, period: '2026-04', people: [person] }).slips.get(
		'JOIN-APR'
	)!;
	assert.deepEqual(
		april.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[15, 30, 30_000]]
	);
	assert.deepEqual(charge(april, 'SSO'), [30_000, 875, 875]);
	assert.deepEqual(charge(april, 'PIT'), [30_000, 0, 0]);
	const may = assessStatutory({ code: TH, period: '2026-05', people: [person] });
	expectStatutory(may, 'JOIN-APR', 'PIT', 1_634.72, 0);
});

test('Thailand — a raise inside the month prices each salary on its own calendar days, and PIT recomputes on the new payment (cl.1(4))', () => {
	// 62,000 to Thursday 15 January 2026, 93,000 from the 16th (premise TH-WORK-05): 62,000 × 15/31
	// = 30,000 + 93,000 × 16/31 = 48,000 → 78,000. SSO capped: 875. PIT on the payment × 12:
	// 936,000 − 100,000 − 60,000 − 10,500 = 765,500 → 65,000 + 15,500 × 20% = 68,100 ÷ 12 = 5,675.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-01', people: [citizen('RAISE', 62_000)] },
		(world) => {
			const old = world.employment_terms[0]!;
			world.employment_terms.push({
				...old,
				id: 'b0000000-0000-4000-8000-00000000a001',
				base_salary: 93_000,
				effective_range: { start: '2026-01-16', end: null }
			});
			old.effective_range = { start: '2015-01-01', end: '2026-01-15' };
		}
	);
	const slip = slips.get('RAISE')!;
	assert.equal(slip.gross, 78_000);
	assert.deepEqual(charge(slip, 'SSO'), [78_000, 875, 875]);
	assert.deepEqual(charge(slip, 'PIT'), [78_000, 5_675, 0]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Unpaid leave (premise TH-WORK-05)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Thailand — two days of unpaid leave come off at the calendar-day rate and out of the SSO and PIT bases', () => {
	// 62,000 in January 2026 (31 days): 2,000 a day (premise TH-WORK-05), two days = 4,000 → 58,000.
	// SSO 58,000 → capped, 875. PIT: 58,000 × 12 = 696,000 − 170,500 = 525,500 → 27,500 + 25,500 ×
	// 15% = 31,325 ÷ 12 = 2,610.4166… → 2,610.41.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-01', people: [citizen('NPL', 62_000)] },
		(world) => unpaidDays(world, 'NPL', ['2026-01-14', '2026-01-15'])
	);
	const slip = slips.get('NPL')!;
	assert.equal(slip.gross, 58_000);
	assert.deepEqual(charge(slip, 'SSO'), [58_000, 875, 875]);
	assert.deepEqual(charge(slip, 'PIT'), [58_000, 2_610.41, 0]);
});

test('Thailand — December 2025: days before 7 December are priced from the pre-No.9 version’s rows', () => {
	// Labour Protection Act No.9 B.E.2568 s.2: in force 7 December 2025. The 1–6 December version
	// differs from the 7 December one only in its leave rows (maternity, child-birth, child-care);
	// the run is picked on the period end, and each charged day is priced from the row its charge
	// names. 62,000 over December's 31 days: 2,000 a day (premise TH-WORK-05), two days off →
	// 58,000. SSO capped at December's 15,000: 750 each side.
	const { slips } = buildStatutory(
		{ code: TH, period: '2025-12', people: [citizen('NPL-DEC', 62_000)] },
		(world) => unpaidDays(world, 'NPL-DEC', ['2025-12-02', '2025-12-03'])
	);
	const slip = slips.get('NPL-DEC')!;
	assert.equal(settingsIdOn(TH, '2025-12-02'), settingsVersions(TH)[0]!.id);
	assert.equal(slip.gross, 58_000);
	assert.deepEqual(charge(slip, 'SSO'), [58_000, 750, 750]);
});

test('Thailand — one maternity event crossing the No.9 commencement requires transition review at approval and payroll', () => {
	// Gazette Act No.9 s.2: https://ratchakitcha.soc.go.th/documents/89818.pdf. It gives no
	// express rule for a pregnancy already on leave when the 98/45 limits become 120/60.
	const pre = '2025-12-06';
	const post = '2025-12-07';
	const event = '2025-12-07';
	const row = (date: string) =>
		rowIn(leaveCatalogue(TH), settingsIdOn(TH, date), 'MATERNITY_LEAVE');
	const context = leaveContext();
	context.companies[0]!.settings_code = TH;
	context.versions = [...settingsVersions(TH)] as never;
	context.catalogues = [...leaveCatalogue(TH)] as never;
	const request = (date: string, reference: string) => ({
		employment_id: context.employments[0]!.id,
		catalogue_id: row(date),
		reference,
		from_date: date,
		to_date: date,
		days: null,
		event_kind: 'BIRTH',
		event_date: event
	});
	assert.throws(
		() => planLeaveActivity(context, { ...request(pre, 'CROSS'), to_date: post }, 'th-cross'),
		/MATERNITY_LEAVE.*2025-12-07.*transition/i
	);
	const first = planLeaveActivity(context, request(pre, 'PRE'), 'th-pre');
	context.entries.push({ ...first, id: 'th-pre', approval_id: null } as never);
	assert.throws(
		() => planLeaveActivity(context, request(post, 'POST'), 'th-post'),
		/MATERNITY_LEAVE.*2025-12-07.*transition/i
	);
	const postOnly = leaveContext();
	postOnly.companies[0]!.settings_code = TH;
	postOnly.versions = [...settingsVersions(TH)] as never;
	postOnly.catalogues = [...leaveCatalogue(TH)] as never;
	assert.doesNotThrow(() =>
		planLeaveActivity(postOnly, request(post, 'POST-ONLY'), 'th-post-only')
	);
	assert.throws(
		() =>
			buildStatutory(
				{
					code: TH,
					period: '2025-12',
					people: [citizen('CROSS-ML', 62_000, { gender: 'FEMALE' })]
				},
				(world) => {
					withLeaveCatalogue(world);
					const employment = world.employments.find(
						(person) => person.employee_number === 'CROSS-ML'
					)!;
					const term = world.employment_terms.find(
						(person) => person.employment_id === employment.id
					)!;
					for (const [index, date] of [pre, post].entries())
						world.leave_entries.push({
							id: `th-transition-${index}`,
							employment_id: employment.id,
							catalogue_id: row(date),
							leave_code: 'MATERNITY_LEAVE',
							reference: `TRANSITION-${index}`,
							from_date: date,
							to_date: date,
							days: 1,
							effective_on: date,
							event_kind: 'BIRTH',
							event_date: event,
							allocations: [],
							charges: [
								{
									date,
									days: 1,
									catalogue_id: row(date),
									employment_term_id: term.id,
									holiday_id: null,
									shift_definition_id: null,
									work_day_id: null
								}
							],
							approval_id: null
						} as never);
				}
			),
		/MATERNITY_LEAVE.*2025-12-07.*transition/i
	);
});

test('Thailand — s.41/s.59 as amended by No.9: 120 days of maternity leave, the first 60 paid (TH-LEAVE-01)', () => {
	// Council of State consolidation: s.41 para.1 up to 120 days for one pregnancy, para.3 holidays
	// counted; s.59 wages for the leave days but not more than 60. Leave 11 January–10 May 2026 is
	// 21 + 28 + 31 + 30 + 10 = 120 calendar days; day 60 is 11 March (21 + 28 + 11), so 12 March
	// onward is unpaid. The March payslip's attendance window (21 February–20 March, cutoff 21)
	// and its entry (day 42 onward of the leave) hold nine unpaid days, 12–20 March, at March's calendar-day rate 62,000 ÷ 31 = 2,000
	// (premise TH-WORK-05): 62,000 − 18,000 = 44,000. SSO capped at 17,500: 875 each side. PIT:
	// 44,000 × 12 = 528,000 − 100,000 − 60,000 − 875 × 12 = 357,500 → 7,500 + 57,500 × 10% =
	// 13,250 ÷ 12 = 1,104.1666… → 1,104.16.
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: [
				citizen('ML', 62_000, { gender: 'FEMALE' }),
				citizen('ML-DAILY', 800, { gender: 'FEMALE', pay_frequency: 'DAILY' }),
				citizen('ML-HOURLY', 100, { gender: 'FEMALE', pay_frequency: 'HOURLY' })
			]
		},
		(world) => {
			withLeaveCatalogue(world);
			const dates: string[] = [];
			for (let day = Date.UTC(2026, 0, 11); day <= Date.UTC(2026, 4, 10); day += 86_400_000)
				dates.push(new Date(day).toISOString().slice(0, 10));
			assert.equal(dates.length, 120);
			const row = (date: string) =>
				rowIn(leaveCatalogue(TH), settingsIdOn(TH, date), 'MATERNITY_LEAVE');
			// One entry per payroll window (an entry settles whole in one period), all naming the
			// same birth: the leave is the event, so day 61 is 12 March in whichever entry holds it.
			const cuts = ['2026-01-21', '2026-02-21', '2026-03-21', '2026-04-21'];
			const blocks = Object.values(
				Object.groupBy(dates, (date) => String(cuts.filter((cut) => date >= cut).length))
			) as string[][];
			for (const [personIndex, key] of ['ML', 'ML-DAILY', 'ML-HOURLY'].entries()) {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
				for (const [index, block] of blocks.entries())
					world.leave_entries.push({
						id: `e3000000-0000-4000-8000-${String(personIndex * 10 + index).padStart(12, '0')}`,
						employment_id: employment.id,
						catalogue_id: row(block[0]!),
						leave_code: 'MATERNITY_LEAVE',
						reference: `ML-${index}`,
						from_date: block[0]!,
						to_date: block.at(-1)!,
						half_day_start: false,
						half_day_end: false,
						days: block.length,
						effective_on: block[0]!,
						event_kind: 'BIRTH',
						event_date: '2026-02-01',
						reason: 'ลาเพื่อคลอดบุตร',
						allocations: [],
						charges: block.map((date) => ({
							date,
							days: 1,
							catalogue_id: row(date),
							employment_term_id: term.id,
							holiday_id: null,
							shift_definition_id: null,
							work_day_id: null
						})),
						approval_id: null
					} as never);
			}
		}
	);
	const slip = slips.get('ML')!;
	assert.equal(slip.gross, 44_000);
	// The March salary window includes all 31 calendar leave days; this cutoff deducts 12–20 March.
	assert.equal(slips.get('ML-DAILY')?.gross, 17_600);
	assert.equal(slips.get('ML-HOURLY')?.gross, 17_600);
	assert.deepEqual(charge(slip, 'SSO'), [44_000, 875, 875]);
	assert.deepEqual(charge(slip, 'PIT'), [44_000, 1_104.16, 0]);
	// Every version cites the Council of State LPA consolidation, never the Ministry's 2019 copy.
	const consolidation =
		'https://searchlaw.ocs.go.th/council-of-state/#/public/doc/ZGN3NXk0eENvNjBSdjRnT2NsdjFTQT09';
	for (const row of [...settingsVersions(TH), ...contributionSchemes(TH), ...adhocCatalogue(TH)])
		assert.ok(!JSON.stringify(row).includes('labour_protection_2541_new62'), `${row.id} cites it`);
	for (const version of settingsVersions(TH))
		assert.ok(
			JSON.stringify(version).includes(consolidation),
			`${version.id} lacks the consolidation`
		);
});

test('Thailand — piece-paid maternity refuses until the s.60 prior-period wage is available', () => {
	assert.throws(
		() =>
			buildStatutory(
				{
					code: TH,
					period: '2026-03',
					people: [
						citizen('ML-PIECE', 800, {
							gender: 'FEMALE',
							pay_frequency: 'DAILY',
							statutory_work_category: 'PIECE_RATE'
						})
					]
				},
				(world) => {
					withLeaveCatalogue(world);
					const employment = world.employments.find((row) => row.employee_number === 'ML-PIECE')!;
					const term = world.employment_terms.find((row) => row.employment_id === employment.id)!;
					const date = '2026-03-08';
					const catalogue_id = rowIn(leaveCatalogue(TH), settingsIdOn(TH, date), 'MATERNITY_LEAVE');
					world.leave_entries.push({
						id: 'e3000000-0000-4000-8000-000000000100',
						employment_id: employment.id,
						catalogue_id,
						leave_code: 'MATERNITY_LEAVE',
						reference: 'ML-PIECE',
						from_date: date,
						to_date: date,
						half_day_start: false,
						half_day_end: false,
						days: 1,
						effective_on: date,
						event_kind: 'BIRTH',
						event_date: date,
						allocations: [],
						charges: [
							{
								date,
								days: 1,
								catalogue_id,
								employment_term_id: term.id,
								holiday_id: null,
								shift_definition_id: null,
								work_day_id: null
							}
						],
						approval_id: null
					} as never);
				}
			),
		/preceding wage-period average required by Thai LPA s\.60/
	);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Overtime and holiday work (TH-WORK-02, -05, -06)
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('Thailand — under-18 work needs a timed rest and cannot include overtime or holiday work (LPA ss.46, 48)', () => {
	// Official LPA ss.46 and 48: https://www.mol.go.th/wp-content/uploads/sites/2/2018/03/301.pdf.
	const settle = (
		override?: readonly [string, string, string, string],
		extraWork?: 'OVERTIME' | 'HOLIDAY' | 'SHORT_NO_REST'
	) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('MINOR-REST', 12_000, { age: 17 })] },
			(world) => {
				for (
					let instant = Date.UTC(2025, 11, 21);
					instant <= Date.UTC(2026, 0, 31);
					instant += 86_400_000
				) {
					const date = new Date(instant).toISOString().slice(0, 10);
					const weekday = new Date(instant).getUTCDay();
					if (weekday === 0 || weekday === 6) continue;
					punch(world, 'MINOR-REST', date, '09:00', '13:00');
					const row = world.work_days.at(-1)!;
					row.worked_intervals = [
						{
							start: `${date}T09:00:00+07:00`,
							end: `${date}T${override?.[0] === date ? override[1] : '13:00'}:00+07:00`
						},
						{
							start: `${date}T${override?.[0] === date ? override[2] : '14:00'}:00+07:00`,
							end: `${date}T${override?.[0] === date ? override[3] : '18:00'}:00+07:00`
						}
					];
				}
				if (extraWork === 'OVERTIME') {
					const date = '2026-01-05';
					const day = world.work_days.find((row) => row.work_date === date)!;
					day.worked_intervals = [
						...(day.worked_intervals ?? []),
						{ start: `${date}T19:00:00+07:00`, end: `${date}T20:00:00+07:00` }
					];
				}
				if (extraWork === 'SHORT_NO_REST') {
					const date = '2026-01-05';
					world.work_days.find((row) => row.work_date === date)!.worked_intervals = [
						{ start: `${date}T09:00:00+07:00`, end: `${date}T13:00:00+07:00` }
					];
				}
				if (extraWork === 'HOLIDAY') punch(world, 'MINOR-REST', '2026-01-10', '09:00', '13:00');
			}
		);
	assert.equal(settle().slips.get('MINOR-REST')!.gross, 12_000);
	assert.throws(
		() => settle(['2026-01-05', '13:01', '14:01', '18:00']),
		/continuous 60-minute rest.*four hours/i
	);
	assert.throws(
		() => settle(['2026-01-05', '13:00', '13:30', '17:30']),
		/continuous 60-minute rest.*four hours/i
	);
	assert.throws(
		() => settle(undefined, 'SHORT_NO_REST'),
		/continuous 60-minute rest on the Thai under-18 workday/i
	);
	assert.throws(() => settle(undefined, 'OVERTIME'), /cannot work overtime.*under 18/i);
	assert.throws(() => settle(undefined, 'HOLIDAY'), /cannot work on a Thai holiday.*under 18/i);
	assert.throws(
		() =>
			buildStatutory({
				code: TH,
				period: '2026-01',
				people: [citizen('MINOR-UNRECORDED', 12_000, { age: 17 })]
			}),
		/timed work and rest records/i
	);
});

test('Thailand — s.27 needs timed rest, prior agreement for split breaks and 20 minutes before long overtime', () => {
	// LPA s.27: https://www.mol.go.th/wp-content/uploads/sites/2/2018/03/301.pdf.
	const run = (
		change: 'NO_TIME' | 'LATE' | 'OVER_TWO' | 'SPLIT' | 'SHORT_PRE_OT' | 'VALID_PRE_OT',
		agreement?: string
	) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('ADULT-REST', 24_000)] },
			(world) => {
				if (change === 'NO_TIME' || change === 'LATE') {
					const shift = world.shift_definitions.find((row) => row.code === 'DAY')!;
					shift.variant = {
						kind: 'WORK',
						start_time: '09:00',
						end_time: '18:00',
						break_minutes: 60,
						...(change === 'LATE' ? { break_start_time: '15:00' } : {})
					};
					return;
				}
				const date = '2026-01-05';
				punch(
					world,
					'ADULT-REST',
					date,
					'09:00',
					change === 'SPLIT' || change === 'OVER_TWO' ? '18:00' : '21:00',
					change === 'SPLIT' || change === 'OVER_TWO' ? 0 : 3
				);
				const day = world.work_days.at(-1)!;
				if (change === 'SPLIT') {
					day.worked_intervals = [
						{ start: `${date}T09:00:00+07:00`, end: `${date}T11:00:00+07:00` },
						{ start: `${date}T11:30:00+07:00`, end: `${date}T13:30:00+07:00` },
						{ start: `${date}T14:00:00+07:00`, end: `${date}T18:00:00+07:00` }
					];
					day.th_split_break_agreed_at = agreement ?? null;
				}
				if (change === 'OVER_TWO')
					day.worked_intervals = [
						{ start: `${date}T09:00:00+07:00`, end: `${date}T11:00:00+07:00` },
						{ start: `${date}T14:00:00+07:00`, end: `${date}T18:00:00+07:00` }
					];
				if (change === 'SHORT_PRE_OT')
					day.worked_intervals = [
						{ start: `${date}T09:00:00+07:00`, end: `${date}T13:00:00+07:00` },
						{ start: `${date}T14:00:00+07:00`, end: `${date}T18:00:00+07:00` },
						{ start: `${date}T18:05:00+07:00`, end: `${date}T21:05:00+07:00` }
					];
			}
		);
	assert.throws(
		() => run('NO_TIME'),
		/over five consecutive hours without a timed Thai s\.27 break/i
	);
	assert.throws(() => run('LATE'), /over five consecutive hours without a timed Thai s\.27 break/i);
	assert.throws(() => run('OVER_TWO'), /Thai s\.27 wage treatment for rest over two hours/i);
	assert.throws(() => run('SPLIT'), /prior split-break agreement/i);
	assert.throws(() => run('SPLIT', '2026-01-05T10:00:00+07:00'), /prior split-break agreement/i);
	assert.equal(run('SPLIT', '2026-01-04T12:00:00+07:00').slips.get('ADULT-REST')!.gross, 24_000);
	assert.throws(() => run('SHORT_PRE_OT'), /timed 20-minute rest before Thai overtime/i);
	assert.deepEqual(workLines(run('VALID_PRE_OT').slips.get('ADULT-REST')!), [
		['2026-01-05', 'OT-1.5X', 3, 450]
	]);
});

test('Thailand — under-18 night work requires prior written Director-General permission (LPA s.47)', () => {
	const run = (grantedAt: string | null, reference: string | null) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('MINOR-NIGHT', 12_000, { age: 17 })] },
			(world) => {
				for (
					let instant = Date.UTC(2025, 11, 21);
					instant <= Date.UTC(2026, 0, 31);
					instant += 86_400_000
				) {
					const date = new Date(instant).toISOString().slice(0, 10);
					const weekday = new Date(instant).getUTCDay();
					if (weekday === 0 || weekday === 6) continue;
					punch(world, 'MINOR-NIGHT', date, '09:00', '18:00');
				}
				const night = {
					...world.shift_definitions[0]!,
					id: 'th-minor-night',
					code: 'MINOR-NIGHT',
					variant: {
						kind: 'WORK',
						start_time: '21:00',
						end_time: '06:00',
						break_minutes: 60,
						break_start_time: '01:00'
					}
				};
				world.shift_definitions.push(night as never);
				const date = '2026-01-05';
				const day = world.work_days.find((row) => row.work_date === date)!;
				day.shift_definition_id = night.id;
				day.worked_intervals = [
					{ start: `${date}T21:00:00+07:00`, end: `2026-01-06T01:00:00+07:00` },
					{ start: `2026-01-06T02:00:00+07:00`, end: `2026-01-06T06:00:00+07:00` }
				];
				day.th_minor_night_permission_granted_at = grantedAt;
				day.th_minor_night_permission_reference = reference;
			}
		);
	assert.throws(() => run(null, null), /prior written Thai Director-General permission/i);
	assert.throws(
		() => run('2026-01-05T22:30:00+07:00', 'DG-123'),
		/prior written Thai Director-General permission/i
	);
	assert.equal(run('2026-01-04T12:00:00+07:00', 'DG-123').slips.get('MINOR-NIGHT')!.gross, 12_000);
});

test('Thailand — pregnancy status gates night, holiday and overtime work (LPA s.39/1)', () => {
	// https://www.mol.go.th/wp-content/uploads/sites/2/2018/03/301.pdf, s.39/1.
	const run = (status: 'PREGNANT' | 'NOT_PREGNANT' | null, holiday = false) =>
		buildStatutory(
			{
				code: TH,
				period: '2026-01',
				people: [citizen('PREGNANT-WORK', 24_000, { gender: 'FEMALE' })]
			},
			(world) => {
				world.employment_terms[0]!.th_pregnancy_status = status;
				if (holiday) punch(world, 'PREGNANT-WORK', '2026-01-10', '09:00', '18:00', 8);
				else punch(world, 'PREGNANT-WORK', '2026-01-05', '09:00', '21:00', 3);
			}
		);
	assert.throws(() => run(null), /dated Thai pregnancy status/i);
	assert.throws(() => run('PREGNANT'), /supported Thai s\.39\/1 role and health evidence/i);
	assert.throws(
		() => run('PREGNANT', true),
		/cannot perform Thai night or holiday work while pregnant/i
	);
	assert.deepEqual(workLines(run('NOT_PREGNANT').slips.get('PREGNANT-WORK')!), [
		['2026-01-05', 'OT-1.5X', 3, 450]
	]);
});

test('Thailand — s.61 1.5×, s.62(1) +1× holiday work, s.63 3× holiday overtime at monthly ÷ 30 ÷ 8 (s.68)', () => {
	// 24,000 a month: s.68 hourly rate 24,000 ÷ (30 × 8) = 100.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-01', people: [citizen('OT-24K', 24_000)] },
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-01-01', 'New Year’s Day'));
			punch(world, 'OT-24K', '2026-01-05', '09:00', '21:00', 3); // Monday: 11 worked, 3 beyond the day
			punch(world, 'OT-24K', '2026-01-10', '09:00', '18:00', 9); // Saturday weekly holiday: 9 worked
			punch(world, 'OT-24K', '2026-01-01', '09:00', '18:00', 8); // traditional holiday: the normal day
		}
	);
	const slip = slips.get('OT-24K')!;
	assert.deepEqual(workLines(slip), [
		// s.62(1): a monthly-paid employee is paid for the traditional holiday (s.56(2)); work on it
		// earns at least one more hourly rate per hour: 8 × 100.
		['2026-01-01', 'HOL-1.0X', 8, 800],
		// s.61: three hours beyond the normal day at 1.5 × 100.
		['2026-01-05', 'OT-1.5X', 3, 450],
		// s.62(1) for the eight normal hours of the weekly holiday (a monthly wage pays it, s.56(1)),
		// s.63 3× for the ninth.
		['2026-01-10', 'HOL-1.0X', 8, 800],
		['2026-01-10', 'OT-3.0X', 1, 300]
	]);
	assert.equal(slip.gross, 24_000 + 2_350);
	// SSA s.5: overtime and holiday-work pay are outside the contributory wage.
	assert.deepEqual(charge(slip, 'SSO'), [24_000, 875, 875]);
	// PIT (cl.1(5)): 288,000 and 290,350 annualised are both under the exempt band after 170,500 of
	// deductions — nothing withheld.
	assert.deepEqual(charge(slip, 'PIT'), [26_350, 0, 0]);
});

test('Thailand — guarding duty uses the 2009/2026 overtime cutover on 24 April 2026 (TH-WORK-03)', () => {
	// 24,000 ÷ 30 ÷ 8 = 100/hour. The 2009 regulation paid one ordinary hour for each
	// overtime hour; the 2025 regulation starts after 365 days on 24 April 2026 and requires
	// 1.25× on a workday or 2.5× for holiday overtime. Holiday first-eight-hour pay stays s.62.
	// Each day's hours settle in the payslip whose own attendance window (21st–20th) holds them,
	// so 18 April is a 2026-04 payslip and 23–25 April a 2026-05 one.
	const guard = (period: string, days: ReadonlyArray<readonly [string, string, number]>) =>
		buildStatutory(
			{
				code: TH,
				period,
				people: [citizen('GUARD', 24_000, { statutory_work_category: 'GUARD_DUTY' })]
			},
			(world) => {
				for (const [date, end, approved] of days) {
					punch(world, 'GUARD', date, '09:00', end);
					world.work_days.at(-1)!.approved_overtime_hours = approved;
				}
			}
		).slips.get('GUARD')!;
	const under2009 = guard('2026-04', [['2026-04-18', '18:00', 9]]);
	const after2026 = guard('2026-05', [
		['2026-04-23', '21:00', 3],
		['2026-04-24', '21:00', 3],
		['2026-04-25', '18:00', 9]
	]);
	assert.deepEqual(
		[...workLines(under2009), ...workLines(after2026)],
		[
			['2026-04-18', 'GUARD-HOL-OT-1.0X', 1, 100],
			['2026-04-18', 'HOL-1.0X', 8, 800],
			['2026-04-23', 'GUARD-OT-1.0X', 3, 300],
			['2026-04-24', 'GUARD-OT-1.25X', 3, 375],
			['2026-04-25', 'GUARD-HOL-OT-2.5X', 1, 250],
			['2026-04-25', 'HOL-1.0X', 8, 800]
		]
	);
});

test('Thailand — on a seven-hour normal day the s.68 hour is monthly ÷ (30 × 7) and the eighth hour is s.61 overtime (TH-WORK-05)', () => {
	// s.68: the hourly rate of a monthly wage is monthly ÷ (30 × the normal working hours a day); s.5
	// overtime is work beyond the normal working hours. A roster of 09:00–17:00 less a one-hour break
	// is a seven-hour normal day (the day s.23 caps hazardous work at). 21,000 ÷ (30 × 7) = 100.
	// Monday 5 January 2026 09:00–21:00 less the break: 11 worked, 4 beyond the day, 4 × 1.5 × 100.
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-01', people: [citizen('SEVEN-H', 21_000)] },
		(world) => {
			for (const row of world.shift_definitions)
				if (row.variant.kind === 'WORK')
					row.variant = {
						kind: 'WORK',
						start_time: '09:00',
						end_time: '17:00',
						break_minutes: 60,
						break_start_time: '13:00'
					};
			punchSeven(world, 'SEVEN-H', '2026-01-05', '21:00', 4);
		}
	);
	const slip = slips.get('SEVEN-H')!;
	assert.deepEqual(workLines(slip), [['2026-01-05', 'OT-1.5X', 4, 600]]);
	assert.equal(slip.gross, 21_600);
});

test('Thailand — overtime is withheld as an occasional payment (P.96/2543 cl.1(5)), and s.65(1) managers earn no overtime', () => {
	// 60,000 (hourly 250): Monday 5 January 2026 09:00–21:00, three hours at 1.5 × 250 = 1,125.
	// PIT: regular 34,925; with the overtime 721,125 → 550,625 net → 27,500 + 50,625 × 15% =
	// 35,093.75; the overtime's tax 168.75. 2,910.41 + 168.75 = 3,079.16.
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-01',
			people: [
				citizen('OT-60K', 60_000),
				citizen('OT-MGR', 60_000, { work_classification: 'MANAGERIAL' })
			]
		},
		(world) => {
			punch(world, 'OT-60K', '2026-01-05', '09:00', '21:00', 3);
			// s.65(1): the manager's hours are stated — eleven on the Monday, eight on the weekly
			// holiday — and the plan records them. s.65(1)/s.66 gives the manager no s.61–63
			// entitlement, so nothing is priced for them.
			punch(world, 'OT-MGR', '2026-01-05', '09:00', '21:00', 3);
			punch(world, 'OT-MGR', '2026-01-10', '09:00', '18:00', 8);
		}
	);
	const slip = slips.get('OT-60K')!;
	assert.deepEqual(workLines(slip), [['2026-01-05', 'OT-1.5X', 3, 1_125]]);
	assert.deepEqual(charge(slip, 'PIT'), [61_125, 3_079.16, 0]);
	// s.65(1), s.66: authority to hire, reward or dismiss — no overtime, holiday overtime or holiday-
	// work pay.
	assert.deepEqual(workLines(slips.get('OT-MGR')!), []);
	assert.deepEqual(charge(slips.get('OT-MGR')!, 'PIT'), [60_000, 2_910.41, 0]);
});

test('Thailand — a daily-paid employee working the weekly holiday is paid 2× (s.62(2))', () => {
	// 800 a day: the hourly rate is 800 ÷ 8 = 100. The weekly holiday is unpaid to a daily-paid
	// employee (s.56(1)), so eight hours on Saturday 10 January 2026 earn 8 × 2 × 100 = 1,600.
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-01',
			people: [citizen('DAILY', 800, { pay_frequency: 'DAILY', worksite: 'Bangkok' })]
		},
		(world) => punch(world, 'DAILY', '2026-01-10', '09:00', '17:00', 8)
	);
	assert.deepEqual(workLines(slips.get('DAILY')!), [['2026-01-10', 'HOL-2.0X', 8, 1_600]]);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Exit (TH-EXIT-02, -03)
// ─────────────────────────────────────────────────────────────────────────────────────────────

const encashOnExit = (world: PayrollWorld, key: string, id: string, days: number, exit: string) => {
	withLeaveCatalogue(world);
	const employment = world.employments.find((row) => row.employee_number === key)!;
	const catalogueId = rowIn(leaveCatalogue(TH), settingsIdOn(TH, exit), 'ANNUAL_LEAVE');
	world.leave_entries.push({
		id,
		employment_id: employment.id,
		catalogue_id: catalogueId,
		leave_code: 'ANNUAL_LEAVE',
		reference: `exit:${employment.id}:ANNUAL_LEAVE`,
		from_date: '2026-01-01',
		to_date: '2026-12-31',
		days,
		encash_days: days,
		effective_on: exit,
		due_on: exit,
		charges: [],
		allocations: [],
		approval_id: null,
		payslip_id: null,
		as_adjustment_entry: false
	} as never);
};

test('Thailand — a retrenched leaver: part month, s.67 leave pay, s.118 severance and the final withholding', () => {
	// 60,000, employed since 1 January 2015, retrenched on Sunday 15 March 2026 (premise TH-WORK-05).
	// Salary: 15 of March's 31 calendar days = 29,032.258… → 29,032.26.
	// s.67: the year's annual leave pro rata; the day count is the leave engine's (the Act says
	// "ตามส่วน" without a measure) — 1.5 days planted here — each at 60,000 ÷ 30 = 2,000 → 3,000.
	// s.118(5): eleven years' service, 300 days' last wage: 300 × 2,000 = 600,000.
	// SSO: the s.5 wage is the salary alone — 29,032.26 → capped, 875.
	// PIT: regular 29,032.26 × 12 = 348,387.12 − 100,000 − 60,000 − 10,500 = 177,887.12 → 27,887.12 ×
	// 5% = 1,394.356 ÷ 12 = 116.196… → 116.19; the leave pay (cl.1(5)) 351,387.12 → 180,887.12 →
	// 1,544.356, its tax 150.00 → 266.19. Severance is a one-time exit payment outside P.96 cl.1 and
	// taxed under s.48(5) (TH-PIT-05, not modelled) — it enters no base here.
	const { slips, warnings } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: [citizen('LEAVER', 60_000, { exit_date: '2026-03-15', exit_reason: 'RETRENCHMENT' })]
		},
		(world) => {
			encashOnExit(world, 'LEAVER', 'a3000000-0000-4000-8000-0000000000a1', 1.5, '2026-03-15');
			adhoc(
				world,
				'LEAVER',
				'SEVERANCE_PAY',
				0,
				'2026-03-15',
				'd0000000-0000-4000-8000-0000000000c1'
			);
		}
	);
	const slip = slips.get('LEAVER')!;
	assert.deepEqual(
		slip.proration
			.filter((row) => row.component_code === 'BASIC')
			.map((row) => [row.days, row.denominator, row.prorated_amount]),
		[[15, 31, 29_032.26]]
	);
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'ANNUAL_LEAVE_ENCASHMENT')?.amount,
		3_000
	);
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount,
		600_000
	);
	assert.deepEqual(charge(slip, 'SSO'), [29_032.26, 875, 875]);
	assert.deepEqual(charge(slip, 'PIT'), [32_032.26, 266.19, 0]);
	assert.equal(slip.gross, 29_032.26 + 3_000 + 600_000);
	assert.equal(slip.net, 630_891.07); // 632,032.26 − 875 − 266.19
	// s.70 para.2: an employer termination is paid within three days; a month-end run is late.
	assert.ok(warnings.some((warning) => warning.startsWith('FINAL_PAY_LATE: LEAVER')));
});

test('Thailand — s.118 severance by service band, and none for a resignation or under 120 days', () => {
	// Day = 30,000 ÷ 30 = 1,000. Service measured to Tuesday 31 March 2026, the last day.
	const exit = '2026-03-31';
	const cases = [
		['SEV-119D', '2025-12-03', 0], // 119 days: under s.118(1)'s 120 — none
		['SEV-120D', '2025-12-02', 30_000], // 120 days, under a year: 30 days
		['SEV-1Y', '2025-04-01', 90_000], // one year: 90 days
		['SEV-3Y', '2023-04-01', 180_000], // three years: 180 days
		['SEV-6Y', '2020-04-01', 240_000], // six years: 240 days
		['SEV-10Y', '2016-04-01', 300_000], // ten years: 300 days
		['SEV-20Y', '2006-04-01', 400_000] // twenty years: 400 days
	] as const;
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: [
				...cases.map(([key, hire]) =>
					citizen(key, 30_000, { hire_date: hire, exit_date: exit, exit_reason: 'RETRENCHMENT' })
				),
				citizen('SEV-RESIGN', 30_000, {
					hire_date: '2006-04-01',
					exit_date: exit,
					exit_reason: 'RESIGNATION'
				})
			]
		},
		(world) => {
			for (const [index, key] of [...cases.map(([key]) => key), 'SEV-RESIGN'].entries())
				adhoc(
					world,
					key,
					'SEVERANCE_PAY',
					0,
					exit,
					`d0000000-0000-4000-8000-0000000001${String(index).padStart(2, '0')}`
				);
		}
	);
	for (const [key, , amount] of cases)
		assert.equal(
			slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount ??
				0,
			amount,
			key
		);
	// A resignation is not a termination by the employer (s.118 para.2).
	assert.equal(
		slips.get('SEV-RESIGN')!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY'),
		undefined
	);
});

test('Thailand — s.119 cause and the s.118 para.3–4 fixed-term exemption remove severance; a dismissal without cause and a plain expiry pay it', () => {
	// 30,000, employed since 1 April 2023 (three years to Tuesday 31 March 2026): 180 days × 1,000.
	// The retirement and the plain expiry are employed since 1 April 2020 (six years: 240 days), so
	// their severance — not exempt from tax (MR No.126 cl.2(51)) — has the five years s.48(5)
	// withholding needs (the under-five-year case refuses; see the SEVERANCE_TAX golden).
	const exit = '2026-03-31';
	const leaver = (key: string, reason: string, hire = '2023-04-01') =>
		citizen(key, 30_000, { hire_date: hire, exit_date: exit, exit_reason: reason });
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: [
				leaver('DIS-CAUSE', 'DISMISSAL'),
				leaver('DIS-NO-CAUSE', 'DISMISSAL'),
				leaver('EOC-PROJECT', 'END_OF_CONTRACT'),
				leaver('EOC-PLAIN', 'END_OF_CONTRACT', '2020-04-01'),
				leaver('RETIRE', 'RETIREMENT', '2020-04-01')
			]
		},
		(world) => {
			const facts: Record<string, Record<string, boolean>> = {
				'DIS-CAUSE': { dismissed_for_cause: true },
				'DIS-NO-CAUSE': { dismissed_for_cause: false },
				'EOC-PROJECT': { fixed_term_project_exempt: true },
				'EOC-PLAIN': { fixed_term_project_exempt: false },
				RETIRE: {}
			};
			for (const [index, employment] of world.employments.entries()) {
				employment.exit_facts = facts[String(employment.employee_number)];
				adhoc(
					world,
					String(employment.employee_number),
					'SEVERANCE_PAY',
					0,
					exit,
					`d0000000-0000-4000-8000-0000000003${String(index).padStart(2, '0')}`
				);
			}
		}
	);
	const severance = (key: string) =>
		slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount ?? 0;
	assert.equal(severance('DIS-CAUSE'), 0); // s.119
	assert.equal(severance('DIS-NO-CAUSE'), 180_000);
	assert.equal(severance('EOC-PROJECT'), 0); // s.118 paras 3–4
	assert.equal(severance('EOC-PLAIN'), 240_000); // s.118 para.2: expiry is a termination
	assert.equal(severance('RETIRE'), 240_000); // s.118/1: retirement is a termination
	// Neither is exempt (MR No.126 cl.2(51) excludes retirement and contract expiry); s.48(5) on
	// six years exactly: 240,000 − 7,000 × 6 = 198,000 × 50% = 99,000 → inside the 150,000 exempt
	// band — nothing withheld. The three-year dismissal's 180,000 is inside the 600,000 exemption.
	for (const key of ['EOC-PLAIN', 'RETIRE', 'DIS-NO-CAUSE'])
		assert.equal(severanceTax(slips.get(key)!), 0, key);
});

test('Thailand — s.67 pays the year’s annual leave on exit only for an employer termination not for a s.119 cause', () => {
	// Current-year leave is limited to eligible employer termination; agreed carry is paid on every exit.
	for (const version of settingsVersions(TH)) {
		const annual = leaveCatalogue(TH).find(
			(row) => row.settings_id === version.id && row.code === 'ANNUAL_LEAVE'
		)!;
		assert.equal(annual.encash_on_exit, true);
		assert.equal(annual.entitlement.encash_carry_on_exit_when, '');
		const when = annual.entitlement.encash_on_exit_when as string;
		const exit = (reason: string, facts: Record<string, boolean> = {}) =>
			evaluateBoolean(expressionEngine, when, {
				employment: { exit_reason: reason, exit_facts: facts, exit_fact_keys: Object.keys(facts) }
			});
		assert.equal(exit('RESIGNATION'), false);
		assert.equal(exit('DISMISSAL', { dismissed_for_cause: true }), false);
		assert.equal(exit('DISMISSAL', { dismissed_for_cause: false }), true);
		for (const reason of ['RETRENCHMENT', 'REDUNDANCY', 'UNILATERAL', 'RETIREMENT'])
			assert.equal(exit(reason), true, reason);
	}
});

const severanceWorld =
	(cases: readonly (readonly [string, ...unknown[]])[], exit: string, prefix: string) =>
	(world: PayrollWorld) => {
		for (const [index, [key]] of cases.entries())
			adhoc(
				world,
				key,
				'SEVERANCE_PAY',
				0,
				exit,
				`d0000000-0000-4000-8000-000000${prefix}${String(index).padStart(4, '0')}`
			);
	};

test('Thailand — severance is withheld under s.50(1) para.3 on s.48(5), after the MR No.126 cl.2(51) exemption', () => {
	// Exit Tuesday 31 March 2026. MR No.126 cl.2(51) (as amended by No.394, from 1 January 2023):
	// severance under the LPA is exempt up to the last 400 days' wage, at most 600,000 — not on
	// retirement or contract expiry. Revenue Code s.50(1) para.3 withholds the rest as the s.48(5)
	// tax: less 7,000 × years (a part year of 183 days or more is a year), less 50% of the rest, on
	// the s.48(1) table; DG Notification No.45 cl.2(ก): only with five years' service or more.
	const exit = '2026-03-31';
	const cases = [
		// 150,000 a month (day 5,000), twenty years: 400 × 5,000 = 2,000,000. Exempt 600,000 (the
		// 400-day wage, 2,000,000, is higher). 1,400,000 − 140,000 = 1,260,000 × 50% = 630,000 →
		// 27,500 + 130,000 × 15% = 47,000.
		['TAX-RETR-20Y', 150_000, '2006-04-01', 'RETRENCHMENT', 2_000_000, 47_000],
		// 90,000 (day 3,000), retired after twenty years: 1,200,000, none exempt. 1,200,000 − 140,000
		// = 1,060,000 × 50% = 530,000 → 27,500 + 30,000 × 15% = 32,000.
		['TAX-RETIRE-20Y', 90_000, '2006-04-01', 'RETIREMENT', 1_200_000, 32_000],
		// Ten years and 183 days (hired 30 September 2015; 30 September 2025 to 31 March 2026 is 183
		// days): 300 × 3,000 = 900,000, eleven years. 900,000 − 77,000 = 823,000 × 50% = 411,500 →
		// 7,500 + 111,500 × 10% = 18,650.
		['TAX-RETIRE-10Y183D', 90_000, '2015-09-30', 'RETIREMENT', 900_000, 18_650],
		// Ten years and 182 days (hired 1 October 2015): ten years. 900,000 − 70,000 = 830,000 × 50%
		// = 415,000 → 7,500 + 115,000 × 10% = 19,000.
		['TAX-RETIRE-10Y182D', 90_000, '2015-10-01', 'RETIREMENT', 900_000, 19_000],
		// 30,000, retrenched after ten years: 300,000, all inside the exemption.
		['TAX-RETR-10Y', 30_000, '2016-04-01', 'RETRENCHMENT', 300_000, 0]
	] as const;
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: cases.map(([key, wage, hire, reason]) =>
				citizen(key, wage, { hire_date: hire, exit_date: exit, exit_reason: reason })
			)
		},
		severanceWorld(cases, exit, '05')
	);
	for (const [key, , , , severance, tax] of cases) {
		const slip = slips.get(key)!;
		assert.equal(severanceTax(slip), tax, key);
		if (tax > 0) assert.deepEqual(charge(slip, 'SEVERANCE_TAX'), [severance, tax, 0], key);
		// P.96/2543 cl.1 excludes a one-time exit payment from the regular method: PIT's base is
		// the last salary alone (full March, the exit on its last day).
		assert.equal(charge(slip, 'PIT')[0], slip.gross - severance, key);
	}
	// Retired after three years (hired 1 April 2023), 30,000 a month: s.118(3) 180 × 1,000 =
	// 180,000, none exempt (retirement). No s.48(5) route under five years (No.45 cl.2(ก)); the
	// 2025 ภ.ง.ด.91 instructions tax it with salary under s.40(1). Owner rule 2026-09-28 (TH-PIT-05):
	// s.50(1) para.1 as a payment made once, by the cl.1(5) method — on the PIT line, SEVERANCE_TAX nil.
	// Regular: 30,000 × 12 = 360,000 − 100,000 (50%, capped) − 60,000 − 875 × 12 = 189,500 → 39,500 ×
	// 5% = 1,975; ÷ 12 = 164.58. With it: 540,000 − 100,000 − 60,000 − 10,500 = 369,500 → 7,500 +
	// 69,500 × 10% = 14,450; difference 12,475. PIT 164.58 + 12,475 = 12,639.58 on 210,000.
	const short = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: [
				citizen('TAX-RETIRE-3Y', 30_000, {
					hire_date: '2023-04-01',
					exit_date: exit,
					exit_reason: 'RETIREMENT'
				})
			]
		},
		severanceWorld([['TAX-RETIRE-3Y']], exit, '06')
	).slips.get('TAX-RETIRE-3Y')!;
	assert.equal(severanceTax(short), 0);
	assert.deepEqual(charge(short, 'PIT'), [210_000, 12_639.58, 0]);
});

test('Thailand — special severance: s.120 relocation objection, s.121 60 days in lieu of notice, s.122 15 days a year to 360', () => {
	// 30,000 (day 1,000), exit Tuesday 31 March 2026. LPA s.121 para.2: a technology termination
	// without 60 days' notice owes 60 days besides s.118; s.122: service over six years adds 15
	// days per full year, a part year over 180 days a year, the s.122 amount at most 360 days.
	// s.120 para.3: an objecting employee is owed at least the s.118 rate; para.2: 30 days more
	// where the relocation notice was not posted 30 days ahead.
	const exit = '2026-03-31';
	const tech = { technology_restructuring: true };
	const cases = [
		['TECH-10Y', '2016-04-01', 'RETRENCHMENT', tech, 510_000], // 300 + 60 + 15 × 10
		[
			'TECH-10Y-NOTICE',
			'2016-04-01',
			'RETRENCHMENT',
			{ ...tech, technology_notice_60_days: true },
			450_000
		], // 300 + 150
		['TECH-30Y', '1996-04-01', 'RETRENCHMENT', tech, 820_000], // 400 + 60 + 360 (15 × 30 = 450 capped)
		['TECH-7Y-181D', '2018-10-02', 'REDUNDANCY', tech, 420_000], // 240 + 60 + 15 × 8 (181 days is a year)
		['TECH-7Y-180D', '2018-10-03', 'REDUNDANCY', tech, 405_000], // 240 + 60 + 15 × 7
		['TECH-5Y', '2021-04-01', 'RETRENCHMENT', tech, 240_000], // 180 + 60; five years is not over six
		['TECH-100D', '2025-12-22', 'RETRENCHMENT', tech, 60_000], // under 120 days: s.121's 60 days alone
		['RELOC-OBJECT', '2023-04-01', 'RESIGNATION', { relocation_objection: true }, 210_000], // 180 + 30
		[
			'RELOC-OBJECT-POSTED',
			'2023-04-01',
			'RESIGNATION',
			{ relocation_objection: true, relocation_notice_posted: true },
			180_000
		],
		['RETR-PLAIN-10Y', '2016-04-01', 'RETRENCHMENT', { technology_restructuring: false }, 300_000]
	] as const;
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: cases.map(([key, hire, reason]) =>
				citizen(key, 30_000, { hire_date: hire, exit_date: exit, exit_reason: reason })
			)
		},
		(world) => {
			for (const [key, , , facts] of cases)
				world.employments.find((row) => row.employee_number === key)!.exit_facts = facts;
			severanceWorld(cases, exit, '07')(world);
		}
	);
	for (const [key, , , , amount] of cases)
		assert.equal(
			slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount ??
				0,
			amount,
			key
		);
	// Tax (reading: special severance is severance under the Act for MR No.126 cl.2(51)): TECH-10Y's
	// 510,000 is exempt to the 400-day wage, 400,000; the rest, 110,000 − 7,000 × 10 = 40,000 × 50% =
	// 20,000, is inside the exempt band. A relocation objector resigned — not retirement or expiry —
	// so the whole 210,000 is exempt.
	assert.equal(severanceTax(slips.get('TECH-10Y')!), 0);
	assert.equal(severanceTax(slips.get('RELOC-OBJECT')!), 0);
});

test('Thailand — the ล.ย.01 allowances an employee declares reduce the annualised tax from January (P.96/2543 cl.1(2))', () => {
	// 60,000 a month, a spouse without income declared (s.47(1)(ข), 60,000): 720,000 − 100,000 −
	// 60,000 − 60,000 − 10,500 = 489,500 → 7,500 + 189,500 × 10% = 26,450 ÷ 12 = 2,204.1666… →
	// 2,204.16; December adds 26,450 − 12 × 2,204.16 = 0.08 → 2,204.24.
	const people = [
		citizen('LY01-60K', 60_000, {
			registrations: { PIT: { kind: 'REGISTERED', elections: { ly01_deductions: 60_000 } } }
		})
	];
	expectStatutory(
		assessStatutory({ code: TH, period: '2026-01', people }),
		'LY01-60K',
		'PIT',
		2_204.16,
		0
	);
	expectStatutory(
		assessStatutory({ code: TH, period: '2026-12', people }),
		'LY01-60K',
		'PIT',
		2_204.24,
		0
	);
});

test('Thailand — the s.33 ceiling steps to THB20,000 on 1 January 2029 and THB23,000 on 1 January 2032 (base regulation B.E.2568 cl.3)', () => {
	// Ministerial Regulation B.E.2568 cl.3(1)–(3) (Gazette vol.142 part 81 Kor, 12 December 2025):
	// 1,650–17,500 to 31 December 2028, 1,650–20,000 1 January 2029 to 31 December 2031, 1,650–
	// 23,000 from 1 January 2032. 5% each side (2565 rate regulation).
	const people = [
		citizen('CAP-19989', 19_989), // 999.45 → 999
		citizen('CAP-19990', 19_990), // 999.50 → 1,000
		citizen('CAP-20000', 20_000),
		citizen('CAP-22990', 22_990), // 1,149.50 → 1,150
		citizen('CAP-60000', 60_000),
		citizen('CAP-1500', 1_500) // floor 1,650 → 83
	];
	const december2028 = assessStatutory({ code: TH, period: '2028-12', people }, belowNotice14);
	expectStatutory(december2028, 'CAP-20000', 'SSO', 875, 875);
	for (const period of ['2029-01', '2031-12']) {
		const book = assessStatutory({ code: TH, period, people }, belowNotice14);
		expectStatutory(book, 'CAP-19989', 'SSO', 999, 999);
		expectStatutory(book, 'CAP-19990', 'SSO', 1_000, 1_000);
		expectStatutory(book, 'CAP-20000', 'SSO', 1_000, 1_000);
		expectStatutory(book, 'CAP-60000', 'SSO', 1_000, 1_000);
		expectStatutory(book, 'CAP-1500', 'SSO', 83, 83);
	}
	const january2032 = assessStatutory({ code: TH, period: '2032-01', people }, belowNotice14);
	expectStatutory(january2032, 'CAP-22990', 'SSO', 1_150, 1_150);
	expectStatutory(january2032, 'CAP-60000', 'SSO', 1_150, 1_150);
	expectStatutory(january2032, 'CAP-1500', 'SSO', 83, 83);
	// The PIT relief follows the contribution (s.47(1)(ฌ)): 60,000 × 12 = 720,000 − 160,000 − 12,000
	// = 548,000 → 27,500 + 48,000 × 15% = 34,700 ÷ 12 = 2,891.666… → 2,891.66; in 2032, 13,800 →
	// 546,200 → 34,430 ÷ 12 = 2,869.1666… → 2,869.16.
	expectStatutory(
		assessStatutory({ code: TH, period: '2029-01', people }, belowNotice14),
		'CAP-60000',
		'PIT',
		2_891.66,
		0
	);
	expectStatutory(january2032, 'CAP-60000', 'PIT', 2_869.16, 0);
});

test('Thailand — s.17/1 pay in lieu of notice runs to the payday after the next payday (TH-EXIT-04)', () => {
	// LPA s.17 para.2 (No.2 B.E.2551), Council of State consolidation through No.9: notice given at or
	// before a payday takes effect on the next payday. s.17/1 (No.7 B.E.2562): without that notice
	// the employer pays the wages from the removal to that day, on the removal day. Every engine
	// period pays on its last calendar day: month end; the 15th and month end; Sunday.
	const wage = 30_000;
	const payInLieu = (exit: string, given: string, pay = 'MONTHLY', company = 'MONTHLY') => {
		const person = personContext({
			asOf: exit,
			employee: null,
			employment: { service_start: '2020-01-01', exit_date: exit },
			terms: { pay_frequency: pay },
			company: { pay_frequency: company }
		});
		const days = `employment.payday_notice_days('${given}', terms.pay_frequency, company.pay_frequency)`;
		return {
			days: evaluateNumber(
				expressionEngine,
				`employment.notice_days_remaining(${days}, '${given}', 0)`,
				person
			),
			wages: evaluateNumber(
				expressionEngine,
				`round_cent(employment.notice_monthly_wages(${wage}, ${days}, '${given}', 0))`,
				person
			)
		};
	};
	// No notice, removed 15 Mar 2026: notice that day meets payday 31 Mar and takes effect 30 Apr.
	// 16–31 Mar + April = 46 days; 30,000 × 16/31 = 15,483.870… + 30,000 = 45,483.87.
	assert.deepEqual(payInLieu('2026-03-15', ''), { days: 46, wages: 45_483.87 });
	// Notice on payday 31 Mar takes effect 30 Apr; removed 31 Mar: April owed whole, 30,000.
	assert.deepEqual(payInLieu('2026-03-31', '2026-03-31'), { days: 30, wages: 30_000 });
	// Notice one day after a payday, 1 Apr: first payday 30 Apr, effective 31 May. Removed 10 Apr:
	// 11–30 Apr 30,000 × 20/30 = 20,000 + May 30,000 = 50,000 over 20 + 31 = 51 days.
	assert.deepEqual(payInLieu('2026-04-10', '2026-04-01'), { days: 51, wages: 50_000 });
	// Notice on payday 28 Feb takes effect 31 Mar; served to 31 Mar: nothing owed.
	assert.deepEqual(payInLieu('2026-03-31', '2026-02-28'), { days: 0, wages: 0 });
	// Semi-monthly, no notice, removed 10 Mar: paydays 15 and 31 Mar; 11–31 Mar = 21 days,
	// 30,000 × 21/31 = 20,322.580… → 20,322.58.
	assert.deepEqual(payInLieu('2026-03-10', '', 'SEMI_MONTHLY', 'SEMI_MONTHLY'), {
		days: 21,
		wages: 20_322.58
	});
	// Daily-paid at a weekly company settles on Sundays: removed Wednesday 4 Mar, paydays Sunday
	// 8 and 15 Mar; 5–15 Mar = 11 days.
	assert.equal(payInLieu('2026-03-04', '', 'DAILY', 'WEEKLY').days, 11);
});
test('Thailand — s.17/1 pay in lieu as a catalogue line, withheld with severance (TH-EXIT-04, TH-PIT-05)', () => {
	// LPA s.17 para.2 / s.17/1: pay in lieu of the missing notice, due on the removal day. DG
	// Notification No.45 cl.1(ง) (https://www.rd.go.th/3213.html): any other one-time payment on
	// leaving joins the s.50(1) para.3 / s.48(5) withholding; MR No.126 cl.2(51) exempts only the
	// LPA severance. Neither enters PIT's regular method (P.96/2543 cl.1) nor the SSA s.5 wage.
	for (const version of settingsVersions(TH)) {
		const row = adhocCatalogue(TH).find(
			(entry) => entry.settings_id === version.id && entry.code === 'NOTICE_IN_LIEU'
		)!;
		assert.ok(row, version.code);
		const owed = (reason: string, facts: Record<string, unknown> = {}, exit = '2026-03-31') =>
			evaluateBoolean(
				expressionEngine,
				row.eligibility,
				personContext({
					asOf: exit,
					employee: null,
					employment: {
						service_start: '2020-01-01',
						exit_date: exit,
						exit_reason: reason,
						exit_facts: facts,
						exit_fact_keys: Object.keys(facts)
					},
					terms: { pay_frequency: 'MONTHLY' },
					company: { pay_frequency: 'MONTHLY' }
				})
			);
		for (const reason of ['DISMISSAL', 'REDUNDANCY', 'RETRENCHMENT', 'UNILATERAL'])
			assert.equal(owed(reason), true, reason);
		// s.17 para.1: a fixed term ends without notice; a resignation or retirement is not the
		// employer's s.17 notice.
		for (const reason of ['RESIGNATION', 'RETIREMENT', 'END_OF_CONTRACT'])
			assert.equal(owed(reason), false, reason);
		assert.equal(owed('DISMISSAL', { dismissed_for_cause: true }), false); // s.17 last para.: s.119
		// s.121's own 60 days replace s.17 on a technology termination (on the SEVERANCE_PAY line).
		assert.equal(owed('RETRENCHMENT', { technology_restructuring: true }), false);
		// Notice on payday 28 Feb took effect 31 Mar; removed 31 Mar: fully served.
		assert.equal(owed('RETRENCHMENT', { notice_given_on: '2026-02-28' }), false);
		assert.equal(owed('RETRENCHMENT', { notice_given_on: '2026-03-31' }), true);
	}
	// 150,000 a month (day 5,000), hired 1 April 2006, retrenched Tuesday 31 March 2026, no notice.
	// Notice on 31 Mar meets payday 31 Mar and takes effect 30 Apr: April whole, 150,000.
	// s.118(6): twenty years, 400 × 5,000 = 2,000,000. SEVERANCE_TAX base 2,150,000; exempt
	// min(2,000,000, the 400-day wage 2,000,000, 600,000) = 600,000 on the severance alone.
	// 1,550,000 − 7,000 × 20 (the part year since 1 Apr 2025 is 365 days) = 1,410,000 × 50% =
	// 705,000 → 27,500 + 205,000 × 15% = 58,250 (severance alone: 47,000).
	const exit = '2026-03-31';
	const leaver = (key: string, wage: number, hire: string) =>
		citizen(key, wage, { hire_date: hire, exit_date: exit, exit_reason: 'RETRENCHMENT' });
	const lines = (keys: readonly string[]) => (world: PayrollWorld) => {
		for (const [index, key] of keys.entries())
			for (const [slot, code] of ['SEVERANCE_PAY', 'NOTICE_IN_LIEU'].entries())
				adhoc(world, key, code, 0, exit, `d0000000-0000-4000-8000-0000000017${index}${slot}`);
	};
	const { slips } = buildStatutory(
		{ code: TH, period: '2026-03', people: [leaver('NIL-20Y', 150_000, '2006-04-01')] },
		lines(['NIL-20Y'])
	);
	const slip = slips.get('NIL-20Y')!;
	const amount = (code: string) =>
		slip.adjustments.find((row) => row.component_code === code)?.amount;
	assert.equal(amount('NOTICE_IN_LIEU'), 150_000);
	assert.equal(amount('SEVERANCE_PAY'), 2_000_000);
	assert.deepEqual(charge(slip, 'SEVERANCE_TAX'), [2_150_000, 58_250, 0]);
	assert.equal(charge(slip, 'PIT')[0], 150_000); // the March salary alone
	assert.equal(charge(slip, 'SSO')[0], 150_000); // salary alone; capped at 875 each side
	// Three years (hired 1 April 2023), 30,000: severance 180 × 1,000 = 180,000, all exempt
	// (retrenchment; under the 400-day wage and 600,000); the 30,000 notice pay is taxable with no
	// s.48(5) route under five years (No.45 cl.2(ก)). Owner rule 2026-09-28 (TH-PIT-05): withheld on
	// the PIT line by the cl.1(5) method. Regular 189,500 net → 1,975 (164.58 a month); with the
	// 30,000: 390,000 − 100,000 − 60,000 − 10,500 = 219,500 → 69,500 × 5% = 3,475; difference 1,500.
	const short = buildStatutory(
		{ code: TH, period: '2026-03', people: [leaver('NIL-3Y', 30_000, '2023-04-01')] },
		lines(['NIL-3Y'])
	).slips.get('NIL-3Y')!;
	assert.equal(severanceTax(short), 0);
	assert.deepEqual(charge(short, 'PIT'), [60_000, 1_664.58, 0]);
});

test('Thailand — Notice 14 daily minimum wage by province, district and sector on each worked day (TH-WAGE-01–04)', () => {
	// Wage Committee Notice on Minimum Wage Rate No.14 (17 June 2025, in force 1 July 2025; the
	// Ministry's signed notice, explanation and printed table, https://www.mol.go.th/wp-content/
	// uploads/sites/2/2025/07/…ฉ14-รวม.pdf, and its English translation read 28 Sep 2026):
	// cl.3 Mueang Chiang Mai THB380; cl.7 the rest of Chiang Mai THB357; cl.2(3) Ko Samui THB400;
	// cl.11 the rest of Surat Thani THB352; cl.2(1) hotels of type 2–4 THB400 nationwide; cl.19 the
	// day is the normal day however short the employer makes it; cl.20 no employer may pay less.
	// February 2026's window, 21 Jan–20 Feb, is weekdays on the fixture's Mon–Fri pattern.
	const run = (people: ReturnType<typeof citizen>[], prepare?: (world: PayrollWorld) => void) =>
		buildStatutory({ code: TH, period: '2026-02', people }, prepare).warnings.filter((line) =>
			line.startsWith('MINIMUM_WAGE_BELOW')
		);
	const daily = (key: string, wage: number, worksite: string | null, sector?: string) =>
		citizen(key, wage, {
			pay_frequency: 'DAILY',
			worksite,
			...(sector == null ? {} : { worksite_sector: sector })
		});
	const fourHourDay = (world: PayrollWorld) => {
		for (const row of world.shift_definitions)
			if (row.code === 'DAY')
				row.variant = { kind: 'WORK', start_time: '09:00', end_time: '13:00', break_minutes: 0 };
	};
	// THB370 a day outside Mueang: 370 ≥ 357, no issue; exactly the Ko Samui 400 meets it; 352 meets
	// the Surat Thani remainder the Ko Samui district does not change.
	assert.deepEqual(
		run([
			daily('CM-MAERIM', 370, 'Chiang Mai/Mae Rim'),
			daily('SAMUI-400', 400, 'Surat Thani/Ko Samui'),
			daily('SURAT-352', 352, 'Surat Thani/Mueang Surat Thani')
		]),
		[]
	);
	// The same THB370 in Mueang Chiang Mai: 370 < 380 blocks, on 4-hour normal days too (cl.19: the
	// floor is the whole 380, not 380 × 4/8 = 190), while the 4-hour day leaves Mae Rim's 357 met.
	for (const prepare of [undefined, fourHourDay])
		assert.throws(
			() => run([daily('CM-MUEANG', 370, 'Chiang Mai/Mueang Chiang Mai')], prepare),
			/MINIMUM_WAGE_BELOW: CM-MUEANG is paid 370 a day .* Chiang Mai\/Mueang Chiang Mai daily minimum wage of 380/
		);
	assert.deepEqual(run([daily('CM-MAERIM', 370, 'Chiang Mai/Mae Rim')], fourHourDay), []);
	// Hourly on the 4-hour normal day: 95 × 4 = 380 meets Mueang's day; 94.99 × 4 = 379.96 does not.
	const hourly = (key: string, wage: number) =>
		citizen(key, wage, { pay_frequency: 'HOURLY', worksite: 'Chiang Mai/Mueang Chiang Mai' });
	assert.deepEqual(run([hourly('H-95', 95)], fourHourDay), []);
	assert.throws(
		() => run([hourly('H-9499', 94.99)], fourHourDay),
		/H-9499 is paid 379\.96 a day .* of 380/
	);
	// Ko Samui 399 < 400; a type-2 hotel in the Chiang Mai remainder owes 400, not 357.
	assert.throws(() => run([daily('SAMUI-399', 399, 'Surat Thani/Ko Samui')]), /of 400/);
	assert.throws(
		() => run([daily('HOTEL-2', 370, 'Chiang Mai/Mae Rim', 'HOTEL_TYPE_2')]),
		/HOTEL-2 is paid 370 a day .* Chiang Mai\/Mae Rim HOTEL_TYPE_2 daily minimum wage of 400/
	);
	// A missing worksite, or a bare province whose district has its own rate, names no floor.
	assert.throws(() => run([daily('NO-SITE', 400, null)]), /record the worksite/);
	assert.throws(() => run([daily('CM-BARE', 400, 'Chiang Mai')]), /record the worksite/);
});

test('Thailand — a monthly wage meets Notice 14 at the daily rate × 30 (TH-WAGE-01, owner rule 2026-09-28)', () => {
	// Notice 14 states daily rates only and no Act or Ministry text converts them to a month.
	// Owner rule 2026-09-28: the month is 30 days of the rate (LPA s.68's monthly ÷ 30, the
	// version's `ordinary_divisor_days`), so each normal working day of a monthly contract is held
	// to monthly ÷ 30 against the worksite's rate. February 2026's window as above.
	const run = (
		people: ReturnType<typeof citizen>[],
		payFrequency: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY' = 'MONTHLY'
	) =>
		buildStatutory({
			code: TH,
			period: payFrequency === 'MONTHLY' ? '2026-02' : '2026-02-1',
			payFrequency,
			people
		}).warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW'));
	const monthly = (
		key: string,
		wage: number,
		worksite: string,
		pay_frequency: 'MONTHLY' | 'SEMI_MONTHLY' | 'WEEKLY' = 'MONTHLY'
	) => citizen(key, wage, { pay_frequency, worksite });
	// Bangkok THB400 (the Ministry table): 12,000 ÷ 30 = 400 meets it; Mueang Chiang Mai 380:
	// 11,400 ÷ 30 = 380 meets it.
	assert.deepEqual(
		run([
			monthly('M-BKK-12000', 12_000, 'Bangkok'),
			monthly('M-CM-11400', 11_400, 'Chiang Mai/Mueang Chiang Mai')
		]),
		[]
	);
	// 11,999.70 ÷ 30 = 399.99 < 400; 9,000 ÷ 30 = 300 < 380.
	assert.throws(() => run([monthly('M-BKK-LOW', 11_999.7, 'Bangkok')]), /M-BKK-LOW .* of 400/);
	assert.throws(
		() => run([monthly('M-CM-9000', 9_000, 'Chiang Mai/Mueang Chiang Mai')]),
		/M-CM-9000 .* of 380/
	);
	// A semi-monthly contract's base_salary is its month (paid in two halves): 12,000 ÷ 30 = 400
	// meets Bangkok, 11,999.70 does not. A weekly wage is taken to its month (× 52 ÷ 12) first:
	// 2,770 × 52 ÷ 12 = 12,003.33 ÷ 30 = 400.11 meets it; 2,769 × 52 ÷ 12 = 11,999 ÷ 30 = 399.9667
	// does not.
	assert.deepEqual(
		run([monthly('SM-BKK-12000', 12_000, 'Bangkok', 'SEMI_MONTHLY')], 'SEMI_MONTHLY'),
		[]
	);
	assert.deepEqual(run([monthly('W-BKK-2770', 2_770, 'Bangkok', 'WEEKLY')], 'WEEKLY'), []);
	assert.throws(
		() => run([monthly('SM-BKK-LOW', 11_999.7, 'Bangkok', 'SEMI_MONTHLY')], 'SEMI_MONTHLY'),
		/SM-BKK-LOW is paid 399\.99 a day .* of 400/
	);
	assert.throws(
		() => run([monthly('W-BKK-2769', 2_769, 'Bangkok', 'WEEKLY')], 'WEEKLY'),
		/W-BKK-2769 is paid 399\.9667 a day .* of 400/
	);
	// The unrounded day is compared: Yala THB337 × 30 = 10,110.00. 10,109.99 ÷ 30 = 336.9997 < 337
	// blocks (it rounds to 337.00 at the satang, which must not pass); 10,110.00 ÷ 30 = 337 meets it.
	const yala = (people: ReturnType<typeof citizen>[]) =>
		buildStatutory({ code: TH, period: '2026-07', people }).warnings.filter((line) =>
			line.startsWith('MINIMUM_WAGE_BELOW')
		);
	assert.deepEqual(yala([citizen('M-YALA-10110', 10_110, { worksite: 'Yala' })]), []);
	assert.throws(
		() => yala([citizen('M-YALA-LOW', 10_109.99, { worksite: 'Yala' })]),
		/M-YALA-LOW is paid 336\.9997 a day .* of 337/
	);
});

test('Thailand — a transfer between worksites holds each day to the floor of the site the terms record that day (TH-WAGE-01, -02)', () => {
	// Notice 14 cl.20 (no employer pays less than the rate) is owed per day at the day's workplace:
	// cl.3 Mueang Chiang Mai THB380, cl.7 the rest of Chiang Mai THB357. A daily THB370 contract
	// moved on Monday 16 February 2026: February's Mon–Fri days 2–13 (10) at one site, 16–27 (10) at
	// the other. 370 ≥ 357 at Mae Rim; 370 < 380 on each of the ten Mueang days, whichever way the
	// move runs; THB380 meets both.
	const moved = (key: string, wage: number, before: string, after: string) =>
		buildStatutory(
			{
				code: TH,
				period: '2026-02',
				people: [citizen(key, wage, { pay_frequency: 'DAILY', worksite: before })]
			},
			(world) => {
				const old = world.employment_terms[0]!;
				world.employment_terms.push({
					...old,
					id: 'b0000000-0000-4000-8000-00000000a0f2',
					worksite: after,
					effective_range: { start: '2026-02-16', end: null }
				});
				old.effective_range = { start: old.effective_range.start, end: '2026-02-15' };
			}
		).warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW'));
	const maeRim = 'Chiang Mai/Mae Rim';
	const mueang = 'Chiang Mai/Mueang Chiang Mai';
	assert.throws(
		() => moved('TO-MUEANG', 370, maeRim, mueang),
		/TO-MUEANG is paid 370 a day on 10 normal working day\(s\) from 2026-02-16, below the Chiang Mai\/Mueang Chiang Mai daily minimum wage of 380/
	);
	assert.throws(
		() => moved('FROM-MUEANG', 370, mueang, maeRim),
		/FROM-MUEANG is paid 370 a day on 10 normal working day\(s\) from 2026-02-02, below the Chiang Mai\/Mueang Chiang Mai daily minimum wage of 380/
	);
	assert.deepEqual(moved('BOTH-380', 380, maeRim, mueang), []);
});

test('Thailand — one person working several sites in the same week is held to each work day’s own site (TH-WAGE-01, -02)', () => {
	// Notice 14 cl.20 is owed per day at the workplace the day was worked: cl.3 Mueang Chiang Mai
	// THB380, cl.7 the rest of Chiang Mai THB357. The terms record Mae Rim; `work_days.worksite`
	// records Monday 2 February 2026 at Mueang and Tuesday 3 February at Mae Rim (a planned day, no
	// punch: the Mon–Fri pattern stands). THB370: 370 ≥ 357 on every Mae Rim day, 370 < 380 on the
	// one Mueang day only. THB380 meets both; a work-day site the table does not name refuses.
	const sites = (key: string, wage: number, days: Record<string, string>) =>
		buildStatutory(
			{
				code: TH,
				period: '2026-02',
				people: [citizen(key, wage, { pay_frequency: 'DAILY', worksite: 'Chiang Mai/Mae Rim' })]
			},
			(world) => {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				for (const [date, worksite] of Object.entries(days))
					world.work_days.push({
						id: `wd-${key}-${date}`,
						employment_id: employment.id,
						work_date: date,
						shift_definition_id: null,
						worked_intervals: null,
						worksite,
						approval_id: null
					});
			}
		).warnings.filter((line) => line.startsWith('MINIMUM_WAGE_BELOW'));
	const week = {
		'2026-02-02': 'Chiang Mai/Mueang Chiang Mai',
		'2026-02-03': 'Chiang Mai/Mae Rim'
	};
	assert.throws(
		() => sites('SPLIT-370', 370, week),
		/SPLIT-370 is paid 370 a day on 1 normal working day\(s\) from 2026-02-02, below the Chiang Mai\/Mueang Chiang Mai daily minimum wage of 380/
	);
	assert.deepEqual(sites('SPLIT-380', 380, week), []);
	assert.throws(
		() => sites('SPLIT-BARE', 400, { '2026-02-02': 'Chiang Mai' }),
		/record the worksite on 2026-02-02/
	);
});

test('Thailand — hazardous work has a seven-hour day and 42-hour week (LPA s.23)', () => {
	const run = (rosterHours: number) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('HAZ', 21_000, { hazardous_work: true })] },
			(world) => {
				for (const row of world.shift_definitions)
					if (row.code === 'DAY')
						row.variant = {
							kind: 'WORK',
							start_time: '09:00',
							end_time: `${String(10 + rosterHours).padStart(2, '0')}:00`,
							break_minutes: 60,
							break_start_time: '13:00'
						};
				punchSeven(world, 'HAZ', '2026-01-05', '21:00', 4);
			}
		);
	assert.throws(() => run(8), /normal|hazardous|7 hour/i);
	const slip = run(7).slips.get('HAZ')!;
	assert.deepEqual(
		workLines(slip).filter((row) => row[1] === 'OT-1.5X'),
		[['2026-01-05', 'OT-1.5X', 4, 600]]
	);
});

test('Thailand — inherited seven-day patterns cannot exceed the 48/42-hour normal week (LPA s.23)', () => {
	for (const version of settingsVersions(TH)) {
		const limits = version.work_rules.limits;
		assert.equal(limits.find((row) => row.key === 'ordinary_normal_week')?.max_hours, 48);
		assert.equal(limits.find((row) => row.key === 'hazardous_normal_week')?.max_hours, 42);
	}
	const run = (hours: number, hazardous: boolean) =>
		buildStatutory(
			{
				code: TH,
				period: '2026-01',
				people: [citizen('WEEK', 24_000, { hazardous_work: hazardous })]
			},
			(world) => {
				const day = world.shift_definitions.find((row) => row.code === 'DAY')!;
				day.variant = {
					kind: 'WORK',
					start_time: '09:00',
					end_time: `${String(9 + hours).padStart(2, '0')}:00`,
					break_minutes: 0
				};
				const pattern = world.shift_patterns[0]!.pattern as { days: { roster_code_id: string }[] };
				pattern.days = Array.from({ length: 7 }, () => ({ roster_code_id: day.id }));
			}
		);
	assert.throws(() => run(8, false), /56\.00 normal hours.*48-hour limit "ordinary_normal_week"/);
	assert.throws(() => run(7, true), /49\.00 normal hours.*42-hour limit "hazardous_normal_week"/);
	assert.throws(() => run(6, false), /7 consecutive worked days.*weekly_holiday permits 6/);
});

test('Thailand — a nine-hour normal day needs prior agreement and a shorter day in the week (LPA s.23)', () => {
	const run = (agreement: string | null, tuesdayHours: number) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('REDISTRIBUTED', 24_000)] },
			(world) => {
				const monday = {
					...world.shift_definitions[0]!,
					id: 'shift-nine',
					code: 'NINE',
					variant: {
						kind: 'WORK',
						start_time: '09:00',
						end_time: '19:00',
						break_minutes: 60,
						break_start_time: '13:00'
					}
				};
				const tuesday = {
					...world.shift_definitions[0]!,
					id: 'shift-short',
					code: 'SHORT',
					variant: {
						kind: 'WORK',
						start_time: '09:00',
						end_time: `${String(10 + tuesdayHours).padStart(2, '0')}:00`,
						break_minutes: 60,
						break_start_time: '13:00'
					}
				};
				world.shift_definitions.push(monday, tuesday);
				const pattern = world.shift_patterns[0]!.pattern as { days: { roster_code_id: string }[] };
				pattern.days[0] = { roster_code_id: monday.id };
				pattern.days[1] = { roster_code_id: tuesday.id };
				// The nine-hour day, its 13:00–14:00 break taken. An agreed ninth hour is ordinary
				// working time, so only the unagreed day plans it as overtime.
				punch(world, 'REDISTRIBUTED', '2026-01-05', '09:00', '19:00', agreement == null ? 1 : 0);
				const day = world.work_days.at(-1)!;
				day.worked_intervals = [
					{ start: '2026-01-05T09:00:00+07:00', end: '2026-01-05T13:00:00+07:00' },
					{ start: '2026-01-05T14:00:00+07:00', end: '2026-01-05T19:00:00+07:00' }
				];
				if (agreement != null) day.normal_hours_redistribution_agreed_at = agreement;
			}
		);
	assert.deepEqual(workLines(run('2026-01-04T12:00:00+07:00', 7).slips.get('REDISTRIBUTED')!), []);
	assert.deepEqual(workLines(run(null, 7).slips.get('REDISTRIBUTED')!), [
		['2026-01-05', 'OT-1.5X', 1, 150]
	]);
	assert.throws(() => run('2026-01-05T10:00:00+07:00', 7), /prior worker agreement/);
	assert.throws(() => run('2026-01-04T12:00:00+07:00', 8), /shorter-day hours to offset/);
});

test('Thailand — a guard may agree a normal day above eight hours from 24 April 2026 only within the 48-hour week', () => {
	const run = (frequency: 'MONTHLY' | 'HOURLY', agreement: string) =>
		buildStatutory(
			{
				code: TH,
				period: '2026-04',
				people: [
					citizen('GUARD-DAY', frequency === 'MONTHLY' ? 24_000 : 100, {
						pay_frequency: frequency,
						statutory_work_category: 'GUARD_DUTY'
					})
				]
			},
			(world) => {
				const long = {
					...world.shift_definitions[0]!,
					id: 'guard-twelve',
					code: 'GUARD-TWELVE',
					variant: {
						kind: 'WORK',
						start_time: '09:00',
						end_time: '22:00',
						break_minutes: 60,
						break_start_time: '13:00'
					}
				};
				world.shift_definitions.push(long as never);
				punch(world, 'GUARD-DAY', '2026-04-27', '09:00', '22:00');
				// Twelve hours inside the 09:00–22:00 shift, the hour of s.27 rest split into two
				// half hours by the prior agreement the split needs.
				const day = world.work_days.at(-1)!;
				day.shift_definition_id = long.id;
				day.normal_hours_redistribution_agreed_at = agreement;
				day.th_split_break_agreed_at = '2026-04-26T12:00:00+07:00';
				day.worked_intervals = [
					{ start: '2026-04-27T09:00:00+07:00', end: '2026-04-27T13:00:00+07:00' },
					{ start: '2026-04-27T13:30:00+07:00', end: '2026-04-27T17:30:00+07:00' },
					{ start: '2026-04-27T18:00:00+07:00', end: '2026-04-27T22:00:00+07:00' }
				];
			}
		);
	assert.deepEqual(
		workLines(run('MONTHLY', '2026-04-26T12:00:00+07:00').slips.get('GUARD-DAY')!),
		[]
	);
	assert.throws(() => run('MONTHLY', '2026-04-27T10:00:00+07:00'), /prior worker agreement/);
	assert.deepEqual(workLines(run('HOURLY', '2026-04-26T12:00:00+07:00').slips.get('GUARD-DAY')!), [
		['2026-04-27', 'GUARD_NORMAL_SUPPLEMENT', 4, 500]
	]);
});

test('Thailand — a non-monthly guard’s additional normal-day compensation enters SSO and EWF wage bases', () => {
	// October 2026 has 22 weekdays: 176 normal hours, plus four on the agreed 12-hour Monday.
	// Hourly THB60 earns THB10,800 ordinary base; the regulation adds 4 × 60 × 1.25 = 300.
	const slip = buildStatutory(
		{
			code: TH,
			period: '2026-10',
			headcount: 10,
			people: [
				citizen('GUARD-HOUR', 60, {
					pay_frequency: 'HOURLY',
					statutory_work_category: 'GUARD_DUTY'
				})
			]
		},
		(world) => {
			const long = {
				...world.shift_definitions[0]!,
				id: 'guard-october-twelve',
				code: 'GUARD-OCTOBER-TWELVE',
				variant: {
					kind: 'WORK',
					start_time: '09:00',
					end_time: '22:00',
					break_minutes: 60,
					break_start_time: '13:00'
				}
			};
			world.shift_definitions.push(long as never);
			punch(world, 'GUARD-HOUR', '2026-10-26', '09:00', '22:00');
			// Twelve hours inside the 09:00–22:00 shift, the hour of s.27 rest split into two
			// half hours by the prior agreement the split needs.
			const day = world.work_days.at(-1)!;
			day.shift_definition_id = long.id;
			day.normal_hours_redistribution_agreed_at = '2026-10-25T12:00:00+07:00';
			day.th_split_break_agreed_at = '2026-10-25T12:00:00+07:00';
			day.worked_intervals = [
				{ start: '2026-10-26T09:00:00+07:00', end: '2026-10-26T13:00:00+07:00' },
				{ start: '2026-10-26T13:30:00+07:00', end: '2026-10-26T17:30:00+07:00' },
				{ start: '2026-10-26T18:00:00+07:00', end: '2026-10-26T22:00:00+07:00' }
			];
		}
	).slips.get('GUARD-HOUR')!;
	assert.deepEqual(workLines(slip), [['2026-10-26', 'GUARD_NORMAL_SUPPLEMENT', 4, 300]]);
	assert.equal(slip.gross, 11_100);
	assert.deepEqual(charge(slip, 'SSO'), [11_100, 555, 555]);
	assert.deepEqual(charge(slip, 'EWF'), [11_100, 27.75, 27.75]);
});

test('Thailand — each overtime or holiday-work occasion needs prior worker consent (LPA ss.24–25)', () => {
	const run = (consent: string | null) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('CONSENT', 24_000)] },
			(world) => {
				punch(world, 'CONSENT', '2026-01-05', '09:00', '21:00', 3);
				world.work_days.at(-1)!.overtime_consented_at = consent;
			}
		);
	assert.throws(() => run(null), /worker’s prior consent/);
	assert.throws(() => run('2026-01-05T10:00:00+07:00'), /worker’s prior consent/);
	assert.deepEqual(workLines(run('2026-01-05T08:00:00+07:00').slips.get('CONSENT')!), [
		['2026-01-05', 'OT-1.5X', 3, 450]
	]);
});

test('Thailand — s.24–25 consent exceptions require a saved reason and apply only to their day', () => {
	const run = (
		date: string,
		exception: string | null,
		reference: string | null,
		emergency = false
	) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('EXCEPTION', 24_000)] },
			(world) => {
				punch(world, 'EXCEPTION', date, '09:00', date === '2026-01-10' ? '18:00' : '21:00');
				const row = world.work_days.at(-1)!;
				row.approved_overtime_hours = date === '2026-01-10' ? 8 : 3;
				row.overtime_consented_at = null;
				row.th_consent_exception = exception as never;
				row.th_consent_exception_reference = reference;
				row.emergency_cause = emergency;
			}
		);
	assert.deepEqual(
		workLines(
			run('2026-01-05', 'CONTINUOUS_DAMAGE_IF_STOPPED', 'production-log-7').slips.get('EXCEPTION')!
		),
		[['2026-01-05', 'OT-1.5X', 3, 450]]
	);
	assert.deepEqual(
		workLines(run('2026-01-10', 'HOLIDAY_HOTEL', 'hotel-licence-9').slips.get('EXCEPTION')!),
		[['2026-01-10', 'HOL-1.0X', 8, 800]]
	);
	assert.throws(
		() => run('2026-01-05', 'HOLIDAY_HOTEL', 'hotel-licence-9'),
		/holiday-work exception on an ordinary day/
	);
	assert.throws(
		() => run('2026-01-05', 'CONTINUOUS_DAMAGE_IF_STOPPED', null),
		/needs evidence for the Thai consent exception/
	);
	assert.throws(() => run('2026-01-05', null, null, true), /worker’s prior consent/);
	assert.deepEqual(
		workLines(run('2026-01-05', 'EMERGENCY', 'emergency-report-7').slips.get('EXCEPTION')!),
		[['2026-01-05', 'OT-1.5X', 3, 450]]
	);
});

test('Thailand — overtime and holiday work together cannot exceed 36 hours in a week (LPA s.26, MR No.3)', () => {
	for (const version of settingsVersions(TH))
		assert.equal(
			version.work_rules.limits.find((row) => row.key === 'combined_overtime_holiday_week')
				?.max_hours,
			36
		);
	const run = (hours: number[]) =>
		buildStatutory(
			{ code: TH, period: '2026-01', people: [citizen('WEEK-OT', 24_000)] },
			(world) => {
				for (const [index, worked] of hours.entries()) {
					const date = `2026-01-${String(5 + index).padStart(2, '0')}`;
					world.jurisdiction_holidays.push(holiday(date, `Holiday ${index + 1}`));
					// `punch` writes the 13:00–14:00 gap when the day runs past 14:00, so a day of N
					// hours runs to 09:00 + N hours plus the gap. A shorter day is one continuous
					// span: the shift's provided 60 minutes come off it (there is no gap to show).
					const minutes = 9 * 60 + worked * 60 + (worked > 4 ? 60 : 0);
					punch(
						world,
						'WEEK-OT',
						date,
						'09:00',
						`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
					);
					world.work_days.at(-1)!.approved_overtime_hours = worked;
				}
			}
		);
	assert.doesNotThrow(() => run([9, 9, 9, 9]));
	// Four nine-hour holiday stints show the 13:00–14:00 gap, so the shift's 60-minute grant is
	// already accounted and each stays nine: 36, exactly at the ceiling. The fifth day's two clocked
	// hours are one continuous span with no gap, so the provided 60 minutes come off — one hour
	// net — and 36 + 1 = 37.00 crosses the 36-hour limit.
	assert.throws(() => run([9, 9, 9, 9, 2]), /37\.00 overtime and holiday hours.*36-hour limit/);
});

test('Thailand — piece-rate severance pays wages earned on the last thirty workdays (LPA s.118(1))', () => {
	const key = 'PIECE-SEV';
	const run = (missingDay?: string) =>
		buildStatutory(
			{
				code: TH,
				period: '2026-01',
				people: [
					citizen(key, 500, {
						pay_frequency: 'DAILY',
						statutory_work_category: 'PIECE_RATE',
						hire_date: '2025-09-01',
						exit_date: '2026-01-20',
						exit_reason: 'RETRENCHMENT'
					})
				]
			},
			(world) => {
				const employment = world.employments.find((row) => row.employee_number === key)!;
				for (
					let day = new Date('2025-12-01T00:00:00Z');
					day <= new Date('2026-01-20T00:00:00Z');
					day.setUTCDate(day.getUTCDate() + 1)
				) {
					if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
					const date = day.toISOString().slice(0, 10);
					if (date === missingDay) continue;
					world.work_days.push({
						id: `wd-${key}-${date}`,
						employment_id: employment.id,
						work_date: date,
						shift_definition_id: null,
						worked_intervals: null,
						piece_units: date === '2026-01-20' ? 2 : 1,
						piece_unit_rate: 500,
						approval_id: null
					});
				}
				adhoc(world, key, 'SEVERANCE_PAY', 0, '2026-01-20', 'd0000000-0000-4000-8000-0000000008f1');
			}
		);
	const slip = run().slips.get(key)!;
	assert.equal(
		slip.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount,
		15_500
	);
	assert.throws(
		() => run('2025-12-30'),
		/Piece-rate severance needs complete earnings or explicit absence for every last workday/
	);
});

test('Thailand — a 35-hour contract uses seven hours for both overtime and the s.68 divisor', () => {
	const slip = buildStatutory(
		{
			code: TH,
			period: '2026-01',
			people: [citizen('H7', 21_000, { ordinary_hours_per_week: 35 })]
		},
		(world) => punchSeven(world, 'H7', '2026-01-05', '21:00', 4)
	).slips.get('H7')!;
	assert.deepEqual(
		workLines(slip).filter((row) => row[1] === 'OT-1.5X'),
		[['2026-01-05', 'OT-1.5X', 4, 600]]
	);
});

test('Thailand — s.32: a medical certificate may be asked for from the third working day of sick leave (TH-LEAVE-06)', () => {
	// LPA s.32 (unchanged by No.2–No.9; the Ministry's copy of the consolidation, read 28 Sep 2026):
	// "ลาป่วยตั้งแต่สามวันทำงานขึ้นไป" — three working days or more. Two working days ask for none,
	// three do, on every sealed version's SICK_LEAVE row (every day of the helper's pattern works).
	for (const version of settingsVersions(TH)) {
		const row = leaveCatalogue(TH).find(
			(entry) => entry.settings_id === version.id && entry.code === 'SICK_LEAVE'
		) as { evidence_after_days: number | null } | undefined;
		assert.ok(row, `${version.name}: no SICK_LEAVE`);
		const context = leaveContext();
		context.catalogues[0]!.evidence_after_days = row.evidence_after_days;
		context.catalogues[0]!.entitlement = {
			availability: 'UNLIMITED',
			proration: 'NONE',
			year_start_month: 1,
			bands: []
		};
		const days = (end: string) =>
			evaluateLeavePreview(context, {
				employment_id: context.employments[0]!.id,
				catalogue_id: context.catalogues[0]!.id,
				calendar_month: '2026-04',
				range: {
					start: { date: '2026-04-15', half: 'FIRST' },
					end: { date: end, half: 'SECOND' }
				}
			});
		assert.equal(days('2026-04-16').chargeable_days, 2);
		assert.equal(days('2026-04-16').certificate_required, false, version.name);
		assert.equal(days('2026-04-17').chargeable_days, 3);
		assert.equal(days('2026-04-17').certificate_required, true, version.name);
	}
});

test('Thailand — s.70: a resignation is paid on the agreed payday, an employer termination within three days (TH-HR-30)', () => {
	// LPA s.70 para.1: wages are paid on the agreed payday; para.2: where the employer terminates,
	// the wages and other money owed on termination are paid within three days of the termination.
	// The fixture's monthly company pays on the period's last day, 31 March 2026. Day counting
	// excludes the termination day (Civil and Commercial Code s.193/3): 10 March + 3 = 13 March.
	const { warnings } = buildStatutory({
		code: TH,
		period: '2026-03',
		people: [
			citizen('S70-RESIGN', 30_000, { exit_date: '2026-03-10', exit_reason: 'RESIGNATION' }),
			citizen('S70-RETRENCH', 30_000, { exit_date: '2026-03-10', exit_reason: 'RETRENCHMENT' }),
			citizen('S70-RETRENCH-EOM', 30_000, { exit_date: '2026-03-31', exit_reason: 'RETRENCHMENT' })
		]
	});
	const late = (key: string) =>
		warnings.filter((warning) => warning.startsWith(`FINAL_PAY_LATE: ${key} `));
	// The resignation's next payday is this run's 31 March payday: on time.
	assert.deepEqual(late('S70-RESIGN'), []);
	// The retrenchment on 10 March was due by 13 March; the 31 March run is late.
	const [retrench] = late('S70-RETRENCH');
	assert.match(retrench!, /by 2026-03-13/);
	assert.match(retrench!, /s\.70 para\.2/);
	// Terminated on the payday itself: paid that day, inside the three days.
	assert.deepEqual(late('S70-RETRENCH-EOM'), []);
});

test('Thailand — s.122 needs more than six years’ service; its 180-day rule counts only toward the amount (TH-EXIT-07)', () => {
	// LPA s.122 (Council of State consolidation through No.9): a s.121 termination of an employee "ทำงาน
	// ติดต่อกันเกินหกปีขึ้นไป" (continuous service exceeding six years) adds 15 days' last wage per
	// full year; the last paragraph counts a part year over 180 days as a year "for computing"
	// special severance. 30,000 (day 1,000), exit Tuesday 31 March 2026, no 60-day notice (s.121
	// 60 days), service counted to and including the last day.
	const exit = '2026-03-31';
	const tech = { technology_restructuring: true };
	const cases = [
		// Exactly six years (1 April 2020 – 31 March 2026): not more than six. s.118(4) 240 + 60.
		['S122-6Y', '2020-04-01', 300_000],
		// Six years and one day: more than six; six full years, the one-day part not over 180.
		// 240 + 60 + 15 × 6 = 390.
		['S122-6Y1D', '2020-03-31', 390_000],
		// Five years and 181 days (the part 2 October 2025 – 31 March 2026): not more than six
		// years of service, though the part year would count as one in the amount. s.118(3)
		// 180 + 60 = 240; no s.122.
		['S122-5Y181D', '2020-10-02', 240_000]
	] as const;
	const { slips } = buildStatutory(
		{
			code: TH,
			period: '2026-03',
			people: cases.map(([key, hire]) =>
				citizen(key, 30_000, { hire_date: hire, exit_date: exit, exit_reason: 'RETRENCHMENT' })
			)
		},
		(world) => {
			for (const row of world.employments) row.exit_facts = tech;
			severanceWorld(cases, exit, '22')(world);
		}
	);
	for (const [key, , amount] of cases)
		assert.equal(
			slips.get(key)!.adjustments.find((row) => row.component_code === 'SEVERANCE_PAY')?.amount,
			amount,
			key
		);
});

/**
 * Run `periods` in sequence, each filed PAID before the next (a chained settle: the month's
 * earlier instalments are read back), and return each person's `[SSO, PIT]` employee shares.
 */
const chained = (world: PayrollWorld, periods: readonly string[]) => {
	const charged = new Map<string, [number, number][]>();
	for (const period of periods) {
		const prepared = gatherPayrollRun({
			world: payrollWorld(world),
			companyId: COMPANY_ID,
			period
		});
		const built = buildPayrollRun(prepared);
		world.payroll_runs.push({ id: period, company_id: COMPANY_ID, period } as never);
		for (const slip of built.payslip_payroll_run) {
			world.payslips.push({
				...slip,
				payroll_run_id: period,
				paid_at: prepared.window.payDate
			} as never);
			const key = world.employments.find((row) => row.id === slip.employment_id)!
				.employee_number as string;
			const amount = (code: string) =>
				slip.statutory.find((row) => row.scheme_code === code)?.employee_amount ?? 0;
			charged.set(key, [...(charged.get(key) ?? []), [amount('SSO'), amount('PIT')]]);
		}
	}
	return charged;
};

test('Thailand — a weekly payee is withheld on every payment at × 52 (P.96/2543 cl.1(1)(ค), (3)); SSO at every payment on the month’s wages (s.47, TH-PIT-02)', () => {
	// Weeks run in sequence, each filed PAID before the next (the month's earlier weeks are read back).
	const world = createStatutoryWorld({
		code: TH,
		period: '2026-07-1',
		payFrequency: 'WEEKLY',
		people: [
			citizen('W-20K', 20_000, { pay_frequency: 'WEEKLY' }),
			citizen('W-3K', 3_000, { pay_frequency: 'WEEKLY' }),
			citizen('W-HIRE', 20_000, { pay_frequency: 'WEEKLY', hire_date: '2026-07-06' })
		]
	});
	const weeks = (month: string, count: number) =>
		chained(
			world,
			Array.from({ length: count }, (_, index) => `${month}-${index + 1}`)
		);
	// July 2026 has four Sunday paydays (5, 12, 19, 26). 20,000 × 52 = 1,040,000 − 100,000 (s.42 bis
	// cap) − 60,000 − SSO 875 × 12 = 10,500 → 869,500 → 65,000 + 119,500 × 20% = 88,900 ÷ 52 =
	// 1,709.615… → 1,709.61 each week. The SSO relief is the month's contribution on the week's wage
	// taken to the month (20,000 × 52 ÷ 12 = 86,666.67, at the 17,500 ceiling → 875) × 12, owner rule
	// 2026-09-28. SSO: s.46's floor and ceiling are the month's; s.47 deducts at every payment what
	// the month's wages paid so far owe less what was deducted: 20,000 already reaches the ceiling.
	const july = weeks('2026-07', 4);
	assert.deepEqual(july.get('W-20K'), [
		[875, 1_709.61],
		[0, 1_709.61],
		[0, 1_709.61],
		[0, 1_709.61]
	]);
	// 3,000 a week: 5% of each week's wage, 150, the month's 12,000 × 5% = 600 over four payments.
	// PIT: 156,000 − 78,000 − 60,000 − 650 × 12 (13,000 a month → 650) = 10,200 → exempt.
	assert.deepEqual(july.get('W-3K'), [
		[150, 0],
		[150, 0],
		[150, 0],
		[150, 0]
	]);
	// Hired Monday 6 July: cl.1(1)'s payments actually due in the year of hire, the Sundays 12 July
	// to 27 December = 3 + 5 + 4 + 4 + 5 + 4 = 25. 500,000 − 100,000 − 60,000 − 875 × 25 × 12 ÷ 52
	// (5,048.08) = 334,951.92 → 7,500 + 34,951.92 × 10% = 10,995.19 ÷ 25 = 439.807… → 439.80.
	assert.deepEqual(july.get('W-HIRE'), [
		[875, 439.8],
		[0, 439.8],
		[0, 439.8]
	]);
	// December's last payday (27 December) carries cl.1(3)'s remainder: 88,900 − 52 × 1,709.61 =
	// 0.28 → 1,709.89; the hire's 10,995.19 − 25 × 439.80 = 0.19 → 439.99.
	const december = weeks('2026-12', 4);
	assert.deepEqual(
		december.get('W-20K')!.map(([, pit]) => pit),
		[1_709.61, 1_709.61, 1_709.61, 1_709.89]
	);
	assert.deepEqual(
		december.get('W-HIRE')!.map(([, pit]) => pit),
		[439.8, 439.8, 439.8, 439.99]
	);
});

test('Thailand — a semi-monthly payee is withheld on each half at × 24 (P.96/2543 cl.1(1)(ข)); SSO at every payment (s.47, TH-PIT-02)', () => {
	// June 2026 (30 days; a half is prorated on calendar days, 15 of 30 each): 60,000 a month in two
	// halves of 30,000: × 24 = 720,000, the monthly case's 34,925 annual tax
	// (above) ÷ 24 = 1,455.2083… → 1,455.20 a half. SSO relief: the half taken to the month (× 2 =
	// 60,000 → 875) × 12 = 10,500. SSO: the first half's 30,000 already reaches the 17,500 ceiling.
	const world = createStatutoryWorld({
		code: TH,
		period: '2026-06-1',
		payFrequency: 'SEMI_MONTHLY',
		people: [citizen('SM-60K', 60_000, { pay_frequency: 'SEMI_MONTHLY' })]
	});
	assert.deepEqual(chained(world, ['2026-06-1', '2026-06-2']).get('SM-60K'), [
		[875, 1_455.2],
		[0, 1_455.2]
	]);
	// July 2026 (31 days), unequal halves: each is withheld on itself, whatever the entity's
	// semi_monthly_statutory_cutoff (issue TH-D2). H1 15/31 × 60,000 = 29,032.26 × 24 = 696,774.24
	// − 100,000 − 60,000 − 10,500 = 526,274.24 → 7,500 + 20,000 + 26,274.24 × 15% = 31,441.136 → ÷ 24
	// = 1,310.047… → 1,310.04. H2 16/31 = 30,967.74 × 24 = 743,225.76 → 572,725.76 → 38,408.864 ÷ 24
	// = 1,600.369… → 1,600.36.
	for (const cutoff of ['FIRST', 'SPLIT', 'LAST'] as const) {
		const july = createStatutoryWorld({
			code: TH,
			period: '2026-07-1',
			payFrequency: 'SEMI_MONTHLY',
			people: [citizen('SM-60K', 60_000, { pay_frequency: 'SEMI_MONTHLY' })]
		});
		july.companies[0]!.semi_monthly_statutory_cutoff = cutoff;
		assert.deepEqual(
			chained(july, ['2026-07-1', '2026-07-2']).get('SM-60K'),
			[
				[875, 1_310.04],
				[0, 1_600.36]
			],
			cutoff
		);
	}
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Version coverage
// ─────────────────────────────────────────────────────────────────────────────────────────────

test('every sealed version of `TH` is priced by a golden here', () => assertEveryVersionPriced(TH));
