// @ts-nocheck -- executed directly by Node with --experimental-strip-types.
/**
 * An allowance on a contract, for a test world: the employment's terms rows are split where the
 * allowance opens and closes, and each row inside the window lists it — what a terms change from
 * a date does in the product (`employment_terms.allowances`). A test that once keyed a standing
 * allowance row calls this with the same object.
 */
import type { PayrollWorld } from './memory-payroll-api.ts';

const OPEN = '9999-12-31';
const dayOf = (value: unknown): string => (value == null ? OPEN : String(value).slice(0, 10));
const shift = (day: string, days: number): string => {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
};
let minted = 0;

export function assignAllowance(
	world: Pick<PayrollWorld, 'employment_terms'>,
	allowance: {
		readonly employment_id: string;
		readonly catalogue_id: string;
		readonly amount: number;
		readonly effective_from: string;
		readonly effective_to?: string | null;
	}
): void {
	const from = dayOf(allowance.effective_from);
	const to = allowance.effective_to == null ? OPEN : dayOf(allowance.effective_to);
	const listing = { catalogue_id: allowance.catalogue_id, amount: allowance.amount };
	const next: PayrollWorld['employment_terms'] = [];
	for (const terms of world.employment_terms) {
		if (terms.employment_id !== allowance.employment_id) {
			next.push(terms);
			continue;
		}
		const range = terms.effective_range as { start: unknown; end: unknown };
		const start = dayOf(range.start);
		const end = dayOf(range.end);
		if (to < start || from > end) {
			next.push(terms);
			continue;
		}
		// The row's days before, inside and after the window: up to three rows, each listing
		// what it carries; the piece inside gains the allowance.
		const cuts = [start, ...[from, shift(to, 1)].filter((day) => day > start && day <= end)];
		const pieces: PayrollWorld['employment_terms'] = [];
		for (const [index, cut] of cuts.entries()) {
			const segmentEnd = index + 1 < cuts.length ? shift(cuts[index + 1], -1) : end;
			const inside = cut >= from && cut <= to;
			const existing = (terms.allowances as (typeof listing)[] | undefined) ?? [];
			const listed = existing.filter((row) => row.catalogue_id !== listing.catalogue_id);
			// The piece inside the window keeps the row's id: a test keys the leave and the
			// work of that window to "the terms", and those are the terms that carry the allowance.
			pieces.push({
				...terms,
				id: inside
					? terms.id
					: `${String(terms.id).slice(0, 24)}${String(++minted).padStart(12, '0')}`,
				allowances: inside ? [...listed, listing] : existing,
				effective_range: {
					start: `${cut}T00:00:00.000Z`,
					end: index + 1 < cuts.length ? `${segmentEnd}T15:59:59.999Z` : range.end
				}
			});
		}
		// The piece with the row's id first, where a test's `find` by employment expects it; the
		// engine reads the rows by date, never by position.
		next.push(
			...pieces.filter((piece) => piece.id === terms.id),
			...pieces.filter((piece) => piece.id !== terms.id)
		);
	}
	world.employment_terms.splice(0, world.employment_terms.length, ...next);
}

/** No allowance on any contract: every terms row lists none. */
export function clearAllowances(world: Pick<PayrollWorld, 'employment_terms'>): void {
	for (const terms of world.employment_terms) terms.allowances = [];
}
