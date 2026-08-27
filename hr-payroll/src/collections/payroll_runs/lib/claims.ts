/**
 * Which source records a run consumed — the settlement lock's input side.
 *
 * A `payslip_sources` row says which attendance or leave record a payslip took into account. Its
 * source is a database-enforced polymorphic reference, and this is the only place that decides which
 * measured records deserve those links.
 *
 * Component entries, pay components and repayment agreements are **not** derived here: the run knows
 * exactly which ones it consumed, because each produced a `payslip_lines` row naming it — so those
 * claims are read off the persisted lines in `persist.ts` rather than guessed from a date range.
 *
 * See `src/collections/payslip_sources/+model.ts` for what the lock is, and
 * `src/lib/policy_grants.ts` for why it is not `approval_id`.
 */

import { dateKey, type IsoDate } from './dates.js';
import type { EmploymentBundle } from './gather.js';
import type { CollectionMutationValues } from '@norbital-ai/bolt/authoring';
import type { WorkspaceSchema } from '$bolt/types.js';

/** The exact handle inferred from `payslip_sources.source`; no parallel union is maintained here. */
export type SettlementClaim = Extract<
	CollectionMutationValues<WorkspaceSchema, 'payslip_sources'>,
	{ readonly source: unknown }
>['source'];

/** Deduplicate by logical reference identity, preserving the order claims were derived in. */
export function dedupeClaims(claims: readonly SettlementClaim[]): SettlementClaim[] {
	const seen = new Set<string>();
	const unique: SettlementClaim[] = [];
	for (const claim of claims) {
		const key = `${claim.kind}:${claim.id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(claim);
	}
	return unique;
}

/**
 * The span this employment's figures were measured over.
 *
 * The union of the attendance window and the wage window, because they genuinely differ and both
 * are consumed. Attendance prices the days worked; the wage window is what recurring salary and
 * recurring allowances cover, and for a leaver settling in their final period it runs to the exit
 * date rather than to the end of the month. A record dated inside either one was available to
 * MEASURE and must not move underneath the figures it produced.
 */
function measuredSpan(bundle: EmploymentBundle): { start: IsoDate; end: IsoDate } {
	const wage = bundle.wageDays;
	if (wage == null) return bundle.attendance;
	return {
		start: wage.start < bundle.attendance.start ? wage.start : bundle.attendance.start,
		end: wage.end > bundle.attendance.end ? wage.end : bundle.attendance.end
	};
}

function within(span: { start: IsoDate; end: IsoDate }, value: string | null): boolean {
	const key = dateKey(value);
	return key != null && key >= span.start && key <= span.end;
}

/**
 * Every time entry and leave movement this bundle's payslip consumed.
 *
 * Component entries, pay components and repayment agreements are **not** derived here, and the
 * asymmetry is deliberate. The run knows exactly which ones it consumed, because each produced a
 * `payslip_lines` row naming it — so those claims are read off the persisted lines in `persist.ts`
 * rather than guessed from a date range. Time entries and leave movements leave no such trace: an
 * overtime line names its statutory band, never the clock records it was priced from. For those two
 * the measured span is the best statement of consumption available, and it is a *correct*
 * statement — everything inside it was read, and MEASURE is deterministic over what it read.
 *
 * `bundle.timeEntries` is filtered rather than taken whole. GATHER deliberately reads a wider band
 * than the run prices — both calendar months touched by the cutoff — so the monthly statutory
 * overtime counter can reset correctly. Those extra days belong to a neighbouring period and
 * locking them would freeze attendance a future run has not settled yet.
 */
export function claimsForBundle(bundle: EmploymentBundle): SettlementClaim[] {
	// A deferred joining period writes no payslip: its money becomes an arrears entry that the *next*
	// run prices. Nothing was consumed, so nothing is claimed — locking here would freeze the very
	// attendance the next run has to read.
	if (bundle.deferral != null) return [];

	const span = measuredSpan(bundle);
	const claims: SettlementClaim[] = [];
	for (const entry of bundle.timeEntries) {
		if (!within(span, entry.work_date)) continue;
		claims.push({ kind: 'TIME_ENTRY', id: entry.id });
	}
	for (const movement of bundle.ledger) {
		if (!within(span, movement.entry_date)) continue;
		claims.push({ kind: 'LEAVE_REQUEST', id: movement.id });
	}
	return dedupeClaims(claims);
}
