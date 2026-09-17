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

/**
 * The customer mirror: the ERP pull and the import pipeline write it as is.
 *
 * `external_code` stays in the update selection because the pull restates it on every run — the
 * identity column rides along with the mapped row. That it never *changes* is a rule of the one
 * grant that edits accounts, `erp_accounts_integration`: who may move an identity is a question
 * of authority, so it is answered where authority is declared.
 */
export default defineCollection({
	model,
	create: { input: { columns } },
	update: { input: { columns } }
});
