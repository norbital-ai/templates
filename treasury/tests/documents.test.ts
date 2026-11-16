import { Effect, Layer, Schema } from 'effect';
import { id_of } from '@norbital-ai/bolt';
import { Convert } from '@norbital-ai/bolt/engine';
import { JobResult, TestWorkspace, expect, it } from '@norbital-ai/bolt-cli/test';

const pages: (number | undefined)[] = [];
const answer = (value: object) => ({
	content: JSON.stringify(value),
	tool_calls: [],
	finish: 'stop' as const,
	usage: { input: 0, output: 0 }
});
const image = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4x8AAAAASUVORK5CYII='
	),
	(c) => c.charCodeAt(0)
);
const ports = Layer.succeed(Convert, {
	targets: [],
	convert: () => Effect.die('This reader uses native ingest, not document export.'),
	ingest: (_file, options) =>
		Effect.sync(() => {
			pages.push(options.page);
			return {
				kind: 'document' as const,
				html:
					options.page === undefined
						? '<section data-page="1">\n<p>No text on this page.</p>\n</section>'
						: '<p><img src="page.png"></p>',
				images:
					options.page === undefined ? [] : [{ name: 'page.png', mime: 'image/png', bytes: image }],
				meta: { stats: { pages: 1, bytes: 100, cpuMs: 0, wallMs: 1 } }
			};
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
						{
							content: JSON.stringify({
								bank_reference: 'SYNTHETIC-001',
								currency: 'USD',
								principal: '100000',
								interest_amount: '416.67',
								uncertain: []
							}),
							tool_calls: [],
							finish: 'stop',
							usage: { input: 0, output: 0 }
						},
						answer({
							customer_po_number: 'BUYER-123',
							customer: 'Synthetic Buyer',
							vendor: 'Wrong customer vendor',
							total_amount: '9999'
						}),
						answer({
							supplier_payment_terms: '30% deposit, balance against documents',
							currency: 'USD',
							total_amount: '900',
							vendor: 'Wrong proforma vendor'
						}),
						answer({
							po_number: 'PO-SYN-001',
							vendor: 'Synthetic Supplier',
							currency: 'USD',
							total_amount: '1000',
							payment_terms: 'LC at sight'
						})
					]
				}
			}
		}
	})
)('document readers', (it) => {
	it.effect(
		'automatically reads an uploaded scanned advice and keeps an unmatched document out of the book',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const treasury = yield* t.as(t.member(['treasury']));
				const upload = yield* treasury.upload('bank_document.file', {
					name: 'synthetic.pdf',
					mime: 'application/pdf',
					bytes: new TextEncoder().encode('%PDF-1.7 synthetic fixture')
				});
				if (upload.kind !== 'committed') throw new Error('Expected the PDF upload.');
				const created = yield* treasury.act({
					'bank_document.create': [{ file: upload.output, doc_type: 'settlement_advice' }]
				});
				const document = created.records[0];
				if (document === undefined) throw new Error('Expected the uploaded advice.');
				const id = Schema.decodeUnknownSync(id_of('bank_document'))(document.id);
				yield* t.run_due();
				const read = yield* treasury.query({
					bank_document: { where: { id: { eq: id } }, fields: ['read_status', 'extracted'] },
					drawdown: { aggregate: { count: true } }
				});
				expect(read).toMatchObject({
					bank_document: {
						rows: [
							{
								read_status: 'checked',
								extracted: { bank_reference: 'SYNTHETIC-001', principal: '100000' }
							}
						]
					},
					drawdown: { count: 0 }
				});
				expect(pages).toEqual([undefined, 1]);
				expect(t.fakes.ai?.requests[0]?.files).toEqual([
					expect.objectContaining({ mime: 'image/png' })
				]);
			})
	);
	it.effect(
		'keeps each attachment in its business role and preserves values the purchaser has already entered',
		() =>
			Effect.gen(function* () {
				const t = yield* TestWorkspace;
				const purchaser = yield* t.as(t.member(['purchasing']));
				const treasury = yield* t.as(t.member(['treasury']));
				const supplier = (yield* treasury.act({
					'business_partner.create': [{ name: 'Synthetic Supplier' }]
				})).records[0];
				if (supplier === undefined) throw new Error('Expected the supplier.');
				const po = (yield* purchaser.act({
					'purchase_order.create': [
						{
							po_number: 'PO-SYN-001',
							po_date: '2026-11-01',
							supplier: Schema.decodeUnknownSync(id_of('business_partner'))(supplier.id),
							lines: [{ item: 'Synthetic item', quantity: '10', amount: '1200' }]
						}
					]
				})).records[0];
				if (po === undefined) throw new Error('Expected the PO.');
				const attachments = [];
				for (const kind of ['purchase_order', 'proforma', 'customer_po'] as const) {
					const upload = yield* purchaser.upload('facility_attachment.file', {
						name: `${kind}.pdf`,
						mime: 'application/pdf',
						bytes: new TextEncoder().encode(`%PDF-1.7 synthetic ${kind}`)
					});
					if (upload.kind !== 'committed') throw new Error('Expected the attachment upload.');
					attachments.push({ kind, title: kind, file: upload.output });
				}
				const form = (yield* purchaser.act({
					'facility_form.create': [
						{
							po_number: 'PO-SYN-001',
							amount: '1200',
							currency: 'EUR',
							facility_required: 'tt',
							payment_terms: 'Manually agreed terms',
							pay_by_date: '2026-12-01',
							attachments
						}
					]
				})).records[0];
				if (form === undefined) throw new Error('Expected the facility form.');
				const id = Schema.decodeUnknownSync(id_of('facility_form'))(form.id);
				yield* purchaser.run('facility_form_read', { form: [id] }, JobResult);
				yield* t.run_due();
				const read = yield* purchaser.query({
					facility_form: {
						where: { id: { eq: id } },
						fields: [
							'amount',
							'currency',
							'facility_required',
							'payment_terms',
							'pay_by_date',
							'vendor',
							'remarks',
							'customer_po_number',
							'purpose',
							'purchase_order',
							'read_note'
						]
					}
				});
				expect(read).toMatchObject({
					facility_form: {
						rows: [
							{
								amount: '1200',
								currency: 'EUR',
								facility_required: 'tt',
								payment_terms: 'Manually agreed terms',
								pay_by_date: '2026-12-01',
								vendor: 'Synthetic Supplier',
								remarks: '30% deposit, balance against documents',
								customer_po_number: 'BUYER-123',
								purpose: 'For Synthetic Buyer PO BUYER-123',
								purchase_order: po.id,
								read_note: expect.stringContaining('proforma total differs')
							}
						]
					}
				});
			})
	);
});
