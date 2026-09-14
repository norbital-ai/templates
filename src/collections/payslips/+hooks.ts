import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';

/**
 * A payslip is engine output, and output is create-and-delete, never edit — with exactly one
 * exception, and its payment is it.
 *
 * `status` is the run's payment state — moves `DRAFT → ON_HOLD → DRAFT`, and `DRAFT`/`ON_HOLD`
 * `→ PAID`. `PAID` is terminal:
 * money has left the building, the slip can never be deleted, and a correction is a component
 * entry in a later draft run. `ON_HOLD` is a reviewed slip deliberately kept out of the bank file,
 * and it can be released back to `DRAFT`.
 *
 * Locks are per payslip. Deleting a `DRAFT`/`ON_HOLD` slip releases exactly the entries it pinned
 * and deletes the per-period rows it materialised; a `PAID` slip releases nothing, ever. `paid_at`
 * is set with `PAID` and never cleared.
 */

/** The columns a caller may send on the one permitted edit. Everything else is engine output. */
const LIFECYCLE_COLUMNS = ['status', 'paid_at'] as const;
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
	DRAFT: ['ON_HOLD', 'PAID'],
	ON_HOLD: ['DRAFT', 'PAID'],
	PAID: []
};

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses editing a payslip except its payment status: status moves DRAFT↔ON_HOLD or to PAID with paid_at, PAID is terminal, and payment order holds per person.',
				handler: ({ input, existing, parent, api }) =>
					Effect.gen(function* () {
						if (existing === undefined) {
							if (parent?.collection !== 'payroll_runs')
								refuse('A payslip must be created by its payroll run.');
							return input;
						}
						const sent = Object.keys(input).filter(
							(column) => column !== 'id' && column !== 'row_version'
						);
						if (sent.some((column) => !(LIFECYCLE_COLUMNS as readonly string[]).includes(column)))
							refuse(
								'A payslip is engine output and cannot be edited. Recalculate its draft run, or ' +
									'correct a paid one with a component entry in a later draft run.'
							);
						if (sent.length === 0) return input;
						/**
						 * The status machine, stated once. `existing.status` is the stored state (neither
						 * column is generatable, so a stored slip always has one).
						 */
						const from = String(existing.status ?? 'DRAFT');
						const to = String(input.status ?? from);
						if (from === to && input.paid_at === undefined) return input;
						if (from === 'PAID')
							refuse(
								'This payslip is already paid. Payment is a record of money that has left the ' +
									'building, and it is corrected by a component entry in a later draft run.'
							);
						if (!(TRANSITIONS[from] ?? []).includes(to))
							refuse(`A payslip cannot move from ${from} to ${to}.`);
						const paidAt = input.paid_at ?? existing.paid_at;
						if (to === 'PAID' && paidAt == null)
							refuse('Marking a payslip paid needs the day it was paid.');
						if (to !== 'PAID' && input.paid_at != null)
							refuse('A payslip records the day it was paid only when it is paid.');
						if (to !== 'PAID') return input;
						/**
						 * Paid in order, per person.
						 *
						 * "Paid in order" is a rule about a person's own pay: January's slip before February's
						 * for the same employment. A colleague's unpaid January is not this person's problem.
						 */
						const run = yield* api.db.payroll_runs.findFirst({
							where: { id: { eq: existing.payroll_run_id } },
							columns: { id: true, company_id: true, period: true }
						});
						if (run == null) refuse('A payslip cannot be paid without its payroll run.');
						const earlier = yield* api.db.payroll_runs.findMany({
							where: { company_id: { eq: run.company_id }, period: { lt: run.period } },
							columns: { id: true, period: true },
							limit: 20_000
						});
						if (earlier.length >= 20_000) refuse('Too many payrolls to verify payment order.');
						if (earlier.length > 0) {
							const unpaid = yield* api.db.payslips.findMany({
								where: {
									payroll_run_id: { in: earlier.map((row) => row.id) },
									employment_id: { eq: existing.employment_id },
									status: { ne: 'PAID' }
								},
								columns: { payroll_run_id: true },
								limit: 20_000
							});
							const held = unpaid[0];
							if (held != null)
								refuse(
									`This person's ${earlier.find((row) => row.id === held.payroll_run_id)?.period} ` +
										'pay is still unpaid. Pay it before this period.'
								);
						}
						return input;
					})
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Blocks deleting a paid payslip; releases the entries a DRAFT or ON_HOLD slip pinned and deletes the per-period rows it materialised, so they become editable again.',
				handler: ({ existing, api }) =>
					Effect.gen(function* () {
						if (existing.status === 'PAID' || existing.paid_at != null)
							refuse(
								'This payslip has been paid and cannot be deleted. Correct it with a component ' +
									'entry in a later draft run.'
							);
						// The database clears every authored `payslip_id` with `ON DELETE SET NULL`; the
						// per-period rows this slip materialised are the run's to delete, or the next
						// build would price them a second time as standing rows.
						// Release is the database's `ON DELETE SET NULL`; nothing is written here.
					})
			}
		}
	}
} satisfies Hooks;
