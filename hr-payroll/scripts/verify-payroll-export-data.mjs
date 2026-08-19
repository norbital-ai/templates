/**
 * What a settled run actually hands the three export artefacts.
 *
 * `verify-payroll-xlsx.mjs` starts from a `ReportPayslip` and checks the workbook built from it.
 * That leaves the half that *produces* a `ReportPayslip` — `lib/export-data.ts`, which reads the
 * payslips, their lines, the employments, the terms, the attendance and the schedule back out —
 * unexercised, and it is the half that decides what the cells contain.
 *
 * Three things are pinned here, each of which was wrong or unstated before:
 *
 * • A derived overtime line has no pay component. It must survive the export and report under the
 *   stable band code `overtime.ts` mints, on both the statutory arm and the reclassified excess arm.
 * • The schedule is the pattern plus its overrides, not the overrides alone. A PATTERNED employment
 *   carries an explicit roster row only where the month departs from its pattern, so Normal Hours
 *   and Shift Codes have to come from the same resolution the engine prices with.
 * • A leaver's terms end on their last day, which is before the day their wages arrive. Their
 *   designation, department and payroll group must still reach the salary listing.
 *
 * It loads through Vite for the same reason the other export gate does: the module graph reaches
 * the browser build of ExcelJS, which only resolves there.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({
	root,
	appType: 'custom',
	logLevel: 'silent',
	server: { middlewareMode: true }
});

/** The window a Malaysian cutoff of 21 gives March, and the day it pays. */
const RUN = {
	norbital_id: 'run:2026-03',
	period: '2026-03',
	pay_date: '2026-03-28',
	attendance_from: '2026-02-21',
	attendance_to: '2026-03-20'
};

const DAY_SHIFT = {
	norbital_id: 'shift:D',
	company_id: 'company:1',
	code: 'D',
	variant: { kind: 'WORK', start_time: '08:30', end_time: '17:00', break_minutes: 60 }
};
const REST_CODE = {
	norbital_id: 'shift:REST',
	company_id: 'company:1',
	code: 'REST',
	variant: { kind: 'REST' }
};
const NIGHT_SHIFT = {
	norbital_id: 'shift:N',
	company_id: 'company:1',
	code: 'N',
	variant: { kind: 'WORK', start_time: '20:30', end_time: '05:30', break_minutes: 60 }
};
/** 08:30–17:00 less an hour unpaid. The number every Normal Hours expectation below is built from. */
const DAY_PAID_HOURS = 7.5;

/** A Monday, so the cycle below reads as an ordinary working week. */
const ANCHOR = '2026-01-05';
const WEEKDAY_PATTERN = {
	type: 'PATTERNED',
	anchor_date: ANCHOR,
	phases: [
		{
			duration: { kind: 'CONTINUOUS' },
			day_cycle: [
				{ roster_code_id: DAY_SHIFT.norbital_id },
				{ roster_code_id: DAY_SHIFT.norbital_id },
				{ roster_code_id: DAY_SHIFT.norbital_id },
				{ roster_code_id: DAY_SHIFT.norbital_id },
				{ roster_code_id: DAY_SHIFT.norbital_id },
				{ roster_code_id: REST_CODE.norbital_id },
				{ roster_code_id: REST_CODE.norbital_id }
			]
		}
	]
};

const DAY_MS = 86_400_000;
function daysOfWindow(from, to) {
	const days = [];
	for (
		let at = Date.parse(`${from}T00:00:00.000Z`);
		at <= Date.parse(`${to}T00:00:00.000Z`);
		at += DAY_MS
	)
		days.push(new Date(at).toISOString().slice(0, 10));
	return days;
}
const WINDOW_DAYS = daysOfWindow(RUN.attendance_from, RUN.attendance_to);
/** The cycle position of a date, computed here rather than read from the module under test. */
function patternedCode(date) {
	const offset = Math.round(
		(Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${ANCHOR}T00:00:00.000Z`)) / DAY_MS
	);
	return WEEKDAY_PATTERN.phases[0].day_cycle[((offset % 7) + 7) % 7].roster_code_id;
}
const PATTERNED_WORK_DAYS = WINDOW_DAYS.filter(
	(date) => patternedCode(date) === DAY_SHIFT.norbital_id
);

const range = (start, end) => ({
	start: `${start}T00:00:00.000Z`,
	end: end == null ? null : `${end}T23:59:59.999Z`
});

const EMPLOYMENTS = [
	{
		norbital_id: 'employment:pattern',
		employee_id: 'employee:pattern',
		employee_number: 'NHPMY0002',
		company_id: 'company:1',
		hire_date: '2021-06-01',
		exit_date: null,
		bank: {
			bank_account_name: 'Aisyah binti Rahman',
			bank_code: 'MBBEMYKL',
			bank_name: 'Maybank',
			bank_account_number: '512345678901'
		}
	},
	{
		norbital_id: 'employment:leaver',
		employee_id: 'employee:leaver',
		employee_number: 'NHPMY0400',
		company_id: 'company:1',
		hire_date: '2024-07-10',
		exit_date: '2026-03-05',
		bank: null
	}
];

const TERMS = [
	{
		norbital_id: 'terms:pattern',
		employment_id: 'employment:pattern',
		job_title: 'Machine Operator',
		department: 'Assembly',
		payroll_group: 'MY-MONTHLY',
		work_pattern: WEEKDAY_PATTERN,
		effective_range: range('2021-06-01', null)
	},
	{
		norbital_id: 'terms:leaver',
		employment_id: 'employment:leaver',
		job_title: 'Packer',
		department: 'Warehouse',
		payroll_group: 'MY-MONTHLY',
		work_pattern: WEEKDAY_PATTERN,
		effective_range: range('2024-07-10', '2026-03-05')
	}
];

/** One explicit override on a patterned rest day: the person was called in on a night shift. */
const OVERRIDE_DATE = WINDOW_DAYS.find((date) => patternedCode(date) === REST_CODE.norbital_id);
const ROSTER_ENTRIES = [
	{
		norbital_id: 'roster:override',
		employment_id: 'employment:pattern',
		work_date: OVERRIDE_DATE,
		shift_definition_id: NIGHT_SHIFT.norbital_id,
		assignment_code: null
	}
];

const PAYSLIPS = [
	{
		norbital_id: 'payslip:pattern',
		payroll_run_id: RUN.norbital_id,
		employment_id: 'employment:pattern',
		currency: 'MYR',
		gross: 3760.78,
		total_deductions: 400.25,
		net: 3454.03,
		employer_cost: 515.15
	},
	{
		norbital_id: 'payslip:leaver',
		payroll_run_id: RUN.norbital_id,
		employment_id: 'employment:leaver',
		currency: 'MYR',
		gross: 690,
		total_deductions: 0,
		net: 690,
		employer_cost: 0
	}
];

const BASIC = {
	norbital_id: 'component:basic',
	code: 'BASIC',
	nature: 'EARNING',
	definition: { source: 'SCHEDULE' }
};

/**
 * Four lines, two of which link to no pay component at all: the statutory rest-day day-wage award
 * and the hours the daily ceiling reclassified out of it.
 */
const PAYSLIP_LINES = [
	{
		norbital_id: 'line:basic',
		payslip_id: 'payslip:pattern',
		pay_component_id: BASIC.norbital_id,
		statutory_contribution_id: null,
		component: { kind: 'SCHEDULE', pay_component_id: BASIC.norbital_id },
		amount: 3451,
		quantity: null,
		sequence: 1
	},
	{
		norbital_id: 'line:ot-rest-day',
		payslip_id: 'payslip:pattern',
		pay_component_id: null,
		statutory_contribution_id: null,
		component: {
			kind: 'OVERTIME',
			day_type: 'REST_DAY',
			measure: 'FROM_START_OF_DAY',
			band_from: 0.5
		},
		amount: 132.73,
		quantity: 8,
		sequence: 2
	},
	{
		norbital_id: 'line:ot-excess',
		payslip_id: 'payslip:pattern',
		pay_component_id: null,
		statutory_contribution_id: null,
		component: {
			kind: 'OVERTIME_EXCESS',
			day_type: 'REST_DAY',
			measure: 'BEYOND_NORMAL',
			band_from: 0
		},
		amount: 33.18,
		quantity: 1,
		sequence: 3
	},
	{
		norbital_id: 'line:basic-leaver',
		payslip_id: 'payslip:leaver',
		pay_component_id: BASIC.norbital_id,
		statutory_contribution_id: null,
		component: { kind: 'SCHEDULE', pay_component_id: BASIC.norbital_id },
		amount: 690,
		quantity: null,
		sequence: 1
	}
];

function matches(row, where = {}) {
	return Object.entries(where).every(([column, condition]) => {
		if (condition == null) return true;
		const value = row[column];
		return Object.entries(condition).every(([operator, operand]) => {
			switch (operator) {
				case 'eq':
					return String(value) === String(operand);
				case 'in':
					return operand.map(String).includes(String(value));
				case 'isNull':
					return (value == null) === operand;
				case 'gte':
					return String(value) >= String(operand);
				case 'lte':
					return String(value) <= String(operand);
				default:
					throw new Error(`The stub does not implement ${operator} on ${column}.`);
			}
		});
	});
}

function stubApi(tables) {
	return {
		db: {
			query: Object.fromEntries(
				Object.entries(tables).map(([name, rows]) => [
					name,
					{
						findFirst: ({ where } = {}) =>
							Effect.succeed(rows.find((row) => matches(row, where)) ?? null),
						findMany: ({ where } = {}) => Effect.succeed(rows.filter((row) => matches(row, where)))
					}
				])
			)
		}
	};
}

try {
	const { loadRunExports } = await vite.ssrLoadModule(
		'/src/collections/payroll_runs/lib/export-data.ts'
	);
	const { overtimeBandCode } = await vite.ssrLoadModule(
		'/src/collections/payroll_runs/lib/overtime.ts'
	);
	const { vendorWorkbookRow } = await vite.ssrLoadModule(
		'/src/collections/payroll_runs/lib/report.ts'
	);

	const api = stubApi({
		payslips: PAYSLIPS,
		payslip_lines: PAYSLIP_LINES,
		employments: EMPLOYMENTS,
		pay_components: [BASIC],
		employment_terms: TERMS,
		time_entries: [],
		roster_entries: ROSTER_ENTRIES,
		employees: [
			{
				norbital_id: 'employee:pattern',
				name: 'Aisyah binti Rahman',
				identity_number: '920104-10-5522'
			},
			{ norbital_id: 'employee:leaver', name: 'Tan Wei Ming', identity_number: '001122-14-3311' }
		],
		shift_definitions: [DAY_SHIFT, REST_CODE, NIGHT_SHIFT],
		statutory_contributions: []
	});

	const [run] = await Effect.runPromise(loadRunExports(api, [RUN]));
	assert.equal(run.period, '2026-03');
	assert.equal(run.payDate, '2026-03-28');
	assert.equal(run.payslips.length, 2);

	const [patterned, leaver] = run.payslips;

	// ── a derived overtime line has no pay component and still reaches the workbook ────────────────
	assert.deepEqual(
		patterned.lines.map((line) => line.payComponentCode),
		['BASIC', 'OT_REST_DAY_FROM_START_OF_DAY_0_5', 'OT_EXCESS_REST_DAY_BEYOND_NORMAL_0'],
		'both overtime arms report under the band code they were priced by'
	);
	assert.equal(
		patterned.lines[1].payComponentCode,
		overtimeBandCode({
			excess: false,
			dayType: 'REST_DAY',
			measure: 'FROM_START_OF_DAY',
			bandFrom: 0.5
		}),
		'the exported code is the same one `measure.ts` labelled the line with'
	);
	assert.equal(patterned.lines[1].overtimeDayType, 'REST_DAY');
	assert.equal(patterned.lines[1].isOvertimeExcess, false);
	assert.equal(patterned.lines[2].isOvertimeExcess, true);
	assert.equal(patterned.lines[2].calculationSource, 'OVERTIME_EXCESS');

	const row = vendorWorkbookRow(patterned);
	assert.equal(row.overtime, 132.73, 'statutory overtime is the Overtime column');
	assert.equal(row.incentive_ot, 33.18, 'reclassified overtime is the OT Incentive column');
	assert.equal(row.allowance, 0, 'neither arm leaks into the allowance column');
	assert.equal(row.att_ot_2x_hours, 8, 'rest-day hours are the 2.0× bucket');
	assert.equal(row.att_ot_1x_hours, 1, 'excess hours are valued plain, so they read 1.0×');

	// ── the schedule is the pattern, with the month's overrides on top ─────────────────────────────
	const overriddenWasWork = patternedCode(OVERRIDE_DATE) === DAY_SHIFT.norbital_id;
	assert.equal(overriddenWasWork, false, 'the override lands on a patterned rest day');
	assert.equal(
		patterned.attendance.normalHours,
		PATTERNED_WORK_DAYS.length * DAY_PAID_HOURS + 8,
		'every patterned working day counts, and the night-shift override adds its own window'
	);
	assert.ok(
		PATTERNED_WORK_DAYS.length > 0,
		'the window has patterned working days, or the assertion above proves nothing'
	);
	assert.deepEqual(
		patterned.attendance.shiftCodes,
		['D', 'N', 'REST'],
		'the codes are the pattern’s own plus the day that departed from it'
	);
	assert.equal(row.att_normal_hours, patterned.attendance.normalHours);
	assert.equal(row.att_shift_codes, 'D, N, REST');

	// ── a leaver keeps their identity, and is scheduled only up to their last day ──────────────────
	assert.equal(leaver.employeeNumber, 'NHPMY0400');
	assert.equal(leaver.lastDay, '2026-03-05');
	assert.equal(
		leaver.designation,
		'Packer',
		'terms are read at the last day worked, not the pay date'
	);
	assert.equal(leaver.section, 'Warehouse');
	assert.equal(leaver.group, 'MY-MONTHLY');
	assert.equal(
		leaver.attendance.normalHours,
		PATTERNED_WORK_DAYS.filter((date) => date <= '2026-03-05').length * DAY_PAID_HOURS,
		'nobody is scheduled after they leave'
	);

	// ── the bank file skips the payslip with no destination, and says whose ───────────────────────
	assert.deepEqual(
		run.bank.map((payment) => payment.employeeNumber),
		['NHPMY0002']
	);
	assert.equal(run.bank[0].net, 3454.03);
	assert.deepEqual(run.skippedEmploymentIds, ['employment:leaver']);

	console.log(
		`payroll export data verified (${run.payslips.length} payslips, ` +
			`${patterned.attendance.normalHours} normal hours, ${run.bank.length} bank payments).`
	);
} finally {
	await vite.close();
}
