import * as Predicate from 'effect/Predicate';

/**
 * The titles today's SQL generated, now stored fields: each collection's transform derives them, and the seed reader
 * derives the bank's rows with the same functions (seed mode runs no transform).
 */

/** A terms row: `<job title> · <employment type>`. */
export const termsSummary = (terms: {
	readonly job_title?: string | null;
	readonly employment_type?: string | null;
}) => `${terms.job_title == null ? '' : `${terms.job_title} · `}${terms.employment_type ?? ''}`;

/** A statutory fact: `Registered · <ref>` or `Not registered · <reason>`, `· from <first day>`. */
export const statutoryFactSummary = (
	status:
		| {
				readonly kind?: string;
				readonly reference_number?: string | null;
				readonly reason?: string | null;
		  }
		| null
		| undefined,
	range: unknown
) => {
	const standing =
		status?.kind === 'REGISTERED'
			? `Registered · ${status.reference_number || 'no reference'}`
			: status?.kind === 'NOT_REGISTERED'
				? `Not registered · ${status.reason || 'no reason given'}`
				: 'Statutory fact';
	const from = (range as { readonly from?: unknown } | null | undefined)?.from;
	return `${standing} · from ${Predicate.isString(from) ? from : ''}`;
};
