/**
 * What a leave request page shows before it writes, counted as the leave write counts it: the balances of the classes
 * in force on a day, what a time-off range charges, and the preview of a range against the balance. Each is the
 * engine's own read (as the viewer) and planner, run on the page through `pageRead(bolt.query)`.
 */
import { Effect, Predicate } from 'effect';
import type { Id } from '@norbital-ai/bolt';
import type { PageBolt } from '@norbital-ai/bolt/page';
import { type Read, Refusal, runEngine } from './payroll_engine/foundation.js';
import { leaveState } from './payroll_engine/payslip/context.js';
import { leaveBalances, previewLeave } from './payroll_engine/leave.js';
import { requestDays, type RequestDaysInput } from './payroll_engine/leave_days.js';

const refuse = (message: string) => Effect.fail(new Refusal({ message }));

/** The page's `bolt.query` as the engine's reader: a lost connection is a defect the page's failure handling shows. */
export const pageRead =
	(query: PageBolt['query']): Read =>
	(request) =>
		query(request).pipe(Effect.catchTag('TransportFailed', (failure) => Effect.die(failure)));

/** Every leave class the employee is offered on `asOf`: its entitlement, committed days taken and availability. */
export const leaveBalancesOn = (
	read: Read,
	employment_id: Id<'employment_contract'>,
	asOf: string
) =>
	runEngine(leaveState(employment_id, asOf), read, refuse).pipe(
		Effect.map((state) => leaveBalances({ ...state, offeredOnly: true }))
	);

/** What a time-off range charges, in the class's unit, with the days that charge nothing. */
export const leaveDays = (read: Read, request: RequestDaysInput) =>
	requestDays(request, read).pipe(
		Effect.flatMap((charge) =>
			Predicate.isString(charge) ? refuse(charge) : Effect.succeed(charge)
		)
	);

/** The range against the balance on `asOf`: the units it charges, the days remaining after it and the span it covers. */
export const previewLeaveOn = (read: Read, request: RequestDaysInput, asOf: string) =>
	Effect.gen(function* () {
		const charge = yield* leaveDays(read, request);
		const state = yield* runEngine(leaveState(request.employment_id, asOf), read, refuse);
		const preview = previewLeave({
			...state,
			catalog_id: request.catalog_id,
			days: charge.days,
			from: request.from,
			to: request.to
		});
		if (preview == null) return yield* refuse('Choose the entry’s class.');
		return { ...preview, unit: charge.unit };
	});
