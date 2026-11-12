import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import { priceBookRead, priceBookRows } from '../src/lib/price-book.js';
import { PRODUCT, workspace } from './kit.js';

it.live('imports atomically and refuses stale price book changes at the write boundary', () =>
	Effect.gen(function* () {
		const t = yield* workspace();
		const actor = yield* t.as(t.member(['configuration']));
		yield* t.db.write({
			text: 'UPDATE products SET source_number = $1 WHERE id = $2',
			params: ['RESIN-A', PRODUCT]
		});
		const product = (yield* actor.query({ products: { where: { id: { eq: PRODUCT } } } })).products
			.rows[0];
		if (!product?.unit) throw new Error('Fixture product required');
		const header =
			'Ledger ID,Product code,Warehouse group,Effective date,Currency,Unit,Minimum quantity,Floor price,Tax inclusive,Tax rate (%)';
		const row = (code: string, amount: string) =>
			`kingdee,${code},WEST,2026-10-01,SGD,${product.unit},5,${amount},true,9`;
		const load = (contents: string) =>
			Effect.gen(function* () {
				const upload = yield* actor.upload('pricing_floors.$import.price_book', {
					name: 'price-book.csv',
					mime: 'text/csv',
					bytes: new TextEncoder().encode(contents)
				});
				if (upload.kind !== 'committed') throw new Error('File upload needs to commit');
				const run = yield* actor.sync_control('pricing_floors', 'price_book', {
					mode: 'import',
					file: upload.output.id
				});
				if (run.kind !== 'committed') throw new Error('Import needs to start');
				yield* t.run_due();
				return yield* t.db.rows(Schema.Struct({ state: Schema.String, output: Schema.Json }), {
					text: 'SELECT state, output FROM sys_run WHERE id = $1',
					params: [run.output.id]
				});
			});
		const floors = () => actor.query({ pricing_floors: { where: { group_code: { eq: 'WEST' } } } });
		expect(
			yield* load([header, row('RESIN-A', '10'), row('missing', '10')].join('\n'))
		).toMatchObject([{ state: 'succeeded', output: { applied: false, findings: [{ at: 3 }] } }]);
		expect((yield* floors()).pricing_floors.rows).toEqual([]);
		expect(yield* load([header, row('RESIN-A', '10')].join('\n'))).toMatchObject([
			{ state: 'succeeded', output: { applied: true, created: 1 } }
		]);
		const withId = (code: string, amount: string, revision = '') =>
			[
				`${header},Kingdee item ID,Book revision`,
				`${row(code, amount)},${product.external_code},${revision}`
			].join('\n');
		expect(yield* load(withId('missing', '99'))).toMatchObject([
			{ state: 'succeeded', output: { applied: false } }
		]);
		const original = (yield* floors()).pricing_floors.rows[0];
		if (!original) throw new Error('Imported floor missing');
		expect(yield* load(withId('RESIN-A', '12', String(original.revision)))).toMatchObject([
			{ state: 'succeeded', output: { applied: true, updated: 1 } }
		]);
		const rows = (yield* floors()).pricing_floors.rows;
		expect(rows).toHaveLength(1);
		expect(rows[0]?.floor_price.eq(12)).toBe(true);
		const stale = yield* load(withId('RESIN-A', '10', String(original.revision)));
		expect(stale).toMatchObject([
			{
				state: 'succeeded',
				output: {
					applied: false,
					findings: [{ at: 2, message: expect.stringContaining('Export the latest price book') }]
				}
			}
		]);
		expect(yield* load([header, row('RESIN-A', '10')].join('\n'))).toMatchObject([
			{ state: 'succeeded', output: { applied: false } }
		]);
		expect((yield* floors()).pricing_floors.rows).toEqual(rows);

		const book = priceBookRows(yield* actor.query(priceBookRead('WEST', 'SGD')), '2026-10');
		expect(book).toHaveLength(1);
		expect(book[0]?.code).toBe('RESIN-A');
		expect(book[0]?.cells['2026-10-01']?.floor_price).toBe('12');
	})
);
