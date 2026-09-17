import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	location_name: true,
	location_code: true,
	project_id: true,
	location_type: true,
	parent_location_id: true,
	grid_reference: true,
	description: true,
	coordinates: true,
	bim_model_element_id: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
