import { boolean, defineModel, instant, text, uuid } from '@norbital-ai/bolt/authoring';

export default defineModel(
	{
		job_assignment_id: uuid().notNull(),
		/** SHA-256 of the canonical evidence snapshot reviewed by the model. */
		basis_hash: text().notNull(),
		/** Canonical audit snapshot of the facts supplied to inference. */
		basis: text().notNull(),
		suspicious: boolean().notNull(),
		reason: text({ search: true }).notNull(),
		evidence_id: uuid(),
		model: text().notNull(),
		reviewed_at: instant().notNull(),
		/** One review per assignment and evidence basis, even when a task is retried. */
		source_key: text().notNull()
	},
	{
		description:
			'Controller-only audit ledger for every automated suspicion review, including clear decisions that must not create a suspicion log.',
		recordLabel: 'reason',
		icon: 'lucide:scan-search',
		indexes: [
			{ columns: ['source_key'], unique: true },
			{ columns: ['job_assignment_id', 'basis_hash'], unique: true },
			{ columns: ['reviewed_at'] }
		]
	}
);
