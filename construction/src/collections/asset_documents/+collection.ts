import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	title: true,
	document_number: true,
	project_id: true,
	site_location_id: true,
	document_type: true,
	asset_tag: true,
	asset_category: true,
	status: true,
	validity_range: true,
	document_url: true,
	version: true,
	tags: true
} as const;

export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
