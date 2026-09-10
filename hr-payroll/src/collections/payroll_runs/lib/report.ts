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
 * produced and asks `vocabulary.ts` what the workbook calls each one; a Philippine run therefore
 * exports `sssEmployee` and `withholdingTax` for the same reason a Malaysian one exports
 * `epfEmployee` and `pcb` — because that is what was charged. Adding a jurisdiction is an addition
 * to `vocabulary.ts` and no change at all here.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */

import { Schema } from 'effect';
import { statutoryNaming, statutoryOutputIds, type StatutoryRole } from './vocabulary.js';

const ReportLineSchema = Schema.Struct({
	componentCode: Schema.String,
	componentName: Schema.String,
	nature: Schema.String,
	/** The catalogue's own order for this component, which is the order its column is written in. */
	sequence: Schema.Number,
	calculationSource: Schema.String,
	amount: Schema.Number,
	quantity: Schema.NullOr(Schema.Number),
	/** An audited company expense whose cash never passes through the employee. */
	isCompanyDirect: Schema.Boolean,
	/** A capped employee reimbursement, excluding unrelated non-wage payments such as tax refunds. */
	isClaim: Schema.Boolean,
	isLoanInstalment: Schema.Boolean,
	/** Derived overtime lines carry the day type of the statutory band that priced them. */
	overtimeDayType: Schema.NullOr(
		Schema.Literals(['ORDINARY', 'REST_DAY', 'PUBLIC_HOLIDAY', 'SPECIAL_HOLIDAY'])
	),
	isOvertimeExcess: Schema.Boolean
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
 * A section names either **catalogue natures** or a fixed list of output ids, and a nature section
 * is filled by the catalogue itself: one column per component the run actually settled, labelled
 * by its catalogue code, in the catalogue's own `sequence` order. That is the whole of the change
 * the 2026-09-10 review asked for. Before it, this layout named a handful of derived sums —
 * `taxableBenefits`, `totalClaims`, `adhocDeductions` — and every code the projection did not
 * recognise disappeared into one of them: an employer with fourteen allowances exported one
 * `allowance` column and could not reconcile a single line of it.
 *
 * The order is still the order a payroll clerk reads: what was earned, what absence and deductions
 * took away, gross, what is paid after gross, net, the statutory charges, the totals and the bases
 * they were charged on, the employer's own costs, anything informational, and finally attendance.
 *
 * `unit` is not decoration: an attendance column counts hours, and formatting hours as money — or
 * tinting them like money — is how a reader ends up reading 7.50 as seven ringgit fifty.
 *
 * The two statutory sections name **roles**, not columns. Which columns those roles resolve to is
 * decided by the schemes the jurisdiction actually runs, so this layout is the same layout in Kuala
 * Lumpur and in Manila — only its statutory block is filled differently.
 */
const SECTION_LAYOUT: readonly {
	readonly name: string;
	readonly unit: 'MONEY' | 'HOURS';
	readonly statutoryRoles?: readonly StatutoryRole[];
	readonly outputIds?: readonly string[];
	/** The catalogue natures whose components are written under this heading, in `sequence` order. */
	readonly natures?: readonly string[];
}[] = [
	{ name: 'Earnings', unit: 'MONEY', natures: ['EARNING'] },
	{ name: 'Absence & deductions', unit: 'MONEY', natures: ['ABSENCE', 'DEDUCTION'] },
	{ name: 'Gross', unit: 'MONEY', outputIds: ['grossEarnings'] },
	{ name: 'Payments', unit: 'MONEY', natures: ['NON_WAGE_PAYMENT'] },
	{ name: 'Net', unit: 'MONEY', outputIds: ['netPay'] },
	{ name: 'Statutory', unit: 'MONEY', statutoryRoles: ['employee', 'employer'] },
	{
		name: 'Totals & bases',
		unit: 'MONEY',
		statutoryRoles: ['total', 'base'],
		outputIds: ['totalDeductions', 'employerCost']
	},
	{ name: 'Employer costs', unit: 'MONEY', natures: ['EMPLOYER_COST'] },
	{ name: 'Information', unit: 'MONEY', natures: ['INFORMATION'] },
	{
		name: 'Attendance',
		unit: 'HOURS',
		outputIds: ['ot10Hours', 'ot15Hours', 'ot20Hours', 'ot30Hours', 'totalOTHours']
	}
];

/** Where output ids the vocabulary does not rank are collected, so a new id is never dropped. */
const OTHER_SECTION_NAME = 'Other';

function sumLines(payslip: ReportPayslip, predicate: (line: ReportLine) => boolean): number {
	return payslip.lines.reduce((total, line) => total + (predicate(line) ? line.amount : 0), 0);
}

function sumHours(payslip: ReportPayslip, predicate: (line: ReportLine) => boolean): number {
	return payslip.lines.reduce(
		(total, line) => total + (predicate(line) ? (line.quantity ?? 0) : 0),
		0
	);
}

/**
 * The statutory columns, derived from the schemes the run actually charged.
 *
 * Nothing here knows a country. Every statutory payslip line carries the scheme that produced
 * it, and the scheme's code is what the workbook vocabulary is keyed by — so a run charges SSS and
 * the sheet grows an `sssEmployee` column, for the same reason and by the same code path that a
 * Malaysian run grows an `epfEmployee` one.
 *
 * A charge that has nowhere to go is an error, not a rounding-down to zero: if a scheme took money
 * from someone and this vocabulary cannot name the column, the workbook must not be written. The
 * alternative is a sheet in which "we did not charge you" and "we charged you and lost the number"
 * are the same empty cell.
 */
function statutoryOutputs(payslip: ReportPayslip): Record<string, number> {
	const outputs: Record<string, number> = {};
	const add = (outputId: string, amount: number): void => {
		outputs[outputId] = (outputs[outputId] ?? 0) + amount;
	};
	for (const [code, charged] of payslip.contributions) {
		const naming = statutoryNaming(code);
		for (const side of ['employee', 'employer'] as const)
			if (naming[side] == null && charged[side] !== 0)
				throw new Error(
					`Statutory contribution ${JSON.stringify(code)} charged the ${side} ` +
						`${charged[side]} but has no ${side} column. Name it in STATUTORY_VOCABULARY ` +
						`(lib/vocabulary.ts).`
				);
		if (naming.employee != null) add(naming.employee, charged.employee);
		if (naming.employer != null) add(naming.employer, charged.employer);
		if (naming.total != null) add(naming.total, charged.employee + charged.employer);
		if (naming.base != null) add(naming.base, charged.base);
	}
	return outputs;
}

/**
 * One payslip's money columns: the catalogue's own, plus the totals and the attendance hours.
 *
 * There is one vocabulary now. The fixed vendor projection this file used to also produce — a
 * hand-written list of output ids that summed the catalogue into `allowance`, `taxableBenefits`
 * and `adhocDeductions` — is gone, along with the argument for it: a column somebody has to add by
 * hand for every new pay component is a column that silently lumps the ones nobody remembered.
 *
 * The overtime-hours columns are named for the multiplier they historically carried; they are
 * derived from the day type of the rule each line pays, which is the stable fact — a jurisdiction
 * that changes its rest-day multiple does not change what a rest day is.
 *
 * `ot10Hours` is the exception, and it is derived from the award rather than the day: hours past
 * the statutory daily overtime ceiling are reclassified and valued at `ORDINARY_HOURLY` — the plain
 * hourly rate, no multiple — so they belong in a 1.0× bucket and not in the 1.5× one their day type
 * would otherwise put them in. Counting them by day type overstated the multiplied buckets by
 * exactly the excess hours, which is the tally the customer reconciles against.
 */
function derivedTotals(payslip: ReportPayslip): Record<string, number> {
	const overtimePay = sumLines(
		payslip,
		(line) => line.calculationSource === 'OVERTIME' && !line.isOvertimeExcess
	);
	const incentiveOTPay = sumLines(payslip, (line) => line.isOvertimeExcess);
	const multipliedHours = (dayType: ReportLine['overtimeDayType']): number =>
		sumHours(payslip, (line) => !line.isOvertimeExcess && line.overtimeDayType === dayType);
	return {
		proratedSalary: sumLines(payslip, (line) => line.calculationSource === 'SCHEDULE'),
		overtimePay,
		incentiveOTPay,
		// Overtime corresponding to work past the total-work-hours boundary is reclassified to a
		// benefit component, so it would
		// otherwise be reported twice: once here and once as `incentiveOTPay`. The customer's
		// workbook keeps its allowance column and its incentive-overtime column disjoint, and so
		// does this one.
		taxableBenefits: sumLines(
			payslip,
			(line) =>
				line.nature === 'EARNING' &&
				!['SCHEDULE', 'OVERTIME'].includes(line.calculationSource) &&
				!line.isOvertimeExcess
		),
		// The rebuilt type list has no exempt-earning kind: a payment that is not wages is a
		// REIMBURSEMENT and is reported under Reimbursements. The column is kept so the workbook
		// vocabulary is unchanged, and it is always zero.
		exemptBenefits: 0,
		totalClaims: sumLines(
			payslip,
			(line) => line.nature === 'NON_WAGE_PAYMENT' && line.isClaim && !line.isCompanyDirect
		),
		ot10Hours: sumHours(payslip, (line) => line.isOvertimeExcess),
		ot15Hours: multipliedHours('ORDINARY'),
		ot20Hours: multipliedHours('REST_DAY'),
		ot30Hours: multipliedHours('PUBLIC_HOLIDAY'),
		totalOTHours: sumHours(payslip, (line) => line.overtimeDayType != null),
		totalUnpaidLeaveDeduction: sumLines(payslip, (line) => line.nature === 'ABSENCE'),
		loanRecovery: sumLines(payslip, (line) => line.isLoanInstalment),
		adhocDeductions: sumLines(
			payslip,
			(line) => line.nature === 'DEDUCTION' && !line.isLoanInstalment
		),
		grossEarnings: payslip.gross,
		totalDeductions: payslip.totalDeductions,
		employerCost: payslip.employerCost,
		netPay: payslip.net,
		// The statutory block, and with it the per-scheme totals and the wages each scheme was
		// charged on. Every one of these is already persisted on statutory payslip lines; nothing
		// here is a new calculation, and nothing here is a jurisdiction's name.
		...statutoryOutputs(payslip)
	};
}

/** One payslip as the catalogue-driven matrix sees it. */
function workbookRow(payslip: ReportPayslip): Record<string, number> {
	const derived = derivedTotals(payslip);
	const columns: Record<string, number> = {};
	// One column per catalogue component the payslip actually settled, labelled by its code. Two
	// lines under one code — two overtime bands, a claim raised twice — are one column and one sum,
	// which is what "one column per catalogue item" means.
	for (const line of payslip.lines)
		columns[line.componentCode] = (columns[line.componentCode] ?? 0) + line.amount;
	return {
		...columns,
		ot10Hours: derived.ot10Hours,
		ot15Hours: derived.ot15Hours,
		ot20Hours: derived.ot20Hours,
		ot30Hours: derived.ot30Hours,
		totalOTHours: derived.totalOTHours,
		// The agreed totals, and nothing else lumped: gross, net, the two totals and the statutory
		// block, which is already one column per scheme.
		grossEarnings: payslip.gross,
		totalDeductions: payslip.totalDeductions,
		employerCost: payslip.employerCost,
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
 * A nature section is filled from the catalogue: every component code these payslips settled under
 * that nature, ordered by the catalogue's own `sequence` and then by code, so two runs of the same
 * catalogue produce the same columns in the same order. A fixed section keeps its stated ids and
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
	/** Catalogue order for every code these payslips settled, by the nature it settled under. */
	const byNature = new Map<string, Map<string, number>>();
	for (const payslip of payslips)
		for (const line of payslip.lines) {
			const codes = byNature.get(line.nature) ?? new Map<string, number>();
			// The lowest sequence wins where one code appears under two rows of a lineage's history.
			codes.set(
				line.componentCode,
				Math.min(codes.get(line.componentCode) ?? Infinity, line.sequence)
			);
			byNature.set(line.nature, codes);
		}
	const claimed = new Set<string>();
	const groups: OutputSection[] = [];
	for (const section of SECTION_LAYOUT) {
		const outputIds =
			section.natures == null
				? [
						...statutoryOutputIds(section.statutoryRoles ?? []),
						...(section.outputIds ?? [])
					].filter((id) => present.has(id))
				: section.natures
						.flatMap((nature) => [...(byNature.get(nature) ?? new Map()).entries()])
						.toSorted(([leftCode, left], [rightCode, right]) =>
							left === right ? leftCode.localeCompare(rightCode) : left - right
						)
						.map(([code]) => code)
						.filter((id) => present.has(id));
		for (const id of outputIds) claimed.add(id);
		if (outputIds.length > 0) groups.push({ name: section.name, unit: section.unit, outputIds });
	}
	const unranked = [...present].filter((id) => !claimed.has(id)).toSorted();
	return unranked.length === 0
		? groups
		: [...groups, { name: OTHER_SECTION_NAME, unit: 'MONEY', outputIds: unranked }];
}
