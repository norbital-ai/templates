import { randomUUID } from 'node:crypto';
import { fixtureId, firstRow } from './test-runtime.js';
import * as Base64 from 'effect/encoding/Base64';
import { Schema, Effect, Layer, Result } from 'effect';
import { expect, it, layer } from '@effect/vitest';
import {
	Trade,
	draft,
	confirm,
	committed,
	shared,
	PRODUCT,
	revise,
	SETTINGS,
	type T
} from './kit.js';
import { Convert } from '@norbital-ai/bolt/engine';
import { Decimal } from '@norbital-ai/std/decimal';
import { cnyInWords, printAmounts } from '../src/lib/print-amounts.js';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import {
	documentRead,
	documentSource,
	orderDocument,
	renderOrderDocument,
	renderPrintLayout,
	validateDocumentTemplate
} from '../src/lib/order-document.js';
import { documentOf } from './reads.js';
import { contractSignatureRead, latestSignatureRead } from '../src/lib/salesperson-signatures.js';
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
				if ('layoutHtml' in source) {
					printed.push(source.layoutHtml);
					return new TextEncoder().encode(source.layoutHtml);
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
				issuedAt: t.clock.now()
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
	test.effect('a salesperson alone can use the image version retained by a sealed contract', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const signer = t.member(['sales', 'own_signature']);
			const owner = fixtureId('sys_user', signer.id);
			const self = t.as(signer);
			const manager = t.as(t.member(['manager', 'own_signature']));
			const blue =
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMQ0Er5DwACigGewaDUQwAAAABJRU5ErkJggg==';
			const red =
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOYoqb3HwAEIgHoJte4AAAAAABJRU5ErkJggg==';
			const save = (png: string) =>
				self.act('salesperson_signatures.create', [{ signature: { png } }]);
			expect(yield* Effect.flip(save('not a PNG'))).toMatchObject({
				_tag: 'ActRefused',
				message: 'errors.signature_png'
			});
			const first = committed('salesperson_signatures', yield* save(blue));
			const { order } = yield* draft(t, 'sales', owner);
			expect((yield* documentOf(self, { order })).signing).toBeNull();
			yield* confirm(t, order);
			const original = yield* documentOf(self, { order });
			expect(original.signing).toEqual({ owner, version: first });
			if (!original.signing) throw new Error('Expected the sealed signature pointer');
			const read = contractSignatureRead(original.signing);
			expect((yield* manager.query(read)).salesperson_signatures.rows).toEqual([]);
			expect((yield* documentOf(manager, { order })).reference).toBe(original.reference);
			const plain = yield* renderPreview(t, original);
			expect(plain).not.toContain('alt="Salesperson signature"');
			const artwork = firstRow((yield* self.query(read)).salesperson_signatures.rows).signature;
			expect(artwork?.png).toBe(blue);
			const signed = yield* renderPreview(t, { ...original, signature: artwork?.png ?? null });
			expect(signed).toContain(`src="data:image/png;base64,${blue}"`);

			t.clock.advance('1s');
			const replacement = committed('salesperson_signatures', yield* save(red));
			expect(
				firstRow((yield* self.query(latestSignatureRead(owner))).salesperson_signatures.rows).id
			).toBe(replacement);
			expect((yield* documentOf(self, { order })).signing?.version).toBe(first);
			expect(firstRow((yield* self.query(read)).salesperson_signatures.rows).signature?.png).toBe(
				blue
			);

			t.clock.advance('1s');
			yield* self.act('salesperson_signatures.create', [{}]);
			expect(
				firstRow((yield* self.query(latestSignatureRead(owner))).salesperson_signatures.rows)
					.signature
			).toBeNull();
			const next = yield* draft(t, 'sales', owner);
			yield* confirm(t, next.order);
			expect((yield* documentOf(self, { order: next.order })).signing).toBeNull();
			expect((yield* documentOf(self, { order })).signing?.version).toBe(first);
		})
	);

	test.effect('a named HTML layout exports the saved order through the print renderer', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = t.as(t.admin);
			const html =
				'<!doctype html><html><style>@page{size:A4;margin:20mm}</style><body>' +
				'<h1>{{title}}</h1><p>{{reference}} · {{party}} · {{detail_buyer_reference}}</p><ul>' +
				'{{#lines}}<li>{{product_code}}: {{quantity_tonnes}} t · {{gross_unit_price_per_tonne}} · {{detail_brand}}</li>{{/lines}}</ul><b>{{total}}</b><p>{{terms}}</p></body></html>';
			const upload = yield* admin.upload('document_templates.print_layout', {
				name: 'approved-print.html',
				mime: 'text/html',
				bytes: new TextEncoder().encode(html)
			});
			if (upload.kind !== 'committed') throw new Error('Print layout upload required');
			const layout = committed(
				'document_templates',
				yield* admin.act('document_templates.create', [
					{
						title: 'Approved print layout',
						locale: 'en',
						version: '1',
						body: '{agreement}\nDelivery by arrangement.',
						print_layout: upload.output,
						print_fields: [
							{ key: 'buyer_reference', label: 'Buyer reference', scope: 'order', multiline: true },
							{ key: 'brand', label: 'Brand', scope: 'line', default_value: 'Standard' }
						]
					}
				])
			);
			yield* admin.act('document_templates.update', [
				{ target: layout, set: { status: 'published' } }
			]);
			const { order, line } = yield* draft(t, 'purchasing');
			yield* admin.act('orders.update', [
				{
					target: order,
					set: {
						document_template: layout,
						print_values: [{ key: 'buyer_reference', value: 'BUY <42>\nNorth entrance' }]
					}
				}
			]);
			yield* admin.act('order_lines.update', [
				{
					target: line,
					set: { print_values: [{ key: 'brand', value: 'Synthetic & Co' }] }
				}
			]);
			yield* confirm(t, order);
			const document = yield* documentOf(admin, { order });
			expect(document.print?.file.id).toBe(upload.output.id);
			printed.length = 0;
			expect(yield* renderPreview(t, document)).toBe(
				renderPrintLayout(html, document.print!.fields, document.print!.lines)
			);
			expect(printed).toEqual([
				renderPrintLayout(html, document.print!.fields, document.print!.lines)
			]);
			expect(printed[0]).toContain('<h1>Approved print layout</h1>');
			expect(printed[0]).toContain('<b>21.80</b><p>Delivery by arrangement.</p>');
			expect(printed[0]).toContain('0.010 t · 2,180.00 · Synthetic &amp; Co');
			expect(printed[0]).toContain('BUY &lt;42&gt;\nNorth entrance');
			const sealed = firstRow(
				(yield* admin.query({ orders: { where: { id: { eq: order } } } })).orders.rows
			).sealed_snapshot;
			const lineBasis = sealed?.lines[0];
			if (!sealed || !lineBasis) throw new Error('Expected the sealed print fixture');
			const kg = { ...lineBasis, quantity: '81000.000', unit_price: '1.6532', unit: 'kg' };
			expect(printAmounts({ ...sealed, lines: [kg] })).toMatchObject({
				fields: { quantity_grouped: '81,000' },
				lines: [{ quantity_grouped: '81,000', unit_price_grouped: '1.6532', unit_export: 'KGS' }]
			});
			expect(
				printAmounts({ ...sealed, lines: [kg, { ...kg, quantity: '1.250', unit: '吨' }] })
			).toMatchObject({
				fields: { quantity_grouped: '' },
				lines: [{}, { quantity_grouped: '1.25', unit_export: 'MT' }]
			});
			yield* revise(t, order);
			const draftCopy = yield* documentOf(admin, { order });
			expect(draftCopy.print).toEqual(document.print);
			yield* admin.act('orders.update', [
				{
					target: order,
					set: { print_values: [{ key: 'buyer_reference', value: 'BUY 43' }] }
				}
			]);
			yield* admin.act('order_lines.update', [
				{
					target: line,
					set: { quantity: Decimal.of('20'), print_values: [{ key: 'brand', value: '' }] }
				}
			]);
			yield* confirm(t, order);
			const next = yield* documentOf(admin, { order });
			expect(next.print?.fields).toMatchObject({ detail_buyer_reference: 'BUY 43' });
			expect(next.print?.lines[0]).toMatchObject({ detail_brand: '', quantity_tonnes: '0.020' });
			expect((yield* documentOf(admin, { order, version: 1 })).print).toEqual(document.print);
		})
	);
	test.effect('a published layout cannot be changed', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = t.as(t.admin);
			const published = (yield* admin.query({
				document_templates: { where: { status: { eq: 'published' } }, limit: 1 }
			})).document_templates.rows;
			expect(
				yield* Effect.flip(
					admin.act('document_templates.update', [
						{ target: firstRow(published).id, set: { body: '{agreement}\nOverwrite' } }
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
		})
	);
	test.effect(
		'preview and PDF use the same sealed agreement; a later layout and logistics cannot change or export it',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const admin = t.as(t.admin);
				yield* admin.act('sys_integration.update', [
					{ target: fixtureId('sys_integration', 'kingdee'), set: { active: false } }
				]);
				const { order } = yield* draft(t);
				const draftPreview = yield* documentOf(admin, { order });
				const newer = committed(
					'document_templates',
					yield* admin.act('document_templates.create', [
						{
							locale: 'zh',
							version: '3',
							title: 'New document heading',
							body: '{agreement}\nNew contract wording'
						}
					])
				);
				expect(
					yield* Effect.flip(
						admin.act('commercial_settings.update', [
							{ target: SETTINGS, set: { default_document_layout: newer } }
						])
					)
				).toMatchObject({ _tag: 'ActRefused' });
				yield* admin.act('document_templates.update', [
					{ target: newer, set: { status: 'published' } }
				]);
				yield* admin.act('commercial_settings.update', [
					{ target: SETTINGS, set: { default_document_layout: newer } }
				]);
				expect(yield* documentOf(admin, { order })).toEqual(draftPreview);
				const next = yield* draft(t);
				expect((yield* documentOf(admin, { order: next.order })).title).toBe(
					'New document heading'
				);
				yield* confirm(t, order);
				const preview = yield* documentOf(admin, { order });
				expect(preview.title).toBe(draftPreview.title);
				const answer = yield* admin.query(documentRead(order));
				const confirmed = firstRow(answer.orders.rows);
				const legacy = (confirmed.contract_versions ?? []).map((version) => {
					const { document_template_id: _layout, ...snapshot } = version.snapshot;
					return { ...version, snapshot };
				});
				expect(
					yield* orderDocument({
						...answer,
						orders: { ...answer.orders, rows: [{ ...confirmed, contract_versions: legacy }] },
						document_templates: { ...answer.document_templates, rows: [] }
					})
				).toEqual(preview);
				yield* admin.act('commercial_settings.update', [
					{ target: SETTINGS, set: { default_document_layout: confirmed.document_template } }
				]);
				expect(preview.html).toContain('21.80');
				// Logistics reads no order terms through the default document query.
				expect(
					yield* Effect.flip(documentOf(t.as(t.member(['logistics'])), { order }))
				).toBeDefined();
				converted.length = 0;
				expect(yield* renderPreview(t, preview)).toBe(preview.html);
				expect(converted).toEqual([preview.html]);
			})
	);
	test.effect('the published contract stamp is included only on its sealed sales contracts', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = t.as(t.admin);
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
				yield* admin.act('document_templates.create', [
					{
						locale: 'en',
						version: '4',
						title: 'Stamped sales agreement',
						body: '{agreement}',
						contract_stamp: upload.output
					}
				])
			);
			yield* admin.act('document_templates.update', [
				{ target: layout, set: { status: 'published' } }
			]);
			const { order } = yield* draft(t);
			yield* admin.act('orders.update', [{ target: order, set: { document_template: fixtureId('document_templates', layout) } }]);
			expect((yield* documentOf(admin, { order })).stamp).toBeNull();
			yield* confirm(t, order);
			expect((yield* documentOf(admin, { order })).stamp?.id).toBe(upload.output.id);
			const purchase = yield* draft(t, 'purchasing');
			yield* admin.act('orders.update', [
				{ target: purchase.order, set: { document_template: layout } }
			]);
			yield* confirm(t, purchase.order);
			expect((yield* documentOf(admin, { order: purchase.order })).stamp).toBeNull();
			converted.length = 0;
			yield* renderPreview(t, yield* documentOf(admin, { order }));
			expect(converted).toHaveLength(1);
			expect(converted[0]).toContain('data:image/png;base64,');
		})
	);
	test.effect('each published document variant renders its own title and clauses', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = t.as(t.admin);
			const variants = [
				[
					'00000000-0000-4000-8000-000000000504',
					'Quotation',
					'This quotation is valid for the period'
				],
				[
					'00000000-0000-4000-8000-000000000505',
					'Sales contract',
					'The seller supplies the goods'
				],
				['00000000-0000-4000-8000-000000000506', '报价单', '本报价在以上有效期内有效'],
				['00000000-0000-4000-8000-000000000507', '销售合同', '卖方按上述数量']
			] as const;
			for (const [layout, title, clause] of variants) {
				const { order } = yield* draft(t);
				yield* admin.act('orders.update', [
					{ target: order, set: { document_template: fixtureId('document_templates', layout) } }
				]);
				const document = yield* documentOf(admin, { order });
				expect(document.title).toBe(title);
				expect(document.html).toContain(clause);
			}
		})
	);
	test.effect('a purchase commitment defaults to the seeded supplier contract layout', () =>
		Effect.gen(function* () {
			const t = yield* Trade;
			const admin = t.as(t.admin);
			const { order } = yield* draft(t, 'purchasing');
			const layout = (yield* admin.query({
				orders: { where: { id: { eq: order } }, fields: ['document_template'], limit: 1 }
			})).orders.rows[0]?.document_template;
			expect(layout).toBe('00000000-0000-4000-8000-000000000503');
			const document = yield* documentOf(admin, { order });
			expect(document.title).toBe('Purchase contract');
			expect(document.html).toContain('Supplier:');
			expect(document.html).toContain('Buyer:');
			expect(document.stamp).toBeNull();
		})
	);
	test.effect(
		'a purchase PDF retains the published table, artwork and saved SKU specification',
		() =>
			Effect.gen(function* () {
				const t = yield* Trade;
				const admin = t.as(t.admin);
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
				const publish = (version: string, title: string, body: string) =>
					Effect.gen(function* () {
						const id = committed(
							'document_templates',
							yield* admin.act('document_templates.create', [
								{
									locale: 'en',
									version,
									title,
									body,
									layout: 'table_v1',
									letterhead: file.output
								}
							])
						);
						yield* admin.act('document_templates.update', [
							{ target: id, set: { status: 'published' } }
						]);
						return id;
					});
				const layout = yield* publish(
					'1',
					'Purchase commitment',
					'Reference {reference}\n{agreement}\nRetained terms.'
				);
				yield* t.db.write({
					text: 'UPDATE products SET spec = $1 WHERE id = $2',
					params: ['A-110 <grade>', PRODUCT]
				});
				const { order } = yield* draft(t, 'purchasing', undefined, '2026-10-09');
				yield* admin.act('orders.update', [{ target: order, set: { document_template: fixtureId('document_templates', layout) } }]);
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
				const nextLayout = yield* publish(
					'2',
					'New purchase layout',
					'{agreement}\nChanged terms.'
				);
				yield* t.db.write({
					text: 'UPDATE products SET spec = $1 WHERE id = $2',
					params: ['A-120', PRODUCT]
				});
				expect(yield* documentOf(admin, { order })).toEqual(original);
				converted.length = 0;
				yield* renderPreview(t, original);
				expect(converted).toHaveLength(1);
				expect(converted[0]).toContain('Company letterhead');
				expect(converted[0]).toContain('Retained terms.');
				expect(converted[0]).not.toContain('A-120');
				yield* revise(t, order);
				yield* admin.act('orders.update', [
					{ target: order, set: { document_template: nextLayout } }
				]);
				yield* confirm(t, order);
				expect((yield* documentOf(admin, { order })).html).toContain('Changed terms.');
				expect(yield* documentOf(admin, { order, version: 1 })).toEqual(original);
			})
	);
});
