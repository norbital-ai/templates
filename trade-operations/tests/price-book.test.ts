import { sameDecimal } from './test-runtime.js';
import { Effect, Schema } from 'effect';
import { expect, it } from '@effect/vitest';
import {
	priceBookCatalogRead,
	priceBookDefaultsRead,
	priceBookMonths,
	priceBookRead,
	priceBookRows
} from '../src/lib/price-book.js';
import { PRODUCT, workspace } from './kit.js';
import { quoteBelowFloor } from '../src/lib/commercial.js';
import catalogue from '../src/i18n/+messages.js';

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
			'Ledger ID,Product code,Warehouse region,Effective date,Currency,Unit,Floor price,Tax inclusive,Tax rate (%)';
		const row = (code: string, amount: string) =>
			`kingdee,${code},WEST,2026-10-01,SGD,${product.unit},${amount},true,9`;
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
		expect(sameDecimal(rows[0]?.floor_price, '12')).toBe(true);
		const stale = yield* load(withId('RESIN-A', '10', String(original.revision)));
		expect(stale).toMatchObject([
			{
				state: 'succeeded',
				output: {
					applied: false,
					findings: [{ at: 2, message: catalogue['errors.price_book_stale'] }]
				}
			}
		]);
		expect(yield* load([header, row('RESIN-A', '10')].join('\n'))).toMatchObject([
			{ state: 'succeeded', output: { applied: false } }
		]);
		expect((yield* floors()).pricing_floors.rows).toEqual(rows);

		const book = priceBookRows(
			yield* actor.query(priceBookRead('WEST', 'SGD', '2026-10')),
			'2026-10'
		);
		expect(book).toHaveLength(1);
		expect(book[0]?.code).toBe('RESIN-A');
		expect(book[0]?.cells['2026-10-01']?.floor_price).toBe('12');
		const nextMonth = yield* actor.query(priceBookRead('WEST', 'SGD', '2026-11'));
		expect(nextMonth.pricing_floors.rows).toEqual([]);
		yield* actor.act({
			'pricing_floors.create': [
				{
					product: PRODUCT,
					group_code: 'WEST',
					currency: 'SGD',
					effective_on: '2026-11-01',
					unit: product.unit,
					floor_price: '15',
					tax_inclusive: false,
					tax_rate: '0'
				}
			]
		});
		expect(
			(yield* actor.query(priceBookRead('WEST', 'SGD', '2026-10'))).pricing_floors.rows
		).toHaveLength(1);
		expect(
			(yield* actor.query(priceBookRead('WEST', 'SGD', '2026-11'))).pricing_floors.rows
		).toMatchObject([{ effective_on: '2026-11-01', floor_price: '15' }]);
		expect(
			(yield* actor.query(priceBookDefaultsRead('WEST', 'SGD', PRODUCT))).pricing_floors.rows
		).toMatchObject([{ unit: product.unit, tax_inclusive: false, tax_rate: '0' }]);
		const catalog = yield* actor.query(priceBookCatalogRead);
		expect(priceBookMonths(catalog, 'WEST', 'SGD')).toEqual(['2026-11', '2026-10']);
		expect(priceBookMonths(catalog, 'WEST', 'USD')).toEqual([]);
		expect(
			catalog.pricing_floors.rows.filter((row) => row.key.group_code === 'WEST')
		).toMatchObject([
			{ key: { group_code: 'WEST', currency: 'SGD', effective_on: '2026-10-01' }, count: 1 },
			{ key: { group_code: 'WEST', currency: 'SGD', effective_on: '2026-11-01' }, count: 1 }
		]);
	})
);

it('a line is below its floor by its own net unit price, never by its rounded total', () => {
	const line = {
		unit_price: '8500',
		discount_pct: '0',
		tax_rate: '13',
		floor_net: '7522.12389381'
	};
	// tax-inclusive 8,500 at 13% is exactly the floor: the rounded line net over quantity read lower
	expect(quoteBelowFloor(line, true)).toBe(false);
	expect(quoteBelowFloor({ ...line, unit_price: '8499.99' }, true)).toBe(true);
	// 0.3340 x 2 rounds to a net of 0.67, which hid the price under a 0.3350 floor
	const small = {
		unit_price: '0.3340',
		discount_pct: '0',
		tax_rate: '13',
		floor_net: '0.33500000'
	};
	expect(quoteBelowFloor(small, false)).toBe(true);
	expect(quoteBelowFloor({ ...small, unit_price: '0.3350' }, false)).toBe(false);
	expect(
		quoteBelowFloor({ ...small, unit_price: '8', discount_pct: '5', floor_net: '7.6' }, false)
	).toBe(false);
	expect(quoteBelowFloor({ ...small, floor_net: null }, false)).toBe(false);
});
