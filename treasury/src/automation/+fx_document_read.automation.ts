import { automation, new_id } from '@norbital-ai/bolt';
import { Effect, Result } from 'effect';
import { documentSource } from '../lib/documents.js';
import { dealFrom, FX_READ, refKey } from '../lib/fx.js';

const SYSTEM = [
	'You read FX hedge documents from banks: term sheets, confirmations, fixing or termination notices and letters.',
	'Copy what is printed; never calculate, never work a spot or forward out from forward points, and leave a field empty rather than guess.',
	'pair is six letters, the base currency first (USDSGD is one USD in SGD); side is whether the company (the bank client) sells or buys the base currency.',
	'Give every fixing, expiry or valuation date with its settlement date; a first firm leg with no fixing date uses its settlement date for both.',
	'target is in quote currency per unit of base: 100 pips is 0.0100 on USD/SGD and 1.00 on USD/JPY; leveraged_notional is an amount, so a leverage of 2x on 300k is 600000.',
	'knock_out_type is continuous when the knock-out can trigger at any time, at_expiry when only on a fixing date.',
	'firm is false for a fixing that happens only if a condition is met; copy that condition word for word.',
	'termination_date is the date an early-termination notice takes effect. Notices and letters usually have no fixings.',
	'Never return account, card or customer numbers. List every field you are unsure of in `uncertain`.'
].join(' ');

/**
 * Reads uploaded hedge documents, scheduled for each upload; without `document` (the seed's first admission) every
 * document still waiting. A document is kept with the deal of the same bank and reference (letters and digits
 * only), else the same bank, pair and trade date when one of the two has no reference. An unmatched term sheet or
 * confirmation becomes a deal to confirm; a termination notice sets its deal's end date if none is set.
 */
export default automation({
	description: 'Read FX hedge documents and keep each with its deal.',
	input: { document: { kind: 'ref', to: 'fx_document', many: true, optional: true } },
	policies: ['fx_reader'],
	run: function* ({ document }, ctx) {
		const { fx_document, bank } = yield* ctx.query({
			fx_document: {
				where: document == null ? { read_status: { eq: 'uploaded' } } : { id: { in: document } },
				fields: ['revision', 'bank', 'deal', 'kind', 'file'],
				limit: 100
			},
			bank: { fields: ['code', 'name'], limit: 200 }
		});
		const banks = bank.rows.map((b) => `${b.code}: ${b.name}`).join('\n');
		const failures = [];
		for (const doc of fx_document.rows) {
			const parsed = yield* Effect.gen(function* () {
				const source = yield* documentSource(doc.file, 'fx_document_read', ctx);
				return yield* ctx.ai.sys_2.infer({
					label: 'fx document',
					system: SYSTEM,
					prompt: `Read this document. Set bank_code to the issuing bank's code from this list, or leave it empty:\n${banks}\nIts parsed text follows; use the attached page images for scanned text.\n\n${source.text}`,
					files: source.files,
					output: FX_READ
				});
			}).pipe(Effect.result);
			if (Result.isFailure(parsed)) {
				yield* ctx.act({
					'fx_document.update': [
						{ target: doc, set: { read_status: 'failed', read_note: parsed.failure.message } }
					]
				});
				failures.push(parsed.failure);
				continue;
			}
			const read = parsed.success;
			const bankId =
				doc.bank ?? bank.rows.find((b) => refKey(b.code) === refKey(read.bank_code))?.id ?? null;
			const { pair, terms, fixings } = dealFrom(read);
			const { fx_deal } = yield* ctx.query({
				fx_deal: {
					where: {
						status: { in: ['draft', 'live'] },
						...(bankId === null ? {} : { bank: { eq: bankId } })
					},
					fields: ['revision', 'bank_reference', 'pair', 'trade_date', 'ended_on'],
					documents: { fields: ['bank_reference'] },
					limit: 1000
				}
			});
			const refs = [read.bank_reference, ...(read.other_references ?? [])]
				.map(refKey)
				.filter((k) => k.length > 0);
			const byRef = fx_deal.rows.filter((d) =>
				[d.bank_reference, ...d.documents.map((x) => x.bank_reference)].some((r) =>
					refs.includes(refKey(r))
				)
			);
			const byTrade = fx_deal.rows.filter(
				(d) =>
					pair !== null &&
					read.trade_date != null &&
					d.pair === pair &&
					d.trade_date === read.trade_date &&
					(read.bank_reference == null || d.bank_reference === null)
			);
			const matched =
				doc.deal ??
				(byRef.length === 1 ? byRef[0]?.id : byTrade.length === 1 ? byTrade[0]?.id : undefined) ??
				null;
			const kind = doc.kind === 'other' ? (read.kind ?? 'other') : doc.kind;
			const trade = kind === 'term_sheet' || kind === 'confirmation';
			const fresh = matched === null && trade && pair !== null ? new_id('fx_deal') : null;
			const ending = fx_deal.rows.find((d) => d.id === matched && d.ended_on === null);
			yield* ctx.act({
				...(fresh === null || pair === null
					? {}
					: {
							'fx_deal.create': [
								{ id: fresh, bank: bankId, pair, status: 'draft' as const, ...terms, fixings }
							]
						}),
				...(ending === undefined || read.termination_date == null
					? {}
					: { 'fx_deal.update': [{ target: ending, set: { ended_on: read.termination_date } }] }),
				'fx_document.update': [
					{
						target: doc,
						set: {
							kind,
							bank: bankId,
							deal: matched ?? fresh,
							bank_reference: read.bank_reference ?? null,
							trade_date: read.trade_date ?? null,
							signed: read.signed ?? null,
							extracted: read,
							read_status:
								matched !== null || fresh !== null ? ('filed' as const) : ('checked' as const),
							read_note: null
						}
					}
				]
			});
		}
		if (failures[0] !== undefined) return yield* Effect.fail(failures[0]);
	}
});
