/**
 * The workbook vocabulary (`overtimePay`, `proratedSalary`, `grossEarnings`, …) is presentation, so
 * it lives in the export path, derived from what the payslip persisted. Statutory columns are named
 * from each charged scheme's own code (`sssEmployee`, `epfEmployer`), so no jurisdiction is named
 * here.
 */

import {
	bySchemeListing,
	schemeGroup,
	schemeLabel,
	type SchemeListing
} from '../../../lib/payroll/scheme-label.js';

export type ReportLine = {
	readonly componentCode: string;
	readonly componentName: string;
	/** The frozen label: for a derived overtime row, the band it was priced on (`OT-1.5X`). */
	readonly label?: string | undefined;
	readonly bucket: string;
	/** The input family that caused the line: BASE for the contracted amount, else the payslip adjustment's. */
	readonly family: string;
	readonly calculationSource: string;
	readonly amount: number;
	readonly quantity: number | null;
	/** The line's working as figures, where it has one: a prorated base line's `500.00 × 16/31`. */
	readonly detail?: string | undefined;
	/** An audited company expense whose cash never passes through the employee. */
	readonly isCompanyDirect: boolean;
	/** A capped employee reimbursement, excluding unrelated non-wage payments such as tax refunds. */
	readonly isClaim: boolean;
	readonly isLoanInstalment: boolean;
};

export type ReportPayslip = {
	/** Actual payment date of a paid saved payslip; absent/null means payment is not evidenced. */
	readonly paidDate?: string | null;
	/** Salary window captured by the settled payslip, independent of later calendar changes. */
	readonly salaryPeriod?: { readonly start: string; readonly end: string } | undefined;
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
	/** The person behind the row, for the employment-income returns (`income-return.ts`). */
	readonly person: {
		readonly employeeId: string;
		readonly dateOfBirth: string | null;
		readonly gender: 'MALE' | 'FEMALE' | null;
		readonly nationality: string | null;
		/** Exit fact `departure_on`, where the version declares and the leaver records it. */
		readonly departureOn: string | null;
	};
	readonly attendance: {
		readonly normalHours: number;
		readonly actualHours: number;
		readonly shiftCodes: readonly string[];
	};
	readonly gross: number;
	readonly totalDeductions: number;
	readonly net: number;
	readonly unfundedContributions: number;
	readonly fundingReceived: number;
	readonly employerCost: number;
	readonly lines: readonly ReportLine[];
	/** Scheme code → what it charged, with the listing the version froze on the charge. */
	readonly contributions: ReadonlyMap<string, ReportContribution>;
};
export type ReportContribution = SchemeListing & {
	readonly base: number;
	readonly employee: number;
	readonly employer: number;
};

type OutputSection = {
	readonly name: string;
	readonly unit: 'MONEY' | 'HOURS';
	readonly outputIds: ReadonlyArray<string>;
};

/**
 * The salary listing's identity block: who the row is, before any money.
 *
 * The listing's money columns are the catalogue's, exactly as the matrix sheet's are — same
 * codes, same order, same category headings — so every class an employer pays reconciles as a
 * column of its own. The layout is the arrangement (this identity block, the masthead, the
 * totals row), never a second vocabulary.
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
 * The sections in the order a payroll clerk reads them. A bucket section holds one column per
 * component the run settled, by catalogue code (2026-09-10 review: no code folds into a derived
 * sum). `unit` keeps hours from being formatted as money. The statutory sections name roles, filled
 * by the schemes the jurisdiction runs.
 */
/** The columns a bucket section claims: a predicate over the settled lines, in the clerk's order. */
type LineMatch = (line: ReportLine) => boolean;
/** The final column of every sheet, whatever else the population produced. */
const COMPANY_COST_SECTION_NAME = 'Company cost';
const EARNING_FAMILIES_RANKED = ['BASE', 'ALLOWANCE', 'WORK_DAY'] as const;

const SECTION_LAYOUT: readonly {
	readonly name: string;
	readonly unit: 'MONEY' | 'HOURS';
	readonly statutoryRoles?: readonly StatutoryRole[] | undefined;
	readonly outputIds?: readonly string[] | undefined;
	/** The settled lines whose codes are written under this heading, in code order. */
	readonly lines?: LineMatch | undefined;
	/** The column a matched line is written to; the component code unless the section says otherwise. */
	readonly columnId?: ((line: ReportLine) => string) | undefined;
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
			line.label === undefined || line.label === ''
				? line.componentCode
				: `${line.componentCode}:${line.label}`
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
	{
		name: 'Contribution funding',
		unit: 'MONEY',
		outputIds: ['unfundedContributions', 'fundingReceived', 'fundingOutstanding']
	},
	{ name: 'Employer costs', unit: 'MONEY', lines: (line) => line.bucket === 'EMPLOYER_COST' },
	{ name: 'Information', unit: 'MONEY', lines: (line) => line.bucket === 'INFORMATION' },
	{ name: COMPANY_COST_SECTION_NAME, unit: 'MONEY', outputIds: ['companyCost'] }
];

/** Where output ids no section ranks are collected, so a new id is never dropped. */
const OTHER_SECTION_NAME = 'Other';

/**
 * The catalogue-entries report: what people requested and the run settled, by family — no salary,
 * no absence, no statute. Same rows and identity block as the payroll workbook, fewer columns.
 */
const CATALOGUE_SECTIONS: readonly { readonly name: string; readonly family: string }[] = [
	{ name: 'Ad hoc', family: 'ADHOC' },
	{ name: 'Claims', family: 'CLAIM' },
	{ name: 'Loans', family: 'LOAN_REPAYMENT' }
];

/** The per-row roll-up column of the catalogue-entries report. */
const CATALOGUE_TOTAL_ID = 'total';

/** One column per catalogue code these payslips settled, sectioned by family, then the roll-up. */
export function catalogueGroups(payslips: readonly ReportPayslip[]): OutputSection[] {
	const lines = payslips.flatMap((payslip) => payslip.lines);
	const groups: OutputSection[] = [];
	for (const section of CATALOGUE_SECTIONS) {
		const outputIds = [
			...new Set(
				lines.filter((line) => line.family === section.family).map((line) => line.componentCode)
			)
		].toSorted();
		if (outputIds.length > 0) groups.push({ name: section.name, unit: 'MONEY', outputIds });
	}
	return groups.length === 0
		? []
		: [...groups, { name: 'Total', unit: 'MONEY', outputIds: [CATALOGUE_TOTAL_ID] }];
}

/** One row per payslip over the catalogue columns, squared off with zeros, plus its roll-up. */
export function catalogueRows(
	payslips: readonly ReportPayslip[],
	groups: readonly OutputSection[]
): Record<string, number>[] {
	const ids = groups.flatMap((group) => group.outputIds).filter((id) => id !== CATALOGUE_TOTAL_ID);
	return payslips.map((payslip) => {
		const row: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
		for (const line of payslip.lines)
			if (line.componentCode in row) row[line.componentCode]! += line.amount;
		row[CATALOGUE_TOTAL_ID] = ids.reduce((sum, id) => sum + row[id]!, 0);
		return row;
	});
}

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

/**
 * What the workbook calls one role of one scheme: `epfEmployee`, `epfEmployer`, `totalEpf`,
 * `epfGross`. A scheme that folds into another's column (`listing_group`: MY's Part C and Part F
 * rows into EPF — a person only ever matches one) is named by that column.
 */
export function statutoryColumn(charge: SchemeListing, role: StatutoryRole): string {
	const name = stem(
		charge.listing_group == null ? schemeLabel(charge) : (charge.label ?? schemeGroup(charge))
	);
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
	for (const charged of payslip.contributions.values()) {
		if (charged.employee !== 0) add(statutoryColumn(charged, 'employee'), charged.employee);
		if (charged.employer !== 0) add(statutoryColumn(charged, 'employer'), charged.employer);
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
		...(payslip.unfundedContributions > 0
			? {
					unfundedContributions: payslip.unfundedContributions,
					fundingReceived: payslip.fundingReceived,
					fundingOutstanding: Math.max(0, payslip.unfundedContributions - payslip.fundingReceived)
				}
			: {}),
		...statutoryOutputs(payslip),
		// The one total that is written: what this person cost the entity, last on every sheet.
		companyCost: payslip.employerCost
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
	// The schemes this population ran, in the order the entity's own listing reads them; each role's
	// block follows it, so the employee shares run SSS, PhilHealth, Pag-IBIG and so do the employer's.
	const byCode = new Map<string, SchemeListing>();
	for (const payslip of payslips)
		for (const charged of payslip.contributions.values())
			if (!byCode.has(charged.scheme_code)) byCode.set(charged.scheme_code, charged);
	const schemes = [...byCode.values()].toSorted(bySchemeListing);
	for (const section of SECTION_LAYOUT) {
		const match = section.lines;
		const outputIds =
			match == null
				? [
						...(section.statutoryRoles ?? []).flatMap((role) => [
							...new Set(schemes.map((charge) => statutoryColumn(charge, role)))
						]),
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
	if (unranked.length === 0) return groups;
	// Company cost stays last: anything unranked slots in front of it.
	const last = groups.at(-1);
	const other = { name: OTHER_SECTION_NAME, unit: 'MONEY' as const, outputIds: unranked };
	return last?.name === COMPANY_COST_SECTION_NAME
		? [...groups.slice(0, -1), other, last]
		: [...groups, other];
}
