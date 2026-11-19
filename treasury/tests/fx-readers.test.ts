import { Effect, Layer, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { Convert } from '@norbital-ai/bolt/engine';
import { TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';

/** The hedge readers with a fake reader: a term sheet becomes a deal to confirm, a notice ends it, a proposal splits. */
const answer = (value: object) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
const ports = Layer.succeed(Convert, {
	targets: [],
	convert: () => Effect.die('The readers use native ingest.'),
	ingest: () =>
		Effect.succeed({
			kind: 'document' as const,
			html: '<section data-page="1"><p>Synthetic hedge document.</p></section>',
			images: [],
			meta: { stats: { pages: 1, bytes: 100, cpuMs: 0, wallMs: 1 } }
		})
});

it.layer(
	TestWorkspace.layer({
		root: new URL('..', import.meta.url).pathname,
		ports,
		fakes: {
			ai: {
				cassette: {
					default: [
						answer({
							kind: 'term_sheet',
							bank_code: 'SYN',
							bank_reference: 'SYN-FX-0001',
							trade_date: '2026-11-17',
							structure: 'trf',
							pair: 'usd/sgd',
							side: 'sell',
							notional: '400000',
							leveraged_notional: '800000',
							strike: '1.3180',
							target: '0.0250',
							target_rule: 'prorata',
							fixings: [
								{ fixing_date: '2027-01-15', settlement_date: '2027-01-19' },
								{ fixing_date: '2026-12-15', settlement_date: '2026-12-17' }
							]
						}),
						answer({
							kind: 'notice',
							bank_code: 'SYN',
							bank_reference: 'SYN FX 0001',
							termination_date: '2026-12-31'
						}),
						answer({
							alternatives: [
								{
									label: 'Option 1 – TRF',
									pair: 'USDSGD',
									structure: 'trf',
									side: 'sell',
									notional: '300000',
									strike: '1.3200',
									target: '0.0300',
									frequency: 'monthly',
									first_fixing: '2026-12-15',
									count: 3
								},
								{
									label: 'Option 2 – forward',
									pair: 'USDSGD',
									structure: 'fwd',
									side: 'sell',
									notional: '300000',
									strike: '1.3060',
									fixings: [{ fixing_date: '2026-12-15' }]
								}
							]
						})
					]
				}
			}
		}
	})
)('hedge readers', (it) => {
	it.effect('a term sheet becomes a deal to confirm and a termination notice ends it', () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			yield* treasury.act({ 'bank.create': [{ code: 'SYN', name: 'Synthetic Bank' }] });
			const upload = (name: string) =>
				treasury.upload('fx_document.file', {
					name,
					mime: 'application/pdf',
					bytes: new TextEncoder().encode(`%PDF-1.7 ${name}`)
				});
			const sheet = yield* upload('term-sheet.pdf');
			if (sheet.kind !== 'committed') throw new Error('Expected the upload.');
			yield* treasury.act({ 'fx_document.create': [{ file: sheet.output }] });
			yield* t.run_due();
			const read = yield* treasury.query({
				fx_deal: {
					fields: ['status', 'pair', 'structure', 'side', 'strike', 'target', 'ended_on'],
					fixings: { fields: ['fixing_date', 'settlement_date'] }
				},
				fx_document: { fields: ['kind', 'read_status', 'bank_reference', 'deal'] }
			});
			expect(read).toMatchObject({
				fx_deal: {
					rows: [
						{
							status: 'draft',
							pair: 'USDSGD',
							structure: 'trf',
							side: 'sell',
							strike: '1.3180',
							target: '0.0250',
							ended_on: null
						}
					]
				},
				fx_document: {
					rows: [{ kind: 'term_sheet', read_status: 'filed', bank_reference: 'SYN-FX-0001' }]
				}
			});
			expect(read).toMatchObject({
				fx_deal: {
					rows: [
						{
							fixings: expect.arrayContaining([
								expect.objectContaining({ fixing_date: '2026-12-15' }),
								expect.objectContaining({ fixing_date: '2027-01-15' })
							])
						}
					]
				}
			});
			const notice = yield* upload('notice.pdf');
			if (notice.kind !== 'committed') throw new Error('Expected the upload.');
			yield* treasury.act({ 'fx_document.create': [{ file: notice.output }] });
			yield* t.run_due();
			expect(
				yield* treasury.query({
					fx_deal: { fields: ['ended_on'] },
					fx_document: { fields: ['kind', 'deal'] }
				})
			).toMatchObject({
				fx_deal: { rows: [{ ended_on: '2026-12-31' }] },
				fx_document: { total: 2 }
			});
		})
	);
	it.effect("a banker's proposal becomes its alternatives, with a schedule worked out", () =>
		Effect.gen(function* () {
			const t = yield* TestWorkspace;
			const treasury = yield* t.as(t.member(['treasury']));
			const proposal = (yield* treasury.act({
				'fx_proposal.create': [{ text: 'Option 1: TRF K 1.32 ... Option 2: forward at 1.3060' }]
			})).records[0];
			if (proposal === undefined) throw new Error('Expected the proposal.');
			yield* t.run_due();
			const id = Schema.decodeUnknownSync(id_of('fx_proposal'))(proposal.id);
			const read = yield* treasury.query({
				fx_deal: {
					where: { proposal: { eq: id } },
					fields: ['status', 'structure', 'notes'],
					fixings: { fields: ['fixing_date', 'note'] },
					order_by: { notes: 'asc' }
				}
			});
			expect(read).toMatchObject({
				fx_deal: {
					rows: [
						{
							status: 'proposal',
							structure: 'trf',
							fixings: expect.arrayContaining([
								{ id: expect.any(String), fixing_date: '2026-12-15', note: expect.any(String) },
								{ id: expect.any(String), fixing_date: '2027-01-15', note: expect.any(String) },
								{ id: expect.any(String), fixing_date: '2027-02-15', note: expect.any(String) }
							])
						},
						{
							status: 'proposal',
							structure: 'fwd',
							fixings: [{ fixing_date: '2026-12-15', note: null }]
						}
					]
				}
			});
		})
	);
});
