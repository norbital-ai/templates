import { BigDecimal, DateTime, Effect } from 'effect';
import {
	accountsOf,
	apply,
	measureOf,
	periodKey,
	periodOf,
	totalsScope,
	type Accounts,
	type Movement,
	type Wanted
} from '../ledger/core.js';
import { carriedFor, payslipWanted, type Carried } from '../ledger/service.js';
import { isJsonObject, type JsonObject } from './foundation.js';
import { attendanceOf, type PayWindow } from './pay_cycle.js';
import { emptyPayslipBreakdown, type PayslipBreakdown } from './payslip_breakdown.js';
import { objectValue, queryRows, type Reader } from './reads.js';
import {
	calculateRun,
	CALCULATION_FIELDS,
	claimsAsPosted,
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
const recoveryOf = (slip: CalculatedPayslip, amount: number): Line => ({
	code: RECOVERY,
	label: 'Recovery carried forward',
	subtotal_id: slip.breakdown.checkpoints.at(-1)?.id ?? '',
	amount,
	direction: 'ADD',
	party: 'EMPLOYEE',
	source: 'pay_amendment'
});

type Line = PayslipBreakdown['lines'][number];

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const rangeOf = (row: JsonObject) => {
	const range = objectValue(row.effective_range);
	return { from: textOf(range.from), to: typeof range.to === 'string' ? range.to : null };
};
/** A payslip's lines; a period that paid the person nothing has none. */
const linesOf = (breakdown: unknown): readonly JsonObject[] => {
	if (breakdown === undefined) return [];
	const lines = objectValue(breakdown).lines;
	return Array.isArray(lines) ? lines.filter(isJsonObject) : [];
};
const signedOf = (line: JsonObject) =>
	(line.direction === 'DEDUCT' ? -1 : 1) * Number(line.amount ?? 0);
/** The pay a period's lines give the person before any scheme: what a later-signed version changes. */
const earned = (breakdown: unknown): number =>
	linesOf(breakdown)
		.filter(
			(line) =>
				line.party === 'EMPLOYEE' &&
				line.source !== 'statutory_contribution_catalog' &&
				line.period === undefined
		)
		.reduce((total, line) => total + signedOf(line), 0);

const keyOf = (row: Wanted) => [row.account, row.code, row.period, row.measure].join('/');
const net = (rows: readonly Wanted[]): Map<string, Wanted> => {
	const held = new Map<string, Wanted>();
	for (const row of rows) {
		const before = held.get(keyOf(row));
		held.set(keyOf(row), { ...row, amount: (before?.amount ?? 0) + row.amount });
	}
	return held;
};
/** What takes `paid` to `due`, key by key. */
const postingsBetween = (due: readonly Wanted[], paid: readonly Wanted[]): readonly Wanted[] => {
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
const movements = (rows: readonly Wanted[], sign: 1 | -1): readonly Movement[] =>
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
const remainderLines = (
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
				subtotal_id: String(model.subtotal_id),
				amount: Math.abs(amount),
				direction: amount < 0 ? 'DEDUCT' : 'ADD',
				party: String(model.party),
				source: String(model.source),
				period
			}
		];
	});
};

interface Period {
	readonly run: JsonObject;
	readonly id: string;
	readonly key: string;
	readonly payDate: string;
	readonly order: string;
	readonly frame: RunFrame;
	readonly closes: string;
	readonly year: string;
}

const orderOf = (run: JsonObject) =>
	`${String(run.pay_date)}/${String(run.run_number ?? '').padStart(12, '0')}`;

/** Everything paid periods need to be worked out again, for these people, in one request. */
const loadSpan = Effect.fn('payroll.loadSpan')(function* (
	read: Reader,
	entity: string,
	people: readonly string[],
	settings: readonly string[],
	window: PayWindow,
	paidFrom: string,
	runs: readonly string[],
	jurisdiction: string
) {
	const own = { entity_id: { eq: entity } };
	const theirs = { employment_id: { is: { employee_id: { in: [...people] } } } };
	const dated = { gte: window.from, lte: window.to };
	const inVersions = { where: { settings_id: { in: [...settings] } }, limit: 10000 };
	const inLaw = { settings_id: { is: { code: { eq: jurisdiction } } } };
	const data = yield* queryRows(read, {
		jurisdiction_settings: {
			where: { id: { in: [...settings] } },
			fields: [
				'id',
				'code',
				'status',
				'timezone',
				'tax_year_start_month',
				'lookup',
				'conversions',
				'ledger'
			],
			limit: 1000
		},
		subtotal: {
			...inVersions,
			fields: ['settings_id', 'balance_window', ...CALCULATION_FIELDS.subtotal]
		},
		allowance_catalog: { ...inVersions, fields: ['settings_id', ...CALCULATION_FIELDS.allowance] },
		overtime_catalog: { ...inVersions, fields: ['settings_id', ...CALCULATION_FIELDS.overtime] },
		statutory_contribution_catalog: {
			...inVersions,
			fields: ['settings_id', 'balance_window', ...CALCULATION_FIELDS.statutory]
		},
		leave_catalog: { where: inLaw, fields: CALCULATION_FIELDS.leave, limit: 10000 },
		claim_catalog: { ...inVersions, fields: ['settings_id', ...CALCULATION_FIELDS.claim] },
		adhoc_catalog: { ...inVersions, fields: ['settings_id', ...CALCULATION_FIELDS.adhoc] },
		loan_catalog: { where: inLaw, fields: ['id', 'code', 'subtotal_id'], limit: 10000 },
		work_event_catalog: { where: inLaw, limit: 10000 },
		work_event: { where: own, limit: 10000 },
		shift_definition: { where: own, limit: 10000 },
		shift_pattern: { where: own, limit: 10000 },
		holiday: { where: own, limit: 10000 },
		entity_profile_version: { where: { ...own, status: { eq: 'SEALED' } }, limit: 10000 },
		employee_contract: {
			where: { employee_id: { in: [...people] }, status: { eq: 'SEALED' } },
			limit: 10000
		},
		employee_profile: {
			where: { id: { in: [...people] } },
			limit: 10000,
			employee_contract: {
				where: { status: { eq: 'SEALED' } },
				fields: ['employee_id', 'status', 'effective_range', 'entity_id'],
				limit: 10000,
				entity_id: { fields: ['settings_code'] }
			}
		},
		employee_balance: { where: { employee_id: { in: [...people] } }, limit: 10000 },
		leave_catalog_entry: {
			where: {
				...theirs,
				leave_catalog_entry_day: {
					some: { or: [{ incurred_on: dated }, { payroll_run_id: { in: [...runs] } }] }
				}
			},
			limit: 10000,
			catalog_id: { fields: ['code'] },
			leave_catalog_entry_day: {
				fields: ['id', 'leave_entry_id', 'incurred_on', 'part', 'payroll_run_id'],
				limit: 10000
			}
		},
		// what is dated in the span, and what a run of the span priced whatever its date
		claim_catalog_entry: {
			where: { ...theirs, or: [{ incurred_on: dated }, { payroll_run_id: { in: [...runs] } }] },
			limit: 10000,
			catalog_id: { fields: ['code'] }
		},
		adhoc_catalog_entry: {
			where: { ...theirs, or: [{ incurred_on: dated }, { payroll_run_id: { in: [...runs] } }] },
			limit: 10000,
			catalog_id: { fields: ['code'] }
		},
		loan_catalog_entry: {
			where: theirs,
			limit: 10000,
			catalog_id: { fields: ['code'] }
		},
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
		// what was paid: every payslip of theirs since the earliest year a recalculated period reads
		payslip: {
			where: {
				employee_id: { in: [...people] },
				payroll_run_id: { is: { pay_date: { gte: paidFrom } } }
			},
			fields: ['id', 'employee_id', 'payroll_run_id', 'breakdown'],
			limit: 10000
		},
		// the runs that already carried for a period: what they sealed belongs to it
		pay_amendment: {
			where: { employee_id: { in: [...people] }, payroll_run_id: { is_null: false } },
			fields: ['employee_id', 'pay_group_id', 'period', 'payroll_run_id'],
			limit: 10000
		},
		// what records posted outside any payslip, after the earliest recalculated period closed
		ledger_entry: {
			where: {
				balance_id: { is: { employee_id: { in: [...people] } } },
				or: [
					{ account: { in: ['leave', 'claim'] }, effective_on: { gt: window.from } },
					{
						account: { in: ['pay', 'statutory'] },
						source: { like: 'adhoc_catalog_entry:%' },
						effective_on: { gte: paidFrom }
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
	return yield* claimsAsPosted(read, withStints(data));
});

/** One paid period's own rows out of the span: its window, its law version, and the seals that belong to it. */
const sliceOf = (
	span: RunData,
	period: Period,
	people: ReadonlySet<string>,
	carriers: (employee: string) => ReadonlySet<string>,
	/** Whether this period's run carried, for this person, the earlier period holding this date. */
	carriedBack: (employee: string, date: string) => boolean,
	accounts: ReadonlyMap<string, Accounts>
): RunData => {
	const settings = String(period.run.settings_id);
	const inVersion = (model: string) =>
		(span[model] ?? []).filter((row) => String(row.settings_id) === settings);
	const contracts = (span.employee_contract ?? []).filter((row) =>
		people.has(String(row.employee_id))
	);
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
		jurisdiction_settings: (span.jurisdiction_settings ?? []).filter(
			(row) => String(row.id) === settings
		),
		subtotal: inVersion('subtotal'),
		allowance_catalog: inVersion('allowance_catalog'),
		overtime_catalog: inVersion('overtime_catalog'),
		statutory_contribution_catalog: inVersion('statutory_contribution_catalog'),
		claim_catalog: inVersion('claim_catalog'),
		adhoc_catalog: inVersion('adhoc_catalog'),
		pay_group: (span.pay_group ?? []).filter(
			(row) => String(row.id) === String(period.run.pay_group_id)
		),
		employee_contract: contracts,
		contract_terms: contracts,
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
		workplace_case_catalog_entry: [],
		statutory_change: []
	};
};

/** What a paid payslip's own lines posted, as its run posted them. */
const ownPostings = (span: RunData, run: JsonObject, breakdown: unknown): readonly Wanted[] => {
	const settings = (span.jurisdiction_settings ?? []).find(
		(row) => String(row.id) === String(run.settings_id)
	);
	if (settings === undefined) return [];
	const monthly = (model: string, suffixes: readonly string[]) =>
		(span[model] ?? [])
			.filter(
				(row) => String(row.settings_id) === String(settings.id) && row.balance_window === 'MONTH'
			)
			.flatMap((row) => suffixes.map((suffix) => `${String(row.code)}${suffix}`));
	return payslipWanted(objectValue(breakdown), String(run.pay_date), {
		scope: totalsScope(settings, run.entity_id),
		started: String(run.pay_date),
		events: [],
		taxYearStart: Number(settings.tax_year_start_month ?? 1),
		byMonth: [
			...monthly('subtotal', ['']),
			...monthly('statutory_contribution_catalog', ['.employee', '.employer'])
		]
	});
};

export interface Amended {
	readonly payslips: readonly CalculatedPayslip[];
	readonly attaches: Readonly<Record<string, readonly string[]>>;
	/** The amendment rows this run carried: it takes them. */
	readonly taken: readonly string[];
	/** People whose recovery outran their pay: the run leaves a row for its own period. */
	readonly deferred: readonly string[];
	/** Amended person-periods left for the next run. */
	readonly waiting: number;
}

/**
 * One run with what it carries for earlier periods: an on-cycle run for everyone it pays, an off-cycle run for the
 * people whose open rows HR named, who may be paid nothing else by it (someone who has left). `own` is the run's own read; `known` is what the
 * transform already read of the company: its runs, its pay groups and every open amendment row.
 */
export const amendedRun = Effect.fn('payroll.amendedRun')(function* (
	read: Reader,
	own: {
		readonly id: string;
		readonly row: JsonObject;
		readonly frame: RunFrame;
		readonly data: RunData;
	},
	known: {
		readonly runs: readonly JsonObject[];
		readonly groups: readonly JsonObject[];
		readonly amendments: readonly JsonObject[];
		/** Every sealed law version: a paid period is worked out on the one now in force on its pay date. */
		readonly laws: readonly JsonObject[];
	}
) {
	const offCycle = own.frame.pays !== undefined;
	// off-cycle, a payslip below zero is refused: only an on-cycle run carries the rest
	const plain = () =>
		Effect.map(calculateRun(own.data, own.row, own.frame), (result): Amended => {
			const short = offCycle ? [] : result.payslips.filter((slip) => slip.net_pay < 0);
			const payslips = result.payslips.map((slip) =>
				!short.includes(slip)
					? slip
					: {
							...slip,
							net_pay: 0,
							breakdown: {
								...slip.breakdown,
								lines: [...slip.breakdown.lines, recoveryOf(slip, -slip.net_pay)]
							}
						}
			);
			return {
				payslips,
				attaches: { ...result.attaches },
				taken: [],
				deferred: short.map((slip) => slip.employee_id),
				waiting: 0
			};
		});
	const named = own.frame.carries ?? new Set<string>();
	if (offCycle && named.size === 0) return yield* plain();
	const ownPayDate = String(own.row.pay_date);
	const schedules = new Map(
		known.groups.map((row) => [String(row.id), objectValue(row.payment_schedule)])
	);
	// a law version sealed since from its real date replaces the one a paid run was first worked out on
	const lawOf = new Map(known.laws.map((row) => [String(row.id), row]));
	const inForce = (run: JsonObject): string => {
		const code = lawOf.get(String(run.settings_id))?.code;
		const now = known.laws.find((row) => {
			const { from, to } = rangeOf(row);
			return (
				row.code === code &&
				from <= String(run.pay_date) &&
				(to === null || to >= String(run.pay_date))
			);
		});
		return String(now?.id ?? run.settings_id);
	};
	const runs: readonly JsonObject[] = known.runs.map((run) => ({
		...run,
		settings_id: inForce(run)
	}));
	const paidRuns = runs.filter((run) => run.kind === 'ON_CYCLE' && run.state === 'PAID');
	const runAt = new Map(
		paidRuns.map((run) => [`${String(run.pay_group_id)}/${String(run.period)}`, run])
	);
	const paying = unique(
		offCycle
			? known.amendments
					.filter((row) => named.has(String(row.id)))
					.map((row) => String(row.employee_id))
			: (own.data.employee_contract ?? []).map((row) => String(row.employee_id))
	);
	// a late entry dated in a period the person may have been paid for is that period's, not this one's
	const employeeOf = new Map(
		(own.data.employee_contract ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const ownFrom = own.frame.attendance.from;
	const late = (
		offCycle
			? []
			: [...(own.data.claim_catalog_entry ?? []), ...(own.data.adhoc_catalog_entry ?? [])]
	).filter(
		(row) =>
			row.payroll_run_id == null && typeof row.incurred_on === 'string' && row.incurred_on < ownFrom
	);
	// a version signed since the last pay date that began before this period: it may owe back pay
	const settings = (own.data.jurisdiction_settings ?? [])[0];
	const paysBack = typeof objectValue(settings?.conversions).back_pay === 'string';
	const signedLately =
		!paysBack || offCycle
			? []
			: [...(own.data.contract_terms ?? []), ...(own.data.employee_contract ?? [])].filter(
					(row) => {
						const signed = objectValue(row.terms).signed_on;
						return (
							typeof signed === 'string' &&
							signed <= ownPayDate &&
							// a version from before this period's salary days: the attendance window may already hold its first days
							rangeOf(row).from < String(objectValue(own.row.salary_coverage).from) &&
							// a contract signed in its own first pay period was never late for anything
							signed > rangeOf(row).from
						);
					}
				);
	const open = known.amendments.filter(
		(row) =>
			row.payroll_run_id == null &&
			paying.includes(String(row.employee_id)) &&
			runAt.has(`${String(row.pay_group_id)}/${String(row.period)}`)
	);
	const candidates = unique([
		...open.map((row) => String(row.employee_id)),
		...late.flatMap((row) => employeeOf.get(String(row.employment_id)) ?? []),
		...signedLately.map((row) => String(row.employee_id))
	]);
	if (candidates.length === 0) return yield* plain();

	// the bound: people are taken whole, the earliest amended first, by the periods their group has paid since
	const earliestOf = (employee: string): string =>
		[
			// a period's attendance may open before its salary days: the span starts where the earliest one attends
			...open
				.filter((row) => String(row.employee_id) === employee)
				.map((row) => {
					const coverage = objectValue(
						runAt.get(`${String(row.pay_group_id)}/${String(row.period)}`)?.salary_coverage
					);
					const salary = { from: String(coverage.from), to: String(coverage.to) };
					const schedule = schedules.get(String(row.pay_group_id));
					const attended = schedule === undefined ? salary : attendanceOf(schedule, salary);
					return attended.from < salary.from ? attended.from : salary.from;
				}),
			...late
				.filter((row) => employeeOf.get(String(row.employment_id)) === employee)
				.map((row) => String(row.incurred_on)),
			...signedLately
				.filter((row) => String(row.employee_id) === employee)
				.map((row) => rangeOf(row).from)
		].toSorted()[0] ?? ownFrom;
	const ordered = candidates.toSorted((a, b) => earliestOf(a).localeCompare(earliestOf(b)));
	const people: string[] = [];
	let reach = 0;
	for (const employee of ordered) {
		const since = earliestOf(employee);
		const cost = paidRuns.filter(
			(run) => String(objectValue(run.salary_coverage).to) >= since
		).length;
		if (people.length > 0 && reach + cost > RECALCULATED_A_RUN) continue;
		people.push(employee);
		reach += cost;
	}
	const waiting = open.filter((row) => !people.includes(String(row.employee_id))).length;
	const from = people.map(earliestOf).toSorted()[0] ?? ownFrom;
	// a period reads its own tax year so far and a year of months: what was paid is rebuilt from the start of the tax
	// year a year before the earliest, and everything older is read from the balance as it stands
	const yearBefore = DateTime.subtract(DateTime.makeUnsafe(from), { years: 1 });
	const yearStarts = DateTime.makeUnsafe({
		year: DateTime.getPartUtc(yearBefore, 'year'),
		month: Number(settings?.tax_year_start_month ?? 1),
		day: 1
	});
	const paidFrom = DateTime.formatIsoDate(
		DateTime.isLessThanOrEqualTo(yearStarts, yearBefore)
			? yearStarts
			: DateTime.subtract(yearStarts, { years: 1 })
	);
	const before = paidRuns.filter((run) => String(run.pay_date) >= paidFrom);
	const span = yield* loadSpan(
		read,
		String(own.row.entity_id),
		people,
		unique([String(own.row.settings_id), ...runs.map((run) => String(run.settings_id))]),
		{ from: `${from.slice(0, 8)}01` < from ? `${from.slice(0, 8)}01` : from, to: ownFrom },
		paidFrom,
		before.map((run) => String(run.id)),
		String(settings?.code)
	);
	const spanData: RunData = { ...span, pay_group: known.groups };

	const runOf = new Map(runs.map((run) => [String(run.id), run]));
	const periodOfRun = (run: JsonObject): Period | undefined => {
		const schedule = schedules.get(String(run.pay_group_id));
		const settingsRow = (spanData.jurisdiction_settings ?? []).find(
			(row) => String(row.id) === String(run.settings_id)
		);
		const coverage = objectValue(run.salary_coverage);
		if (schedule === undefined || settingsRow === undefined) return undefined;
		const salary = { from: String(coverage.from), to: String(coverage.to) };
		const attendance = attendanceOf(schedule, salary);
		const payDate = String(run.pay_date);
		return {
			run,
			id: String(run.id),
			key: `${String(run.pay_group_id)}/${String(run.period)}`,
			payDate,
			order: orderOf(run),
			frame: { attendance },
			closes: attendance.to > salary.to ? attendance.to : salary.to,
			year: periodKey(
				totalsScope(settingsRow, run.entity_id),
				{ kind: 'YEAR', start_month: Number(settingsRow.tax_year_start_month ?? 1) },
				payDate,
				payDate
			)
		};
	};
	const slips = (spanData.payslip ?? []).flatMap((slip) => {
		const run = runOf.get(String(slip.payroll_run_id));
		return run === undefined ? [] : [{ slip, run, order: orderOf(run) }];
	});
	const slipsOf = (employee: string) =>
		slips
			.filter(({ slip }) => String(slip.employee_id) === employee)
			.toSorted((a, b) => a.order.localeCompare(b.order));
	const versionsOf = (employee: string) =>
		(spanData.employee_contract ?? []).filter(
			(row) => String(row.employee_id) === employee && row.status !== 'VOID'
		);
	// one period a run, whoever asks: the people it is worked out again for are priced together
	const periods = new Map(
		paidRuns
			.toSorted((a, b) => orderOf(a).localeCompare(orderOf(b)))
			.flatMap((run) => {
				const period = periodOfRun(run);
				return period === undefined ? [] : [[String(run.id), period] as const];
			})
	);
	/**
	 * The person's paid on-cycle periods, oldest first: those that paid them, and those their contract was in with
	 * nothing agreed yet (a hire signed after its first months), which a later period owes as back pay.
	 */
	const periodsOf = new Map(
		people.map((employee) => {
			const slipped = new Set(slipsOf(employee).map(({ run }) => String(run.id)));
			const versions = versionsOf(employee);
			return [
				employee,
				[...periods.values()].filter(
					(period) =>
						slipped.has(period.id) ||
						versions.some((row) => {
							const { from, to } = rangeOf(row);
							const coverage = objectValue(period.run.salary_coverage);
							return (
								String(row.pay_group_id) === String(period.run.pay_group_id) &&
								from <= String(coverage.to) &&
								(to === null || to >= String(coverage.from))
							);
						})
				)
			] as const;
		})
	);
	const signedOn = (row: JsonObject) => textOf(objectValue(row.terms).signed_on);
	const ownPeriod: Period = {
		run: { ...own.row, id: own.id },
		id: own.id,
		key: `${String(own.row.pay_group_id)}/${String(own.row.period)}`,
		payDate: ownPayDate,
		order: `${ownPayDate}/~`,
		frame: own.frame,
		closes: String(objectValue(own.row.salary_coverage).to),
		year: ''
	};

	// which periods each person has worked out again: from each amended one through the last paid one of its tax year
	const again = new Map<string, Period[]>();
	const reach2 = (employee: string, start: Period) => {
		const held = again.get(employee) ?? [];
		for (const period of periodsOf.get(employee) ?? [])
			if (period.order >= start.order && period.year === start.year && !held.includes(period))
				held.push(period);
		again.set(employee, held);
	};
	// someone left for the next run waits whole: their late entries wait with them
	const leftOut = new Set<string>(
		late
			.filter((row) => {
				const employee = employeeOf.get(String(row.employment_id));
				return (
					employee !== undefined && candidates.includes(employee) && !people.includes(employee)
				);
			})
			.map((row) => String(row.id))
	);
	for (const employee of people) {
		const paid = periodsOf.get(employee) ?? [];
		for (const row of open.filter((entry) => String(entry.employee_id) === employee)) {
			const start = paid.find(
				(period) => period.key === `${String(row.pay_group_id)}/${String(row.period)}`
			);
			if (start !== undefined) reach2(employee, start);
		}
		// a late entry with no row of its own still belongs to the period that paid the person for its date
		for (const row of late.filter(
			(entry) => employeeOf.get(String(entry.employment_id)) === employee
		)) {
			const start = paid.find(
				(period) =>
					String(row.incurred_on) >= period.frame.attendance.from &&
					String(row.incurred_on) <= period.closes
			);
			if (start === undefined) continue;
			leftOut.add(String(row.id));
			reach2(employee, start);
		}
		// a version's signing period owes the back pay: a period it reaches being amended amends that one too
		for (const version of versionsOf(employee)) {
			const signed = signedOn(version);
			if (signed === '' || !paysBack) continue;
			const signing = paid.find((period) => period.payDate >= signed);
			const reaches = (again.get(employee) ?? []).some(
				(period) => period.payDate < signed && period.closes >= rangeOf(version).from
			);
			if (signing !== undefined && reaches) reach2(employee, signing);
		}
	}

	const balances = new Map(
		(spanData.employee_balance ?? []).map((row) => [String(row.employee_id), row])
	);
	const balanceOwner = new Map(
		(spanData.employee_balance ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	const outside = Map.groupBy(spanData.ledger_entry ?? [], (row) =>
		String(balanceOwner.get(String(row.balance_id)))
	);
	/** What this run has worked out for earlier periods so far: their postings, by person. */
	const carried = new Map<string, { period: Period; postings: readonly Wanted[] }[]>();
	/**
	 * The balance a period saw. Pay and contributions are rebuilt from what was paid before it, payslip by payslip, with
	 * what this run has carried for earlier periods; leave and claims are today's less what was recorded after it closed.
	 */
	const accountsAt = (employee: string, at: Period): Accounts => {
		const now = accountsOf(balances.get(employee)?.account);
		const { pay, statutory, ...other } = now;
		// a window that opened before the rebuild starts is kept as the balance holds it
		const older = (codes: Accounts[string] | undefined): Accounts[string] =>
			Object.fromEntries(
				Object.entries(codes ?? {}).flatMap(([code, periods]) => {
					const kept = Object.entries(periods).filter(([key]) => key.slice(-10) < paidFrom);
					return kept.length === 0 ? [] : [[code, Object.fromEntries(kept)]];
				})
			);
		let built: Accounts = { pay: older(pay), statutory: older(statutory) };
		let rest: Accounts = other;
		for (const { slip, run, order } of slipsOf(employee)) {
			const posted = ownPostings(spanData, run, slip.breakdown);
			const money = posted.filter((row) => row.account === 'pay' || row.account === 'statutory');
			if (order < at.order) built = apply(built, movements(money, 1));
			else
				rest = apply(
					rest,
					movements(
						posted.filter((row) => row.account !== 'pay' && row.account !== 'statutory'),
						-1
					)
				);
			for (const entry of carriedFor(slip.breakdown)) {
				const of = runOf.get(entry.run_id);
				if (of !== undefined && orderOf(of) < at.order)
					built = apply(built, movements(entry.postings, 1));
			}
		}
		for (const entry of carried.get(employee) ?? [])
			if (entry.period.order < at.order) built = apply(built, movements(entry.postings, 1));
		for (const row of outside.get(employee) ?? []) {
			const move: Wanted = {
				account: String(row.account),
				code: String(row.code),
				period: periodOf(row.period),
				measure: measureOf(row.measure),
				amount: (row.operation === 'DEDUCT' ? -1 : 1) * Number(row.amount ?? 0),
				effective_on: String(row.effective_on)
			};
			const money = move.account === 'pay' || move.account === 'statutory';
			if (money && move.effective_on <= at.closes) built = apply(built, movements([move], 1));
			if (!money && move.effective_on > at.closes) rest = apply(rest, movements([move], -1));
		}
		return { ...rest, ...built };
	};
	const carriersOf = (period: Period) => (employee: string) =>
		new Set(
			(spanData.pay_amendment ?? [])
				.filter(
					(row) =>
						String(row.employee_id) === employee &&
						`${String(row.pay_group_id)}/${String(row.period)}` === period.key
				)
				.map((row) => String(row.payroll_run_id))
		);
	const priced = (period: Period, who: readonly string[], frame: Partial<RunFrame>) =>
		calculateRun(
			sliceOf(
				spanData,
				period,
				new Set(who),
				carriersOf(period),
				(employee, date) =>
					(spanData.pay_amendment ?? []).some(
						(row) =>
							String(row.employee_id) === employee &&
							String(row.payroll_run_id) === period.id &&
							(periodsOf.get(employee) ?? []).some(
								(earlier) =>
									earlier.key === `${String(row.pay_group_id)}/${String(row.period)}` &&
									date >= earlier.frame.attendance.from &&
									date <= earlier.closes
							)
					),
				new Map(who.map((employee) => [employee, accountsAt(employee, period)]))
			),
			period.run,
			{ ...period.frame, people: new Set(who), termsAsOf: period.payDate, ...frame }
		);

	/**
	 * The back pay a period owes: for each earlier paid period, its earnings on the terms signed by this period's pay
	 * date, less its earnings on the terms signed by the pay date before.
	 */
	const backPay = Effect.fn('payroll.backPay')(function* (at: Period, who: readonly string[]) {
		const owed = new Map<string, number>();
		const asks = new Map<string, { period: Period; since: string; who: string[] }>();
		for (const employee of who) {
			const paid = periodsOf.get(employee) ?? [];
			const earlier = paid.filter((period) => period.order < at.order);
			const since = earlier.at(-1)?.payDate ?? '';
			const signed = versionsOf(employee).filter(
				(row) => signedOn(row) > since && signedOn(row) <= at.payDate
			);
			if (!paysBack || signed.length === 0 || since === '') continue;
			const first = signed.map((row) => rangeOf(row).from).toSorted()[0] ?? at.payDate;
			for (const period of earlier.filter((entry) => entry.closes >= first)) {
				const ask = asks.get(`${period.id}/${since}`) ?? { period, since, who: [] };
				ask.who.push(employee);
				asks.set(`${period.id}/${since}`, ask);
			}
		}
		for (const { period, since, who: asked } of asks.values()) {
			const now = yield* priced(period, asked, { termsAsOf: at.payDate });
			const then = yield* priced(period, asked, { termsAsOf: since });
			for (const employee of asked) {
				const of = (slips: readonly CalculatedPayslip[]) =>
					earned(slips.find((slip) => slip.employee_id === employee)?.breakdown);
				owed.set(employee, (owed.get(employee) ?? 0) + of(now.payslips) - of(then.payslips));
			}
		}
		return new Map(
			[...owed].map(([employee, amount]) => [
				employee,
				BigDecimal.toNumberUnsafe(
					BigDecimal.round(BigDecimal.fromNumberUnsafe(amount), { scale: 6 })
				)
			])
		);
	});

	const attaches: Record<string, string[]> = {};
	const attach = (more: Readonly<Record<string, readonly string[]>>) => {
		for (const [layer, ids] of Object.entries(more))
			attaches[layer] = unique([...(attaches[layer] ?? []), ...ids]);
	};
	const lines = new Map<string, Line[]>();
	const records = new Map<string, Carried[]>();
	// the schemes this run's law charges in the month paid, and the pay each person is carried, by checkpoint code
	const paidMonth = new Set(
		(own.data.statutory_contribution_catalog ?? []).flatMap((row) =>
			row.assessed === 'PAID' ? [String(row.code)] : []
		)
	);
	const checkpointCode = new Map(
		(spanData.subtotal ?? []).map((row) => [String(row.id), String(row.code)])
	);
	const carriedPay = new Map<string, Record<string, number>>();
	const kinds = new Map<string, string>();
	const turns = unique([...again.values()].flat()).toSorted((a, b) =>
		a.order.localeCompare(b.order)
	);
	for (const period of turns) {
		const who = people.filter((employee) => (again.get(employee) ?? []).includes(period));
		const result = yield* priced(period, who, { backPay: yield* backPay(period, who) });
		attach(result.attaches);
		for (const employee of who) {
			const due = result.payslips.find((slip) => slip.employee_id === employee)?.breakdown;
			for (const row of due?.statutory ?? []) kinds.set(row.code, row.kind);
			const theirs = slipsOf(employee);
			const paidSlip = theirs.find(({ run }) => String(run.id) === period.id);
			const later = theirs.filter(({ order }) => order > period.order);
			// what was paid for it: its payslip's own lines, and what later payslips carried for it
			const paidLines = [
				...linesOf(paidSlip?.slip.breakdown).filter((line) => line.period === undefined),
				...later.flatMap(({ slip }) =>
					linesOf(slip.breakdown).filter((line) => line.period === period.key.split('/')[1])
				)
			];
			const paidPostings = [
				...(paidSlip === undefined
					? []
					: ownPostings(spanData, period.run, paidSlip.slip.breakdown)),
				...later.flatMap(({ slip }) =>
					carriedFor(slip.breakdown)
						.filter((entry) => entry.run_id === period.id)
						.flatMap((entry) => entry.postings)
				)
			];
			// a scheme assessed in the month paid keeps what it charged that period: the pay carried is this month's wages
			const remainder = remainderLines(
				due === undefined ? [] : linesOf(due),
				paidLines,
				String(period.run.period)
			).filter((line) => !paidMonth.has(line.code.replace(/_EMPLOYER$/, '')));
			const postings = postingsBetween(
				due === undefined ? [] : ownPostings(spanData, period.run, due),
				paidPostings
			).filter(
				(row) => !(row.account === 'statutory' && paidMonth.has(row.code.split('.')[0] ?? ''))
			);
			const pay = carriedPay.get(employee) ?? {};
			for (const line of remainder) {
				const checkpoint = checkpointCode.get(line.subtotal_id);
				if (line.party !== 'EMPLOYEE' || line.source === 'statutory_contribution_catalog') continue;
				if (checkpoint === undefined) continue;
				pay[checkpoint] =
					(pay[checkpoint] ?? 0) + (line.direction === 'DEDUCT' ? -line.amount : line.amount);
			}
			carriedPay.set(employee, pay);
			lines.set(employee, [...(lines.get(employee) ?? []), ...remainder]);
			if (postings.length > 0)
				records.set(employee, [
					...(records.get(employee) ?? []),
					{ run_id: period.id, period: String(period.run.period), postings }
				]);
			carried.set(employee, [...(carried.get(employee) ?? []), { period, postings }]);
		}
	}

	// the run's own period, on the balance the carried differences leave
	const amended = new Set(people);
	const ownData: RunData = {
		...own.data,
		contract_terms: [...(own.data.contract_terms ?? []), ...(spanData.employee_contract ?? [])],
		employee_balance: (own.data.employee_balance ?? []).map((row) =>
			amended.has(String(row.employee_id))
				? { ...row, account: accountsAt(String(row.employee_id), ownPeriod) }
				: row
		)
	};
	const result = yield* calculateRun(ownData, own.row, {
		...own.frame,
		leftOut,
		backPay: offCycle ? new Map() : yield* backPay(ownPeriod, people),
		...(paidMonth.size === 0 ? {} : { carried: carriedPay })
	});
	attach(result.attaches);
	// an off-cycle run may pay someone nothing of its own: their payslip holds what it carries, and nothing else
	const bare = !offCycle
		? []
		: people.flatMap((employee): CalculatedPayslip[] => {
				const last = versionsOf(employee)
					.filter((row) => String(row.entity_id) === String(own.row.entity_id))
					.toSorted((a, b) => rangeOf(a).from.localeCompare(rangeOf(b).from))
					.at(-1);
				return last === undefined || result.payslips.some((slip) => slip.employee_id === employee)
					? []
					: [
							{
								employee_id: employee,
								employment_id: String(last.id),
								entity_id: String(own.row.entity_id),
								basic_earnings: 0,
								gross_earnings: 0,
								net_pay: 0,
								total_deductions: 0,
								employer_cost: 0,
								period: String(own.row.period),
								ordinary_wages: 0,
								employee_statutory: 0,
								tax_withheld: 0,
								breakdown: emptyPayslipBreakdown
							}
						];
			});
	const deferred: string[] = [];
	const payslips = [...result.payslips, ...bare].map((slip): CalculatedPayslip => {
		const extra = lines.get(slip.employee_id) ?? [];
		if (
			extra.length === 0 &&
			(records.get(slip.employee_id) ?? []).length === 0 &&
			slip.net_pay >= 0
		)
			return slip;
		const mine = extra.filter((line) => line.party === 'EMPLOYEE');
		const sum = (direction: string) =>
			mine
				.filter((line) => line.direction === direction)
				.reduce((total, line) => total + line.amount, 0);
		const net = BigDecimal.toNumberUnsafe(
			BigDecimal.round(BigDecimal.fromNumberUnsafe(slip.net_pay + sum('ADD') - sum('DEDUCT')), {
				scale: 12,
				mode: 'half-ceil'
			})
		);
		const recovery: Line[] = net < 0 ? [recoveryOf(slip, -net)] : [];
		if (recovery.length > 0) deferred.push(slip.employee_id);
		const statutoryOf = (kind: string) =>
			mine
				.filter(
					(line) =>
						line.source === 'statutory_contribution_catalog' &&
						(slip.breakdown.statutory.find((row) => row.code === line.code)?.kind ??
							kinds.get(line.code) ??
							'CONTRIBUTION') === kind
				)
				.reduce(
					(total, line) => total + (line.direction === 'DEDUCT' ? line.amount : -line.amount),
					0
				);
		const employer = extra
			.filter((line) => line.party === 'EMPLOYER')
			.reduce(
				(total, line) => total + (line.direction === 'DEDUCT' ? -line.amount : line.amount),
				0
			);
		return {
			...slip,
			net_pay: Math.max(0, net),
			total_deductions: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(Math.max(0, slip.total_deductions + sum('DEDUCT'))),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			gross_earnings: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(
						Math.max(0, net) + Math.max(0, slip.total_deductions + sum('DEDUCT'))
					),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			employer_cost: BigDecimal.toNumberUnsafe(
				BigDecimal.round(BigDecimal.fromNumberUnsafe(Math.max(0, slip.employer_cost + employer)), {
					scale: 12,
					mode: 'half-ceil'
				})
			),
			employee_statutory: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(
						Math.max(0, slip.employee_statutory + statutoryOf('CONTRIBUTION'))
					),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			tax_withheld: BigDecimal.toNumberUnsafe(
				BigDecimal.round(
					BigDecimal.fromNumberUnsafe(Math.max(0, slip.tax_withheld + statutoryOf('TAX'))),
					{ scale: 12, mode: 'half-ceil' }
				)
			),
			breakdown: {
				...slip.breakdown,
				lines: [...slip.breakdown.lines, ...recovery, ...extra],
				carried: records.get(slip.employee_id) ?? []
			}
		};
	});
	const done = new Set(payslips.map((slip) => slip.employee_id));
	return {
		payslips,
		attaches,
		// a row is taken only when its person is on this run's payslips: nobody else carries it
		taken: open
			.filter(
				(row) => people.includes(String(row.employee_id)) && done.has(String(row.employee_id))
			)
			.map((row) => String(row.id)),
		deferred,
		waiting
	} satisfies Amended;
});
