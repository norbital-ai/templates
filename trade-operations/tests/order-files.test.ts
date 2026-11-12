import { Effect, Exit } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, confirm, draft, revise, workspace } from './kit.js';
import { direct } from './synced-kit.js';
import { firstRow } from './test-runtime.js';

it.effect('keeps a late file on its original sealed agreement and under the order read scope', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const { order } = yield* draft(t, 'purchasing');
		const purchaser = yield* t.as(t.member(['procurement']));
		const admin = yield* t.as(t.admin);
		const readOrder = () => admin.query({ orders: { where: { id: { eq: order } } } });
		const uploaded = yield* purchaser.upload('order_files.file', {
			name: 'signed-return.png',
			mime: 'image/png',
			bytes: new Uint8Array(
				Buffer.from(
					'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP8//8/AwMDEwMYAAAkBgMBXaJOiAAAAABJRU5ErkJggg==',
					'base64'
				)
			)
		});
		if (uploaded.kind !== 'committed') throw new Error('Expected uploaded file');
		const file = uploaded.output;
		const title = 'Signed return';
		const fileUnder = (seal_hash: string) =>
			purchaser.act({ 'order_files.create': [{ order, seal_hash, file, title }] });
		expect(Exit.isFailure(yield* Effect.exit(fileUnder('draft')))).toBe(true);
		yield* confirm(t, order);
		const before = firstRow((yield* readOrder()).orders.rows);
		if (!before.seal_hash) throw new Error('Expected the first agreement seal');
		const seal = before.seal_hash;
		expect(Exit.isFailure(yield* Effect.exit(fileUnder('another-version')))).toBe(true);
		const filed = committed('order_files', yield* fileUnder(seal));
		expect(firstRow((yield* readOrder()).orders.rows)).toEqual(before);
		expect(
			(yield* (yield* t.as(t.member(['sales']))).query({ order_files: {} })).order_files.rows
		).toEqual([]);
		expect(
			(yield* (yield* t.as(t.member(['finance']))).query({ order_files: {} })).order_files.rows
		).toMatchObject([{ id: filed, seal_hash: seal, file: { id: file.id }, title }]);
		for (const verb of ['update', 'delete'] as const)
			expect(
				yield* direct(t, admin.authority, {
					model: 'order_files',
					verb,
					input:
						verb === 'update' ? [{ target: filed, set: { title: 'Replace' } }] : [{ target: filed }]
				})
			).not.toMatchObject({ kind: 'committed' });

		yield* revise(t, order);
		yield* admin.act({
			'orders.update': [
				{ target: yield* t.at('orders', order), set: { payment_terms: 'Revised payment terms' } }
			]
		});
		yield* confirm(t, order);
		const replacement = firstRow((yield* readOrder()).orders.rows);
		const readFiles = (seal_hash: string) =>
			purchaser.query({
				order_files: { where: { order: { eq: order }, seal_hash: { eq: seal_hash } } }
			});
		if (!replacement.seal_hash) throw new Error('Expected the replacement agreement seal');
		expect(replacement.seal_hash).not.toBe(seal);
		expect((yield* readFiles(replacement.seal_hash)).order_files.rows).toEqual([]);
		expect((yield* readFiles(seal)).order_files.rows).toMatchObject([
			{ id: filed, file: { id: file.id } }
		]);
	})
);
