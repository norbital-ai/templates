import { Effect } from 'effect';
import { refuse } from '@norbital-ai/bolt/authoring';
import { dateKey } from '../../lib/iso-day.js';
import { loanScheduleRefusals } from '../../lib/loan-schedule.js';
import { refuseIfCaptured } from '../../lib/scheduling/lock.js';
import type { Hooks } from './$types.js';
import { decodeNumber } from '@norbital-ai/std/json';

const QUERY_LIMIT = 10_000;

/**
 * One amount due under a loan, and the honesty the schedule's shape asks of it.
 *
 * A repayment may legitimately feed several payslips — net-pay protection can part-recover it — so
 * unlike a one-off entry, no junction row makes a repayment immutable. What the junction's restrict
 * edge protects is its HISTORY: a captured repayment cannot be deleted, and the engine's ceiling
 * keeps paid recovery across every payslip inside the amount due. Editing the row a payroll
 * consumed would rewrite money already taken, so a capture refuses edits exactly as it does for the
 * other three families.
 *
 * `perRecord.before` holds what a single row can state about itself. The schedule's cross-row
 * shape — the three invariants `loanScheduleRefusals` states — is held by `prepare`, because no
 * per-record hook can see a schedule: it is handed one row, and the sum, the date order and the
 * last instalment's date are all properties of the set.
 */
export default {
	mutate: {
		/**
		 * The schedule's three invariants, over the whole write.
		 *
		 * `prepare` is where this has to live, and it is deliberately more than reads: it is the only
		 * hook coordinate handed the batch, and a schedule is a batch-shaped fact — a per-record hook
		 * is given one row and the sum, the date order and the last instalment's date are all
		 * properties of the set. The judgement itself is `loanScheduleRefusals`, the same function
		 * the loans form blocks submit with; a form and a hook each carrying their own arithmetic
		 * would be two workspaces.
		 *
		 * It runs in two parts, because the two see different amounts of the truth.
		 *
		 * **The order rule runs on every write.** The rows in the batch are rows the schedule will
		 * hold whatever else the write does, so their days have to climb, and nothing outside the
		 * batch is needed to say so.
		 *
		 * **The sum and the effective period are judged only for a write that states its
		 * `loan_id`** — which is every create (`loan_id` is `notNull`, and only a nested write gets
		 * it for free) and every update, import or agent call that names the loan it is writing to.
		 * The batch is merged over that loan's stored repayments first, so a partial write is judged
		 * against the whole schedule it would leave.
		 *
		 * **A write nested under the loan states no `loan_id`, and those two cannot be judged for
		 * it.** The engine strips the ownership column from a child payload and injects the parent's
		 * id after both hooks have run, and the loan in the same graph carries the very principal and
		 * period the schedule would be judged against — still unwritten, so a read here returns the
		 * old one. Both halves of that were measured against a running host, not assumed: judging a
		 * nested write refused a loan whose principal rose from 1200 to 1500 with the schedule that
		 * matches the new one, and refused a schedule that dropped a line, because the dropped row is
		 * deleted by a relationship reconciliation this hook is never shown. Refusing the two edits
		 * this collection exists to permit is worse than leaving them to the form, which blocks
		 * submit with this same function.
		 *
		 * The residue, stated plainly: an update that neither names its loan nor is nested — a patch
		 * of `{ id, amount_due }` — gets the order rule and not the other two, because it cannot be
		 * told apart from a nested one. Naming the loan in the patch is all it takes.
		 */
		prepare: ({ inputs, api }) =>
			Effect.gen(function* () {
				// A patch is judged as the row it would produce, never as the columns it carries — the
				// same overlay `perRecord.before` builds its candidate from, one write earlier.
				const named = inputs.flatMap((input) => (typeof input.id === 'string' ? [input.id] : []));
				const priors = named.length
					? yield* api.db.loan_repayments.findMany({
							where: { id: { in: named } },
							columns: {
								id: true,
								loan_id: true,
								due_date: true,
								amount_due: true,
								sequence: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				const priorById = new Map(priors.map((row) => [row.id, row]));
				const candidates = inputs.map((input) => {
					const prior = typeof input.id === 'string' ? priorById.get(input.id) : undefined;
					return {
						id: typeof input.id === 'string' ? input.id : null,
						// Only what the caller itself said. A nested child is never told its loan.
						loanId: input.loan_id == null ? null : String(input.loan_id),
						row: prior === undefined ? { ...input } : { ...prior, ...input }
					};
				});

				// The order rule, over the batch alone, on every path. Whatever else the batch is, the
				// rows in it are rows the schedule will hold, and their days have to climb.
				const disordered = loanScheduleRefusals({ rows: candidates.map(({ row }) => row) });
				if (disordered.length > 0) refuse(disordered.map((refusal) => refusal.message).join(' '));

				/**
				 * The loans this write touches — the ones it names, and the ones it moves rows *out
				 * of*.
				 *
				 * A repayment that changes `loan_id` leaves two schedules behind, and only one of
				 * them is the one the caller named. Judging the target alone would let a caller
				 * balance the loan they were thinking about while quietly unbalancing the one they
				 * were not. The source is knowable for exactly the writes the sum rule applies to at
				 * all: the prior row was read above, and it carries the loan the row is leaving.
				 */
				const loanIds = [
					...new Set(
						candidates.flatMap(({ id, loanId }) => {
							if (loanId == null) return [];
							const from = id == null ? undefined : priorById.get(id)?.loan_id;
							return from == null || from === loanId ? [loanId] : [loanId, from];
						})
					)
				];
				if (loanIds.length === 0) return;
				const loans = yield* api.db.loans.findMany({
					where: { id: { in: loanIds } },
					columns: { id: true, principal: true, effective_range: true },
					limit: QUERY_LIMIT
				});
				const stored = loans.length
					? yield* api.db.loan_repayments.findMany({
							where: { loan_id: { in: loans.map((loan) => loan.id) } },
							columns: {
								id: true,
								loan_id: true,
								due_date: true,
								amount_due: true,
								sequence: true
							},
							limit: QUERY_LIMIT
						})
					: [];
				const rewritten = new Set(candidates.flatMap(({ id }) => (id == null ? [] : [id])));
				for (const loan of loans) {
					const schedule = [
						...stored.filter((row) => row.loan_id === loan.id && !rewritten.has(row.id)),
						...candidates.filter((one) => one.loanId === loan.id).map(({ row }) => row)
					];
					const refusals = loanScheduleRefusals({
						principal: loan.principal,
						effectiveRange: loan.effective_range,
						rows: schedule
					});
					// Every issue at once. An importer that has to resubmit three times to be told
					// three things is an importer that gives up on the second.
					if (refusals.length > 0) refuse(refusals.map((refusal) => refusal.message).join(' '));
				}
			}),
		perRecord: {
			before: {
				description:
					'Refuses a repayment whose amount is not a positive magnitude, whose sequence is not a whole number of one or more, whose due date is missing, any change to a repayment a payroll run has already captured, and any write naming its loan that would leave that loan a schedule not summing to the principal, with due dates that do not strictly increase along the sequence, or with a last repayment outside the agreement’s effective period.',
				handler: ({ input, existing, api }) => {
					const candidate = existing === undefined ? { ...input } : { ...existing, ...input };
					const amountDue = decodeNumber(candidate.amount_due);
					if (!(amountDue > 0))
						refuse(
							"A repayment amount due is a positive magnitude; part-recovery is the engine's business, never a smaller row."
						);
					const sequence = decodeNumber(candidate.sequence);
					if (!Number.isInteger(sequence) || sequence < 1)
						refuse('A repayment sequence is a positive whole number.');
					const due = dateKey(candidate.due_date);
					if (due == null || due === '') refuse('A repayment must state the day it comes due.');
					// Only an edit can disturb a capture: a create has no prior run that consumed it.
					if (existing === undefined) return input;
					return Effect.as(
						refuseIfCaptured({
							capture: api.db.payslip_loan_repayment_inputs.findFirst({
								where: { loan_repayment_id: { eq: existing.id } },
								columns: { period: true }
							}),
							approvalId: null,
							action: 'Changing this repayment'
						}),
						input
					);
				}
			}
		}
	},
	delete: {
		perRecord: {
			before: {
				description:
					'Refuses deleting a repayment a payroll run has captured. A recovered repayment is money history.',
				handler: ({ existing, api }) =>
					refuseIfCaptured({
						capture: api.db.payslip_loan_repayment_inputs.findFirst({
							where: { loan_repayment_id: { eq: existing.id } },
							columns: { period: true }
						}),
						approvalId: null,
						action: 'Deleting this repayment'
					})
			}
		}
	}
} satisfies Hooks;
