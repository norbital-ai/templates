import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	certification_name: true,
	certification_code: true,
	category: true,
	issuing_body: true,
	validity_period_months: true,
	requires_refresher: true,
	description: true,
	requirements: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
