import type { WorkspaceRow } from '../../collections/leave_requests/$types.js';
import { decodeNumber } from '@norbital-ai/std/json';
import { dateKey } from '../iso-day.js';

type LeaveAccountRow = WorkspaceRow<'leave_accounts'>;
type LeaveEntryRow = WorkspaceRow<'leave_entries'>;

type LeaveAccountSummary = {
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

const AWARD_KINDS = new Set([
	'OPENING_ENTITLEMENT',
	'ACCRUAL',
	'STATUTORY_ADJUSTMENT',
	'POLICY_ADJUSTMENT'
]);

function postedLeaveEntries(
	entries: readonly LeaveEntryRow[],
	asOf: string
): readonly LeaveEntryRow[] {
	return entries.filter(
		(entry) => entry.approval_id == null && dateKey(entry.effective_on) <= asOf
	);
}

export function leaveAccountBalance(entries: readonly LeaveEntryRow[], asOf: string): number {
	return postedLeaveEntries(entries, asOf).reduce(
		(total, entry) => total + decodeNumber(entry.days),
		0
	);
}

/** Awards are compared to awards, never to remaining balance after leave was taken. */
export function awardedLeaveDays(entries: readonly LeaveEntryRow[]): number {
	return entries
		.filter((entry) => entry.approval_id == null && AWARD_KINDS.has(entry.kind ?? ''))
		.reduce((total, entry) => total + decodeNumber(entry.days), 0);
}

export function leaveAccountSummary(options: {
	readonly account: LeaveAccountRow;
	readonly entries: readonly LeaveEntryRow[];
	readonly pendingDays: number;
	readonly asOf: string;
}): LeaveAccountSummary {
	const entries = postedLeaveEntries(options.entries, options.asOf);
	const sum = (...kinds: readonly string[]) =>
		entries
			.filter((entry) => kinds.includes(entry.kind ?? ''))
			.reduce((total, entry) => total + decodeNumber(entry.days), 0);
	const earned = sum('OPENING_ENTITLEMENT', 'ACCRUAL', 'STATUTORY_ADJUSTMENT', 'POLICY_ADJUSTMENT');
	const carried = sum('CARRY_FORWARD');
	const adjusted = sum('STATUTORY_ADJUSTMENT', 'POLICY_ADJUSTMENT', 'MANUAL_ADJUSTMENT');
	const taken = Math.max(0, -sum('TAKEN', 'RESTORED'));
	const encashed = Math.abs(sum('ENCASHED'));
	const expired = Math.abs(sum('EXPIRED'));
	const balance = entries.reduce((total, entry) => total + decodeNumber(entry.days), 0);
	return {
		entitlement: Math.max(0, decodeNumber(options.account.entitlement_days) + adjusted),
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
