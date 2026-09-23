import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	external_code: true,
	name: true,
	industry: true,
	website: true,
	phone: true,
	currency: true,
	address: true,
	credit_limit: true,
	credit_used: true,
	credit_hold: true,
	active: true
} as const;

/** The customer master: the form and the ERP import pipeline write it as is. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
