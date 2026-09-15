/**
 * The workbook vocabulary.
 *
 * The customer's payroll workbook has a settled column vocabulary — `overtimePay`,
 * `proratedSalary`, `grossEarnings` — and the parity manifests compare those named ids. That
 * vocabulary is **presentation**, so it lives here, in the export path, and not as a column on any
 * model. A component knows its code, its type and how it is measured; it does not know what a
 * spreadsheet calls it.
 *
 * Everything below is derived from what was persisted — the payslip's inlined base, proration and
 * statutory entries, its `payslip_adjustments` rows, and its own four totals. No output id is
 * stored anywhere.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * NO JURISDICTION IS NAMED IN THIS FILE.
 *
 * A statutory column is produced by the contribution that charged it, not by a list of the schemes
 * one country happens to run. This module walks whatever statutory payslip lines a run actually
 * produced and names each column from the scheme's own code — `sssEmployee`, `wtaxEmployee`,
 * `epfEmployer`, `totalEpf`, `pcbGross` — so a scheme a tenant authors tomorrow exports the same
 * way the seeded ones do, and no jurisdiction is ever added anywhere.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { Schema } from 'effect';

const ReportLineSchema = Schema.Struct({
	componentCode: Schema.String,
	componentName: Schema.String,
	/** The frozen label: for a derived overtime row, the band it was priced on (`OT-1.5X`). */
	label: Schema.optionalKey(Schema.String),
	bucket: Schema.String,
	/** The input family that caused the line: BASE for the contracted amount, else the payslip adjustment's. */
	family: Schema.String,
	calculationSource: Schema.String,
	amount: Schema.Number,
	quantity: Schema.NullOr(Schema.Number),
	/** An audited company expense whose cash never passes through the employee. */
	isCompanyDirect: Schema.Boolean,
	/** A capped employee reimbursement, excluding unrelated non-wage payments such as tax refunds. */
	isClaim: Schema.Boolean,
	isLoanInstalment: Schema.Boolean
});
export type ReportLine = Schema.Schema.Type<typeof ReportLineSchema>;

export type ReportPayslip = {
	readonly employmentId: string;
	readonly employeeNumber: string;
	readonly currency: string;
	readonly designation: string | null;
	readonly section: string | null;
	readonly group: string | null;
	readonly employeeName: string;
	readonly identityNumber: string | null;
	readonly hireDate: string;
	readonly lastDay: string | null;
	readonly attendance: {
		readonly normalHours: number;
		readonly actualHours: number;
		readonly shiftCodes: readonly string[];
	};
	readonly gross: number;
	readonly totalDeductions: number;
	readonly net: number;
	readonly employerCost: number;
	readonly lines: readonly ReportLine[];
	/** Scheme code → what it charged. */
	readonly contributions: ReadonlyMap<string, { base: number; employee: number; employer: number }>;
};

const OutputSectionSchema = Schema.Struct({
	name: Schema.String,
	unit: Schema.Literals(['MONEY', 'HOURS']),
	outputIds: Schema.Array(Schema.String)
});
type OutputSection = Schema.Schema.Type<typeof OutputSectionSchema>;

/**
 * The salary listing's identity block: who the row is, before any money.
 *
 * This is all that survives of the old vendor projection. Everything to the right of it used to be
 * a fixed list of forty-odd output ids — `basic_salary`, `allowance`, `incentive_ot` — into which
 * the catalogue was summed: every allowance code the list did not name by hand disappeared into
 * one `allowance` column, every non-loan deduction into `adhocDeductions`, and an employer with
 * fourteen allowances exported one column and could not reconcile a line of it.
 *
 * The listing's money columns are now the catalogue's, exactly as the matrix sheet's are — same
 * codes, same order, same category headings. The layout is the arrangement (this identity block,
 * the masthead, the totals row), never a second vocabulary.
 */
export const IDENTITY_OUTPUT_IDS = [
	'designation',
	'section',
	'group',
	'eid',
	'name',
	'ic_no',
	'hire_date',
	'last_day'
] as const;

/** The identity half of one listing row. The money half is `workbookRow`, like everywhere else. */
export function identityRow(payslip: ReportPayslip): Record<string, string | number | null> {
	return {
		designation: payslip.designation,
		section: payslip.section,
		group: payslip.group,
		eid: payslip.employeeNumber,
		name: payslip.employeeName,
		ic_no: payslip.identityNumber,
		hire_date: payslip.hireDate,
		last_day: payslip.lastDay
	};
}

/**
 * The sections and their order.
 *
 * A section names either **catalogue buckets** or a fixed list of output ids, and a bucket section
 * is filled by the catalogue itself: one column per component the run actually settled, labelled
 * by its catalogue code, in code order. That is the whole of the change
 * the 2026-09-10 review asked for. Before it, this layout named a handful of derived sums —
 * `taxableBenefits`, `totalClaims`, `adhocDeductions` — and every code the projection did not
 * recognise disappeared into one of them: an employer with fourteen allowances exported one
 * `allowance` column and could not reconcile a single line of it.
 *
 * The order is the order a payroll clerk reads: basic, allowances, overtime, absence, back pay and
 * other earnings, gross, the statutory charges, deductions, what is paid after gross, net, the
 * totals and the bases they were charged on, the employer's own costs, anything informational.
 *
 * `unit` is not decoration: an attendance column counts hours, and formatting hours as money — or
 * tinting them like money — is how a reader ends up reading 7.50 as seven ringgit fifty.
 *
 * The two statutory sections name **roles**, not columns. Which columns those roles resolve to is
 * decided by the schemes the jurisdiction actually runs, so this layout is the same layout in Kuala
 * Lumpur and in Manila — only its statutory block is filled differently.
 */
/** The columns a bucket section claims: a predicate over the settled lines, in the clerk's order. */
type LineMatch = (line: ReportLine) => boolean;
const EARNING_FAMILIES_RANKED = ['BASE', 'ALLOWANCE', 'WORK_DAY'] as const;

const SECTION_LAYOUT: readonly {
	readonly name: string;
	readonly unit: 'MONEY' | 'HOURS';
	readonly statutoryRoles?: readonly StatutoryRole[];
	readonly outputIds?: readonly string[];
	/** The settled lines whose codes are written under this heading, in code order. */
	readonly lines?: LineMatch;
	/** The column a matched line is written to; the component code unless the section says otherwise. */
	readonly columnId?: (line: ReportLine) => string;
}[] = [
	{ name: 'Basic', unit: 'MONEY', lines: (line) => line.family === 'BASE' },
	{
		name: 'Allowances',
		unit: 'MONEY',
		lines: (line) => line.bucket === 'EARNING' && line.family === 'ALLOWANCE'
	},
	{
		name: 'Overtime',
		unit: 'MONEY',
		lines: (line) => line.bucket === 'EARNING' && line.family === 'WORK_DAY',
		// A clerk reads overtime by its multiple — 1.5x, 2x, 3x and the incentive past the ceiling
		// at each — so a derived overtime row is a column per band, not one lump under its code.
		columnId: (line) =>
			line.label === undefined || line.label === '' ? line.componentCode : `${line.componentCode}:${line.label}`
	},
	{ name: 'Absence', unit: 'MONEY', lines: (line) => line.bucket === 'ABSENCE' },
	{
		name: 'Back pay & other earnings',
		unit: 'MONEY',
		lines: (line) =>
			line.bucket === 'EARNING' &&
			!(EARNING_FAMILIES_RANKED as readonly string[]).includes(line.family)
	},
	{ name: 'Gross', unit: 'MONEY', outputIds: ['grossEarnings'] },
	{ name: 'Statutory', unit: 'MONEY', statutoryRoles: ['employee', 'employer'] },
	{ name: 'Deductions', unit: 'MONEY', lines: (line) => line.bucket === 'DEDUCTION' },
	{ name: 'Payments', unit: 'MONEY', lines: (line) => line.bucket === 'NON_WAGE_PAYMENT' },
	{ name: 'Net', unit: 'MONEY', outputIds: ['netPay'] },
	{ name: 'Employer costs', unit: 'MONEY', lines: (line) => line.bucket === 'EMPLOYER_COST' },
	{ name: 'Information', unit: 'MONEY', lines: (line) => line.bucket === 'INFORMATION' }
];

/** Where output ids no section ranks are collected, so a new id is never dropped. */
const OTHER_SECTION_NAME = 'Other';

/** The ids the layout names outright; `totalDeductions` is one, not a scheme's total. */
const FIXED_IDS: ReadonlySet<string> = new Set(
	SECTION_LAYOUT.flatMap((section) => section.outputIds ?? [])
);

/** The four column roles a scheme can produce, each with the suffix that names it. */
type StatutoryRole = 'employee' | 'employer' | 'total' | 'base';

/** `EPF_NON_CITIZEN` → `epfNonCitizen`: the scheme code as a camelCase column stem. */
const stem = (code: string): string =>
	code
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.map((word, index) => (index === 0 ? word : `${word[0]!.toUpperCase()}${word.slice(1)}`))
		.join('');

/** What the workbook calls one role of one scheme: `epfEmployee`, `epfEmployer`, `totalEpf`, `epfGross`. */
export function statutoryColumn(code: string, role: StatutoryRole): string {
	const name = stem(code);
	switch (role) {
		case 'employee':
			return `${name}Employee`;
		case 'employer':
			return `${name}Employer`;
		case 'total':
			return `total${name[0]!.toUpperCase()}${name.slice(1)}`;
		case 'base':
			return `${name}Gross`;
	}
}

const ROLE_OF: readonly (readonly [StatutoryRole, RegExp])[] = [
	['employee', /Employee$/],
	['employer', /Employer$/],
	['total', /^total[A-Z]/],
	['base', /Gross$/]
];

/** Whether an output id is a statutory column of the given role; catalogue codes are UPPER_SNAKE and never match. */
const hasRole = (outputId: string, role: StatutoryRole): boolean =>
	ROLE_OF.some(([candidate, pattern]) => candidate === role && pattern.test(outputId));

/**
 * The statutory columns, derived from the schemes the run actually charged.
 *
 * Nothing here knows a country. Every statutory payslip line carries the scheme that produced it,
 * and the column is named from that code — so a run charges SSS and the sheet grows an
 * `sssEmployee` column, by the same code path a Malaysian run grows an `epfEmployee` one. A share
 * the scheme never charges (SDL has no employee side) produces no column; the total column appears
 * only where both sides are charged.
 */
function statutoryOutputs(payslip: ReportPayslip): Record<string, number> {
	const outputs: Record<string, number> = {};
	const add = (outputId: string, amount: number): void => {
		outputs[outputId] = (outputs[outputId] ?? 0) + amount;
	};
	for (const [code, charged] of payslip.contributions) {
		if (charged.employee !== 0) add(statutoryColumn(code, 'employee'), charged.employee);
		if (charged.employer !== 0) add(statutoryColumn(code, 'employer'), charged.employer);
	}
	return outputs;
}

/** One payslip as the catalogue-driven matrix sees it. */
/** The column a settled line is written to: the section that claims it decides, else its code. */
const columnIdOf = (line: ReportLine): string =>
	SECTION_LAYOUT.find((section) => section.lines?.(line))?.columnId?.(line) ?? line.componentCode;
function workbookRow(payslip: ReportPayslip): Record<string, number> {
	const columns: Record<string, number> = {};
	// One column per catalogue component the payslip actually settled, labelled by its code. Two
	// lines under one code — two overtime bands, a claim raised twice — are one column and one sum,
	// which is what "one column per catalogue item" means.
	for (const line of payslip.lines) {
		const id = columnIdOf(line);
		columns[id] = (columns[id] ?? 0) + line.amount;
	}
	return {
		...columns,
		// Gross, net and the statutory block, which is one column per scheme and share. The
		// deduction total, employer cost and the statutory totals and bases are not written: a clerk
		// reconciles the sheet against the lines, and those were a second sum of the same columns.
		grossEarnings: payslip.gross,
		netPay: payslip.net,
		...statutoryOutputs(payslip)
	};
}

/**
 * One sheet's rows, squared off.
 *
 * A sheet's columns are the union of what its payslips produced, and an employment enrolled in one
 * scheme fewer than its colleagues would otherwise leave that column blank on its row. Blank is not
 * what happened: the scheme was assessed and charged nothing. Filling it with an explicit zero is
 * the difference between "this employee contributed nothing" and "this cell was never written",
 * and every reconciliation that walks the sheet reads the second as a defect.
 *
 * This is safe precisely because it is per sheet, and a sheet is one legal entity's period and so
 * one jurisdiction: a zero here says a scheme this population runs did not charge *this* person. A
 * scheme the population does not run has no column at all, which is the honest answer.
 */
export function workbookRows(payslips: readonly ReportPayslip[]): Record<string, number>[] {
	const rows = payslips.map((payslip) => workbookRow(payslip));
	const outputIds = new Set(rows.flatMap((row) => Object.keys(row)));
	for (const row of rows)
		for (const outputId of outputIds) if (!(outputId in row)) row[outputId] = 0;
	return rows;
}

/**
 * The sections the given payslips actually populate, in layout order.
 *
 * A bucket section is filled from the catalogue: every component code these payslips settled under
 * that bucket, ordered by code, so two runs of the same catalogue produce the same columns in the
 * same order. A fixed section keeps its stated ids and
 * drops the ones nothing populated.
 *
 * An id no section claims is not dropped — it lands in a trailing `Other` section — so adding an
 * output to `workbookRow` can never silently lose a column.
 */
export function outputGroups(
	payslips: readonly ReportPayslip[],
	rows: readonly Record<string, number>[]
): OutputSection[] {
	const present = new Set(rows.flatMap((row) => Object.keys(row)));
	const lines = payslips.flatMap((payslip) => payslip.lines);
	const claimed = new Set<string>();
	const groups: OutputSection[] = [];
	for (const section of SECTION_LAYOUT) {
		const match = section.lines;
		const outputIds =
			match == null
				? [
						...(section.statutoryRoles ?? []).flatMap((role) =>
							[...present].filter((id) => !FIXED_IDS.has(id) && hasRole(id, role)).toSorted()
						),
						...(section.outputIds ?? [])
					].filter((id) => present.has(id))
				: [...new Set(lines.filter(match).map(section.columnId ?? columnIdOf))]
						.toSorted()
						// A code is one column: the first section that claims it keeps it.
						.filter((id) => present.has(id) && !claimed.has(id));
		for (const id of outputIds) claimed.add(id);
		if (outputIds.length > 0) groups.push({ name: section.name, unit: section.unit, outputIds });
	}
	const unranked = [...present].filter((id) => !claimed.has(id)).toSorted();
	return unranked.length === 0
		? groups
		: [...groups, { name: OTHER_SECTION_NAME, unit: 'MONEY', outputIds: unranked }];
}
