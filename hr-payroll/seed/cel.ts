import { Array as EffectArray } from 'effect';
import { Predicate, Schema } from 'effect';
import { STATUTORY_FIELDS } from '../src/lib/payroll_engine/statutory_fields.js';
import { formatCel } from '../src/lib/ui/format/code_text.js';

type Json = Schema.Json;
type Row = Record<string, Json>;
type Shape = {
	readonly kind: string;
	readonly format?: string;
	readonly shape?: Shape;
	readonly fields?: Readonly<Record<string, Shape>>;
	readonly of?: Shape | string;
};
const isRecord = Schema.is(Schema.Record(Schema.String, Schema.Json));
const rowOf = (value: unknown): Row | null => (isRecord(value) ? { ...value } : null);
const cel: Shape = { kind: 'text', format: 'cel' };
const object = (fields: Readonly<Record<string, Shape>>): Shape => ({ kind: 'object', fields });
const list = (of: Shape): Shape => ({ kind: 'list', of });
const expressions = (names: readonly string[]): Readonly<Record<string, Shape>> =>
	Object.fromEntries(names.map((name): [string, Shape] => [name, cel]));
const declarations: Readonly<Record<string, Readonly<Record<string, Shape>>>> = {
	...STATUTORY_FIELDS,
	jurisdiction_settings: STATUTORY_FIELDS.settings
};

/** Follow the declaration, rather than treating ordinary prose or amounts with the same key as CEL. */
function formatDeclared(value: Json, shape: Shape): Json {
	if (shape.format === 'cel' && Predicate.isString(value)) return formatCel(value);
	if (shape.shape !== undefined) return formatDeclared(value, shape.shape);
	if (
		shape.kind === 'list' &&
		EffectArray.isArray<typeof value>(value) &&
		Predicate.isObject(shape.of)
	) {
		const item = shape.of;
		return value.map((entry) => formatDeclared(entry, item));
	}
	const record = rowOf(value);
	if (record === null) return value;
	if (shape.fields !== undefined) {
		const fields = shape.fields;
		return Object.fromEntries(
			Object.entries(record).map(([key, entry]): [string, Json] => [
				key,
				fields[key] === undefined ? entry : formatDeclared(entry, fields[key])
			])
		);
	}
	if (shape.kind === 'record' && Predicate.isObject(shape.of)) {
		const item = shape.of;
		return Object.fromEntries(
			Object.entries(record).map(([key, entry]): [string, Json] => [
				key,
				formatDeclared(entry, item)
			])
		);
	}
	return value;
}

/** Behaviour read predicates define every string leaf as CEL, including strings inside operator arrays. */
function formatWhere(value: Json): Json {
	if (Predicate.isString(value)) return formatCel(value);
	if (EffectArray.isArray<typeof value>(value)) return value.map(formatWhere);
	const record = rowOf(value);
	return record !== null
		? Object.fromEntries(
				Object.entries(record).map(([key, entry]): [string, Json] => [key, formatWhere(entry)])
			)
		: value;
}

const exportField = object({ value: cel });
const exportsShape = object({
	...expressions(['file', 'when', 'applies_when']),
	columns: list(exportField),
	records: list(object({ each: cel, fields: list(exportField) })),
	summary: object({ ...expressions(['key', 'each']), fields: list(exportField) }),
	header: list(exportField),
	trailer: list(exportField)
});
const dutyShape = object(expressions(['when', 'applies_when', 'due', 'amount']));

/** Format both public and private seed outputs; the input tree and all non-expression values stay untouched. */
export function formatSeedRow(collection: string, row: Row): Row {
	const fields = declarations[collection];
	const declared = rowOf(fields === undefined ? row : formatDeclared(row, object(fields)));
	if (declared === null) return row;
	if (collection === 'behaviour') {
		const reads = rowOf(declared['reads']);
		return {
			...declared,
			...(reads === null
				? {}
				: {
						reads: Object.fromEntries(
							Object.entries(reads).map(([key, read]): [string, Json] => {
								const held = rowOf(read);
								return [
									key,
									held !== null && held['where'] !== undefined
										? { ...held, where: formatWhere(held['where']) }
										: read
								];
							})
						)
					}),
			...(declared['definition'] == null
				? {}
				: { definition: formatDeclared(declared['definition'], dutyShape) })
		};
	}
	if (collection === 'rule_set' && declared['rules'] !== undefined) {
		const family = declared['family'];
		const code = declared['code'];
		const shape =
			family === 'VALIDATIONS'
				? object({ when: cel })
				: family !== 'PARAMETERS'
					? undefined
					: code === 'record_retention'
						? object({ until: cel })
						: code === 'overtime_classification'
							? object({
									limits: list(object(expressions(['from', 'limit', 'applies', 'hours'])))
								})
							: isRecord(declared['rules']) && Predicate.isString(declared['rules']['file'])
								? exportsShape
								: undefined;
		if (shape !== undefined)
			return { ...declared, rules: formatDeclared(declared['rules'], shape) };
	}
	return declared;
}
