import { Effect, Schema } from 'effect';
import { checkExpression } from './expressions.js';
import { type JsonObject } from './contracts.js';
import { queryRows, type Reader } from './reads.js';
import { Refusal } from './foundation.js';
import { programOf } from './programs.js';
import { paidShareOf } from './engine.js';
import { paramsFor } from './params.js';

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
		const program = programOf(model);
		for (const field of [
			'calculation',
			'eligibility',
			'conversion',
			'paid_share',
			'payout',
			'employee_amount',
			'employer_amount',
			'condition',
			'validate',
			'effects'
		] as const) {
			const source = row[field];
			if (typeof source === 'string' && source.trim() !== '')
				checkExpression(source, 'CALCULATION', undefined, program?.roots);
		}
		// a stated share is refused here, before any run: a leave day pays 0 to 1 of a normal day
		if (model === 'leave_catalog' && Number.isFinite(Number(row.paid_share)))
			yield* Effect.try({
				try: () => paidShareOf(row, () => ({})),
				catch: (cause) =>
					cause instanceof Refusal ? cause : new Refusal({ message: String(cause) })
			});
		const schema = paramsFor(model, String(row.code ?? ''));
		if (schema !== undefined) {
			try {
				Schema.decodeUnknownSync(schema)(row.lookup ?? {});
			} catch (error) {
				return yield* Effect.fail(
					new Refusal({
						message: `${model}: ${String(row.code ?? 'row')}: params do not match the family shape: ${String(error)}`
					})
				);
			}
		}
	}
});
