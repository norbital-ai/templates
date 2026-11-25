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
import { idsOf, objectValue, queryRows, type Reader } from '../../../../lib/reads.js';
import { type Law } from '../../jurisdiction/service/law.js';
import { type BackPayLine } from './rates.js';
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
/** The pay a period's own non-statutory lines give the person: what later-signed terms change. */
export const earningLines = (breakdown: unknown): readonly JsonObject[] =>
	linesOf(breakdown).filter(
		(line) =>
			line.party === 'EMPLOYEE' &&
			line.source !== 'statutory_contribution_catalog' &&
			line.source !== 'pay_amendment' &&
			line.period === undefined &&
			line.back_pay_period === undefined
	);

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

const deltaEntries = (due: readonly JsonObject[], paid: readonly JsonObject[]) => {
	const by = (lines: readonly JsonObject[]) => {
		const held = new Map<string, { line: JsonObject; amount: number }>();
		for (const line of lines) {
			const backPay = typeof line.back_pay_period === 'string' ? line.back_pay_period : '';
			const key = `${String(line.code)}/${String(line.party)}/${backPay}`;
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
		return model === undefined || amount === 0 ? [] : [{ model, amount }];
	});
};

/** The remainder of one period, line by line: what it should pay now, less what was paid for it. */
export const remainderLines = (
	due: readonly JsonObject[],
	paid: readonly JsonObject[],
	period: string
): Line[] =>
	deltaEntries(due, paid).map(({ model, amount }) => ({
		code: String(model.code),
		label: String(model.label ?? model.code),
		subtotal: String(model.subtotal),
		amount: Math.abs(amount),
		direction: amount < 0 ? 'DEDUCT' : 'ADD',
		party: String(model.party),
		source: String(model.source),
		period,
		...(typeof model.back_pay_period === 'string' ? { back_pay_period: model.back_pay_period } : {})
	}));

/** The back-pay delta of one earlier period under later-signed terms, line by line with its own catalogue and subtotal. */
export const backPayDeltaLines = (
	due: readonly JsonObject[],
	paid: readonly JsonObject[],
	earnedPeriod: string
): BackPayLine[] =>
	deltaEntries(due, paid).map(({ model, amount }) => ({
		code: String(model.code),
		label: String(model.label ?? model.code),
		subtotal: String(model.subtotal),
		amount: Math.abs(amount),
		direction: amount < 0 ? 'DEDUCT' : 'ADD',
		party: model.party === 'EMPLOYER' ? 'EMPLOYER' : 'EMPLOYEE',
		source: String(model.source),
		back_pay_period: earnedPeriod
	}));

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

/** A group of amended people sharing one entry-date span (`from..to`) and paid-run list. */
export interface EntryBucket {
	readonly people: readonly string[];
	readonly window: PayWindow;
	readonly runs: readonly string[];
}

/** A group of amended people sharing one balance-unwinding start (`from`, `since`). */
export interface BalanceBucket {
	readonly people: readonly string[];
	/** Earliest recalculated window start: non-payslip ledger entries after this are unwound. */
	readonly from: string;
	/** Pay date of the first recalculated period: payslips on or after this are unwound. */
	readonly since: string;
}

export const orderOf = (run: JsonObject) =>
	`${String(run.pay_date)}/${String(run.run_number ?? '').padStart(12, '0')}`;

const scopedOr = <W>(branches: readonly W[]): W | { readonly or: readonly W[] } =>
	branches.length === 1 && branches[0] !== undefined ? branches[0] : { or: [...branches] };

/**
 * Everything paid periods need to be worked out again, for these people, in one request; claims on a limited row read
 * what they posted in a second, since their ids come from the first.
 *
 * Company-wide tables (`work_event`, `shift_definition`, `shift_pattern`, `holiday`) and already-loaded person tables
 * (`dependant`, `employee_balance`) are reused from the run's own read (`own`), and dated tables are scoped per bucket
 * so one far-back amendment neither scans un-recalculated years nor widens the read for other amended people.
 */
export const loadSpan = Effect.fn('payroll.loadSpan')(function* (
	read: Reader,
	people: readonly string[],
	entryBuckets: readonly EntryBucket[],
	balanceBuckets: readonly BalanceBucket[],
	/** The run's own read: reused for company-wide and already-loaded rows, and for limited-claim rules. */
	own: RunData
) {
	const who = idsOf('employee_profile', people);
	const peopleSet = new Set(people);
	const theirs = { employment_id: { is: { employee_id: { in: who } } } };
	// an on-cycle run already loaded every paying person's dependants and balance; off-cycle leavers are read on demand
	const ownProfiles = new Set((own.employee_profile ?? []).map((row) => String(row.id)));
	const missing = people.filter((id) => !ownProfiles.has(id));
	const missingIds = idsOf('employee_profile', missing);
	const entryScope = entryBuckets.map((bucket) => ({
		who: idsOf('employee_profile', bucket.people),
		dated: { gte: bucket.window.from, lte: bucket.window.to },
		paidBy: idsOf('payroll_run', bucket.runs)
	}));
	const balanceScope = balanceBuckets.map((bucket) => ({
		who: idsOf('employee_profile', bucket.people),
		from: bucket.from,
		since: bucket.since
	}));
	const data = yield* queryRows(read, {
		employment: { where: { employee_id: { in: who } }, limit: 10000 },
		contract_terms: { where: theirs, limit: 10000 },
		statutory_parameters: { where: theirs, limit: 10000 },
		...(missingIds.length === 0
			? {}
			: {
					dependant: { where: { employee_id: { in: missingIds } }, limit: 10000 },
					employee_balance: { where: { employee_id: { in: missingIds } }, limit: 10000 }
				}),
		employee_profile: {
			where: { id: { in: who } },
			limit: 10000,
			employment: {
				fields: ['id', 'employee_id', 'effective_range', 'entity_id', 'service_started_on'],
				limit: 10000,
				entity_id: { fields: ['settings_code'] }
			}
		},
		leave_catalog_entry: {
			where: scopedOr(
				entryScope.map(({ who: bucketWho, dated, paidBy }) => ({
					employment_id: { is: { employee_id: { in: bucketWho } } },
					leave_catalog_entry_day: {
						some: { or: [{ incurred_on: dated }, { payroll_run_id: { in: paidBy } }] }
					}
				}))
			),
			limit: 10000,
			leave_catalog_entry_day: {
				fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
				limit: 10000
			}
		},
		// what is dated in each bucket's span, and what a run of the span priced whatever its date
		claim_catalog_entry: {
			where: scopedOr(
				entryScope.map(({ who: bucketWho, dated, paidBy }) => ({
					employment_id: { is: { employee_id: { in: bucketWho } } },
					or: [{ incurred_on: dated }, { payroll_run_id: { in: paidBy } }]
				}))
			),
			limit: 10000
		},
		adhoc_catalog_entry: {
			where: scopedOr(
				entryScope.map(({ who: bucketWho, dated, paidBy }) => ({
					employment_id: { is: { employee_id: { in: bucketWho } } },
					or: [{ incurred_on: dated }, { payroll_run_id: { in: paidBy } }]
				}))
			),
			limit: 10000
		},
		loan_catalog_entry: { where: theirs, limit: 10000 },
		loan_catalog_entry_repayment: {
			where: scopedOr(
				entryScope.map(({ who: bucketWho, dated }) => ({
					employment_id: { is: { employee_id: { in: bucketWho } } },
					paid_on: dated
				}))
			),
			limit: 10000
		},
		roster_entry: {
			where: scopedOr(
				entryScope.map(({ who: bucketWho, dated }) => ({
					employment_id: { is: { employee_id: { in: bucketWho } } },
					work_date: dated
				}))
			),
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
		// what was paid from each person's first recalculated period on, whichever company: with its run and its law, as
		// a payslip in the same totals took the balance past that period
		payslip: {
			where: scopedOr(
				balanceScope.map(({ who: bucketWho, since }) => ({
					employee_id: { in: bucketWho },
					payroll_run_id: { is: { pay_date: { gte: since } } }
				}))
			),
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
		// what records posted outside any payslip, after each person's earliest recalculated period opened
		ledger_entry: {
			where: scopedOr(
				balanceScope.map(({ who: bucketWho, from }) => ({
					balance_id: { is: { employee_id: { in: bucketWho } } },
					or: [
						{ account: { in: ['leave', 'claim'] }, effective_on: { gt: from } },
						{
							account: { in: ['pay', 'statutory'] },
							source: { like: 'adhoc_catalog_entry:%' },
							effective_on: { gt: from }
						}
					]
				}))
			),
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
	const ownDependants = (own.dependant ?? []).filter((row) =>
		peopleSet.has(String(row.employee_id))
	);
	const ownBalances = (own.employee_balance ?? []).filter((row) =>
		peopleSet.has(String(row.employee_id))
	);
	return yield* claimsAsPosted(read, {
		...withStints({
			...data,
			dependant: [...ownDependants, ...(data.dependant ?? [])]
		}),
		work_event: own.work_event ?? [],
		shift_definition: own.shift_definition ?? [],
		shift_pattern: own.shift_pattern ?? [],
		holiday: own.holiday ?? [],
		employee_balance: [...ownBalances, ...(data.employee_balance ?? [])],
		law_settings: own.law_settings ?? [],
		claim_catalog: own.claim_catalog ?? [],
		// the run read its company and every change of it: each period folds them on its own last day
		entity: own.entity ?? [],
		entity_change: own.entity_change ?? []
	});
});

/** Pre-indexed span rows by employee, built once before the per-period recalculation loop. */
export interface SpanIndex {
	readonly span: RunData;
	readonly payGroupById: ReadonlyMap<string, JsonObject>;
	readonly employmentByEmployee: ReadonlyMap<string, readonly JsonObject[]>;
	readonly profileByEmployee: ReadonlyMap<string, JsonObject>;
	readonly balanceByEmployee: ReadonlyMap<string, JsonObject>;
	readonly rosterByEmployee: ReadonlyMap<string, readonly JsonObject[]>;
	readonly claimByEmployee: ReadonlyMap<string, readonly JsonObject[]>;
	readonly adhocByEmployee: ReadonlyMap<string, readonly JsonObject[]>;
	readonly repaymentByEmployee: ReadonlyMap<string, readonly JsonObject[]>;
	readonly leaveByEmployee: ReadonlyMap<string, readonly JsonObject[]>;
}

const groupByStintOwner = (
	rows: readonly JsonObject[] | undefined,
	ownerOf: ReadonlyMap<string, string>
): ReadonlyMap<string, readonly JsonObject[]> => {
	const grouped = new Map<string, JsonObject[]>();
	for (const row of rows ?? []) {
		const employee = ownerOf.get(String(row.employment_id));
		if (employee === undefined) continue;
		const bucket = grouped.get(employee);
		if (bucket === undefined) grouped.set(employee, [row]);
		else bucket.push(row);
	}
	return grouped;
};

/** Pre-index a span's per-employee tables once so each recalculated period slices in O(period rows). */
export const indexSpan = (span: RunData): SpanIndex => {
	const ownerOf = new Map<string, string>();
	const employmentByEmployee = new Map<string, JsonObject[]>();
	for (const row of span.employment ?? []) {
		const employee = String(row.employee_id);
		ownerOf.set(String(row.id), employee);
		const bucket = employmentByEmployee.get(employee);
		if (bucket === undefined) employmentByEmployee.set(employee, [row]);
		else bucket.push(row);
	}
	return {
		span,
		payGroupById: new Map((span.pay_group ?? []).map((row) => [String(row.id), row])),
		employmentByEmployee,
		profileByEmployee: new Map((span.employee_profile ?? []).map((row) => [String(row.id), row])),
		balanceByEmployee: new Map(
			(span.employee_balance ?? []).map((row) => [String(row.employee_id), row])
		),
		rosterByEmployee: groupByStintOwner(span.roster_entry, ownerOf),
		claimByEmployee: groupByStintOwner(span.claim_catalog_entry, ownerOf),
		adhocByEmployee: groupByStintOwner(span.adhoc_catalog_entry, ownerOf),
		repaymentByEmployee: groupByStintOwner(span.loan_catalog_entry_repayment, ownerOf),
		leaveByEmployee: groupByStintOwner(span.leave_catalog_entry, ownerOf)
	};
};

/** One paid period's own rows out of the span: its window, the law of its pay date, and the seals that belong to it. */
export const sliceOf = (
	indexed: SpanIndex,
	law: Law | undefined,
	period: Period,
	who: readonly string[],
	carriers: (employee: string) => ReadonlySet<string> | undefined,
	/** Whether this period's run carried, for this person, the earlier period holding this date. */
	carriedBack: (employee: string, date: string) => boolean,
	accounts: ReadonlyMap<string, Accounts>
): RunData => {
	const { from } = period.frame.attendance;
	const inside = (date: unknown) =>
		typeof date === 'string' && date >= from && date <= period.closes;
	// a row belongs to this period when nothing sealed it, its own run did, or a run that carried for it did
	const belongs = (row: JsonObject, carrierSet: ReadonlySet<string> | undefined) =>
		row.payroll_run_id == null ||
		String(row.payroll_run_id) === period.id ||
		(carrierSet?.has(String(row.payroll_run_id)) ?? false);
	// an entry this period's own run priced though it is dated before its window was paid here as a late entry: it is
	// this period's, unless the run priced it for the earlier period it carried
	const lateHere = (row: JsonObject, employee: string, date: unknown) =>
		String(row.payroll_run_id) === period.id &&
		typeof date === 'string' &&
		date < from &&
		!carriedBack(employee, date);
	const opened = (row: JsonObject): JsonObject => ({
		...row,
		payroll_run_id: null,
		sealed: row.payroll_run_id != null
	});
	const contracts: JsonObject[] = [];
	const profiles: JsonObject[] = [];
	const balances: JsonObject[] = [];
	const rosters: JsonObject[] = [];
	const claims: JsonObject[] = [];
	const adhocs: JsonObject[] = [];
	const repayments: JsonObject[] = [];
	const leaves: JsonObject[] = [];
	const pick = (
		rows: readonly JsonObject[] | undefined,
		dateField: string,
		employee: string,
		carrierSet: ReadonlySet<string> | undefined,
		out: JsonObject[]
	) => {
		if (rows === undefined) return;
		for (const row of rows) {
			const date = row[dateField];
			if ((inside(date) && belongs(row, carrierSet)) || lateHere(row, employee, date))
				out.push(opened(row));
		}
	};
	for (const employee of who) {
		const carrierSet = carriers(employee);
		const stints = indexed.employmentByEmployee.get(employee);
		if (stints !== undefined) contracts.push(...stints);
		const profile = indexed.profileByEmployee.get(employee);
		if (profile !== undefined) profiles.push(profile);
		const balance = indexed.balanceByEmployee.get(employee);
		const held = accounts.get(employee);
		if (balance !== undefined && held !== undefined) balances.push({ ...balance, account: held });
		pick(indexed.rosterByEmployee.get(employee), 'work_date', employee, carrierSet, rosters);
		pick(indexed.claimByEmployee.get(employee), 'incurred_on', employee, carrierSet, claims);
		pick(indexed.adhocByEmployee.get(employee), 'incurred_on', employee, carrierSet, adhocs);
		pick(indexed.repaymentByEmployee.get(employee), 'paid_on', employee, carrierSet, repayments);
		for (const row of indexed.leaveByEmployee.get(employee) ?? []) {
			const days = (Array.isArray(row.leave_catalog_entry_day) ? row.leave_catalog_entry_day : [])
				.filter(isJsonObject)
				.map((child) =>
					// a cash-out's dates are placeholders: one no run has taken is the next run's own, and one this period's
					// run took is this period's
					belongs(child, carrierSet) &&
					(row.encashment === true ? child.payroll_run_id != null : inside(child.incurred_on))
						? opened(child)
						: // a slot another period priced stays sealed: this one neither prices nor reads it
							{ ...child, payroll_run_id: child.payroll_run_id ?? 'other' }
				);
			if (days.some((child) => child.payroll_run_id === null))
				leaves.push({ ...opened(row), leave_catalog_entry_day: days });
		}
	}
	const group = indexed.payGroupById.get(String(period.run.pay_group_id));
	return {
		...indexed.span,
		...lawData(law),
		pay_group: group === undefined ? [] : [group],
		employment: contracts,
		employee_profile: profiles,
		employee_balance: balances,
		roster_entry: rosters,
		claim_catalog_entry: claims,
		adhoc_catalog_entry: adhocs,
		loan_catalog_entry_repayment: repayments,
		leave_catalog_entry: leaves,
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
