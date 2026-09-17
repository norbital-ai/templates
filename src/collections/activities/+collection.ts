import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Every column is the person's to set; the representation registers each one. */
const columns = {
	subject: true,
	kind: true,
	happened_on: true,
	project_id: true,
	contact_id: true,
	detail: true,
	recording: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
