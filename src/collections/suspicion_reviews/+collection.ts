import { defineCollection } from '@norbital-ai/bolt/authoring';
import model from './+model.js';

/**
 * An immutable inference audit ledger: rows are created by the review automation and never
 * changed or deleted, so the declaration exposes no `update` and no `delete`.
 */
export default defineCollection({
	model,
	create: {
		input: {
			columns: {
				job_assignment_id: true,
				basis_hash: true,
				basis: true,
				suspicious: true,
				reason: true,
				evidence_id: true,
				model: true,
				reviewed_at: true,
				source_key: true
			}
		}
	}
});
