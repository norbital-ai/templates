/**
 * Operator-visible statutory-profile composition.
 *
 * `CollectionForm` must declare every mutable field once. These two stay registered (so a void
 * can still write them) but they are not operator controls — sealing / void is server-governed.
 */
export const JURISDICTION_OPERATOR_HIDDEN_FIELDS = [
	'successor_profile_id',
	'void_reason',
	'supersedes_id'
] as const;

export const JURISDICTION_OPERATOR_VISIBLE_FIELDS = [
	'code',
	'name',
	'lifecycle',
	'currency',
	'tax_year_start_month',
	'effective_range',
	'proration',
	'ordinary_rate_basis',
	'ordinary_rate_divisor',
	'regime',
	'statutory_leave',
	'statutory_coverage',
	'revision',
	'research_urls'
] as const;

/** Hidden ∪ visible — the exact set the representation must register. */
export const jurisdictionOperatorFieldNames = (): readonly string[] => [
	...JURISDICTION_OPERATOR_HIDDEN_FIELDS,
	...JURISDICTION_OPERATOR_VISIBLE_FIELDS
];
