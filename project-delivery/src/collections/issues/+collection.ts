import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Every column is the person's to set; the representation registers each one. */
const columns = {
	title: true,
	status: true,
	severity: true,
	raised_on: true,
	resolved_on: true,
	project_id: true,
	owner_id: true,
	description: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
