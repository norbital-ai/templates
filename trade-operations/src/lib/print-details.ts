import { Schema } from 'effect';

export const printValueKind = {
	kind: 'list',
	optional: true,
	of: { kind: 'object', fields: { key: { kind: 'text' }, value: { kind: 'text' } } }
} as const;

export const printFieldKind = {
	kind: 'list',
	optional: true,
	of: {
		kind: 'object',
		fields: {
			key: { kind: 'text' },
			label: { kind: 'text' },
			scope: { kind: 'enum', values: ['order', 'line'] },
			multiline: { kind: 'bool', optional: true },
			default_value: { kind: 'text', optional: true }
		}
	}
} as const;

export const PrintValues = Schema.Array(
	Schema.Struct({ key: Schema.String, value: Schema.String })
);
type PrintValues = typeof PrintValues.Type;
type PrintField = {
	key: string;
	label: string;
	scope: 'order' | 'line';
	default_value?: string | null | undefined;
};
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
			) && scoped.every(({ label }) => label.trim().length > 0 && label.length <= 80)
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
