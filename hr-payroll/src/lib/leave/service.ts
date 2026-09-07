import { Clock, Effect } from 'effect';
import { calendarDateInTimeZone, dateKey, PAYROLL_TIME_ZONE } from '../iso-day.js';
import {
	applyLeavePlan,
	leavePlanner,
	readLeaveContext,
	withPending,
	type LeaveApi,
	type LeaveContext,
	type Row
} from './entitlements.js';
export type { LeaveApi } from './entitlements.js';
import { reconcileEmploymentLeave } from './reconcile.js';

/**
 * The leave-entitlement service: one arithmetic, two ways in.
 *
 * A fact that feeds the ledger (an employment, its terms, a child) carries the ledger in its own
 * write: the collection's `before` hook plans the employment from the batch's context and returns
 * the entitlements nested under it, as the workspace, so a kiosk enrolment lands the same ledger
 * an HR hire does. Time's passage is the reconciler automation's: on the first of each month it
 * walks every active employment with today's date, and a catalogue edit starts it for the
 * company. The seed ends by starting it, so a seeded workspace is complete the way a live one is.
 */

/** Employments read per query; a run's slice bounds the work, this bounds one read. */
const PAGE = 100;

/** Today in the payroll calendar: the automation's planning date. */
export const leaveAsOf = Effect.map(Clock.currentTimeMillis, (millis) =>
	calendarDateInTimeZone(new Date(millis), PAYROLL_TIME_ZONE)
);

/**
 * The date a write states its facts as of: the latest day among the dates it carries.
 *
 * A hook plans from this and never from the clock. A held graph is replayed through the same
 * hooks on resume and must reproduce the review byte for byte, so nothing a hook derives may
 * depend on the day it runs; what a fact opens is posted as of the fact's own date, and the
 * months that pass afterwards are the schedule's to post.
 */
const statedAsOf = (...dates: ReadonlyArray<unknown>): string =>
	dates
		.map((date) => (typeof date === 'string' ? dateKey(date) : ''))
		.filter((date) => date !== '')
		.toSorted()
		.at(-1) ?? '';

/**
 * One employment planned from a context: the complete set of its entitlements as the employment
 * nests them (each with its entries, under formula ids), or undefined when the arithmetic changes
 * nothing. The planning date is the latest the employment's own facts state, never the clock.
 */
export const planEmploymentLedger = (
	context: LeaveContext,
	employmentId: string,
	findPending: LeaveApi['db']['leave_requests']['findPending']
): Effect.Effect<ReadonlyArray<Record<string, unknown>> | undefined> =>
	Effect.gen(function* () {
		const employment = context.employments.find((row) => row.id === employmentId);
		if (employment == null) return undefined;
		const own = (collection: 'employment_terms' | 'employee_children') =>
			context[collection].filter((row) => row.employment_id === employmentId);
		const asOf = statedAsOf(
			employment.hire_date,
			employment.exit_date,
			...own('employment_terms').map(
				(row) => (row.effective_range as { start?: unknown } | null)?.start
			),
			...own('employee_children').map((row) => row.child_birthdate)
		);
		const planner = leavePlanner(context, findPending);
		yield* reconcileEmploymentLeave(planner.api, employmentId, asOf);
		return planner.changedEmploymentIds().length === 0
			? undefined
			: planner.nestedEntitlementsOf(employmentId);
	});

/** The slice of a hook's api a sibling fact needs to restate its employment. */
type RestateApi = Readonly<{
	readonly db: Readonly<{
		readonly employments: {
			mutate(rows: ReadonlyArray<Record<string, unknown>>): Effect.Effect<unknown>;
		};
		readonly leave_requests: {
			readonly findPending: LeaveApi['db']['leave_requests']['findPending'];
		};
	}>;
}>;

/**
 * A sibling fact (terms, a child) restates its employment with the ledger the fact implies, in
 * the fact's own commit (RFC 0003 §5.2). The fact is not stored yet, so it is overlaid on the
 * context the batch read; the employment root is written through `api.db.employments.mutate`,
 * which a `before` hook stages into the same graph as the workspace's own work, and the
 * employment's `before` keeps a ledger it is handed.
 */
export const restateEmploymentFor = (
	api: RestateApi,
	context: LeaveContext,
	collection: 'employment_terms' | 'employee_children',
	fact: Row
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const employmentId = fact.employment_id;
		if (typeof employmentId !== 'string') return;
		const nested = yield* planEmploymentLedger(
			withPending(context, collection, fact),
			employmentId,
			api.db.leave_requests.findPending
		);
		if (nested === undefined) return;
		yield* api.db.employments.mutate([{ id: employmentId, leave_entitlement_employment: nested }]);
	});

/** Runs the arithmetic for these employments and writes what changed. */
const refreshEmploymentsLeave = (
	api: LeaveApi,
	employmentIds: ReadonlyArray<string>,
	asOf: string
): Effect.Effect<{
	entitlements_created: number;
	entitlements_updated: number;
	entries_created: number;
}> =>
	Effect.gen(function* () {
		const ids = [...new Set(employmentIds)];
		if (ids.length === 0)
			return { entitlements_created: 0, entitlements_updated: 0, entries_created: 0 };
		const context = yield* readLeaveContext(api, ids, { asOf });
		const planner = leavePlanner(context, api.db.leave_requests.findPending);
		for (const id of ids) yield* reconcileEmploymentLeave(planner.api, id, asOf);
		yield* applyLeavePlan(api, planner);
		return planner.counts();
	});

/** Where a bounded run stopped: the company it was in and the last employment it wrote. */
type LeaveCursor = Readonly<{ readonly company_id: string; readonly after?: string }>;

/**
 * The active employments of these companies, at most `slice` of them, from `cursor` onward.
 *
 * One run of the reconciler is bounded — a direct start is cut at the host's dispatch deadline and
 * an employment costs a few hundred milliseconds — so a run works a slice and hands back where it
 * stopped; the automation continues from there as a deferred task. Companies are walked in id order
 * and employments within a company in id order, so the walk is complete and repeatable.
 */
export const refreshCompaniesLeave = (
	api: LeaveApi,
	companyIds: ReadonlyArray<string>,
	asOf: string,
	options: { readonly slice: number; readonly cursor?: LeaveCursor }
): Effect.Effect<{ readonly employments: number; readonly next?: LeaveCursor }> =>
	Effect.gen(function* () {
		const ordered = [...companyIds].sort();
		let employments = 0;
		let started = options.cursor === undefined;
		for (const companyId of ordered) {
			if (!started) {
				if (companyId !== options.cursor?.company_id) continue;
				started = true;
			}
			let after = companyId === options.cursor?.company_id ? options.cursor?.after : undefined;
			for (;;) {
				const room = options.slice - employments;
				if (room <= 0)
					return {
						employments,
						next: { company_id: companyId, ...(after == null ? {} : { after }) }
					};
				const page = yield* api.db.employments.findMany({
					where: {
						company_id: { eq: companyId },
						approval_id: { isNull: true },
						...(after == null ? {} : { id: { gt: after } })
					},
					columns: { id: true },
					orderBy: { id: 'asc' },
					limit: Math.min(room, PAGE)
				});
				if (page.length === 0) break;
				yield* refreshEmploymentsLeave(
					api,
					page.map((row) => row.id),
					asOf
				);
				employments += page.length;
				after = page[page.length - 1]?.id;
				if (page.length < Math.min(room, PAGE)) break;
			}
		}
		return { employments };
	});
