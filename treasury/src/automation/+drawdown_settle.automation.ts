import { automation } from '@norbital-ai/bolt';
import { BigDecimal } from 'effect';
import { decimal, interest, tenorDays } from '../lib/calculations.js';
import { CHARGES_INPUT, documentApplied, replaceStage } from '../lib/charges.js';

/**
 * The settlement advice: the line is repaid and archived with the advice's principal, interest and charges, which
 * replace the settlement stage. The workspace recomputes the interest from the line's start, rate and basis with the
 * bank's rounding; a difference of a cent or more is kept with both figures in its discrepancy note.
 */
export default automation({
	description: 'Record the bank’s settlement advice: the line is repaid and archived.',
	input: {
		line: { kind: 'rows', of: 'drawdown' },
		settlement_date: { kind: 'date' },
		principal: { kind: 'decimal', scale: 2 },
		interest: { kind: 'decimal', scale: 2 },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		charges: CHARGES_INPUT,
		document: { kind: 'ref', to: 'bank_document', optional: true }
	},
	output: { kind: 'object', fields: { discrepancies: { kind: 'int' } } },
	policies: ['bank_advices'],
	run: function* (input, ctx) {
		const row = input.line.findIndex((d) => !['applied', 'active', 'unclear'].includes(d.status));
		if (row >= 0) return yield* ctx.refuse('errors.line_not_open', { row });
		const ids = input.line.map((d) => d.id);
		const { drawdown_charge, drawdown } = yield* ctx.query({
			drawdown_charge: {
				where: { drawdown: { in: ids } },
				fields: ['drawdown', 'stage', 'revision']
			},
			drawdown: {
				where: { id: { in: ids } },
				fields: ['id'],
				facility: { fields: ['interest_rounding'] }
			}
		});
		const rounding = new Map(
			drawdown.rows.map((d) => [d.id, d.facility?.interest_rounding ?? 'nearest_cent'])
		);
		let discrepancies = 0;
		yield* ctx.act({
			'drawdown.update': input.line.map((target) => {
				const rate = input.interest_rate_pct ?? target.interest_rate_pct;
				const expected = interest(
					input.principal,
					rate,
					tenorDays(target.start_date, input.settlement_date),
					target.day_count_basis,
					rounding.get(target.id)
				);
				const differs =
					expected !== null &&
					BigDecimal.isGreaterThanOrEqualTo(
						BigDecimal.abs(BigDecimal.subtract(decimal(expected), decimal(input.interest))),
						decimal('0.01')
					);
				if (differs) discrepancies += 1;
				return {
					target,
					set: {
						status: 'settled' as const,
						settled_by: 'repaid' as const,
						settlement_date: input.settlement_date,
						settled_interest: input.interest,
						is_archived: true,
						...(input.interest_rate_pct == null
							? {}
							: {
									interest_rate_pct: input.interest_rate_pct,
									rate_source: 'bank_advice' as const
								}),
						...(differs
							? {
									discrepancy_note: `Bank charged interest ${input.interest}; expected ${expected}.`
								}
							: {}),
						charges: replaceStage(
							drawdown_charge.rows.filter((c) => c.drawdown === target.id),
							'settlement',
							input.charges ?? []
						)
					}
				};
			}),
			...(input.document == null
				? {}
				: {
						'bank_document.update': yield* documentApplied(
							input.document,
							input.line[0]?.id ?? null,
							'settlement_advice',
							ctx
						)
					})
		});
		return { discrepancies };
	}
});
