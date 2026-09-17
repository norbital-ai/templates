import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	worker_name: true,
	worker_number: true,
	trade: true,
	status: true,
	phone: true,
	email: true,
	emergency_contact: true,
	date_of_birth: true,
	nationality: true,
	work_permit_expiry: true,
	medical_check_date: true,
	safety_induction_date: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
