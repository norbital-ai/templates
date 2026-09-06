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

/** Every active employment of these companies, a page at a time. */
export const refreshCompaniesLeave = (
	api: LeaveApi,
	companyIds: ReadonlyArray<string>,
	asOf: string
): Effect.Effect<number> =>
	Effect.gen(function* () {
		let employments = 0;
		for (const companyId of companyIds) {
			let after: string | undefined;
			for (;;) {
				const page = yield* api.db.employments.findMany({
					where: {
						company_id: { eq: companyId },
						approval_id: { isNull: true },
						...(after == null ? {} : { id: { gt: after } })
					},
					columns: { id: true },
					orderBy: { id: 'asc' },
					limit: PAGE
				});
				if (page.length === 0) break;
				yield* refreshEmploymentsLeave(
					api,
					page.map((row) => row.id),
					asOf
				);
				employments += page.length;
				after = page[page.length - 1]?.id;
				if (page.length < PAGE) break;
			}
		}
		return employments;
	});

/** Every employment governed by one law family, for a newly sealed statutory profile. */
export const refreshLawFamilyLeave = (
	api: LeaveApi,
	code: string,
	asOf: string
): Effect.Effect<number> =>
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
		return yield* refreshCompaniesLeave(
			api,
			companies.map((row) => row.id),
			asOf
		);
	});
