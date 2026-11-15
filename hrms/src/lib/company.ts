import { inForce, type Change, type Depth } from './dated.js';
import { isJsonObject, type Json, type JsonObject } from './payroll_engine/foundation.js';

/** What a company changes by date. Every other field of a company is plain: an edit to it was always so. */
export const COMPANY_FIELDS = [
	'pay_methods',
	'final_pay_loan_floor_percent',
	'overtime_full_award_percent',
	'statutory_parameters'
] as const;

/** A company's statutory parameters are read key by key: a change holds only the parameters it changes. */
export const COMPANY_DEPTH: Depth = (path) =>
	path.length === 1 && path[0] === 'statutory_parameters';

/**
 * An `entity_change` row as the fold reads it: the fields it sets, and `null` for each it takes away (`clears`). A
 * name in `clears` that is no field is a statutory parameter.
 */
export const companyChange = (row: JsonObject): Change => {
	const clears = (Array.isArray(row.clears) ? row.clears : []).map(String);
	const own = (name: string) => COMPANY_FIELDS.some((field) => field === name);
	const parameters: Record<string, Json> = {
		...Object.fromEntries(clears.filter((name) => !own(name)).map((name) => [name, null])),
		...(isJsonObject(row.statutory_parameters) ? row.statutory_parameters : {})
	};
	return {
		id: String(row.id),
		effective_from: String(row.effective_from),
		patch: {
			...Object.fromEntries(clears.filter(own).map((name) => [name, null])),
			...Object.fromEntries(
				COMPANY_FIELDS.flatMap((field) => {
					const value = row[field];
					return value == null || field === 'statutory_parameters' ? [] : [[field, value]];
				})
			),
			...(Object.keys(parameters).length === 0 ? {} : { statutory_parameters: parameters })
		}
	};
};

/**
 * One company's dated values on a day, from its `entity_change` rows, as formulas read them. A field is replaced whole, the
 * statutory parameters key by key.
 * A day before the first change, and a field no change has set, holds the default.
 */
export const companyOn = (changes: readonly JsonObject[], day: string): JsonObject => {
	const { state } = inForce(changes.map(companyChange), day, COMPANY_DEPTH);
	return {
		pay_methods: state.pay_methods ?? null,
		final_pay_loan_floor_percent: state.final_pay_loan_floor_percent ?? 10,
		overtime_full_award_percent: state.overtime_full_award_percent ?? 100,
		statutory_parameters: state.statutory_parameters ?? {}
	};
};

/** The employer on a day, as a run, a rule and a leave row read it: the company's plain fields with its dated values. */
export const employerOn = (
	entity: JsonObject,
	changes: readonly JsonObject[],
	day: string
): JsonObject => ({ ...entity, entity_id: entity.id ?? null, ...companyOn(changes, day) });
