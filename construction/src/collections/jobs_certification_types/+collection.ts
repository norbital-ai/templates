import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = { job_id: true, certification_type_id: true } as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
