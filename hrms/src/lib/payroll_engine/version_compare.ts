import type { JsonObject } from './contracts.js';
import type { Json } from './foundation.js';

/** Every child of a jurisdiction version, compared row by row. */
export const COMPARED = [
	'subtotal',
	'allowance_catalog',
	'overtime_catalog',
	'statutory_contribution_catalog',
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'workplace_case_catalog',
	'registered_rule',
	'registered_effect'
] as const;
const OWN = new Set([
	'id',
	'revision',
	'created_at',
	'updated_at',
	'created_by',
	'updated_by',
	'settings_id'
]);
const SUBTOTAL_REFS = new Set(['subtotal_id', 'employer_cost_subtotal_id', 'previous_id']);

/**
 * A version as one comparable JSON document: what each version owns of itself (ids, audit, its binding) goes, a subtotal
 * reference reads by code, because every version has its own subtotal rows, and a family is keyed by row code, so the
 * shared diff marks each changed field rather than a row of collapsed cells. Pure.
 */
export const comparableVersion = (
	settings: JsonObject,
	children: { readonly [family: string]: readonly JsonObject[] }
): { readonly [key: string]: Json } => {
	const codes = new Map((children.subtotal ?? []).map((row) => [row.id, row.code ?? null]));
	const own = (row: JsonObject): JsonObject =>
		Object.fromEntries(
			Object.entries(row)
				.filter(([key]) => !OWN.has(key) && !key.startsWith('$'))
				.map(([key, value]) => [
					key,
					SUBTOTAL_REFS.has(key) ? (codes.get(value ?? '') ?? value ?? null) : value
				])
		);
	return {
		settings: own(settings),
		...Object.fromEntries(
			COMPARED.map((family) => [
				family,
				Object.fromEntries((children[family] ?? []).map(own).map((row) => [String(row.code), row]))
			])
		)
	};
};
