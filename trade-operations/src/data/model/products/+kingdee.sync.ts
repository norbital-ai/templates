import { sync } from '@norbital-ai/bolt';
import { columns, readSource, fromSource } from '../../../integration/kingdee/polling.js';
import { projections } from '../../../integration/kingdee/projections.js';
import { preserveSource } from '../../../integration/kingdee/reconciliation.js';

export default sync('products', 'kingdee', {
	with: 'kingdee',
	every: '1min',
	read: function* ({ cursor, instance }, ctx) {
		return fromSource(
			yield* readSource(
				projections.products,
				cursor,
				ctx,
				(row) => {
					const r = columns(row);
					return {
						external_code: r.text('external_code'),
						source_number: r.text('source_number', null),
						name: r.text('name'),
						spec: r.text('spec', null),
						producing_area: r.text('producing_area', null),
						brand: r.text('brand', null),
						brand_en: r.text('brand_en', null),
						unit: r.text('unit', null),
						currency: r.currency('currency'),
						unit_price: r.decimalText('unit_price', null),
						tax_rate: r.decimalText('tax_rate', null),
						active: r.bool('active', true),
						source_updated_at: r.instant('source_updated_at')
					};
				},
				preserveSource({ model: 'products', instance, projection: projections.products, ctx })
			),
			instance
		);
	}
});
