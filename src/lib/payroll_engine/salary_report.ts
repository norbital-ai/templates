import type { Masked, Row } from '@norbital-ai/bolt';
import { Decimal } from '@norbital-ai/std/decimal';
import { Result, Schema } from 'effect';
import { fieldValue, numberOf } from './foundation.js';

type LineField = 'base' | 'adjustments' | 'company_payments' | 'statutory';
/** One stored payslip line of a line column. */
type Line<F extends LineField> = NonNullable<Exclude<Row<'payslip'>[F], Masked>>[number];
/** A line column as read: the lines the report reads of each (a line's `source_id`, which it does not read, may be
 * absent), masked to a caller its grants leave it out of. */
type Lines<F extends LineField, K extends keyof Line<F>> =
	| readonly (Pick<Line<F>, Exclude<K, 'source_id'>> &
			Partial<Pick<Line<F>, Extract<K, 'source_id'>>>)[]
	| Masked
	| null
	| undefined;

export const SalaryColumn = Schema.Struct({
	group: Schema.String,
	family: Schema.String,
	code: Schema.String,
	label: Schema.String,
	external: Schema.Boolean
});
export type SalaryColumn = typeof SalaryColumn.Type;
/** One salary listing: an entity's run in one currency. The payroll export carries it as JSON; the page decodes it. */
export const SalaryReport = Schema.Struct({
	company: Schema.String,
	period: Schema.String,
	currency: Schema.String,
	run_kind: Schema.String,
	pay_date: Schema.String,
	run_reference: Schema.String,
	minor_units: Schema.Number,
	warnings: Schema.Array(Schema.String),
	columns: Schema.Array(SalaryColumn),
	rows: Schema.Array(
		Schema.Struct({
			employee_number: Schema.String,
			name: Schema.String,
			status: Schema.String,
			amounts: Schema.Array(Schema.NullOr(Schema.Number))
		})
	)
});
export type SalaryReport = typeof SalaryReport.Type;
export type SalaryCatalog = {
	readonly family: string;
	readonly code: string;
	readonly direction?: string | null;
	readonly destination?: string | null;
	readonly name?: string | null;
};
export type SalaryEmployee = {
	readonly employee_number: string;
	readonly name: string;
	readonly status: string;
	readonly base: Lines<'base', 'component_code' | 'label' | 'amount'>;
	readonly adjustments: Lines<
		'adjustments',
		'family' | 'source_id' | 'component_code' | 'label' | 'amount' | 'destination'
	>;
	readonly company_payments?: Lines<
		'company_payments',
		'family' | 'source_id' | 'component_code' | 'label' | 'amount'
	>;
	readonly statutory: Lines<'statutory', 'scheme_code' | 'employee_amount' | 'employer_amount'>;
	readonly gross: unknown;
	readonly total_deductions: unknown;
	readonly net: unknown;
	readonly bank_charges?: unknown;
	readonly consumed_entries?: readonly {
		readonly family: string;
		readonly code: string;
		readonly source_id?: string;
	}[];
};

export const SalaryReportConfiguration = Schema.Struct({
	group_order: Schema.optional(Schema.Array(Schema.String)),
	items: Schema.optional(
		Schema.Array(
			Schema.Struct({
				family: Schema.String,
				code: Schema.String,
				group: Schema.optional(Schema.String),
				payment: Schema.optional(
					Schema.Literals(['EXTERNAL', 'INTERNAL', 'INFORMATION', 'OUTSIDE_NET', 'UNCONFIRMED'])
				)
			})
		)
	)
});

/** A line column's lines; a masked column refuses rather than reading as none. */
const linesOf = <T>(value: readonly T[] | Masked | null | undefined, field: LineField) =>
	Result.getOrThrow(fieldValue(value ?? [], `payslip.${field}`));
const money = (value: unknown): number => Schema.decodeUnknownSync(Schema.Number)(numberOf(value));
const bankCharge = (value: unknown): number | null =>
	Schema.decodeUnknownSync(Schema.NullOr(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))))(
		numberOf(value)
	);
const total = (values: readonly number[]): number =>
	values.reduce((sum, value) => sum.plus(Decimal.of(String(value))), Decimal.of(0)).toNumber();
const key = (family: string, code: string) => `${family}:${code}`;
/** A missing label reads as its code in sentence case (`UNPAID_DAYS` → `Unpaid days`); a bare acronym stays. */
const humanised = (code: string): string =>
	code.includes('_') ? code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' ') : code;
/** A statutory catalogue row's presentation: its short label and display order. */
export type SalaryScheme = {
	readonly code: string;
	readonly label?: string | null | undefined;
	readonly display_order?: number | null | undefined;
};
/** The catalogue's label; an unlabelled scheme reads as its code (scheme codes are acronyms). */
export const schemeLabel = (schemes: readonly SalaryScheme[], code: string): string =>
	schemes.find((scheme) => scheme.code === code)?.label ?? code;
/** The catalogue's display order; an unordered scheme follows every ordered one. */
export const schemeRank = (schemes: readonly SalaryScheme[], code: string): number =>
	schemes.find((scheme) => scheme.code === code)?.display_order ?? Number.MAX_SAFE_INTEGER;

const GROUPS = [
	'Basic pay',
	'Allowances',
	'Overtime and other work',
	'Back pay and other earnings',
	'Leave pay',
	'Pre-gross deductions',
	'Gross pay',
	'Claims and other pay',
	'Loans and other deductions',
	'Employee statutory',
	'Total deductions',
	'Net pay',
	'Employer statutory',
	'Company-paid claims and benefits',
	'Tax and benefit information',
	'Company bank charges',
	'Total company payment'
];

/** Retains settled amounts; the captured profile groups columns and identifies company cash destinations. */
export function salaryReport(input: {
	readonly company: string;
	readonly period: string;
	readonly currency: string;
	readonly run_kind: string;
	readonly pay_date: string;
	readonly run_reference: string;
	readonly minor_units: number;
	readonly configuration?: unknown;
	readonly catalogs: readonly SalaryCatalog[];
	readonly schemes?: readonly SalaryScheme[];
	readonly employees: readonly SalaryEmployee[];
}): SalaryReport {
	const profilePresent = input.configuration != null;
	const configuration = Schema.decodeUnknownSync(SalaryReportConfiguration)(
		input.configuration ?? {}
	);
	const classifications = new Map(
		(configuration.items ?? []).map((item) => [key(item.family, item.code), item])
	);
	const catalog = new Map(input.catalogs.map((row) => [key(row.family, row.code), row]));
	const columns = new Map<string, SalaryColumn>();
	const warnings = new Set<string>();
	if (!profilePresent)
		warnings.add(
			'The salary report payment profile is missing. Confirm company payments before using the company total.'
		);
	const rows = input.employees.map((employee) => {
		const amounts = new Map<string, number>();
		const companyPayments = linesOf(employee.company_payments, 'company_payments');
		let needsConfirmation = !profilePresent;
		const bankCharges = bankCharge(employee.bank_charges);
		if (bankCharges === null) {
			needsConfirmation = true;
			warnings.add(
				'Confirm company bank charges before using the company total. Enter 0 if there are no bank charges.'
			);
		}
		const outsideNet = (family: string, code: string, destination?: string, captured = false) => {
			const definition = catalog.get(key(family, code));
			const route = destination ?? definition?.destination;
			if (route == null) {
				needsConfirmation = true;
				warnings.add(`Confirm the payment destination of ${code} before using the company total.`);
				return;
			}
			if (route !== 'EMPLOYER') return;
			const payment = classifications.get(key(family, code))?.payment;
			if (payment === 'INFORMATION' || (captured && payment === 'OUTSIDE_NET')) return;
			needsConfirmation = true;
			warnings.add(
				`Confirm the amount and payment status of ${definition?.name ?? code} (${code}), recorded outside employee net pay, before using the company total.`
			);
		};
		for (const entry of employee.consumed_entries ?? [])
			outsideNet(
				entry.family,
				entry.code,
				undefined,
				entry.source_id != null &&
					companyPayments.some(
						(payment) =>
							payment.source_id === entry.source_id &&
							payment.family === entry.family &&
							payment.component_code === entry.code
					)
			);
		const add = (column: SalaryColumn, amount: number) => {
			const id = key(column.family, column.code);
			if (!columns.has(id)) columns.set(id, column);
			amounts.set(id, total([amounts.get(id) ?? 0, amount]));
		};
		const line = (
			row: {
				readonly component_code: string;
				readonly label?: string | null;
				readonly amount: number;
				readonly destination?: string;
			},
			family: string
		) => {
			const definition = catalog.get(key(family, row.component_code));
			const classification = classifications.get(key(family, row.component_code));
			const destination = row.destination ?? definition?.destination;
			const employer = destination === 'EMPLOYER';
			const companyPaid = employer && classification?.payment === 'OUTSIDE_NET';
			const deduction =
				!employer &&
				(family === 'LOAN_REPAYMENT' ||
					family === 'STATUTORY_CARRY' ||
					definition?.direction === 'SUBTRACT');
			const net = destination === 'NET';
			const recipientRequired =
				(deduction && (net || family === 'LOAN_REPAYMENT')) ||
				(net && row.amount < 0 && definition === undefined);
			if (
				row.amount !== 0 &&
				family !== 'STATUTORY_CARRY' &&
				recipientRequired &&
				(!deduction ||
					(classification?.payment !== 'EXTERNAL' && classification?.payment !== 'INTERNAL'))
			) {
				needsConfirmation = true;
				warnings.add(
					`Confirm who receives ${row.label ?? row.component_code} (${row.component_code}) before using the company total.`
				);
			}
			if (row.amount !== 0 && employer) outsideNet(family, row.component_code, destination, true);
			const group = employer
				? companyPaid
					? 'Company-paid claims and benefits'
					: 'Tax and benefit information'
				: family === 'LOAN_REPAYMENT'
					? 'Loans and other deductions'
					: family === 'CLAIM' || (net && !deduction)
						? 'Claims and other pay'
						: net && deduction
							? 'Loans and other deductions'
							: deduction
								? 'Pre-gross deductions'
								: family === 'ALLOWANCE'
									? 'Allowances'
									: family === 'WORK'
										? 'Overtime and other work'
										: family === 'LEAVE'
											? 'Leave pay'
											: 'Back pay and other earnings';
			add(
				{
					group: classification?.group ?? group,
					family,
					code: row.component_code,
					label: row.label ?? humanised(row.component_code),
					external: companyPaid || (!employer && classification?.payment === 'EXTERNAL')
				},
				deduction ? -row.amount : row.amount
			);
		};
		for (const row of linesOf(employee.base, 'base'))
			line(row, catalog.has(key('ALLOWANCE', row.component_code)) ? 'ALLOWANCE' : 'WORK');
		for (const row of linesOf(employee.adjustments, 'adjustments')) line(row, row.family);
		for (const row of companyPayments) line({ ...row, destination: 'EMPLOYER' }, row.family);
		let government = 0;
		for (const row of linesOf(employee.statutory, 'statutory')) {
			for (const [family, group, amount] of [
				['EMPLOYEE_STATUTORY', 'Employee statutory', row.employee_amount],
				['EMPLOYER_STATUTORY', 'Employer statutory', row.employer_amount]
			] as const) {
				if (amount === 0) continue;
				government = total([government, amount]);
				add(
					{
						group,
						family,
						code: row.scheme_code,
						label: schemeLabel(input.schemes ?? [], row.scheme_code),
						external: true
					},
					amount
				);
			}
		}
		add(
			{
				group: 'Company bank charges',
				family: 'COMPANY_BANK_CHARGES',
				code: 'BANK_CHARGES',
				label: 'Company bank charges',
				external: true
			},
			bankCharges ?? 0
		);
		const external = total(
			[...amounts]
				.filter(([id]) => {
					const column = columns.get(id);
					return column?.external === true && !column.family.endsWith('_STATUTORY');
				})
				.map(([, amount]) => amount)
		);
		for (const [code, label, amount] of [
			['GROSS', 'Gross pay', money(employee.gross)],
			['DEDUCTIONS', 'Total deductions', money(employee.total_deductions)],
			['NET', 'Net pay', money(employee.net)],
			[
				'COMPANY_PAYMENT',
				'Total company payment',
				total([money(employee.net), government, external])
			]
		] as const)
			add({ group: label, family: 'TOTAL', code, label, external: false }, amount);
		return { employee, amounts, needsConfirmation, bankCharges };
	});
	const groupOrder = [...new Set([...(configuration.group_order ?? []), ...GROUPS])];
	const rank = (group: string) => {
		const index = groupOrder.indexOf(group);
		return index < 0 ? groupOrder.length : index;
	};
	const ordered = [...columns.values()].toSorted(
		(a, b) =>
			Number(a.family === 'TOTAL' && a.code === 'COMPANY_PAYMENT') -
				Number(b.family === 'TOTAL' && b.code === 'COMPANY_PAYMENT') ||
			rank(a.group) - rank(b.group) ||
			a.group.localeCompare(b.group) ||
			(a.family.endsWith('_STATUTORY')
				? schemeRank(input.schemes ?? [], a.code) - schemeRank(input.schemes ?? [], b.code)
				: 0) ||
			a.code.localeCompare(b.code) ||
			a.family.localeCompare(b.family)
	);
	return {
		company: input.company,
		period: input.period,
		currency: input.currency,
		run_kind: input.run_kind,
		pay_date: input.pay_date,
		run_reference: input.run_reference,
		minor_units: input.minor_units,
		warnings: [...warnings],
		columns: ordered,
		rows: rows
			.toSorted((a, b) => a.employee.employee_number.localeCompare(b.employee.employee_number))
			.map(({ employee, amounts, needsConfirmation, bankCharges }) => ({
				employee_number: employee.employee_number,
				name: employee.name,
				status: employee.status,
				amounts: ordered.map((column) =>
					(bankCharges === null && column.family === 'COMPANY_BANK_CHARGES') ||
					(needsConfirmation && column.family === 'TOTAL' && column.code === 'COMPANY_PAYMENT')
						? null
						: (amounts.get(key(column.family, column.code)) ?? 0)
				)
			}))
	};
}
