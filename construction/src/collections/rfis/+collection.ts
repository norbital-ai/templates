import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	title: true,
	rfi_number: true,
	project_id: true,
	asked_by: true,
	assigned_to: true,
	subject: true,
	question: true,
	answer: true,
	status: true,
	priority: true,
	submitted_date: true,
	due_date: true,
	resolved_date: true,
	attachments: true,
	related_defect_id: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
