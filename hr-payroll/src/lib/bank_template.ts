import type { InputKind } from '@norbital-ai/bolt';
import { parse } from '@marcbachmann/cel-js';
import { Result, Schema } from 'effect';

export const ExportField = Schema.Struct({
	header: Schema.optional(Schema.NullOr(Schema.String)),
	value: Schema.String,
	width: Schema.optional(Schema.NullOr(Schema.Number)),
	align: Schema.optional(Schema.NullOr(Schema.Literals(['left', 'right']))),
	pad: Schema.optional(Schema.NullOr(Schema.String))
});
export type ExportField = typeof ExportField.Type;
const Validation = Schema.Struct({ test: Schema.String, message: Schema.String });
export const BankValidationRules = Schema.Struct({
	file: Schema.Array(Validation),
	row: Schema.Array(Validation)
});
export const ExportRules = Schema.Struct({
	description: Schema.optional(Schema.NullOr(Schema.String)),
	file: Schema.String,
	format: Schema.optional(Schema.NullOr(Schema.Literals(['CSV', 'FIXED']))),
	applies_when: Schema.optional(Schema.NullOr(Schema.String)),
	when: Schema.optional(Schema.NullOr(Schema.String)),
	columns: Schema.Array(ExportField),
	records: Schema.optional(
		Schema.NullOr(
			Schema.Array(Schema.Struct({ each: Schema.String, fields: Schema.Array(ExportField) }))
		)
	),
	summary: Schema.optional(
		Schema.NullOr(
			Schema.Struct({
				key: Schema.String,
				fields: Schema.Array(ExportField),
				each: Schema.optional(Schema.NullOr(Schema.String)),
				position: Schema.optional(Schema.NullOr(Schema.Literals(['before', 'after'])))
			})
		)
	),
	header: Schema.optional(Schema.NullOr(Schema.Array(ExportField))),
	trailer: Schema.optional(Schema.NullOr(Schema.Array(ExportField))),
	bank_file_validation: Schema.optional(Schema.NullOr(BankValidationRules))
});
export type ExportRules = typeof ExportRules.Type;

const FIELD_SHAPE = {
	kind: 'object',
	fields: {
		header: { kind: 'text', optional: true },
		value: { kind: 'text', format: 'cel' },
		width: { kind: 'int', min: 1, optional: true },
		align: { kind: 'enum', values: ['left', 'right'], optional: true },
		pad: { kind: 'text', max: 1, optional: true }
	}
} as const satisfies InputKind;
const VALIDATION_SHAPE = {
	kind: 'list',
	of: {
		kind: 'object',
		fields: { test: { kind: 'text', format: 'cel' }, message: { kind: 'text' } }
	}
} as const satisfies InputKind;

/** Optional draft members stay structured; enabling requires the complete renderer schema. */
export const BANK_TEMPLATE_SHAPE = {
	kind: 'object',
	fields: {
		description: { kind: 'text', optional: true },
		file: { kind: 'text', format: 'cel', optional: true },
		format: { kind: 'enum', values: ['CSV', 'FIXED'], optional: true },
		applies_when: { kind: 'text', format: 'cel', optional: true },
		when: { kind: 'text', format: 'cel', optional: true },
		header: { kind: 'list', of: FIELD_SHAPE, optional: true },
		columns: { kind: 'list', of: FIELD_SHAPE, optional: true },
		trailer: { kind: 'list', of: FIELD_SHAPE, optional: true },
		records: {
			kind: 'list',
			optional: true,
			of: {
				kind: 'object',
				fields: {
					each: { kind: 'text', format: 'cel' },
					fields: { kind: 'list', of: FIELD_SHAPE }
				}
			}
		},
		summary: {
			kind: 'object',
			optional: true,
			fields: {
				key: { kind: 'text', format: 'cel' },
				each: { kind: 'text', format: 'cel', optional: true },
				position: { kind: 'enum', values: ['before', 'after'], optional: true },
				fields: { kind: 'list', of: FIELD_SHAPE }
			}
		},
		bank_file_validation: {
			kind: 'object',
			optional: true,
			fields: { file: VALIDATION_SHAPE, row: VALIDATION_SHAPE }
		}
	}
} as const satisfies InputKind;

type BankConfiguration = {
	readonly enabled?: boolean;
	readonly bank_codes?: unknown;
	readonly currencies?: unknown;
	readonly template?: unknown;
};
type ConfigurationRefusal = {
	readonly field: 'bank_codes' | 'currencies' | 'template';
	readonly message: string;
};
const TextList = Schema.Array(Schema.String);

/** Every writer passes this gate before a draft becomes an available bank format. */
export function bankConfigurationRefusal(
	configuration: BankConfiguration
): ConfigurationRefusal | undefined {
	if (configuration.enabled !== true) return;
	for (const field of ['bank_codes', 'currencies'] as const) {
		const values = Schema.decodeUnknownResult(TextList)(configuration[field]);
		if (
			Result.isFailure(values) ||
			values.success.length === 0 ||
			values.success.some((value) => value.trim() === '' || value !== value.trim()) ||
			new Set(values.success).size !== values.success.length
		)
			return {
				field,
				message: 'Enter at least one distinct, nonblank value before enabling this bank.'
			};
		if (field === 'currencies' && values.success.some((value) => !/^[A-Z]{3}$/.test(value)))
			return {
				field,
				message: 'Use three-letter uppercase currency codes before enabling this bank.'
			};
	}
	const decoded = Schema.decodeUnknownResult(ExportRules)(configuration.template);
	if (Result.isFailure(decoded))
		return {
			field: 'template',
			message: 'Complete the bank export template before enabling this bank.'
		};
	const rules = decoded.success;
	const groups = [
		...(rules.records == null || rules.columns.length > 0 ? [rules.columns] : []),
		...(rules.header == null ? [] : [rules.header]),
		...(rules.trailer == null ? [] : [rules.trailer]),
		...(rules.records ?? []).map((record) => record.fields),
		...(rules.summary == null ? [] : [rules.summary.fields])
	];
	if (
		(rules.records == null && rules.columns.length === 0) ||
		(rules.records != null && rules.records.length === 0) ||
		groups.some((fields) => fields.length === 0)
	)
		return {
			field: 'template',
			message: 'Define the bank file detail fields before enabling this bank.'
		};
	for (const field of groups.flat()) {
		if (
			rules.format === 'FIXED' &&
			(field.width == null || !Number.isInteger(field.width) || field.width < 1)
		)
			return {
				field: 'template',
				message: 'Every fixed-format field needs a positive whole-number width.'
			};
		if (field.pad != null && (field.pad.length !== 1 || /[\u0000-\u001f\u007f]/.test(field.pad)))
			return { field: 'template', message: 'A padding value must be one printable character.' };
	}
	const expressions = [
		rules.file,
		...(rules.applies_when == null ? [] : [rules.applies_when]),
		...(rules.when == null ? [] : [rules.when]),
		...groups.flat().map((field) => field.value),
		...(rules.records ?? []).map((record) => record.each),
		...(rules.summary == null ? [] : [rules.summary.key]),
		...(rules.summary?.each == null ? [] : [rules.summary.each]),
		...(rules.bank_file_validation?.file ?? []).map((rule) => rule.test),
		...(rules.bank_file_validation?.row ?? []).map((rule) => rule.test)
	];
	for (const expression of expressions)
		if (expression.trim() === '' || Result.isFailure(Result.try(() => parse(expression))))
			return {
				field: 'template',
				message: 'Every bank template expression must contain valid CEL syntax.'
			};
	if (
		[...(rules.bank_file_validation?.file ?? []), ...(rules.bank_file_validation?.row ?? [])].some(
			(rule) => rule.message.trim() === ''
		)
	)
		return { field: 'template', message: 'Give every bank validation a clear refusal message.' };
	return;
}
