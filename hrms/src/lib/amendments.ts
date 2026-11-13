import type { CarriedWrites } from '@norbital-ai/bolt';
import { add_days } from './date.js';
import { Effect } from 'effect';
import { Refusal, type JsonObject } from './payroll_engine/foundation.js';
import { attendanceOf } from './payroll_engine/pay_cycle.js';
import { idOf, objectValue, queryRows, type Reader } from './payroll_engine/reads.js';

/**
 * No write reaches a paid period's inputs without its amendment row in the same write. A model the run reads says
 * what its write touches, and this returns the rows that write carries: one for each person and paid period touched
 * that has no open row yet. A write held for approval carries them in the approving decision, as it does its postings.
 */

/** What a write touches: one person, by a contract version of theirs or by themself, from a day to a day. */
export interface Touched {
	readonly employment?: string;
	readonly employee?: string;
	readonly from: string;
	/** The one day `from` when left out; `null` is everything from `from` on. */
	readonly to?: string | null;
	/** The run that priced the row, when one did: its period is touched whatever the row's date. */
	readonly run?: unknown;
	/** The date is a placeholder (a cash-out's): only the run that priced the row is touched. */
	readonly undated?: boolean;
	/** Amends a paid period it reaches, and is not held by an unpaid run: that run has not settled anything yet. */
	readonly soft?: boolean;
}

/** A correction reaching more person-periods than this is made by pay group or by year. */
const REACH = 10000;
const TOO_WIDE =
	'This reaches too many paid periods for one save. Correct it by pay group or by year.';

type Rows = NonNullable<NonNullable<CarriedWrites['pay_amendment']>['create']>[number][];

const held = (run: JsonObject) =>
	`Run ${String(run.run_number)} holds this person and is not paid yet. Delete it, correct this, and run again.`;

/** The paid periods these payslips name, with the window each priced. */
const windowsOf = (payslips: readonly JsonObject[], schedules: ReadonlyMap<string, JsonObject>) =>
	payslips.flatMap((slip) => {
		const run = objectValue(slip.payroll_run_id);
		const coverage = objectValue(run.salary_coverage);
		const schedule = schedules.get(String(run.pay_group_id));
		if (typeof coverage.from !== 'string' || typeof coverage.to !== 'string') return [];
		const salary = { from: coverage.from, to: coverage.to };
		// an off-cycle run prices entries, not a window of attendance: it holds its people only while it is unpaid
		const attendance =
			run.kind !== 'ON_CYCLE' || schedule === undefined ? salary : attendanceOf(schedule, salary);
		return [
			{
				employee: String(slip.employee_id),
				run,
				from: attendance.from < salary.from ? attendance.from : salary.from,
				to: attendance.to > salary.to ? attendance.to : salary.to
			}
		];
	});

const carried = (
	touched: readonly {
		readonly employee: string;
		readonly from: string;
		readonly to: string | null;
		readonly run?: unknown;
		readonly undated?: boolean;
		readonly soft?: boolean;
	}[],
	windows: ReturnType<typeof windowsOf>,
	open: readonly JsonObject[]
) =>
	Effect.gen(function* () {
		const reached = (window: { employee: string; from: string; to: string; run: JsonObject }) =>
			touched.some(
				(touch) =>
					touch.employee === window.employee &&
					((touch.undated !== true &&
						touch.from <= window.to &&
						(touch.to === null || touch.to >= window.from)) ||
						(touch.run != null && String(touch.run) === String(window.run.id)))
			);
		// nothing of a person moves under a run that is being reviewed: what it priced, or anything before it
		const holding = windows.find(
			(window) =>
				window.run.state !== 'PAID' &&
				touched.some(
					(touch) =>
						touch.soft !== true &&
						touch.employee === window.employee &&
						(touch.undated === true
							? touch.run != null && String(touch.run) === String(window.run.id)
							: touch.from <= window.to)
				)
		);
		if (holding !== undefined)
			return yield* Effect.fail(new Refusal({ message: held(holding.run) }));
		const has = new Set(
			open.map(
				(row) => `${String(row.employee_id)}/${String(row.pay_group_id)}/${String(row.period)}`
			)
		);
		const rows: Rows = [];
		for (const window of windows) {
			if (window.run.kind !== 'ON_CYCLE' || window.run.state !== 'PAID' || !reached(window))
				continue;
			const key = `${window.employee}/${String(window.run.pay_group_id)}/${String(window.run.period)}`;
			if (has.has(key)) continue;
			has.add(key);
			rows.push({
				employee_id: idOf('employee_profile', window.employee),
				pay_group_id: idOf('pay_group', window.run.pay_group_id),
				period: String(window.run.period)
			});
		}
		if (rows.length > REACH) return yield* Effect.fail(new Refusal({ message: TOO_WIDE }));
		return rows.length === 0 ? {} : { pay_amendment: { create: rows } };
	});

const RUN = {
	fields: ['id', 'pay_group_id', 'period', 'kind', 'state', 'salary_coverage', 'run_number']
};
/** A window may open a cycle before its salary period: payslips are read from two months before the earliest day. */
const since = (touched: readonly Touched[]) =>
	String(add_days(touched.map((touch) => touch.from).toSorted()[0] ?? '9999-12-31', -62));

/** The amendment rows a write on these people carries. */
export const amendmentsFor = Effect.fn('payroll.amendmentsFor')(function* (
	read: Reader,
	touched: readonly Touched[]
) {
	if (touched.length === 0) return {};
	const employments = [
		...new Set(
			touched.flatMap((touch) => (touch.employment === undefined ? [] : [touch.employment]))
		)
	];
	const named = [
		...new Set(touched.flatMap((touch) => (touch.employee === undefined ? [] : [touch.employee])))
	];
	const theirs = {
		or: [{ id: { in: named } }, { employee_contract: { some: { id: { in: employments } } } }]
	};
	const sealing = [
		...new Set(touched.flatMap((touch) => (touch.run == null ? [] : [String(touch.run)])))
	];
	const known = yield* queryRows(read, {
		employee_contract: {
			where: { id: { in: employments } },
			fields: ['employee_id'],
			limit: 10000
		},
		payslip: {
			where: {
				employee_id: { is: theirs },
				or: [
					{
						payroll_run_id: {
							is: { salary_coverage: { overlaps: { from: since(touched), to: null } } }
						}
					},
					{ payroll_run_id: { in: sealing } }
				]
			},
			fields: ['employee_id', 'payroll_run_id'],
			limit: REACH,
			payroll_run_id: RUN
		},
		pay_group: { fields: ['payment_schedule'], limit: 10000 },
		pay_amendment: {
			where: { payroll_run_id: { is_null: true }, employee_id: { is: theirs } },
			fields: ['employee_id', 'pay_group_id', 'period'],
			limit: 10000
		}
	});
	const employeeOf = new Map(
		(known.employee_contract ?? []).map((row) => [String(row.id), String(row.employee_id)])
	);
	return yield* carried(
		touched.flatMap((touch) => {
			const employee = touch.employee ?? employeeOf.get(String(touch.employment));
			return employee === undefined
				? []
				: [
						{
							employee,
							from: touch.from,
							to: touch.to === undefined ? touch.from : touch.to,
							run: touch.run,
							...(touch.undated === true ? { undated: true } : {}),
							...(touch.soft === true ? { soft: true } : {})
						}
					];
		}),
		windowsOf(
			known.payslip ?? [],
			new Map(
				(known.pay_group ?? []).map((row) => [String(row.id), objectValue(row.payment_schedule)])
			)
		),
		known.pay_amendment ?? []
	);
});

/** The amendment rows a company-wide correction carries: everyone the company paid for those days. */
export const amendmentsOf = Effect.fn('payroll.amendmentsOf')(function* (
	read: Reader,
	entities: readonly string[],
	spans: readonly {
		readonly from: string;
		readonly to: string | null;
		readonly employee?: string;
	}[]
) {
	if (entities.length === 0 || spans.length === 0) return {};
	const known = yield* queryRows(read, {
		payslip: {
			where: {
				entity_id: { in: [...entities] },
				payroll_run_id: {
					is: { salary_coverage: { overlaps: { from: since(spans), to: null } } }
				}
			},
			fields: ['employee_id', 'payroll_run_id'],
			limit: REACH,
			payroll_run_id: RUN
		},
		pay_group: {
			where: { entity_id: { in: [...entities] } },
			fields: ['payment_schedule'],
			limit: 10000
		},
		pay_amendment: {
			where: { payroll_run_id: { is_null: true } },
			fields: ['employee_id', 'pay_group_id', 'period'],
			limit: 10000
		}
	});
	const slips = known.payslip ?? [];
	// a full page is one the read could not finish: the correction is too wide for one save
	if (slips.length >= REACH) return yield* Effect.fail(new Refusal({ message: TOO_WIDE }));
	const people = [...new Set(slips.map((slip) => String(slip.employee_id)))];
	return yield* carried(
		spans.flatMap((span) =>
			(span.employee === undefined ? people : [span.employee]).map((employee) => ({
				employee,
				from: span.from,
				to: span.to
			}))
		),
		windowsOf(
			slips,
			new Map(
				(known.pay_group ?? []).map((row) => [String(row.id), objectValue(row.payment_schedule)])
			)
		),
		known.pay_amendment ?? []
	);
});

/** Whether a paid run answers this filter. What paid periods were worked out on keeps its shape: a change is a new one. */
export const paidUnder = Effect.fn('payroll.paidUnder')(function* (
	read: Reader,
	where: JsonObject
) {
	const { payroll_run: runs = [] } = yield* queryRows(read, {
		payroll_run: { where: { ...where, state: { eq: 'PAID' } }, fields: ['run_number'], limit: 1 }
	});
	return runs.length > 0;
});

type Versioned = {
	readonly status?: string | undefined;
	readonly effective_range: { readonly from: string; readonly to: string | null };
};
/**
 * The days a write to a sealed, dated version reaches. A draft reaches nothing until it is sealed, and then all it
 * covers; a void takes back all it covered; a sealed version whose last day moves reaches the days that move.
 */
export const versionReach = (
	before: Versioned | undefined,
	after: Versioned
): readonly { readonly from: string; readonly to: string | null }[] => {
	if (before === undefined || before.status !== 'SEALED')
		return after.status === 'SEALED' ? [after.effective_range] : [];
	if (after.status === 'VOID') return [before.effective_range];
	const was = before.effective_range.to;
	const now = after.effective_range.to;
	if (was === now) return [];
	const earlier = was === null || (now !== null && now < was) ? now : was;
	if (earlier === null) return [];
	return [
		{
			from: String(add_days(earlier, 1)),
			to: was === null || now === null ? null : was < now ? now : was
		}
	];
};

/**
 * Every model a run reads, and what a write to it does when it reaches a paid period. A model the run starts to read
 * is added here with its rule, or the gate test fails: nothing reaches a paid period's inputs unseen.
 *
 * - `amends`: its write carries the amendment rows of the paid periods it touches.
 * - `refuses`: what paid periods were worked out on keeps its shape; a change is a new one.
 * - `sealed`: a row of a sealed law version. The version refuses its writes; a corrective version amends.
 * - `none`: read to know who is paid or what a balance holds, never to price a day.
 */
export const RUN_INPUTS = {
	roster_entry: 'amends',
	leave_catalog_entry: 'amends',
	claim_catalog_entry: 'amends',
	adhoc_catalog_entry: 'amends',
	loan_catalog_entry_repayment: 'amends',
	employee_contract: 'amends',
	holiday: 'amends',
	work_event: 'amends',
	entity_profile_version: 'amends',
	jurisdiction_settings: 'amends',
	pay_group: 'refuses',
	shift_definition: 'refuses',
	shift_pattern: 'refuses',
	subtotal: 'sealed',
	allowance_catalog: 'sealed',
	overtime_catalog: 'sealed',
	statutory_contribution_catalog: 'sealed',
	leave_catalog: 'sealed',
	claim_catalog: 'sealed',
	adhoc_catalog: 'sealed',
	loan_catalog: 'sealed',
	work_event_catalog: 'sealed',
	// the person: only how their service counts moves pay, and that amends every period they were paid for
	employee_profile: 'amends',
	// the running totals a payslip posts to: a run reads them, and postings move them. HR's manual row adjusts a
	// balance as it stands from its own date; it asks no paid period to be worked out again
	employee_balance: 'none',
	ledger_entry: 'none',
	// the loan itself: its instalments are what a run deducts, and they amend
	loan_catalog_entry: 'none',
	// sealed by the run that saw it open; it prices nothing
	workplace_case_catalog_entry: 'none',
	// a law change confirmed but not merged stops a run; it prices nothing
	statutory_change: 'none'
} as const;
