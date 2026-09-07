import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { dateKey } from '../iso-day.js';

type LeaveEntitlementRow = Pick<WorkspaceRow<'leave_entitlements'>, 'entitlement_days'>;
type LeaveEntryRow = Pick<WorkspaceRow<'leave_entries'>, 'kind' | 'days' | 'effective_on'> & {
	readonly approval_id?: string | null;
};

type LeaveBalanceSummary = {
	readonly entitlement: number;
	readonly earned: number;
	readonly carried: number;
	readonly adjusted: number;
	readonly taken: number;
	readonly pending: number;
	readonly encashed: number;
	readonly expired: number;
	readonly balance: number;
	readonly available: number;
};

/** The lines that award days: what the reconciler compares a catalogue target against. */
const AWARD_KINDS = new Set(['OPENING_ENTITLEMENT', 'ACCRUAL', 'ADJUSTMENT']);

function postedLeaveEntries(
	entries: readonly LeaveEntryRow[],
	asOf: string
): readonly LeaveEntryRow[] {
	return entries.filter(
		(entry) => entry.approval_id == null && dateKey(entry.effective_on) <= asOf
	);
}

export function leaveBalance(entries: readonly LeaveEntryRow[], asOf: string): number {
	return postedLeaveEntries(entries, asOf).reduce(
		(total, entry) => total + decodeNumber(entry.days),
		0
	);
}

/** Awards posted through a date, compared to awards, never to the balance left after leave was taken. */
export function awardedLeaveDays(entries: readonly LeaveEntryRow[], asOf?: string): number {
	return entries
		.filter(
			(entry) =>
				entry.approval_id == null &&
				AWARD_KINDS.has(entry.kind ?? '') &&
				(asOf == null || dateKey(entry.effective_on) <= asOf)
		)
		.reduce((total, entry) => total + decodeNumber(entry.days), 0);
}

export function leaveBalanceSummary(options: {
	readonly entitlement: LeaveEntitlementRow;
	readonly entries: readonly LeaveEntryRow[];
	readonly pendingDays: number;
	readonly asOf: string;
}): LeaveBalanceSummary {
	const entries = postedLeaveEntries(options.entries, options.asOf);
	const sum = (...kinds: readonly string[]) =>
		entries
			.filter((entry) => kinds.includes(entry.kind ?? ''))
			.reduce((total, entry) => total + decodeNumber(entry.days), 0);
	const earned = sum('OPENING_ENTITLEMENT', 'ACCRUAL', 'ADJUSTMENT');
	const carried = sum('CARRY_FORWARD');
	const adjusted = sum('ADJUSTMENT', 'MANUAL_ADJUSTMENT');
	const taken = Math.max(0, -sum('TAKEN', 'RESTORED'));
	const encashed = Math.abs(sum('ENCASHED'));
	const expired = Math.abs(sum('EXPIRED'));
	const balance = entries.reduce((total, entry) => total + decodeNumber(entry.days), 0);
	return {
		entitlement: Math.max(0, decodeNumber(options.entitlement.entitlement_days) + adjusted),
		earned,
		carried,
		adjusted,
		taken,
		pending: options.pendingDays,
		encashed,
		expired,
		balance,
		available: balance - options.pendingDays
	};
}
