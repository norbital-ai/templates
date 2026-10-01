import { Schema } from 'effect';
import * as Predicate from 'effect/Predicate';
import { isCalendarDate, isUtcIsoInstant } from '../iso-day.js';

const condition = Schema.String.check(Schema.isPattern(/\S/));

const factKeyShape = Schema.Struct({
	key: Schema.String.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/)),
	/**
	 * `date` is an ISO calendar day (`YYYY-MM-DD`), `instant` a UTC ISO instant, `code` the code of
	 * a `reference_rows` row of `table`, in force on the fact's date.
	 */
	type: Schema.Literals(['boolean', 'number', 'string', 'date', 'instant', 'code']),
	/** A `code` input's table: the version's `tables` declaration its codes come from. */
	table: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/)))),
	/**
	 * A `code` input whose row must sit under the code another input of the same list holds, or,
	 * naming no input of the list, the column of that name on the subject record (a worksite's
	 * `region`).
	 */
	parent_fact: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/)))),
	label: Schema.optionalKey(Schema.NullOr(Schema.String)),
	description: Schema.optionalKey(Schema.NullOr(Schema.String)),
	/** A supplied employee election applies only to a named employment. */
	scope: Schema.optionalKey(Schema.NullOr(Schema.Literal('EMPLOYMENT'))),
	/** Required before calculation; incomplete records may still be saved. */
	required: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/** Boolean expression evaluated against the entity or assessed statutory scheme. */
	required_when: Schema.optionalKey(Schema.NullOr(condition)),
	/**
	 * When a changed declared value takes effect, where the law defers it (TW salary-withholding
	 * regulations art. 5: dependant reductions apply the following January, increases the event
	 * month). `YEAR_START` defers every change to the next 1 January (ID PMK 168/2023 art.9(4): the
	 * PTKP status on 1 January governs the year). `MONTH_START`: a change takes effect only from
	 * the first of a month (TW 勞工保險條例 §14(2): 自通知之次月一日生效), so a coverage declaration
	 * changing it inside continuous cover is refused. Absent is immediate.
	 */
	change_effect: Schema.optionalKey(
		Schema.NullOr(
			Schema.Literals(['EVENT_MONTH', 'NEXT_YEAR_JANUARY', 'YEAR_START', 'MONTH_START'])
		)
	),
	/** When present, a supplied value must satisfy this Boolean expression. */
	valid_when: Schema.optionalKey(Schema.NullOr(condition)),
	/** Operator-facing refusal used when `valid_when` is false. */
	validation_message: Schema.optionalKey(
		Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/)))
	),
	/** Only a documented statutory default belongs here; omission is not a declaration. */
	default_value: Schema.optionalKey(
		Schema.NullOr(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String]))
	),
	options: Schema.optionalKey(
		Schema.NullOr(Schema.Array(Schema.Union([Schema.Boolean, Schema.Finite, Schema.String])))
	),
	minimum: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	maximum: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
	integer: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	min_length: Schema.optionalKey(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
	/** A work-day input the scheduling workbook carries as its own Overtime-sheet column. */
	import: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
	/**
	 * A supplied value counts only once its evidence is recorded (one `fact_evidence` row naming the
	 * subject and key): a reference, a file, or both. `when`, a Boolean expression over the subject's
	 * site, narrows the demand; absent is always. Calculation refuses an unevidenced value.
	 */
	evidence: Schema.optionalKey(
		Schema.NullOr(
			Schema.Struct({
				kind: Schema.Literals(['REFERENCE', 'FILE', 'REFERENCE_AND_FILE']),
				when: Schema.optionalKey(Schema.NullOr(condition)),
				/** The document type demanded: a code of the version's `DOCUMENT_TABLE` rows. */
				document: Schema.optionalKey(Schema.NullOr(Schema.String.check(Schema.isPattern(/\S/)))),
				/** How many days a received document stays valid, the day received counted. */
				valid_days: Schema.optionalKey(
					Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
				)
			})
		)
	)
});

/** The table whose rows are the document types an evidence declaration may demand. */
export const DOCUMENT_TABLE = 'DOCUMENT_TYPE';

/**
 * One declaration as stored. `default_value` and `options` are `json` columns (a scalar union the field language
 * lacks); `factKeySchema` admits only booleans, numbers and strings there, which `factScalar` reads back.
 */
export type FactKey = Omit<Schema.Schema.Type<typeof factKeyShape>, 'default_value' | 'options'> & {
	readonly default_value?: unknown;
	readonly options?: readonly unknown[] | null | undefined;
};

/** A stored default or option: a boolean, a number or a string (the declaration's check), else absent. */
export const factScalar = (value: unknown): string | number | boolean | undefined =>
	Predicate.isString(value) || Predicate.isNumber(value) || Predicate.isBoolean(value)
		? value
		: undefined;

/**
 * A `code` value's row in force on the caller's date, or null where the table carries no such code
 * then. The caller binds the date and the rows (`referenceCodes`), so the checks stay pure.
 */
export type CodeResolver = (
	table: string,
	code: string
) => { readonly parent_code: string | null } | null;

/** The value a `code` input's `parent_fact` names: another value of the list, else the subject's column. */
export const parentOf = (
	field: FactKey,
	values: Readonly<Record<string, unknown>>,
	parents?: Readonly<Record<string, unknown>>
): unknown =>
	field.parent_fact == null
		? undefined
		: (values[field.parent_fact] ?? parents?.[field.parent_fact]);

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

const FACT_TYPE: Readonly<Record<FactKey['type'], (value: unknown) => boolean>> = {
	boolean: Predicate.isBoolean,
	number: Predicate.isNumber,
	string: Predicate.isString,
	date: (value) => Predicate.isString(value) && isCalendarDate(value),
	instant: (value) => Predicate.isString(value) && isUtcIsoInstant(value),
	code: Predicate.isString
};
/** Whether `value` is of a fact key's declared `type`. */
export const holdsFactType = (type: FactKey['type'], value: unknown): boolean =>
	FACT_TYPE[type](value);

/**
 * One supplied value, shared by declaration defaults, collection writes and calculation. A `code`
 * value is checked against its table only where the caller passes `codes`, and against `parent`
 * (the value its `parent_fact` names) where that is known.
 */
export function factValueFault(
	field: FactKey,
	value: unknown,
	codes?: CodeResolver,
	parent?: unknown
): string | null {
	const label = field.label?.trim() || field.key;
	if (!holdsFactType(field.type, value))
		return field.type === 'date' || field.type === 'instant'
			? `${label} must be an ISO ${field.type === 'date' ? 'calendar day (YYYY-MM-DD)' : 'UTC instant'}.`
			: `${label} must be a ${field.type}; this value is a ${typeof value}.`;
	if (Predicate.isNumber(value)) {
		if (!Number.isFinite(value)) return `${label} must be finite.`;
		if (field.integer && !Number.isInteger(value)) return `${label} must be a whole number.`;
		if (field.minimum != null && value < field.minimum)
			return `${label} must be at least ${field.minimum}.`;
		if (field.maximum != null && value > field.maximum)
			return `${label} must be at most ${field.maximum}.`;
	}
	if (
		Predicate.isString(value) &&
		field.min_length != null &&
		value.trim().length < field.min_length
	)
		return `${label} must contain at least ${field.min_length} characters.`;
	if (field.options != null && !field.options.some((option) => option === value))
		return `${label} must be one of: ${field.options.join(', ')}.`;
	if (field.type === 'code' && codes != null && codes(field.table ?? '', String(value)) == null)
		return `${label}: ${String(value)} is not a code of table ${field.table} in force on this date.`;
	if (
		codes != null &&
		parent !== undefined &&
		codes(field.table ?? '', String(value))?.parent_code !== parent
	)
		return `${label} ${String(value)} does not belong under ${field.parent_fact} ${String(parent)}.`;
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
		if (field.type === 'code' && field.table == null)
			return `${field.key}: a code input names the table its codes come from.`;
		if (field.type !== 'code' && (field.table != null || field.parent_fact != null))
			return `${field.key}: a table and a parent input belong to a code input.`;
		if (field.required && field.default_value != null)
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
	Schema.makeFilter((fields) => {
		if (new Set(fields.map((field) => field.key)).size !== fields.length)
			return 'Each fact key must be declared once.';
		for (const field of fields)
			if (
				field.parent_fact != null &&
				fields.some((parent) => parent.key === field.parent_fact && parent.type !== 'code')
			)
				return `${field.key}: its parent input ${field.parent_fact} is not a code input of this list.`;
		return true;
	})
);

/** The value's Standard Schema view: the check `+definition.ts` runs on every write. */
export const standard = Schema.toStandardSchemaV1(factKeysValueSchema, {
	parseOptions: { onExcessProperty: 'error' }
});
