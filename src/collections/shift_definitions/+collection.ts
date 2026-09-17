import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	company_id: true,
	code: true,
	name: true,
	variant: true,
	effective_range: true
} as const;

/** The entity's roster codes. Its form writes every column; nothing is derived. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {}
});
