/** A field's name as people read it. */
export const fieldLabel = (name: string) =>
	name
		.replace(/_id$/, '')
		.replaceAll('_', ' ')
		.replace(/^\w/, (first) => first.toUpperCase());
