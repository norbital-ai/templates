/**
 * How a statutory charge is shown and ordered where a person reads it.
 *
 * Nothing here names a scheme: the version's row states its short name, its place in the
 * entity's listing and the column it folds into (`statutory_contributions.short_name`,
 * `listing_order`, `listing_group`), and every charge freezes those at settlement. A row that
 * states none reads by its code, after the ordered ones.
 */
export type SchemeListing = {
	readonly scheme_code: string;
	readonly label?: string | null;
	readonly listing_order?: number | null;
	readonly listing_group?: string | null;
};

/** What the payslip prints for the charge: the row's short name, else its code. */
export const schemeLabel = (charge: SchemeListing): string => charge.label ?? charge.scheme_code;

/** The column a listing folds the charge into: the group's code, else its own. */
export const schemeGroup = (charge: SchemeListing): string =>
	charge.listing_group ?? charge.scheme_code;

/** Sort charges the way the entity's listing reads them: stated order first, then by code. */
export const bySchemeListing = (left: SchemeListing, right: SchemeListing): number => {
	const a = left.listing_order ?? Number.POSITIVE_INFINITY;
	const b = right.listing_order ?? Number.POSITIVE_INFINITY;
	return a === b ? left.scheme_code.localeCompare(right.scheme_code) : a - b;
};
