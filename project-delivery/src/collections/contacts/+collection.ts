import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Every column is the person's to set; the representation registers each one. */
const columns = {
	full_name: true,
	job_title: true,
	email: true,
	phone: true,
	company_id: true,
	is_primary: true,
	notes: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
