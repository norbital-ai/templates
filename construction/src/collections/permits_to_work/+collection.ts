import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	permit_number: true,
	permit_type: true,
	project_id: true,
	site_location_id: true,
	job_id: true,
	worker_id: true,
	status: true,
	requested_date: true,
	validity_range: true,
	approved_by: true,
	hazards_identified: true,
	control_measures: true,
	signatures: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
