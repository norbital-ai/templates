/** A statutory row's legal basis: the custom field's shape, and the typed shape research drafts it in. */
export const REFERENCES_SHAPE = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: {
			title: { kind: 'text' },
			locator: { kind: 'text', optional: true },
			url: { kind: 'text', format: 'url', optional: true },
			quote: { kind: 'text', optional: true },
			effective_from: { kind: 'date', optional: true }
		}
	}
} as const;
