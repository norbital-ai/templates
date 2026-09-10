import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import type { Hooks } from './$types.js';
import { promoteRunIfFullyPaid } from '../payroll_runs/lib/paid.js';

/**
 * A payslip is engine output, and output is create-and-delete, never edit — with exactly one
 * exception, and `paid_at` is it.
 *
 * The engine builds a run inside `payroll_runs` hooks and returns it as one declarative payload; a
 * recalculation deletes the previous build's rows and creates new ones in the same statement, so no
 * legitimate write path ever patches a stored figure. No policy grants `mutate.existing` on this
 * collection for anything else, and this hook is the second lock: a mis-granted direct write still
 * refuses here, because a settled figure that can be quietly edited is not a settled figure.
 *
 * Paying is not a recalculation. Nothing about the figures changes when somebody is paid, so the
 * fact is recorded on the slip rather than on the run, and it is the one column that may move —
 * once, from null, and never back. That is the same shape the run's own mark-paid transition has:
 * a closed record with exactly one door.
 *
 * Deletion follows the money rather than the run's summary: a slip that has been paid can never be
 * deleted, whatever state its run reports.
 */

/** The columns a caller may send on the one permitted edit. Everything else is engine output. */
const PAYABLE_COLUMN = 'paid_at';

export default {
	mutate: {
		perRecord: {
			before: {
				description:
					'Refuses editing a payslip except to record that it was paid: paid_at moves once, from empty, and never back. Every other column is engine output, created and replaced by the payroll engine only; a correction is a component entry in a later draft run.',
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
						if (sent.some((column) => column !== PAYABLE_COLUMN))
							refuse(
								'A payslip is engine output and cannot be edited. Recalculate its draft run, or ' +
									'correct a paid one with a component entry in a later draft run.'
							);
						if (sent.length === 0) return input;
						if (existing.paid_at != null)
							refuse(
								'This payslip is already paid. Payment is a record of money that has left the ' +
									'building, and it is corrected by a component entry in a later draft run.'
							);
						if (input.paid_at == null) refuse('Recording payment needs the day it was paid.');
						/**
						 * Paid in order, per person.
						 *
						 * "Paid in order" used to be a rule about runs, because a run was the unit of
						 * payment. It is a rule about a person's own pay: January's slip before February's
						 * for the same employment. A colleague's unpaid January is no longer this person's
						 * problem, which is the whole point of moving payment down here.
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
									paid_at: { isNull: true }
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
			},
			after: {
				description:
					'Moves the payslip’s run to PAID once every slip it holds has been paid, and back to DRAFT while any has not, so the run’s lifecycle stays a reading of its slips rather than a second fact.',
				handler: ({ record, api }): Effect.Effect<void> =>
					promoteRunIfFullyPaid(api, record.payroll_run_id)
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Blocks deleting a payslip once it has been paid, so what was paid to a person stays on the record and is corrected by an entry in a later run.',
				handler: ({ existing }) => {
					if (existing.paid_at != null)
						refuse(
							'This payslip has been paid and cannot be deleted. Correct it with a component ' +
								'entry in a later draft run.'
						);
				}
			}
		}
	}
} satisfies Hooks;
