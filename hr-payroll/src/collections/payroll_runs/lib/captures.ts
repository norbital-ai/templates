/**
 * Writing the links between a payslip and the entries it consumed.
 *
 * Authored entries are pinned (`payslip_id`); the per-period rows a standing source materialised
 * are created with the pin already set. Release is the database's: `payslip_id` is a real foreign
 * key with `ON DELETE SET NULL`, so a deleted draft clears every link without a hook write. An
 * orphaned materialised row is inert — reads exclude `derived_from_id` rows that carry no pin.
 */

import { Effect } from 'effect';
import type { PayslipCaptures } from './graph.js';

/** Minimal collection client the capture writers need; the runtime client satisfies it. */
type CollectionWriter = {
	readonly mutate: (
		values: ReadonlyArray<{ readonly id: string; readonly payslip_id: string | null }>
	) => Effect.Effect<void>;
};

export type CaptureApi = {
	readonly db: {
		readonly work_days: CollectionWriter;
		readonly claim_requests: CollectionWriter;
		readonly payment_requests: CollectionWriter;
		readonly allowance_requests: CollectionWriter;
		readonly leave_entries: CollectionWriter;
		readonly loan_repayments: CollectionWriter;
	};
};

/** One source family: pin what the run consumed. */
type CaptureFamily = {
	readonly pin: (captures: readonly PayslipCaptures[]) => Effect.Effect<void>;
};

export function captureWriters(api: CaptureApi): readonly CaptureFamily[] {
	// One write per family for the whole run, not one per payslip: a company of ninety pinned
	// 2,500 work days through ninety nested mutates, each running the collection's prepare hook
	// again, and that alone was most of the guest's compute budget.
	const pins =
		(collection: CollectionWriter, select: (capture: PayslipCaptures) => readonly string[]) =>
		(captures: readonly PayslipCaptures[]) => {
			const rows = captures.flatMap((capture) =>
				select(capture).map((id) => ({ id, payslip_id: capture.payslipId }))
			);
			return rows.length === 0 ? Effect.void : collection.mutate(rows);
		};
	return [
		{ pin: pins(api.db.work_days, (capture) => capture.workDays) },
		{ pin: pins(api.db.claim_requests, (capture) => capture.claims) },
		{ pin: pins(api.db.payment_requests, (capture) => capture.payments) },
		{ pin: pins(api.db.allowance_requests, (capture) => capture.allowances) },
		{ pin: pins(api.db.leave_entries, (capture) => capture.leave) },
		{ pin: pins(api.db.loan_repayments, (capture) => capture.loanRepayments) }
	];
}
