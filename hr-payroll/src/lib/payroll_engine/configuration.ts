import { Effect, Schema } from 'effect';
import type { WriteCtx } from '@norbital-ai/bolt';
import { checkExpression } from './expressions.js';
import { PHASE_ROOTS, type JsonObject } from './contracts.js';
import { queryRows, valueText, type Reader } from './reads.js';
import { Refusal } from './foundation.js';

export const CONFIG_CHILDREN = [
	'leave_catalog',
	'claim_catalog',
	'adhoc_catalog',
	'loan_catalog',
	'allowance_catalog',
	'overtime_catalog',
	'workplace_case_catalog',
	'work_interruption_catalog',
	'subtotal',
	'statutory_contribution_catalog',
	'registered_rule',
	'registered_effect'
] as const;

export const requireDraftSettings = Effect.fn('payroll.requireDraftSettings')(function* (
	read: Reader,
	ids: readonly string[]
) {
	const data = yield* queryRows(read, {
		jurisdiction_settings: {
			where: { id: { in: [...new Set(ids)] } },
			limit: 10000
		}
	});
	const rows = data.jurisdiction_settings ?? [];
	if (rows.length !== new Set(ids).size || rows.some((row) => row.status !== 'DRAFT'))
		return yield* Effect.fail(
			new Refusal({ message: 'Only a draft jurisdiction configuration can be changed.' })
		);
	return rows;
});

/** Draft ownership guard shared by every configuration child. */
export const guardConfigurationRows = Effect.fn('payroll.guardConfigurationRows')(function* (
	read: Reader,
	model: string,
	rows: readonly object[],
	settingsIds: readonly string[]
) {
	yield* requireDraftSettings(read, settingsIds);
	for (const row of rows as readonly JsonObject[]) {
		if (row.lookup !== undefined && (row.lookup === null || typeof row.lookup !== 'object'))
			return yield* Effect.fail(new Refusal({ message: `${model}: lookup must be an object.` }));
		for (const field of [
			'calculation',
			'eligibility',
			'conversion',
			'incurred_on',
			'employee_amount',
			'employer_amount',
			'condition',
			'validate',
			'effects'
		] as const) {
			const source = row[field];
			if (typeof source === 'string' && source.trim() !== '')
				checkExpression(source, 'CALCULATION');
		}
	}
});

export const guardConfiguration = <M extends string>(ctx: WriteCtx<M>, ids: readonly string[]) =>
	requireDraftSettings(ctx.db.query, ids);

export function registeredEvents(row: JsonObject): void {
	const events = row.events;
	if (!Array.isArray(events) || events.length === 0)
		throw new Refusal({
			message: `${valueText(row, 'code')}: register at least one event.`
		});
	const roots = new Set<unknown>(PHASE_ROOTS.CALCULATION);
	void roots;
	void Schema;
}
