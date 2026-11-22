import { BigDecimal, Effect } from 'effect';
import {
	totalsScope,
	type Accounts,
	type Movement,
	type Wanted
} from '../../employee_profile/employee_balance/service/core.js';
import { payslipWanted } from '../../employee_profile/employee_balance/service/service.js';
import { isJsonObject, type JsonObject } from '../../../../lib/foundation.js';
import { type PayWindow } from './pay_cycle.js';
import { type PayslipBreakdown } from './payslip_breakdown.js';
import { idOf, idsOf, objectValue, queryRows, type Reader } from '../../../../lib/reads.js';
import { type Law } from '../../jurisdiction/service/law.js';
import {
	claimsAsPosted,
	lawData,
	withStints,
	type CalculatedPayslip,
	type RunData,
	type RunFrame
} from './run_calculation.js';

/**
 * Paid periods worked out again. A record of a paid period is corrected where it was recorded, and its save leaves one
 * amendment row: this person, this pay group, this period. The next run that pays the person reads their open rows and,
 * from the earliest amended period through the last paid one of that tax year, works each period out on the records as
 * they stand now. What a period should pay now, less what has been paid for it, goes on the run's payslip as lines
 * tagged with that period and is posted to that period. Nothing is stored but those lines and their postings.
 */

/** The person-periods one run works out again, beyond the people it pays. The rest wait for the next run. */
export const RECALCULATED_A_RUN = 240;

export const RECOVERY = 'RECOVERY_CARRIED';

// what cannot be taken back this period is left for the next: net pay never goes below zero
export const recoveryOf = (slip: CalculatedPayslip, amount: number): Line => ({
	code: RECOVERY,
	label: 'Recovery carried forward',
	subtotal: slip.breakdown.checkpoints.at(-1)?.code ?? '',
	amount,
	direction: 'ADD',
	party: 'EMPLOYEE',
	source: 'pay_amendment'
});

export type Line = PayslipBreakdown['lines'][number];

export const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
export const rangeOf = (row: JsonObject) => {
	const range = objectValue(row.effective_range);
	return { from: textOf(range.from), to: typeof range.to === 'string' ? range.to : null };
};
/** A payslip's lines; a period that paid the person nothing has none. */
export const linesOf = (breakdown: unknown): readonly JsonObject[] => {
	if (breakdown === undefined) return [];
	const lines = objectValue(breakdown).lines;
	return Array.isArray(lines) ? lines.filter(isJsonObject) : [];
};
/** A terms row: the day it was signed, and the day it applies from. */
export const signedOn = (row: JsonObject) => textOf(row.signed_on);
export const fromOf = (row: JsonObject) => textOf(row.effective_from);
const signedOf = (line: JsonObject) =>
	(line.direction === 'DEDUCT' ? -1 : 1) * Number(line.amount ?? 0);
/** The pay a period's lines give the person before any scheme: what later-signed terms change. */
export const earned = (breakdown: unknown): number =>
	linesOf(breakdown)
		.filter(
			(line) =>
				line.party === 'EMPLOYEE' &&
				line.source !== 'statutory_contribution_catalog' &&
				line.period === undefined
		)
		.reduce((total, line) => total + signedOf(line), 0);

export const keyOf = (row: Wanted) => [row.account, row.code, row.period, row.measure].join('/');
export const net = (rows: readonly Wanted[]): Map<string, Wanted> => {
	const held = new Map<string, Wanted>();
	for (const row of rows) {
		const before = held.get(keyOf(row));
		held.set(keyOf(row), { ...row, amount: (before?.amount ?? 0) + row.amount });
	}
	return held;
};
/** What takes `paid` to `due`, key by key. */
export const postingsBetween = (
	due: readonly Wanted[],
	paid: readonly Wanted[]
): readonly Wanted[] => {
	const wanted = net(due);
	const had = net(paid);
	return unique([...wanted.keys(), ...had.keys()]).flatMap((key) => {
		const row = wanted.get(key) ?? had.get(key);
		const amount = BigDecimal.toNumberUnsafe(
			BigDecimal.round(
				BigDecimal.fromNumberUnsafe((wanted.get(key)?.amount ?? 0) - (had.get(key)?.amount ?? 0)),
				{ scale: 8 }
			)
		);
		return row === undefined || amount === 0 ? [] : [{ ...row, amount }];
	});
};
export const isMoney = (row: Wanted) => row.account === 'pay' || row.account === 'statutory';
export const movements = (rows: readonly Wanted[], sign: 1 | -1): readonly Movement[] =>
	rows.map((row) => ({
		account: row.account,
		code: row.code,
		period: row.period,
		measure: row.measure,
		operation: sign * row.amount < 0 ? ('DEDUCT' as const) : ('ADD' as const),
		amount: Math.abs(row.amount),
		...(row.unit === undefined ? {} : { unit: row.unit }),
		effective_on: row.effective_on,
		source: ''
	}));

/** The remainder of one period, line by line: what it should pay now, less what was paid for it. */
export const remainderLines = (
	due: readonly JsonObject[],
	paid: readonly JsonObject[],
	period: string
): Line[] => {
	const by = (lines: readonly JsonObject[]) => {
		const held = new Map<string, { line: JsonObject; amount: number }>();
		for (const line of lines) {
			const key = `${String(line.code)}/${String(line.party)}`;
			const before = held.get(key);
			held.set(key, { line: before?.line ?? line, amount: (before?.amount ?? 0) + signedOf(line) });
		}
		return held;
	};
	const should = by(due);
	const was = by(paid);
	return unique([...should.keys(), ...was.keys()]).flatMap((key) => {
		const model = should.get(key)?.line ?? was.get(key)?.line;
		const amount = BigDecimal.toNumberUnsafe(
			BigDecimal.round(
				BigDecimal.fromNumberUnsafe((should.get(key)?.amount ?? 0) - (was.get(key)?.amount ?? 0)),
				{ scale: 6 }
			)
		);
		if (model === undefined || amount === 0) return [];
		return [
			{
				code: String(model.code),
				label: String(model.label ?? model.code),
				subtotal: String(model.subtotal),
				amount: Math.abs(amount),
				direction: amount < 0 ? 'DEDUCT' : 'ADD',
				party: String(model.party),
				source: String(model.source),
				period
			}
		];
	});
};

export interface Period {
	readonly run: JsonObject;
	readonly id: string;
	readonly key: string;
	readonly payDate: string;
	readonly order: string;
	readonly frame: RunFrame;
	readonly closes: string;
	readonly year: string;
}

export const orderOf = (run: JsonObject) =>
	`${String(run.pay_date)}/${String(run.run_number ?? '').padStart(12, '0')}`;

/**
 * Everything paid periods need to be worked out again, for these people, in one request; claims on a limited row read
 * what they posted in a second, since their ids come from the first.
 */
export const loadSpan = Effect.fn('payroll.loadSpan')(function* (
	read: Reader,
	entity: string,
	people: readonly string[],
	window: PayWindow,
	/** The pay date of the first paid period the span reaches: the balance holds what was paid before it. */
	since: string,
	runs: readonly string[],
	/** The run's own read: a claim with no posting yet is limited as its law limits it. */
	own: RunData
) {
	const company = { entity_id: { eq: idOf('entity', entity) } };
	const who = idsOf('employee_profile', people);
	const paidBy = idsOf('payroll_run', runs);
	const theirs = { employment_id: { is: { employee_id: { in: who } } } };
	const dated = { gte: window.from, lte: window.to };
	const data = yield* queryRows(read, {
		work_event: { where: company, limit: 10000 },
		shift_definition: { where: company, limit: 10000 },
		shift_pattern: { where: company, limit: 10000 },
		holiday: { where: company, limit: 10000 },
		employment: { where: { employee_id: { in: who } }, limit: 10000 },
		contract_terms: { where: theirs, limit: 10000 },
		statutory_parameters: { where: theirs, limit: 10000 },
		dependant: { where: { employee_id: { in: who } }, limit: 10000 },
		employee_profile: {
			where: { id: { in: who } },
			limit: 10000,
			employment: {
				fields: ['id', 'employee_id', 'effective_range', 'entity_id', 'service_started_on'],
				limit: 10000,
				entity_id: { fields: ['settings_code'] }
			}
		},
		employee_balance: { where: { employee_id: { in: who } }, limit: 10000 },
		leave_catalog_entry: {
			where: {
				...theirs,
				leave_catalog_entry_day: {
					some: { or: [{ incurred_on: dated }, { payroll_run_id: { in: paidBy } }] }
				}
			},
			limit: 10000,
			leave_catalog_entry_day: {
				fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
				limit: 10000
			}
		},
		// what is dated in the span, and what a run of the span priced whatever its date
		claim_catalog_entry: {
			where: { ...theirs, or: [{ incurred_on: dated }, { payroll_run_id: { in: paidBy } }] },
			limit: 10000
		},
		adhoc_catalog_entry: {
			where: { ...theirs, or: [{ incurred_on: dated }, { payroll_run_id: { in: paidBy } }] },
			limit: 10000
		},
		loan_catalog_entry: { where: theirs, limit: 10000 },
		loan_catalog_entry_repayment: { where: { ...theirs, paid_on: dated }, limit: 10000 },
		roster_entry: {
			where: { ...theirs, work_date: dated },
			fields: [
				'id',
				'employment_id',
				'payroll_run_id',
				'work_date',
				'shift_definition_id',
				'actual_worked_intervals',
				'planned_overtime_intervals',
				'overtime_as_time_off'
			],
			limit: 10000
		},
		// what was paid from the first period worked out again, and since, whichever company: with its run and its law, as
		// a payslip in the same totals took the balance past that period
		payslip: {
			where: {
				employee_id: { in: who },
				payroll_run_id: { is: { pay_date: { gte: since } } }
			},
			fields: ['id', 'employee_id', 'employment_id', 'payroll_run_id', 'entity_id', 'breakdown'],
			limit: 10000,
			payroll_run_id: { fields: ['pay_date', 'run_number'] },
			entity_id: { fields: ['settings_code'] }
		},
		// the runs that already carried for a period: what they sealed belongs to it
		pay_amendment: {
			where: { employee_id: { in: who }, payroll_run_id: { is_null: false } },
			fields: ['employee_id', 'pay_group_id', 'period', 'payroll_run_id'],
			limit: 10000
		},
		// what records posted outside any payslip, after the earliest recalculated period closed
		ledger_entry: {
			where: {
				balance_id: { is: { employee_id: { in: who } } },
				or: [
					{ account: { in: ['leave', 'claim'] }, effective_on: { gt: window.from } },
					{
						account: { in: ['pay', 'statutory'] },
						source: { like: 'adhoc_catalog_entry:%' },
						effective_on: { gt: window.from }
					}
				]
			},
			fields: [
				'balance_id',
				'source',
				'operation',
				'account',
				'code',
				'period',
				'measure',
				'amount',
				'unit',
				'effective_on'
			],
			limit: 10000
		}
	});
	return yield* claimsAsPosted(read, {
		...withStints(data),
		law_settings: own.law_settings ?? [],
		claim_catalog: own.claim_catalog ?? [],
		// the run read its company and every change of it: each period folds them on its own last day
		entity: own.entity ?? [],
		entity_change: own.entity_change ?? []
	});
});

/** One paid period's own rows out of the span: its window, the law of its pay date, and the seals that belong to it. */
export const sliceOf = (
	span: RunData,
	law: Law | undefined,
	period: Period,
	people: ReadonlySet<string>,
	carriers: (employee: string) => ReadonlySet<string>,
	/** Whether this period's run carried, for this person, the earlier period holding this date. */
	carriedBack: (employee: string, date: string) => boolean,
	accounts: ReadonlyMap<string, Accounts>
): RunData => {
	const contracts = (span.employment ?? []).filter((row) => people.has(String(row.employee_id)));
	const employeeOf = new Map(contracts.map((row) => [String(row.id), String(row.employee_id)]));
	const { from } = period.frame.attendance;
	const inside = (date: unknown) =>
		typeof date === 'string' && date >= from && date <= period.closes;
	// a row belongs to this period when nothing sealed it, its own run did, or a run that carried for it did
	const belongs = (row: JsonObject, employee: string | undefined) =>
		employee !== undefined &&
		(row.payroll_run_id == null ||
			String(row.payroll_run_id) === period.id ||
			carriers(employee).has(String(row.payroll_run_id)));
	// an entry this period's own run priced though it is dated before its window was paid here as a late entry: it is
	// this period's, unless the run priced it for the earlier period it carried
	const lateHere = (row: JsonObject, employee: string | undefined, date: unknown) =>
		employee !== undefined &&
		String(row.payroll_run_id) === period.id &&
		typeof date === 'string' &&
		date < from &&
		!carriedBack(employee, date);
	const opened = (row: JsonObject): JsonObject => ({
		...row,
		payroll_run_id: null,
		sealed: row.payroll_run_id != null
	});
	const own = (model: string, date: string) =>
		(span[model] ?? []).flatMap((row) => {
			const employee = employeeOf.get(String(row.employment_id));
			return (inside(row[date]) && belongs(row, employee)) || lateHere(row, employee, row[date])
				? [opened(row)]
				: [];
		});
	return {
		...span,
		...lawData(law),
		pay_group: (span.pay_group ?? []).filter(
			(row) => String(row.id) === String(period.run.pay_group_id)
		),
		employment: contracts,
		employee_profile: (span.employee_profile ?? []).filter((row) => people.has(String(row.id))),
		employee_balance: (span.employee_balance ?? []).flatMap((row) => {
			const held = accounts.get(String(row.employee_id));
			return held === undefined ? [] : [{ ...row, account: held }];
		}),
		roster_entry: own('roster_entry', 'work_date'),
		claim_catalog_entry: own('claim_catalog_entry', 'incurred_on'),
		adhoc_catalog_entry: own('adhoc_catalog_entry', 'incurred_on'),
		loan_catalog_entry_repayment: own('loan_catalog_entry_repayment', 'paid_on'),
		leave_catalog_entry: (span.leave_catalog_entry ?? []).flatMap((row) => {
			const employee = employeeOf.get(String(row.employment_id));
			const days = (Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
				.filter(isJsonObject)
				.map((child) =>
					// a cash-out's dates are placeholders: one no run has taken is the next run's own, and one this period's
					// run took is this period's
					belongs(child, employee) &&
					(row.encashment === true ? child.payroll_run_id != null : inside(child.incurred_on))
						? opened(child)
						: // a slot another period priced stays sealed: this one neither prices nor reads it
							{ ...child, payroll_run_id: child.payroll_run_id ?? 'other' }
				);
			return days.some((child) => child.payroll_run_id === null)
				? [{ ...opened(row), leave_catalog_entry_day: days }]
				: [];
		}),
		workplace_case_catalog_entry: []
	};
};

/** What a paid payslip's own lines posted, as its run posted them. */
export const ownPostings = (
	law: Law | undefined,
	run: JsonObject,
	breakdown: unknown
): readonly Wanted[] => {
	if (law === undefined) return [];
	const monthly = (
		family: 'subtotal' | 'statutory_contribution_catalog',
		suffixes: readonly string[]
	) =>
		law.rows[family]
			.filter((row) => row.balance_window === 'MONTH')
			.flatMap((row) => suffixes.map((suffix) => `${String(row.code)}${suffix}`));
	return payslipWanted(objectValue(breakdown), String(run.pay_date), {
		scope: totalsScope(law.settings, run.entity_id),
		started: String(run.pay_date),
		events: [],
		taxYearStart: Number(law.settings.tax_year_start_month ?? 1),
		byMonth: [
			...monthly('subtotal', ['']),
			...monthly('statutory_contribution_catalog', ['.employee', '.employer'])
		]
	});
};
