import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	title: true,
	defect_number: true,
	project_id: true,
	site_location_id: true,
	job_id: true,
	reported_by: true,
	assigned_to: true,
	category: true,
	severity: true,
	status: true,
	description: true,
	reported_date: true,
	due_date: true,
	closed_date: true,
	photos: true,
	resolution_notes: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
