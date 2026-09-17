import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	claim_number: true,
	project_id: true,
	job_id: true,
	claim_type: true,
	status: true,
	claimed_amount: true,
	certified_amount: true,
	claim_period: true,
	submitted_date: true,
	paid_date: true,
	description: true,
	supporting_documents: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
