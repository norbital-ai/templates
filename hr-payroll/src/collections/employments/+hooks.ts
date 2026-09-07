import { Effect } from 'effect';
import type { Hooks } from './$types.js';
import { planEmploymentLedger } from '../../lib/leave/service.js';
import { readLeaveContext, withPending, type LeaveContext } from '../../lib/leave/entitlements.js';

/**
 * An employment carries its leave entitlements.
 *
 * `prepare` reads the batch's leave context once: the catalogue by company for creates, the
 * stored employment with its terms, children, requests and ledger for updates. `before` overlays
 * the row being written, runs the arithmetic for it and returns it with the complete set of its
 * entitlements and their entries nested under it, under formula ids. The hook reads and derives
 * as the workspace, so a kiosk enrolment lands the same ledger an HR hire does and the kiosk
 * holds no grant on anything the ledger is made of.
 *
 * The employment is planned as of the latest date its facts state: the hire date, an exit, the
 * start of a set of terms, a child's birth. Nothing here reads the clock, so a held graph replays
 * identically on resume; the months that pass afterwards, year closes and exits are the monthly
 * reconciler's, which touches each employment as itself with today's date.
 *
 * A write that already carries `leave_entitlement_employment` keeps it: the reconciler's monthly
 * walk and the `before` hooks of terms and children state the ledger themselves and write the
 * employment through the same door. The edge is not a cascade, so an omitted sibling is refused,
 * never deleted; what is returned here is always the whole set.
 */

/** The columns the arithmetic reads; an edit that touches none of them leaves the ledger alone. */
const LEDGER_COLUMNS = ['hire_date', 'exit_date', 'exit_reason', 'company_id', 'employee_id'];

/** A write of the row as itself: the id, and nothing the person changed. */
const isBareTouch = (input: Readonly<Record<string, unknown>>): boolean =>
	Object.keys(input).every((column) => column === 'id' || column === 'row_version');

type Prepared = { readonly context: LeaveContext };

export default {
	mutate: {
		prepare: ({ inputs, api }): Effect.Effect<Prepared> =>
			Effect.gen(function* () {
				const context = yield* readLeaveContext(
					api,
					inputs.flatMap((one) => (one.id == null ? [] : [one.id])),
					{
						companyIds: inputs.flatMap((one) => (one.company_id == null ? [] : [one.company_id])),
						employeeIds: inputs.flatMap((one) => (one.employee_id == null ? [] : [one.employee_id]))
					}
				);
				return { context };
			}),
		perRecord: {
			before: {
				description:
					"Returns the employment with the complete set of its leave entitlements and ledger lines, generated from the company's catalogue as of the latest date the employment's facts state.",
				handler: ({ input, existing, recordId, relationships, prepared, api }) =>
					Effect.gen(function* () {
						// A sibling fact's hook or the reconciler already stated the ledger; keep it.
						if (relationships.includes('leave_entitlement_employment')) return input;
						if (
							existing != null &&
							!isBareTouch(input) &&
							!LEDGER_COLUMNS.some((column) => column in input)
						)
							return input;
						const employment: Record<string, unknown> & { id: string } = {
							...existing,
							...input,
							id: recordId,
							approval_id: null
						};
						let context = withPending(prepared.context, 'employments', employment);
						// Nested under a person created in the same write (a kiosk enrolment), the
						// employment has no stored employee and receives the parent key after this hook.
						// The arithmetic then sees the catalogue's empty person, the same person the
						// stored row shows until HR states a gender or a birth date.
						const employeeId = employment.employee_id;
						if (
							typeof employeeId !== 'string' ||
							!context.employees.some((row) => row.id === employeeId)
						) {
							const pendingId = typeof employeeId === 'string' ? employeeId : `pending:${recordId}`;
							employment.employee_id = pendingId;
							context = withPending(context, 'employees', { id: pendingId });
						}
						const nested = yield* planEmploymentLedger(
							context,
							recordId,
							api.db.leave_requests.findPending
						);
						if (nested === undefined) return input;
						return {
							...input,
							// The planner's rows are the collection's insert shape under formula ids; the
							// runtime decodes them against it and fails loud on a column it does not know.
							leave_entitlement_employment: nested as never
						};
					})
			}
		}
	}
} satisfies Hooks<Prepared>;
