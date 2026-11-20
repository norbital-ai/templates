import { randomUUID } from 'node:crypto';
import { fixtureId, firstRow } from './test-runtime.js';
import * as Base64 from 'effect/encoding/Base64';
import { Schema, Effect, Layer, Result } from 'effect';
import { expect, it, layer } from '@effect/vitest';
import { Trade, draft, confirm, committed, shared, PRODUCT, SETTINGS, type T } from './kit.js';
import { Convert } from '@norbital-ai/bolt/engine';
import { cnyInWords, printAmounts } from '../src/lib/print-amounts.js';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import {
	documentRead,
	documentSource,
	renderOrderDocument,
	renderPrintLayout,
	validateDocumentTemplate
} from '../src/lib/order-document.js';
import { documentOf } from './reads.js';
import { snapshot } from '../src/lib/commercial.js';
it('document templates keep agreement content and escape all substituted text', () => {
	expect(() => validateDocumentTemplate('{title}')).toThrow();
	expect(() => validateDocumentTemplate('{agreement} {unknown}')).toThrow();
	expect(() => validateDocumentTemplate('{agreement} {amendment}')).toThrow();
	const html = renderOrderDocument('<script>Title</script>', '{agreement}\n{reference}', {
		agreement: '<img src="https://example.test" onerror="alert(1)">\n{amendment}',
		reference: '<script>alert(1)</script>'
	});
	expect(html).not.toContain('<script>');
	expect(html).not.toContain('<img');
	expect(html).toContain('&lt;img');
	expect(html).toContain('{amendment}');
	expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});
it('a print layout escapes fields and rejects unknown fields or repeated line blocks', () => {
	const fields = { reference: 'A<&' };
	const lines = [{ product: '<first>' }, { product: '&second' }];
	const table = '<h1>{{reference}}</h1>{{#lines}}<p>{{product}}</p>{{/lines}}';
	expect(renderPrintLayout(table, fields, lines)).toBe(
		'<h1>A&lt;&amp;</h1><p>&lt;first&gt;</p><p>&amp;second</p>'
	);
	expect(() => renderPrintLayout('{{cost2}}', fields, lines)).toThrow('Unknown print field');
	expect(() => renderPrintLayout(table + table, fields, lines)).toThrow('matched print line block');
	expect(() => renderPrintLayout('{{#lines}}{{cost}}', fields, lines)).toThrow(
		'matched print line block'
	);
});

it('writes retained CNY amounts in financial uppercase without dropping zero positions', () => {
	expect(cnyInWords('0.00')).toBe('零元整');
	expect(cnyInWords('0.50')).toBe('伍角整');
	expect(cnyInWords('100000001.01')).toBe('壹亿零壹元零壹分');
	expect(cnyInWords('562450.00')).toBe('伍拾陆万贰仟肆佰伍拾元整');
	expect(cnyInWords('1000000000000.00')).toBe('');
});
const converted: string[] = [];
const printed: string[] = [];
const workspace = shared({
	ports: Layer.succeed(Convert, {
		targets: ['pdf'],
		convert: () =>
			Effect.fail(
				new FacilityFailure({ kind: 'invalid', message: 'No stored conversion expected' })
			),
		previewPdf: (source) =>
			Effect.gen(function* () {
				if ('layout_html' in source) {
					printed.push(source.layout_html);
					return new TextEncoder().encode(source.layout_html);
				}
				if (!('html' in source))
					return yield* new FacilityFailure({ kind: 'invalid', message: 'HTML required' });
				converted.push(source.html);
				return new TextEncoder().encode(source.html);
			})
	})
});
const renderPreview = Effect.fnUntraced(function* (
	t: T,
	document: Effect.Success<ReturnType<typeof documentOf>> & { signature?: string | null }
) {
	const source = yield* documentSource(document, (file) =>
		Effect.gen(function* () {
			const [asset] = yield* t.db.rows(Schema.Struct({ key: Schema.String }), {
				text: 'SELECT key FROM sys_file WHERE id=$1',
				params: [file.id]
			});
			const bytes = asset && t.fakes.files.blobs.get(asset.key);
			if (bytes === undefined) throw new Error('Stored print asset required');
			return bytes;
		})
	);
	const fileCount = t.db.rows(Schema.Struct({ count: Schema.Number }), {
		text: 'SELECT count(*)::int AS count FROM sys_file',
		params: []
	});
	const before = yield* fileCount;
	const blobs = t.fakes.files.blobs.size;
	const actor = t.admin.actor;
	if (actor.kind !== 'member') throw new Error('Preview requires a member session');
	const cookie = yield* t.session(actor.id);
	const response = yield* t.handle(
		new Request('http://localhost/__bolt/act', {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
			body: JSON.stringify({
				callable: 'convert.previewPdf',
				input: { source, options: { page: 'A4' } },
				issued_at: t.clock.now()
			})
		})
	);
	expect(response.status).toBe(200);
	expect(response.headers.get('content-type')).toBe('application/pdf');
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	const answer = yield* Effect.promise(() => response.text());
	expect(yield* fileCount).toEqual(before);
	expect(t.fakes.files.blobs.size).toBe(blobs);
	return answer;
});

layer(workspace, { excludeTestServices: true })('order documents', (test) => {
	test.effect('Sales has a direct full record only for the signed-in system user', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const seller = t.member(['sales']);
			const other = t.member(['sales']);
			const { sys_user } = yield* (yield* t.as(seller)).query({
				sys_user: {
					where: {
						id: { in: [fixtureId('sys_user', seller.id), fixtureId('sys_user', other.id)] }
					},
					fields: ['name']
				}
			});
			expect(sys_user.rows.map((row) => row.id)).toEqual([seller.id]);
		})
	);

	test.effect('a named HTML layout exports the saved order through the print renderer', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = yield* t.as(t.admin);
			const html =
				'<!doctype html><html><style>@page{size:A4;margin:20mm}</style><body>' +
				'<h1>{{title}}</h1><p>{{reference}} · {{party}} · {{detail_buyer_reference}} · {{customer_po_no}} · {{detail_terms}}</p><ul>' +
				'{{#lines}}<li>{{product_code}}: {{quantity_tonnes}} t · {{gross_unit_price_per_tonne}} · {{detail_brand}}</li>{{/lines}}</ul><b>{{total}}</b><p>{{terms}}</p></body></html>';
			const upload = yield* admin.upload('document_templates.print_layout', {
				name: 'approved-print.html',
				mime: 'text/html',
				bytes: new TextEncoder().encode(html)
			});
			if (upload.kind !== 'committed') throw new Error('Print layout upload required');
			const layout = committed(
				'document_templates',
				yield* admin.act({
					'document_templates.create': [
						{
							kind: 'purchase_contract',
							title: 'Approved print layout',
							locale: 'en',
							body: '{agreement}\nDelivery by arrangement.',
							print_layout: upload.output,
							print_fields: [
								{
									key: 'buyer_reference',
									label: 'Buyer reference',
									scope: 'order',
									multiline: true
								},
								{
									key: 'terms',
									label: 'Terms',
									translation: '条款版本',
									scope: 'order',
									options: 'Advance | 预收款\nCredit | 账期',
									default_value: 'Advance'
								},
								{ key: 'brand', label: 'Brand', scope: 'line', default_value: 'Standard' }
							]
						}
					]
				})
			);
			yield* admin.act({
				'document_templates.update': [
					{ target: yield* t.at('document_templates', layout), set: { status: 'published' } }
				]
			});
			const { order, line } = yield* draft(t, 'purchasing');
			yield* admin.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: {
							customer_po_no: 'PO-77',
							print_values: [{ key: 'buyer_reference', value: 'BUY <42>\nNorth entrance' }]
						}
					}
				]
			});
			yield* admin.act({
				'order_lines.update': [
					{
						target: yield* t.at('order_lines', line),
						set: { print_values: [{ key: 'brand', value: 'Synthetic & Co' }] }
					}
				]
			});
			yield* confirm(t, order);
			const document = yield* documentOf(admin, { order });
			const print = document.print;
			expect(print?.file.id).toBe(upload.output.id);
			if (!print) throw new Error('Print layout required');
			printed.length = 0;
			expect(yield* renderPreview(t, document)).toBe(
				renderPrintLayout(html, print.fields, print.lines)
			);
			expect(printed).toEqual([renderPrintLayout(html, print.fields, print.lines)]);
			expect(printed[0]).toContain('<h1>Approved print layout</h1>');
			expect(printed[0]).toContain('<b>21.80</b><p>Delivery by arrangement.</p>');
			expect(printed[0]).toContain('0.010 t · 2,180.00 · Synthetic &amp; Co');
			expect(printed[0]).toContain('BUY &lt;42&gt;\nNorth entrance · PO-77 · Advance');
			const saved = firstRow((yield* admin.query(documentRead(order))).orders.rows);
			if (!saved.party) throw new Error('Expected the saved print fixture');
			const sealed = snapshot(
				saved,
				saved.party,
				saved.lines.flatMap(({ product, ...line }) =>
					product ? [{ ...line, product: product.id }] : []
				),
				'1',
				{
					payment_terms: saved.payment_terms?.name ?? '',
					buyer: { name: '', phone: '', email: '' }
				}
			);
			const lineBasis = firstRow(sealed.lines);
			const kg = { ...lineBasis, quantity: '81000.000', unit_price: '1.6532', unit: 'kg' };
			expect(printAmounts({ ...sealed, lines: [kg] })).toMatchObject({
				fields: { quantity_grouped: '81,000' },
				lines: [{ quantity_grouped: '81,000', unit_price_grouped: '1.6532', unit_export: 'KGS' }]
			});
			// a quotation shows a kilogram line in tonnes, priced per tonne to two places
			expect(printAmounts({ ...sealed, lines: [kg] }, 'zh')).toMatchObject({
				fields: { currency_symbol: '$' },
				lines: [
					{
						line_number: '1',
						quantity_display: '81',
						unit_display: '吨',
						unit_price_display: '1,653.20',
						tax_rate_display: '9.00'
					}
				]
			});
			expect(
				printAmounts({ ...sealed, lines: [{ ...kg, quantity: '1234.500', unit: 'pcs' }] }, 'en')
					.lines[0]
			).toMatchObject({
				quantity_display: '1,234.500',
				unit_display: 'pcs',
				unit_price_display: '1.65'
			});
			// the seller prints by name, also for teams that read orders but not people
			yield* t.db.write({
				text: 'UPDATE sys_user SET name = $1 WHERE id = $2',
				params: ['Sample Seller', saved.owner]
			});
			for (const policy of ['procurement', 'manager'] as const) {
				const reader = yield* t.as(t.member([policy]));
				expect((yield* documentOf(reader, { order })).print?.fields).toMatchObject({
					owner: 'Sample Seller',
					logistics_handler: ''
				});
			}
			expect(print.lines[0]).toMatchObject({ line_number: '1', brand: '', producing_area: '' });
			expect(
				printAmounts({ ...sealed, lines: [kg, { ...kg, quantity: '1.250', unit: '吨' }] })
			).toMatchObject({
				fields: { quantity_grouped: '' },
				lines: [{}, { quantity_grouped: '1.25', unit_export: 'MT' }]
			});
			yield* admin.act({
				'orders.update': [
					{
						target: yield* t.at('orders', order),
						set: { print_values: [{ key: 'buyer_reference', value: 'BUY 43' }] }
					}
				]
			});
			yield* admin.act({
				'order_lines.update': [
					{
						target: yield* t.at('order_lines', line),
						set: { quantity: '20', print_values: [{ key: 'brand', value: '' }] }
					}
				]
			});
			const next = yield* documentOf(admin, { order });
			expect(next.print?.fields).toMatchObject({ detail_buyer_reference: 'BUY 43' });
			expect(next.print?.lines[0]).toMatchObject({ detail_brand: '', quantity_tonnes: '0.020' });
		})
	);
	test.effect('a document lists lines in the order they were entered', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = yield* t.as(t.admin);
			// the purchase contract published above has an HTML print layout; lines are entered a second apart
			const start = t.clock.now();
			const { order, line } = yield* draft(t, 'purchasing');
			const entered = [line];
			for (const quantity of ['20', '30', '40', '50']) {
				t.clock.advance('1s');
				entered.push(
					committed(
						'order_lines',
						yield* admin.act({
							'order_lines.create': [
								{
									order,
									product: PRODUCT,
									quantity,
									unit_price: '2',
									discount_pct: '0',
									tax_rate: '9'
								}
							]
						})
					)
				);
			}
			t.clock.set(start);
			const { order_lines } = yield* admin.query({
				order_lines: { where: { order: { eq: order } }, fields: ['quantity'] }
			});
			const quantity = new Map(order_lines.rows.map((row) => [row.id, row.quantity]));
			expect((yield* documentOf(admin, { order })).print?.lines.map((row) => row.quantity)).toEqual(
				entered.map((id) => quantity.get(id))
			);
		})
	);
	test.effect('a published layout cannot be changed', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = yield* t.as(t.admin);
			const published = (yield* admin.query({
				document_templates: { where: { status: { eq: 'published' } }, limit: 1 }
			})).document_templates.rows;
			expect(
				yield* Effect.flip(
					admin.act({
						'document_templates.update': [
							{
								target: yield* t.at('document_templates', firstRow(published).id),
								set: { body: '{agreement}\nOverwrite' }
							}
						]
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
	);
	test.effect(
		'a synced order prints its contract in the newest published version; logistics cannot export it',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const admin = yield* t.as(t.admin);
				yield* admin.act({
					'sys_integration.update': [
						{ target: { id: fixtureId('sys_integration', 'kingdee') }, set: { active: false } }
					]
				});
				const { order } = yield* draft(t);
				expect((yield* documentOf(admin, { order })).title).toBe('Quotation');
				yield* confirm(t, order);
				const preview = yield* documentOf(admin, { order });
				expect(preview.title).toBe('Sales contract');
				const newer = committed(
					'document_templates',
					yield* admin.act({
						'document_templates.create': [
							{
								kind: 'sales_contract',
								locale: 'en',
								title: 'New contract heading',
								body: '{agreement}\nNew contract wording'
							}
						]
					})
				);
				const next = yield* draft(t);
				// an unpublished revision changes nothing
				yield* confirm(t, next.order);
				expect((yield* documentOf(admin, { order: next.order })).title).toBe('Sales contract');
				yield* admin.act({
					'document_templates.update': [
						{ target: yield* t.at('document_templates', newer), set: { status: 'published' } }
					]
				});
				expect(
					(yield* admin.query({
						document_templates: { where: { id: { eq: newer } }, fields: ['version'], limit: 1 }
					})).document_templates.rows[0]?.version
				).toBe('2');
				// a published version reaches every order, synced earlier or not
				for (const synced of [order, next.order]) {
					const revised = yield* documentOf(admin, { order: synced });
					expect(revised.title).toBe('New contract heading');
					expect(revised.html).toContain('New contract wording');
				}
				expect(preview.html).toContain('21.80');
				// Logistics reads no order terms through the default document query.
				expect(
					yield* Effect.flip(documentOf(yield* t.as(t.member(['logistics'])), { order }))
				).toBeDefined();
				converted.length = 0;
				expect(yield* renderPreview(t, preview)).toBe(preview.html);
				expect(converted).toEqual([preview.html]);
			})
	);
	test.effect(
		'the seller stamps its quotations and sales contracts, never a purchase contract',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const admin = yield* t.as(t.admin);
				const png = Result.getOrThrow(
					Base64.decode(
						'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
					)
				);
				const upload = yield* admin.upload('document_templates.contract_stamp', {
					name: 'sample-mark.png',
					mime: 'image/png',
					bytes: png
				});
				if (upload.kind !== 'committed') throw new Error('Stamp upload required');
				const layout = committed(
					'document_templates',
					yield* admin.act({
						'document_templates.create': [
							{
								kind: 'sales_contract',
								locale: 'en',
								title: 'Stamped sales agreement',
								body: '{agreement}',
								contract_stamp: upload.output
							}
						]
					})
				);
				yield* admin.act({
					'document_templates.update': [
						{ target: yield* t.at('document_templates', layout), set: { status: 'published' } }
					]
				});
				const { order } = yield* draft(t);
				expect((yield* documentOf(admin, { order })).stamp).toBeNull();
				yield* confirm(t, order);
				expect((yield* documentOf(admin, { order })).stamp?.id).toBe(upload.output.id);
				const purchase = yield* draft(t, 'purchasing');
				yield* confirm(t, purchase.order);
				expect((yield* documentOf(admin, { order: purchase.order })).stamp).toBeNull();
				converted.length = 0;
				yield* renderPreview(t, yield* documentOf(admin, { order }));
				expect(converted).toHaveLength(1);
				expect(converted[0]).toContain('data:image/png;base64,');
			})
	);
	test.effect(
		'an order prints its case in the language of its currency, with no layout to choose',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const admin = yield* t.as(t.admin);
				const print = (
					direction: 'sales' | 'purchasing',
					locale: 'en' | 'zh',
					confirmed: boolean
				) =>
					Effect.gen(function* () {
						const { order } = yield* draft(t, direction);
						yield* admin.act({
							'orders.update': [
								{
									target: yield* t.at('orders', order),
									set: { currency: locale === 'zh' ? 'CNY' : 'USD' }
								}
							]
						});
						if (confirmed) yield* confirm(t, order);
						return yield* documentOf(admin, { order });
					});
				// the English contracts are revised by the tests beside this one; their seeded versions print in those tests
				const cases = [
					['sales', 'en', false, 'Quotation', 'This quotation is valid for the period'],
					['sales', 'zh', false, '报价单', '本报价在以上有效期内有效'],
					['sales', 'zh', true, '销售合同', '卖方按上述数量'],
					['purchasing', 'zh', false, '采购合同', '供应商：'],
					['purchasing', 'zh', true, '采购合同', '供应商：']
				] as const;
				for (const [direction, locale, confirmed, title, clause] of cases) {
					const document = yield* print(direction, locale, confirmed);
					expect(document.title).toBe(title);
					expect(document.html).toContain(clause);
					if (direction === 'purchasing') expect(document.stamp).toBeNull();
				}
				// after the seeded cases print: a stamped quotation layout stamps the next draft
				const stamp = yield* admin.upload('document_templates.contract_stamp', {
					name: 'sample-mark.png',
					mime: 'image/png',
					bytes: Result.getOrThrow(
						Base64.decode(
							'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
						)
					)
				});
				if (stamp.kind !== 'committed') throw new Error('Stamp upload required');
				const quotation = committed(
					'document_templates',
					yield* admin.act({
						'document_templates.create': [
							{
								kind: 'quotation',
								locale: 'en',
								title: 'Stamped quotation',
								body: '{agreement}',
								contract_stamp: stamp.output
							}
						]
					})
				);
				yield* admin.act({
					'document_templates.update': [
						{ target: yield* t.at('document_templates', quotation), set: { status: 'published' } }
					]
				});
				const quoted = yield* draft(t);
				expect((yield* documentOf(admin, { order: quoted.order })).stamp?.id).toBe(stamp.output.id);
			})
	);
	test.effect(
		'a purchase PDF prints the newest published table, its artwork and the saved SKU specification',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const admin = yield* t.as(t.admin);
				const png = Result.getOrThrow(
					Base64.decode(
						'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
					)
				);
				const file = yield* admin.upload('document_templates.letterhead', {
					name: 'synthetic-letterhead.png',
					mime: 'image/png',
					bytes: png
				});
				if (file.kind !== 'committed') throw new Error('Letterhead upload required');
				const publish = (title: string, body: string) =>
					Effect.gen(function* () {
						const id = committed(
							'document_templates',
							yield* admin.act({
								'document_templates.create': [
									{
										kind: 'purchase_contract',
										locale: 'en',
										title,
										body,
										layout: 'table_v1',
										letterhead: file.output
									}
								]
							})
						);
						yield* admin.act({
							'document_templates.update': [
								{ target: yield* t.at('document_templates', id), set: { status: 'published' } }
							]
						});
						return id;
					});
				yield* publish(
					'Purchase commitment',
					'Reference {reference}\n{agreement}\nRetained terms.'
				);
				yield* t.db.write({
					text: 'UPDATE products SET spec = $1 WHERE id = $2',
					params: ['A-110 <grade>', PRODUCT]
				});
				const { order } = yield* draft(t, 'purchasing', undefined, '2026-10-09');
				const draftPdf = yield* documentOf(admin, { order });
				expect(draftPdf.filename).toMatch(/-purchase-commitment\.pdf$/);
				expect(draftPdf.html).toContain('A-110 &lt;grade&gt;');
				expect(draftPdf.html).toContain('2026-10-09');
				yield* confirm(t, order);
				const original = yield* documentOf(admin, { order });
				expect(original.html).toContain('<thead>');
				expect(original.html).toContain('21.80 SGD');
				expect(original.html).toContain('Retained terms.');
				expect(original.letterhead?.id).toBe(file.output.id);
				expect(original.stamp).toBeNull();
				yield* publish('New purchase layout', '{agreement}\nChanged terms.');
				yield* t.db.write({
					text: 'UPDATE products SET spec = $1 WHERE id = $2',
					params: ['A-120', PRODUCT]
				});
				// a newer version reaches the synced order too; its line keeps the specification it was saved with
				const revised = yield* documentOf(admin, { order });
				expect(revised.title).toBe('New purchase layout');
				expect(revised.html).toContain('Changed terms.');
				expect(revised.html).toContain('A-110 &lt;grade&gt;');
				converted.length = 0;
				yield* renderPreview(t, original);
				expect(converted).toHaveLength(1);
				expect(converted[0]).toContain('Company letterhead');
				expect(converted[0]).toContain('Retained terms.');
				expect(converted[0]).not.toContain('A-120');
				// and so does a purchase order not yet synced
				const next = yield* draft(t, 'purchasing');
				expect((yield* documentOf(admin, { order: next.order })).html).toContain('Changed terms.');
			})
	);
});
