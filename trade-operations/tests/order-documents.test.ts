import { fixtureId, firstRow } from './test-runtime.js';
import { Schema, Effect, Layer } from 'effect';
import { expect, it, layer } from '@effect/vitest';
import { Trade, draft, confirm, committed, shared } from './kit.js';
import { Convert } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { renderOrderDocument, validateDocumentTemplate } from '../src/lib/order-document.js';
import { documentOf } from './reads.js';
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
const converted: string[] = [];
const workspace = shared({
	ports: Layer.succeed(Convert, {
		targets: ['pdf'],
		convert: (source) =>
			Effect.gen(function* () {
				if (!('html' in source))
					return yield* new FacilityFailure({ kind: 'invalid', message: 'HTML required' });
				converted.push(source.html);
				return new TextEncoder().encode(source.html);
			})
	})
});
layer(workspace, { excludeTestServices: true })('order documents', (test) => {
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
				yield* confirm(t, order);
				const original = yield* documentOf(admin, { order, locale: 'en' });
				committed(
					'document_templates',
					yield* admin.act('document_templates.update', [
						{
							target: committed(
								'document_templates',
								yield* admin.act('document_templates.create', [
									{
										kind: 'contract',
										locale: 'en',
										version: '3',
										title: 'New document heading',
										body: '{agreement}\nNew contract wording'
									}
								])
							),
							set: { status: 'published' }
						}
					])
				);
				const preview = yield* documentOf(admin, { order, locale: 'en' });
				expect(preview).toMatchObject(original);
				expect(preview.html).toContain('21.80');
				const exported = yield* admin.start('orders.sync.document', {
					mode: 'export',
					to: 'pdf',
					context: { order, locale: 'en' }
				});
				const refused = yield* t.as(t.member(['logistics'])).start('orders.sync.document', {
					mode: 'export',
					to: 'pdf',
					context: { order }
				});
				if (exported.kind !== 'committed' || refused.kind !== 'committed')
					throw new Error('Document exports must be queued');
				converted.length = 0;
				yield* t.runDue();
				const run = (id: string) =>
					t.db
						.rows(Schema.Struct({ state: Schema.String, output: Schema.Json }), {
							text: 'SELECT state, output FROM sys_run WHERE id = $1',
							params: [id]
						})
						.pipe(Effect.map(firstRow));
				expect(yield* run(exported.output.id)).toMatchObject({
					state: 'succeeded',
					output: { file: { name: expect.stringMatching(/\.pdf$/) } }
				});
				expect(yield* run(refused.output.id)).toMatchObject({ state: 'failed', output: null });
				expect(converted).toEqual([preview.html]);
			})
	);
});
