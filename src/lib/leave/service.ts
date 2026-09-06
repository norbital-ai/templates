import { Clock, Effect } from 'effect';
import { calendarDateInTimeZone, PAYROLL_TIME_ZONE } from '../iso-day.js';
import { applyLeavePlan, leavePlanner, readLeaveContext, type LeaveApi } from './entitlements.js';
export type { LeaveApi } from './entitlements.js';
import { reconcileEmploymentLeave } from './reconcile.js';

/**
 * The leave-entitlement service: one arithmetic, called whenever a fact that feeds it commits.
 *
 * Every call site hands it the employments concerned and today's date; it reads their context once,
 * runs the arithmetic in memory, and writes each changed employment as one nested graph under
 * formula ids. Call sites: the after hooks of employments, terms, children, leave requests, event
 * accounts and sealed statutory profiles (elevated, so a kiosk or an employee never needs to read
 * the plans and laws themselves), and the monthly refresh automation. The seed ends by starting that
 * automation, so a seeded workspace is complete the way a live one is.
 */

/** Employments read per query; a run's slice bounds the work, this bounds one read. */
const PAGE = 100;

/** Today in the payroll calendar. */
export const leaveAsOf = Effect.map(Clock.currentTimeMillis, (millis) =>
	calendarDateInTimeZone(new Date(millis), PAYROLL_TIME_ZONE)
);

/** Runs the arithmetic for these employments and writes what changed. */
export const refreshEmploymentsLeave = (
	api: LeaveApi,
	employmentIds: ReadonlyArray<string>,
	asOf: string
): Effect.Effect<{ accounts_created: number; accounts_updated: number; entries_created: number }> =>
	Effect.gen(function* () {
		const ids = [...new Set(employmentIds)];
		if (ids.length === 0) return { accounts_created: 0, accounts_updated: 0, entries_created: 0 };
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

/** Every employment governed by one law family, for a newly sealed statutory profile. */
export const lawFamilyCompanies = (api: LeaveApi, code: string): Effect.Effect<string[]> =>
	Effect.gen(function* () {
		const family = yield* api.db.jurisdictions.findMany({
			where: { code: { eq: code }, approval_id: { isNull: true } },
			columns: { id: true },
			limit: 1_000
		});
		const companies = yield* api.db.companies.findMany({
			where: {
				jurisdiction_id: { in: family.map((row) => row.id) },
				approval_id: { isNull: true }
			},
			columns: { id: true },
			limit: 1_000
		});
		return companies.map((row) => row.id);
	});
