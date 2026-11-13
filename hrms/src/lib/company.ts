import { inForce, type Change } from './dated.js';
import type { JsonObject } from './payroll_engine/foundation.js';

/** What a company changes by date. Every other field of a company is plain: an edit to it was always so. */
export const COMPANY_FIELDS = [
	'pay_methods',
	'final_pay_loan_floor_percent',
	'overtime_full_award_percent',
	'statutory_parameters'
] as const;

/** An `entity_change` row as the fold reads it: the fields it sets, and `null` for each it takes away (`clears`). */
export const companyChange = (row: JsonObject): Change => ({
	id: String(row.id),
	effective_from: String(row.effective_from),
	patch: {
		...Object.fromEntries(
			(Array.isArray(row.clears) ? row.clears : []).flatMap((name) =>
				COMPANY_FIELDS.some((field) => field === name) ? [[String(name), null]] : []
			)
		),
		...Object.fromEntries(
			COMPANY_FIELDS.flatMap((field) => {
				const value = row[field];
				return value == null ? [] : [[field, value]];
			})
		)
	}
});

/**
 * One company's dated values on a day, from its `entity_change` rows, as formulas read them. A field is replaced whole.
 * A day before the first change, and a field no change has set, holds the default.
 */
export const companyOn = (changes: readonly JsonObject[], day: string): JsonObject => {
	const { state } = inForce(changes.map(companyChange), day);
	return {
		pay_methods: state.pay_methods ?? null,
		final_pay_loan_floor_percent: state.final_pay_loan_floor_percent ?? 10,
		overtime_full_award_percent: state.overtime_full_award_percent ?? 100,
		entity_extension_data: state.statutory_parameters ?? {}
	};
};

/** The employer on a day, as a run, a rule and a leave row read it: the company's plain fields with its dated values. */
export const employerOn = (
	entity: JsonObject,
	changes: readonly JsonObject[],
	day: string
): JsonObject => ({ ...entity, entity_id: entity.id ?? null, ...companyOn(changes, day) });
