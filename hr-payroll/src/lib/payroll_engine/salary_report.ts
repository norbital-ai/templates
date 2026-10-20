import { Decimal } from '@norbital-ai/std/decimal';
import { Schema } from 'effect';
import { numberOf } from './foundation.js';

export type SalaryColumn = {
	readonly group: string;
	readonly family: string;
	readonly code: string;
	readonly label: string;
	readonly external: boolean;
};
export type SalaryReport = {
	readonly company: string;
	readonly period: string;
	readonly currency: string;
	readonly run_kind: string;
	readonly pay_date: string;
	readonly run_reference: string;
	readonly minor_units: number;
	readonly warnings: readonly string[];
	readonly columns: readonly SalaryColumn[];
	readonly rows: readonly {
		readonly employee_number: string;
		readonly name: string;
		readonly status: string;
		readonly amounts: readonly (number | null)[];
	}[];
};
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
	readonly base: unknown;
	readonly adjustments: unknown;
	readonly company_payments?: unknown;
	readonly statutory: unknown;
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

const PayLine = Schema.Struct({
	component_code: Schema.String,
	label: Schema.optional(Schema.String),
	amount: Schema.Number,
	family: Schema.optional(Schema.String),
	destination: Schema.optional(Schema.String)
});
const StatutoryLine = Schema.Struct({
	scheme_code: Schema.String,
	employee_amount: Schema.Number,
	employer_amount: Schema.Number
});
const CompanyPayment = Schema.Struct({
	family: Schema.String,
	source_id: Schema.String,
	component_code: Schema.String,
	amount: Schema.Number,
	label: Schema.optional(Schema.String)
});
const payLines = (value: unknown) => Schema.decodeUnknownSync(Schema.Array(PayLine))(value ?? []);
const charges = (value: unknown) =>
	Schema.decodeUnknownSync(Schema.Array(StatutoryLine))(value ?? []);
const money = (value: unknown): number => Schema.decodeUnknownSync(Schema.Number)(numberOf(value));
const bankCharge = (value: unknown): number | null =>
	Schema.decodeUnknownSync(Schema.NullOr(Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))))(
		numberOf(value)
	);
const total = (values: readonly number[]): number =>
	values.reduce((sum, value) => sum.plus(Decimal.of(String(value))), Decimal.of(0)).toNumber();
const key = (family: string, code: string) => `${family}:${code}`;

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
		const companyPayments = Schema.decodeUnknownSync(Schema.Array(CompanyPayment))(
			employee.company_payments ?? []
		);
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
		const line = (row: typeof PayLine.Type, family: string) => {
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
					label: row.label ?? row.component_code,
					external: companyPaid || (!employer && classification?.payment === 'EXTERNAL')
				},
				deduction ? -row.amount : row.amount
			);
		};
		for (const row of payLines(employee.base))
			line(row, catalog.has(key('ALLOWANCE', row.component_code)) ? 'ALLOWANCE' : 'WORK');
		for (const row of payLines(employee.adjustments)) line(row, row.family ?? 'ADHOC');
		for (const row of companyPayments) line({ ...row, destination: 'EMPLOYER' }, row.family);
		let government = 0;
		for (const row of charges(employee.statutory)) {
			for (const [family, group, amount] of [
				['EMPLOYEE_STATUTORY', 'Employee statutory', row.employee_amount],
				['EMPLOYER_STATUTORY', 'Employer statutory', row.employer_amount]
			] as const) {
				if (amount === 0) continue;
				government = total([government, amount]);
				add(
					{ group, family, code: row.scheme_code, label: row.scheme_code, external: true },
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
