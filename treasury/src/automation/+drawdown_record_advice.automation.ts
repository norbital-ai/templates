import { automation, type ActInput } from '@norbital-ai/bolt';
import { CHARGES_INPUT, documentApplied, replaceStage } from '../lib/charges.js';

/**
 * The bank has drawn the line: it becomes active with the advice's number, dates and rate, and the advice's charges
 * replace whatever the drawdown stage held. An agreed rate the advice does not match is replaced by the advice's and
 * the line is marked for review with both figures.
 */
export default automation({
	description: 'Record the bank’s drawdown advice: the line becomes active with its figures.',
	input: {
		line: { kind: 'rows', of: 'drawdown' },
		bank_reference: { kind: 'text' },
		start_date: { kind: 'date' },
		due_date: { kind: 'date' },
		released_date: { kind: 'date', optional: true },
		interest_rate_pct: { kind: 'decimal', scale: 6, optional: true },
		charges: CHARGES_INPUT,
		document: { kind: 'ref', to: 'bank_document', optional: true }
	},
	policies: ['treasury'],
	run: function* (input, ctx) {
		const row = input.line.findIndex((d) => !['earmarked', 'applied', 'active'].includes(d.status));
		if (row >= 0) return yield* ctx.refuse('errors.line_not_open', { row });
		if (input.due_date <= input.start_date) return yield* ctx.refuse('errors.due_before_start');
		const { drawdown_charge } = yield* ctx.query({
			drawdown_charge: {
				where: { drawdown: { in: input.line.map((d) => d.id) } },
				fields: ['drawdown', 'stage', 'revision']
			}
		});
		const updates: ActInput<'drawdown.update'> = input.line.map((target) => {
			const rate = input.interest_rate_pct ?? null;
			const differs =
				rate !== null &&
				target.rate_source === 'manual' &&
				target.interest_rate_pct !== null &&
				Number(target.interest_rate_pct) !== Number(rate);
			return {
				target,
				set: {
					status: 'active' as const,
					bank_reference: input.bank_reference,
					start_date: input.start_date,
					due_date: input.due_date,
					released_date: input.released_date ?? target.released_date ?? input.start_date,
					...(rate === null
						? {}
						: { interest_rate_pct: rate, rate_source: 'bank_advice' as const }),
					...(differs
						? {
								needs_review: true,
								review_note: `Advice rate ${rate}% differs from the agreed ${target.interest_rate_pct}%; the advice rate is used.`
							}
						: {}),
					charges: replaceStage(
						drawdown_charge.rows.filter((c) => c.drawdown === target.id),
						'drawdown',
						input.charges ?? []
					)
				}
			};
		});
		yield* ctx.act({
			'drawdown.update': updates,
			...(input.document == null
				? {}
				: {
						'bank_document.update': yield* documentApplied(
							input.document,
							input.line[0]?.id ?? null,
							'drawdown_advice',
							ctx
						)
					})
		});
	}
});
