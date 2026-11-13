import { Effect, Exit } from 'effect';
import { expect, it } from '@effect/vitest';
import { committed, confirm, draft, workspace } from './kit.js';
import { direct } from './synced-kit.js';
import { firstRow } from './test-runtime.js';

it.effect('files a late document on a confirmed order under the order read scope', () =>
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
		const fileOn = () => purchaser.act({ 'order_files.create': [{ order, file, title }] });
		expect(Exit.isFailure(yield* Effect.exit(fileOn()))).toBe(true);
		yield* confirm(t, order);
		const before = firstRow((yield* readOrder()).orders.rows);
		const filed = committed('order_files', yield* fileOn());
		expect(firstRow((yield* readOrder()).orders.rows)).toEqual(before);
		expect(
			(yield* (yield* t.as(t.member(['sales']))).query({ order_files: {} })).order_files.rows
		).toEqual([]);
		expect(
			(yield* (yield* t.as(t.member(['finance']))).query({ order_files: {} })).order_files.rows
		).toMatchObject([{ id: filed, file: { id: file.id }, title }]);
		for (const verb of ['update', 'delete'] as const)
			expect(
				yield* direct(t, admin.authority, {
					model: 'order_files',
					verb,
					input:
						verb === 'update' ? [{ target: filed, set: { title: 'Replace' } }] : [{ target: filed }]
				})
			).not.toMatchObject({ kind: 'committed' });
	})
);
