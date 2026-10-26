import { Decimal } from '@norbital-ai/std/decimal';
import { Schema, Effect, Fiber } from 'effect';
import type { Id, Row } from '@norbital-ai/bolt';
import { FormState, type FieldEditor } from '@norbital-ai/ui';
import { afterEach, expect, it } from '@effect/vitest';
import { vi } from 'vitest';

import { selectOrderProduct } from '../src/lib/ui/order-product-defaults.js';
import { ReadFailed } from '@norbital-ai/bolt/errors';
import { workspace, draft as orderDraft, PRODUCT } from './kit.js';
const api = vi.hoisted(() => ({
	query:
		vi.fn<
			(
				...read:
					| [collection: 'products', input: { id: Id<'products'> }]
					| [collection: 'orders', input: { id: Id<'orders'> }]
			) => Effect.Effect<Row<'products'> | Row<'orders'> | null, ReadFailed>
		>()
}));
vi.mock('$bolt', () => ({ bolt: { query: api.query } }));
afterEach(() => api.query.mockReset());
const draft = (product: Id<'products'>, order: Id<'orders'>) => {
	const form = new FormState(
		{
			target: { of: 'collection', collection: 'order_lines', mode: 'create' },
			callable: 'order_lines.create',
			fields: ['product', 'order', 'unit_price', 'tax_rate'].map((name) => ({
				name,
				kind: { kind: 'text' }
			}))
		},
		null,
		{ product, order },
		() => Effect.die(new Error('Default selection must not act')),
		{ pendingApproval: 'Submitted', running: 'Continuing', conflict: 'Changed', unknown: 'Unknown' }
	);
	const field: FieldEditor = {
		id: 'product',
		name: 'product',
		kind: { kind: 'text' },
		disabled: false,
		value: form.get('product'),
		onChange: (value) => form.set('product', value)
	};
	const id = form.id<'products'>('product');
	if (id === null) throw new Error('Missing product fixture.');
	return { form, field, id };
};
it.live(
	'catalogue completion preserves prices and explicit zero tax edited while the reads were pending',
	() =>
		Effect.gen(function* () {
			const t = yield* workspace(),
				own = yield* orderDraft(t);
			const productRow = yield* t.as(t.admin).query('products', { id: PRODUCT }),
				headerRow = yield* t.as(t.admin).query('orders', { id: own.order });
			if (productRow === null || headerRow === null)
				throw new Error('Catalogue and order fixtures required');
			const product = Promise.withResolvers<Row<'products'>>();
			const header = Promise.withResolvers<Row<'orders'>>();
			api.query.mockImplementation((...read) =>
				read[0] === 'products'
					? Effect.tryPromise({
							try: () => product.promise,
							catch: (cause) => new ReadFailed({ code: 'fixture', message: String(cause) })
						})
					: Effect.tryPromise({
							try: () => header.promise,
							catch: (cause) => new ReadFailed({ code: 'fixture', message: String(cause) })
						})
			);
			const { form, field, id } = draft(PRODUCT, own.order);
			let currency: string | undefined;
			const pending = yield* Effect.forkScoped(
				selectOrderProduct(form, field, id, (value) => {
					currency = value;
				})
			);
			yield* Effect.tryPromise({
				try: () => vi.waitFor(() => expect(api.query).toHaveBeenCalledTimes(2)),
				catch: (cause) => new TestIoFailed({ message: String(cause) })
			});
			expect(api.query).toHaveBeenCalledWith('products', { id: PRODUCT });
			expect(api.query).toHaveBeenCalledWith('orders', { id: own.order });
			form.set('unit_price', '17');
			form.set('tax_rate', '0');
			product.resolve({
				...productRow,
				currency: 'SGD',
				unit_price: Decimal.of('2'),
				tax_rate: Decimal.of('9')
			});
			header.resolve({ ...headerRow, currency: 'SGD', direction: 'sales' });
			yield* Fiber.join(pending);
			expect(form.get('unit_price')).toBe('17');
			expect(form.get('tax_rate')).toBe('0');
			expect(currency).toBe('SGD');
		})
);
it.live('a stale failure from an earlier parent cannot replace the newer form notice', () =>
	Effect.gen(function* () {
		const t = yield* workspace(),
			own = yield* orderDraft(t),
			other = yield* orderDraft(t);
		const headerRow = yield* t.as(t.admin).query('orders', { id: own.order });
		if (headerRow === null) throw new Error('Order fixture required');
		const product = Promise.withResolvers<null>();
		api.query.mockImplementation((...read) =>
			read[0] === 'products'
				? Effect.tryPromise({
						try: () => product.promise,
						catch: (cause) => new ReadFailed({ code: 'fixture', message: String(cause) })
					})
				: Effect.succeed(headerRow)
		);
		const { form, field, id } = draft(PRODUCT, own.order);
		const pending = yield* Effect.forkScoped(selectOrderProduct(form, field, id, () => {}));
		yield* Effect.tryPromise({
			try: () => vi.waitFor(() => expect(api.query).toHaveBeenCalledTimes(2)),
			catch: (cause) => new TestIoFailed({ message: String(cause) })
		});
		expect(api.query).toHaveBeenCalledWith('products', { id: PRODUCT });
		expect(api.query).toHaveBeenCalledWith('orders', { id: own.order });
		form.set('order', other.order);
		form.notice = { tone: 'info', text: 'New parent' };
		product.reject(new Error('Old parent read failed'));
		yield* Fiber.join(pending);
		expect(form.notice).toEqual({ tone: 'info', text: 'New parent' });
	})
);
class TestIoFailed extends Schema.TaggedError<TestIoFailed>()('TestIoFailed', {
	message: Schema.String
}) {}
