import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Every column is the person's to set; the representation registers each one. */
const columns = {
	name: true,
	company_id: true,
	lead_contact_id: true,
	status: true,
	start_on: true,
	target_on: true,
	budget: true,
	summary: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
