import { automation, type Cursor } from '@norbital-ai/bolt';
import { Effect, Result } from 'effect';
import { ADVICE } from '../lib/charges.js';
import { documentSource } from '../lib/documents.js';

const key = (value: string | null | undefined) =>
	(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Reads uploaded bank advices into their figures for a person to check beside the PDF. The reader copies and never
 * calculates; anything it is unsure of is listed. It also names the advice's type, issuing bank and date, and matches
 * an advice not matched yet to the line with the same reference (letters and digits only), its invoices' bank
 * bill numbers included. A unique match
 * automatically submits its figures through Treasury approval. Scheduled for each upload; without `advice` (the
 * seed's first admission) it reads every advice still waiting to be read.
 */
export default automation({
	description: 'Extract bank advice figures and match one open financing line.',
	input: { advice: { kind: 'ref', to: 'bank_document', many: true, optional: true } },
	policies: ['bank_advices'],
	run: function* ({ advice }, ctx) {
		const { bank_document, bank } = yield* ctx.query({
			bank_document: {
				where: advice == null ? { read_status: { eq: 'uploaded' } } : { id: { in: advice } },
				fields: [
					'revision',
					'bank',
					'drawdown',
					'doc_type',
					'advice_reference',
					'advice_date',
					'file'
				],
				limit: 100
			},
			bank: { fields: ['code', 'name'], limit: 200 }
		});
		const banks = bank.rows.map((b) => `${b.code}: ${b.name}`).join('\n');
		const failures = [];
		for (const doc of bank_document.rows) {
			const parsed = yield* Effect.gen(function* () {
				const source = yield* documentSource(doc.file, 'bank_document_read', ctx);
				return yield* ctx.ai.sys_2.infer({
					label: 'advice',
					system:
						'You read bank drawdown and settlement advices. Classify doc_type as drawdown_advice, settlement_advice or other from the document, never guess. Copy figures exactly as printed; never calculate. bill_number is the customer-side reference the bank quotes back (printed as Your ref, Old bill ref or Invoice no.). Leave a field empty rather than guess, and list every field you are unsure of in `uncertain`. Never return account numbers. Charges are in USD; leave a charge out when its USD amount is not printed.',
					prompt: `Read this advice. Set bank_code to the issuing bank's code from this list, or leave it empty:\n${banks}\nSet advice_date to the date the advice is issued. Its parsed text follows; use the attached page images for scanned text.\n\n${source.text}`,
					files: source.files,
					output: {
						...ADVICE,
						fields: {
							...ADVICE.fields,
							doc_type: {
								kind: 'enum',
								values: ['drawdown_advice', 'settlement_advice', 'other'],
								optional: true
							},
							bank_code: { kind: 'text', optional: true },
							advice_date: { kind: 'date', optional: true }
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
				failures.push(parsed.failure);
				continue;
			}
			const { doc_type: inferredType, bank_code, advice_date, ...read } = parsed.success;
			const issuer = doc.bank ?? bank.rows.find((b) => key(b.code) === key(bank_code))?.id ?? null;
			const refs = [read.bank_reference, read.lc_number, read.bill_number]
				.map(key)
				.filter((k) => k.length >= 6);
			const readLines = (after: Cursor | null) =>
				ctx.query({
					drawdown: {
						where: { status: { in: ['earmarked', 'applied', 'active', 'unclear'] } },
						fields: ['bank_reference', 'lc_number', 'bill_number', 'currency'],
						facility: { fields: ['name'], bank: { fields: ['code'] } },
						invoices: { fields: ['bank_bill_number'] },
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
				(issuer === null || d.facility?.bank?.id === issuer) &&
				(read.currency == null || read.currency === d.currency) &&
				[
					d.bank_reference,
					d.lc_number,
					d.bill_number,
					...d.invoices.map((i) => i.bank_bill_number)
				].some((r) => refs.includes(key(r)) && key(r) !== '');
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
							advice_date: doc.advice_date ?? advice_date ?? null,
							bank: issuer ?? match?.facility?.bank?.id ?? null,
							...(match === undefined ? {} : { drawdown: match.id })
						}
					}
				]
			});
		}
		if (failures[0] !== undefined) return yield* Effect.fail(failures[0]);
	}
});
