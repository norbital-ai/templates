import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	external_code: true,
	code: true,
	name: true,
	description: true,
	spec: true,
	unit: true,
	unit_price: true,
	tax_rate: true,
	qty_on_hand: true,
	main_supplier_id: true,
	active: true
} as const;

/** The catalogue mirror: the form, the ERP item pull and the import pipeline all write it as is. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
