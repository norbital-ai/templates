import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	reference_name: true,
	reference_code: true,
	project_id: true,
	category: true,
	subcategory: true,
	unit_of_measure: true,
	rate: true,
	embodied_carbon_per_unit: true,
	carbon_unit: true,
	specification: true,
	bim_guid: true,
	data_source: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
