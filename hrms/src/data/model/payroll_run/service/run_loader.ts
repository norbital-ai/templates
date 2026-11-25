import { Effect } from 'effect';
import type { JsonObject } from '../../../../lib/contracts.js';
import type { PayWindow } from './pay_cycle.js';
import { idOf, idsOf, objectValue, queryRows, type Reader } from '../../../../lib/reads.js';
import { isJsonObject } from '../../../../lib/foundation.js';
import type { PayslipBreakdown } from './payslip_breakdown.js';
import type { BackPayLine } from './rates.js';
import { accountsOf } from '../../employee_profile/employee_balance/service/core.js';
import { claimLeft, claimWanted } from '../../employee_profile/employee_balance/service/service.js';
import { lawsWith, type Law } from '../../jurisdiction/service/law.js';
import {
	chainOf,
	employmentOn,
	isExit,
	partsIn,
	segmentsOf,
	startsOf
} from '../../employee_profile/service/person.js';

/** One payslip row the run's create transform attaches as a child. */

export interface CalculatedPayslip {
	readonly employee_id: string;
	readonly employment_id: string;
	readonly entity_id: string;
	readonly basic_earnings: number;
	readonly gross_earnings: number;
	readonly net_pay: number;
	readonly total_deductions: number;
	readonly employer_cost: number;
	readonly period: string;
	readonly ordinary_wages: number;
	readonly employee_statutory: number;
	readonly tax_withheld: number;
	readonly breakdown: PayslipBreakdown;
}

export const covers = (range: unknown, from: string, to: string): boolean => {
	if (!isJsonObject(range)) return false;
	const start = range.from,
		end = range.to;
	return (
		typeof start === 'string' &&
		start <= to &&
		(end === null || end === undefined || (typeof end === 'string' && end >= from))
	);
};

/** A run's frame: the attendance it prices and an off-cycle run's entries. */
export interface RunFrame {
	readonly attendance: PayWindow;
	/** An off-cycle run: the entries it pays. Only their people get a payslip. */
	readonly pays?: ReadonlySet<string>;
	/** An off-cycle run: the open amendment rows HR named for it. It carries their people's earlier periods. */
	readonly carries?: ReadonlySet<string>;
	/** A paid period worked out again: only these people are priced. */
	readonly people?: ReadonlySet<string>;
	/** Dated rows this run leaves to a paid period it works out again. */
	readonly leftOut?: ReadonlySet<string>;
	/** Back-pay lines this period owes each person from later-signed terms, with each item's own catalogue and subtotal. */
	readonly backPay?: ReadonlyMap<string, readonly BackPayLine[]>;
	/** Pay the run carries for earlier periods, by person and checkpoint code: wages of this month for a scheme assessed when paid. */
	readonly carried?: ReadonlyMap<string, Readonly<Record<string, number>>>;
	/** Agreed terms are read as they were signed by this day. The run's pay date when left out. */
	readonly termsAsOf?: string;
	/** Earliest attendance start of prior on-cycle runs of this pay group: bounds pickup of deferred unpaid leave slots. */
	readonly deferredSince?: string;
}

export const refOf = (value: unknown) => String(isJsonObject(value) ? value.id : value);

/**
 * A claim on a limited row pays what it posted: the ledger, not the entry, knows what was left when it came in. One with
 * no movement found nothing left or is on its way, so it pays what posting it would.
 */
export const claimsAsPosted = Effect.fn('payroll.claimsAsPosted')(function* (
	read: Reader,
	data: Readonly<Record<string, readonly JsonObject[]>>
) {
	const limited = new Map(
		(data.claim_catalog ?? [])
			.filter((row) => objectValue(row.lookup).annual_limit != null)
			.map((row) => [String(row.code), { code: String(row.code), lookup: objectValue(row.lookup) }])
	);
	const codeOf = (row: JsonObject) => String(row.catalog_code);
	const claims = (data.claim_catalog_entry ?? []).filter((row) => limited.has(codeOf(row)));
	if (claims.length === 0) return data;
	const { ledger_entry: rows = [] } = yield* queryRows(read, {
		ledger_entry: {
			where: { source: { in: claims.map((row) => `claim_catalog_entry:${String(row.id)}`) } },
			fields: ['source', 'operation', 'amount'],
			limit: 10000
		}
	});
	const posted = new Map<string, number>();
	for (const row of rows)
		posted.set(
			String(row.source),
			(posted.get(String(row.source)) ?? 0) +
				(row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0)
		);
	const contract = new Map((data.employment ?? []).map((row) => [String(row.id), row]));
	const balance = new Map(
		(data.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);
	const scope = String(data.law_settings?.[0]?.code);
	const drawn = new Map<string, number>();
	return {
		...data,
		claim_catalog_entry: (data.claim_catalog_entry ?? []).map((row) => {
			const amount = posted.get(`claim_catalog_entry:${String(row.id)}`);
			if (amount !== undefined) return { ...row, quantity: Math.abs(amount) };
			const catalog = limited.get(codeOf(row));
			const employment = contract.get(refOf(row.employment_id));
			if (catalog === undefined || employment === undefined) return row;
			const employee = String(employment.employee_id);
			const accounts = accountsOf(balance.get(employee)?.account);
			const keyOf = (period: string) => `${employee}/${catalog.code}/${period}`;
			const [wanted] = claimWanted(
				row,
				catalog,
				{ scope, started: String(employment.service_started_on), events: [] },
				(period) => claimLeft(accounts, catalog, period) - (drawn.get(keyOf(period)) ?? 0)
			);
			if (wanted === undefined) return row;
			drawn.set(keyOf(wanted.period), (drawn.get(keyOf(wanted.period)) ?? 0) + wanted.amount);
			return { ...row, quantity: wanted.amount };
		})
	};
});

/**
 * Everything a run needs, before any payslip: the window's rows and nothing outside it, in one request. Its law rides in
 * that request unless the invocation has read it already (`lawsWith`), and the rest of the invocation reuses it. A run
 * with claims on a limited row reads what those posted in a second, since their ids come from the first. Neither the
 * calculation nor the attachments read again.
 */
export const loadRun = Effect.fn('payroll.loadRun')(function* (
	read: Reader,
	run: JsonObject,
	{ attendance, pays, deferredSince }: RunFrame,
	jurisdiction: string
) {
	const coverage = objectValue(run.salary_coverage);
	const company = idOf('entity', run.entity_id);
	const [opens = attendance.from] = [attendance.from, String(coverage.from)].sort();
	const closes = [attendance.to, String(coverage.to)].sort().at(-1) ?? attendance.to;
	const own = { entity_id: { eq: company } };
	// to the salary period's end: a leaver's last run pays what falls after its attendance, up to their last day
	const window = { gte: attendance.from, lte: closes };
	const leaveFrom =
		pays === undefined && deferredSince !== undefined && deferredSince < attendance.from
			? deferredSince
			: attendance.from;
	const leaveWindow = { gte: leaveFrom, lte: closes };
	const unsealed = { payroll_run_id: { is_null: true } };
	// An on-cycle run takes what is due; an off-cycle run takes the entries HR named (`pays`). One filter says both: the
	// named ids, or the unpaid rows up to a day, and whichever does not apply matches nothing.
	const named = [...(pays ?? [])];
	const dueTo = pays === undefined ? closes : '0001-01-01';
	const dueFrom = pays === undefined ? attendance.from : '9999-12-31';
	// a claim or adhoc entry no run has paid is due whatever its date: one entered for a period that paid the person
	// nothing. One dated in a period they were paid for is that period's own, worked out again (`leftOut`)
	const unpaid = <C extends 'claim_catalog_entry' | 'adhoc_catalog_entry'>(model: C) => ({
		...own,
		or: [{ id: { in: idsOf(model, named) } }, { ...unsealed, incurred_on: { lte: dueTo } }]
	});
	// an instalment is read in its own window
	const repaid = {
		...own,
		or: [
			{ id: { in: idsOf('loan_catalog_entry_repayment', named) } },
			{ ...unsealed, paid_on: { gte: dueFrom, lte: closes } }
		]
	};
	// a cash-out with a slot not yet paid, whatever its date
	const pendingLeave = {
		leave_catalog_entry_day: { some: unsealed },
		encashment: { eq: true }
	};
	// a run pays one pay group: the stints whose terms name it, and their roster
	const paid = {
		...own,
		terms: { some: { pay_group_id: { eq: idOf('pay_group', run.pay_group_id) } } }
	};
	// the stints in the window, and any an unpaid entry was raised on before it
	const stint = {
		...paid,
		or: [
			{ effective_range: { overlaps: { from: opens, to: closes } } },
			{ claim_catalog_entry: { some: unpaid('claim_catalog_entry') } },
			{ adhoc_catalog_entry: { some: unpaid('adhoc_catalog_entry') } },
			// a leave entry keeps the stint it was raised on; its open slots still belong to this run
			{
				leave_catalog_entry: {
					some: { leave_catalog_entry_day: { some: { ...unsealed, incurred_on: leaveWindow } } }
				}
			},
			{ leave_catalog_entry: { some: pendingLeave } },
			{ loan_catalog_entry_repayment: { some: repaid } },
			{ roster_entry: { some: { work_date: window } } }
		]
	};
	const { got: data, laws } = yield* lawsWith(read, [jurisdiction], (law) =>
		queryRows(read, {
			...law,
			// ponytail: the company's whole history of these; bound them to the run's window if a company outgrows the limit
			work_event: { where: own, limit: 10000 },
			shift_definition: { where: own, limit: 10000 },
			shift_pattern: { where: own, limit: 10000 },
			holiday: { where: own, limit: 10000 },
			pay_group: {
				where: { id: { eq: idOf('pay_group', run.pay_group_id) } },
				fields: ['payment_schedule'],
				limit: 1
			},
			// the company: its plain fields, and every dated change, folded on the day each period is priced for
			entity: { where: { id: { eq: company } }, limit: 1 },
			entity_change: { where: own, limit: 10000 },
			// each stint with every dated row of it, its person and their dependants: how it stands on any day, a signed date
			// included. All through the run's named read, by the one stint filter.
			employment: { output: 'run', where: stint, limit: 10000 },
			contract_terms: { output: 'run', where: { employment_id: { is: stint } }, limit: 10000 },
			statutory_parameters: {
				output: 'run',
				where: { employment_id: { is: stint } },
				limit: 10000
			},
			dependant: {
				output: 'run',
				where: { employee_id: { is: { employment: { some: stint } } } },
				limit: 10000
			},
			employee_profile: {
				output: 'run',
				where: { employment: { some: stint } },
				limit: 10000,
				employment: {
					fields: ['id', 'employee_id', 'effective_range', 'entity_id', 'service_started_on'],
					limit: 10000,
					entity_id: { fields: ['settings_code'] }
				}
			},
			employee_balance: {
				output: 'run',
				where: { employee_id: { is: { employment: { some: stint } } } },
				limit: 10000
			},
			roster_entry: {
				output: 'run',
				where: { employment_id: { is: paid }, work_date: window },
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
			loan_catalog_entry: {
				output: 'run',
				where: { ...own, repayments: { some: repaid } },
				limit: 10000
			},
			// a leave with a slot in this window, an unsealed deferred slot from a prior run, or one still pending
			leave_catalog_entry: {
				where: {
					...own,
					or: [
						{ leave_catalog_entry_day: { some: { incurred_on: window } } },
						...(leaveFrom < attendance.from
							? [
									{
										leave_catalog_entry_day: {
											some: { ...unsealed, incurred_on: { gte: leaveFrom, lt: attendance.from } }
										}
									}
								]
							: []),
						pendingLeave
					]
				},
				limit: 10000,
				leave_catalog_entry_day: {
					fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
					limit: 10000
				}
			},
			claim_catalog_entry: { where: unpaid('claim_catalog_entry'), limit: 10000 },
			adhoc_catalog_entry: { where: unpaid('adhoc_catalog_entry'), limit: 10000 },
			loan_catalog_entry_repayment: { where: repaid, limit: 10000 },
			workplace_case_catalog_entry: {
				where: { ...own, ...unsealed },
				fields: ['id', 'employment_id', 'opened_on', 'closed_on'],
				limit: 10000
			}
		})
	);
	return yield* claimsAsPosted(read, {
		...withStints(data),
		...lawData(laws(jurisdiction, String(run.pay_date ?? coverage.to)))
	});
});

/** A law where a run reads it: each family under its own name, the settings as the one `law_settings` row. */
export const lawData = (law: Law | undefined): RunData =>
	law === undefined ? { law_settings: [] } : { ...law.rows, law_settings: [law.settings] };

/**
 * The stints a run read, as it prices them: one row for each stretch of a stint between its changes, the stint as it
 * stands in that stretch, `effective_range` the stretch. Each carries the service start worked out from the person's
 * stints, as windows and expressions read it.
 */
export const withStints = (data: RunData): RunData => {
	const { chain, lineage } = chainOf(
		(data.employee_profile ?? []).flatMap((row) =>
			Array.isArray(row.employment) ? row.employment.filter(isJsonObject) : []
		)
	);
	const cumulative = new Set(
		(data.employee_profile ?? []).flatMap((row) =>
			row.cumulative_service === true ? [String(row.id)] : []
		)
	);
	const profiles = (data.employee_profile ?? []).map((row) =>
		Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'employment'))
	);
	return {
		...data,
		employee_profile: profiles,
		employment: partsIn({ ...data, employee_profile: profiles }).flatMap((parts) => {
			const { stint } = parts;
			const starts = startsOf(stint, chain, lineage, cumulative.has(String(stint.employee_id)));
			const exit = isExit(stint, chain, lineage);
			return segmentsOf(parts).map((segment, index, segments) => ({
				...employmentOn(parts, segment.from),
				...starts,
				effective_range: segment,
				// the employment ends only at an exit, with the stint's last stretch
				exit: exit && index === segments.length - 1
			}));
		})
	};
};

export type RunData = Readonly<Record<string, readonly JsonObject[]>>;
