import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = { permits_to_work_id: true, worker_id: true } as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
