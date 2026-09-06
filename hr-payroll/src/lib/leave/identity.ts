import { sha256Text } from '@norbital-ai/std/reckon';

/**
 * The identities every writer and reader of the leave ledger share.
 *
 * An account is named by its employment, leave code and leave year; an entry by its account and
 * the source it records. The same fact therefore always names the same row, so a request can name
 * its account before the account exists, and two writers that both know a fact restate one row
 * instead of creating two.
 */

/** A stable UUID (version-5 shaped) for one logical identity; the same input always names the same row. */
export const stableUuid = (source: string): string => {
	const hex = sha256Text(source)
		.replace(/[^0-9a-f]/gi, '')
		.toLowerCase()
		.slice(0, 32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** The one formula every writer and reader of a leave account's identity shares. */
export const leaveAccountIdFor = (account: {
	readonly employment_id: string;
	readonly leave_code: string;
	readonly leave_year: number | string;
	readonly account_kind?: string | null;
	readonly event_reference?: string | null;
}): string =>
	stableUuid(
		[
			'leave_account',
			account.employment_id,
			account.leave_code,
			String(account.leave_year),
			account.account_kind ?? 'YEAR',
			account.event_reference ?? ''
		].join(':')
	);

/** One ledger entry per (account, source): the request it records, the accrual month, the law change. */
export const leaveEntryIdFor = (entry: {
	readonly leave_account_id: string;
	readonly source_key: string;
}): string => stableUuid(['leave_entry', entry.leave_account_id, entry.source_key].join(':'));

/** The source key of the ledger line an approved leave request takes. */
export const requestSourceKey = (requestId: string): string => `request:${requestId}`;
