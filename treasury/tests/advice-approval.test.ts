import { Effect, Exit, Layer, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { Convert } from '@norbital-ai/bolt/engine';
import { TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';

const extracted = (reference: string) => ({
	bank_reference: reference,
	currency: 'USD' as const,
	principal: '100000',
	interest_amount: '430.56',
	due_date: '2026-02-01',
	uncertain: []
});
const Approval = Schema.optionalKey(
	Schema.Struct({ request_id: Schema.String, state: Schema.String })
);
const LinePage = Schema.Struct({
	drawdown: Schema.Struct({
		rows: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				revision: Schema.Number,
				status: Schema.String,
				settled_interest: Schema.NullOr(Schema.String),
				$approval: Approval
			})
		)
	})
});
const DocumentPage = Schema.Struct({
	bank_document: Schema.Struct({
		rows: Schema.Array(
			Schema.Struct({
				id: Schema.String,
				revision: Schema.Number,
				read_status: Schema.String,
				drawdown: Schema.NullOr(Schema.String),
				extracted: Schema.NullOr(Schema.Json),
				$approval: Approval
			})
		)
	})
});

it.layer(
	TestWorkspace.layer({
		root: new URL('..', import.meta.url).pathname,
		ports: Layer.succeed(Convert, {
			targets: [],
			convert: () => Effect.die('No export in this test.'),
			ingest: () =>
				Effect.succeed({
					kind: 'document' as const,
					html: '<p>Synthetic bank advice</p>',
					images: [],
					meta: { stats: { pages: 1, bytes: 100, cpuMs: 0, wallMs: 1 } }
				})
		}),
		fakes: {
			ai: {
				cassette: {
					default: ['SYNTHETIC-001', 'AMBIGUOUS-001', 'UNKNOWN-001'].map((reference) => ({
						content: JSON.stringify({ doc_type: 'settlement_advice', ...extracted(reference) }),
						tool_calls: [],
						finish: 'stop' as const,
						usage: { input: 0, output: 0 }
					}))
				}
			}
		}
	})
)('automatic bank advice approval', (it) => {
	it.effect(
		'holds the financing and evidence together, rejects unauthorized decisions and can resubmit corrected figures',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const treasury = yield* t.as(t.member(['treasury'], { teams: ['treasury'] }));
				const viewer = yield* t.as(t.member(['viewer']));
				const made = yield* treasury.act({
					'drawdown.create': [
						{
							bank_reference: 'SYNTHETIC-001',
							amount: '100000',
							start_date: '2026-01-01',
							due_date: '2026-02-01',
							interest_rate_pct: '5'
						}
					]
				});
				const row = made.records[0];
				if (row === undefined) throw new Error('Missing financing.');
				const line = Schema.decodeUnknownSync(id_of('drawdown'))(row.id);
				const upload = yield* treasury.upload('bank_document.file', {
					name: 'synthetic.pdf',
					mime: 'application/pdf',
					bytes: new TextEncoder().encode('%PDF-1.7 synthetic')
				});
				if (upload.kind !== 'committed') throw new Error('Missing upload.');
				const created = yield* treasury.act({ 'bank_document.create': [{ file: upload.output }] });
				const advice = created.records[0];
				if (advice === undefined) throw new Error('Missing advice.');
				const document = Schema.decodeUnknownSync(id_of('bank_document'))(advice.id);
				expect((yield* t.run_due()).failed).toEqual([]);
				const readLine = () =>
					treasury
						.query({
							drawdown: {
								where: { id: { eq: line } },
								fields: ['status', 'revision', 'settled_interest']
							}
						})
						.pipe(
							Effect.map(Schema.decodeUnknownSync(LinePage)),
							Effect.map((answer) => answer.drawdown.rows[0])
						);
				const readDocument = () =>
					treasury
						.query({
							bank_document: {
								where: { id: { eq: document } },
								fields: ['read_status', 'revision', 'drawdown', 'extracted']
							}
						})
						.pipe(
							Effect.map(Schema.decodeUnknownSync(DocumentPage)),
							Effect.map((answer) => answer.bank_document.rows[0])
						);
				const held = yield* readLine();
				const evidence = yield* readDocument();
				expect(held).toMatchObject({ status: 'settled', $approval: { state: 'Pending' } });
				if (held?.$approval === undefined || evidence === undefined)
					throw new Error('Missing native approval.');
				expect(evidence).toMatchObject({
					read_status: 'applied',
					drawdown: line,
					$approval: { request_id: held.$approval.request_id }
				});
				expect(
					Exit.isFailure(
						yield* Effect.exit(
							viewer.approvals.decide(held.$approval.request_id, { decision: 'approve' })
						)
					)
				).toBe(true);
				expect(
					Exit.isFailure(
						yield* Effect.exit(
							treasury.act({
								'bank_document.update': [
									{
										target: { id: document, revision: evidence.revision },
										set: { extracted: { principal: '1' } }
									}
								]
							})
						)
					)
				).toBe(true);
				yield* treasury.approvals.decide(held.$approval.request_id, {
					decision: 'reject',
					reason: 'Correct the printed interest.'
				});
				expect(yield* readLine()).toMatchObject({ status: 'active', settled_interest: null });
				const restored = yield* readDocument();
				expect(restored).toMatchObject({ read_status: 'checked' });
				if (restored === undefined) throw new Error('Missing restored evidence.');
				yield* treasury.act({
					'bank_document.update': [
						{
							target: { id: document, revision: restored.revision },
							set: { extracted: { ...extracted('SYNTHETIC-001'), interest_amount: '431' } }
						}
					]
				});
				expect((yield* t.run_due()).failed).toEqual([]);
				const corrected = yield* readLine();
				if (corrected?.$approval === undefined) throw new Error('Missing resubmitted approval.');
				expect(corrected.$approval.request_id).not.toBe(held.$approval.request_id);
				expect(corrected.settled_interest).toBe('431');
				yield* treasury.approvals.decide(corrected.$approval.request_id, { decision: 'approve' });
				expect((yield* readLine())?.$approval).toBeUndefined();
				expect((yield* t.run_due()).failed).toEqual([]);
			})
	);

	it.effect(
		'finds ambiguity across query pages, clears old extraction on replacement and records parser failures',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const treasury = yield* t.as(t.member(['treasury'], { teams: ['treasury'] }));
				yield* treasury.act({
					'drawdown.create': [
						{ bank_reference: 'AMBIGUOUS-001', amount: '100000' },
						...Array.from({ length: 1000 }, (_, i) => ({
							bank_reference: `AMBIGUOUS-${1000 + i}`,
							amount: '1'
						})),
						{ bank_reference: 'AMBIGUOUS.001', amount: '100000' }
					]
				});
				const upload = yield* treasury.upload('bank_document.file', {
					name: 'ambiguous.pdf',
					mime: 'application/pdf',
					bytes: new TextEncoder().encode('%PDF-1.7 ambiguous')
				});
				if (upload.kind !== 'committed') throw new Error('Missing upload.');
				const made = yield* treasury.act({ 'bank_document.create': [{ file: upload.output }] });
				const row = made.records[0];
				if (row === undefined) throw new Error('Missing advice.');
				const id = Schema.decodeUnknownSync(id_of('bank_document'))(row.id);
				const read = () =>
					treasury
						.query({
							bank_document: {
								where: { id: { eq: id } },
								fields: ['revision', 'drawdown', 'read_status', 'extracted']
							}
						})
						.pipe(
							Effect.map(Schema.decodeUnknownSync(DocumentPage)),
							Effect.map((answer) => answer.bank_document.rows[0])
						);
				expect((yield* t.run_due()).failed).toEqual([]);
				const ambiguous = yield* read();
				expect(ambiguous).toMatchObject({ drawdown: null, read_status: 'checked' });
				expect(ambiguous?.$approval).toBeUndefined();
				const replacement = yield* treasury.upload('bank_document.file', {
					name: 'replacement.pdf',
					mime: 'application/pdf',
					bytes: new TextEncoder().encode('%PDF-1.7 replacement')
				});
				if (replacement.kind !== 'committed' || ambiguous === undefined)
					throw new Error('Missing replacement.');
				yield* treasury.act({
					'bank_document.update': [
						{ target: { id, revision: ambiguous.revision }, set: { file: replacement.output } }
					]
				});
				expect(yield* read()).toMatchObject({ read_status: 'uploaded', extracted: null });
				expect((yield* t.run_due()).failed).toEqual([]);
				const reread = yield* read();
				expect(reread).toMatchObject({
					drawdown: null,
					read_status: 'checked',
					extracted: { bank_reference: 'UNKNOWN-001' }
				});
				if (reread === undefined) throw new Error('Missing reread.');
				yield* treasury.act({
					'bank_document.update': [
						{ target: { id, revision: reread.revision }, set: { read_status: 'uploaded' } }
					]
				});
				expect((yield* t.run_due()).failed).toHaveLength(1);
				expect(yield* read()).toMatchObject({ read_status: 'failed', extracted: null });
			})
	);
});
