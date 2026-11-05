import { Effect } from 'effect';
import { bolt } from '$bolt';
import type { Id } from '@norbital-ai/bolt';
import type { FieldEditor, FormState } from '@norbital-ai/ui';
/** Both line editors use the same catalogue defaults, preserving newer selections and edited values. */
export const selectOrderProduct = Effect.fnUntraced(function* (
	form: FormState,
	field: FieldEditor,
	id: Id<'products'> | null,
	setCurrency: (currency: string) => void,
	defaults: boolean = true
) {
	field.onChange(id);
	if (!defaults) return;
	form.set('unit_price', null);
	form.set('tax_rate', null);
	if (id === null) return;
	const order = form.id<'orders'>('order');
	if (order === null) return;
	const oldPrice = form.get('unit_price'),
		oldTax = form.get('tax_rate');
	const current = () => form.id('product') === id && form.id('order') === order;
	yield* bolt
		.query({
			products: { where: { id: { eq: id } }, limit: 1 },
			orders: { where: { id: { eq: order } }, limit: 1 }
		})
		.pipe(
			Effect.tap(({ products, orders }) =>
				Effect.sync(() => {
					const product = products.rows[0],
						header = orders.rows[0];
					if (!current() || product === undefined || header === undefined) return;
					setCurrency(header.currency);
					if (form.notice?.text === 'component.catalog_defaults_unavailable') form.notice = null;
					if (form.get('tax_rate') === oldTax)
						form.set('tax_rate', product.tax_rate?.toString() ?? null);
					if (form.get('unit_price') === oldPrice)
						form.set(
							'unit_price',
							header.direction === 'sales' && header.currency === product.currency
								? (product.unit_price?.toString() ?? null)
								: null
						);
				})
			),
			Effect.catch(() =>
				Effect.sync(() => {
					if (current())
						form.notice = { tone: 'danger', text: 'component.catalog_defaults_unavailable' };
				})
			)
		);
});
