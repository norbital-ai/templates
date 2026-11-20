import { Schema } from 'effect';

export const printValueKind = {
	kind: 'object',
	fields: { key: { kind: 'text' }, value: { kind: 'text' } },
	optional: true,
	many: true
} as const;

export const printFieldKind = {
	kind: 'object',
	fields: {
		key: { kind: 'text' },
		label: { kind: 'text' },
		// the label in the workspace's other language: the screen shows the reader's, the document prints in the layout's
		translation: { kind: 'text', optional: true },
		scope: { kind: 'enum', values: ['order', 'line'] },
		multiline: { kind: 'bool', optional: true },
		default_value: { kind: 'text', optional: true },
		// one choice per line, `printed value | translation`: the order picks one instead of typing
		options: { kind: 'text', optional: true }
	},
	optional: true,
	many: true
} as const;

export const PrintValues = Schema.Array(
	Schema.Struct({ key: Schema.String, value: Schema.String })
);
type PrintValues = typeof PrintValues.Type;
type PrintField = {
	key: string;
	label: string;
	translation?: string | null | undefined;
	scope: 'order' | 'line';
	default_value?: string | null | undefined;
	options?: string | null | undefined;
};
/** A field's fixed choices (what prints, and its translation), or none for free text. */
export const printChoices = (field: Pick<PrintField, 'options'>) =>
	(field.options ?? '').split('\n').flatMap((line) => {
		const [value = '', translation = ''] = line.split('|').map((part) => part.trim());
		return value ? [{ value, translation: translation || value }] : [];
	});
const validKey = /^[a-z][a-z0-9_]{0,39}$/;
export const printValueLimit = 2000;

export function validPrintValues(values: PrintValues) {
	return (
		values.length <= 40 &&
		new Set(values.map(({ key }) => key)).size === values.length &&
		values.every(({ key, value }) => validKey.test(key) && value.length <= printValueLimit)
	);
}

export function validPrintFields(fields: readonly PrintField[]) {
	return (['order', 'line'] as const).every((scope) => {
		const scoped = fields.filter((field) => field.scope === scope);
		return (
			validPrintValues(
				scoped.map(({ key, default_value }) => ({ key, value: default_value ?? '' }))
			) &&
			scoped.every(
				(field) =>
					field.label.trim().length > 0 &&
					field.label.length <= 80 &&
					(field.translation ?? '').length <= 80 &&
					// a field with choices defaults to one of them
					(!printChoices(field).length ||
						!field.default_value ||
						printChoices(field).some(({ value }) => value === field.default_value))
			)
		);
	});
}

/** Canonical stored order for hashing and comparing revisions. Empty entries explicitly clear defaults. */
export const orderedPrintValues = (values: PrintValues) =>
	[...values].sort((a, b) => a.key.localeCompare(b.key));

export function samePrintValues(
	a: PrintValues | null | undefined,
	b: PrintValues | null | undefined
) {
	return (
		JSON.stringify(orderedPrintValues(a ?? [])) === JSON.stringify(orderedPrintValues(b ?? []))
	);
}

export function printDetailFields(
	fields: readonly PrintField[] | null,
	scope: PrintField['scope'],
	values: PrintValues | null | undefined
) {
	const saved = new Map(values?.map(({ key, value }) => [key, value]));
	return Object.fromEntries(
		(fields ?? [])
			.filter((field) => field.scope === scope)
			.map(({ key, default_value }) => [`detail_${key}`, saved.get(key) ?? default_value ?? ''])
	);
}
