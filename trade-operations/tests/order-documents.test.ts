import { fixtureId, firstRow } from './test-runtime.js';
import { Schema, Effect, Layer } from 'effect';
import { Decimal } from '@norbital-ai/std/decimal';
import { fileRef } from '@norbital-ai/bolt/page';
import { expect, it as test } from '@effect/vitest';
import { workspace, draft, confirm, revise, committed, CUSTOMER, PRODUCT } from './kit.js';
import { Convert } from '@norbital-ai/bolt/engine';
import { FacilityFailure } from '@norbital-ai/bolt/errors';
import { renderOrderDocument, validateDocumentTemplate } from '../src/lib/order-document.js';
import { sourceFixture } from './source-fixture.js';
import { kingdeeDraft, kingdeeFixture, observeKingdeeOrder } from './kingdee-fixture.js';
import { agreements } from '../src/lib/agreements.js';
import { documentOf, versionsOf } from './reads.js';
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
	expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});
test.live('preview and PDF use the same sealed agreement without uploaded files', () =>
	Effect.gen(function* () {
		const converted: string[] = [];
		const t = yield* workspace({
			source: sourceFixture(() => ({})),
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
		yield* admin.act('sys_integration.update', [
			{
				target: fixtureId('sys_integration', 'kingdee'),
				set: { active: false }
			}
		]);
		const { order } = yield* draft(t);
		const quotation = yield* documentOf(admin, { order, locale: 'en' });
		expect(quotation.html).toContain('Quotation');
		expect(quotation.html).toContain('Resin A');
		yield* confirm(t, order);
		const original = yield* documentOf(admin, { order, locale: 'en' });
		const nextTemplate = committed(
			'document_templates',
			yield* admin.act('document_templates.create', [
				{
					kind: 'contract',
					locale: 'en',
					version: '2',
					title: 'New document heading',
					body: '{agreement}\nNew contract wording'
				}
			])
		);
		committed(
			'document_templates',
			yield* admin.act('document_templates.update', [
				{
					target: nextTemplate,
					set: { status: 'published' }
				}
			])
		);
		expect(yield* documentOf(admin, { order, locale: 'en' })).toMatchObject(original);
		const nextOrder = yield* draft(t);
		yield* confirm(t, nextOrder.order);
		expect(
			(yield* admin.query({ orders: { where: { id: { eq: nextOrder.order } }, limit: 1 } })).orders
				.rows[0]?.sealed_contract
		).toContain('New contract wording');
		expect(yield* documentOf(admin, { order: nextOrder.order, locale: 'en' })).toMatchObject({
			title: 'New document heading',
			template_version: '2'
		});
		const preview = yield* documentOf(admin, { order, locale: 'en' });
		expect(preview.html).toContain('21.80');
		expect(preview.html).not.toContain('<script>');
		const started = yield* admin.start('orders.sync.document', {
			mode: 'export',
			to: 'pdf',
			context: { order, locale: 'en' }
		});
		expect(started.kind).toBe('committed');
		yield* t.runDue();
		yield* t.runDue();
		const [runs] = yield* t.db.read([
			{
				text: "SELECT state, output, error FROM sys_run WHERE automation = 'orders.sync.document'",
				params: []
			}
		]);
		const run = runs?.rows[0];
		if (run === undefined) throw new Error('Document sync run required');
		expect(run, JSON.stringify(run)).toMatchObject({ state: 'succeeded' });
		expect(converted).toEqual([preview.html]);
		expect(run.output).toMatchObject({
			file: { name: 'TR-2026-0001.pdf' }
		});
		const chinese = yield* documentOf(admin, { order, locale: 'zh' });
		expect(chinese.html).toContain('商务协议');
	})
);
test.live(
	'published layouts cannot be changed and logistics cannot export commercial documents',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace({ source: sourceFixture(() => ({})) });
			const admin = t.as(t.admin);
			const templates = (yield* admin.query({ document_templates: {} })).document_templates;
			expect(templates.rows).toHaveLength(4);
			expect(
				yield* Effect.flip(
					admin.act('document_templates.update', [
						{
							target: firstRow(templates.rows).id,
							set: { body: '{agreement}\nOverwrite' }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const { order } = yield* draft(t);
			yield* confirm(t, order);
			const logistics = t.as(t.member(['logistics']));
			expect(yield* Effect.flip(documentOf(logistics, { order }))).toMatchObject({
				_tag: 'ReadFailed',
				code: 'forbidden'
			});
			const started = yield* logistics.start('orders.sync.document', {
				mode: 'export',
				to: 'pdf',
				context: { order }
			});
			if (started.kind !== 'committed') throw new Error('Document export must be queued');
			yield* t.runDue();
			const [run] = yield* t.db.rows(
				Schema.Struct({
					state: Schema.String,
					output: Schema.Json,
					error: Schema.NullOr(Schema.Json)
				}),
				{
					text: 'SELECT state, output, error FROM sys_run WHERE id = $1',
					params: [started.output.id]
				}
			);
			expect(run).toMatchObject({ state: 'failed', output: null, error: { code: 'guestError' } });
			const [files] = yield* t.db.rows(Schema.Struct({ count: Schema.Int }), {
				text: "SELECT count(*)::int AS count FROM sys_file WHERE field = 'orders.$export.document'",
				params: []
			});
			expect(files).toEqual({ count: 0 });
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
			const own = yield* documentOf(t.as(sales), { order, locale: 'en' });
			expect(own.html).toContain('Resin A');
			yield* Effect.tryPromise({
				try: () =>
					expect(
						Effect.runPromise(documentOf(t.as(other), { order, locale: 'en' }))
					).rejects.toBeDefined(),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			const configuration = t.as(t.member(['configuration']));
			expect(
				yield* Effect.flip(
					configuration.act('document_templates.create', [
						{
							kind: 'contract',
							locale: 'en',
							version: 'bad',
							title: 'Bad',
							body: '{title}'
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			const layout = yield* configuration.act('document_templates.create', [
				{
					kind: 'contract',
					locale: 'en',
					version: '2',
					title: 'Revised layout',
					body: '{reference}\n{agreement}'
				}
			]);
			expect(layout.kind).toBe('committed');
			if (layout.kind !== 'committed') throw new Error('Template create failed');
			const layoutId = committed('document_templates', layout);
			expect(
				yield* configuration.act('document_templates.update', [
					{
						target: layoutId,
						set: { status: 'published' }
					}
				])
			).toMatchObject({ kind: 'committed' });
		})
);
test.live('a replacement draft cannot alter an earlier sealed preview or PDF', () =>
	Effect.gen(function* () {
		const converted: string[] = [];
		const fixture = kingdeeFixture();
		const t = yield* workspace({
			source: fixture.request,
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
		const as = t.as(t.admin);
		const { order } = yield* kingdeeDraft(t, fixture);
		yield* confirm(t, order);
		yield* observeKingdeeOrder(t, fixture, order);
		yield* as.act('sys_integration.update', [
			{
				target: fixtureId('sys_integration', 'kingdee'),
				set: { active: false }
			}
		]);
		const original = yield* documentOf(as, {
			order,
			version: 1,
			locale: 'en'
		});
		expect(
			yield* Effect.result(
				as.act('orders.update', [
					{
						target: order,
						set: { payment_terms: 'Overwrite sealed terms' }
					}
				])
			)
		).toMatchObject({ _tag: 'Failure' });
		yield* revise(t, order);
		committed(
			'orders',
			yield* as.act('orders.update', [
				{
					target: order,
					set: { title: 'Replacement draft', payment_terms: 'Net 60' }
				}
			])
		);
		expect(yield* versionsOf(as, { order })).toMatchObject([{ version: 1 }]);
		expect(yield* documentOf(as, { order, version: 1 })).toEqual(original);
		expect(yield* Effect.result(documentOf(as, { order, version: 99 }))).toMatchObject({
			_tag: 'Failure'
		});
		expect(
			(yield* as.start('orders.sync.document', {
				mode: 'export',
				to: 'pdf',
				context: { order, version: 1 }
			})).kind
		).toBe('committed');
		yield* t.runDue();
		yield* t.runDue();
		expect(converted).toEqual([original.html]);
	})
);
test.live('supporting documents belong to the sales order and stop changing once confirmed', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fixture = kingdeeFixture();
			const t = yield* workspace({ source: fixture.request });
			const sales = t.member(['sales'], { teams: ['sales'], teamPath: ['sales'] });
			const owner = t.as(sales);
			const unrelatedMember = t.member(['sales'], { teams: ['sales'], teamPath: ['sales'] });
			const unrelated = t.as(unrelatedMember);
			const admin = t.as(t.admin);
			const bytes = new TextEncoder().encode('%PDF-1.4\n% Synthetic supporting document\n%%EOF\n');
			const upload = Effect.fnUntraced(function* (who: typeof owner, name: string) {
				const outcome = yield* who.upload('orders.supporting_documents', {
					name,
					mime: 'application/pdf',
					bytes
				});
				if (outcome.kind !== 'committed') throw new Error('Supporting document upload failed');
				return fileRef({
					id: outcome.output.id,
					name: outcome.output.name,
					mime: outcome.output.mime
				});
			});
			const first = yield* upload(owner, 'customer-brief.pdf');
			const { order } = yield* kingdeeDraft(t, fixture);
			committed(
				'orders',
				yield* admin.act('orders.update', [
					{
						target: order,
						set: { owner: fixtureId('sys_user', sales.id) }
					}
				])
			);
			yield* admin.act('sys_integration.update', [
				{
					target: fixtureId('sys_integration', 'kingdee'),
					set: { configuration: fixture.configuration(fixtureId('sys_user', sales.id)) }
				}
			]);
			committed(
				'orders',
				yield* owner.act('orders.update', [
					{
						target: order,
						set: { supporting_documents: [first] }
					}
				])
			);
			expect(
				(yield* owner.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
			).toMatchObject({
				owner: sales.id,
				status: 'draft',
				supporting_documents: [first]
			});
			const cookie = yield* t.session(sales.id);
			const downloaded = yield* t.handle(
				new Request(`http://localhost/__bolt/files/${first.id}`, { headers: { cookie } })
			);
			expect(downloaded.status).toBe(200);
			expect(downloaded.headers.get('content-type')).toBe('application/pdf');
			expect(
				new Uint8Array(
					yield* Effect.tryPromise({
						try: () => downloaded.arrayBuffer(),
						catch: (cause) => new TestIoFailed({ message: String(cause) })
					})
				)
			).toEqual(bytes);
			const foreign = yield* upload(unrelated, 'another-customer.pdf');
			expect(
				(yield* unrelated.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
					.rows[0]
			).toBeUndefined();
			expect(
				yield* Effect.flip(
					unrelated.act('orders.update', [
						{
							target: order,
							set: { supporting_documents: [foreign] }
						}
					])
				)
			).toMatchObject({ _tag: 'ActRefused' });
			expect(
				(yield* owner.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
					?.supporting_documents
			).toEqual([first]);
			const replacement = yield* upload(owner, 'revised-brief.pdf');
			committed(
				'orders',
				yield* owner.act('orders.update', [
					{
						target: order,
						set: { supporting_documents: [replacement] }
					}
				])
			);
			expect(
				(yield* owner.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
					?.supporting_documents
			).toEqual([replacement]);
			committed(
				'orders',
				yield* owner.act('orders.update', [{ target: order, set: { supporting_documents: [] } }])
			);
			expect(
				(yield* owner.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders.rows[0]
					?.supporting_documents
			).toEqual([]);
			committed(
				'orders',
				yield* owner.act('orders.update', [
					{
						target: order,
						set: { supporting_documents: [first, replacement] }
					}
				])
			);
			yield* confirm(t, order);
			yield* observeKingdeeOrder(t, fixture, order);
			yield* admin.act('sys_integration.update', [
				{
					target: fixtureId('sys_integration', 'kingdee'),
					set: { active: false }
				}
			]);
			const confirmed = (yield* owner.query({ orders: { where: { id: { eq: order } }, limit: 1 } }))
				.orders.rows[0];
			expect(confirmed).toMatchObject({
				status: 'confirmed',
				supporting_documents: [first, replacement]
			});
			for (const who of [owner, admin]) {
				for (const documents of [[], [replacement]]) {
					const refused = yield* Effect.flip(
						who.act('orders.update', [{ target: order, set: { supporting_documents: documents } }])
					);
					expect(refused).toMatchObject({ _tag: 'ActRefused' });
					expect(
						(yield* owner.query({ orders: { where: { id: { eq: order } }, limit: 1 } })).orders
							.rows[0]
					).toEqual(confirmed);
				}
			}
			yield* revise(t, order);
			committed(
				'orders',
				yield* owner.act('orders.update', [
					{
						target: order,
						set: { supporting_documents: [] }
					}
				])
			);
			const historical = (yield* owner.query({
				orders: { where: { id: { eq: order } }, limit: 1 }
			})).orders.rows[0];
			expect(historical?.contract_versions?.[0]?.supporting_documents).toEqual([
				first,
				replacement
			]);
			const archivedFile = yield* t.handle(
				new Request(`http://localhost/__bolt/files/${first.id}`, { headers: { cookie } })
			);
			expect(archivedFile.status).toBe(200);
			const next = yield* upload(owner, 'replacement-contract.pdf');
			committed(
				'orders',
				yield* owner.act('orders.update', [
					{
						target: order,
						set: { supporting_documents: [next] }
					}
				])
			);
			yield* confirm(t, order);
			const sealedReplacement = (yield* owner.query({
				orders: { where: { id: { eq: order } }, limit: 1 }
			})).orders.rows[0];
			if (!sealedReplacement) throw new Error('Sealed replacement required');
			const versions = agreements(sealedReplacement);
			expect(versions.find((version) => version.version === 1)?.supporting_documents).toEqual([
				first,
				replacement
			]);
			expect(versions.find((version) => version.version === 2)?.supporting_documents).toEqual([
				next
			]);
			for (const file of [first, replacement, next]) {
				const allowed = yield* t.handle(
					new Request(`http://localhost/__bolt/files/${file.id}`, { headers: { cookie } })
				);
				expect(allowed.status).toBe(200);
			}
			const unrelatedCookie = yield* t.session(unrelatedMember.id);
			for (const file of [first, next]) {
				const denied = yield* t.handle(
					new Request(`http://localhost/__bolt/files/${file.id}`, {
						headers: { cookie: unrelatedCookie }
					})
				);
				expect([403, 404]).toContain(denied.status);
			}
		})
	)
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
