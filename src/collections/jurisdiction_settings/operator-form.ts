/**
 * Operator-visible jurisdiction settings composition.
 *
 * `CollectionForm` must declare every mutable field once. The seal, the void and the clone
 * provenance are not typed into the form: sealing and voiding are the timeline's two actions
 * (`+settings.svelte`), written as their own one-column mutations under the HR Manager's
 * approval, `cloned_from_id` is set by the clone alone, and `research_notes` is the statutory
 * drift automation's review sheet, shown by the timeline. They are registered hidden so the form
 * still declares the whole mutable catalog.
 */
export const JURISDICTION_OPERATOR_HIDDEN_FIELDS = [
	'sealed_at',
	'voided_at',
	'void_reason',
	'cloned_from_id',
	'research_notes'
] as const;

export const JURISDICTION_OPERATOR_VISIBLE_FIELDS = [
	'code',
	'name',
	'currency',
	'tax_year_start_month',
	'effective_range',
	'proration',
	'ordinary_rate',
	'regime',
	'research_urls'
] as const;

/** Hidden ∪ visible — the exact set the representation must register. */
export const jurisdictionOperatorFieldNames = (): readonly string[] => [
	...JURISDICTION_OPERATOR_HIDDEN_FIELDS,
	...JURISDICTION_OPERATOR_VISIBLE_FIELDS
];
