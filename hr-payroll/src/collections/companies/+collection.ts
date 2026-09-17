import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

const columns = {
	settings_code: true,
	name: true,
	registration_number: true,
	pay_cutoff_day: true,
	pay_frequency: true,
	risk_class: true,
	region: true,
	facts: true,
	holiday_source: true,
	workbook_layout: true,
	disbursement_account: true,
	effective_range: true
} as const;

/** The legal entity. Its form writes every column; nothing is derived. */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } },
	delete: {}
});
