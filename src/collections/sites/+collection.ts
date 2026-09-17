import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	site_code: true,
	name: true,
	location: true,
	client_name: true,
	house_type: true,
	floor_area_sqm: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {}
});
