import { Effect } from 'effect';
import type { Id, WriteCtx } from '@norbital-ai/bolt';
import { requireDraftSettings } from './configuration.js';
import { subtotalChain, statutoryOrder } from './engine.js';
import { checkExpression } from './expressions.js';
import { queryRows } from './reads.js';
import { Refusal } from './foundation.js';

/** Sealing freezes the whole version: expressions parse, the chain is linear, dependencies acyclic. */
export const sealConfiguration = Effect.fn('payroll.sealConfiguration')(function* (
	ctx: WriteCtx<'jurisdiction_settings'>,
	ids: readonly Id<'jurisdiction_settings'>[]
) {
	if (ids.length === 0) return;
	yield* requireDraftSettings(ctx.db.query, ids).pipe(
		Effect.catch((error) => ctx.refuse(error.message))
	);
	const got = yield* queryRows(ctx.db.query, {
		jurisdiction_settings: { where: { id: { in: ids } }, limit: 10000 },
		subtotal: { where: { settings_id: { in: ids } }, limit: 10000 },
		statutory_contribution_catalog: { where: { settings_id: { in: ids } }, limit: 10000 },
		allowance_catalog: { where: { settings_id: { in: ids } }, limit: 10000 },
		overtime_catalog: { where: { settings_id: { in: ids } }, limit: 10000 },
		leave_catalog: { where: { settings_id: { in: ids } }, limit: 10000 },
		claim_catalog: { where: { settings_id: { in: ids } }, limit: 10000 },
		adhoc_catalog: { where: { settings_id: { in: ids } }, limit: 10000 },
		loan_catalog: { where: { settings_id: { in: ids } }, limit: 10000 }
	});
	for (const settings of got.jurisdiction_settings ?? []) {
		const settingsId = String(settings.id);
		const subtotals = (got.subtotal ?? []).filter((row) => row.settings_id === settingsId);
		subtotalChain(subtotals);
		const available = new Set(subtotals.map((row) => String(row.code)));
		statutoryOrder(
			(got.statutory_contribution_catalog ?? []).filter((row) => row.settings_id === settingsId)
		);
		for (const model of [
			'allowance_catalog',
			'overtime_catalog',
			'leave_catalog',
			'claim_catalog',
			'adhoc_catalog',
			'loan_catalog'
		] as const)
			for (const row of (got[model] ?? []).filter((row) => row.settings_id === settingsId))
				for (const field of ['eligibility', 'conversion', 'incurred_on'] as const) {
					const source = row[field];
					if (typeof source === 'string' && source.trim() !== '')
						checkExpression(source, 'CALCULATION', available);
				}
		for (const row of subtotals)
			if (typeof row.calculation === 'string' && row.calculation.trim() !== '')
				checkExpression(row.calculation, 'CALCULATION', available);
	}
	if ((got.jurisdiction_settings ?? []).length !== ids.length)
		throw new Refusal({ message: 'Every sealed version must exist in this workspace.' });
});
