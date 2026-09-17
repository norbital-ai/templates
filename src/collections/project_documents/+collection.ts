import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Every column is the person's to set; the representation registers each one. */
const columns = {
	title: true,
	kind: true,
	status: true,
	markdown_body: true,
	attachment: true,
	project_id: true,
	signed_by: true,
	signed_on: true,
	submitted_on: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
