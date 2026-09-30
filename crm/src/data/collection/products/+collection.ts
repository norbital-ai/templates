import { collection } from '@norbital-ai/bolt';

const columns = [
	'external_code',
	'code',
	'name',
	'description',
	'spec',
	'unit',
	'currency',
	'unit_price',
	'tax_rate',
	'qty_on_hand',
	'main_supplier_id',
	'active'
] as const;

/** The catalogue: the form and the ERP item import pipeline write it as is. */
export default collection('products', {
	read: { fields: 'all' },
	create: { input: { columns } },
	update: { input: { columns } }
});
