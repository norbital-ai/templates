import { automation } from '@norbital-ai/bolt';

/**
 * Applies a checked advice to its line: a drawdown advice records the drawdown, a settlement advice settles it, each
 * with the advice's figures and charges. The figures are held with the PDF in the native financing approval.
 */
export default automation({
	description: 'Submit extracted bank advice figures for Treasury approval.',
	input: { advice: { kind: 'rows', of: 'bank_document' } },
	policies: ['bank_advices'],
	run: function* ({ advice }, ctx) {
		const doc = advice[0];
		if (doc === undefined || advice.length !== 1) return yield* ctx.refuse('errors.one_advice');
		const read = doc.extracted;
		if (doc.drawdown === null || read === null) return yield* ctx.refuse('errors.advice_unmatched');
		const charges = (read.charges ?? []).map((c) => ({
			charge_type: c.charge_type,
			amount: c.amount_usd,
			description: c.description ?? null
		}));
		if (doc.doc_type === 'drawdown_advice') {
			if (read.bank_reference == null || read.start_date == null || read.due_date == null)
				return yield* ctx.refuse('errors.advice_incomplete');
			yield* ctx.schedule(
				'drawdown_record_advice',
				{
					line: [doc.drawdown],
					bank_reference: read.bank_reference,
					start_date: read.start_date,
					due_date: read.due_date,
					...(read.interest_rate_pct == null ? {} : { interest_rate_pct: read.interest_rate_pct }),
					charges,
					document: doc.id
				},
				{ key: `advice:${doc.id}:${doc.revision}` }
			);
			return;
		}
		if (doc.doc_type === 'settlement_advice') {
			if (read.due_date == null || read.principal == null)
				return yield* ctx.refuse('errors.advice_incomplete');
			yield* ctx.schedule(
				'drawdown_settle',
				{
					line: [doc.drawdown],
					settlement_date: read.due_date,
					principal: read.principal,
					interest: read.interest_amount ?? '0',
					...(read.interest_rate_pct == null ? {} : { interest_rate_pct: read.interest_rate_pct }),
					charges,
					document: doc.id
				},
				{ key: `advice:${doc.id}:${doc.revision}` }
			);
			return;
		}
		return yield* ctx.refuse('errors.advice_type');
	}
});
