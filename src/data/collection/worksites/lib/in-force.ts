import { coversDate } from '../../../../lib/payroll/run/effective.js';

type Revision = {
	readonly id: unknown;
	readonly company_id: unknown;
	readonly code: string;
	readonly effective_range: unknown;
};

/**
 * The revision in force on `date` of the worksite `id` names: a terms row or a work day points at one revision, and
 * every revision of that company and code is the same establishment. Null when none covers the date.
 */
export function worksiteOn<R extends Revision>(
	revisions: readonly R[],
	id: unknown,
	date: string
): R | null {
	const named = revisions.find((row) => String(row.id) === String(id));
	if (named == null) return null;
	return (
		revisions.find(
			(row) =>
				String(row.company_id) === String(named.company_id) &&
				row.code === named.code &&
				coversDate(row.effective_range, date)
		) ?? null
	);
}

/** Why a subject of `companyId` starting on `start` cannot name the worksite `id`, or null. */
export function worksiteFault(
	revisions: readonly Revision[],
	id: unknown,
	companyId: unknown,
	start: string
): string | null {
	const named = revisions.find((row) => String(row.id) === String(id));
	if (named == null) return 'The worksite named does not exist.';
	if (String(named.company_id) !== String(companyId))
		return `Worksite ${named.code} belongs to another company.`;
	return worksiteOn(revisions, id, start) == null
		? `Worksite ${named.code} is not in force on ${start}.`
		: null;
}
