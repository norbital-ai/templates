import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	job_title: true,
	job_number: true,
	project_id: true,
	job_type: true,
	status: true,
	schedule_range: true,
	budget: true,
	bim_reference_id: true,
	site_location_id: true,
	description: true,
	priority: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
