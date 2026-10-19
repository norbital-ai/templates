import { fixtureId, firstRow } from './test-runtime.js';
import { Schema, Effect, Layer } from 'effect';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm, committed } from './kit.js';
import { Convert } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { renderOrderDocument, validateDocumentTemplate } from '../src/lib/order-document.js';
test('document templates keep agreement content and escape all substituted text', () => {
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
	expect(html.match(/<h1>/g)).toHaveLength(1);
	expect(html).not.toContain('<title>');
	expect(html).not.toContain('<pre>');
	expect(html).toContain('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});
test.live('preview and PDF use the same sealed agreement without uploaded files', () =>
	Effect.gen(function* () {
		const converted: string[] = [];
		const t = yield* workspace({
			ports: Layer.succeed(Convert, {
				targets: ['pdf'],
				convert: (source) =>
					Effect.gen(function* () {
						if (!('html' in source))
							return yield* Effect.fail(
								new FacilityFailure({ kind: 'invalid', message: 'HTML required' })
							);
						converted.push(source.html);
						return new TextEncoder().encode(source.html);
					})
			})
		});
		const admin = t.as(t.admin);
		const { order } = yield* draft(t);
		const quotation = yield* admin.query('orders.document_preview', { order, locale: 'en' });
		expect(quotation.html).toContain('Quotation');
		expect(quotation.html).toContain('Resin A');
		yield* confirm(t, order);
		const original = yield* admin.query('orders.document_preview', { order, locale: 'en' });
		const nextTemplate = committed(
			'document_templates',
			yield* admin.act('document_templates.create', {
				kind: 'contract',
				locale: 'en',
				version: '2',
				title: 'New document heading',
				body: '{agreement}\nNew contract wording'
			})
		);
		committed(
			'document_templates',
			yield* admin.act('document_templates.update', {
				target: nextTemplate,
				set: { status: 'published' }
			})
		);
		expect(yield* admin.query('orders.document_preview', { order, locale: 'en' })).toMatchObject(
			original
		);
		const nextOrder = yield* draft(t);
		yield* confirm(t, nextOrder.order);
		expect((yield* admin.get('orders', nextOrder.order))?.sealed_contract).toContain(
			'New contract wording'
		);
		expect(
			yield* admin.query('orders.document_preview', { order: nextOrder.order, locale: 'en' })
		).toMatchObject({ title: 'New document heading', template_version: '2' });
		const preview = yield* admin.query('orders.document_preview', { order, locale: 'en' });
		expect(preview.html).toContain('21.80');
		expect(preview.html).not.toContain('<script>');
		const started = yield* admin.start('export_order', { order, locale: 'en' });
		expect(started.kind).toBe('committed');
		yield* t.runDue();
		yield* t.runDue();
		expect(converted).toEqual([preview.html]);
		const [runs] = yield* t.db.read([
			{ text: "SELECT state, output FROM sys_run WHERE automation = 'export_order'", params: [] }
		]);
		const run = runs?.rows[0];
		if (run === undefined) throw new Error('Document automation run required');
		expect(run.state).toBe('succeeded');
		expect(run.output).toMatchObject({
			template_version: '1',
			contract_version: '1',
			pdf: { name: 'TR-2026-0001.pdf' }
		});
		const chinese = yield* admin.query('orders.document_preview', { order, locale: 'zh' });
		expect(chinese.html).toContain('商务协议');
	})
);
test.live(
	'published layouts cannot be changed and logistics cannot export commercial documents',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const admin = t.as(t.admin);
			const templates = yield* admin.read('document_templates', { all: true });
			expect(templates.rows).toHaveLength(4);
			expect(
				yield* Effect.flip(
					admin.act('document_templates.update', {
						target: firstRow(templates.rows).id,
						set: { body: '{agreement}\nOverwrite' }
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const { order } = yield* draft(t);
			yield* confirm(t, order);
			const logistics = t.as(t.member(['logistics']));
			expect(yield* Effect.flip(logistics.start('export_order', { order }))).toMatchObject({
				_tag: 'ActRefused'
			});
		})
);
test.live(
	'sales previews use its order scope and configuration can publish only a valid layout',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace();
			const sales = t.member(['sales']);
			const other = t.member(['sales']);
			if (sales.actor.kind !== 'member') throw new Error('Member required');
			const { order } = yield* draft(t, 'sales', fixtureId('sys_user', sales.actor.id));
			const own = yield* t.as(sales).query('orders.document_preview', { order, locale: 'en' });
			expect(own.html).toContain('Resin A');
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(t.as(other).query('orders.document_preview', { order, locale: 'en' }))
					).rejects.toBeDefined(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const configuration = t.as(t.member(['configuration']));
			expect(
				yield* Effect.flip(
					configuration.act('document_templates.create', {
						kind: 'contract',
						locale: 'en',
						version: 'bad',
						title: 'Bad',
						body: '{title}'
					})
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const layout = yield* configuration.act('document_templates.create', {
				kind: 'contract',
				locale: 'en',
				version: '2',
				title: 'Revised layout',
				body: '{reference}\n{agreement}'
			});
			expect(layout.kind).toBe('committed');
			if (layout.kind !== 'committed') throw new Error('Template create failed');
			const layoutId = committed('document_templates', layout);
			expect(
				yield* configuration.act('document_templates.update', {
					target: layoutId,
					set: { status: 'published' }
				})
			).toMatchObject({ kind: 'committed' });
		})
);
test.live(
	'historical preview and PDF keep approved terms while the same order gets a new version',
	() =>
		Effect.gen(function* () {
			const converted: string[] = [];
			const t = yield* workspace({
				ports: Layer.succeed(Convert, {
					targets: ['pdf'],
					convert: (source) =>
						Effect.gen(function* () {
							if (!('html' in source))
								return yield* Effect.fail(
									new FacilityFailure({ kind: 'invalid', message: 'HTML required' })
								);
							converted.push(source.html);
							return new TextEncoder().encode(source.html);
						})
				})
			});
			const as = t.as(t.admin);
			const { order } = yield* draft(t);
			yield* confirm(t, order);
			const original = yield* as.query('orders.document_preview', {
				order,
				version: 1,
				locale: 'en'
			});
			committed(
				'orders',
				yield* as.act('orders.revise', { target: order, input: { reason: 'New credit terms' } })
			);
			committed(
				'orders',
				yield* as.act('orders.update', {
					target: order,
					set: { title: 'New title', payment_terms: 'Net 60' }
				})
			);
			expect(yield* as.query('orders.document_preview', { order, version: 1 })).toEqual(original);
			yield* confirm(t, order);
			expect(yield* as.query('orders.document_versions', { order })).toMatchObject([
				{ version: 1 },
				{ version: 2 }
			]);
			expect(yield* as.query('orders.document_preview', { order, version: 1 })).toEqual(original);
			expect(yield* as.query('orders.document_preview', { order })).toMatchObject({
				contract_version: '2',
				html: expect.stringContaining('Net 60')
			});
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(as.query('orders.document_preview', { order, version: 99 }))
					).rejects.toBeDefined(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect((yield* as.start('export_order', { order, version: 1 })).kind).toBe('committed');
			yield* t.runDue();
			yield* t.runDue();
			expect(converted).toEqual([original.html]);
		})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
