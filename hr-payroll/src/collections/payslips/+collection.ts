import { Effect } from 'effect';
import { defineCollection, refuse } from '@norbital-ai/bolt/authoring';
import { decodeNumber } from '@norbital-ai/std/json';
import { dateKey } from '../../lib/iso-day.js';
import { cents } from '../payroll_runs/lib/rounding.js';
import model from './+model.js';

/**
 * Calculated payslip amounts are immutable. Payment state and funding receipts are operational
 * records; they remain editable until settlement.
 *
 * `status` is the run's payment state — moves `DRAFT → ON_HOLD → DRAFT`, and `DRAFT`/`ON_HOLD`
 * `→ PAID`. `PAID` is terminal: money has left the building, the slip can never be deleted, and a
 * correction is a component entry in a later draft run. `ON_HOLD` is a reviewed slip deliberately
 * kept out of the bank file, and it can be released back to `DRAFT`.
 *
 * There is no `create`: a payslip is born under its payroll run, in the run's own payload. Locks
 * are per payslip. Deleting a `DRAFT`/`ON_HOLD` slip releases exactly the entries it pinned
 * through the database's `ON DELETE SET NULL`; a `PAID` slip is never deleted, which the delete
 * grant (`payrollRunCascadeGrants`) holds. `paid_at` is set with `PAID` and never cleared.
 */
const TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
	DRAFT: ['ON_HOLD', 'PAID'],
	ON_HOLD: ['DRAFT', 'PAID'],
	PAID: []
};

export default defineCollection({
	model,
	update: {
		input: {
			columns: {
				status: true,
				paid_at: true,
				funding_received: true,
				funding_received_on: true,
				funding_reference: true
			}
		}
	},
	delete: {},
	transform: (inputs, { existing, db }) =>
		Effect.gen(function* () {
			const paying = inputs.flatMap((input, index) => {
				const stored = existing[index];
				return stored != null && input.status === 'PAID' && stored.status !== 'PAID'
					? [stored]
					: [];
			});
			// One wave: the runs being paid under, and every unpaid slip of the people being paid,
			// with its run — "paid in order" is a rule about a person's own pay.
			const [runs, unpaid] = yield* Effect.all(
				[
					paying.length === 0
						? Effect.succeed([])
						: db.payroll_runs.findMany({
								where: { id: { in: [...new Set(paying.map((slip) => slip.payroll_run_id))] } },
								columns: { id: true, company_id: true, period: true },
								limit: paying.length
							}),
					paying.length === 0
						? Effect.succeed([])
						: db.payslips.findMany({
								where: {
									employment_id: { in: [...new Set(paying.map((slip) => slip.employment_id))] },
									status: { ne: 'PAID' }
								},
								columns: { id: true, employment_id: true, payroll_run_id: true },
								with: { payslip_payroll_run: { columns: { company_id: true, period: true } } },
								limit: 20_000
							})
				],
				{ concurrency: 'unbounded' }
			);
			if (unpaid.length >= 20_000) refuse('Too many payslips to verify payment order.');
			const runById = new Map(runs.map((run) => [run.id, run]));
			return inputs.map((input, index) => {
				const stored = existing[index];
				if (stored === undefined) refuse('A payslip must be created by its payroll run.');
				const from = String(stored.status ?? 'DRAFT');
				const to = String(input.status ?? from);
				const fundingChanged =
					input.funding_received !== undefined ||
					input.funding_received_on !== undefined ||
					input.funding_reference !== undefined;
				const funding = decodeNumber(input.funding_received ?? stored.funding_received ?? 0);
				const unfunded = decodeNumber(stored.unfunded_contributions ?? 0);
				const fundingDate =
					input.funding_received_on === undefined
						? stored.funding_received_on
						: input.funding_received_on;
				const fundingReference =
					input.funding_reference === undefined
						? stored.funding_reference
						: input.funding_reference;
				if (!Number.isFinite(funding) || funding < 0 || funding > unfunded)
					refuse('Funding received must be between zero and the unfunded contribution amount.');
				if (cents(funding, stored.currency) !== funding)
					refuse('Funding received must use the payslip currency precision.');
				if (funding > 0 && (fundingDate == null || !fundingReference?.trim()))
					refuse('Funding received requires its receipt date and reference.');
				if (from === to && input.paid_at === undefined && !fundingChanged) return input;
				if (from === 'PAID')
					refuse('This payslip is already paid. Record corrections in a later draft run.');
				if (from !== to && !(TRANSITIONS[from] ?? []).includes(to))
					refuse(`A payslip cannot move from ${from} to ${to}.`);
				const paidAt = input.paid_at ?? stored.paid_at;
				if (to === 'PAID' && paidAt == null)
					refuse('Marking a payslip paid needs the day it was paid.');
				if (to !== 'PAID' && input.paid_at != null)
					refuse('A payslip records the day it was paid only when it is paid.');
				if (to !== 'PAID') return input;
				if (funding < unfunded)
					refuse(
						'Employee statutory contributions remain unfunded. Record the funds received before settling this payslip.'
					);
				if (funding > 0 && dateKey(fundingDate!) > dateKey(paidAt!))
					refuse('The settlement date cannot precede the contribution funding receipt.');
				const run = runById.get(stored.payroll_run_id);
				if (run == null) refuse('A payslip cannot be paid without its payroll run.');
				// Paid in order, per person: January's slip before February's for the same
				// employment. A colleague's unpaid January is not this person's problem.
				const held = unpaid.find(
					(slip) =>
						slip.employment_id === stored.employment_id &&
						slip.id !== stored.id &&
						slip.payslip_payroll_run?.company_id === run.company_id &&
						slip.payslip_payroll_run.period < run.period
				);
				if (held != null)
					refuse(
						`This person's ${held.payslip_payroll_run?.period} pay is still unpaid. Pay it before this period.`
					);
				return input;
			});
		})
});
