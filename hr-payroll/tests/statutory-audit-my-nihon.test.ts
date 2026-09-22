/**
 * MY-nihon independent audit (2026-09-23): the Malaysian statute on Nihon Pigment's own rows,
 * and the one company term that separates the fork from `MY` — the OT-incentive funnel.
 *
 * Every figure below is derived by hand from the instrument named beside it. Nothing here was
 * read off the engine. Sources, all fetched for this audit:
 *   EA   Employment Act 1955 (Act 265) reprint, JTKSM
 *        https://jtksm.mohr.gov.my/sites/default/files/2023-11/Akta%20Kerja%201955%20(Akta%20265).pdf
 *   OTR  Employment (Limitation of Overtime Work) Regulations 1980, JTKSM (reg.2: 104 hours)
 *   KWSP mandatory-contribution page (rates, worked examples 1.1–2.4), Wayback 2026-08-10
 *        https://web.archive.org/web/20260810072920id_/https://www.kwsp.gov.my/en/employer/responsibilities/mandatory-contribution
 *   ACT4 PERKESO "New contribution rate including SKBBK" (Act 4 Third Schedule, 65 rows)
 *        https://www.perkeso.gov.my/images/lindung/lindung-24-jam/NewContributionRateIncludingSKBBK.pdf
 *   A800 PERKESO Act 800 contribution table
 *        https://www.perkeso.gov.my/images/dokumen/151124-Rate%20Contribution%20ACT%20800.pdf
 *   MTD  LHDN Spesifikasi Kaedah Pengiraan Berkomputer PCB 2026 (Table 1; section E terms)
 *   PSMB Pembangunan Sumber Manusia Berhad Act 2001 s.2 "upah", s.14
 *
 * A case the engine cannot yet meet is left failing on purpose: goldens hold the law.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	assessStatutory,
	buildStatutory,
	COMPANY_ID,
	expectStatutory,
	expectStatutorySkipped,
	type BuiltPayslip
} from './fixtures/statutory-world.ts';
import type { PayrollWorld } from './fixtures/memory-payroll-api.ts';

const OUT = { kind: 'NOT_REGISTERED' } as const;
const LOCAL = { EPF_NON_CITIZEN: OUT };
const FOREIGN = { EPF: OUT, EPF_PR: OUT, EIS: OUT };

const holiday = (date: string, name: string) => ({
	id: `holiday-${date}`,
	company_id: COMPANY_ID,
	date,
	name,
	replaces: null,
	source: null,
	published_at: '2025-12-01T00:00:00.000Z',
	approval_id: null
});
const next = (date: string) =>
	new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** Worked intervals on `date` in +08:00; an `end` before `start` runs past midnight. */
const work = (
	world: PayrollWorld,
	key: string,
	date: string,
	intervals: readonly (readonly [string, string])[],
	approvedOvertime?: number
) => {
	const employment = world.employments.find((row) => row.employee_number === key)!;
	world.work_days.push({
		id: `wd-${key}-${date}`,
		employment_id: employment.id,
		work_date: date,
		shift_definition_id: null,
		worked_intervals: intervals.map(([start, end]) => ({
			start: `${date}T${start}:00+08:00`,
			end: `${end < start ? next(date) : date}T${end}:00+08:00`
		})),
		approval_id: null,
		...(approvedOvertime == null ? {} : { approved_overtime_hours: approvedOvertime })
	});
};
/** Saturday OFF, Sunday the rest day: EA s.59(1) — where more than one day is allowed, the LAST. */
const saturdayOff = (world: PayrollWorld) => {
	world.shift_definitions.push({
		...world.shift_definitions[1]!,
		id: 'off-day',
		code: 'OFF',
		name: 'Off day',
		variant: { kind: 'OFF' }
	});
	(world.shift_patterns[0]!.pattern as { days: { roster_code_id: string }[] }).days[5] = {
		roster_code_id: 'off-day'
	};
};
const lines = (slip: BuiltPayslip, prefix: string) =>
	slip.adjustments
		.filter((row) => row.statutory_rule_key?.startsWith(prefix))
		.map((row) => [row.source_id.slice(-10), row.statutory_rule_key, row.quantity, row.amount])
		.toSorted(
			(a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))
		);
const sum = (slip: BuiltPayslip, prefix: string, field: 'quantity' | 'amount') =>
	slip.adjustments
		.filter((row) => row.statutory_rule_key?.startsWith(prefix))
		.reduce((total, row) => total + (row[field] ?? 0), 0);

// ─── EPF: KWSP's own worked examples and the RM5,000 / age-60 boundaries ─────────────────────

test('MY-nihon EPF reproduces KWSP’s published examples and the RM5,000 and age-60 seams', () => {
	const book = assessStatutory({
		code: 'MY-nihon',
		period: '2026-01',
		people: [
			{ key: 'A-3250', wage: 3250, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'A-6710', wage: 6710.8, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'A-5000', wage: 5000, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'A-5000.01', wage: 5000.01, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'A-21250', wage: 21_250, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'A-59', wage: 3250, age: 59, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'E-60', wage: 3250, age: 60, citizenship: 'CITIZEN', registrations: LOCAL },
			{
				key: 'C-60',
				wage: 3250,
				age: 60,
				citizenship: 'PERMANENT_RESIDENT',
				registrations: LOCAL
			},
			{ key: 'F-3250', wage: 3250, citizenship: 'FOREIGNER', registrations: FOREIGN }
		]
	});
	// KWSP example 1.1: RM3,250.00, Part A → employer 424.00, employee 359.00 (row 3,240.01–3,260:
	// 13% × 3,260 = 423.80 → 424; 11% × 3,260 = 358.60 → 359).
	expectStatutory(book, 'A-3250', 'EPF', 359, 424);
	// KWSP example 1.2: RM6,710.80 → employer 816.00, employee 748.00 (row 6,700.01–6,800 at 12%/11%).
	expectStatutory(book, 'A-6710', 'EPF', 748, 816);
	// KWSP rate table: "RM5,000 and below" employer 13%. Row 4,980.01–5,000: 13% × 5,000 = 650,
	// 11% × 5,000 = 550. One sen more is "more than RM5,000", employer 12%, row 5,000.01–5,100:
	// 12% × 5,100 = 612, 11% × 5,100 = 561.
	expectStatutory(book, 'A-5000', 'EPF', 550, 650);
	expectStatutory(book, 'A-5000.01', 'EPF', 561, 612);
	// KWSP example 2.1: RM21,250 → 12% = 2,550.00 and 11% = 2,337.50; "the total contributions
	// including sen … rounded up to the next ringgit" = 4,888.00. The page states the total only.
	const top = book.get('A-21250')!.get('EPF')!;
	assert.equal(top.employee + top.employer, 4888);
	// Age seam: 59 is Part A (example 1.1 figures); 60 is Part E, example 1.3: employer 131.00,
	// employee 0 (4% × 3,260 = 130.40 → 131).
	expectStatutory(book, 'A-59', 'EPF', 359, 424);
	expectStatutory(book, 'E-60', 'EPF', 0, 131);
	// Example 1.4: a PR at 60 is Part C — employer 212.00, employee 180.00 — and outside Part A/E.
	expectStatutory(book, 'C-60', 'EPF_PR', 180, 212);
	expectStatutorySkipped(book, 'C-60', 'EPF');
	// Example 2.4: a non-citizen under 75 is Part F, 2% each: 3,250 × 2% = 65.00 each.
	expectStatutory(book, 'F-3250', 'EPF_NON_CITIZEN', 65, 65);
});

// ─── SOCSO / EIS / HRDF / PCB at the printed rows and the MTD boundaries ─────────────────────

test('MY-nihon SOCSO, EIS, HRDF and PCB at the table seams (2025-12-01 version)', () => {
	const book = assessStatutory({
		code: 'MY-nihon',
		period: '2026-01',
		headcount: 16,
		people: [
			{ key: 'W-3700', wage: 3700, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'W-3900', wage: 3900, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'W-5000', wage: 5000, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'W-6000', wage: 6000, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'W-6000.01', wage: 6000.01, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'W-59', wage: 5000, age: 59, citizenship: 'CITIZEN', registrations: LOCAL },
			{ key: 'W-60', wage: 5000, age: 60, citizenship: 'CITIZEN', registrations: LOCAL }
		]
	});
	// ACT4 First Category, employer / employee (invalidity column):
	//   row 41  3,600–3,700  63.85 / 18.25      row 43  3,800–3,900  67.35 / 19.25
	//   row 54  4,900–5,000  86.65 / 24.75      row 64  5,900–6,000 and row 65 above 6,000: 104.15 / 29.75
	expectStatutory(book, 'W-3700', 'SOCSO', 18.25, 63.85);
	expectStatutory(book, 'W-3900', 'SOCSO', 19.25, 67.35);
	expectStatutory(book, 'W-5000', 'SOCSO', 24.75, 86.65);
	expectStatutory(book, 'W-6000', 'SOCSO', 29.75, 104.15);
	expectStatutory(book, 'W-6000.01', 'SOCSO', 29.75, 104.15);
	// Age seam: 59 is First Category; 60 is Second Category, employer only — row 54: 61.90.
	expectStatutory(book, 'W-59', 'SOCSO', 24.75, 86.65);
	expectStatutory(book, 'W-60', 'SOCSO', 0, 61.9);
	// A800, each side: row 41 7.30, row 43 7.70, row 54 9.90, rows 64–65 11.90.
	expectStatutory(book, 'W-3700', 'EIS', 7.3, 7.3);
	expectStatutory(book, 'W-3900', 'EIS', 7.7, 7.7);
	expectStatutory(book, 'W-5000', 'EIS', 9.9, 9.9);
	expectStatutory(book, 'W-6000', 'EIS', 11.9, 11.9);
	expectStatutory(book, 'W-6000.01', 'EIS', 11.9, 11.9);
	expectStatutory(book, 'W-59', 'EIS', 9.9, 9.9);
	// EIS Act 2017 First Schedule: contributions stop at 60 (the existing MY golden's 0/0 row).
	expectStatutory(book, 'W-60', 'EIS', 0, 0);
	// PSMB s.14(1): 1% of the month's "upah" (basic + fixed allowances), ≥ 10 Malaysians.
	expectStatutory(book, 'W-3700', 'HRDF', 0, 37);
	expectStatutory(book, 'W-6000.01', 'HRDF', 0, 60);

	// MTD, January (n = 11, divide by n + 1 = 12), resident, single, no children, Category 1.
	// K2 = [4,000 − K1] / 11 truncated to the sen (MTD E.1), capped at K1.
	// W-3700: K1 = 407 (EPF above); K2 = 3,593 / 11 = 326.636… → 326.63 (< 407);
	//   EPF relief = 407 + 326.63 × 11 = 3,999.93. LP1 = 18.25 + 7.30 = 25.55. D = 9,000.
	//   P = 44,400 − 3,999.93 − 9,000 − 25.55 = 31,374.52 → Table 1 row 20,001–35,000:
	//   M 20,000, R 3%, B −250. (11,374.52 × 3%) − 250 = 91.2356 → /12 = 7.6029 → 7.60.
	//   MTD E.3: "less than ten ringgit, the employer is not required to make the MTD" → 0.
	expectStatutory(book, 'W-3700', 'PCB', 0, 0);
	// W-3900: K1 = 429 (row 3,880.01–3,900, 11% × 3,900); K2 = 3,571 / 11 = 324.636… → 324.63;
	//   EPF relief = 429 + 3,570.93 = 3,999.93. LP1 = 19.25 + 7.70 = 26.95.
	//   P = 46,800 − 3,999.93 − 9,000 − 26.95 = 33,773.12. (13,773.12 × 3%) − 250 = 163.1936
	//   → /12 = 13.5994… → truncate 13.59 → round up to five sen (E.2) 13.60.
	expectStatutory(book, 'W-3900', 'PCB', 13.6, 0);
});

test('MY-nihon SKBBK on the fork’s own June and July 2026 versions', () => {
	const people = [
		{ key: 'F-3900', wage: 3900, citizenship: 'FOREIGNER', registrations: FOREIGN },
		{ key: 'F-6000.01', wage: 6000.01, citizenship: 'FOREIGNER', registrations: FOREIGN }
	];
	// ACT4 NON-EMPLOYMENT INJURY column, employee only: row 43 (3,800–3,900) 28.85; row 65 (above
	// the RM6,000 ceiling) 44.65. Foreign workers stay mandatory after the 8 July 2026 decision.
	for (const period of ['2026-06', '2026-07']) {
		const book = assessStatutory({ code: 'MY-nihon', period, people });
		expectStatutory(book, 'F-3900', 'SKBBK', 28.85, 0);
		expectStatutory(book, 'F-6000.01', 'SKBBK', 44.65, 0);
	}
});

// ─── The OT-incentive funnel: never below s.60A(3), never hiding the ceilings ─────────────────

test('MY-nihon — the incentive funnel pays every hour at its statutory multiple on work, rest and holiday days', () => {
	// RM2,600 monthly: ordinary rate 2,600 / 26 = 100.00 a day (EA s.60I(1A)), hourly 100 / 8 =
	// 12.50; 1.5× = 18.75, 2× = 25.00, 3× = 37.50.
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [{ key: 'N', wage: 2600, citizenship: 'CITIZEN', registrations: LOCAL }]
		},
		(world) => {
			world.jurisdiction_holidays.push(holiday('2026-01-14', 'Thaipusam'));
			// Monday: 09:00–21:00 less the shift's hour = 11 h worked, 3 h past the eight. Exactly at
			// Nihon's eleven-hour boundary, so nothing is funnelled. s.60A(3)(a): 3 × 18.75 = 56.25.
			work(world, 'N', '2026-01-05', [['09:00', '21:00']]);
			// Sunday rest day, 09:00–22:00 = 13 h (no shift, no break). s.60(3)(b)(ii): one day's
			// wages 100.00 for the first eight; s.60(3)(c): 5 h × 25.00 = 125.00. Total 225.00.
			work(world, 'N', '2026-01-04', [['09:00', '22:00']]);
			// Wednesday holiday, 09:00–22:00 less the shift's hour = 12 h. s.60D(3)(a)(i): two days'
			// wages 200.00; s.60D(3)(aa): 4 h × 37.50 = 150.00. Total 350.00.
			work(world, 'N', '2026-01-14', [['09:00', '22:00']]);
		}
	);
	const slip = slips.get('N')!;
	// Nothing below the statute: OVERTIME + INCENTIVE per day equals the statutory figure.
	const byDay = (date: string) =>
		slip.adjustments
			.filter((row) => row.source_id.endsWith(date))
			.reduce((total, row) => total + row.amount, 0);
	assert.equal(byDay('2026-01-05'), 56.25);
	assert.equal(byDay('2026-01-04'), 225);
	assert.equal(byDay('2026-01-14'), 350);
	assert.equal(slip.gross, 2600 + 56.25 + 225 + 350);
	// Each funnelled hour keeps its band's multiple (the INCENTIVE line's rate is its band's).
	for (const row of slip.adjustments.filter((r) =>
		r.statutory_rule_key?.startsWith('INCENTIVE:')
	)) {
		const label = row.statutory_rule_key!.slice('INCENTIVE:'.length);
		const multiple = { 'WORKDAY-OT-1.5X': 18.75, 'RESTDAY-OT-2.0X': 25, 'HOLIDAY-OT-3.0X': 37.5 }[
			label
		];
		assert.ok(multiple != null, `unexpected funnelled band ${label}`);
		assert.equal(row.amount, row.quantity! * multiple);
	}
	// Act 4 s.2(24): "wages" include "overtime, and extra work on holidays" — every line, INCENTIVE
	// included. 2,600 + 631.25 = 3,231.25 → ACT4 row 3,200–3,300: 16.25 / 56.85; A800: 6.50 each.
	// PSMB s.2 "upah" is basic and fixed allowances: the levy base stays 2,600 → 26.00.
	const charge = (code: string) => slip.statutory.find((row) => row.scheme_code === code)!;
	assert.equal(charge('SOCSO').base_amount, 3231.25);
	assert.deepEqual(
		[charge('SOCSO').employee_amount, charge('SOCSO').employer_amount],
		[16.25, 56.85]
	);
	assert.deepEqual([charge('EIS').employee_amount, charge('EIS').employer_amount], [6.5, 6.5]);
	assert.equal(charge('PCB').base_amount, 3231.25);
	assert.equal(charge('HRDF').base_amount, 2600);
	// EPF Act 1991 s.2 "wages" excludes "(b) overtime payment": the s.60A(3) hour stays overtime
	// whether the payslip calls it OVERTIME or INCENTIVE, so 2,600 at most.
	assert.ok(charge('EPF').base_amount <= 2600);
});

test('MY-nihon — funnelled hours do not hide a month past the 104-hour ceiling (EA s.60A(4)(a), OTR reg.2)', () => {
	// s.60A(3)(b): overtime is work beyond the normal hours per day; s.60A(4)(a) proviso: rest-day
	// and public-holiday work "shall not be construed as overtime work" for the ceiling. January
	// 1–20 2026, Saturday OFF (an off day's hours are all beyond the normal day), Sunday REST:
	//   14 weekdays 09:00–23:00, 13 h worked less the shift's hour → 5 h each = 70 h
	//    3 Saturdays 09:00–21:00, 12 h each on an off day            = 36 h
	//   regulated overtime = 106 h > 104 → the employer has breached reg.2 and the run must say so.
	//    3 Sundays 09:00–21:00, 12 h rest-day work — not overtime for the ceiling.
	// Pay: 70 × 18.75 = 1,312.50; 36 × 18.75 = 675.00; each Sunday 100.00 + 4 × 25.00 = 200.00.
	const { slips, warnings } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [{ key: 'CAP', wage: 2600, citizenship: 'CITIZEN', registrations: LOCAL }]
		},
		(world) => {
			saturdayOff(world);
			for (let date = '2026-01-01'; date <= '2026-01-20'; date = next(date)) {
				const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
				work(world, 'CAP', date, [
					weekday === 0 || weekday === 6 ? ['09:00', '21:00'] : ['09:00', '23:00']
				]);
			}
		}
	);
	const slip = slips.get('CAP')!;
	assert.equal(slip.gross, 2600 + 1312.5 + 675 + 600);
	assert.ok(
		warnings.some((line) => line.startsWith('OVERTIME_LIMIT_EXCEEDED') && /106/.test(line)),
		`106 regulated overtime hours must be reported against the 104-hour ceiling:\n${warnings.join('\n')}`
	);
});

test('MY-nihon — work after the ten-hour spread-over is overtime (EA s.60A(3)(b) proviso)', () => {
	// Split shift 08:00–12:00 and 16:00–22:00: 10 h worked, 2 h past the normal eight. The spread-over
	// that began at 08:00 ends at 18:00, and "the whole period beginning from the time that the said
	// spread over period ends up to the time that the employee ceases work for the day shall be deemed
	// to be overtime": 18:00–22:00 = 4 h × 18.75 = 75.00. The employer approved the four hours.
	const { slips } = buildStatutory(
		{
			code: 'MY-nihon',
			period: '2026-01',
			people: [{ key: 'SPLIT', wage: 2600, citizenship: 'CITIZEN', registrations: LOCAL }]
		},
		(world) =>
			work(
				world,
				'SPLIT',
				'2026-01-06',
				[
					['08:00', '12:00'],
					['16:00', '22:00']
				],
				4
			)
	);
	const slip = slips.get('SPLIT')!;
	assert.equal(sum(slip, 'OVERTIME:', 'quantity') + sum(slip, 'INCENTIVE:', 'quantity'), 4);
	assert.equal(sum(slip, 'OVERTIME:', 'amount') + sum(slip, 'INCENTIVE:', 'amount'), 75);
	assert.deepEqual(lines(slip, 'INCENTIVE:'), []);
});

// ─── Final wages: EA s.20 / s.21 (the fork's payroll.final_pay_deadlines) ─────────────────────

test('MY-nihon — final wages are due on the last day unless the employee left without notice (EA ss.20–21)', () => {
	// A monthly run pays on the month's last day, 31 January 2026.
	//   NOTICE:   resigned with notice (s.12) on 29 Jan → s.20: due by 29 Jan → paid 31 Jan is late.
	//   WALKOUT:  left without notice (s.13(2)) on 29 Jan → s.21(2): third day after = 1 Feb → on time.
	//   WALKOUT2: left without notice on 27 Jan → due by 30 Jan → paid 31 Jan is late.
	const people = [
		{ key: 'NOTICE', exit_date: '2026-01-29' },
		{ key: 'WALKOUT', exit_date: '2026-01-29' },
		{ key: 'WALKOUT2', exit_date: '2026-01-27' }
	].map((row) => ({
		...row,
		wage: 3000,
		exit_reason: 'RESIGNATION',
		citizenship: 'CITIZEN',
		registrations: LOCAL
	}));
	const { warnings } = buildStatutory({ code: 'MY-nihon', period: '2026-01', people }, (world) => {
		for (const key of ['WALKOUT', 'WALKOUT2'])
			for (const row of world.employments.filter((row) => row.employee_number === key))
				row.exit_facts = { ...(row.exit_facts ?? {}), terminated_without_notice: true };
	});
	const late = (key: string) =>
		warnings.find((line) => line.startsWith('FINAL_PAY_LATE') && line.includes(`${key} left`));
	assert.match(late('NOTICE') ?? '', /by 2026-01-29.*s\.20/);
	assert.equal(late('WALKOUT'), undefined);
	assert.match(late('WALKOUT2') ?? '', /by 2026-01-30.*s\.21\(2\)/);
});
