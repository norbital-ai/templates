import { automation } from '@norbital-ai/bolt';
import { ADVICE } from '../lib/charges.js';

const key = (value: string | null | undefined) =>
	(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Reads uploaded bank advices into their figures for a person to check beside the PDF. The reader copies and never
 * calculates; anything it is unsure of is listed. An advice not matched yet is matched to the line with the same
 * reference (letters and digits only). Nothing reaches a line until the advice is applied.
 */
export default automation({
	description: 'Read bank advices into their figures for checking; nothing is applied yet.',
	input: { advice: { kind: 'rows', of: 'bank_document' } },
	policies: ['treasury'],
	run: function* ({ advice }, ctx) {
		for (const doc of advice) {
			const read = yield* ctx.ai.sys_2.infer({
				label: 'advice',
				system:
					'You read bank drawdown and settlement advices. Copy figures exactly as printed; never calculate. Leave a field empty rather than guess, and list every field you are unsure of in `uncertain`. Never return account numbers. Charges are in USD; leave a charge out when its USD amount is not printed.',
				prompt: 'Read this advice.',
				files: [doc.file],
				output: ADVICE
			});
			const refs = [read.bank_reference, read.lc_number, read.bill_number]
				.map(key)
				.filter((k) => k.length >= 6);
			const { drawdown } =
				doc.drawdown !== null || refs.length === 0
					? { drawdown: { rows: [] } }
					: yield* ctx.query({
							drawdown: {
								where: { status: { in: ['earmarked', 'applied', 'active', 'settled'] } },
								fields: ['bank_reference', 'lc_number', 'bill_number']
							}
						});
			const match = drawdown.rows.find((d) =>
				[d.bank_reference, d.lc_number, d.bill_number].some(
					(r) => refs.includes(key(r)) && key(r) !== ''
				)
			);
			yield* ctx.act({
				'bank_document.update': [
					{
						target: doc,
						set: {
							extracted: read,
							read_status: 'checked' as const,
							advice_reference: doc.advice_reference ?? read.bank_reference ?? null,
							...(match === undefined ? {} : { drawdown: match.id })
						}
					}
				]
			});
		}
	}
});
