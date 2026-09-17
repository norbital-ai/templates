import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	project_name: true,
	project_number: true,
	client: true,
	main_contractor: true,
	status: true,
	schedule_range: true,
	contract_value: true,
	project_type: true,
	address: true,
	project_manager: true,
	description: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
