import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/** Every column is the person's to set; the representation registers each one. */
const columns = {
	name: true,
	status: true,
	industry: true,
	region: true,
	website: true,
	nda_required: true,
	nda_signed_on: true,
	nda_document: true,
	notes: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
