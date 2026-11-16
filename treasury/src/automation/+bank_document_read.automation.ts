import { automation, type Cursor } from '@norbital-ai/bolt';
import { Effect, Result } from 'effect';
import { ADVICE } from '../lib/charges.js';
import { documentSource } from '../lib/documents.js';

const key = (value: string | null | undefined) =>
	(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Reads uploaded bank advices into their figures for a person to check beside the PDF. The reader copies and never
 * calculates; anything it is unsure of is listed. An advice not matched yet is matched to the line with the same
 * reference (letters and digits only). A unique match automatically submits its figures through Treasury approval.
 */
export default automation({
	description: 'Extract bank advice figures and match one open financing line.',
	input: { advice: { kind: 'rows', of: 'bank_document' } },
	policies: ['bank_advices'],
	run: function* ({ advice }, ctx) {
		for (const doc of advice) {
			const parsed = yield* Effect.gen(function* () {
				const source = yield* documentSource(doc.file, 'bank_document_read', ctx);
				return yield* ctx.ai.sys_2.infer({
					label: 'advice',
					system:
						'You read bank drawdown and settlement advices. Classify doc_type as drawdown_advice, settlement_advice or other from the document, never guess. Copy figures exactly as printed; never calculate. Leave a field empty rather than guess, and list every field you are unsure of in `uncertain`. Never return account numbers. Charges are in USD; leave a charge out when its USD amount is not printed.',
					prompt: `Read this advice. Its parsed text follows; use the attached page images for scanned text.\n\n${source.text}`,
					files: source.files,
					output: {
						...ADVICE,
						fields: {
							...ADVICE.fields,
							doc_type: {
								kind: 'enum',
								values: ['drawdown_advice', 'settlement_advice', 'other'],
								optional: true
							}
						}
					}
				});
			}).pipe(Effect.result);
			if (Result.isFailure(parsed)) {
				yield* ctx.act({
					'bank_document.update': [
						{ target: doc, set: { read_status: 'failed', read_note: parsed.failure.message } }
					]
				});
				return yield* Effect.fail(parsed.failure);
			}
			const { doc_type: inferredType, ...read } = parsed.success;
			const refs = [read.bank_reference, read.lc_number, read.bill_number]
				.map(key)
				.filter((k) => k.length >= 6);
			const readLines = (after: Cursor | null) =>
				ctx.query({
					drawdown: {
						where: { status: { in: ['earmarked', 'applied', 'active', 'unclear'] } },
						fields: ['bank_reference', 'lc_number', 'bill_number', 'currency'],
						facility: { fields: ['name'], bank: { fields: ['code'] } },
						order_by: { bank_reference: 'asc' },
						limit: 1000,
						...(after === null ? {} : { after })
					}
				});
			const { drawdown } =
				doc.drawdown !== null || refs.length === 0
					? { drawdown: { rows: [], next: null } }
					: yield* readLines(null);
			const isMatch = (d: (typeof drawdown.rows)[number]) =>
				(doc.bank === null || d.facility?.bank?.id === doc.bank) &&
				(read.currency == null || read.currency === d.currency) &&
				[d.bank_reference, d.lc_number, d.bill_number].some(
					(r) => refs.includes(key(r)) && key(r) !== ''
				);
			const matches = drawdown.rows.filter(isMatch);
			let next = drawdown.next;
			// A later page can contain another match; two matches already establish ambiguity.
			while (next !== null && matches.length < 2) {
				const page = yield* readLines(next);
				matches.push(...page.drawdown.rows.filter(isMatch));
				next = page.drawdown.next;
			}
			const match = matches.length === 1 ? matches[0] : undefined;
			yield* ctx.act({
				'bank_document.update': [
					{
						target: doc,
						set: {
							extracted: read,
							read_status: 'checked' as const,
							read_note: null,
							...(doc.doc_type === 'other' && inferredType != null
								? { doc_type: inferredType }
								: {}),
							advice_reference: doc.advice_reference ?? read.bank_reference ?? null,
							...(match === undefined
								? {}
								: { drawdown: match.id, bank: doc.bank ?? match.facility?.bank?.id ?? null })
						}
					}
				]
			});
		}
	}
});
