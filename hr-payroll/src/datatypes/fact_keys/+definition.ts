import { defineCustomType } from '@norbital-ai/bolt/authoring';
import { Schema } from 'effect';

const factKeyShape = Schema.Struct({
	key: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
	type: Schema.Literals(['boolean', 'number', 'string']),
	label: Schema.optionalKey(Schema.String),
	description: Schema.optionalKey(Schema.String),
	/** A supplied employee election applies only to a named employment. */
	scope: Schema.optionalKey(Schema.Literal('EMPLOYMENT')),
	/** Required before calculation; incomplete records may still be saved. */
	required: Schema.optionalKey(Schema.Boolean),
	/** Boolean expression evaluated against the entity or assessed statutory scheme. */
	required_when: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
	/** When present, a supplied value must satisfy this Boolean expression. */
	valid_when: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
	/** Operator-facing refusal used when `valid_when` is false. */
	validation_message: Schema.optionalKey(Schema.String.check(Schema.isPattern(/\S/))),
	/** Only a documented statutory default belongs here; omission is not a declaration. */
	default_value: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])),
	options: Schema.optionalKey(
		Schema.Array(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String]))
	),
	minimum: Schema.optionalKey(Schema.Finite),
	maximum: Schema.optionalKey(Schema.Finite),
	integer: Schema.optionalKey(Schema.Boolean),
	min_length: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))
});

export type FactKey = Schema.Schema.Type<typeof factKeyShape>;

/** Employer-bound instructions cannot silently become person-wide elections. */
export function factScopeFault(
	fields: readonly FactKey[],
	values: Readonly<Record<string, unknown>>,
	employmentId: string | null | undefined
): string | null {
	if (employmentId != null && employmentId !== '') return null;
	const field = fields.find(
		(field) => field.scope === 'EMPLOYMENT' && Object.hasOwn(values, field.key)
	);
	return field == null ? null : `${field.label?.trim() || field.key} requires a named employment.`;
}

/** One supplied value, shared by declaration defaults, collection writes and calculation. */
export function factValueFault(field: FactKey, value: unknown): string | null {
	const label = field.label?.trim() || field.key;
	if (typeof value !== field.type)
		return `${label} must be a ${field.type}; this value is a ${typeof value}.`;
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return `${label} must be finite.`;
		if (field.integer && !Number.isInteger(value)) return `${label} must be a whole number.`;
		if (field.minimum != null && value < field.minimum)
			return `${label} must be at least ${field.minimum}.`;
		if (field.maximum != null && value > field.maximum)
			return `${label} must be at most ${field.maximum}.`;
	}
	if (
		typeof value === 'string' &&
		field.min_length != null &&
		value.trim().length < field.min_length
	)
		return `${label} must contain at least ${field.min_length} characters.`;
	if (field.options != null && !field.options.some((option) => option === value))
		return `${label} must be one of: ${field.options.join(', ')}.`;
	return null;
}

export const factKeySchema = factKeyShape.check(
	Schema.makeFilter((field) => {
		if (
			field.type !== 'number' &&
			(field.minimum != null || field.maximum != null || field.integer != null)
		)
			return `${field.key}: numeric constraints require a number field.`;
		if (field.type !== 'string' && field.min_length != null)
			return `${field.key}: minimum length requires a string field.`;
		if (field.minimum != null && field.maximum != null && field.minimum > field.maximum)
			return `${field.key}: minimum cannot exceed maximum.`;
		if (field.required && field.default_value !== undefined)
			return `${field.key}: choose a required declaration or a statutory default.`;
		if (field.required && field.required_when != null)
			return `${field.key}: choose an unconditional or conditional requirement.`;
		if ((field.valid_when == null) !== (field.validation_message == null))
			return `${field.key}: value validation requires both an expression and a message.`;
		if (field.options != null) {
			if (field.options.length === 0 || new Set(field.options).size !== field.options.length)
				return `${field.key}: choices must be nonempty and unique.`;
			for (const option of field.options) {
				const fault = factValueFault(field, option);
				if (fault != null) return fault;
			}
		}
		return field.default_value === undefined || factValueFault(field, field.default_value) || true;
	})
);

export const factKeysValueSchema = Schema.Array(factKeySchema).check(
	Schema.makeFilter(
		(fields) =>
			new Set(fields.map((field) => field.key)).size === fields.length ||
			'Each fact key must be declared once.'
	)
);

export default defineCustomType({
	name: 'fact_keys',
	description:
		'Versioned input declarations: keys, labels, types, constraints, required values and statutory defaults.',
	schema: Schema.toStandardSchemaV1(factKeysValueSchema, {
		parseOptions: { onExcessProperty: 'error' }
	})
});
