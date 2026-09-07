import { sha256Text } from '@norbital-ai/std/reckon';

/**
 * The identities every writer and reader of the leave ledger share.
 *
 * An entitlement is named by its employment, leave code and leave year; an entry by its
 * entitlement and the source it records. The same fact therefore always names the same row, so
 * a request can name its entitlement before the row exists, and two writers that both know a
 * fact restate one row instead of creating two.
 */

/** A stable UUID (version-5 shaped) for one logical identity; the same input always names the same row. */
export const stableUuid = (source: string): string => {
	const hex = sha256Text(source)
		.replace(/[^0-9a-f]/gi, '')
		.toLowerCase()
		.slice(0, 32);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** The one formula every writer and reader of a leave entitlement's identity shares. */
export const leaveEntitlementIdFor = (entitlement: {
	readonly employment_id: string;
	readonly leave_code: string;
	readonly leave_year: number | string;
}): string =>
	stableUuid(
		[
			'leave_entitlement',
			entitlement.employment_id,
			entitlement.leave_code,
			String(entitlement.leave_year)
		].join(':')
	);

/** One ledger entry per (entitlement, source): the request it records, the accrual month, the catalogue edit. */
export const leaveEntryIdFor = (entry: {
	readonly leave_entitlement_id: string;
	readonly source_key: string;
}): string => stableUuid(['leave_entry', entry.leave_entitlement_id, entry.source_key].join(':'));

/** The source key of the ledger line an approved leave request takes. */
export const requestSourceKey = (requestId: string): string => `request:${requestId}`;
